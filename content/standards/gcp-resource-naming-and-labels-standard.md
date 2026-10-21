---
title: GCP resource naming and labels standard
description: Naming patterns for projects, service accounts, buckets, networks, keys and clusters, plus the required Google Cloud labels for ownership and cost.
type: standard
tags:
  - standards
  - gcp
  - terraform
  - cost
  - audit
created: 2026-10-21
modified: 2026-10-21
draft: false
---

On Google Cloud a name is often a one-way door. A project ID cannot be changed, a Cloud KMS key ring can never be deleted, and a bucket name is part of every URL and script that reads it. A label, by contrast, is cheap to change, but a missing one turns the monthly cost report into guesswork and an incident into a hunt for the owner. This standard fixes the naming pattern per resource type, the labels every resource carries, and how both are enforced in Terraform, CI and a periodic audit. The landing zone layout itself is in [[gcp-resource-hierarchy-and-landing-zone]]; Kubernetes object labels are in [[kubernetes-labels-and-annotations-standard]].

## Scope

- **Applies to** every Google Cloud resource we create in the organization, through Terraform ([[0030-terraform-manages-gcp-infrastructure]]) or otherwise.
- **New resources** MUST follow it from today. **Existing resources** get labels now and keep their names until they are recreated for another reason (see Migrating existing resources).
- **Sandbox projects** follow the label rules; the naming rules are SHOULD there.

> [!info] Check the current docs
> Name limits change and differ per service. The limits quoted below come from the `gcloud` help and the Terraform Google provider documentation, which are linked in Sources. Limits marked **not verified** were not confirmed against the service's own documentation; check the linked page before you rely on them. Patterns, prefixes and label values are **proposed team defaults**.

## Principles

1. **Immutable names carry only stable facts.** Environment, system and purpose are stable. Team names, product marketing names, people and cost centres are not; they belong in labels, which can change.
2. **The environment is always in the name** of anything that has an environment, and always in the `env` label. Nobody should have to open a resource to know whether it is production.
3. **No personal data and no secrets in names or labels.** Names and labels show up in billing exports, logs, URLs and support tickets. A user ID, an email address or a customer name in a bucket name is a data leak with a very long life.
4. **One pattern per resource type**, built by a Terraform naming module, never typed by hand.
5. **Lowercase, hyphen-separated, ASCII.** It is the common subset that almost every Google Cloud name accepts.
6. **Short org prefix where names are global.** Globally unique names (project IDs, bucket names) start with a short, fixed organization prefix so they do not collide with other customers. The examples use `acme`, as in [[gcp-resource-hierarchy-and-landing-zone]].

## Naming patterns

The building blocks are `<org>` (a fixed short prefix such as `acme`), `<system>` (the stable name of the product or platform component, such as `orders`), `<env>` (`prod`, `stage`, `dev`, `sbx`), `<region>` (a Google Cloud region name such as `europe-west1`) and `<purpose>` (what the resource is for, such as `uploads` or `gke`).

