---
title: OpenTofu migration notes for GCS-backed Terraform
description: "A gated per-workspace move from Terraform to OpenTofu with a GCS backend: compatibility checks, state backup, CI image changes, validation and rollback."
type: guide
tags:
  - tools
  - terraform
  - gcp
  - ci-cd
  - reliability
created: 2026-10-19
modified: 2026-10-19
draft: false
---

[[terraform-vs-opentofu]] compares the two tools and has a short Migration section. This note extends that section into a procedure for a team whose state lives in a GCS bucket: what to check first, how to take a recoverable copy of state, how to move one workspace at a time behind gates, and how to go back. It assumes you have already decided to migrate. If you have not, read the comparison first.

> [!info] Not checked against current releases
> Version compatibility, state-format details, registry behaviour and command output were not checked when this note was written, and no migration was run to produce it. Confirm everything against the current OpenTofu migration guide and release notes, and rehearse on a copy of the state first.

## Scope

- In scope: moving a Terraform root module with a GCS backend to OpenTofu, one state at a time, with CI and pre-commit changes.
- Out of scope: choosing the tool, rewriting modules, and state layout design ([[terraform-module-and-state-layout]]). Workspace or directory structure choices are in [[terragrunt-vs-terraform-workspaces]].
- Principle: **never mix tools on one state.** Once OpenTofu has written to a state, treat it as OpenTofu's. A given state is applied by exactly one tool at any moment, and only one workspace changes at a time.

## Compatibility check

Do this before touching any state, and write down the answers.

1. **Terraform version ceiling.** OpenTofu was forked from a specific Terraform release and keeps compatibility with the state and configuration of that line. A state last written by a newer Terraform version may not be readable by OpenTofu, because state format and feature changes can be one-way. Find the Terraform version that last applied each state (the `terraform_version` field in the state) and compare it with the compatibility statement in the current OpenTofu migration guide. If the state is newer than the supported point, do not attempt an in-place migration; resolve it per the guide first.
2. **Language features.** Features introduced in Terraform after the fork point may not exist in OpenTofu, and OpenTofu has features Terraform lacks (for example state encryption). Search your code for newly adopted syntax and check each one.
3. **Providers.** Providers are resolved from a registry address. OpenTofu uses its own registry by default, and addresses such as `hashicorp/google` are mapped. Confirm that every provider and module source you use resolves, including private modules and anything pinned to specific versions. Check the current docs for how provider addresses behave.
4. **Backend.** The GCS backend is supported by both tools. Check the backend options you use against the OpenTofu backend documentation.
5. **Ecosystem.** Linters, `terraform-docs`, policy checks, Atlantis or other automation, Terragrunt, IDE plugins and pre-commit hooks must work with the new binary. See [[terraform-plan-policy-checks]] and [[terraform-testing]] for the checks that sit around the tool.
6. **Licence and support.** Your organisation's view on licences and vendor support is a decision input; it is covered in the comparison note.

## Preconditions

Do not start until all of these hold for the workspace in question.

- **Clean plan.** `terraform plan -detailed-exitcode` exits 0 on the current code: no pending changes and no drift. Migrating on top of unresolved drift mixes two problems.
- **Versioned bucket.** The state bucket has object versioning enabled, so every write creates a recoverable generation. Verify, do not assume.
- **Frozen applies.** Pause the pipeline and announce a freeze for the workspace: no applies, no manual changes, no concurrent branches merging infrastructure changes.
- **Locking works.** GCS locks via a lock object. Confirm that no stale lock exists.
- **Rollback plan agreed.** The pinned Terraform version and the way to restore the state are written down (below).
- **A rehearsal state.** Copy a non-production state into a scratch bucket and run the whole procedure against it first.

```bash title="check that versioning is on"
gcloud storage buckets describe gs://example-tfstate \
  --format='value(versioning.enabled)'
# expect: True
```

