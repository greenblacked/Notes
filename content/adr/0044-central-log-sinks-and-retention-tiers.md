---
title: Audit logs go to a central locked bucket; application logs use retention tiers
description: Aggregated sinks route audit logs to a locked bucket in a logging project, and other logs get per-class retention, exclusions and a Cloud Storage archive.
type: adr
tags:
  - adr
  - observability
  - gcp
  - audit
  - cost
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0044
---

> [!warning] Not legal or audit advice
> This record describes an engineering decision. Retention periods, evidence requirements and data-protection duties depend on your regulators, contracts and auditors. Confirm them with your compliance and legal people before you set or lock any retention period.

## Context

Logs sit in each project's default buckets, with default retention and no common policy. That causes four problems:

- Audit logs (who changed what, who read what) are scattered across projects. A project owner who can delete the project can also delete its evidence.
- Retention is whatever the default happens to be, which is rarely what an audit or an investigation needs.
- Debug-level application logs are billed at the same rate as security evidence.
- Personal data in application logs has no retention limit at all, which conflicts with data-protection principles (see [[pci-dss-and-gdpr-for-devops-logs-and-data]]).

We need one central, tamper-resistant place for audit evidence, and a cheaper, shorter-lived treatment for everything else.

## Decision

We will route **audit logs through organisation-level aggregated sinks into a locked log bucket in a dedicated logging project**, and give **application logs per-class retention tiers** with exclusion filters and a Cloud Storage archive for the long tail.

- An aggregated sink at the organisation (or a folder, if a folder is the real boundary) collects Admin Activity and Data Access audit logs, including child projects. Its destination is a log bucket in the logging project.
- The audit bucket has a retention period set and **locked**. Locking is irreversible: the period cannot be shortened and the bucket cannot be deleted before data ages out. It is a deliberate step, taken only after compliance has agreed the period.
- The logging project is owned by a small group, separate from workload and platform admins. Nobody holds both the ability to change workloads and the ability to alter the audit bucket.
- Application logs follow tiers: short retention for debug and noisy logs, a longer default for application and access logs, and a Cloud Storage archive sink for anything that must be kept cheaply for longer.
- Exclusion filters drop known-useless entries at ingestion (health checks, load balancer probes). Exclusions never apply to the audit sink.
- Each sink's writer identity gets only the permission it needs on its destination, and nothing else.
- Data Access logs can be large and are off by default for many services; enabling them is a per-service decision with a cost estimate.
- Personal data is kept out of logs at the source ([[structured-logging-conventions]]); retention is the second line of defence, not the first.

```bash title="create-audit-sink.sh"
set -euo pipefail
ORG_ID="123456789012"
LOG_PROJECT="example-logging"
BUCKET="audit-central"
REGION="europe-west4"

gcloud logging buckets create "${BUCKET}" \
  --project="${LOG_PROJECT}" --location="${REGION}" \
  --retention-days=400 --enable-analytics

gcloud logging sinks create audit-to-central \
  "logging.googleapis.com/projects/${LOG_PROJECT}/locations/${REGION}/buckets/${BUCKET}" \
  --organization="${ORG_ID}" --include-children \
  --log-filter='logName:"cloudaudit.googleapis.com"'

# Locking is irreversible. Run only after compliance has confirmed the period.
# gcloud logging buckets update "${BUCKET}" --project="${LOG_PROJECT}" --location="${REGION}" --locked
```

The 400 days above is an example, not a recommendation.

> [!info] Claims not checked against current docs
> The default retention of the `_Required` and `_Default` buckets (believed to be 400 and 30 days), flag names for `gcloud logging`, the exact filter for audit log names, which services have Data Access logs on by default, and the pricing and limits of log storage, sinks and analytics were not verified. Check the Cloud Logging documentation.

## Consequences

Easier:

- Audit evidence is in one place, with a retention that cannot be quietly shortened.
- Investigations and audits query one bucket instead of many projects.
- Cost follows the value of the data: debug logs expire fast, noise is dropped, evidence is kept.
- Retention for personal data is explicit and reviewable.

Harder or newly required:

- A locked bucket cannot be corrected. A wrong retention period or region stays for its whole life, so the first one is created with a short, conservative period and reviewed before locking.
- The central logging project becomes a high-value target and a single point of access control. Keep its IAM small and review it with [[access-reviews-gcp-and-gke]].
- Aggregated sinks need organisation-level permissions to create, which only a few people hold.
- Exclusion filters can hide something someone needs later. They are reviewed like code and kept in Terraform.
- A SIEM, if used, becomes a second consumer of the same sink, covered in [[gcp-audit-logs-siem]].

## Alternatives considered

- **Per-project logs only.** No central setup, but evidence is deletable by project owners and policy cannot be enforced. Rejected.
- **A SIEM as the only store.** Good for detection, but ties retention and cost to a vendor and loses a native, cheap copy. Used as a consumer, not the system of record.
- **Self-hosted Loki or similar for everything.** Cheaper at scale, but we would operate the store and still need a tamper-resistant audit path. Rejected for audit logs; may be revisited for application logs.

## Validation

```bash
set -o pipefail
ORG_ID="123456789012"
LOG_PROJECT="example-logging"
REGION="europe-west4"

# The aggregated sink exists and includes children
gcloud logging sinks list --organization="${ORG_ID}" --format="table(name,destination,includeChildren)"

# The audit bucket shows the expected retention and is locked (expect lifecycleState and locked=true after locking)
gcloud logging buckets describe audit-central \
  --project="${LOG_PROJECT}" --location="${REGION}" \
  --format="yaml(retentionDays,locked,lifecycleState)"

# Who can administer the logging project? Expect a short, named list
gcloud projects get-iam-policy "${LOG_PROJECT}" \
  --flatten="bindings[].members" --format="table(bindings.role,bindings.members)"
```

## References

- Routing and storage overview: https://cloud.google.com/logging/docs/routing/overview
- Log buckets: https://cloud.google.com/logging/docs/buckets
- Cloud Audit Logs: https://cloud.google.com/logging/docs/audit
- Related notes: [[audit-evidence-collection-and-retention]], [[gcp-audit-logs-siem]], [[pci-dss-and-gdpr-for-devops-logs-and-data]], [[searching-logs]]
- Related ADRs: [[0043-opentelemetry-collector-gateway]]
