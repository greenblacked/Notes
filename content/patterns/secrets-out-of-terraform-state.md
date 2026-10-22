---
title: Keeping secrets out of Terraform state
description: Design Terraform on GCP so passwords and keys never land in state or plan files, protect the state bucket anyway, and clean up secrets that are already there.
type: pattern
tags:
  - patterns
  - terraform
  - gcp
  - security
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Terraform state and saved plan files hold every attribute of every resource in plain JSON. A database password set through `google_sql_user.password`, a `random_password` result, the payload of a `google_secret_manager_secret_version`, a service account key: all of them sit readable in the state object, in every old version of it that the bucket keeps, and in every plan artifact a CI job uploaded. `sensitive = true` does not change that; it only hides the value in CLI output. The fix is a design where secrets never pass through Terraform as stored values in the first place, plus a well-protected state bucket for whatever is left.

> [!info] What was checked
> The Terraform statements (what `sensitive` and `ephemeral` do, version requirements, write-only arguments, the GCS backend options) come from the Terraform documentation read on 2026-10-21. The Google provider's write-only arguments come from the provider's registry pages on the same date, and the OpenTofu encryption details from the OpenTofu docs and changelog. **Not verified** against the Google Cloud docs (check there): Secret Manager and Cloud SQL behaviour (role names, IAM database authentication, CMEK for secrets), Cloud Storage public access prevention and the related organization policy, and the minimum Google provider version for each `_wo` argument. Also not verified: the minimum `random` provider version that offers `ephemeral "random_password"` (believed to be 3.7.0), and the attributes of the ephemeral `google_secret_manager_secret_version` (not checked against its registry page: the `secret_data` attribute and passing a numeric `version` from the resource are unconfirmed). The `jq` scans assume the JSON layout of `terraform show -json` and are illustrative: try them on a sample state first. Nothing was applied to a real project.

## What lands in state

| Source of the value                                                                                          | In state and plan?              | Notes                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A resource argument (`password`, `secret_data`, a key file)                                                  | Yes                             | Even when the provider marks it sensitive. The provider pages for `google_sql_user` and `google_secret_manager_secret_version` say so explicitly. |
| A computed attribute (`google_service_account_key.private_key`, `random_password.result`, `tls_private_key`) | Yes                             | The value is created by Terraform or the API and then stored.                                                                                     |
| A data source result (for example a secret read with a data source)                                          | Yes                             | Reading a secret "just to pass it on" writes it into state.                                                                                       |
| A variable or output with `sensitive = true`                                                                 | Yes                             | Redacted in CLI output and the HCP Terraform UI only. `terraform output -json` and `-raw` print it in plain text.                                 |
| A variable or child module output with `ephemeral = true`                                                    | No                              | Terraform 1.10 or later. Root module outputs cannot be ephemeral.                                                                                 |
| An `ephemeral` resource block                                                                                | No                              | Terraform 1.10 or later; the provider must offer the ephemeral resource.                                                                          |
| A write-only argument (`*_wo`)                                                                               | No                              | Terraform 1.11 or later; the provider must offer the argument.                                                                                    |
| Backend credentials passed with `-backend-config`                                                            | In `.terraform/` and plan files | The GCS backend page warns about this; use environment variables or Application Default Credentials.                                              |

## Approaches, best first

### 1. Terraform owns the container, something else owns the value

Terraform creates the `google_secret_manager_secret` (name, replication, labels, IAM), never a version. The value is written by the system that owns it: the service that generates it, a rotation job, or a person through a controlled path. Consumers reference the secret by ID, and in Kubernetes [[external-secrets-with-secret-manager]] syncs it. This is the model in [[0036-secret-manager-as-secrets-system-of-record]] and [[secrets-architecture-gcp-and-gke]].

```hcl title="secret-container.tf"
resource "google_secret_manager_secret" "payments_db_password" {
  project   = var.project_id
  secret_id = "payments-db-password"

  replication {
    auto {}
  }

  labels = {
    owner = "payments"
  }
}

# Who may read the value: the workload's service account, nothing else.
resource "google_secret_manager_secret_iam_member" "payments_api_reads" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.payments_db_password.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:payments-api@${var.project_id}.iam.gserviceaccount.com"
}

output "payments_db_password_secret" {
  description = "Secret resource name; consumers read the value at runtime."
  value       = google_secret_manager_secret.payments_db_password.id
}
```

Writing the first version and rotating it is then outside Terraform, for example `gcloud secrets versions add payments-db-password --data-file=-` from a rotation job. The rotation flow is in [[secret-rotation-without-downtime]]. Role names above follow the provider docs' examples; check them against the Secret Manager IAM page.

