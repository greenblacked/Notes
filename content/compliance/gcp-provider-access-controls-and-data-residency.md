---
title: "Provider access and data residency on GCP: Access Transparency, Access Approval and Assured Workloads"
description: Show whether Google staff can reach your data and where it lives, with Access Transparency, Access Approval, Assured Workloads and location evidence.
type: guide
tags:
  - compliance
  - gcp
  - audit
  - security
created: 2026-10-21
modified: 2026-10-21
draft: false
aliases:
  - Access Approval
  - Access Transparency
  - data residency on GCP
---

Regulators, DORA and NIS2 assessments and enterprise customers ask two questions about a cloud platform that your own IAM cannot answer: can the provider's staff access our data, and where does the data live? Google Cloud has a set of controls for the first (Access Transparency, Access Approval, Key Access Justifications) and a mix of org policy, Assured Workloads and inventory for the second. This guide explains what each control does, what it proves, what it costs you operationally, and how to produce evidence. The location constraint itself is covered in [[compliance/gcp-organization-policy-guardrails|org policy guardrails]]; customer-managed keys in [[patterns/cloud-kms-key-management|Cloud KMS key management]].

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Not checked against a running system
> Nothing here was enabled on an organisation. Access Approval flags, Key Access Justifications flags and Assured Workloads values were checked against the installed `gcloud` help, Google's API definitions and the Terraform provider documentation on 2026-10-21. **Not verified**: how Access Transparency is enabled and which support package or tier it needs, the Access Transparency log name and fields, Access Approval's exclusions and approver roles, whether Pub/Sub notifications need enabling by Google support, Key Access Justifications prerequisites and supported services, what each Assured Workloads package enforces and costs, and the DORA and NIS2 article wording. Check them before you rely on them.

## Short answer

| Question an auditor asks                                | Control                                       | What it gives you                                                                                   |
| ------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Do we see when the provider's staff access our content? | Access Transparency                           | Logs of provider personnel access, with a justification (check the scope and prerequisites)         |
| Can we stop provider staff access unless we approve?    | Access Approval                               | Requests that wait for your approval, with exclusions (check the list) and an SLA impact            |
| Can we refuse key use for some reasons?                 | Key Access Justifications                     | A per-key list of allowed justification reasons for Cloud KMS operations (check supported services) |
| Is our data only in approved locations?                 | `gcp.resourceLocations` org policy, inventory | Prevention at create time, plus an inventory by location                                            |
| Do we have a packaged set of controls for a regime?     | Assured Workloads                             | A folder with a compliance regime's controls applied (check what each package enforces)             |

None of them is a replacement for encryption under your own keys, your own IAM, and a contract that says what the provider may do. They are evidence that the contract and the configuration line up.

## The questions behind the controls

Write the questions down before choosing controls, because each control answers only some of them:

1. **Visibility**: do we know when the provider accessed our data, why, and who on their side approved it?
2. **Prevention**: can we refuse access, and what happens to support and availability if we do?
3. **Cryptographic control**: is the data encrypted with keys we control, and can we refuse key use?
4. **Residency**: where is data at rest stored and processed, including backups, logs and support artefacts?
5. **Assurance**: what independent assurance covers the provider's own processes? See [[compliance/vendor-soc2-report-review-for-devops-saas|reviewing a vendor SOC 2 report]] for reading it.

## Access Transparency

Access Transparency produces log entries when Google personnel access your content, with information such as the reason for the access. It is the visibility control and the basis for the others. What it covers, how it is enabled (at the organisation level, in the console), and whether it needs a particular support package, tier or Assured Workloads were **not verified**; check the Access Transparency overview for the current prerequisites and pricing.

