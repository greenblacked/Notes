---
title: Zero-downtime Postgres schema migrations (expand and contract)
description: Change a large live Postgres or Cloud SQL schema without outages using expand, migrate and contract phases, lock timeouts, concurrent indexes, NOT VALID constraints and batched backfills.
type: pattern
tags:
  - patterns
  - reliability
  - gcp
  - delivery
  - ci-cd
created: 2026-10-17
modified: 2026-10-17
draft: false
---

[[zero-downtime-deployments-kubernetes]] covers how to roll out application Pods without dropping requests. It stops at the database. A schema change on a large live table can still cause an outage, because many DDL statements take locks that block every query on the table. This note covers the schema side: how to change a large Postgres or Cloud SQL database in small, safe, reversible steps. Rollout mechanics for the application are not repeated here.

> [!info] Not verified
> This was written from knowledge of the PostgreSQL and Flyway documentation and was not run against a live database. Check these against the Postgres major version you run and the Flyway version in use before relying on them: which `ALTER` forms rewrite the table; whether `SET NOT NULL` skips the table scan when a validated `CHECK (col IS NOT NULL)` constraint exists (PostgreSQL 12 and later; not verified); the current Flyway setting name `executeInTransaction` and where it goes; and the exact lock level of each statement. The PostgreSQL manual page "Explicit Locking" lists lock modes and which statements take them. Cloud SQL runs standard PostgreSQL, but check its docs for flags you cannot set.

## Expand, migrate, contract

Break every incompatible change into three phases, shipped in separate releases.

1. **Expand.** Add the new structure next to the old one in a way that old code ignores: a new nullable column, a new table, a new index. Nothing is removed or renamed. Both schema versions work.
2. **Migrate.** Deploy code that writes to both (or reads the new one and falls back to the old). Backfill existing rows in small batches. Add constraints in the non-blocking way. Verify the data.
3. **Contract.** After all running code uses only the new structure, and enough time has passed that you will not roll back, remove the old column or table.

Example used throughout: replace `orders.total numeric(10,2)` with `orders.total_cents bigint`. A direct `ALTER COLUMN TYPE` or rename would block the table and break the previous release. With three phases, no step blocks, and each step can be rolled back on its own.

## Ordering rule

> [!warning] The app must tolerate both schema versions
> Before the contract step, every version of the application that can still run (old Pods during a rollout, a rollback target, a batch job, a replica reader) must work with both the old and the new schema. After the expand step, the old code must still work with the new schema. Order every release around that rule.

In practice:

| Step | Schema state                          | Code that must work                                                                  |
| ---- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| 1    | Expand applied (new column, empty)    | Release N (ignores the column), release N+1 (writes both)                            |
| 2    | Backfill and constraints done         | Release N+1 and N+2 (reads the new column, still writes both)                        |
| 3    | Release N+2 is the only one running   | Only N+2 and later. A later release stops writing `total`, before the contract step. |
| 4    | Contract applied (old column dropped) | N+2 and later. Release N+1 and older now break.                                      |

Run the migration before the code that needs it (expand), and after the code that stops using the old structure (contract). Keep the contract migration out of the same release as the code change. A rollback of the code then never lands on a schema that no longer has the column. See [[production-change-checklist]] for the rollback plan each phase needs.

## Lock safety

A DDL statement that needs a strong lock waits in the lock queue until current transactions on the table finish. While it waits, **every new query on that table queues behind it**. One long-running transaction plus one `ALTER TABLE` can freeze the table for all traffic, even though the DDL itself would take milliseconds.

Set timeouts at the start of every migration so a blocked statement fails fast and can be retried:

```sql title="V20261017__expand_orders_total_cents.sql"
-- Fail fast if the lock is not available. Retry the migration later.
SET lock_timeout = '3s';
-- Stop a runaway statement. Increase for slow, non-blocking steps only.
SET statement_timeout = '60s';

ALTER TABLE orders ADD COLUMN total_cents bigint;
```

- Treat a `lock_timeout` failure as normal. Retry with a pause, up to a limit, and alert if it keeps failing. Find the long transaction that blocks you (`pg_stat_activity`, `pg_locks`) and fix it instead of raising the timeout.
- Keep migrations short. Use `SET LOCAL` if the migration runs inside a transaction and you do not want the setting to leak. Session-level `SET` is fine for a dedicated migration connection.
- Run migrations on a direct connection to the database, not through a transaction-mode pooler, because session settings do not survive there (see [[postgres-connection-pooling-gke]]). This is a recommendation. Check how your pooler handles `SET`.
- Do not run migrations during a backup window or a large batch job. Big transactions also delay replicas (replication lag) and bloat WAL, which matters on Cloud SQL high availability and read replicas (see [[backup-architecture-gke-cloud-sql-gcs]]).