| Resource                     | Pattern (proposed default)         | Example                                   | Changeable after creation?                                  |
| ---------------------------- | ---------------------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| Folder (display name)        | Policy boundary name, per ADR 0024 | `workloads`, `prod`                       | The display name is not the folder ID; renames not verified |
| Project ID                   | `<org>-<system>-<env>`             | `acme-orders-prod`                        | **No.** Immutable                                           |
| Project display name         | Human readable                     | `Orders (production)`                     | Yes                                                         |
| Service account ID           | `<workload>-<purpose>`             | `orders-api-runtime`, `ci-deploy-orders`  | **No.** Changing it creates a new account                   |
| Cloud Storage bucket         | `<org>-<system>-<env>-<purpose>`   | `acme-orders-prod-uploads`                | **No.** A new bucket and a copy                             |
| VPC network                  | `<env>-<purpose>-vpc`              | `prod-shared-vpc`                         | **No**                                                      |
| Subnet                       | `<env>-<region>-<purpose>`         | `prod-europe-west1-gke`                   | **No**                                                      |
| Firewall rule or policy rule | See [[gcp-firewall-rule-standard]] | `prod-ingress-allow-lb-to-orders-tcp8080` | **No**                                                      |
| Cloud KMS key ring           | `<env>-<system>-<location>`        | `prod-orders-europe-west1`                | **No, and it can never be deleted**                         |
| Cloud KMS key                | `<purpose>`                        | `uploads-cmek`, `sops`                    | **No, and it can never be deleted**                         |
| Artifact Registry repository | `<format>-<purpose>`               | `docker-apps`, `helm-charts`              | **No**                                                      |
| GKE cluster                  | `<env>-<region>-<purpose>-<nn>`    | `prod-europe-west1-apps-01`               | **No**                                                      |
| Cloud SQL instance           | `<system>-<env>-<engine>-<nn>`     | `orders-prod-pg-01`                       | **No**, and the name is blocked for a while after deletion  |
| Pub/Sub topic                | `<system>-<event>-v<major>`        | `orders-created-v1`                       | **No**                                                      |

Notes on the patterns:

- **Project ID versus display name.** The project ID goes into every API call, every IAM binding and every script. The display name is for people. Put the friendly or changeable wording in the display name.
- **Service accounts** live inside a project, so the project already says the environment; do not repeat it. The ID says what runs as it and why: `-runtime` for a workload identity, `ci-deploy-` for a pipeline. One account per workload, per [[gcp-iam-and-service-accounts]].
- **Numbered suffixes** (`-01`) on clusters and database instances allow a replacement to be built next to the old one and traffic moved, which is how most of these resources are "renamed".
- **KMS** key rings and keys outlive everything else. The Terraform provider documents that "KeyRings cannot be deleted" and "CryptoKeys cannot be deleted" from Google Cloud. A team name in a key ring name is permanent; pick names you will still accept in ten years.
- **Cloud SQL** instance names cannot be reused for a period after deletion; the provider documents "up to one week". Plan replacements with the next number, not the same name.
- **Pub/Sub topics** carry the major version of the message schema, so a breaking schema change is a new topic and consumers migrate deliberately.

## Name limits

