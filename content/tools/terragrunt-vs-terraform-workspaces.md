---
title: Terragrunt vs Terraform workspaces for multi-environment GCP
description: When CLI workspaces stop scaling for dev, stage and prod on GCP, what plain directories give you, and when Terragrunt's extra layer is worth it.
type: tool
tags:
  - tools
  - terraform
  - gcp
  - ci-cd
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Running the same Terraform code for dev, stage and prod raises the same question in every team: how do you keep three states apart without copying code? Three answers exist: CLI workspaces, separate directories, and a wrapper such as Terragrunt. This note compares them for GCP with a GCS backend. The general layout rules are in [[terraform-module-and-state-layout]]; its "Workspaces or directories" section has the decision table, which this note does not repeat.

> [!info] Not checked against current releases
> Terragrunt and Terraform behaviour, command syntax and defaults were not checked when this note was written. Confirm them in the current documentation.

## Short answer

Use plain directories per environment, with shared modules, for most teams. Use workspaces only for short-lived copies of the same environment (feature stacks, ephemeral tests). Add Terragrunt when the number of environments and units makes repeated backend and provider boilerplate the main source of errors and you accept another tool in the chain. Terragrunt wraps Terraform or OpenTofu; see [[terraform-vs-opentofu]].

## Three options: workspaces, directories, Terragrunt

| Option         | State separation                       | Code duplication                      | Main risk                           |
| -------------- | -------------------------------------- | ------------------------------------- | ----------------------------------- |
| CLI workspaces | One backend config, many state objects | None                                  | Applying in the wrong workspace     |
| Directories    | Distinct backend config per directory  | Small root modules per environment    | Drift between copies                |
| Terragrunt     | Generated backend per unit             | Config in a hierarchy, modules shared | Extra tool and abstraction to learn |

## At a glance

| Concern                               | Workspaces                    | Directories                   | Terragrunt                 |
| ------------------------------------- | ----------------------------- | ----------------------------- | -------------------------- |
| Per-environment backend               | Same bucket and prefix rule   | Explicit, different if needed | Generated from a root file |
| Different provider or project per env | Awkward                       | Natural                       | Natural                    |
| Review of what changes                | Shared code, easy to miss env | Diff per directory            | Diff per unit              |
| Dependencies between stacks           | `terraform_remote_state`      | `terraform_remote_state`      | `dependency` blocks        |
| Onboarding cost                       | Low                           | Low                           | Medium                     |
| Guardrails                            | Few                           | Directory permissions in CI   | Same, plus run ordering    |

## Workspaces and their sharp edges (one backend config, `terraform.workspace` conditionals, wrong-workspace apply)

A workspace is a named state within the same configuration and backend. With the GCS backend, each workspace is a separate object under the prefix (`<prefix>/<workspace>.tfstate`).

Sharp edges:

- **One backend configuration.** All workspaces use the same bucket, so prod state sits next to dev state with the same IAM. You cannot give prod its own bucket or its own project without leaving workspaces.
- **Conditionals on `terraform.workspace`** (`count = terraform.workspace == "prod" ? 3 : 1`) accumulate until the code is a maze of environment special cases.
- **Wrong-workspace apply.** The selected workspace is local state of your working directory. An engineer who selected `prod` yesterday and forgot can apply a dev change to production. There is no visible cue in the code.
- The workspace is not part of the plan file name or the review. Reviewers see code that is identical for all environments.

If you use workspaces, guard them in CI:

```bash title="guard-workspace.sh"
set -euo pipefail
EXPECTED="${EXPECTED_WORKSPACE:?set EXPECTED_WORKSPACE}"
unset TF_WORKSPACE # TF_WORKSPACE would make "workspace show" echo itself and always pass
ACTUAL="$(terraform workspace show)"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "workspace mismatch: expected $EXPECTED, got $ACTUAL" >&2
  exit 1
fi
```

## The Terragrunt model (root config, `remote_state`, `generate`, dependencies)

Terragrunt keeps the backend, provider and common inputs in one root file and each environment/unit as a small `terragrunt.hcl` that points to a Terraform module.

```text title="layout"
live/
  terragrunt.hcl            # root: remote_state, generate provider
  dev/
    network/terragrunt.hcl
    gke/terragrunt.hcl
  prod/
    network/terragrunt.hcl
    gke/terragrunt.hcl
modules/
  network/
  gke/
```

```hcl title="live/terragrunt.hcl"
locals {
  # Derived from the path: live/<env>/<unit>
  env  = split("/", path_relative_to_include())[0]
  unit = split("/", path_relative_to_include())[1]
}

remote_state {
  backend = "gcs"
  config = {
    bucket   = "example-tfstate-${local.env}"
    prefix   = "${local.unit}"
    project  = "example-project-${local.env}"
    location = "europe-west1"
  }
  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }
}

generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
provider "google" {
  project = "example-project-${local.env}"
  region  = "europe-west1"
}
EOF
}
```

