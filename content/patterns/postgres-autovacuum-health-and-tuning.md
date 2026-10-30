---
title: PostgreSQL autovacuum health and tuning
description: Diagnose vacuum backlog, separate tuple cleanup from transaction ID safety, and tune busy tables without hiding blocked maintenance.
type: pattern
tags:
  - patterns
  - reliability
  - observability
created: 2026-10-29
modified: 2026-10-30
draft: false
evidence: source-reviewed
reviewed: 2026-10-30
review-due: 2027-04-30
---

Autovacuum is part of database availability, not optional housekeeping. Updates and deletes leave old row versions that vacuum can reclaim once they are no longer needed. Vacuum also maintains visibility information and freezes old transaction IDs. A healthy application can still accumulate maintenance debt.

This note uses the PostgreSQL 18 manual. Match it to the server's major version before applying tuning advice. Managed-service permissions and configuration controls must be checked separately.

## Distinguish the three problems

| Symptom                                  | Investigate                                             | Wrong shortcut                                    |
| ---------------------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| Dead tuple estimates and table size grow | Cleanup eligibility, vacuum throughput, workload churn  | Assume every large table needs a rewrite          |
| Query plans deteriorate                  | Analyze history and statistics freshness                | Treat vacuum and analyze as interchangeable       |
| Oldest transaction ID age rises          | Freeze progress, old transactions and retained horizons | Raise the freeze threshold to silence the warning |

Plain vacuum generally makes space reusable inside a relation rather than returning it to the operating system. A stable file size after vacuum is not proof of failure. `VACUUM FULL` rewrites the table and requires an `ACCESS EXCLUSIVE` lock plus temporary disk space; it is not the routine response to a backlog.

## Start with read-only observations

Run the following on the intended database with an approved monitoring role. Statistics visibility depends on permissions; missing or hidden fields are not proof that no blocker exists. Query text is deliberately excluded from the examples.

```sql title="vacuum-health.sql"
SELECT current_database(), current_setting('server_version');

SELECT relid::regclass AS relation,
       n_live_tup, n_dead_tup,
       last_autovacuum, last_autoanalyze,
       autovacuum_count, autoanalyze_count
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 20;

SELECT n.nspname AS schema_name, c.relname,
       age(c.relfrozenxid) AS xid_age,
       mxid_age(c.relminmxid) AS multixact_age
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'm', 't')
ORDER BY age(c.relfrozenxid) DESC
LIMIT 20;

SELECT pid, datname, relid, phase,
       heap_blks_total, heap_blks_scanned
FROM pg_stat_progress_vacuum
WHERE datname = current_database();
```

Tuple counts are estimates, not an exact measurement of reclaimable bytes. XID age is measured in transactions, not elapsed time: use `age()` rather than subtracting raw transaction IDs. Table ages are database-local observations; inspect every database, including system catalogs and TOAST relations, rather than only application tables.

Check retained horizons alongside table statistics:

```sql title="vacuum-horizons.sql"
SELECT pid, datname, state, xact_start,
       age(backend_xid) AS xid_age,
       age(backend_xmin) AS xmin_age
FROM pg_stat_activity
WHERE xact_start IS NOT NULL OR backend_xmin IS NOT NULL
ORDER BY xact_start NULLS LAST
LIMIT 20;

SELECT slot_name, slot_type, active,
       age(xmin) AS xmin_age,
       age(catalog_xmin) AS catalog_xmin_age,
       restart_lsn
FROM pg_replication_slots;
```

Long-running transactions can retain old row versions. A replication slot's `xmin` and `catalog_xmin` can retain tuple versions; `restart_lsn` identifies a separate WAL-retention requirement. Slot WAL retention consumes WAL storage, not `pg_xact`. Escalate stale slots to their replication owner rather than treating them as disposable cleanup targets.

Wraparound protection works per database. Check every database's oldest XID and multixact, and any prepared transactions, which hold their horizon until committed or rolled back and survive restarts:

```sql title="vacuum-cluster-age.sql"
SELECT datname,
       age(datfrozenxid) AS xid_age,
       mxid_age(datminmxid) AS multixact_age
FROM pg_database
ORDER BY age(datfrozenxid) DESC;

SELECT gid, prepared, owner, database,
       age(transaction) AS xid_age
FROM pg_prepared_xacts
ORDER BY prepared;
```

