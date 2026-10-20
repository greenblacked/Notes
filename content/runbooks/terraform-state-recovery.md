---
title: Terraform state recovery
description: Recover from stuck locks, corrupted or lost state, state mv/rm/import refactors, drift and provider upgrade breakage, with a backup before each risky step.
type: runbook
tags:
  - runbooks
  - terraform
  - gcp
  - reliability
created: 2026-10-16
modified: 2026-10-20
evidence: source-reviewed
reviewed: 2026-10-20
review-due: 2027-04-20
destructive: true
draft: false
---

Terraform state is the mapping between your code and real resources. When it is locked, damaged or out of step with reality, `plan` becomes untrustworthy. This runbook assumes the GCS backend, which is the common case on GCP. The layout that makes recovery small is described in [[terraform-module-and-state-layout]].

> [!info] Scope
> Commands were checked against the Terraform and Google Cloud documentation on 2026-10-20 (see Evidence), but never run against a real backend, so the note is not marked `verified`. Run `terraform <command> -help` for your version. OpenTofu uses the same commands under `tofu`, see [[terraform-vs-opentofu]]; OpenTofu behaviour was not checked here.

> [!danger] This runbook changes and overwrites state
> `force-unlock`, `state rm`, `state push -force` and copying an older object over the live state can orphan real resources or make Terraform forget or re-create them. Every step below starts from a backup (step 0). If something goes wrong, the recovery is the backup file in `$BACKUP_DIR` and the older object generations in the bucket (see Cleanup and rollback in Evidence).

## When to use

- `Error acquiring the state lock`.
- State file is missing, empty, truncated, or `terraform plan` proposes to create everything.
- A refactor (renamed resource, moved module) must not destroy and recreate resources.
- A resource exists in the cloud but not in state, or the reverse.
- `plan` shows unexpected changes after a provider upgrade or manual console edits.

## Preconditions