| Resource                                                                              | Limit                                                                                                                             | Status                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project ID                                                                            | 6 to 30 characters; starts with a lowercase letter; lowercase letters, digits, hyphens; immutable                                 | From `gcloud projects create --help`. Global uniqueness and no reuse after deletion: **not verified**, see [Creating projects](https://cloud.google.com/resource-manager/docs/creating-managing-projects)                                                                                                          |
| Folder display name                                                                   | Up to 30 characters; starts and ends with a letter or digit; letters, digits, spaces, hyphens, underscores; unique among siblings | From the Terraform [`google_folder`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_folder) docs                                                                                                                                                                            |
| Service account ID                                                                    | 6 to 30 characters, matching `[a-z]([-a-z0-9]*[a-z0-9])`; unique in the project                                                   | From the Terraform [`google_service_account`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_service_account) docs                                                                                                                                                          |
| Bucket                                                                                | Lowercase, no more than 63 characters (the Terraform rule); keep names without dots                                               | From the Terraform `google_storage_bucket` docs (read 2026-10-21). Cloud Storage itself may allow longer names when they contain dots; that and the full rules (minimum length, reserved words, global uniqueness) are **not verified**, see [Bucket naming](https://cloud.google.com/storage/docs/buckets#naming) |
| VPC network, subnet, firewall rule                                                    | 1 to 63 characters, matching `[a-z]([-a-z0-9]*[a-z0-9])?` (RFC 1035)                                                              | From the Terraform `google_compute_network`, `google_compute_subnetwork` and `google_compute_firewall` docs. Other Compute Engine resources: see [Naming resources](https://cloud.google.com/compute/docs/naming-resources)                                                                                        |
| GKE cluster                                                                           | Unique within the project and location                                                                                            | Length and characters **not verified**                                                                                                                                                                                                                                                                             |
| KMS key ring and key, Artifact Registry repository, Cloud SQL instance, Pub/Sub topic | **Not verified**                                                                                                                  | Check each service's documentation. Keeping to lowercase, hyphens and 30 characters or fewer stays inside every limit we have seen, but that is a judgement, not a documented rule                                                                                                                                 |

## Required labels

Labels are key-value pairs on a resource. They appear in Cloud Asset Inventory and are what the billing export is grouped by in [[finops-cost-allocation-and-guardrails]]. Every resource that supports labels MUST carry these six.

| Key                   | Allowed values (proposed default)                                            | Example        | Owner of the value  |
| --------------------- | ---------------------------------------------------------------------------- | -------------- | ------------------- |
| `env`                 | `prod`, `stage`, `dev`, `sbx`                                                | `prod`         | Platform team       |
| `team`                | A team alias from the on-call directory, never a person                      | `team-orders`  | Engineering manager |
| `service`             | The service or system name; equals `app.kubernetes.io/name` where one exists | `orders-api`   | Service owner       |
| `cost-center`         | A code from the finance list                                                 | `cc-1042`      | Finance partner     |
| `data-classification` | `public`, `internal`, `confidential`, `restricted`                           | `confidential` | Data owner          |
| `managed-by`          | `terraform`, `config-connector`, `manual`                                    | `terraform`    | Whoever creates it  |

Rules for the values:

- **Values come from a list**, kept in the naming module, not free text. A typo (`prod`, `production`, `prd`) splits the cost report three ways.
- **`data-classification`** uses the classes in [[data-classification-and-handling-standard]]. A project carries the highest class of data it holds.
- **`managed-by: manual`** is allowed only with an exception record; it marks the resources that drift.
- **Kubernetes uses `environment`, Google Cloud uses `env`.** [[kubernetes-labels-and-annotations-standard]] names the Kubernetes label `environment`; the Google Cloud key is `env`, as in the FinOps module. When GKE cost allocation exports Kubernetes labels into billing data, map one to the other in the report query rather than renaming either side.
- **No personal data, no secrets, no free-form descriptions** in values.

> [!warning] Label limits are not verified
> The maximum number of labels per resource, the key and value length limits and the allowed characters were **not verified** against the [labels overview](https://cloud.google.com/resource-manager/docs/labels-overview) for this note. Google Cloud labels are stricter than Kubernetes labels: keys such as `app.kubernetes.io/name` are not valid. Keeping keys and values to lowercase letters, digits, hyphens and underscores, starting keys with a letter and staying well under 63 characters avoids every limit we know of. Which resource types support labels, and which of them reach the billing export, also varies; check per service.

**Which resources can carry labels.** In the Terraform provider, projects, buckets, KMS crypto keys, Artifact Registry repositories and Pub/Sub topics have `labels`; GKE clusters have `resource_labels`; Cloud SQL instances have `settings.user_labels`. The provider documents no `labels` argument for folders, service accounts, KMS key rings, VPC networks, subnets or firewall rules. For those, the owner is found through the project they live in, and for folders and projects through resource manager tags. That is one more reason to keep projects single-purpose ([[environment-separation-on-gcp]]).

## Labels versus resource manager tags

| Question                     | Labels                                  | Resource manager tags                                             |
| ---------------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| What are they for            | Grouping, reporting, cost allocation    | Governance: IAM conditions, organization policy, firewall targets |
| Who defines them             | Whoever creates or updates the resource | Keys and values are created centrally, then bound to resources    |
| Inherited down the hierarchy | No                                      | Yes, according to the tags overview (not verified for this note)  |
| Used by firewall policies    | No                                      | Yes, through tag keys with purpose `GCE_FIREWALL`                 |

Use **labels** for the six keys above. Use **tags** when a control must depend on the value, for example an IAM condition that grants access only to `env=prod` projects, or a firewall policy rule that targets a tag. A tag key's `purpose` (`GCE_FIREWALL` or `DATA_GOVERNANCE`) cannot be changed once set, and its `short_name` is limited to 256 characters (Terraform [`google_tags_tag_key`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/tags_tag_key)). The behaviour of tags beyond those fields is not verified here; see the [tags overview](https://cloud.google.com/resource-manager/docs/tags/tags-overview) and [[gcp-organization-policy-guardrails]].

## Enforcement

### A naming module

Names and labels are built in one place. Every stack calls the module; nobody types a project ID or a bucket name.

```hcl title="modules/naming/main.tf"
variable "org" {
  type    = string
  default = "acme"
}

variable "system" {
  type        = string
  description = "Stable system name, lowercase letters, digits and hyphens."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,14}$", var.system))
    error_message = "system must be 2-15 characters: lowercase letter first, then lowercase letters, digits or hyphens."
  }
}

variable "env" {
  type = string
  validation {
    condition     = contains(["prod", "stage", "dev", "sbx"], var.env)
    error_message = "env must be one of prod, stage, dev, sbx."
  }
}

variable "labels" {
  type        = map(string)
  description = "team, service, cost-center, data-classification and managed-by."
  validation {
    condition = alltrue([
      for k in ["team", "service", "cost-center", "data-classification", "managed-by"] :
      contains(keys(var.labels), k)
    ])
    error_message = "labels must include team, service, cost-center, data-classification and managed-by."
  }
  validation {
    condition     = contains(["public", "internal", "confidential", "restricted"], lookup(var.labels, "data-classification", ""))
    error_message = "data-classification must be public, internal, confidential or restricted."
  }
  validation {
    condition = alltrue([
      for k, v in var.labels : can(regex("^[a-z][a-z0-9_-]{0,62}$", k)) && can(regex("^[a-z0-9_-]{0,63}$", v))
    ])
    error_message = "label keys and values must be lowercase letters, digits, hyphens or underscores; keys start with a letter."
  }
}

locals {
  project_id = "${var.org}-${var.system}-${var.env}"
}

output "project_id" {
  value = local.project_id
  precondition {
    condition     = length(local.project_id) >= 6 && length(local.project_id) <= 30
    error_message = "The project ID must be 6-30 characters."
  }
}

output "bucket_prefix" {
  value = "${var.org}-${var.system}-${var.env}"
}

output "labels" {
  value = merge(var.labels, { env = var.env })
}
```

The regular expressions encode our own conservative subset, not Google's full rules. The output `precondition` fails the plan when a generated project ID is too long. The module follows [[terraform-module-standard]] for layout, tests and versioning.

### Provider default labels

The Google provider's `default_labels` setting applies labels to every resource that has a top-level `labels` field (or `labels` inside a top-level `metadata` block). A label set on the resource overrides the default with the same key ([provider reference](https://registry.terraform.io/providers/hashicorp/google/latest/docs/guides/provider_reference)).

```hcl title="providers.tf"
module "naming" {
  source = "../../modules/naming"
  system = "orders"
  env    = "prod"
  labels = {
    team                  = "team-orders"
    service               = "orders-api"
    cost-center           = "cc-1042"
    data-classification   = "confidential"
    managed-by            = "terraform"
  }
}

provider "google" {
  project        = module.naming.project_id
  region         = "europe-west1"
  default_labels = module.naming.labels
}
```

Two things to know about provider labels:

- **They do not reach resources with differently named fields.** GKE clusters (`resource_labels`) and Cloud SQL (`settings.user_labels`) need the labels passed explicitly. Review those resources by hand or with a plan check.
- **Labels are non-authoritative.** Terraform manages only the keys in its configuration; `effective_labels` shows all labels on the resource, including ones added by other tools. The provider also adds `goog-terraform-provisioned = true` to new resources unless `add_terraform_attribution_label` is turned off. Ignore keys that start with `goog-` in every label check; they are added by Google or the provider.

### CI check on the plan

The plan is checked before apply, as in [[terraform-plan-policy-checks]] and [[0035-terraform-plan-policy-gate-and-ci-only-apply]]. A small check that fails on a missing required label:

```bash title="ci/check-labels.sh"
#!/usr/bin/env bash
set -euo pipefail
PLAN_JSON="${1:-plan.json}"   # from: terraform show -json tfplan > plan.json
REQUIRED='["env","team","service","cost-center","data-classification","managed-by"]'

MISSING="$(jq -r --argjson req "$REQUIRED" '
  .resource_changes[]
  | select(.change.actions | (index("create") != null) or (index("update") != null))
  | . as $rc
  | ($rc.change.after // {}) as $a
  | ($rc.change.after_unknown // {}) as $u
  | if ($u.terraform_labels == true) then
      "\($rc.address): cannot check, terraform_labels is unknown until apply"
    else
      select($a | has("terraform_labels") or has("labels") or has("resource_labels"))
      | ($a.terraform_labels // $a.labels // $a.resource_labels // {}) as $l
      | ($req - ($l | keys)) as $missing
      | select($missing | length > 0)
      | "\($rc.address): missing \($missing | join(", "))"
    end
' "$PLAN_JSON")"

if [[ -n "$MISSING" ]]; then
  printf '%s\n' "$MISSING" >&2
  exit 1
fi
echo "All labelled resources carry the required labels."
```

It reads `terraform_labels` first, because that field holds the resource's own labels merged with the provider's `default_labels`; plain `labels` holds only what the resource sets itself. When the whole `terraform_labels` map is unknown at plan time (Terraform omits it from `change.after` and marks it `true` in `change.after_unknown`), the script reports the resource as "cannot check" and fails, instead of falling back to `labels` or passing silently; review such a resource by hand, or set its labels from known values. Resources without a top-level label field are skipped, so resources that cannot carry labels do not fail. Cloud SQL keeps its labels in `settings.user_labels`, which this script does not read; the reviewer checklist covers it. Run the script against a real plan of your provider version before making it blocking, because the plan JSON shape of computed label fields is not verified here.

### Periodic audit

CI only sees what goes through CI. A scheduled job searches the whole organization with [Cloud Asset Inventory](https://cloud.google.com/asset-inventory/docs/searching-resources); the caller needs `cloudasset.assets.searchAllResources` on the scope.

```bash title="audit-labels.sh"
#!/usr/bin/env bash
set -euo pipefail
ORG_ID="123456789012"   # your organization ID

# All resources of the types we label, then those missing any required key.
gcloud asset search-all-resources \
  --scope="organizations/${ORG_ID}" \
  --asset-types='cloudresourcemanager.googleapis.com/Project,storage.googleapis.com/Bucket,container.googleapis.com/Cluster,sqladmin.googleapis.com/Instance' \
  --format=json \
  | jq -r '.[]
      | select((["env","team","service","cost-center","data-classification","managed-by"]
                - ((.labels // {}) | keys)) | length > 0)
      | [.assetType, .name, ((.labels // {}) | tostring)] | @tsv'
```

For quick questions, `--query` accepts label expressions such as `labels.env:*` (has the key) and `labels.env:prod` (has the value), as described in `gcloud asset search-all-resources --help`. A negated query for "missing label" is not used because its syntax was not verified; the filter runs in `jq` instead. The asset type strings are examples; list the ones you use with `gcloud asset search-all-resources --help` and the [supported asset types](https://cloud.google.com/asset-inventory/docs/supported-asset-types) page. Send the result to the owning teams monthly, and track the count of unlabelled resources on the FinOps dashboard.

## Migrating existing resources

| Situation                                              | Action                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Label missing or wrong                                 | Fix in place through Terraform. No downtime                                                              |
| Resource not in Terraform                              | Import it, then label it ([[0030-terraform-manages-gcp-infrastructure]])                                 |
| Name breaks the pattern, resource is fine              | Leave the name. Record it in the exception list so the audit does not report it every month              |
| Name contains personal data or a secret                | Treat as an incident: recreate under a new name, migrate, delete the old one, and check logs and exports |
| Name is wrong and the resource is being rebuilt anyway | Use the pattern for the replacement (next number suffix)                                                 |

Never rename by deleting and recreating a resource only to satisfy this standard. A project ID cannot be changed, and moving data to a new bucket or database is a production change with its own risk ([[production-change-checklist]]).

## Exceptions and expiry

Names that predate the standard, resources created by a vendor or a Google-managed service, and `managed-by: manual` resources are listed as exceptions with an owner and a review date, as in [[policy-exception-and-waiver-process]]. The audit reads the list so excepted resources do not alert. Labels have no permanent exceptions: a resource that supports labels and lacks them is a finding.

## Reviewer checklist

- [ ] New project IDs, buckets, key rings and keys come from the naming module, not literal strings.
- [ ] Names carry environment, system and purpose only; no team, person, customer or secret.
- [ ] Immutable names (project ID, bucket, KMS, service account ID) were chosen deliberately; the merge request says so.
- [ ] All six labels present with listed values; GKE and Cloud SQL get them through their own fields.
- [ ] `data-classification` matches the data the resource will hold.
- [ ] Any check that lists unknown label keys ignores the `goog-` prefix.
- [ ] Tags, not labels, are used where IAM, organization policy or firewall rules depend on the value.
- [ ] Exceptions have an owner and a review date.

## Sources

- [`gcloud projects create`](https://cloud.google.com/sdk/gcloud/reference/projects/create): project ID rules.
- [Creating and managing projects](https://cloud.google.com/resource-manager/docs/creating-managing-projects) (not verified for this note).
- [Labels overview](https://cloud.google.com/resource-manager/docs/labels-overview) (not verified for this note).
- [Tags overview](https://cloud.google.com/resource-manager/docs/tags/tags-overview) (not verified for this note).
- [Bucket naming](https://cloud.google.com/storage/docs/buckets#naming) (not verified for this note).
- [Compute Engine naming resources](https://cloud.google.com/compute/docs/naming-resources) (not verified for this note).
- [Create service accounts](https://cloud.google.com/iam/docs/service-accounts-create).
- Terraform Google provider: [provider reference (`default_labels`)](https://registry.terraform.io/providers/hashicorp/google/latest/docs/guides/provider_reference), [`google_project`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_project), [`google_service_account`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_service_account), [`google_folder`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_folder), [`google_storage_bucket`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/storage_bucket), [`google_kms_key_ring`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/kms_key_ring), [`google_compute_network`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_network).
- [Searching resources with Cloud Asset Inventory](https://cloud.google.com/asset-inventory/docs/searching-resources) and [`gcloud asset search-all-resources`](https://cloud.google.com/sdk/gcloud/reference/asset/search-all-resources).

## Related

- [[gcp-resource-hierarchy-and-landing-zone]] and [[0024-gcp-folders-by-policy-boundary]]: where folders and projects sit.
- [[environment-separation-on-gcp]]: why the environment is a project boundary.
- [[finops-cost-allocation-and-guardrails]]: how the labels become a cost report.
- [[kubernetes-labels-and-annotations-standard]]: the Kubernetes side of the same idea.
- [[terraform-module-standard]] and [[terraform-plan-policy-checks]]: the module and plan gate the checks plug into.
- [[gcp-organization-policy-guardrails]]: governance with tags and constraints.
- [[gcp-firewall-rule-standard]]: firewall rule names and descriptions.
- [[data-classification-and-handling-standard]]: the values of `data-classification`.
- [[policy-exception-and-waiver-process]]: exceptions.