### 2. No secret at all: identities instead of passwords

The best secret is the one that does not exist:

- Workloads on GKE authenticate to Google APIs with Workload Identity, not key files ([[gke-workload-identity]]). Never create `google_service_account_key` in Terraform: the private key is a computed attribute and lands in state.
- CI authenticates with workload identity federation ([[iam-groups-and-ci-workload-identity-federation]]), so there is no CI key to store either.
- Applications log in to Cloud SQL with IAM database authentication (for example through the Cloud SQL Auth Proxy with `--auto-iam-authn`), so there is no database password for the application user. Whether your engine and version support it is in the Cloud SQL docs (**not verified** here).

### 3. Ephemeral values and write-only arguments

When Terraform has to set a secret (the initial admin password of a database user, for example), use an ephemeral source and a write-only argument. Requirements, per the Terraform docs on 2026-10-21: Terraform 1.10 or later for `ephemeral` variables, outputs and blocks, Terraform 1.11 or later for write-only arguments, and a provider that offers them.

Write-only arguments confirmed in the Google provider's guide on 2026-10-21 (the list may not be complete, so check each resource's registry page):

| Resource                               | Write-only argument                             | Version argument         |
| -------------------------------------- | ----------------------------------------------- | ------------------------ |
| `google_secret_manager_secret_version` | `secret_data_wo` (exclusive with `secret_data`) | `secret_data_wo_version` |
| `google_sql_user`                      | `password_wo`                                   | `password_wo_version`    |
| `google_bigquery_data_transfer_config` | `sensitive_params.secret_access_key_wo`         | see the resource page    |

The provider also has an ephemeral `google_secret_manager_secret_version` that reads a secret during the run without storing it.

Generate a password, store it in Secret Manager and set it on the database user, with nothing in state. This adapts the documented "set and store an ephemeral password" example (shown there for AWS) to the Google provider; it was not applied here, so test it in a sandbox project:

```hcl title="db-user-password.tf"
terraform {
  required_version = ">= 1.11.0"
}

locals {
  # Increment to rotate: a new random value is generated, stored and set.
  db_password_version = 1
}

ephemeral "random_password" "payments_db" {
  length           = 32
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "google_secret_manager_secret_version" "payments_db" {
  secret                 = google_secret_manager_secret.payments_db_password.id
  secret_data_wo         = ephemeral.random_password.payments_db.result
  secret_data_wo_version = local.db_password_version
}

ephemeral "google_secret_manager_secret_version" "payments_db" {
  project = var.project_id
  secret  = google_secret_manager_secret.payments_db_password.secret_id
  version = google_secret_manager_secret_version.payments_db.version
}

resource "google_sql_user" "payments_admin" {
  project             = var.project_id
  instance            = google_sql_database_instance.payments.name
  name                = "payments_admin"
  password_wo         = ephemeral.google_secret_manager_secret_version.payments_db.secret_data
  password_wo_version = local.db_password_version
}
```

How it behaves:

- Terraform sends write-only values to the provider on every run, because it cannot diff them; the provider acts on them only when the `_wo_version` changes. The ephemeral `random_password` produces a new value on every run, and it is ignored until you increment `db_password_version`.
- Incrementing the version creates a new secret version and sets the same value on the user in one apply. Consumers that read `latest` pick it up on their next read; plan the cut-over as in [[secret-rotation-without-downtime]].
- Ephemeral values can only be referenced in ephemeral contexts (other ephemeral blocks, write-only arguments, provider and provisioner blocks, locals that feed those). Terraform rejects a reference from an ordinary argument.

Check what your toolchain supports before you design around it:

```bash title="check versions and schema"
terraform version
terraform providers
# Look for write-only attributes in the provider schema of this configuration (after terraform init).
terraform providers schema -json \
  | jq -r '.provider_schemas[].resource_schemas | to_entries[] | .key as $t
           | .value.block.attributes // {} | to_entries[] | select(.value.write_only == true)
           | "\($t).\(.key)"'
```

The `write_only` flag in the schema JSON is how recent Terraform versions describe these attributes; if the query prints nothing, check the registry pages instead (illustrative, not verified).

### 4. Encrypting state itself (OpenTofu)

