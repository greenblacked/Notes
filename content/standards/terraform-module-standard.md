---
title: Terraform module standard
description: Required files, input and output contracts, version constraints, lock file rules, testing and breaking-change rules for Terraform modules we publish or use.
type: standard
tags:
  - standards
  - terraform
  - supply-chain
  - delivery
created: 2026-10-19
modified: 2026-10-19
draft: false
---

A shared Terraform module is a contract between its author and every root module that calls it. Without rules, the contract is broken by accident: a variable is renamed, a default changes a plan, a resource moves inside the module and a consumer's next apply destroys a database. This standard sets the file layout, the input and output contract, version constraints, the lock file policy, the tests and the rules for what counts as a breaking change. The repository and state layout lives in [[terraform-module-and-state-layout]]; here only the rules for the module itself.

## Scope

Two kinds of configuration exist, and the rules differ.

- **Shared modules** are called by other configurations: a network module, a GKE cluster module, a project factory. They are versioned and published by Git tag (see ADR [[adr/0034-terraform-modules-versioned-by-git-tag]]).
- **Root modules** are the configurations we run with `terraform apply`. They own state, the backend and the provider configuration.

The distinction drives three rules: provider blocks and the lock file belong to root modules, version constraints belong to both, and breaking-change rules belong to shared modules.

> [!info] Terraform and OpenTofu
> The syntax below is for Terraform. Compatibility with OpenTofu is covered in [[terraform-vs-opentofu]]. Test-framework syntax and CLI flags change between versions; check the current docs for the version you run.

## Required files and layout