```hcl title="live/prod/gke/terragrunt.hcl"
include "root" {
  path = find_in_parent_folders()
}

terraform {
  source = "../../../modules//gke"
}

dependency "network" {
  config_path = "../network"
}

inputs = {
  network    = dependency.network.outputs.network_name
  subnetwork = dependency.network.outputs.subnet_name
  node_count = 3
}
```

The local variables above assume the path layout; adapt the expressions to yours and test them with `terragrunt render-json` or the equivalent in your version. The block names and functions have evolved across Terragrunt releases, so check the current docs.

Running several units:

```bash title="run-all.sh"
# Older releases: terragrunt run-all plan
# Newer releases moved to: terragrunt run --all plan
# The syntax changed across releases; check the documentation for the version you pin.
cd live/dev
terragrunt run-all plan
```

Always plan before apply, and pin the Terragrunt and Terraform versions in the CI image.

## GCS state layout under each

- **Workspaces**: `gs://example-tfstate/platform/default.tfstate`, `.../dev.tfstate`, `.../prod.tfstate`. One bucket, one IAM policy.
- **Directories**: a backend block per directory, free to point at a different bucket per environment: `gs://example-tfstate-prod/gke/default.tfstate`.
- **Terragrunt**: the same as directories, but the backend block is generated, so the bucket and prefix cannot be mistyped.

Separate buckets (ideally separate projects) per environment let you grant prod state access only to the prod pipeline, which is the real benefit. See [[environment-separation-on-gcp]].

## CI: plan per directory or unit

Plan only what changed and run each plan with the credentials of that environment:

- Detect changed directories (`git diff --name-only origin/main...HEAD`) and run `terraform plan` in each; or for Terragrunt, plan the changed units and their dependants.
- Save the plan file as an artefact and apply exactly that plan after approval.
- Use separate CI identities per environment; production apply on a protected branch only. Self-hosted PR automation options are compared in [[atlantis-vs-spacelift-vs-hcp-terraform]].

## Failure modes

- **Wrong workspace applied** (workspaces): compare `terraform workspace show` against an expected value held in a separate CI variable (with `TF_WORKSPACE` unset), or select the workspace explicitly through `TF_WORKSPACE` in CI so it is never implicit.
- **Copies drift** (directories): move shared logic to modules and keep environment roots to a few lines; a CI check can diff the roots.
- **Dependency cycles or outdated outputs** (Terragrunt): a unit planned against stale dependency outputs. Apply in order, and use mock outputs only for planning, never for apply.
- **State lock left behind**: a cancelled job leaves a lock object in the bucket. Confirm no run is active, then `terraform force-unlock <id>`; see [[terraform-state-recovery]].
- **Generated files committed or ignored inconsistently**: decide and add `backend.tf`/`provider.tf` to `.gitignore` for Terragrunt.

## Rollback via bucket object versioning

Enable object versioning on every state bucket. To roll back a state file, list the generations, copy the wanted generation over the live object, and plan to confirm no unexpected diff:

```bash title="state-rollback.sh"
gcloud storage ls -a gs://example-tfstate-prod/gke/default.tfstate
gcloud storage cp "gs://example-tfstate-prod/gke/default.tfstate#<generation>" \
  gs://example-tfstate-prod/gke/default.tfstate
terraform plan -detailed-exitcode
```

Rolling back state does not roll back real infrastructure; it only changes what Terraform believes. Details are in [[terraform-state-recovery]].

## When to choose which

- **Workspaces** for ephemeral duplicates of one environment with identical settings.
- **Directories** for a handful of environments where clarity beats DRY.
- **Terragrunt** for many environments or units, strict backend uniformity, and dependency ordering across stacks.

## Recommendation

Start with directories and shared modules. Introduce Terragrunt when the boilerplate across more than a few units causes real mistakes or review fatigue, and pin its version alongside Terraform's. Reserve workspaces for temporary stacks and guard them in CI. Re-evaluate if Terraform gains first-class multi-environment features or if you move to OpenTofu, where the same options apply.

## Related

- [[terraform-module-and-state-layout]]
- [[terraform-vs-opentofu]]
- [[terraform-state-recovery]]
- [[environment-separation-on-gcp]]
- [[atlantis-vs-spacelift-vs-hcp-terraform]]

## Sources

- [Terraform workspaces](https://developer.hashicorp.com/terraform/language/state/workspaces)
- [Terraform GCS backend](https://developer.hashicorp.com/terraform/language/backend/gcs)
- [Terragrunt documentation](https://terragrunt.gruntwork.io/docs/)