Once it is on, route the logs with the rest of your audit logs to the central log bucket and the SIEM ([[patterns/gcp-audit-logs-siem|audit logs to the SIEM]], [[adr/0044-central-log-sinks-and-retention-tiers|ADR-0044]]). The log name is believed to be `cloudaudit.googleapis.com/access_transparency` (in a filter, `logName="projects/PROJECT_ID/logs/cloudaudit.googleapis.com%2Faccess_transparency"`, with the slash URL-encoded); confirm it against a real entry before you build alerts on it. A substring filter matches the log under any project, folder or organisation prefix:

```bash title="scripts/access-transparency-read.sh"
set -euo pipefail

ORG_ID="123456789012"   # change: organisation ID

# Illustrative filter: confirm the log name against a real entry first.
gcloud logging read 'logName:"access_transparency"' \
  --organization="${ORG_ID}" --freshness=30d --limit=20 --format=json
```

A log-based alert on any new entry gives the security team a chance to ask "was this expected?". Most entries follow your own support cases; an entry without a matching case is the one worth investigating.

## Access Approval

Access Approval makes certain provider access wait for your explicit approval. It is the prevention control, and it has real operational cost.

> [!warning] Access Approval can slow support and void SLAs
> Google's own API definition says that using Access Approval "will mean that Google may not be able to meet the SLAs for your chosen products, as any support response times may be dramatically increased", that the SLAs do not apply to service disruption to the extent caused by its use, and that you should not enable it "for projects where you may require high service availability and rapid response by Google Cloud Support". Decide per folder or project, with the service owner, and check pricing and prerequisites.

What the API definitions and `gcloud` help confirm:

- Settings exist at **project, folder and organisation** level. At organisation level you can enrol individual services; at folder or project level enrolment is all or nothing (`all`). The API allows at most 10 enrolled services and 50 notification emails, and notification emails set on an ancestor also apply below it.
- Pending requests are emailed to the notification addresses. They can also go to a Pub/Sub topic you own (`--notification_pubsub_topic`); the API comment says to contact support to enable Pub/Sub notifications, so check whether that still applies.
- A request whose requested expiration has passed, or with no activity for 14 days, is considered dismissed. Google personnel can access only if a request is approved, subject to exclusions listed on the Access Approval overview page; read that list, because the exclusions are what your auditor will ask about.
- You can sign approvals with your own Cloud KMS key (`--active_key_version`); empty means a Google-managed key signs.

Flag names for `gcloud access-approval settings update` use **underscores**, not hyphens:

```bash title="scripts/access-approval.sh"
set -euo pipefail

FOLDER_ID="222222222222"                                  # change: the folder that holds restricted projects
EMAILS="cloud-approvals@example.com,security-oncall@example.com"   # change: monitored group addresses

# Current settings, including inherited enrolment (read-only).
gcloud access-approval settings get --folder="${FOLDER_ID}"

# Enrol everything under the folder and set who is notified.
gcloud access-approval settings update --folder="${FOLDER_ID}" \
  --enrolled_services=all \
  --notification_emails="${EMAILS}"

# List pending requests (--state defaults to pending).
gcloud access-approval requests list --folder="${FOLDER_ID}" --state=pending
```

The same in Terraform, for the folder:

```hcl title="org/access-approval.tf"
variable "restricted_folder_id" {
  type        = string
  description = "Folder ID that holds projects with restricted data."   # change
}

resource "google_folder_access_approval_settings" "restricted" {
  folder_id           = var.restricted_folder_id
  notification_emails = ["cloud-approvals@example.com", "security-oncall@example.com"]   # change

  enrolled_services {
    cloud_product = "all"   # folders and projects: all or nothing
  }
}
```

`google_organization_access_approval_settings` and `google_project_access_approval_settings` exist for the other levels. If you sign with your own key, the `google_access_approval_folder_service_account` data source gives the service account that needs `roles/cloudkms.signerVerifier` on that key.

