---
title: Legal hold for logs and artifacts without breaking retention
description: Place, track and release legal holds on Cloud Storage, log buckets and Artifactory without breaking normal retention and cleanup.
type: standard
tags:
  - compliance
  - audit
  - gcp
  - artifactory
  - ci-cd
created: 2026-10-19
modified: 2026-10-19
draft: false
---

This standard describes how the platform team places, tracks and releases a legal hold on logs, evidence and artifacts. A legal hold stops deletion of specific data because of a dispute, investigation or regulatory request. The platform team executes holds; it does not decide them.

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Not checked against a running system
> The commands are illustrative and were not run. Flags and features change; verify each against the current Google Cloud and JFrog documentation before using them on real data.

## A hold is not a retention period

Retention is a time rule: keep this for N days, then delete. A hold is a suspension: do not delete this until the hold is released, whatever the retention rule says. They stack: data under both is kept until the later of the two events.

Who decides: legal counsel or the named hold owner, never the platform team on its own. This matches [[standards/artifact-retention-policy]], which says legal holds override retention. The platform team's job is to make sure the hold is technically effective and that cleanup jobs respect it.

## Scope

Typical places data lives that a hold may need to cover:

- Objects in the evidence bucket ([[compliance/audit-evidence-collection-and-retention]]).
- Cloud Logging buckets and log archives ([[patterns/gcp-audit-logs-siem]]).
- Container images and packages in Artifactory ([[artifactory-provenance-evidence]]).
- CI artifacts and job logs, which expire by default.

Decide the selectors with counsel: time range, system, project, user, build. A narrow hold is cheaper and less intrusive than "everything".

## Cloud Storage

Cloud Storage has two object holds and one bucket-level policy:

- **Temporary hold**: a flag you set and clear explicitly.
- **Event-based hold**: a flag whose release also starts the retention clock for the object when the bucket has a retention policy.
- **Bucket retention policy**: a minimum age before objects can be deleted or overwritten. It can be locked.

> [!danger] Locking a retention policy is irreversible
> A locked retention policy cannot be removed or shortened, and the bucket cannot be deleted while objects are within the period. Test on a throwaway bucket, and have legal confirm the period before locking.

Object retention lock, which sets retention per object, is a newer option; check the current docs for availability and whether it fits.

## Commands

```bash title="scripts/hold-gcs-objects.sh"
set -euo pipefail

BUCKET="gs://example-org-evidence"          # change: bucket holding the data
PREFIX="deploys/2026/09/"                   # change: selector agreed with legal

# Place a temporary hold on all objects under the prefix (verify flags in current docs).
gcloud storage objects update "${BUCKET}/${PREFIX}**" --temporary-hold

# Alternatively an event-based hold:
# gcloud storage objects update "${BUCKET}/${PREFIX}**" --event-based-hold

# Release (only on the hold owner's written instruction):
# gcloud storage objects update "${BUCKET}/${PREFIX}**" --no-temporary-hold
# gcloud storage objects update "${BUCKET}/${PREFIX}**" --no-event-based-hold
```

Retention policy on a bucket, with the lock step shown separately because it is irreversible:

```bash title="scripts/bucket-retention.sh"
set -euo pipefail

BUCKET="gs://example-org-evidence"   # change: bucket

gcloud storage buckets update "${BUCKET}" --retention-period=400d    # change: period agreed with legal
# Irreversible. Run only after the period is confirmed:
# gcloud storage buckets update "${BUCKET}" --lock-retention-period
```

In Terraform:

```hcl title="evidence-bucket.tf"
resource "google_storage_bucket" "evidence" {
  name     = "example-org-evidence"
  location = "EU"

  retention_policy {
    retention_period = 34560000 # seconds; change to the agreed period
    is_locked        = false    # set true only after review: irreversible
  }
}
```

## Cloud Logging buckets

Log buckets have a retention setting and can be locked. Locking is also irreversible: after locking, the retention period cannot be shortened.

