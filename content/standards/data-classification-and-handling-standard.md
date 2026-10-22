---
title: Data classification and handling standard
description: "Four data classes and what each requires on GCP, GKE and in CI: storage, encryption, access, logging, retention, non-production copies and AI tools."
type: standard
tags:
  - standards
  - security
  - gcp
  - audit
  - policy-as-code
created: 2026-10-21
modified: 2026-10-21
draft: false
---

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your data protection officer, auditor, assessor or legal counsel decides what counts as personal data, what a regulation or contract requires, and whether a control is sufficient. Regulatory texts are linked, not interpreted.

Logging rules, retention tiers, encryption decisions, VPC Service Controls and access reviews all depend on one question: how sensitive is this data? Without a shared answer, each team decides alone, the decision is invisible to the tools that should enforce it, and the most sensitive copy usually ends up in the least protected place (a debug log, a CI artifact, a staging database, a prompt to a chatbot). This standard defines four data classes and, for each, what is required wherever the data lives or travels.

It is the classification that [[adr/0059-cmek-where-data-classification-requires-it]] uses for encryption decisions and that [[gcp-resource-naming-and-labels-standard]] puts in the `data-classification` label. How to make classes machine-readable with tags and admission policies is in [[compliance/data-classification-tags-gcp-and-kubernetes]].

## Scope

Applies to all data that engineering systems store, process or move: databases, buckets, BigQuery datasets, logs and traces, backups, CI artifacts and caches, container images, tickets and chat exports, and data sent to third-party services, including AI tools. It covers production and non-production environments, workstations included.

> [!info] Keywords
> MUST means a review or an automated check blocks the change. SHOULD means the data owner records why a deviation is acceptable. Retention periods, review cadences and approval chains in this note are proposed team defaults, not regulatory figures. GCP behaviour was checked on 2026-10-21 against the Google Cloud API definitions and `gcloud` help listed in Sources.

## Roles

| Role                 | Who                                         | Responsibility                                                                     |
| -------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Data owner           | A business or product lead for the data set | Assigns the class, approves access and exports, approves downgrades                |
| Service owner        | The engineering team that runs the store    | Applies the controls, labels resources, keeps the README and catalog entry current |
| Platform team        | Platform engineering                        | Provides the guarded paths: projects, keys, perimeters, log routing, policies      |
| Security and privacy | Security team and the privacy office        | Review Restricted data flows, exceptions and incidents; decide on notifications    |

## Classes

| Class        | Label value    | Meaning                                                                                  | Examples                                                                                                                                                                           |
| ------------ | -------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public       | `public`       | Approved for publication. Disclosure causes no harm                                      | Published documentation, open-source code, public container images, status page content                                                                                            |
| Internal     | `internal`     | Normal working data. Disclosure is embarrassing but causes little harm                   | Build logs without secrets, internal dashboards, non-personal metrics, private source code, non-production test data with no personal data                                         |
| Confidential | `confidential` | Disclosure harms customers or the company                                                | Business and financial data, customer configuration, customer data without regulatory scope, pseudonymised personal data, architecture and network details, Data Access audit logs |
| Restricted   | `restricted`   | Disclosure causes serious harm or triggers legal, contractual or regulatory consequences | Personal data in regulatory scope, payment card data, special categories of personal data, credentials and private keys, Terraform state, production database dumps                |

Rules for assigning a class:

