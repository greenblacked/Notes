---
title: Customer-managed encryption keys where the data class requires them, Google default encryption elsewhere
description: Default encryption is the baseline; CMEK is required for restricted data, Terraform state and Secret Manager, with guarded keys per environment.
type: adr
tags:
  - adr
  - gcp
  - security
  - compliance
  - cost
status: accepted
created: 2026-10-21
modified: 2026-10-21
decided: 2026-10-21
draft: false
aliases:
  - ADR-0059
---

## Context

Two accepted records already use customer-managed encryption keys (CMEK): Terraform state buckets ([[0032-terraform-state-in-gcs-per-environment]]) and Secret Manager "where policy requires it" ([[0036-secret-manager-as-secrets-system-of-record]]). Neither says what that policy is, so each new data store reopens the question, and a proposal to "turn on CMEK everywhere" keeps coming back.

The facts that frame the choice:

- **Everything is already encrypted at rest.** Google encrypts all data it stores at the storage layer with AES-256 using keys that Google owns and manages. Customers do not see those keys and do not control their rotation.[^default]
- **CMEK changes who controls the key, not whether data is encrypted.** With CMEK the key lives in our Cloud KMS project, we set its rotation, we see every use of it in audit logs, and we can revoke the service's ability to read the data by disabling the key. That last property is the point for regulators and customers, and also the main risk for us.
- **A disabled or destroyed key is an outage or data loss.** A disabled key version makes the protected data store unreadable until it is re-enabled. A destroyed key version makes the ciphertext unrecoverable once the scheduled-destruction period ends, including every backup encrypted with it.
- **CMEK costs money and time.** Cloud KMS charges per active key version and per operation, at different rates for software, HSM and external keys (see the [Cloud KMS pricing page](https://cloud.google.com/kms/pricing); no figures are quoted here). Every key also needs IAM for its service agent, a location that matches the resource, and monitoring.
- **Support varies.** Not every service supports CMEK, not every service supports every key location, and some cannot switch an existing resource from Google-managed to customer-managed keys.

CMEK everywhere would multiply keys, cost and outage paths for data that gains nothing from it. CMEK nowhere would fail the contracts and regulations that require customer key control. We need a rule that follows the data.

## Decision

**Google default encryption is the baseline. CMEK is mandatory where the data class, a contract or a regulator requires it, and for a short list of platform stores.** Keys are created and guarded as described below.

### When CMEK is required

The classes are those of [[standards/data-classification-and-handling-standard]]; this table repeats only what matters for encryption.

| Data class   | Examples                                                                                                     | Key requirement                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Public       | Published documentation, public container images                                                             | Google default encryption                                            |
| Internal     | Build caches, non-production test data with no personal data, internal dashboards                            | Google default encryption                                            |
| Confidential | Business data, customer data without regulatory scope, non-production copies of confidential data            | Google default encryption, CMEK when a customer contract requires it |
| Restricted   | Payment data, personal data in regulatory scope ([[pci-dss-and-gdpr-for-devops-logs-and-data]]), credentials | **CMEK mandatory**, one key per data store                           |

Regardless of the data class, CMEK is mandatory for:

- **Terraform state buckets**, because state carries secrets ([[0032-terraform-state-in-gcs-per-environment]]).
- **Secret Manager secrets in production** ([[0036-secret-manager-as-secrets-system-of-record]]).
- **Backups of restricted stores**, with the same key class as the source, so that a backup is never weaker than the data it copies ([[backup-architecture-gke-cloud-sql-gcs]]).
- **Any store a customer or regulator names**, recorded with the requirement's reference in the key's labels.

Anything else that wants CMEK asks for it with a reason; "it seems safer" is not one. Exceptions to the mandate (a service that does not support CMEK in the needed location, for example) follow [[policy-exception-and-waiver-process]] with an expiry.

### Key layout

- **One KMS project per environment** (`kms-prod`, `kms-nonprod`), in the security folder ([[0024-gcp-folders-by-policy-boundary]]). No workloads run there, and no basic roles (Owner, Editor) are granted on it, because they include key-administration privileges.
- **One key ring per environment and region**, named `<env>-<region>`, in the same location as the resources it protects. CMEK integrations generally need the key in the resource's location, some do not accept `global`, and KMS resources cannot be moved after creation, so a name and a location are permanent.[^locations] Regional placement follows [[0028-primary-and-dr-regions-per-environment]]; the DR region gets its own key ring.
- **One key per service and data store** (`payments-sql`, `payments-gcs`), never one key shared by unrelated services. A shared key widens the blast radius of a disable and makes the audit trail ambiguous.
- **Labels** on every key: `owner`, `data_class`, and `requirement` when a contract or regulation drives it.
- **Software protection level** by default. Cloud HSM or Cloud External Key Manager (EKM) only when a named requirement asks for them, recorded on the key. Check the per-region availability and pricing before committing.

### Rotation and destruction guard

- **Rotation period of 90 days** on every CMEK key, set on the key resource. Rotation creates a new primary version for new writes; it does not re-encrypt existing data, and the old versions must stay enabled to read it (see [[cloud-kms-key-management]]).
- **Scheduled-destruction protection.** At the organisation level we set the minimum scheduled-destruction duration (`constraints/cloudkms.minimumDestroyScheduledDuration`) and require a version to be disabled before it can be scheduled for destruction (`constraints/cloudkms.disableBeforeDestroy`). The chosen floor is 30 days; check the values the constraint accepts. Keys are created with an explicit destroy-scheduled duration at least that long.[^destroy]
- **Separation of duties.** The key-administrator group (platform security) holds Cloud KMS Admin on the KMS project. Service agents and workload identities hold only CryptoKey Encrypter/Decrypter, on the specific key. No identity holds both on the same key; this is a detective check, not something IAM can enforce.
- **Terraform guards keys with `prevent_destroy`.** Key disable, destroy and IAM changes go through the same CI-only apply as other production changes ([[0035-terraform-plan-policy-gate-and-ci-only-apply]]).

### Organisation policy in restricted folders

In folders that hold restricted data, two organisation policy constraints keep new resources on our keys:[^orgpolicy]

- `constraints/gcp.restrictNonCmekServices`: a deny list of services whose **new** resources must be created with CMEK.
- `constraints/gcp.restrictCmekCryptoKeyProjects`: an allow list of where those keys may come from, set to the environment's KMS project.

Both constraints apply only to newly created resources, and per-service support differs. Turning them on does not change existing resources; each existing restricted store without CMEK gets a migration item, and the service's own CMEK page says whether it can switch in place or needs a copy into a new resource. The rollout follows [[policy-rollout-audit-to-enforce]].

### Terraform sketch

```hcl title="kms-payments.tf"
variable "sql_service_agent" {
  type        = string
  description = "The Cloud SQL service agent of the consuming project; take its address from the service's CMEK page."
}

resource "google_kms_key_ring" "prod_europe_west1" {
  project  = "kms-prod"
  name     = "prod-europe-west1"
  location = "europe-west1"
}

resource "google_kms_crypto_key" "payments_sql" {
  name            = "payments-sql"
  key_ring        = google_kms_key_ring.prod_europe_west1.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "7776000s" # 90 days

  # Field name not verified; check the provider docs. 30 days = 2592000s.
  destroy_scheduled_duration = "2592000s"

  labels = {
    owner      = "payments"
    data_class = "restricted"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Users of the key: only the service agent that encrypts the data store.
resource "google_kms_crypto_key_iam_member" "payments_sql_user" {
  crypto_key_id = google_kms_crypto_key.payments_sql.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${var.sql_service_agent}"
}

# Administrators of keys: a group, on the KMS project, never on workload projects.
resource "google_project_iam_member" "kms_admins" {
  project = "kms-prod"
  role    = "roles/cloudkms.admin"
  member  = "group:kms-admins@example.com"
}
```

```hcl title="org-policy-restricted-folder.tf"
variable "restricted_folder_id" {
  type = string
}

variable "cmek_required_services" {
  type        = list(string)
  description = "Services listed as supported by gcp.restrictNonCmekServices that we run in this folder; review against the CMEK org policy page."
}

resource "google_org_policy_policy" "restrict_non_cmek" {
  name   = "folders/${var.restricted_folder_id}/policies/gcp.restrictNonCmekServices"
  parent = "folders/${var.restricted_folder_id}"

  spec {
    rules {
      values {
        denied_values = var.cmek_required_services
      }
    }
  }
}

resource "google_org_policy_policy" "cmek_key_projects" {
  name   = "folders/${var.restricted_folder_id}/policies/gcp.restrictCmekCryptoKeyProjects"
  parent = "folders/${var.restricted_folder_id}"

  spec {
    rules {
      values {
        allowed_values = ["projects/kms-prod"]
      }
    }
  }
}
```

> [!warning] Disabling a key is an outage; destroying it is data loss
> A disabled key version stops the data store, and every backup made with that key, from being read until it is re-enabled. Once a scheduled destruction completes, the data cannot be recovered by anyone. Key state changes are paged, not just logged, and a restore drill ([[0051-backups-proven-by-quarterly-restore-drills]]) counts as passed only if the restore also proves access to the key.

## Consequences

Easier:

- One answer to "does this store need CMEK", taken from the data class, instead of a debate per store.
- For restricted data we can show customers and auditors who can use each key, every use of it, and how access to the data can be revoked ([[encryption-at-rest-and-in-transit-evidence-gcp]]).
- Keys, rotation and IAM are code, so a review shows any widening of key access.

Harder or newly required:

- **Key state is a production dependency.** Disabling a key, removing a service agent's role or letting a KMS project be deleted takes the data store down. We alert on key version disable, destroy and IAM changes, and treat those changes as high-risk.
- **Location coupling.** A key must match its resource's location. Moving a data store to another region means a new key ring and key there, and a dual-region or multi-region resource needs a key in a matching location (check the service's CMEK page).
- **Migration of existing stores.** The organisation policy covers only new resources, so existing restricted stores need per-service migration work, and some can only be migrated by copying into a new resource.
- **Cost.** Every key version that is not destroyed is billed, and rotation adds versions. The 90-day rotation and one key per store are a deliberate cost for restricted data only; the FinOps view tracks KMS spend per environment ([[finops-cost-allocation-and-guardrails]]).
- **Interaction with the perimeter.** If [[0058-vpc-service-controls-for-production-data]] is accepted, the KMS project sits outside the data perimeter, so key use needs an egress rule, or Cloud KMS has to be inside the perimeter. Whether Cloud KMS is supported by VPC Service Controls and how is not verified here.

### Rollback

- A wrongly disabled key version is re-enabled; the store recovers once the service can use the key again.
- A version scheduled for destruction can be restored during the scheduled-destruction period. After that, there is no rollback. That is why the period has an organisation-wide floor and why disabling before destroying is required.
- Reversing this decision for a store (back to Google default encryption) is a per-service migration, often a copy into a new resource. It is not a key setting.

## Alternatives considered

- **CMEK everywhere.** One rule and maximum control, but it multiplies keys, outage paths, IAM and cost across internal and public data that gains nothing from it. It also makes key incidents more likely, because there are more keys to mishandle. Rejected.
- **Google default encryption only.** No cost or toil, but it cannot meet contracts and regulations that require customer key control, revocation or key-use audit, and it leaves Terraform state and production secrets without a revocation path. Rejected.
- **Cloud EKM (keys held outside Google) or Cloud HSM as the default.** Stronger custody guarantees for specific requirements, with extra dependencies, cost and, for EKM, an external system on the data path. Kept for named requirements only.
- **Customer-supplied keys (CSEK).** We would hold raw key material and pass it with each request, which pushes key storage and rotation onto us, and support is narrower. Rejected. Note that the Terraform GCS backend's `encryption_key` setting is this kind of key; state uses `kms_encryption_key` or the bucket's default KMS key instead.

> [!info] Claims not checked against current docs
> The research behind this record used search summaries of Google's pages, not the pages themselves. Not verified, check before relying on them: which services support CMEK, in which locations, and which are covered by `gcp.restrictNonCmekServices` (no service list is given here); the values accepted by `cloudkms.minimumDestroyScheduledDuration`; the Terraform field name `destroy_scheduled_duration` and the gcloud flag for the destroy duration at key creation (`gcloud kms keys create --help`); the service agent address for each service; the `gcloud kms inventory` commands used in Validation; the log filter for key state alerts; and whether KMS key use crosses a VPC Service Controls perimeter. The existing [[cloud-kms-key-management]] note has the same caveats for the destroy duration and constraint parameters.

## Validation

```bash title="validate-cmek.sh"
set -o pipefail
ORG_ID="123456789012"
KMS_PROJECT="kms-prod"
LOCATION="europe-west1"
KEY_RING="prod-europe-west1"
RESTRICTED_FOLDER="234567890123"
KEY="projects/${KMS_PROJECT}/locations/${LOCATION}/keyRings/${KEY_RING}/cryptoKeys/payments-sql"

# 1. Every key has a rotation period and a primary version that is ENABLED.
#    Expected: no row with an empty ROTATION column.
gcloud kms keys list --project="${KMS_PROJECT}" --location="${LOCATION}" --keyring="${KEY_RING}" \
  --format="table(name.basename(), rotationPeriod, nextRotationTime, primary.state, labels.data_class)"

# 2. Which resources a key protects (Cloud KMS key usage tracking; needs the
#    Cloud KMS Inventory API and the Protected Resources Viewer role on the org).
#    Command name not verified: check `gcloud kms inventory --help`.
gcloud kms inventory search-protected-resources --keyname="${KEY}" --scope="organizations/${ORG_ID}"

# 3. The CMEK constraints are in force on the restricted folder.
#    Expected: denied values listed for restrictNonCmekServices, the KMS project
#    allowed for restrictCmekCryptoKeyProjects.
gcloud org-policies describe constraints/gcp.restrictNonCmekServices --folder="${RESTRICTED_FOLDER}" --effective
gcloud org-policies describe constraints/gcp.restrictCmekCryptoKeyProjects --folder="${RESTRICTED_FOLDER}" --effective
gcloud org-policies describe constraints/cloudkms.minimumDestroyScheduledDuration --organization="${ORG_ID}" --effective

# 4. No identity holds both key administration and key use on the KMS project.
#    Expected: no output.
gcloud projects get-iam-policy "${KMS_PROJECT}" --format=json \
  | jq -r '
      [.bindings[] | select(.role=="roles/cloudkms.admin") | .members[]] as $admins
      | .bindings[] | select(.role=="roles/cloudkms.cryptoKeyEncrypterDecrypter")
      | .members[] | select(. as $m | $admins | index($m))'
```

Project-level CMEK coverage (how much of a project's data uses CMEK) is shown in the Cloud KMS encryption metrics dashboard, which is built on Cloud Asset Inventory and needs `roles/cloudasset.viewer`. Use it to track the migration of existing stores.

Alerting on key state changes is a log-based metric in the KMS project, with an alert policy kept as code ([[0046-dashboards-and-alert-rules-as-code]]). Key version destruction and state changes are Admin Activity events, which are always logged; alerting on data-plane use (encrypt and decrypt) would need Data Access logs enabled. The filter below is a sketch; check the method names in the Cloud KMS audit logging page.

```bash title="kms-key-state-alert.sh"
set -o pipefail
KMS_PROJECT="kms-prod"

gcloud logging metrics create kms-key-state-changes --project="${KMS_PROJECT}" \
  --description="Cloud KMS key version disable or destroy, and key IAM changes" \
  --log-filter='protoPayload.serviceName="cloudkms.googleapis.com" AND (
    protoPayload.methodName:"DestroyCryptoKeyVersion" OR
    protoPayload.methodName:"UpdateCryptoKeyVersion" OR
    protoPayload.methodName:"SetIamPolicy")'

# Expected: the metric exists. Then attach an alert policy that pages on any count > 0.
gcloud logging metrics describe kms-key-state-changes --project="${KMS_PROJECT}"
```

`UpdateCryptoKeyVersion` also covers harmless updates; the alert's documentation should tell on-call to check whether the change set the state to `DISABLED`, which is the more likely outage cause than a destroy.

## References

- Default encryption at rest: https://docs.cloud.google.com/security/encryption/default-encryption
- CMEK organisation policies: https://docs.cloud.google.com/kms/docs/cmek-org-policy
- Key rotation: https://docs.cloud.google.com/kms/docs/rotate-key
- Destroy and restore key versions: https://docs.cloud.google.com/kms/docs/destroy-restore
- Control key destruction (organisation policies): https://docs.cloud.google.com/kms/docs/control-key-destruction
- Cloud KMS locations: https://docs.cloud.google.com/kms/docs/locations
- View key usage: https://docs.cloud.google.com/kms/docs/view-key-usage
- Encryption metrics dashboard: https://docs.cloud.google.com/kms/docs/view-encryption-metrics
- Cloud KMS audit logging: https://docs.cloud.google.com/kms/docs/logging
- Cloud KMS roles and permissions: https://docs.cloud.google.com/kms/docs/reference/permissions-and-roles
- Secret Manager CMEK: https://docs.cloud.google.com/secret-manager/docs/cmek
- Cloud KMS pricing (link only): https://cloud.google.com/kms/pricing

Related notes:

- [[cloud-kms-key-management]]
- [[data-classification-and-handling-standard]]
- [[encryption-at-rest-and-in-transit-evidence-gcp]]
- [[gcp-organization-policy-guardrails]]
- [[secrets-architecture-gcp-and-gke]]
- [[backup-architecture-gke-cloud-sql-gcs]]
- [[pci-dss-and-gdpr-for-devops-logs-and-data]]
- [[policy-exception-and-waiver-process]]
- [[finops-cost-allocation-and-guardrails]]

Related ADRs:

- [[0024-gcp-folders-by-policy-boundary]]
- [[0027-cloud-sql-for-production-postgres]]
- [[0032-terraform-state-in-gcs-per-environment]]
- [[0036-secret-manager-as-secrets-system-of-record]]
- [[0051-backups-proven-by-quarterly-restore-drills]]
- [[0058-vpc-service-controls-for-production-data]]

[^default]: Per Google's default encryption at rest page.

[^locations]: Per the Cloud KMS locations page. Secret Manager adds its own rule: user-managed replication needs a key in each replica location, and automatic replication needs keys in `global`.

[^destroy]: Google documents a default scheduled-destruction period and recommends disabling a version before scheduling its destruction; check the current default and limits on the destroy and restore page.

[^orgpolicy]: Both constraints are described on the CMEK organisation policy page; reading them needs the Organization Policy Viewer role.
