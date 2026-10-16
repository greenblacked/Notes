---
title: Terraform state recovery
description: Recover from stuck locks, corrupted or lost state, refactors with state mv/rm/import, drift and provider upgrade breakage, with a backup before every destructive step.
type: runbook
tags:
  - runbooks
  - terraform
  - gcp
  - reliability
created: 2026-10-16
modified: 2026-10-16
draft: false
---

Terraform state is the mapping between your code and real resources. When it is locked, damaged or out of step with reality, `plan` becomes untrustworthy. This runbook assumes the GCS backend, which is the common case on GCP. The layout that makes recovery small is described in [[terraform-module-and-state-layout]].

> [!info] Scope
> Commands were written from the Terraform CLI as documented on developer.hashicorp.com, but the pages were not re-fetched when this note was written, so it is not marked `verified`. Run `terraform <command> -help` for your version. OpenTofu uses the same commands under `tofu`, see [[terraform-vs-opentofu]].

## When to use

- `Error acquiring the state lock`.
- State file is missing, empty, truncated, or `terraform plan` proposes to create everything.
- A refactor (renamed resource, moved module) must not destroy and recreate resources.
- A resource exists in the cloud but not in state, or the reverse.
- `plan` shows unexpected changes after a provider upgrade or manual console edits.

## Preconditions

- Access to the bucket (`roles/storage.objectAdmin` on the state bucket, or equivalent) and to the resources.
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

### 1. Stuck lock

A GCS backend lock is an object named `<prefix>/default.tflock`. It stays behind when a run is killed. First make sure no run is active (CI job, colleague, a laptop). The error message prints the lock ID, holder and time.

```bash
terraform plan   # prints: Lock Info: ID: 1699999999999999
gcloud storage ls -L "gs://$BUCKET/$PREFIX/default.tflock"
```

If the holder is dead:

```bash
terraform force-unlock LOCK_ID
```

> [!warning] Do not unlock a live run
> Two concurrent writers can corrupt state. Forced unlock does not stop a running process; it only removes the lock.

If `force-unlock` fails, delete the lock object (`gcloud storage rm "gs://$BUCKET/$PREFIX/default.tflock"`) only after confirming the lock info matches the dead run. Then run `terraform plan` to be sure the state is readable.

### 2. Corrupted or lost state

Check what the bucket has:

```bash
gcloud storage ls --all-versions -l "$STATE_OBJ"
```

Each line has a generation number. Find the last good generation (the one before the bad write; compare timestamps with the failed run), download it and inspect it:

```bash
GEN=1699999999999999
gcloud storage cp "${STATE_OBJ}#${GEN}" "$BACKUP_DIR/candidate.tfstate"
jq '.version, .serial, .terraform_version, (.resources | length)' "$BACKUP_DIR/candidate.tfstate"
```

Back up the current (bad) object, then restore the candidate by copying it over the live object:

```bash
gcloud storage cp "$STATE_OBJ" "gs://$BUCKET/$PREFIX/corrupt-$STAMP.tfstate"
gcloud storage cp "$BACKUP_DIR/candidate.tfstate" "$STATE_OBJ"
terraform plan
```

The restored state may lack changes made after that point. Read the plan carefully: resources created since will appear as "to be created" and should be imported (step 4), not re-created. If you must push a local file as state instead, `terraform state push` refuses a lower serial or a different lineage unless forced; do not use `-force` without understanding why it refuses.

**No usable version at all:** rebuild state by importing. List the resources from code, then import each (step 4) until `plan` is empty. This is slow; it is the reason to enable versioning and keep state small.

### 3. Rename or move without recreating (`state mv`, `moved`)

Prefer a `moved` block in code: it is reviewed, applied by the pipeline and leaves no manual state edit.

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

To move into a different state, use `-state-out`, or `terraform state pull`/`push` between the two backends, with a backup of both.

### 4. Import existing resources

Use `import` blocks (Terraform 1.5 and later; check your version). They are plan-able, reviewable and run in CI.

```hcl title="imports.tf"
import {
  to = google_storage_bucket.assets
  id = "projects/my-project/buckets/my-assets"
}
```

```bash
terraform plan -generate-config-out=generated.tf   # optional: draft the resource block
terraform plan                                      # shows "1 to import"
terraform apply
```

Review generated code before keeping it; it contains computed attributes and defaults you do not want pinned. The CLI equivalent is `terraform import ADDRESS ID`; the ID format per resource is on the provider's documentation page for that resource. After import, `plan` must be clean. If it shows changes, either fix the code to match reality or accept them deliberately.

### 5. Remove from state without deleting (`state rm`)

Use it to hand a resource to another state or stop managing it. Back up first. It never touches the real resource.

```bash
terraform state rm google_sql_database.legacy
terraform plan   # the resource now looks "to be created" unless you also removed it from code
```

Remove it from code in the same change, or Terraform will try to create it again. An alternative that is reviewable in code is a `removed` block with `lifecycle { destroy = false }` (Terraform 1.7 and later; check your version).

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
4. To go back: restore the state backup, revert the version constraint and lock file, and run `terraform init -upgrade=false -reconfigure`. A state written by a newer provider schema may not load in an older one, which is why the backup is mandatory.

## Validation

```bash
terraform validate
terraform plan -detailed-exitcode ; echo "exit=$?"   # 0 = clean, 2 = changes, 1 = error
terraform state list | wc -l                            # compare with the backup resource count
terraform state pull | jq '.serial'                     # higher than the recorded serial
```

A recovery is finished only when `plan` is clean (or shows only changes you understand), the lock object is gone, and a normal pipeline run succeeds.

## Rollback

- Remote state: restore the pre-change backup object over the live one (`gcloud storage cp "gs://$BUCKET/$PREFIX/backup-$STAMP.tfstate" "$STATE_OBJ"`), or copy a previous generation as in step 2.
- `state mv`/`rm`/`import`: restore the pulled backup with `terraform state push "$BACKUP_DIR/pre-change-$STAMP.tfstate"` (needs the same lineage and an equal or higher serial, which is why a restore after other writes may need `-force`; confirm nobody else wrote in between).
- Applied infrastructure changes are not reverted by restoring state; they must be undone in code. Restoring state after a real `apply` makes Terraform forget what exists.

## Troubleshooting

| Symptom                                                                             | Cause and fix                                                                                                     |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Error: state snapshot was created by Terraform vX, which is newer than current vY` | Someone applied with a newer CLI. Upgrade your CLI; pin `required_version` and use one version in CI and locally. |
| `plan` wants to create everything                                                   | Wrong backend config or prefix, or an empty state. Check `terraform init -reconfigure` output and the `prefix`.   |
| `Error 412` or `conditionNotMet` on state write                                     | Concurrent write. Re-run once the other run has finished; check for a second pipeline.                            |
| `Cannot import non-existent remote object`                                          | Wrong ID format or project. Check the resource's import section in the provider docs.                             |
| Import succeeded but plan shows forced replacement                                  | Code differs on an immutable attribute. Fix the code to match, do not apply.                                      |
| Secrets visible in state backups                                                    | Expected: state holds them. Restrict the bucket, enable encryption and keep backups out of tickets and chat.      |

If recovery touched production infrastructure, record it in the change log and follow [[production-change-checklist]].