Who approves: the role names for approvers and viewers are believed to be `roles/accessapproval.approver`, `roles/accessapproval.viewer` and `roles/accessapproval.configEditor` (check). Grant approval to a small on-call group, not to individuals, and never to the people who raised the support case on your side if you want separation of duties. Write a runbook: who looks at a request, what they check (is there a matching support case, is the scope narrow, is the justification sensible), how fast they must answer, and where the decision is recorded.

## Key Access Justifications

Key Access Justifications (KAJ) let a Cloud KMS key carry a list of allowed access reasons. Each request to use the key arrives with a justification code, and the key refuses codes that are not on the list. From the KMS API definition and `gcloud` help:

- The policy is set with `--allowed-access-reasons` on `gcloud kms keys create` or `update`, and removed with `--remove-key-access-justifications-policy`. The `gcloud` help says the key must be enrolled in Key Access Justifications before the field can be set.
- With no policy on the key, all justification codes are allowed. With a policy whose list is **empty**, all encrypt, decrypt and sign operations fail. That is an outage switch, not a setting to experiment with.
- Reason codes include `CUSTOMER_INITIATED_SUPPORT`, `GOOGLE_INITIATED_SERVICE`, `THIRD_PARTY_DATA_REQUEST`, `GOOGLE_INITIATED_REVIEW`, `CUSTOMER_INITIATED_ACCESS`, `GOOGLE_INITIATED_SYSTEM_OPERATION` and `REASON_NOT_EXPECTED`, among others. Use the full current list from the docs, not this subset.

```bash title="scripts/kaj-policy.sh"
set -euo pipefail

KMS_PROJECT="example-kms-prod"; LOCATION="europe-west1"   # change
KEYRING="restricted"; KEY="payments-cmek"                  # change

gcloud kms keys describe "${KEY}" --project="${KMS_PROJECT}" \
  --location="${LOCATION}" --keyring="${KEYRING}" \
  --format="yaml(name,keyAccessJustificationsPolicy)"

# Example only: allow customer-initiated access and support, refuse the rest.
# Test on a non-production key first; check the reason names in the current docs.
# gcloud kms keys update "${KEY}" --project="${KMS_PROJECT}" \
#   --location="${LOCATION}" --keyring="${KEYRING}" \
#   --allowed-access-reasons=customer-initiated-access,customer-initiated-support
```

Which services and key protection levels support KAJ, whether it needs Cloud EKM or Assured Workloads, and how it is priced were **not verified**; the `gcloud` examples pair it with external keys but do not state a requirement. Check the Key Access Justifications overview. A KAJ policy that refuses a reason a service depends on breaks that service, so roll it out per key with monitoring on KMS errors.

## Assured Workloads

Assured Workloads creates a folder (and optionally projects) with a compliance regime's controls applied, for example location restrictions, personnel and support restrictions, and key management settings, and monitors for violations. `gcloud assured workloads` has `create`, `describe`, `list`, `update`, `delete`, `enable-resource-monitoring` and a `violations` group.

The installed `gcloud` lists many values for `--compliance-regime`, including the EU-relevant `eu-regions-and-support` and `eu-data-boundary-and-support`; sovereign controls (`--enable-sovereign-controls`) are described as supported only by `EU_REGIONS_AND_SUPPORT` at the time of the help text. The list in the API definition we read was shorter than the CLI's, which is itself the lesson: **packages change**. Check the current list and what each package enforces before you choose.

```bash title="scripts/assured-workload.sh"
set -euo pipefail

ORG_ID="123456789012"                          # change
LOCATION="europe-west3"                        # change: check the supported Assured Workloads locations
BILLING="billingAccounts/000000-000000-000000" # change: billing account ID
PARENT_FOLDER="folders/333333333333"           # change: where the workload folder is created

gcloud assured workloads create \
  --organization="${ORG_ID}" \
  --location="${LOCATION}" \
  --display-name="restricted-eu" \
  --compliance-regime=eu-regions-and-support \
  --billing-account="${BILLING}" \
  --provisioned-resources-parent="${PARENT_FOLDER}"

gcloud assured workloads list --organization="${ORG_ID}" --location="${LOCATION}"
```