## Per-workspace steps with gates

Variables first, so each command is copy-pasteable:

```bash title="variables"
BUCKET=example-tfstate
PREFIX=envs/stage          # the backend prefix of this root module
WORKSPACE=default
STATE="gs://${BUCKET}/${PREFIX}/${WORKSPACE}.tfstate"
```

### Step 1: Back up state and record the generation

```bash title="copy and list generations"
gcloud storage cp "${STATE}" "./backup-$(date +%F).tfstate"

# -a lists all object generations; note the current one
gcloud storage ls -a "${STATE}"
```

Store the local copy somewhere access-controlled, not in Git: state can contain secrets. Write the generation number you will restore to into the change ticket.

**Gate 1:** the backup file opens as JSON, and the recorded generation matches the live object.

### Step 2: Record the baseline with the current tool

```bash
terraform version
terraform init
terraform plan -detailed-exitcode -out=baseline.tfplan; echo "exit=$?"
```

**Gate 2:** exit code 0. If it is 2, there are pending changes; apply or fix them first and restart. If it is 1, something is broken; stop.

### Step 3: Initialise OpenTofu against the same backend

Work in a clean working directory or clear `.terraform/` so provider binaries from the old tool are not reused.

```bash
rm -rf .terraform
tofu version
tofu init
```

Plain `tofu init` honours the existing `.terraform.lock.hcl`, so provider versions stay pinned and only the registry changes. Use `-upgrade` only if init fails on the lock file, and then review every version change in the diff; hashes may be added for OpenTofu's registry, which is expected. Prefer pinned constraints so this step changes the registry, not the versions.

**Gate 3:** `tofu init` succeeds, and the provider versions in the lock file are the ones you expect.

### Step 4: Plan with OpenTofu

```bash
tofu plan -detailed-exitcode; echo "exit=$?"
```

**Gate 4:** exit code 0, meaning no changes. A non-empty plan after a pure tool switch is a finding: investigate (a provider version change, a default that moved, or an unsupported attribute) and do not apply. Exit code 2 here means stop and read the plan.

### Step 5: Make the first write deliberate

A plain `tofu plan` does not write state. The first write happens at the first `apply` or `refresh`, so the cleanest first apply is a harmless one: a no-op, or a tiny reviewed change such as a label.

```bash
tofu apply
```

**Gate 5:** the apply succeeds, `tofu plan -detailed-exitcode` exits 0 afterwards, and the state's `terraform_version` field now reflects the new tool. List generations again with `gcloud storage ls -a "${STATE}"` and confirm a new generation appeared.

### Step 6: Switch the pipeline for this workspace only

Change the CI job for this workspace to use the OpenTofu image and commands (next section), unfreeze, and watch a couple of normal changes. Leave the other workspaces on Terraform until this one has been stable for an agreed period.

**Gate 6:** at least one real change has been planned, reviewed and applied by the pipeline with OpenTofu, with no unexpected diff.

Then repeat for the next workspace, starting with the least critical (dev), and finishing with production.

## CI and pre-commit changes

- **Image.** Replace the Terraform image or setup step with a pinned OpenTofu one, pinned by version and digest. Keep Terraform available in the same pipeline during the migration, selected by a per-workspace variable, so rollback is a variable change.
- **Commands.** `terraform` becomes `tofu` in plan, apply, fmt and validate jobs. If you use wrappers (Terragrunt, Atlantis), set their binary option; check each tool's documentation for the setting.
- **Plan exit codes.** Use `-detailed-exitcode` in CI plan jobs: 0 means no changes, 2 means changes, 1 means error. Fail the job on 1, and gate on 0 for the migration checks.
- **Lock file.** Commit the regenerated `.terraform.lock.hcl`. Teams on several platforms may need hashes for each: run `tofu providers lock -platform=linux_amd64 -platform=darwin_arm64` as appropriate.
- **Pre-commit.** Update hooks that call the binary, such as `terraform fmt` and `validate` wrappers, to use `tofu`, and verify that formatters and linters you use support it.
- **Policy checks.** Conftest and plan-JSON checks read the output of `show -json`; run `tofu show -json` and compare the shape with what your policies expect.
- **Caches.** Plugin caches keyed on the tool name or version need a new key.