OpenTofu can encrypt state and plan files client-side (introduced in OpenTofu 1.7.0, per its changelog), with key providers including PBKDF2 passphrases, AWS KMS, GCP KMS and OpenBao, and AES-GCM as the method. Ephemeral values and write-only attributes arrived in OpenTofu 1.11.0. If you run OpenTofu ([[0031-terraform-or-opentofu]], [[terraform-vs-opentofu]], [[opentofu-migration-notes]]), encryption is a strong second layer, not a replacement for approaches 1 to 3: whoever runs `tofu` still sees every value.

```hcl title="encryption.tf (OpenTofu only)"
terraform {
  encryption {
    key_provider "gcp_kms" "state" {
      kms_encryption_key = "projects/example-tfstate/locations/europe-west1/keyRings/tfstate/cryptoKeys/prod-state"
      key_length         = 32
    }

    method "aes_gcm" "state" {
      keys = key_provider.gcp_kms.state
    }

    state {
      method   = method.aes_gcm.state
      enforced = true
    }

    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
  }
}
```

The OpenTofu docs' warnings, in short: encrypted state is unrecoverable without the key; do not rename key providers or methods after encrypting (use a `fallback` block or `encrypted_metadata_alias`); migrating an existing unencrypted state needs an `unencrypted` method in a `fallback` block for the first run; and before enabling it, exercise your recovery plan and back up the unencrypted state and the keys. Use one KMS key per state, as the docs recommend. Follow the docs' "pre-existing project" example exactly when migrating. Key management is in [[cloud-kms-key-management]].

## Protecting the state bucket anyway

Even with the approaches above, state holds resource IDs, IP ranges and IAM layouts worth protecting. The layout per environment is in [[0032-terraform-state-in-gcs-per-environment]] and [[terraform-module-and-state-layout]].

