---
title: Terraform modules released by Git tag, all versions pinned
description: Modules live in their own repository with SemVer tags, and consumers pin module refs, the Terraform version, providers and the dependency lock file.
type: adr
tags:
  - adr
  - terraform
  - supply-chain
  - delivery
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0034
---

## Context

Modules referenced from `main`, or providers allowed to float to the newest release, mean that `terraform plan` can change with no change in the repository. A plan that was reviewed on Monday differs from the apply on Tuesday, and a breaking provider release can fail every pipeline at once. Unpinned dependencies are also a supply-chain exposure: a compromised upstream release is picked up automatically.

## Decision

Everything that influences a plan is pinned and changes only through a reviewed merge request.

- **Modules** live in a dedicated repository (`platform/tf-modules`), released with annotated SemVer tags. A breaking change is a new major version. Each release has a changelog (see [[release-versioning-and-changelog-automation]]).
- **Consumers** pin an exact tag with `?ref=vX.Y.Z`, never a branch.
- **Terraform itself** is pinned with `required_version`, and the binary version used in CI is pinned in the runner image.
- **Providers** use pessimistic constraints (`~>`) in `required_providers`, and the exact selected versions and hashes are recorded in a committed `.terraform.lock.hcl`, generated for every platform that runs the code.
- **Updates** arrive as bot merge requests (see [[automated-dependency-updates]]). `terraform init -upgrade` and lock file changes ship in their own MR, apart from functional changes, so the diff is reviewable.
- **Modules are tested** before release (see [[terraform-testing]]).
- A private module registry is added only when tag-based sources stop scaling.

```hcl title="versions.tf"
terraform {
  required_version = "~> 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}
```

The version numbers above are examples of the constraint style. Choose them from the current provider release notes.

```bash title="refresh-lock-file.sh"
set -euo pipefail
terraform init -upgrade
terraform providers lock \
  -platform=linux_amd64 -platform=darwin_arm64
git add .terraform.lock.hcl
```

```hcl title="envs/prod/gke/main.tf"
module "gke" {
  source = "git::https://gitlab.example.com/platform/tf-modules.git//gke?ref=v1.4.0"
}
```

> [!info] Claims not checked against current docs
> The provider major version and Terraform version in the example, and the exact `terraform providers lock` platform flags for the runner architecture. If the OpenTofu decision in [[0031-terraform-or-opentofu]] changes the binary, the lock file semantics and registry sources need rechecking.

## Consequences

Easier:

- A plan today equals the plan tomorrow unless a commit changed it.
- Rolling back a module upgrade is reverting one `ref`.
- A suspicious upstream release does not reach production until a human reviews the bump.

Harder:

- Someone has to merge update MRs. Without automation, versions rot, so the bot is part of the decision.
- Lock files must include every platform that runs the code (CI and developer laptops), or `init` fails on the missing hashes.
- Tag discipline matters: tags are protected, and a tag is never moved or deleted after release.
- Git-sourced modules are fetched at `init`, so the Git host is a CI dependency.

## Alternatives considered

- **Floating `ref=main`.** Simple and always current, but breaks reproducibility. Rejected.
- **Private module registry from day one.** Better discovery and version-range constraints, but another service to run. Deferred until the module count justifies it.
- **Vendoring modules into each environment repo.** Pins perfectly but multiplies fixes. Rejected.

## Validation

```bash title="validate-pins.sh"
set -euo pipefail

# Git module sources without a version tag (expected: no output)
grep -rn --include='*.tf' 'source *= *"git::' . | grep -v 'ref=v[0-9]'

# Every root module has required_version and a lock file (expected: no output)
for d in $(find envs -name main.tf -exec dirname {} \;); do
  grep -q required_version "$d"/*.tf || echo "missing required_version: $d"
  [ -f "$d/.terraform.lock.hcl" ] || echo "missing lock file: $d"
done
```

## References

- Module sources: https://developer.hashicorp.com/terraform/language/modules/sources
- Dependency lock file: https://developer.hashicorp.com/terraform/language/files/dependency-lock
- Version constraints: https://developer.hashicorp.com/terraform/language/expressions/version-constraints

Related notes:

- [[terraform-testing]]
- [[release-versioning-and-changelog-automation]]
- [[automated-dependency-updates]]
- [[0013-versioned-central-ci-templates]]
- [[0033-plain-root-modules-no-terragrunt]]