Terraform has `google_assured_workloads_workload`. Things to check before committing: whether existing projects can be moved into a workload (believed not straightforward, since the workload creates its own folder), which services are allowed under the package, regional availability, and cost. Treat the workload folder as a policy boundary in the landing zone ([[architecture/gcp-resource-hierarchy-and-landing-zone|resource hierarchy]]).

## Residency evidence

Prevention is the location org policy (`gcp.resourceLocations`), already covered in [[compliance/gcp-organization-policy-guardrails|org policy guardrails]], with primary and DR regions chosen per environment ([[adr/0028-primary-and-dr-regions-per-environment|ADR-0028]]). Evidence is an inventory that shows where everything actually is. Cloud Asset Inventory supports a `location:` query term and a `location` output field:

```bash title="scripts/residency-inventory.sh"
set -euo pipefail

ORG_ID="123456789012"                          # change
ALLOWED_REGEX='^(europe-west1|europe-west3|eu|EU|global)$'   # change: approved locations; global only if accepted
OUT="residency-$(date +%Y-%m-%d)"
mkdir -p "${OUT}"

gcloud asset search-all-resources --scope="organizations/${ORG_ID}" \
  --format="csv[no-heading](name,assetType,location)" > "${OUT}/all.csv"

# Resources outside the approved list: each needs a fix or an exception.
awk -F, -v re="${ALLOWED_REGEX}" '$3 !~ re' "${OUT}/all.csv" > "${OUT}/outside.csv"
wc -l "${OUT}/outside.csv"

# Everything in the global location, for the exception list.
gcloud asset search-all-resources --scope="organizations/${ORG_ID}" \
  --query="location:global" \
  --format="csv(name,assetType)" > "${OUT}/global.csv"
```

`global` is the hard part. Some services and resources have no region, and for a `global` log bucket the Logging API says it is unspecified where entries are stored; a bucket's location also cannot be changed after creation. Create the central audit log bucket in a regional or EU location from the start. Keep a reviewed exception list for global resources:

```yaml title="residency/global-exceptions.yaml"
- asset_type: "iam.googleapis.com/ServiceAccount" # example: identities are global
  reason: "Identity metadata, no customer content"
  accepted_by: security-lead
  review_on: 2027-04-21
- asset_type: "logging.googleapis.com/LogBucket"
  name_pattern: "_Default"
  reason: "Default bucket; restricted projects route logs to the regional central bucket"
  accepted_by: security-lead
  review_on: 2027-04-21
```

Schedule the inventory and send `outside.csv` to owners ([[compliance/continuous-control-monitoring-gcp-and-gke|continuous control monitoring]]); store each dated run as evidence ([[compliance/audit-evidence-collection-and-retention|audit evidence]]).

## What each control proves, and what it costs

| Control                     | Prerequisite (check)                   | Evidence it produces                               | Operational cost                                                |
| --------------------------- | -------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| Location org policy         | Org policy admin                       | Policy as code, dry-run and denial logs            | Some services blocked; exceptions to manage                     |
| Asset inventory by location | Cloud Asset API, viewer access         | Dated inventory, exception list                    | A scheduled job and a review                                    |
| Access Transparency         | Check support or tier requirements     | Log entries of provider access with justifications | Alert triage                                                    |
| Access Approval             | Check requirements and pricing         | Approval requests and decisions                    | Slower support; SLAs may not apply; an approver rota            |
| Key Access Justifications   | CMEK; check EKM or other requirements  | Key policy, KMS audit logs of refused requests     | Risk of refusing a reason a service needs                       |
| Assured Workloads           | Check package availability and pricing | Workload configuration, violation reports          | Limited services, new folder structure, package-specific limits |

## What none of these proves