Every shared module has the following, following the [standard module structure](https://developer.hashicorp.com/terraform/language/modules/develop/structure).

```text title="modules/gke-cluster/"
modules/gke-cluster/
  main.tf
  variables.tf
  outputs.tf
  versions.tf
  README.md
  examples/
    basic/
      main.tf
  tests/
    basic.tftest.hcl
```

| File           | Content                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `main.tf`      | Resources and data sources. Split into `network.tf`, `iam.tf` and so on when `main.tf` grows past a screen or two |
| `variables.tf` | Every input, with type, description and validation                                                                |
| `outputs.tf`   | Every output, with a description                                                                                  |
| `versions.tf`  | `required_version` and `required_providers`                                                                       |
| `README.md`    | Purpose, a usage example and the generated inputs and outputs tables                                              |
| `examples/`    | At least one runnable example, planned in CI                                                                      |
| `tests/`       | `.tftest.hcl` files                                                                                               |

Do not commit `.terraform/`, plan files or local state. Do not commit `terraform.tfvars` with real values inside a shared module. Keep one concern per module; if the README needs two usage sections for unrelated things, split it.

## Input and output contract

Inputs and outputs are the public interface. Treat each as an API.

1. **Every variable has a `type` and a `description`.** An untyped variable (`any`) is allowed only for deliberately generic pass-through and needs a comment.
2. **Use `validation` where it catches a mistake at plan time** rather than at the cloud API: an allowed set of values, a name pattern, a CIDR that parses.
3. **Secrets are `sensitive = true`.** This hides the value from plan and apply output; it does not remove it from state, which is why state buckets are encrypted and access-controlled (see ADR [[adr/0032-terraform-state-in-gcs-per-environment]]).
4. **No provider blocks in shared modules.** A module declares which providers it needs in `required_providers`, and the root module configures them (region, project, credentials, aliases). A provider block inside a module prevents the caller from removing the module cleanly and from using `count` or `for_each` on it.
5. **Defaults are safe and boring.** A default must not create public exposure, disable encryption or open a firewall. If a safe default does not exist, make the variable required (no default).
6. **Outputs are documented and stable.** Every output has a `description`. Output only what callers need; each output becomes a contract. Mark outputs that contain secrets `sensitive = true`.
7. **Prefer objects over long lists of loose variables** for related settings, with `optional()` attributes and defaults, so adding a field is not a breaking change.

```hcl title="modules/gke-cluster/variables.tf"
variable "name" {
  type        = string
  description = "Cluster name. Lowercase letters, digits and hyphens, at most 40 characters."

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,39}$", var.name))
    error_message = "name must start with a letter and contain only lowercase letters, digits and hyphens (max 40)."
  }
}

variable "release_channel" {
  type        = string
  description = "GKE release channel. Check the current GKE docs for the channels available."
  default     = "REGULAR"

  validation {
    condition     = contains(["RAPID", "REGULAR", "STABLE"], var.release_channel)
    error_message = "release_channel must be RAPID, REGULAR or STABLE."
  }
}

variable "admin_password" {
  type        = string
  description = "Initial admin password for the bundled add-on. Supply from Secret Manager, never in a tfvars file."
  sensitive   = true
  default     = null
}
```

```hcl title="modules/gke-cluster/outputs.tf"
output "cluster_id" {
  description = "Fully qualified cluster ID. Stable across minor versions of this module."
  value       = google_container_cluster.this.id
}
```

## Version constraints

Constraints say which Terraform and provider versions the module has been tested with. They protect consumers from a provider release that changes behaviour.

- **`required_version`** uses a lower bound and an upper bound on the major: `">= 1.6.0, < 2.0.0"`. The lower bound is the oldest version the module's tests run on.
- **Providers in a shared module use `~>`** (pessimistic) on the major version, for example `~> 5.30`, which allows compatible updates and blocks the next major. Do not use an open `>=` in a shared module, because the next provider major can break it silently.
- **Exact pins only for known-breaking providers.** If a provider has a release that breaks the module and no fix is available, pin an exact version and leave a comment with the issue link and the date to revisit.
- **Consumers pin the module source to a tag**, never to a branch: `?ref=v2.3.1`. A branch reference makes `terraform init` non-reproducible.

```hcl title="modules/gke-cluster/versions.tf"
terraform {
  required_version = ">= 1.6.0, < 2.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.30"
    }
  }
}
```

The version numbers above are examples. Choose them from what your module's tests pass on, and check the provider's release notes before moving a bound.

```hcl title="envs/prod/main.tf"
module "cluster" {
  source = "git::https://gitlab.example.com/platform/tf-modules.git//gke-cluster?ref=v2.3.1"

  name = "prod-eu"
}
```

## Lock file policy

The dependency lock file `.terraform.lock.hcl` records the provider versions and checksums chosen at `init`. See the [dependency lock file docs](https://developer.hashicorp.com/terraform/language/files/dependency-lock).

- **Root modules commit `.terraform.lock.hcl`.** It is what makes two applies of the same commit use the same provider binaries.
- **Shared modules do not commit it.** The root module's lock file decides which provider version is used; a lock file inside a module is ignored by callers.
- **Record hashes for every platform that runs Terraform**: the developer laptops and the CI runners. Without them, `init` works on one machine and fails on another with a checksum mismatch.

```bash title="Add multi-platform hashes"
terraform providers lock \
  -platform=linux_amd64 \
  -platform=darwin_arm64
```

Add the platforms you actually use (for example `linux_arm64` for ARM runners). Check the current `providers lock` docs for flags, including how to point at a mirror.

- **CI runs `init` in read-only lock mode**, so a drifting lock file fails the pipeline instead of being rewritten:

```bash title="CI init"
terraform init -lockfile=readonly
```

- **Upgrade providers in a dedicated merge request.** `terraform init -upgrade` changes the lock file; that change gets its own MR with the plan output for every environment that uses the root module, so the provider change is reviewed on its own and not buried in a feature. Automated update tools open these MRs under [[dependency-update-policy]].

## Module versioning and breaking changes

Version shared modules with SemVer tags (`v2.3.1`). The module's public interface is its inputs, outputs and the **resource addresses** inside it, because the addresses decide what Terraform treats as the same object.

A change is **breaking and forces a major version** when it:

- removes or renames a variable or output;
- adds a required variable (one without a default);
- tightens a validation so inputs that were valid now fail;
- changes a default in a way that **alters an existing plan** (a different machine type, a different region, a toggled feature);
- **changes a resource address** (renames a resource, moves it into a nested module, adds `count` or `for_each`) **without a `moved` block**, because Terraform plans a destroy and create;
- raises the minimum Terraform or provider major version.

A change is **minor** when it adds an optional variable with a default that leaves the plan unchanged, adds an output, or adds an optional resource that is off by default. A change is a **patch** for a bug fix with no interface change.

Use a `moved` block to rename or restructure without a destroy and recreate, and keep it for at least one major version so that consumers who upgrade late still get it. See [refactoring](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring).

```hcl title="modules/gke-cluster/moved.tf"
moved {
  from = google_container_node_pool.default
  to   = google_container_node_pool.primary
}

moved {
  from = google_service_account.nodes
  to   = module.iam.google_service_account.nodes
}
```

The verification is a plan against a copy of a real consumer: it must show moves and no destroy for the renamed object. Review it as you would a database migration; the rollback is to pin the consumer back to the previous tag, which works only if no apply ran with the new code.

> [!warning] Moves are one-way once applied
> After an apply records the new addresses in state, pinning the consumer back to the old module tag makes Terraform see the old addresses as missing. Treat a refactor release like a state migration: plan first, apply in a window, and keep the previous tag available.

## Tests and examples

- **Every shared module has an example** in `examples/` that CI runs `init`, `validate` and `plan` against, using a throwaway project or mocked providers.
- **`terraform test` with `.tftest.hcl` files** covers the module's contract: validation rejects bad input, outputs have the expected shape, and a plan with defaults creates the expected resources. Plan-mode tests with `mock_provider` (check the Terraform version that supports it) need no credentials; without a mock, the real provider is configured and needs them; apply-mode tests create real resources and belong in a scheduled job with a sandbox project. The test framework's syntax and command-line flags depend on the Terraform version; check the current docs for yours.

```hcl title="modules/gke-cluster/tests/basic.tftest.hcl"
mock_provider "google" {}

run "rejects_bad_name" {
  command = plan

  variables {
    name = "Bad_Name"
  }

  expect_failures = [var.name]
}

run "defaults_plan" {
  command = plan

  variables {
    name = "test-eu"
  }

  assert {
    condition     = var.release_channel == "REGULAR"
    error_message = "release_channel default changed; this is a breaking change."
  }
}
```

The second test turns "a default changed" into a failing test, so it cannot happen without someone editing the test and, with it, bumping the major. More patterns are in [[terraform-testing]], and policy checks on the resulting plan are in [[terraform-plan-policy-checks]].

```bash title="Module CI"
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
terraform test
terraform -chdir=examples/basic init -backend=false
terraform -chdir=examples/basic validate
```

## Generated docs

Write `README.md` by hand for purpose and usage, and generate the inputs and outputs tables with [terraform-docs](https://terraform-docs.io/) so they cannot drift from the code. Run it in a pre-commit hook and verify in CI that the generated section is unchanged:

```bash title="Docs check"
terraform-docs markdown table --output-file README.md --output-mode inject modules/gke-cluster
git diff --exit-code -- modules/gke-cluster/README.md
```

Check the current terraform-docs docs for the exact flags and the injection markers it expects in the README.

## Reviewer checklist

- [ ] All required files exist; no `.terraform/`, state or plan files committed.
- [ ] Every variable has `type`, `description`, and `validation` where a bad value is likely; secrets are `sensitive`.
- [ ] No `provider` block in a shared module; providers are in `required_providers` with `~>`.
- [ ] `required_version` has both bounds.
- [ ] Lock file committed in root modules only, with the hashes for every platform in use; CI uses `-lockfile=readonly`.
- [ ] Any renamed or moved resource has a `moved` block, and a plan against a consumer shows no destroy.
- [ ] The release tag matches the change: removal, rename, required input, plan-altering default or address change means a major.
- [ ] A test covers the new or changed behaviour; an example still plans.
- [ ] README tables are generated and current.
- [ ] Defaults are safe: no public exposure, encryption on.

## Sources

- [Terraform: Develop modules](https://developer.hashicorp.com/terraform/language/modules/develop)
- [Terraform: Standard module structure](https://developer.hashicorp.com/terraform/language/modules/develop/structure)
- [Terraform: Input variables](https://developer.hashicorp.com/terraform/language/values/variables)
- [Terraform: Dependency lock file](https://developer.hashicorp.com/terraform/language/files/dependency-lock)
- [Terraform: providers lock command](https://developer.hashicorp.com/terraform/cli/commands/providers/lock)
- [Terraform: Tests](https://developer.hashicorp.com/terraform/language/tests)
- [Terraform: Refactoring modules](https://developer.hashicorp.com/terraform/language/modules/develop/refactoring)
- [terraform-docs](https://terraform-docs.io/)

## Related

- [[terraform-module-and-state-layout]]: repository, state and environment layout.
- [[terraform-testing]]: test strategy in depth.
- [[terraform-plan-policy-checks]]: policy gates on the plan.
- [[code-review]]: review practice for infrastructure code.
- [[terraform-vs-opentofu]]: compatibility between the two tools.
- [[dependency-update-policy]]: how provider and module updates are handled.
