---
title: Plain root modules, no Terragrunt
description: Environments are plain Terraform root directories calling versioned modules, and the Terragrunt wrapper is not adopted, with a defined reopen trigger.
type: adr
tags:
  - adr
  - terraform
  - tools
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0033
---

## Context

Several environments and layers use the same modules with small differences: backend bucket, project ID, region and sizing. The repetition is mostly `backend` blocks, provider blocks and a handful of variables. Terragrunt is a popular wrapper that removes this boilerplate, and the question comes up each time a new environment is added.

The costs of a wrapper are real. It is one more tool to install, pin and upgrade in every runner image and laptop. It changes the plan and apply path, so the plan-policy gate in [[0035-terraform-plan-policy-gate-and-ci-only-apply]] has to understand it. Engineers who know Terraform need extra onboarding, and error messages come from two layers.

## Decision

We use **plain Terraform root modules** for every environment and layer, with no Terragrunt.

- Each environment is a directory (for example `envs/prod/gke/`) holding only a backend block, provider configuration, a module call pinned by tag (see [[0034-terraform-modules-versioned-by-git-tag]]) and a `terraform.tfvars` file.
- Logic lives in versioned modules, never in the environment directory. A root module over a size we can review in one sitting is a signal to extract a module.
- Backend settings follow [[0032-terraform-state-in-gcs-per-environment]]: the bucket differs per environment, the prefix per layer.
- Boilerplate is accepted. A linter checks that the backend blocks differ only in the expected fields.

```hcl title="envs/prod/gke/main.tf"
module "gke" {
  source = "git::https://gitlab.example.com/platform/tf-modules.git//gke?ref=v1.4.0"

  project_id = "example-prod-platform"
  region     = var.region
  name       = "prod-1"
}
```

**Reopen trigger.** Revisit this decision if the duplicated boilerplate across environments grows past what a reviewer can check by diff (the platform owner judges this at the quarterly tooling review), or if dependency ordering between layers becomes a recurring source of failed applies that CI stage ordering cannot solve.

> [!info] Claims not checked against current docs
> Terragrunt's current feature set and licence, and whether Terraform or OpenTofu native features have since closed the gaps Terragrunt addresses. Check the Terragrunt documentation before reopening.

## Consequences

Easier:

- Anyone who knows Terraform can read and change any environment.
- The plan and policy path is identical everywhere, so [[terraform-plan-policy-checks]] has one shape to test.
- Fewer tools in the runner image reduces supply-chain surface.

Harder:

- Adding an environment means copying a small directory and editing a few lines. Copy mistakes (a wrong bucket or prefix) are possible, so the linter and a review checklist are required.
- Cross-layer dependencies are explicit data sources or published outputs and CI job ordering, not a dependency graph in a wrapper.
- Global changes (for example a provider constraint) touch every environment directory, though a bot MR makes that routine.

## Alternatives considered

- **Terragrunt.** Removes boilerplate and offers dependency orchestration. Rejected for now for the tooling and onboarding cost above; the reopen trigger defines when the balance changes.
- **Workspaces with one root module.** Share a backend and credentials across environments, which defeats the isolation in [[0032-terraform-state-in-gcs-per-environment]]. Rejected.
- **Generated environment directories from a template script.** Moves the boilerplate into a generator we would have to own. Rejected; revisit alongside Terragrunt.

## Validation

```bash title="validate-root-modules.sh"
set -euo pipefail

# No Terragrunt files in the repository (expected: no output)
find . -name 'terragrunt.hcl' -not -path './.git/*'

# Every module call is pinned by tag (expected: no output)
grep -rn --include='*.tf' 'source *= *"git::' envs/ | grep -v 'ref=v[0-9]' || true

# Backend blocks differ only in bucket and prefix: print them for review
grep -rn --include='backend.tf' -A3 'backend "gcs"' envs/
```

## References

- Terraform modules: https://developer.hashicorp.com/terraform/language/modules
- Terragrunt documentation: https://terragrunt.gruntwork.io/docs/

Related notes:

- [[terraform-module-and-state-layout]]
- [[environment-separation-on-gcp]]
- [[0032-terraform-state-in-gcs-per-environment]]
- [[0034-terraform-modules-versioned-by-git-tag]]