- **That no copy exists elsewhere.** Data you export, send to a SaaS, attach to a support case or copy to a laptop is outside every control here.
- **That the provider's own processes are sound.** That needs independent assurance and contract terms, reviewed like any vendor ([[compliance/vendor-soc2-report-review-for-devops-saas|vendor SOC 2 review]]).
- **That access is impossible.** Access Approval has exclusions, and Access Transparency shows access after the fact.
- **That encryption keys are yours.** Only CMEK or external keys give you that, and only for services that support them ([[compliance/encryption-at-rest-and-in-transit-evidence-gcp|encryption evidence]]).

## Mapping to DORA and NIS2

Both regimes ask regulated entities to manage the risk of their ICT providers, including access to data and the location of data and processing. Article numbers and wording were not verified for this note; check the current texts.

- **DORA**: third-party risk management and the register of information (see [[compliance/dora-eu-operational-resilience-for-engineers|DORA for engineering teams]]). The register entry for your cloud provider can reference this guide's evidence: the location policy and inventory for data location, Access Transparency and Access Approval for provider access, Assured Workloads if used.
- **NIS2**: supply chain security among the risk-management measures (see [[compliance/nis2-basics-for-engineering-teams|NIS2 basics]]).

## Pitfalls

- **Enabling Access Approval on everything.** Production incidents then wait for an approver at the moment Google support is trying to help. Scope it to restricted folders, and agree the trade-off with the service owners.
- **Approvers nobody pages.** Requests expire or are dismissed after 14 days of inactivity; a support case stalls long before that. Route notifications to an on-call group.
- **An empty KAJ list.** All operations on the key fail.
- **A `global` central log bucket.** Its storage location is unspecified, and it cannot be moved later.
- **Treating Assured Workloads as a checkbox.** Read what the package enforces; it may not match your contract's wording on residency or support.
- **Residency without an exception list.** Global services show up in every inventory; without an accepted list, the report is either noise or a lie.
- **Assuming cost and tier.** Several of these controls have prerequisites and pricing that change; check them before promising them to a customer.

## Related

- [[compliance/gcp-organization-policy-guardrails]]: the location constraint and other guardrails.
- [[compliance/encryption-at-rest-and-in-transit-evidence-gcp]] and [[patterns/cloud-kms-key-management]]: keys under your control.
- [[compliance/data-classification-tags-gcp-and-kubernetes]]: deciding which folders get which controls.
- [[compliance/data-deletion-and-crypto-shredding-gcp]]: deletion with customer-managed keys.
- [[adr/0028-primary-and-dr-regions-per-environment]]: approved regions.
- [[compliance/continuous-control-monitoring-gcp-and-gke]]: scheduling the inventory.
- [[compliance/vendor-soc2-report-review-for-devops-saas]]: assurance over the provider's own processes.

## Sources

- Google Cloud, [Access Transparency overview](https://cloud.google.com/assured-workloads/access-transparency/docs/overview).
- Google Cloud, [Access Approval overview](https://cloud.google.com/assured-workloads/access-approval/docs/overview) and [REST reference for folders](https://cloud.google.com/access-approval/docs/reference/rest/v1/folders).
- Google Cloud, [Key Access Justifications overview](https://cloud.google.com/assured-workloads/key-access-justifications/docs/overview).
- Google Cloud, [Assured Workloads overview](https://cloud.google.com/assured-workloads/docs/overview).
- Google Cloud, [Resource locations supported services](https://cloud.google.com/resource-manager/docs/organization-policy/defining-locations-supported-services).
- HashiCorp, [google_folder_access_approval_settings](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/folder_access_approval_settings), [google_organization_access_approval_settings](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/organization_access_approval_settings) and [google_assured_workloads_workload](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/assured_workloads_workload).
- EUR-Lex, [Regulation (EU) 2022/2554 (DORA)](https://eur-lex.europa.eu/eli/reg/2022/2554/oj) and [Directive (EU) 2022/2555 (NIS2)](https://eur-lex.europa.eu/eli/dir/2022/2555/oj).
