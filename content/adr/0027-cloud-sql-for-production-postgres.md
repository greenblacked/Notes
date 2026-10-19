---
title: Cloud SQL for production PostgreSQL
description: Proposal to run production relational data on Cloud SQL with HA, backups and point-in-time recovery, keeping in-cluster databases for tests only.
type: adr
tags:
  - adr
  - gcp
  - reliability
status: proposed
created: 2026-10-19
modified: 2026-10-19
draft: false
aliases:
  - ADR-0027
---

## Context

Some PostgreSQL instances run inside GKE as StatefulSets or through an operator, and others on Cloud SQL, chosen service by service. In-cluster databases tie data durability to cluster operations: node upgrades, storage classes, volume snapshots and operator upgrades all become data-risk events (see [[stateful-workloads-gke]]). The team is small, and running a database operator well, including backups, failover and major upgrades, is a significant on-call load.

A managed service moves the operational work (patching, failover, backups) to the provider but brings its own constraints: supported extensions, connection limits, and cost.

## Decision

Proposed: production PostgreSQL runs on **Cloud SQL**. In-cluster PostgreSQL is allowed for tests, previews and disposable data only.

- **Owner:** the platform team, with the data-owning service teams consulted.
- **Trigger to close:** an inventory of production databases is complete and each one is checked against the criteria below. Decide at the next platform planning cycle; services that fail a criterion get a recorded exception and are revisited.

Proposed shape:

- High availability enabled, automated backups and point-in-time recovery (PITR) on. Backup architecture follows [[backup-architecture-gke-cloud-sql-gcs]].
- **Private IP only**, on the Shared VPC ([[0025-shared-vpc-host-project-no-default-networks]]).
- Applications connect through the Cloud SQL Auth Proxy or connector, using **IAM database authentication** where the driver supports it, with Workload Identity ([[gke-workload-identity]]) rather than passwords in Secrets.
- Connection pooling is explicit ([[postgres-connection-pooling-gke]]); instance connection limits depend on the machine tier and must be checked in the current docs.
- Schema changes follow [[postgres-expand-contract-migrations]].
- Instances are declared in Terraform; deletion protection is on.

```hcl title="cloud-sql.tf"
resource "google_sql_database_instance" "payments" {
  name                = "payments-prod"
  region              = "europe-west1"
  database_version    = "POSTGRES_16"
  deletion_protection = true

  settings {
    tier              = "db-custom-4-16384"
    availability_type = "REGIONAL"

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = "projects/example-net-host/global/networks/prod"
    }
  }
}
```

The values above are examples; choose the version and tier from the workload and the currently supported versions.

Criteria to evaluate per database:

| Criterion            | Question                                                                            |
| -------------------- | ----------------------------------------------------------------------------------- |
| Data size and growth | Within what Cloud SQL supports today (check the current limits)?                    |
| Extensions           | Are all required extensions supported?                                              |
| Cost                 | Compare against the in-cluster total cost, with prices from the current price list. |
| Recovery objectives  | Do HA and PITR meet the tier in [[disaster-recovery-tiers-rpo-rto]]?                |

> [!info] Claims not checked against current docs
> Supported PostgreSQL versions, the extension list, instance and connection limits per tier, the HA failover time, and pricing. Check the Cloud SQL documentation and price list before deciding.

## Consequences

If accepted:

- Backups, patching and failover are the provider's job; restore drills still belong to us ([[0051-backups-proven-by-quarterly-restore-drills]]).
- Data durability is decoupled from cluster lifecycle events.
- Regional placement follows [[0028-primary-and-dr-regions-per-environment]].

Costs:

- Less control over PostgreSQL configuration and extensions.
- Maintenance windows are scheduled by us but executed by the provider; apps must tolerate brief failovers.
- Per-instance cost can exceed shared in-cluster capacity for many small databases; consolidating small databases onto one instance weakens isolation.

## Alternatives considered

- **In-cluster operator (for example CloudNativePG).** Full control and lower per-database cost; highest operational burden. Kept for tests and disposable data.
- **AlloyDB.** Compatible with PostgreSQL and aimed at heavier workloads; evaluate for databases that outgrow Cloud SQL. Check current capabilities and cost.
- **Self-managed PostgreSQL on VMs.** Same burden as in-cluster, with fewer automation hooks. Rejected.

## Validation

If accepted, these checks prove the controls are in force.

```bash
set -o pipefail
PROJECT_ID="example-prod"

# HA, backups, PITR and public IP flags per instance
gcloud sql instances list --project="${PROJECT_ID}" --format=json \
  | jq -r '.[] | [.name, .settings.availabilityType, .settings.backupConfiguration.pointInTimeRecoveryEnabled, (.settings.ipConfiguration.ipv4Enabled|tostring)] | @tsv'

# In-cluster PostgreSQL still running in production namespaces (review)
kubectl get statefulsets -A -l app.kubernetes.io/name=postgresql
```

## References

- Cloud SQL for PostgreSQL: https://cloud.google.com/sql/docs/postgres
- Connection overview: https://cloud.google.com/sql/docs/postgres/connect-overview
- Related notes: [[backup-architecture-gke-cloud-sql-gcs]], [[stateful-workloads-gke]], [[postgres-connection-pooling-gke]], [[postgres-expand-contract-migrations]]
- Related ADRs: [[0028-primary-and-dr-regions-per-environment]], [[0051-backups-proven-by-quarterly-restore-drills]]
