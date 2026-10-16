---
title: Terraform vs OpenTofu
description: Comparing Terraform and OpenTofu after the 2023 licence change, with state, registry, migration and a recommendation for a GCP team.
type: tool
tags:
  - tools
  - terraform
  - gcp
created: 2026-10-16
modified: 2026-10-16
draft: false
---

In August 2023 HashiCorp moved Terraform from the Mozilla Public License to the Business Source License (BSL) 1.1. A community fork, first called OpenTF and now OpenTofu, was created in response and was accepted into the Linux Foundation in September 2023. This note compares the two for a team running on GCP.

> [!warning] Facts from secondary sources
> The official OpenTofu and HashiCorp sites could not be fetched when this note was written. Dates and versions below come from secondary reporting and from memory. Confirm them on opentofu.org and in the HashiCorp licence FAQ before quoting them, especially the current feature gaps.

## Background

- **August 2023:** HashiCorp announced the change of licence for its products, including Terraform, to BSL 1.1. Existing users can still use Terraform internally; the restriction targets offering a competing commercial product.
- **September 2023:** The fork moved under the Linux Foundation, with a steering committee of vendors and contributors, and the project was named OpenTofu.
- **January 2024:** OpenTofu 1.6.0 was announced as the first stable release (reports give 9 or 10 January).
- **April 2024:** OpenTofu 1.7.0 added client-side state encryption, as reported.
- **Later:** IBM announced its acquisition of HashiCorp in 2024. Check the current licence and roadmap statements from HashiCorp rather than relying on this summary.

OpenTofu is licensed under MPL 2.0. Terraform remains source-available under BSL.

## At a glance

| Concern             | Terraform                                       | OpenTofu                                                     |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| Licence             | BSL 1.1 (source-available)                      | MPL 2.0 (open source)                                        |
| Governance          | HashiCorp                                       | Linux Foundation project with a technical steering committee |
| Language and config | HCL, `.tf` files                                | HCL, `.tf` files; also `.tofu` files that take precedence    |
| CLI                 | `terraform`                                     | `tofu`                                                       |
| Providers           | Terraform Registry                              | OpenTofu Registry, which mirrors provider metadata           |
| State format        | Terraform state                                 | Compatible with Terraform state at the fork point            |
| State encryption    | Not built in; use backend encryption (GCS CMEK) | Built-in client-side encryption                              |
| Managed service     | HCP Terraform                                   | Third-party platforms (Spacelift, env0, Scalr and others)    |
| Support             | HashiCorp commercial support                    | Community and vendor support                                 |

## Compatibility

At the fork, OpenTofu was a drop-in replacement for Terraform 1.5.x. Since then the two have diverged: each adds features the other lacks, and new Terraform releases are not automatically mirrored. Treat compatibility as a property to check per version, not a promise.

Practical consequences:

- Providers from major vendors (including the Google provider) are published for both and work with either binary.
- Modules that use only long-standing syntax work in both. Modules using newer features of one tool may fail on the other.
- `.terraform.lock.hcl` files should be regenerated per tool, since registry hostnames differ.

## State, backends and the GCS bucket

For a GCP shop the state backend is normally GCS, which both tools support with the same `backend "gcs"` block. Layout guidance is in [[terraform-module-and-state-layout]]. If you ever need to repair state, [[terraform-state-recovery]] applies to both.

```hcl title="backend.tf"
terraform {
  backend "gcs" {
    bucket = "example-tfstate"
    prefix = "prod/network"
  }
}
```

State encryption in OpenTofu is client-side and configured in an `encryption` block, with key providers such as a passphrase or a cloud KMS (GCP KMS is reported as supported). Enabling it changes what is written to the bucket, so a team without OpenTofu cannot read it. This is a one-way door unless you plan the rollback: keep the fallback configuration documented.

If you stay on Terraform, protect state with bucket-level CMEK, uniform bucket-level access, versioning and a tight IAM policy.

## Registry and providers

Both use the same provider protocol. OpenTofu has its own registry (`registry.opentofu.org`) that serves providers and modules; most public providers and modules are present. Private modules in Artifact Registry, GitLab or Git sources work identically.

Mirroring: in locked-down environments configure a provider mirror in the CLI configuration for whichever tool you use.

## Feature differences

Verify the current list before deciding; this moves with every release. As reported at the time of writing, OpenTofu added state encryption and provider iteration with `for_each` in provider configuration, among others, while Terraform has features such as its own test and ephemeral-value work and HCP Terraform integration. Compare the two changelogs for the versions you would pin.

## Migration

From Terraform (up to the versions OpenTofu is compatible with) to OpenTofu:

1. Pin the current Terraform version and ensure `plan` is clean on every workspace.
2. Read the OpenTofu migration guide for your Terraform version. Check that no features specific to newer Terraform are in use.
3. Install `tofu` in the CI image alongside `terraform`.
4. In a non-production workspace: back up state (`gsutil cp` the object or rely on bucket versioning), run `tofu init`, then `tofu plan`. Expect no changes.
5. Apply on a trivial change, confirm the state still reads with the old tool if you want a rollback path.
6. Migrate environments one at a time, then update CI, pre-commit hooks and docs.

```bash
STATE_BUCKET=example-tfstate
gcloud storage buckets describe "gs://$STATE_BUCKET" --format="value(versioning.enabled)"
tofu init -upgrade
tofu plan -detailed-exitcode
```

Exit code 0 means no changes, 2 means changes pending, 1 means error.

> [!danger] Do not mix tools on one state
> After either tool writes state with newer features, the other may refuse or misread it. Only one tool should apply to a given state at a time.

## When to choose which

Choose **Terraform** when you use HCP Terraform or Sentinel, need HashiCorp support contracts, or your legal review accepts the BSL for internal use.

Choose **OpenTofu** when open source governance matters, you want built-in state encryption, or you build tooling or platforms that could be seen as competing with HashiCorp.

## Recommendation for a GCP shop

If you do not use HCP Terraform and have no support contract, OpenTofu is a reasonable default for new work: GCS backend, Google provider and GitLab CI all work the same. For an existing estate that is stable on Terraform, there is no urgent reason to migrate; schedule it when you next upgrade tooling and have a clean plan. Wherever you land, pin the binary version in CI, keep one tool per state, and record the decision as an ADR (see [[adr/template|the ADR template]]).