- **Unclassified means Confidential** until the data owner decides (proposed team default). Nothing defaults to Internal or Public.
- **The highest class wins.** A bucket, project, log stream or backup that holds data of several classes takes the highest one. A project carries the highest class of data it holds.
- **Aggregation can raise the class.** Individually harmless fields (a user ID, a location, a timestamp) can identify a person together. The data owner considers the combination, not each field.
- **Pseudonymised is not anonymous.** Data that can be re-identified with a key or another data set is at least Confidential. Whether data is personal data in a legal sense is decided by the privacy office, not by this table ([GDPR text](https://eur-lex.europa.eu/eli/reg/2016/679/oj); [[compliance/pci-dss-and-gdpr-for-devops-logs-and-data]]).
- **Secrets are always Restricted**, wherever they appear, and a leaked one follows [[runbooks/leaked-credential-rotation]] before anything else.

## Handling matrix: storage and protection

| Control                | Public                           | Internal                                  | Confidential                                                                                        | Restricted                                                                                                                                        |
| ---------------------- | -------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where it may be stored | Any approved service             | Organisation projects in approved regions | Organisation projects in approved regions; managed devices only                                     | Projects classified `restricted`, in the named regions of [[adr/0028-primary-and-dr-regions-per-environment\|ADR-0028]], never on workstations    |
| Encryption at rest     | Google default encryption        | Google default encryption                 | Google default; CMEK when a contract requires it                                                    | CMEK, one key per data store ([[adr/0059-cmek-where-data-classification-requires-it\|ADR-0059]])                                                  |
| Encryption in transit  | TLS for anything with a login    | TLS                                       | TLS                                                                                                 | TLS, private connectivity to managed services where available ([[compliance/encryption-at-rest-and-in-transit-evidence-gcp\|evidence]])           |
| Human access           | Anyone may read; writes reviewed | Staff, through groups                     | Need-to-know groups, reviewed quarterly ([[compliance/access-reviews-gcp-and-gke\|access reviews]]) | No standing human access to the data; just-in-time with approval ([[compliance/privileged-access-just-in-time-gcp-gke\|JIT]]), reviewed quarterly |
| Workload access        | n/a                              | Dedicated service accounts                | Dedicated service accounts, least privilege                                                         | Dedicated service accounts per store; no keys; key-use visible in Cloud KMS audit logs                                                            |
| Exfiltration controls  | n/a                              | Org policy guardrails (no public buckets) | Org policy guardrails                                                                               | Inside a VPC Service Controls perimeter ([[adr/0058-vpc-service-controls-for-production-data\|ADR-0058]], proposed), dry run before enforcement   |
| Backups                | Optional                         | Per service tier                          | Same class and region rules as the source                                                           | Same class, key class and region rules as the source; restore drills per [[adr/0051-backups-proven-by-quarterly-restore-drills\|ADR-0051]]        |
| Audit logging          | Admin Activity                   | Admin Activity                            | Admin Activity; Data Access on key stores                                                           | Admin Activity and Data Access, routed to the central bucket ([[adr/0044-central-log-sinks-and-retention-tiers\|ADR-0044]])                       |

## Handling matrix: use and movement

| Control                                    | Public              | Internal                                                                        | Confidential                                                                                                | Restricted                                                                                                                    |
| ------------------------------------------ | ------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| In application logs and traces             | Allowed             | Allowed                                                                         | Pseudonymous identifiers only                                                                               | **Never.** Not in logs, traces, metrics labels or error messages ([[structured-logging-conventions#Never log\|Never log]])    |
| Retention                                  | Per artifact policy | Per the log and artifact tiers                                                  | Defined per data set by the data owner                                                                      | Defined per data set, with documented deletion and evidence ([[compliance/data-deletion-and-crypto-shredding-gcp\|deletion]]) |
| Export or sharing outside the organisation | Allowed             | Data owner approval                                                             | Data owner approval and a contract or agreement that covers it                                              | Data owner, security and privacy approval, recorded; encrypted transfer; recipient named                                      |
| Non-production copies                      | Allowed             | Allowed                                                                         | Allowed without personal data; otherwise masked or synthetic                                                | **Never** copied to non-production. Use synthetic data or irreversibly masked extracts approved by the data owner             |
| CI job logs, artifacts and caches          | Allowed             | Allowed; artifacts expire per [[artifact-retention-policy]]                     | Not in job logs; artifacts only in protected pipelines, short expiry                                        | **Never** in job logs, artifacts, caches or test fixtures                                                                     |
| Tickets, chat and documents                | Allowed             | Allowed                                                                         | Links to the system of record, not copies                                                                   | References only (a record ID), never the data                                                                                 |
| AI tools and LLM APIs                      | Allowed             | Approved tools only ([[ai/ai-coding-assistant-admin-controls\|admin controls]]) | Approved tools behind the gateway's redaction ([[ai/redacting-sensitive-data-before-llm-calls\|redaction]]) | **Never**, including prompts, pasted logs, screenshots and attached files                                                     |

The AI row is team policy. No vendor's data-retention or training terms were checked for this note; the approved-tools list records which terms were accepted and by whom.

## Labelling

Classes are useful only when tools can read them. Use the same lowercase values everywhere: `public`, `internal`, `confidential`, `restricted`.

| Where                                                        | Key                                      | Purpose                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GCP resource labels (projects, buckets, datasets, instances) | `data-classification`                    | Inventory, cost and search ([[gcp-resource-naming-and-labels-standard]])                               |
| GCP Resource Manager tags (folders, projects)                | `data-class` tag key at the organisation | Conditions in organisation policy and IAM ([[compliance/data-classification-tags-gcp-and-kubernetes]]) |
| Kubernetes namespaces                                        | `example.com/data-class`                 | Admission policy and node isolation; change `example.com` to your domain prefix                        |
| Cloud KMS keys                                               | `data_class` (as required by ADR-0059)   | Key inventory                                                                                          |
| Repositories                                                 | README and `catalog-info.yaml`           | Humans and the catalog ([[repository-baseline-standard]])                                              |

On GCP, a Resource Manager project label key is 1 to 63 characters and must match `[a-z]([-a-z0-9]*[a-z0-9])?`, the value is 0 to 63 characters with the same pattern, and a resource has at most 64 labels. Other services may have different limits; check the docs for each. Labels are descriptive and anyone who can edit the resource can change them, which is why policy conditions use tags, whose binding is controlled with IAM.

Find projects without the label:

```bash title="Projects missing data-classification"
gcloud projects list \
  --filter='-labels.data-classification:*' \
  --format='value(projectId)'
```

The hyphenated key parses and evaluates as intended in the filter engine of the installed Google Cloud SDK 570.0.0 (checked locally on 2026-10-21 against sample data, not against a live organisation). Whether `projects list` evaluates it client-side or translates it into a server-side query was not verified, so compare the output with the Cloud Asset Inventory query before relying on it. For a full inventory across resource types use Cloud Asset Inventory as shown in [[gcp-resource-naming-and-labels-standard]].

## Discovery with Sensitive Data Protection

Labels record what people decided. Discovery finds data where nobody decided anything. Sensitive Data Protection (the product formerly called Cloud DLP; the API is still `dlp.googleapis.com`) can profile data with a discovery configuration at organisation, folder or project level. Each profile gets a **sensitivity score** (`SENSITIVITY_LOW`, `SENSITIVITY_MODERATE`, `SENSITIVITY_HIGH`, or unknown) and a **data risk level**, and the profile's actions can export profiles to BigQuery, publish to Pub/Sub, and **tag the profiled resource** with a Resource Manager tag value chosen per sensitivity level. By default only new profiles trigger tagging; include profile updates in the action's trigger to retag on change.

Rules:

- Google's sensitivity score is an **input to review, not the class**. The proposed mapping is: `SENSITIVITY_HIGH` raises a finding to review the resource as Restricted, `SENSITIVITY_MODERATE` as Confidential. The data owner confirms the class.
- Discovery never lowers a class automatically. The tagging action has an option to lower the reported data risk when a tag is applied; do not use it to make findings disappear.
- A resource found with a higher sensitivity than its label is handled as misclassified data (below).

> [!note] Not verified
> Which data sources Sensitive Data Protection can profile, its pricing, the infoTypes it detects and how to scope discovery to particular resources were not checked for this note; only the API's actions and score values were. Read the [data profiles documentation](https://cloud.google.com/sensitive-data-protection/docs/data-profiles) before enabling discovery, and estimate the cost first.

## Platform settings that carry irreversible risk

Several controls this standard relies on cannot be undone. Make them deliberate changes with a second reviewer.

> [!danger] Locked log buckets and key destruction are permanent
> A Cloud Logging bucket with `locked` set cannot have its retention changed, and it can be deleted only when empty (`gcloud logging buckets update BUCKET --locked --retention-days=N`). Lock only after compliance has agreed the period, as [[adr/0044-central-log-sinks-and-retention-tiers|ADR-0044]] requires. A Cloud KMS key version scheduled for destruction stays in `DESTROY_SCHEDULED` for the key's destroy-scheduled duration (30 days if not set at creation, and immutable after creation) and is then destroyed; data encrypted only with it, including backups, is unrecoverable. See [[cloud-kms-key-management]].

Other facts that shape the controls:

- **Log retention.** A log bucket keeps entries for its `retention_days`, minimum 1 day; a bucket created with 0 gets the default of 30 days. Exclusion filters can drop entries routed by the `_Default` sink, but the `_Required` sink cannot be modified and its logs cannot be excluded.
- **VPC Service Controls dry run.** A perimeter change can be tested with a dry-run spec. Without an explicit dry-run spec (`use_explicit_dry_run_spec`), the enforced configuration is used as the dry run and **no dry-run audit logs are generated**, so a "clean" dry run proves nothing. Follow [[adr/0058-vpc-service-controls-for-production-data|ADR-0058]] and [[architecture/zero-trust-access-iap-and-vpc-service-controls]].
- **Default encryption.** Google Cloud encrypts customer data at rest by default; the details are on the [default encryption page](https://cloud.google.com/docs/security/encryption/default-encryption), which was not re-read for this note. Evidence for auditors is in [[compliance/encryption-at-rest-and-in-transit-evidence-gcp]].

## Misclassified or leaked data

Restricted or Confidential data found where its class does not allow it (a production export in a dev bucket, card numbers in application logs, a database dump attached to a ticket, customer data pasted into an AI tool) is a security incident, not a clean-up task.

1. **Credentials first.** If secrets are involved, rotate them now with [[runbooks/leaked-credential-rotation]]. Deleting the copy does not un-leak a credential.
2. **Declare and grade** the incident with [[adr/0050-incident-severity-levels-and-roles|ADR-0050]] and tell security and the privacy office. They decide whether any notification to customers, regulators or card brands is needed and by when; engineering does not make that call.
3. **Stop the flow.** Fix the source (the log statement, the export job, the pipeline step) before cleaning up, or the copy reappears.
4. **Contain.** Restrict access to the location that holds the copy, and record who could read it and for how long (from audit logs).
5. **Remove copies** within the retention and deletion mechanics of each system, including caches, backups and downstream exports, and keep evidence of what was removed ([[compliance/data-deletion-and-crypto-shredding-gcp]]). Check [[compliance/legal-hold-for-logs-and-artifacts]] first: a hold overrides deletion.
6. **Learn.** Run a [[blameless-postmortems|blameless postmortem]] and add the missing control (a redaction rule, a CI check, a policy).

> [!warning] Not verified
> Whether individual Cloud Logging entries can be deleted, and the deletion options for each data store, were not checked for this note. Decide with security how to remove log copies (shorter retention on a dedicated bucket, or deleting the bucket) before you act; a locked bucket cannot be changed.

## Reclassification

- **Raising a class** takes effect immediately. The service owner applies the new controls within 30 days (proposed team default) and records any gap as an exception until then. Some controls cannot be added in place: a store may need to be copied to a new resource to use CMEK ([[adr/0059-cmek-where-data-classification-requires-it|ADR-0059]]).
- **Lowering a class** needs the data owner's approval and evidence (for example a reviewed anonymisation method), recorded with the date and the reason. Tags and labels are changed only through the reviewed pipeline, never by hand in the console.
- **Review** each Restricted data set's class yearly and after a major change in what it holds (proposed team default).

## Exceptions

An exception records the data set, the class, the rule that cannot be met, the reason, a compensating control, the data owner's approval, security's review and an expiry date (proposed default 90 days), through [[compliance/policy-exception-and-waiver-process]]. Restricted data in non-production environments, in CI artifacts or in AI tools is not accepted as an exception.

## Reviewer checklist

- [ ] Every new data store, bucket, dataset, log stream and backup has a class, recorded in its labels, the project tag, the namespace label and the README.
- [ ] The class is the highest of the data held; unclassified data is treated as Confidential.
- [ ] Restricted: CMEK per ADR-0059, named regions, inside the perimeter, no standing human access, Data Access logs on.
- [ ] No Restricted values in logs, traces, metric labels, CI output, tickets or AI tools; Confidential only as pseudonymous identifiers.
- [ ] Non-production uses synthetic or approved masked data; no production Restricted copies.
- [ ] Retention and deletion are defined per data set, and legal holds are respected.
- [ ] Exports outside the organisation are approved and recorded.
- [ ] Irreversible changes (log bucket locks, key destruction, perimeter enforcement) have a second reviewer and a dry run where one exists.

## Sources

Checked 2026-10-21 against the Google Cloud API definitions in [googleapis/googleapis](https://github.com/googleapis/googleapis) and `gcloud` help, which are the reference text behind these pages:

- [Resource Manager: labels](https://cloud.google.com/resource-manager/docs/labels-overview): project label key and value pattern, 64 labels per resource (from `google/cloud/resourcemanager/v3/projects.proto`).
- [Sensitive Data Protection: data profiles](https://cloud.google.com/sensitive-data-protection/docs/data-profiles): discovery configurations, sensitivity and risk levels, profile actions, tagging (from `google/privacy/dlp/v2/dlp.proto`).
- [Cloud Logging: routing and storage overview](https://cloud.google.com/logging/docs/routing/overview): bucket retention, locked buckets, `_Required` and `_Default` sinks, exclusions (from `google/logging/v2/logging_config.proto` and `gcloud logging buckets update --help`).
- [Cloud KMS: customer-managed encryption keys](https://cloud.google.com/kms/docs/cmek): destroy-scheduled duration, protection levels, rotation (from `google/cloud/kms/v1/resources.proto` and `gcloud kms keys create --help`).
- [VPC Service Controls overview](https://cloud.google.com/vpc-service-controls/docs/overview): perimeter types, dry-run spec and its audit logs (from `google/identity/accesscontextmanager/v1/service_perimeter.proto` and `gcloud access-context-manager perimeters dry-run --help`).
- [Default encryption at rest](https://cloud.google.com/docs/security/encryption/default-encryption): linked, not re-read.
- [ISO/IEC 27001](https://www.iso.org/standard/27001): the information classification and labelling controls are in Annex A; control titles are not quoted here, see the standard and [[compliance/iso-27001-annex-a-for-platform-teams]].
- [Regulation (EU) 2016/679 (GDPR)](https://eur-lex.europa.eu/eli/reg/2016/679/oj): linked for the definition of personal data; not interpreted here.

## Related

- [[adr/0059-cmek-where-data-classification-requires-it]]: encryption by class.
- [[compliance/data-classification-tags-gcp-and-kubernetes]]: tags, labels and policies that enforce the class.
- [[gcp-resource-naming-and-labels-standard]]: the `data-classification` label.
- [[structured-logging-conventions]]: what never goes into logs.
- [[compliance/pci-dss-and-gdpr-for-devops-logs-and-data]]: logs, CI and test data under PCI DSS and GDPR.
- [[cloud-kms-key-management]]: key rotation and destruction.
- [[architecture/secrets-architecture-gcp-and-gke]]: where secrets live instead.
- [[service-tiering-standard]]: criticality, an independent axis from the data class.