## Validation

Define success in exit codes and state, not in feelings.

| Exit code | Meaning of `plan -detailed-exitcode` | Action                               |
| --------- | ------------------------------------ | ------------------------------------ |
| 0         | Succeeded, no changes                | Gate passes                          |
| 1         | Error                                | Stop; do not apply                   |
| 2         | Succeeded, changes present           | Stop during migration; read the plan |

Additional checks after each workspace:

```bash
tofu state list | wc -l          # same resource count as before
tofu output                      # outputs unchanged
tofu validate
```

Compare the resource count and outputs with the pre-migration values you recorded in step 2. Check that downstream consumers of the outputs (remote state data sources in other roots) still read them, and that those roots, which may still run Terraform, can read a state written by OpenTofu. Mixed-tool reads of remote state are a place to test, not assume.

## Rollback

Rollback depends on whether OpenTofu has written to the state.

**Before the first write (steps 1 to 4).** Nothing changed in the bucket. Delete the `.terraform` directory, return the pipeline to the pinned Terraform version, and continue.

**After OpenTofu has written (step 5 onwards).** Restore the state object to the generation you recorded, then return to the pinned Terraform:

```bash
# generation number from `gcloud storage ls -a`
GEN=1760000000000000
gcloud storage cp "${STATE}#${GEN}" "${STATE}"
```

Check the exact generation-addressing syntax with `gcloud storage cp --help` before you need it; rehearse the restore in the scratch bucket. After the restore:

```bash
rm -rf .terraform
terraform init
terraform plan -detailed-exitcode; echo "exit=$?"
```

Expect exit 0. If you made real infrastructure changes with OpenTofu between the backup and the restore, restoring an old state loses knowledge of them: the plan will want to recreate or re-import resources. In that case do not blindly restore; follow [[terraform-state-recovery]] and reconcile with `import` blocks. This is why the migration apply is a no-op or tiny change, and why you freeze other changes until the workspace is proven.

The bucket's object versioning documentation explains generations and retention: see the Sources.

## Troubleshooting

- **`tofu init` cannot find a provider or module.** The source address does not resolve in the registry OpenTofu uses. Check the address, configure a mirror, or vendor the provider.
- **State version errors.** The state was written by a Terraform newer than OpenTofu supports. Stop; do not edit the state by hand. Follow the OpenTofu guide for the version situation, or stay on Terraform for that workspace.
- **Lock error (`Error acquiring the state lock`).** Another run holds the lock, or a crashed run left it. Confirm no job is running before using `force-unlock`, and use the lock ID from the error.
- **Plan wants changes after the switch.** Do not apply. Diff the plan against the baseline, check provider versions in the lock file, and look for resources whose defaults changed between provider releases.
- **Lock file churn.** Different hashes per platform. Generate with `providers lock` for every platform your team and CI use.
- **Backend authentication.** CI that used Application Default Credentials for the state bucket should keep working; if not, check the service account's roles on the bucket and Workload Identity Federation settings ([[iam-groups-and-ci-workload-identity-federation]]).

## Related

- [[terraform-vs-opentofu]]
- [[terraform-state-recovery]]
- [[terraform-module-and-state-layout]]
- [[terraform-testing]]
- [[terragrunt-vs-terraform-workspaces]]

## Sources

- [OpenTofu migration guide](https://opentofu.org/docs/intro/migration/)
- [Terraform GCS backend](https://developer.hashicorp.com/terraform/language/backend/gcs)
- [Cloud Storage object versioning](https://cloud.google.com/storage/docs/object-versioning)
