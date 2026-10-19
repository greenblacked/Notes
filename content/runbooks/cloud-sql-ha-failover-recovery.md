---
title: Cloud SQL HA failover and connection recovery
description: Confirm or run a Cloud SQL HA failover, make applications reconnect cleanly, find stale pools and proxies, and know what failing back means.
type: runbook
tags:
  - runbooks
  - gcp
  - reliability
  - incident-management
  - on-call
created: 2026-10-19
modified: 2026-10-19
draft: false
---

How to handle a Cloud SQL high-availability (HA) failover: confirm that it happened, get applications reconnecting cleanly, and run a controlled failover as a drill. The database side of an HA failover is automatic; the incidents come from the application side, where pools, proxies and drivers keep using connections that no longer work.

> [!info] Scope and verification
> The commands were not run against a live instance and the note is not marked `verified`. Flags for `gcloud sql instances failover`, the failover mechanics and downtime vary by database engine and edition. Check the current Cloud SQL high availability documentation for your engine before use; no downtime figures are quoted here on purpose.

## When to use

- Application errors spike with `connection reset`, `server closed the connection unexpectedly`, `the database system is shutting down` or timeouts, and the Cloud SQL instance logged a failover.
- Connections stay broken after the database is healthy again (stale pool, stale proxy).
- You need to rehearse failover before an on-call handover or a game day; see [[game-day-chaos-gke]].
- Someone proposes promoting a read replica: that is a different decision, covered in step 6.

## Preconditions

- The instance is regional (`availabilityType: REGIONAL`), so a standby exists in another zone. A zonal instance has no HA failover; its recovery is a restart or restore.
- Automated backups and point-in-time recovery are enabled, and a restore has been rehearsed; see [[backup-architecture-gke-cloud-sql-gcs]] and [[disaster-recovery-tiers-rpo-rto]].
- A staging instance of the same shape to rehearse on.
- `roles/cloudsql.viewer` to read, and `roles/cloudsql.admin` (or a narrower custom role) to run a failover. Failover is a production-impacting action.
- Application clients implement retries with backoff; see [[timeouts-retries-load-shedding]].

```bash
PROJECT=example-project
INSTANCE=prod-db
NS=app
gcloud config set project "$PROJECT"
```

## Steps

### 1. Confirm what happened

```bash
gcloud sql instances describe "$INSTANCE" \
  --format="yaml(state,databaseVersion,region,gceZone,secondaryGceZone,settings.availabilityType,failoverReplica,ipAddresses)"

gcloud sql operations list --instance "$INSTANCE" --limit 15 \
  --format="table(name,operationType,status,startTime,endTime,error)"
```

What to look for:

- `gceZone` now differs from before: the primary moved zones. Compare with your last known value, or with the Cloud Logging entry for the failover event.
- A `FAILOVER` operation, or a restart, maintenance or `UPDATE` operation. Maintenance can look like a failover from the application side; see your maintenance window configuration.
- `state: RUNNABLE` and `availabilityType: REGIONAL` mean the instance is serving and HA is configured. If a standby is rebuilding, check the documentation for what that means for resilience during the rebuild.

Check Cloud Logging for the instance (`resource.type="cloudsql_database"`) for the reason: zone failure, instance crash, out-of-memory, disk, or a manual action. Reasons that repeat need fixing at the source, not just recovery.

### 2. Check state and zones

During and just after a failover the instance may report an operation in progress. Do not stack changes on top of it.

```bash
gcloud sql instances describe "$INSTANCE" --format="value(state,gceZone,secondaryGceZone)"
gcloud sql operations list --instance "$INSTANCE" --filter="status!=DONE" \
  --format="table(name,operationType,status)"
```

Wait for in-progress operations to finish before editing flags, resizing, or running another failover. The IP address of the instance stays the same across an HA failover, so applications do not need new addresses; only their open connections break.

### 3. Application side: proxy, connector and pools

Most outages persist here. Work from the outside in.

**Cloud SQL Auth Proxy or connector**

```bash
# Proxy as a sidecar or Deployment: look for reconnects and errors
kubectl -n "$NS" logs deploy/api -c cloud-sql-proxy --tail=100
kubectl -n "$NS" get pods -o wide
```

The Auth Proxy and the language connectors normally reconnect on their own when new connections are opened. A proxy that is stuck, or running an old version, may need a restart. Check the current Auth Proxy documentation for version and health-check options.

**Connection pools**

Pools often hold dead connections. Look for errors that appear only on the first query after idle time, or for an application that never recovers until restarted.

```bash
kubectl -n "$NS" logs deploy/api --tail=200 | grep -Ei 'connection (reset|refused|closed)|broken pipe|server closed|timeout'
```

If PgBouncer sits between the app and the database, check that it reconnects and drops dead server connections; see [[postgres-connection-pooling-gke]]. PgBouncer's `server_check_query`, `server_check_delay`, `server_lifetime` and `server_idle_timeout` control how it detects and recycles bad server connections; check the current PgBouncer docs for names and defaults.

### 4. Force clean reconnects