- Access to the bucket and to the resources. `roles/storage.objectAdmin` covers the object steps (read, copy, delete state objects) only. Enabling versioning needs `storage.buckets.update` (Google's Object Versioning page names the Storage Admin role, `roles/storage.admin`, on the bucket or project) and `buckets describe` needs `storage.buckets.get`; confirm the role on the IAM roles page before relying on it.
- Nobody else is running `apply` for this state: ask in the team channel and check CI pipelines first.
- Object versioning is enabled on the state bucket. If not, enable it now: it is the safety net for everything below.

```bash
BUCKET=my-tf-state-bucket
PREFIX=envs/prod                 # backend "gcs" prefix
STATE_OBJ="gs://$BUCKET/$PREFIX/default.tfstate"
BACKUP_DIR=./state-backups
mkdir -p "$BACKUP_DIR"

gcloud storage buckets describe "gs://$BUCKET" --format="value(versioning.enabled)"   # True
gcloud storage buckets update "gs://$BUCKET" --versioning                              # enable if not
```

## Steps

### 0. Always take a backup first

Before any command that changes state, take two copies: the remote object and a local pull.

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
terraform state pull > "$BACKUP_DIR/pre-change-$STAMP.tfstate"
gcloud storage cp "$STATE_OBJ" "gs://$BUCKET/$PREFIX/backup-$STAMP.tfstate"
jq '.serial, .lineage, (.resources | length)' "$BACKUP_DIR/pre-change-$STAMP.tfstate"
```

Record the serial and resource count; you will compare after. State contains secrets in plain text, so keep backups out of git and restrict their permissions.

Terraform's state-changing commands (`state mv`, `state rm`) also write their own backup, and the `-backup` option is documented as a legacy option for local state only. Do not rely on it with a remote backend: the two copies above are the backup.

### 1. Stuck lock

The GCS backend supports state locking. In practice the lock is a separate object next to the state, named after the workspace (for the default workspace `<prefix>/default.tflock`); the Terraform GCS backend page does not describe the lock object, so confirm the name by listing the prefix. It can stay behind when a run is killed. First make sure no run is active (CI job, colleague, a laptop). The error message prints the lock ID, holder and time.

```bash
terraform plan   # prints: Lock Info: ID: 1699999999999999
gcloud storage ls -L "gs://$BUCKET/$PREFIX/default.tflock"
```

If the holder is dead:

```bash
terraform force-unlock LOCK_ID       # asks for confirmation
terraform force-unlock -force LOCK_ID   # skips the prompt; use only in a script you have reviewed
```

`LOCK_ID` is the ID Terraform prints when the lock cannot be acquired. The command removes the lock only; it does not change infrastructure.

> [!danger] Do not unlock a live run
> Two concurrent writers can corrupt state. Forced unlock does not stop a running process; it only removes the lock. Use it for your own stuck lock after the normal unlock failed, and only once you know why the lock is stuck. Recovery if you unlocked too early: restore the step 0 backup object (step 2) and re-run once.

If `force-unlock` fails, delete the lock object (`gcloud storage rm "gs://$BUCKET/$PREFIX/default.tflock"`) only after confirming the lock info matches the dead run, and after listing the exact object name with `gcloud storage ls`. Then run `terraform plan` to be sure the state is readable. In CI, set `-lock-timeout=5m` (or similar) on `plan` and `apply` so a short overlap waits for the lock instead of failing (the `apply` page documents `-lock-timeout` with a default of `0s`; check `terraform plan -help` for your version); `-lock=false` is documented as dangerous if others might run commands against the same workspace, so do not use it here.

### 2. Corrupted or lost state

Check what the bucket has:

```bash
gcloud storage ls --all-versions -l "$STATE_OBJ"
```

Each noncurrent version keeps the object name and is identified by its generation number (`OBJECT#GENERATION`). Find the last good generation (the one before the bad write; compare timestamps with the failed run), download it and inspect it:

```bash
GEN=1699999999999999
gcloud storage cp "${STATE_OBJ}#${GEN}" "$BACKUP_DIR/candidate.tfstate"
jq '.version, .serial, .terraform_version, (.resources | length)' "$BACKUP_DIR/candidate.tfstate"
```

Back up the current (bad) object, then restore the candidate by copying it over the live object:

> [!danger] Restoring over the current state
> This overwrites the live state object, and a plain object copy bypasses every check Terraform's own `state push` applies. With versioning enabled the overwritten live version becomes a noncurrent generation, so you can copy it back, but without versioning it is gone: take the `corrupt-$STAMP` copy first, as below.

```bash
gcloud storage cp "$STATE_OBJ" "gs://$BUCKET/$PREFIX/corrupt-$STAMP.tfstate"
gcloud storage cp "$BACKUP_DIR/candidate.tfstate" "$STATE_OBJ"
terraform plan
```

The restored state may lack changes made after that point. Read the plan carefully: resources created since will appear as "to be created" and should be imported (step 4), not re-created. If you must push a local file as state instead, `terraform state push` refuses the push when the lineage differs from the remote state, or when the remote serial is higher than the pushed file's serial, and `-force` switches both checks off and overwrites the destination. Do not use `-force` without understanding why it refuses. HashiCorp's own guides also describe raising the serial in a known-good older file before uploading it; check the current docs before doing that by hand.

**No usable version at all:** rebuild state by importing. List the resources from code, then import each (step 4) until `plan` is empty. This is slow; it is the reason to enable versioning and keep state small.

### 3. Rename or move without recreating (`state mv`, `moved`)

Prefer a `moved` block in code (Terraform 1.1 and later): it is reviewed, applied by the pipeline and leaves no manual state edit.

```hcl title="refactor.tf"
moved {
  from = google_compute_instance.web
  to   = google_compute_instance.app
}

moved {
  from = module.old_name
  to   = module.new_name
}
```

For one-off cases, or moves between state files, use the CLI after a backup (step 0):

```bash
terraform state list
terraform state mv google_compute_instance.web google_compute_instance.app
terraform plan   # must show no changes for the moved resource
```

To move into a different state, HashiCorp documents `-state` (source) and `-state-out` (destination) as legacy options for local state files, and a pull/push approach for remote state that it says carries some risk of corrupting remote state. Back up both states first, and check `terraform state mv -help` for your version; recent versions of the `state mv` page document `-dry-run` (it reports the resource instances that match the source address without moving them), so preview with `terraform state mv -dry-run SRC DST` first. The 1.8 and 1.9 pages seen in search results did not list it, so check `terraform state mv -help` for your version.

### 4. Import existing resources

Use `import` blocks (Terraform 1.5 and later). They are plan-able, reviewable and run in CI.

```hcl title="imports.tf"
import {
  to = google_storage_bucket.assets
  id = "projects/my-project/buckets/my-assets"
}
```

```bash
terraform plan -generate-config-out=generated.tf   # optional, experimental: path must not exist yet
terraform plan                                      # shows "1 to import"
terraform apply
```

`-generate-config-out` is marked experimental and Terraform may still write a file if the plan fails for another reason, so treat the output as a draft. Review generated code before keeping it; it contains computed attributes and defaults you do not want pinned. The CLI equivalent is `terraform import ADDRESS ID`; the ID format per resource is on the provider's documentation page for that resource. After import, `plan` must be clean. If it shows changes, either fix the code to match reality or accept them deliberately.

### 5. Remove from state without deleting (`state rm`)

Use it to hand a resource to another state or stop managing it. Back up first. It never touches the real resource.

> [!danger] The next plan may want to create the resource again
> After `state rm` the object still exists in the cloud, but Terraform has forgotten it, so a later plan proposes to create it. If you apply that without removing the code, you get a duplicate or an error. Recovery: re-import it (step 4) or push the step 0 backup.

```bash
terraform state rm -dry-run google_sql_database.legacy   # lists what would be forgotten
terraform state rm google_sql_database.legacy
terraform plan   # the resource now looks "to be created" unless you also removed it from code
```

Remove it from code in the same change, or Terraform will try to create it again. An alternative that is reviewable in code is a `removed` block with `lifecycle { destroy = false }` (Terraform 1.7 and later), which lets you preview the result in a plan:

```hcl title="removed.tf"
removed {
  from = google_sql_database.legacy

  lifecycle {
    destroy = false
  }
}
```

Without `destroy = false` the default is to destroy the real resource, so always include it.

### 6. Drift

Drift is real infrastructure changed outside Terraform.

```bash
terraform plan -refresh-only          # shows differences between state and reality
terraform apply -refresh-only         # accepts reality into state, changes no resource
```

Decide per difference: if the manual change is wanted, change the code to match and accept it into state; if not, run a normal `apply` to revert it. Never run `apply -refresh-only` blindly: it records bad manual changes as truth. For continuous detection, run a scheduled `plan -detailed-exitcode` in CI (exit code 2 means changes), see [[gitlab-ci-pipeline-structure]].

### 7. Provider upgrade breakage

After `terraform init -upgrade`, `plan` may show many changes or errors from changed defaults, renamed or removed arguments, or a state schema upgrade (which cannot be reversed by an older provider).

1. Back up state (step 0) before the first `init -upgrade` against shared state.
2. Pin versions in code and commit `.terraform.lock.hcl`:

   ```hcl title="versions.tf"
   terraform {
     required_providers {
       google = {
         source  = "hashicorp/google"
         version = "~> 6.0"
       }
     }
   }
   ```

3. Read the provider's upgrade guide and changelog for the new major version. Fix code until `plan` shows only intended changes.
4. To go back: restore the state backup, revert the version constraint and `.terraform.lock.hcl` in git, and run plain `terraform init` (without `-upgrade`) so the reverted lock file is honoured. A state written by a newer provider schema may not load in an older one, which is why the backup is mandatory. The `~> 6.0` constraint above is an example; pick the range your provider's upgrade guide supports.

## Validation

```bash
terraform validate
terraform plan -detailed-exitcode ; echo "exit=$?"   # 0 = clean, 2 = changes, 1 = error
terraform state list | wc -l                            # compare with the backup resource count
terraform state pull | jq '.serial'                     # unchanged after an unlock; the restored generation's serial after a restore; higher after state mv/rm/import
```

A recovery is finished only when `plan` is clean (or shows only changes you understand), the lock object is gone, and a normal pipeline run succeeds.

## Rollback

- Remote state: restore the pre-change backup object over the live one (`gcloud storage cp "gs://$BUCKET/$PREFIX/backup-$STAMP.tfstate" "$STATE_OBJ"`), or copy a previous generation as in step 2.
- `state mv`/`rm`/`import`: these raise the serial, so the pulled backup now has a lower serial than the remote state. `terraform state push "$BACKUP_DIR/pre-change-$STAMP.tfstate"` is then refused (the remote serial is higher) unless you use `-force`, which switches off the lineage and serial checks and overwrites the remote state. Prefer copying the backup object back (`gcloud storage cp "gs://$BUCKET/$PREFIX/backup-$STAMP.tfstate" "$STATE_OBJ"`) after confirming nobody else wrote in between, and use `push -force` only deliberately.
- Applied infrastructure changes are not reverted by restoring state; they must be undone in code. Restoring state after a real `apply` makes Terraform forget what exists.

## Troubleshooting

| Symptom                                                                                                                | Cause and fix                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Error saying the state was written by a newer Terraform version than the one you run (exact wording varies by version) | Someone applied with a newer CLI. Upgrade your CLI; pin `required_version` and use one version in CI and locally. |
| `plan` wants to create everything                                                                                      | Wrong backend config or prefix, or an empty state. Check `terraform init -reconfigure` output and the `prefix`.   |
| `Error 412` or `conditionNotMet` on state write (a failed precondition)                                                | Probably a concurrent write. Re-run once the other run has finished; check for a second pipeline.                 |
| Import error saying the remote object does not exist                                                                   | Wrong ID format or project. Check the resource's import section in the provider docs.                             |
| Import succeeded but plan shows forced replacement                                                                     | Code differs on an immutable attribute. Fix the code to match, do not apply.                                      |
| Secrets visible in state backups                                                                                       | Expected: state holds them. Restrict the bucket, enable encryption and keep backups out of tickets and chat.      |

If recovery touched production infrastructure, record it in the change log and follow [[production-change-checklist]].

## Evidence

### Sources checked

- [terraform state push](https://developer.hashicorp.com/terraform/cli/commands/state/push): the push is blocked when the lineage differs or the remote serial is higher, and `-force` disables both checks, checked 2026-10-20 (search excerpt, the page could not be fetched).
- [terraform force-unlock](https://developer.hashicorp.com/terraform/cli/commands/force-unlock) and [State: Locking](https://developer.hashicorp.com/terraform/language/state/locking): usage `terraform force-unlock [options] LOCK_ID`, `-force` skips the prompt, the lock ID is printed on failure, use only for your own lock, checked 2026-10-20 (search excerpts).
- [terraform state rm](https://developer.hashicorp.com/terraform/cli/commands/state/rm): `-dry-run`, `-lock=false`, `-lock-timeout`, `-backup` as a legacy local-state option, objects keep existing in the cloud, a `removed` block is the previewable alternative, checked 2026-10-20 (search excerpt).
- [removed block](https://developer.hashicorp.com/terraform/language/block/removed) and [Remove a resource from state](https://developer.hashicorp.com/terraform/language/state/remove): Terraform 1.7 and later, `lifecycle { destroy = false }`, destroy is the default without it, checked 2026-10-20 (search excerpts).
- [Refactor Terraform state](https://developer.hashicorp.com/terraform/language/state/refactor): `moved` blocks need Terraform 1.1 and later; `-state` and `-state-out` are legacy options; pull/push between remote states carries some risk, checked 2026-10-20 (search excerpt).
- [Upgrade and refactor modules](https://developer.hashicorp.com/validated-patterns/terraform/upgrade-and-refactor-terraform-modules): import blocks need Terraform 1.5.0 and later, checked 2026-10-20 (search excerpt).
- [terraform state mv](https://developer.hashicorp.com/terraform/cli/v1.15.x/commands/state/mv): `-dry-run` and `-lock-timeout=DURATION`, checked 2026-10-20 (search excerpt). [terraform apply](https://developer.hashicorp.com/terraform/cli/commands/apply): `-lock-timeout` default `0s` and `-refresh-only`, checked 2026-10-20 (search excerpt of a mirror).
- [terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan) and [Generating configuration](https://developer.hashicorp.com/terraform/language/import/generating-configuration): `-detailed-exitcode` (0, 1, 2), `-generate-config-out` is experimental and needs a new file path, checked 2026-10-20 (search excerpts).
- [Recover state from backup](https://developer.hashicorp.com/terraform/cli/state/recover) and [Backends](https://developer.hashicorp.com/terraform/language/state/backends): pull and push as the recovery path, do not unlock until you know the cause, checked 2026-10-20 (search excerpts).
- [Use versioned objects](https://docs.cloud.google.com/storage/docs/using-versioned-objects) and [Use Object Versioning](https://docs.cloud.google.com/storage/docs/using-object-versioning): `gcloud storage ls --all-versions`, `OBJECT#GENERATION`, restoring by `gcloud storage cp`, the overwritten live version becomes noncurrent, `gcloud storage buckets update --[no-]versioning`, checked 2026-10-20 (search excerpts).
- [Lock and upgrade provider versions](https://developer.hashicorp.com/terraform/tutorials/cli/provider-versioning): `terraform init -upgrade` upgrades providers to the latest version within the constraints; commit `.terraform.lock.hcl` and do not edit it by hand, checked 2026-10-20 (search excerpt).

Corrections made on 2026-10-20: the `state push` rule now says lineage mismatch or a higher remote serial (the old rollback text said the push needed an equal or higher serial, which would make restoring a backup after `state mv/rm/import` fail without `-force`; the rollback now says so and prefers copying the backup object); the lock object name is hedged because the GCS backend page does not describe it; `terraform init -upgrade=false -reconfigure` was replaced by plain `terraform init` with the reverted lock file; `-backup` is described as a legacy local-state option; `state rm -dry-run` and a `removed` example were added; the `moved` (1.1), `import` (1.5) and `removed` (1.7) versions are stated where the docs gave them; error message strings are no longer quoted verbatim; danger callouts were added at force-unlock, restore-over-current and `state rm`.

### Not verified

- Whether `terraform state mv -dry-run` exists in the Terraform version you run: recent doc versions list it, the 1.8 and 1.9 pages seen did not (search excerpts).
- The name and format of the GCS lock object (`default.tflock`) and the exact wording of the lock and 412 errors; the docs pages checked do not describe them.
- `-lock-timeout` on `plan`: its default of `0s` was seen on the `apply` page only, through a third-party mirror of the docs. `plan -refresh-only` and `apply -refresh-only` are documented (the plan page says refresh-only needs Terraform 0.15.4 or later), seen through search excerpts and mirrors, not the official pages.
- That a state written by a newer provider schema cannot be read by an older provider, and the exact "newer Terraform version" error text.
- The behaviour of the commands on OpenTofu, and on HCP Terraform or other backends.
- The documentation pages were reached through search excerpts only, because the lab could not fetch the Terraform pages; nothing was run against Terraform, GCS or a real state.

### Environment

Terraform CLI 1.7 or later for `removed` blocks, 1.5 or later for `import` blocks, 1.1 or later for `moved` blocks; the GCS backend; the Google Cloud CLI with `gcloud storage`; `jq`; bash or zsh. The helper checks ran on Linux 6.18.44 with GNU bash 5.2.21, sha256sum (GNU coreutils) 9.4, Python 3.13.16 (the lab used Python, not jq). The Terraform binary was not installed there.

### Prerequisites

Object versioning enabled on the state bucket, `roles/storage.objectAdmin` (or equivalent) for the object steps plus a role with `storage.buckets.update` if versioning must be enabled, confirmation that no pipeline or person is running `apply` for this state, a local `$BACKUP_DIR` with restricted permissions, and the pulled and copied backups from step 0.

### Expected results

After step 0 the local file and the `backup-$STAMP` object exist with the recorded serial, lineage and resource count. After a restore, `terraform plan` loads the state without error and shows only changes you understand. After `state rm`, `terraform state list` no longer shows the address while the real resource still exists. `plan -detailed-exitcode` returns 0 when clean and 2 when there are changes.

### Failure conditions

Lock errors remain after `force-unlock` (the ID does not match, or the backend does not support it); `state push` is refused over lineage or serial; `plan` wants to create everything (wrong prefix or empty state); the restored state is older than the real infrastructure and plan proposes duplicates; a provider upgrade changed the state schema. Stop, keep the backups and compare serial and lineage before trying again.

### Cleanup and rollback

See the Rollback section. In short: copy the `backup-$STAMP` object back over the live state, or an older generation from `gcloud storage ls --all-versions`; use `push -force` only deliberately. After success, delete the `corrupt-` and `backup-` copies from the state prefix when your retention policy allows, and keep the local `$BACKUP_DIR` files restricted because state holds secrets. Restoring state never reverts real infrastructure changes.

### Lab run

A helper check only; it does not raise the evidence level and no Terraform binary was involved. Host: Linux 6.18.44-fc-v139, no network. `bash --version | head -1` printed `GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)`; `sha256sum --version | head -1` printed `sha256sum (GNU coreutils) 9.4`; `python3 --version` printed `Python 3.13.16`; `which terraform` found nothing. Run 2026-10-20 in a fresh directory. A fixture state (version 4, serial 7, a made-up lineage, no resources) stood in for `terraform state pull`, so the copy was a plain `cp`. Three small standard-library Python scripts do the JSON work (run as `python3 -I`).

`edit.py` simulates the change (serial plus one, one extra resource), `summ.py` prints serial, lineage and resource count, and `cmp.py` applies the two documented push checks (lineage differs, remote serial higher) to fixture files:

```python title="edit.py"
import json, sys
# usage: edit.py FILE  -> raises serial by 1 and adds one resource, in place
p = sys.argv[1]
s = json.load(open(p))
s["serial"] += 1
s["resources"].append({"mode": "managed", "type": "google_storage_bucket", "name": "assets", "provider": "x", "instances": []})
json.dump(s, open(p, "w"), indent=2)
```

```python title="summ.py"
import json, sys
s = json.load(open(sys.argv[1]))
print(json.dumps([s["serial"], s["lineage"], len(s["resources"])], separators=(",", ":")))
```

```python title="cmp.py"
import json, sys
# usage: cmp.py REMOTE LOCAL...  -> applies the two documented push checks to fixtures
remote = json.load(open(sys.argv[1]))
for path in sys.argv[2:]:
    local = json.load(open(path))
    reasons = []
    if local["lineage"] != remote["lineage"]:
        reasons.append("lineage differs")
    if remote["serial"] > local["serial"]:
        reasons.append(f"remote serial {remote['serial']} > local serial {local['serial']}")
    print(path, "->", ("would be refused without -force: " + "; ".join(reasons)) if reasons else "would be accepted")
```

```bash title="run.sh"
set -eu
STAMP=20261020T120000Z
mkdir state-backups
printf '{"version":4,"terraform_version":"1.9.0","serial":7,"lineage":"3f1c9a52-aaaa-4bbb-8ccc-0123456789ab","outputs":{},"resources":[]}\n' > live.tfstate
cp live.tfstate state-backups/pre-change-$STAMP.tfstate
python3 -I summ.py state-backups/pre-change-$STAMP.tfstate
sha256sum live.tfstate state-backups/pre-change-$STAMP.tfstate
python3 -I edit.py live.tfstate
echo "after change:"; python3 -I summ.py live.tfstate; sha256sum live.tfstate
cp live.tfstate remote.tfstate
cp state-backups/pre-change-$STAMP.tfstate live.tfstate
echo "after restore:"; python3 -I summ.py live.tfstate; sha256sum live.tfstate
cmp live.tfstate state-backups/pre-change-$STAMP.tfstate && echo IDENTICAL
sed 's/3f1c9a52/00000000/' live.tfstate > otherlineage.tfstate
python3 -I cmp.py remote.tfstate live.tfstate otherlineage.tfstate
```

```text
[7,"3f1c9a52-aaaa-4bbb-8ccc-0123456789ab",0]
75f98710216d17371ad7f75482da29259daa74f533b22dab6685599c5dc16773  live.tfstate
75f98710216d17371ad7f75482da29259daa74f533b22dab6685599c5dc16773  state-backups/pre-change-20261020T120000Z.tfstate
after change:
[8,"3f1c9a52-aaaa-4bbb-8ccc-0123456789ab",1]
b9ac5807ca054cb66f017ee2ae948ebd3e46f3b04869eff87f7c52ef66045577  live.tfstate
after restore:
[7,"3f1c9a52-aaaa-4bbb-8ccc-0123456789ab",0]
75f98710216d17371ad7f75482da29259daa74f533b22dab6685599c5dc16773  live.tfstate
IDENTICAL
live.tfstate -> would be refused without -force: remote serial 8 > local serial 7
otherlineage.tfstate -> would be refused without -force: lineage differs; remote serial 8 > local serial 7
```

`cmp.py` is not Terraform's code and proves nothing about Terraform's behaviour; it illustrates why restoring a backup after a change needs `-force` or an object copy. No cloud or Terraform backend was touched.