| Control                          | How                                                                                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate project                 | State buckets live in a dedicated project; application teams have no role there.                                                                                                                               |
| Least privilege                  | Storage Object Admin on the bucket (the GCS backend page's stated need) only for the CI identity that applies that environment; read access for plan jobs only where required; no humans with standing access. |
| Object Versioning                | "Highly recommended" by the GCS backend page, for recovery. Remember that old versions also hold old secrets.                                                                                                  |
| Encryption with your key (CMEK)  | Backend option `kms_encryption_key`. The project's Cloud Storage service agent needs the Cloud KMS CryptoKey Encrypter/Decrypter role on the key; data encrypted with a lost or deleted key is unrecoverable.  |
| Uniform access, no public access | `gcloud storage buckets update gs://BUCKET --uniform-bucket-level-access --public-access-prevention`; enforce it with organization policy as well (organization policy details **not verified** here).         |
| Audit                            | Data access audit logs for the bucket, so every state read is attributable ([[gcp-audit-logs-siem]]).                                                                                                          |

```hcl title="backend.tf"
terraform {
  backend "gcs" {
    bucket             = "example-tfstate-prod"
    prefix             = "platform/network"
    kms_encryption_key = "projects/example-tfstate/locations/europe-west1/keyRings/tfstate/cryptoKeys/prod-state"
    # Credentials come from the environment (ADC or impersonation), never from -backend-config.
  }
}
```

```bash title="check the bucket"
BUCKET=gs://example-tfstate-prod
# Look for versioning, uniform bucket-level access, public access prevention and the default KMS key
# (field names in the output differ between gcloud versions, so read the full YAML).
gcloud storage buckets describe "$BUCKET" --format=yaml
gcloud storage buckets get-iam-policy "$BUCKET" --format=json
```

## Plan files in CI

A saved plan (`terraform plan -out=tfplan`) contains the same values as state, plus the proposed changes. In CI:

- Keep the binary plan as a short-lived artifact, only for the apply job of the same pipeline, readable only by protected pipelines. In GitLab that means a short `artifacts:expire_in` (check the GitLab docs for the syntax your version accepts) and an environment-scoped job; see [[terraform-plan-policy-checks]] and [[0035-terraform-plan-policy-gate-and-ci-only-apply]].
- Never paste plan output or plan JSON into merge request comments, chat or an external review tool. Redacted CLI output is safer than JSON, but values that are not marked sensitive still appear.
- Delete `plan.json` files after the policy check has read them.
- Run the secret scanning of [[secret-scanning-pre-commit-and-ci]] on the repository so a `*.tfstate` or a plan file never gets committed.

## Finding secrets already in state

List attributes the provider marks sensitive, and resources of types that are known to hold secrets:

```bash title="scan the current state (illustrative)"
# Read-only: prints addresses and attribute paths, never the values.
STATE_JSON="$(mktemp)"                   # mode 0600; contains secrets: delete it afterwards
terraform show -json > "$STATE_JSON"

jq -r '
  .values.root_module
  | recurse(.child_modules[]?)
  | .resources[]?
  | . as $r
  | ($r.sensitive_values // {})
  | paths(. == true)
  | "\($r.address)\t\(map(tostring) | join("."))"
' "$STATE_JSON"

jq -r '
  .values.root_module
  | recurse(.child_modules[]?)
  | .resources[]?
  | select(.type | IN("google_service_account_key", "google_sql_user",
                      "google_secret_manager_secret_version", "random_password", "tls_private_key"))
  | "\(.address)\t\(.type)"
' "$STATE_JSON"

shred -u "$STATE_JSON" 2>/dev/null || rm -f "$STATE_JSON"
```

For each hit:

1. **Treat the value as exposed.** Everyone who could read the bucket, any of its old object versions, or any plan artifact could read it. Follow [[leaked-credential-rotation]].
2. **Change the design** using the approaches above: drop the resource (service account key), move to the container-only model, or switch to `_wo` arguments.
3. **Rotate** the secret after the change, so the value still sitting in old state versions is worthless.
4. **Then clean up old state object versions** if your retention policy allows it, keeping enough history for recovery ([[terraform-state-recovery]]). Rotation is what makes the old copies harmless; deletion alone does not.

## Migrating a resource to a write-only argument

From `google_secret_manager_secret_version.secret_data` to `secret_data_wo`, or `google_sql_user.password` to `password_wo`:

1. Upgrade Terraform to 1.11 or later and the Google provider to a version whose registry page lists the `_wo` argument; run the full plan on the upgrade alone first.
2. Replace the argument with the `_wo` argument and add the `_wo_version` argument set to 1. Read the plan carefully: for a secret version it may mean a new version or a replacement; for a SQL user it should be an in-place update. Do not apply a plan that destroys something you did not expect.
3. After the apply, run the scan above and confirm the old attribute is `null` in state.
4. Rotate the secret (increment `_wo_version` with a new ephemeral value), because the old value is still in previous state versions.

## Verify

- The scan prints nothing for the resources you migrated, and `terraform state show <address>` shows the write-only attribute as null or absent.
- `terraform output -json` contains no secret values.
- CI plan artifacts expire, and the job log contains no plan JSON.
- The bucket shows versioning on, uniform access on, public access prevention enforced and your KMS key as default encryption.
- Only the expected identities hold roles on the bucket and the KMS key.

## Rollback

- **Write-only migration:** revert the commit to restore the old argument. The next apply writes the value back into state, so treat the rollback as a temporary measure and rotate after the fix.
- **OpenTofu encryption:** the documented way back is a `fallback` with the `unencrypted` method; do it while you still hold the key, and keep the encrypted state's backups until the unencrypted state is verified.
- **CMEK on the state bucket:** never disable or destroy the key version while state objects or their old versions are encrypted with it. Re-encrypt the objects under a new key first.
- **State damaged during any of this:** restore a previous object version as described in [[terraform-state-recovery]].

## Related

- [[terraform-module-and-state-layout]]
- [[terraform-plan-policy-checks]]
- [[external-secrets-with-secret-manager]]
- [[cloud-kms-key-management]]
- [[secrets-architecture-gcp-and-gke]]
- [[0032-terraform-state-in-gcs-per-environment]]
- [[vault-vs-gcp-secret-manager]]
- [[encryption-at-rest-and-in-transit-evidence-gcp]]

## Sources

- [Terraform: Manage sensitive data in your configuration](https://developer.hashicorp.com/terraform/language/manage-sensitive-data)
- [Terraform: Omit values from state with ephemeral resources](https://developer.hashicorp.com/terraform/language/manage-sensitive-data/ephemeral)
- [Terraform: Use temporary write-only arguments](https://developer.hashicorp.com/terraform/language/manage-sensitive-data/write-only)
- [Terraform: ephemeral block reference](https://developer.hashicorp.com/terraform/language/block/ephemeral)
- [Terraform: GCS backend](https://developer.hashicorp.com/terraform/language/backend/gcs)
- [Google provider: Use write-only arguments](https://registry.terraform.io/providers/hashicorp/google/latest/docs/guides/using_write_only_arguments)
- [Google provider: google_secret_manager_secret_version](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret_version) and [google_sql_user](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/sql_user)
- [OpenTofu: State and plan encryption](https://opentofu.org/docs/language/state/encryption/)
- [OpenTofu changelog](https://github.com/opentofu/opentofu/blob/main/CHANGELOG.md)