## Safe and unsafe DDL

"Rewrite" means Postgres copies the whole table while holding a strong lock. On a table with millions of rows, that is an outage. This table is a starting point, not a substitute for testing on a copy of production size data.

| Statement                                  | Risk                                                       | Safe form                                                                        |
| ------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ADD COLUMN` nullable, no default          | Brief lock, no rewrite                                     | Use as is, with `lock_timeout`                                                   |
| `ADD COLUMN ... DEFAULT <constant>`        | No rewrite on modern Postgres (11 and later; not verified) | Check your version; with a volatile default (for example `random()`) it rewrites |
| `ADD COLUMN ... NOT NULL` without default  | Fails on existing rows                                     | Add nullable, backfill, then constrain                                           |
| `ALTER COLUMN ... TYPE`                    | Usually rewrites the table and blocks reads and writes     | New column, backfill, switch, drop old                                           |
| `SET NOT NULL`                             | Scans the table under a strong lock                        | Validated `CHECK (col IS NOT NULL)` first, then `SET NOT NULL`                   |
| `CREATE INDEX`                             | Blocks writes while it builds                              | `CREATE INDEX CONCURRENTLY`                                                      |
| `ADD CONSTRAINT ... CHECK` / `FOREIGN KEY` | Scans the table under a lock                               | `NOT VALID`, then `VALIDATE CONSTRAINT`                                          |
| `RENAME COLUMN` / `RENAME TABLE`           | Quick, but breaks old code instantly                       | Add new, migrate, drop old                                                       |
| `DROP COLUMN`                              | Quick, but breaks any code that still reads it             | Only in a later release, after nothing uses it                                   |
| `DROP TABLE`, `TRUNCATE`                   | Data loss, strong lock                                     | Take a backup, wait a release, then drop                                         |

## Concurrent indexes

`CREATE INDEX CONCURRENTLY` builds an index without blocking writes. It takes longer, does more work, and has two rules.

- It cannot run inside a transaction block. Most migration tools wrap each migration in a transaction by default, so you must turn that off for this migration. In Flyway, this is the `executeInTransaction=false` setting, set in a script configuration file next to the migration, named after it (for example `V20261017_2__index_orders_total_cents.sql.conf`). Not verified: confirm the file name pattern and key for your Flyway version.
- If it fails or is cancelled, it can leave an **invalid** index. Check `pg_index.indisvalid`, drop the invalid index, and run it again. Use `IF NOT EXISTS` only after you have checked for an invalid leftover.

```text title="V20261017_2__index_orders_total_cents.sql.conf"
executeInTransaction=false
```

```sql title="V20261017_2__index_orders_total_cents.sql"
SET lock_timeout = '3s';
-- A concurrent build waits on long transactions but does not block writes.
-- Give it a longer statement_timeout, or 0 for no limit, and monitor it.
SET statement_timeout = '0';

CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_customer_total_cents_idx
  ON orders (customer_id, total_cents);
```

Put one concurrent statement per migration file. If the tool runs several statements in one implicit transaction, the command fails.

## NOT VALID then VALIDATE

Adding a constraint normally checks all existing rows while holding a strong lock. Split it in two:

- `ADD CONSTRAINT ... NOT VALID` takes a short lock and enforces the rule for new and updated rows only.
- `VALIDATE CONSTRAINT` scans the existing rows with a weaker lock that does not block normal reads and writes (not verified: check the lock mode for your version).

> [!warning] Never put `NOT VALID` and `VALIDATE` in the same transaction
> Flyway wraps a migration file in one transaction by default. `ADD CONSTRAINT` takes a strong lock that is held until the transaction ends, so if `VALIDATE CONSTRAINT` runs in the same file, the lock is held for the whole validation scan and all traffic on the table waits. Use one file per step, and run the `VALIDATE` file outside a transaction (or at least alone in its own transaction).

Step (a): add the constraint for new writes only. Quick.

```sql title="V20261024_1__add_orders_total_cents_check.sql"
SET lock_timeout = '3s';

ALTER TABLE orders
  ADD CONSTRAINT orders_total_cents_not_null
  CHECK (total_cents IS NOT NULL) NOT VALID;
```

Step (b): check the old rows. Slow on a big table, but it does not block normal traffic. Keep it alone in its file, and tell Flyway not to wrap it in a transaction (a `V20261024_2__validate_orders_total_cents_check.sql.conf` file with `executeInTransaction=false`; not verified: check the setting name and file naming for your Flyway version).

```sql title="V20261024_2__validate_orders_total_cents_check.sql"
SET statement_timeout = '0';