When connections will not heal themselves, restart consumers gradually so a thundering herd of new connections does not overload the freshly promoted primary.

```bash
kubectl -n "$NS" rollout restart deploy/api
kubectl -n "$NS" rollout status deploy/api --timeout=300s
```

Prefer a rolling restart with `maxUnavailable` that keeps capacity. Longer term, set pool options that survive failovers:

- Validate connections before use, or on borrow (`testOnBorrow`, `pool_pre_ping`, or the pool's equivalent).
- Set a maximum connection lifetime shorter than any infrastructure idle timeout.
- Set connect and read timeouts so a hung connection fails fast.
- Retry idempotent operations with exponential backoff and jitter. Do not retry non-idempotent writes blindly.

A failover drops existing connections, so any transaction in flight at that moment is lost and must be retried by the application.

### 5. Manual failover for a drill

Do this on staging first, and in production only with an agreed window, a named on-call, and a change record per [[production-change-checklist]].

```bash
# Check flags with: gcloud sql instances failover --help
gcloud sql instances failover "$INSTANCE"
```

Watch the effect from three places: the operation, the application error rate, and the instance state.

```bash
gcloud sql operations list --instance "$INSTANCE" --limit 3
gcloud sql instances describe "$INSTANCE" --format="value(state,gceZone)"
kubectl -n "$NS" logs deploy/api --since=5m | grep -Eic 'error|reset|timeout'
```

Record the observed application recovery time. That number, measured by you, is the one to put in your runbook; do not use a figure from the documentation as a promise.

### 6. Read replicas are separate

A read replica is not the HA standby. Promoting a replica detaches it as a new standalone instance and breaks replication; it is one-way. Treat it as a disaster recovery decision (a regional loss, or a corrupted primary you cannot restore in time), taken by an incident lead with the tradeoffs in [[disaster-recovery-tiers-rpo-rto]] in view. Check the current replication documentation for the exact behaviour of promotion, including what happens to the old primary and to cascading replicas.

> [!warning] Do not promote a replica to fix a connection problem
> If the problem is that applications cannot reconnect after a failover, promotion makes it worse: you now have two diverging databases and a new address to distribute.

## Validation

```bash
gcloud sql instances describe "$INSTANCE" --format="value(state,settings.availabilityType,gceZone)"
gcloud sql operations list --instance "$INSTANCE" --limit 3 --format="table(operationType,status,endTime)"
```

Then on the database and application:

- A test write and read succeed through the normal path (`INSERT` into a canary table, then `SELECT`).
- Application error rate and latency are back to baseline and pool metrics (active, idle, waiting) look normal.
- Replication lag on any read replicas is back to normal; check their status with `gcloud sql instances describe <replica>`.
- Alerts for the incident have cleared, and the HA standby is healthy again.

## Rollback

There is no automatic failback. After a failover the former standby is the primary, and the instance keeps serving from there; the zone change itself is harmless for a regional instance. If you need the primary in the original zone for latency reasons, a second manual failover can move it, but check the documentation for any restrictions and treat it as another production-impacting change with the same drill discipline.

For the application changes:

- Revert pool or timeout configuration in git and roll out the previous version.
- Revert a restarted rollout with `kubectl -n "$NS" rollout undo deploy/api` only if the restart introduced a new problem.
- A promoted replica cannot be undone. Rebuilding replication means creating a new replica from the new primary.

## Troubleshooting

| Symptom                                          | Likely cause and fix                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Errors persist long after instance is `RUNNABLE` | Stale pool or proxy. Rolling restart consumers; add validation and max lifetime.                         |
| Errors only on the first query after idle        | Idle connections were dropped. Enable pre-ping or validation on borrow.                                  |
| `too many connections` right after failover      | Reconnect storm. Stagger restarts, lower pool size, use a pooler.                                        |
| `gcloud sql instances failover` rejected         | Operation in progress, or instance not regional. Check state and `availabilityType`.                     |
| Replica shows lag or errors after failover       | Replication re-establishing. Check replica status; recreate if broken.                                   |
| Failover happens repeatedly                      | Underlying fault (memory, disk, maintenance). Read instance logs and metrics before the next one.        |
| App cannot reach database at all                 | Not a failover: network, authorized networks or IAM. Check the Auth Proxy, IAM and private connectivity. |

## Related

- [[postgres-connection-pooling-gke]] for pooler design and reconnect behaviour.
- [[backup-architecture-gke-cloud-sql-gcs]] for backups and point-in-time recovery.
- [[disaster-recovery-tiers-rpo-rto]] for when promotion and cross-region recovery are the right call.
- [[timeouts-retries-load-shedding]] for client retry design.
- [[incident-response]] and [[game-day-chaos-gke]] for roles and for rehearsing this runbook.

## Sources

- [Cloud SQL for PostgreSQL: high availability](https://cloud.google.com/sql/docs/postgres/high-availability)
- [Cloud SQL for MySQL: high availability](https://cloud.google.com/sql/docs/mysql/high-availability)
- [Configure HA on Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres/configure-ha)
- [Cloud SQL for PostgreSQL: replication](https://cloud.google.com/sql/docs/postgres/replication)
