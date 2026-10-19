---
title: A backup counts only after a timed quarterly restore drill
description: Every DR tier is proven by a quarterly timed restore, and the measured time, not the design target, is the recorded RTO.
type: adr
tags:
  - adr
  - reliability
  - gke
  - gcp
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0051
---

## Context

Our backups run, and the dashboards show green "backup succeeded" ticks. That proves only that a job finished. It does not prove that the data is complete, that the encryption keys are available, that the restore procedure works, that anyone remembers it, or that it finishes inside the recovery time we promised.

Typical ways a backup that "succeeded" is useless: it captured an empty database due to a permissions change, the restore needs a key or role nobody has in the recovery project, a Terraform state file was never included, the restored data is days older than the target recovery point, or the procedure depends on a person who left.

The recovery targets per tier are defined in [[disaster-recovery-tiers-rpo-rto]] and the technical design in [[backup-architecture-gke-cloud-sql-gcs]]. This record sets the evidence we require before we claim a tier is met.

## Decision

We will treat a backup as valid only when a **timed restore drill has succeeded in the last quarter**. The time measured in the drill is the recorded recovery time for the system, not the design target.

- Each system in tier 1 and tier 2 has a drill every quarter; lower tiers at least once a year. The schedule is a calendar item with an owner.
- The drill restores into an isolated target (a scratch namespace, a new project or a cloned instance), never over production, and verifies content, not only that the restore command returned success: row counts, a checksum or a known test record, and an application smoke test against the restored copy.
- Components covered:
  - **Cluster workloads and volumes:** a Backup for GKE restore into a scratch namespace or cluster.
  - **Cloud SQL:** a point-in-time recovery clone to a chosen timestamp, and a restore from a scheduled backup ([[0027-cloud-sql-for-production-postgres]]).
  - **Object storage:** retrieval of a prior object version from a versioned bucket, and a check that deletion protection works as intended.
  - **Terraform state:** recovery of a state file from a previous version ([[terraform-state-recovery]]).
  - **Secrets and keys:** confirmation that the recovery identity can reach the encryption keys and secrets it needs.
- The drill is run by someone other than the author of the runbook, following the runbook only. Every deviation is a runbook defect and is fixed.
- The result is recorded as evidence: date, system, backup timestamp used, measured RPO (age of data restored), measured RTO (time from start to verified service), who ran it, and defects found. Keep these where [[audit-evidence-collection-and-retention]] expects them.
- If the measured time exceeds the tier's target, or the drill fails, that is an incident: the system is treated as unprotected, an owner and a fix date are set, and the drill is repeated after the fix. The tier is not claimed until it passes.
- Cross-region recovery drills use the DR region chosen in [[0028-primary-and-dr-regions-per-environment]].
- Backup failure alerts remain, as they catch outages between drills, but they are not evidence of recoverability.

```bash title="restore-drill-sql.sh"
set -euo pipefail
PROJECT_ID="example-prod"
SOURCE_INSTANCE="orders-db"
CLONE_INSTANCE="orders-db-drill-$(date +%Y%m%d)"
POINT_IN_TIME="2026-10-19T08:00:00Z"   # a timestamp inside the retention window

start=$(date +%s)
gcloud sql instances clone "${SOURCE_INSTANCE}" "${CLONE_INSTANCE}" \
  --project="${PROJECT_ID}" --point-in-time="${POINT_IN_TIME}"

echo "Clone ready after $(( $(date +%s) - start )) seconds. Run the verification queries now."
# Delete the clone after verification and record the result:
# gcloud sql instances delete "${CLONE_INSTANCE}" --project="${PROJECT_ID}"
```

> [!info] Claims not checked against current docs
> The `gcloud sql instances clone` flags, point-in-time recovery retention windows, Backup for GKE restore options and any limits or costs of cloning were not verified. Check the Backup for GKE and Cloud SQL backup and recovery documentation. Restore drills also incur cost for temporary resources.

## Consequences

Easier:

- A claim of "recoverable in X hours" rests on a measurement.
- Runbooks stay current because they are used every quarter by someone new.
- Real incidents are calmer: the people and permissions have been exercised.
- Auditors and customers get dated evidence instead of assertions.

Harder or newly required:

- Drills cost engineering time and temporary infrastructure. Plan the time into team capacity and clean up scratch resources promptly.
- Some systems are hard to restore in isolation (dependencies, hard-coded endpoints). The drill exposes this, and fixing it is real work.
- Restoring production data into a scratch environment copies personal data. Apply the same access controls, restrict who can see it and delete it after the drill ([[pci-dss-and-gdpr-for-devops-logs-and-data]]).
- Measured times will often be worse than design targets at first. The honest number is the point; plan to improve it.
- The drill covers the paths we choose. Combine it with annual wider exercises ([[game-day-chaos-gke]]).

## Alternatives considered

- **Backup-success alerts only.** Cheap, and still needed, but proves nothing about restorability. Rejected as sole evidence.
- **An annual DR test.** Less effort, but a year is a long time for drift, key rotations and staff changes. Kept for full regional failover; the component drills are quarterly.
- **Trusting managed-service backups.** The provider keeps the backup running; it does not know whether our application works with the restored data. Rejected.

## Validation

```bash
set -o pipefail
EVIDENCE_DIR="./evidence/restore-drills"

# Each tier 1 and tier 2 system has a drill record from the last 95 days (prints systems without one)
for system in orders-db checkout-gke terraform-state; do
  find "${EVIDENCE_DIR}/${system}" -name '*.md' -mtime -95 2>/dev/null | grep -q . || echo "NO RECENT DRILL: ${system}"
done

# Recorded RTO is the measured one: grep for the field in the latest records
grep -rn "measured_rto" "${EVIDENCE_DIR}" | tail -n 10
```

## References

- Backup for GKE: https://cloud.google.com/kubernetes-engine/docs/add-on/backup-for-gke/concepts/backup-for-gke
- Cloud SQL point-in-time recovery: https://cloud.google.com/sql/docs/postgres/backup-recovery/pitr
- Related notes: [[backup-architecture-gke-cloud-sql-gcs]], [[disaster-recovery-tiers-rpo-rto]], [[terraform-state-recovery]], [[game-day-chaos-gke]]
- Related ADRs: [[0027-cloud-sql-for-production-postgres]], [[0028-primary-and-dr-regions-per-environment]]