Both queries are read-only. Do not commit or roll back a prepared transaction you do not own: hand it to its owner and the DBA. If these observations do not explain old horizons either, escalate before concluding that vacuum only needs more workers.

## Tune the cause, one table at a time

For PostgreSQL 18, the update/delete vacuum trigger is the smaller of `autovacuum_vacuum_max_threshold` and `autovacuum_vacuum_threshold + autovacuum_vacuum_scale_factor * pg_class.reltuples`. Insert-driven vacuum and analyze have separate triggers. A threshold makes a table eligible; it does not guarantee a worker starts immediately.

For a high-churn large table, consider a lower per-table scale factor so it becomes eligible earlier. For illustration, a base threshold of 5,000 and scale factor of 0.01 on an estimated ten million rows gives 105,000 obsolete tuples before applying the maximum-threshold cap. Those numbers are a calculation, not recommended settings.

Record current global settings and table storage parameters before changing anything. Change one table's threshold policy first, then compare vacuum duration, dead tuple trends, I/O latency and application latency over a representative workload cycle.

If workers remain busy and backlog grows across many tables, investigate throughput and I/O headroom. Increasing worker count alone is not a guarantee of higher throughput: autovacuum normally balances cost limits across workers, and per-table cost overrides change that balancing.

If vacuum runs but cannot advance cleanup horizons, address the retaining transaction or replication consumer with its owner. Faster scans cannot make still-needed row versions removable.

## Acceptance and escalation

The target is bounded maintenance debt: cleanup keeps pace with churn, vacuum can complete, oldest XID and multixact ages remain within an agreed safety budget, and application latency stays acceptable. A recent `last_autovacuum` timestamp alone does not establish any of these.

PostgreSQL starts anti-wraparound maintenance based on transaction age, including when ordinary autovacuum is disabled. Continued failure to advance can lead to write refusal to prevent wraparound. Treat database age warnings as an availability incident and follow the version-matched PostgreSQL procedure with a DBA; do not respond by postponing the safety boundary.

Autovacuum processes individual partitions but does not automatically analyze the partitioned parent. Plan parent statistics maintenance separately when partition data distribution changes.

If a tuning change worsens latency, restore the recorded previous settings, not assumed defaults, and reassess capacity. This read-only diagnostic note does not authorize cancelling sessions, removing slots or performing table rewrites. Coordinate any such change through [[production-change-checklist]].

## Evidence

### Sources checked

- [PostgreSQL 18 routine vacuuming](https://www.postgresql.org/docs/18/routine-vacuuming.html): space reuse, locking, freeze safety, trigger calculations, cost balancing and partition maintenance; checked 2026-10-29.
- [PostgreSQL 18 cumulative statistics](https://www.postgresql.org/docs/18/monitoring-stats.html): table estimates, activity fields, statistics freshness and visibility; checked 2026-10-29.
- [PostgreSQL 18 replication slots](https://www.postgresql.org/docs/18/view-pg-replication-slots.html): tuple retention horizons and WAL retention fields; checked 2026-10-29.
- PostgreSQL 18 documentation source (`REL_18_STABLE`, commit `cc4bf6e`, `doc/src/sgml`): the vacuum trigger formula with `autovacuum_vacuum_max_threshold` (new in 18), no autovacuum `ANALYZE` of partitioned tables, `pg_database.datfrozenxid` and `datminmxid`, the `pg_prepared_xacts` columns, prepared transactions stored on disk so they survive a crash and interfere with VACUUM and wraparound (`ref/prepare_transaction.sgml`), and the wraparound step "Resolve old prepared transactions" (`maintenance.sgml`); checked 2026-10-30.
- [PostgreSQL 18 progress reporting](https://www.postgresql.org/docs/18/progress-reporting.html): vacuum progress view and fields; checked 2026-10-29.

### Not verified

No SQL was executed and no tuning values were load-tested. Monitoring permissions, provider-specific flags and workload capacity remain unverified. Threshold examples and acceptance budgets are engineering guidance, not observed results. Web pages listed as checked 2026-10-29 were not re-fetched on 2026-10-30 (no web access); the new claims were checked against the documentation sources listed with that date.

## Related

- [[postgres-expand-contract-migrations]]
- [[postgres-connection-pooling-gke]]
- [[cloud-sql-postgres-platform-architecture]]