```bash title="scripts/log-bucket-retention.sh"
set -euo pipefail

PROJECT_ID="example-audit"     # change
BUCKET_ID="audit-archive"      # change
LOCATION="global"              # change

gcloud logging buckets update "${BUCKET_ID}" --location="${LOCATION}" \
  --project="${PROJECT_ID}" --retention-days=400
# Irreversible:
# gcloud logging buckets update "${BUCKET_ID}" --location="${LOCATION}" --project="${PROJECT_ID}" --locked
```

For a hold on specific log entries, a lock on the whole bucket is a blunt tool. A better route is to export or copy the matching entries to a GCS bucket that carries object holds, and record that copy in the register. Check the current docs for what log bucket locking does and does not cover.

## Artifactory

I am not aware of a confirmed native legal-hold feature in Artifactory, so verify with JFrog for your version. The portable approach is a property, for example `hold.id=HOLD-2026-001`, set on every affected artifact and build. Every cleanup policy, retention script and AQL-based cleanup must then exclude anything with that property.

```text title="cleanup-exclusion.aql"
items.find({
  "repo": "example-docker-dev-local",
  "created_by": {"$ne": "system"},
  "$and": [
    {"@hold.id": {"$nexist": true}}
  ]
}).include("repo","path","name")
```

Run any cleanup as a dry run first and confirm that held items do not appear in the deletion list. Check the current JFrog docs for how cleanup policies treat properties, as the exact operators and field names vary. Combine with permissions: the identity that sets or removes `hold.id` should be separate from the cleanup identity.

## Register of active holds

A register tells the next engineer what is held and why not to touch it. Keep it in Git in a restricted repository. No case details: use an identifier that legal maps to the matter.

```yaml title="holds/register.yaml"
- id: HOLD-2026-001
  requester_role: legal-counsel
  scope:
    - system: gcs
      selector: "gs://example-org-evidence/deploys/2026/09/"
    - system: artifactory
      selector: "property hold.id=HOLD-2026-001"
  placed_at_utc: 2026-10-19T09:00:00Z
  placed_by: platform-oncall
  release_owner: legal-counsel
  review_date: 2027-01-19
```

## Conflicts with erasure requests

A hold can collide with a data subject's erasure request or a retention limit in privacy law. Do not resolve this in a pipeline. Escalate to counsel and the data protection officer, and record the decision. See [[compliance/pci-dss-and-gdpr-for-devops-logs-and-data]] for the general tension between logging and privacy.

## Verifying, releasing and pitfalls

Verify that the hold works:

```bash title="scripts/verify-hold.sh"
set -euo pipefail

BUCKET="gs://example-org-evidence"   # change
PREFIX="deploys/2026/09/"            # change

# Field names are indicative; check the output of "gcloud storage objects describe" in your version.
gcloud storage objects list "${BUCKET}/${PREFIX}**" \
  --format="table(name,temporary_hold,event_based_hold)"
```

Then try a delete of one object in a throwaway copy of the setup, and confirm it is refused. For Artifactory, run the cleanup dry run.

Release only on the hold owner's written instruction, clear the flags or properties, update the register, and let the normal retention rules take over again. Pitfalls:

- A cleanup script that ignores the property.
- Holds placed on the original but not on replicated copies or exports.
- Locking a bucket for a short matter, leaving data undeletable for years.
- No review date, so the hold lives forever.
- Putting case details in the register.

## Related

- [[compliance/audit-evidence-collection-and-retention]]: the normal retention design.
- [[standards/artifact-retention-policy]]: the retention rules a hold overrides.
- [[patterns/gcp-audit-logs-siem]]: log routing and storage.
- [[compliance/pci-dss-and-gdpr-for-devops-logs-and-data]]: privacy limits on logs.
- [[compliance/policy-exception-and-waiver-process]]: temporary exceptions to the rules.
- [[artifactory-provenance-evidence]]: artifacts that must survive cleanup.

## Sources

- Google Cloud, [Object holds](https://cloud.google.com/storage/docs/object-holds).
- Google Cloud, [Bucket Lock](https://cloud.google.com/storage/docs/bucket-lock).
- Google Cloud, [Cloud Logging storage and buckets](https://cloud.google.com/logging/docs/buckets).
- JFrog, cleanup policies: find the current page under [jfrog.com/help](https://jfrog.com/help/).
