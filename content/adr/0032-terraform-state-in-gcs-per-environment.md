---
title: Terraform state in GCS per environment
description: One versioned GCS bucket per environment, a prefix per root module, CMEK, and state treated as a secret with access limited to CI identities.
type: adr
tags:
  - adr
  - terraform
  - gcp
  - security
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0032
---

## Context

Terraform state records every attribute of every managed resource, including values that are secret by nature: generated passwords, private keys and connection strings. Local state files, or one shared bucket for every environment, create three problems:

- A developer laptop or a broad bucket ACL exposes secrets for production.
- A bad write or a deleted object destroys the only record of what Terraform owns, and recovery means importing resources by hand.
- A non-production pipeline identity that can read the production state can learn production values.

We need a backend with locking, history and per-environment blast-radius boundaries, on the cloud we already run.

## Decision

State lives in **Google Cloud Storage buckets, one per environment**, with one prefix per root module (layer).

- Bucket naming: `example-tfstate-prod`, `example-tfstate-nonprod`, created by a small bootstrap configuration kept apart from the stacks it serves.
- Object versioning is on, with a lifecycle rule that deletes noncurrent versions after a retention period chosen per environment. Uniform bucket-level access is enforced and public access prevention is on.
- Buckets use a customer-managed encryption key (CMEK) from Cloud KMS. See [[cloud-kms-key-management]].
- IAM on the bucket is limited to the CI identities for that environment. Humans get no standing access; break-glass access is granted with a logged reason (see [[0035-terraform-plan-policy-gate-and-ci-only-apply]]).
- State is treated as a secret. It is never copied into tickets, artifacts or chat, and plan files are handled the same way.
- Secrets are kept out of state wherever possible by creating only secret containers in Terraform (see [[0036-secret-manager-as-secrets-system-of-record]]).

```hcl title="backend.tf"
terraform {
  backend "gcs" {
    bucket = "example-tfstate-prod"
    prefix = "platform/gke"
  }
}
```

```bash title="bootstrap-state-bucket.sh"
set -euo pipefail
PROJECT_ID="example-state-prod"
BUCKET="example-tfstate-prod"
LOCATION="europe-west4"   # choose per ADR on regions; this value is an example
KMS_KEY="projects/example-kms-prod/locations/${LOCATION}/keyRings/tfstate/cryptoKeys/tfstate"

gcloud storage buckets create "gs://${BUCKET}" \
  --project="${PROJECT_ID}" --location="${LOCATION}" \
  --uniform-bucket-level-access --public-access-prevention \
  --default-encryption-key="${KMS_KEY}"
gcloud storage buckets update "gs://${BUCKET}" --versioning
```

Check the current flag names in the `gcloud storage` reference before running this.

> [!info] Claims not checked against current docs
> The exact `gcloud storage buckets` flags, the backend's locking behaviour for the Terraform and OpenTofu versions in use, and the KMS service agent roles required for CMEK on buckets.

## Consequences

Easier:

- A production compromise path through non-production CI is closed, because the buckets and identities differ.
- History is available: a bad state write is recovered from a prior object version (see [[terraform-state-recovery]]).
- Locking is built into the backend, so concurrent applies on one prefix fail rather than corrupt state.

Harder:

- Bucket and key bootstrap is a chicken-and-egg step that needs a documented, reviewed procedure.
- CMEK adds a dependency: if the key is disabled or destroyed, state is unreadable. Key deletion protection and a scheduled-destruction alert are required.
- Cross-stack reads (`terraform_remote_state`) need explicit IAM, which is deliberate but adds work. Prefer data sources or outputs published elsewhere.
- Noncurrent version retention costs storage; check current pricing.

## Alternatives considered

- **One bucket for everything.** Simple, but one IAM mistake exposes all environments. Rejected.
- **HCP Terraform or another hosted state backend.** Capable and removes bucket upkeep, but adds a vendor and a licensing question tied to [[0031-terraform-or-opentofu]]. Not rejected forever; revisit with that decision.
- **Terraform workspaces in one backend.** Workspaces share backend credentials, so they do not give an access boundary between environments. Rejected for environment separation. See [[terraform-module-and-state-layout]].

## Validation

```bash title="validate-state-bucket.sh"
set -euo pipefail
BUCKET="example-tfstate-prod"

# Versioning is on (expected: true)
gcloud storage buckets describe "gs://${BUCKET}" --format="value(versioning_enabled)"

# Uniform access and public access prevention (expected: true / enforced)
gcloud storage buckets describe "gs://${BUCKET}" \
  --format="value(uniform_bucket_level_access, public_access_prevention)"

# CMEK in use (expected: a Cloud KMS key path)
gcloud storage buckets describe "gs://${BUCKET}" --format="value(default_kms_key)"

# Who can read it? Review: only CI service accounts and the break-glass group
gcloud storage buckets get-iam-policy "gs://${BUCKET}" --format=json \
  | jq -r '.bindings[] | "\(.role) \(.members | join(","))"'
```

## References

- Terraform GCS backend: https://developer.hashicorp.com/terraform/language/backend/gcs
- Object Versioning: https://cloud.google.com/storage/docs/object-versioning
- CMEK for Cloud Storage: https://cloud.google.com/storage/docs/encryption/customer-managed-keys

Related notes:

- [[terraform-state-recovery]]
- [[cloud-kms-key-management]]
- [[terraform-module-and-state-layout]]
- [[0035-terraform-plan-policy-gate-and-ci-only-apply]]
- [[0036-secret-manager-as-secrets-system-of-record]]