ALTER TABLE orders VALIDATE CONSTRAINT orders_total_cents_not_null;
```

Step (c): with a validated CHECK in place, `SET NOT NULL` can skip its own scan on PostgreSQL 12 and later (not verified for your version).

```sql title="V20261024_3__set_orders_total_cents_not_null.sql"
SET lock_timeout = '3s';

ALTER TABLE orders ALTER COLUMN total_cents SET NOT NULL;
ALTER TABLE orders DROP CONSTRAINT orders_total_cents_not_null;
```

The same split applies to a foreign key: one file for `ADD CONSTRAINT ... FOREIGN KEY ... NOT VALID`, and a separate non-transactional file for `VALIDATE CONSTRAINT`.

```sql title="V20261024_4__add_orders_customer_fk.sql"
SET lock_timeout = '3s';

ALTER TABLE orders
  ADD CONSTRAINT orders_customer_fk
  FOREIGN KEY (customer_id) REFERENCES customers (id) NOT VALID;
```

```sql title="V20261024_5__validate_orders_customer_fk.sql"
SET statement_timeout = '0';

ALTER TABLE orders VALIDATE CONSTRAINT orders_customer_fk;
```

Run validation only after the backfill has finished, or it fails on rows that are still empty. Run the lock-taking steps (`ADD CONSTRAINT`, `SET NOT NULL`) with a short `lock_timeout`, and the slow `VALIDATE` with a longer `statement_timeout`.

## Batched backfills

A single `UPDATE orders SET total_cents = ...` over 200 million rows makes one huge transaction. It holds row locks, produces a lot of WAL, delays replicas, bloats the table and can run for hours. Update in small batches, committing each, and pause between them.

The script uses `psql` with the standard `PG*` variables. Do not put a password in the script. Use the Cloud SQL Auth Proxy with IAM database authentication or a `.pgpass` file from a secret.

```bash title="scripts/backfill-orders-total-cents.sh"
#!/usr/bin/env bash
# Backfill orders.total_cents in batches of 5000 rows with a pause between batches.
# Safe to stop and restart: it only touches rows where total_cents is still NULL.
set -euo pipefail

# Change: connection comes from PGHOST, PGPORT, PGUSER, PGDATABASE and PGPASSFILE.
BATCH_SIZE="${BATCH_SIZE:-5000}"
SLEEP_SECONDS="${SLEEP_SECONDS:-0.5}"

while true; do
  updated="$(psql -v ON_ERROR_STOP=1 --no-psqlrc --tuples-only --no-align \
    --command "SET lock_timeout = '3s'" \
    --command "
      WITH batch AS (
        SELECT id FROM orders
        WHERE total_cents IS NULL
        ORDER BY id
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      ), moved AS (
        UPDATE orders o
        SET total_cents = round(o.total * 100)::bigint
        FROM batch
        WHERE o.id = batch.id
        RETURNING 1
      )
      SELECT count(*) FROM moved;" | tail -n 1)"

  echo "$(date -u +%FT%TZ) updated ${updated} rows"
  [ "${updated}" -eq 0 ] && break
  sleep "${SLEEP_SECONDS}"
done
```

Practical points:

- Each `psql` call is its own transaction, so each batch commits. The first `--command` is a `SET`, so the output is the last line (`tail -n 1`).
- Watch replication lag, CPU and lock waits while it runs. Make `SLEEP_SECONDS` larger if lag grows. Run it from a Job or a bastion with the Cloud SQL Auth Proxy, not from a laptop on hotel Wi-Fi.
- While the backfill runs, release N+1 writes both columns, so new rows do not need the backfill. A trigger is an alternative if you cannot change every writer, but a trigger adds write cost and must be dropped in the contract phase.
- Do the index and constraint steps after the backfill, not before. Building the index on a half-filled column wastes work.
- After the backfill, check `SELECT count(*) FROM orders WHERE total_cents IS NULL;` and compare a sample of old and new values.

## Contract in a later release

When no running code reads `total`, and at least one full release cycle has passed without a rollback, remove it. This is its own migration and its own change.

```sql title="V20261107__contract_orders_total.sql"
SET lock_timeout = '3s';

