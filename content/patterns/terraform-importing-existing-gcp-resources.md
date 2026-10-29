---
title: Adopting existing GCP resources with Terraform import blocks
description: Bring existing Google Cloud resources under Terraform management with reviewed import plans and without accidental recreation or drift changes.
type: pattern
tags:
  - patterns
  - terraform
  - gcp
created: 2026-10-29
modified: 2026-10-29
draft: false
evidence: source-reviewed
reviewed: 2026-10-29
review-due: 2027-04-29
---

Import existing infrastructure when a team is adopting resources created by hand, another tool or an earlier process. The import binds a remote object to one Terraform resource address in state; it does not write the resource configuration for you. The goal is to make that binding in a reviewed plan, then leave Terraform with a clean plan against configuration that matches the real object.

This pattern covers normal adoption into an existing root module. For damaged or missing state, state-file recovery and manual state surgery, use [[runbooks/terraform-state-recovery]] instead. The environment and CI layout are in [[patterns/terraform-module-and-state-layout]].

> [!warning] Import only after checking ownership
> A remote object must be bound to only one Terraform resource address. Check the target state and any other tool or team that manages the object before importing it.

## Plan the adoption

For each object, record the owning project, its provider-specific import ID, the target root module and state, and the Terraform address that will own it. Check the Google provider documentation for the resource's supported import ID; similar-looking resources can use different ID formats.

Use the same provider configuration and alias that will manage the resource after import. For example, a Cloud Storage bucket can be imported with its bucket name or `project/bucket`:

```hcl title="live/production/storage/assets.tf"
resource "google_storage_bucket" "assets" {
  project  = "example-project"
  name     = "example-assets"
  location = "EUROPE-WEST1"

  # Add the settings this root module will manage, matching the live bucket.
}

import {
  to = google_storage_bucket.assets
  id = "example-project/example-assets"
}
```

The project and bucket name above are examples. For other resource types, use the exact import ID documented by that provider. Import blocks require a destination `resource` block whose address matches `to`.

Before planning, confirm the destination address is not already in the state and that no other address in this or another state manages the same remote object. A duplicate binding can make later plans behave unexpectedly.

## Review and apply the import

Run the normal pipeline for the root module. Terraform 1.5 and later supports `import` blocks; check the pinned version and verify equivalent behavior before using them with OpenTofu.

```bash
set -euo pipefail

cd live/production/storage # change: the root module being updated
terraform init -input=false
terraform plan -input=false -out=import.tfplan
terraform show import.tfplan
```

Treat `import.tfplan` as sensitive: plans can contain values that are not redacted in logs. In CI, follow the restricted-access and short-retention policy for plan artifacts in [[patterns/terraform-plan-policy-checks]].

Proceed only when the reviewed plan imports the intended object and shows no unexpected create, update, replace or destroy actions. If the plan proposes changes to the bucket, stop and update the configuration or resolve the intended change separately. Do not combine adoption with unrelated infrastructure changes.

Apply the exact reviewed plan through the approved pipeline:

```bash
terraform apply -input=false import.tfplan
terraform state list | grep -Fx 'google_storage_bucket.assets'
terraform plan -input=false
```

The state listing should include the imported address. The final plan should be empty. Remove the `import` block after the import has been applied; keep the `resource` block as the ongoing desired configuration.

## Common failure modes

- **Wrong import ID or provider alias:** the provider cannot find the object, or it is looked up in the wrong project. Check the resource's provider documentation and the configured project before changing anything.
- **Configuration does not match the live object:** the import succeeds, but the next plan proposes updates. Compare the planned fields with the cloud resource and decide whether to match the configuration to reality or make a separate, reviewed change.
- **Duplicate ownership:** the same remote object is imported at multiple addresses or remains managed by another state/tool. Stop before apply and establish one owner per object.
- **Import mixed with desired changes:** the reviewed plan includes more than the state binding. Split the changes so the ownership transfer can be validated on its own.

## Rollback

An import changes Terraform state, not the remote resource by itself. If the wrong object or address was imported, pause further applies and use the backup-first recovery procedure in [[runbooks/terraform-state-recovery]] to reconcile state. Do not simply remove the resource block and apply; that can plan a remote destroy.

## Related

- [[patterns/terraform-module-and-state-layout]]: root modules, remote state and the CI plan/apply flow.
- [[patterns/terraform-plan-policy-checks]]: plan review and safe handling of plan artifacts.
- [[patterns/terraform-gcp-iam-member-binding-policy]]: importing Google Cloud IAM grants and bindings.
- [[patterns/terraform-module-versioning]]: resource-address changes with `moved` blocks.
- [[runbooks/terraform-state-recovery]]: backup-first state recovery and manual import procedures.

## Evidence

### Sources checked

- [Import existing resources](https://developer.hashicorp.com/terraform/language/import): the import workflow, destination resource configuration and provider-specific IDs, checked 2026-10-29.
- [Import block reference](https://developer.hashicorp.com/terraform/language/block/import): `to`, `id`, and the requirement for a matching resource address, checked 2026-10-29.
- [Terraform CLI import usage](https://developer.hashicorp.com/terraform/cli/import/usage): one-to-one state bindings and the need to reconcile configuration with the imported object, checked 2026-10-29.
- [Google provider: Cloud Storage bucket](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/storage_bucket): bucket import ID forms and Terraform version support for import blocks, checked 2026-10-29.

### Not verified

No commands were run against a live GCP project or a disposable Terraform root module. Provider-specific import IDs for resources other than Cloud Storage buckets, and OpenTofu compatibility for the pinned version, must be checked before use.