-- Run only after release N+2 has been the only version running for a full cycle,
-- and after a backup (see the backup architecture note) has been taken and tested.
ALTER TABLE orders DROP COLUMN total;
```

`DROP COLUMN` is quick in Postgres because it marks the column as dropped, but it is not reversible without a restore. Treat it as a High change under [[production-change-checklist]].

## CI lint

A cheap check in CI stops the most common dangerous statements before review. It is a heuristic with false positives, so allow an explicit override with a reason, which a reviewer must see.

```bash title="scripts/lint-migrations.sh"
#!/usr/bin/env bash
# Flag risky DDL in SQL migrations. Override a rule for a file with a line:
#   -- migration-lint: allow <rule-name> <reason>
set -euo pipefail

DIR="${1:-db/migration}"
status=0

report() { echo "$1: $2 ($3)" >&2; status=1; }

while IFS= read -r -d '' file; do
  sql="$(sed 's/--.*$//' "$file")"          # drop line comments

  allowed() { grep -qiE "^[[:space:]]*-- migration-lint: allow $1 .+" "$file"; }

  if echo "$sql" | grep -qiE 'ALTER[[:space:]]+TABLE[[:space:]]+[^;]*ALTER[[:space:]]+(COLUMN[[:space:]]+)?[^;]*[[:space:]]TYPE[[:space:]]' && ! allowed alter-type; then
    report "$file" "ALTER COLUMN TYPE can rewrite the table; add a new column instead" alter-type
  fi
  if echo "$sql" | grep -qiE 'CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX[[:space:]]+(IF[[:space:]]+NOT[[:space:]]+EXISTS[[:space:]]+)?[^;]*' \
     && ! echo "$sql" | grep -qiE 'CREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX[[:space:]]+CONCURRENTLY' \
     && ! allowed index-not-concurrent; then
    report "$file" "CREATE INDEX without CONCURRENTLY blocks writes" index-not-concurrent
  fi
  if echo "$sql" | grep -qiE 'SET[[:space:]]+NOT[[:space:]]+NULL' \
     && ! echo "$sql" | grep -qiE 'CHECK[[:space:]]*\([^)]*IS[[:space:]]+NOT[[:space:]]+NULL' \
     && ! allowed set-not-null; then
    report "$file" "SET NOT NULL without a validated CHECK constraint scans the table" set-not-null
  fi
done < <(find "$DIR" -name '*.sql' -print0)

exit "$status"
```

```yaml title=".gitlab-ci.yml (excerpt)"
lint-migrations:
  stage: test
  image: $TOOLS_IMAGE # Change: any pinned image with bash, grep, sed and find.
  rules:
    - changes:
        - db/migration/**/*.sql
  script:
    - bash scripts/lint-migrations.sh db/migration
```

Notes on the lint:

- The `CREATE INDEX` check is per file: if a file mixes a concurrent and a non-concurrent index, the non-concurrent one slips through. Keep one concurrent statement per file, as above.
- The `SET NOT NULL` check does not prove the CHECK is validated, only that one is present in the same file. A reviewer still reads it.
- Dedicated Postgres migration linters exist. Consider one if the heuristic grows. Not verified: its rule names and whether it fits your Flyway layout.
- Lint is a safety net, not a review. Test the migration against a restored copy of production-size data, and record how long each step took.

## Rollback per phase

| Phase    | What changed                            | How to roll back                                                                                                                                                                                                                        | Data risk                                              |
| -------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Expand   | New nullable column, new empty index    | Drop the new column or index. Old code never used it.                                                                                                                                                                                   | None                                                   |
| Migrate  | Code writes both, backfill, constraints | Roll back the code to release N only before the `NOT NULL`/`CHECK` step; after it, release N's inserts fail, so roll back to N+1, or run `ALTER COLUMN total_cents DROP NOT NULL` first. Keep the new column. Stop the backfill script. | Low: new column holds partial data; it can be refilled |
| Switch   | Code reads only the new column          | Roll back to N+1 (reads old, writes both). Old column is still current.                                                                                                                                                                 | Low                                                    |
| Contract | Old column dropped                      | Restore from backup or a point-in-time restore. No quick path.                                                                                                                                                                          | High                                                   |

This is why the contract step is last and separate: every earlier phase has a cheap rollback. Before the contract step, confirm that you have a tested restore and that the on-call engineer knows the point of no return.

## Related notes

- [[zero-downtime-deployments-kubernetes]] for the application rollout side.
- [[production-change-checklist]] for risk class, rollback plan and post-checks per phase.
- [[postgres-connection-pooling-gke]] for how pooling changes migration connections.
- [[backup-architecture-gke-cloud-sql-gcs]] for the restore path you depend on before the contract step.
- [[production-readiness-review]] for checking that a service's schema changes follow this pattern.
