---
title: Flyway vs Liquibase vs Atlas for database schema migrations
description: "Choosing and running a PostgreSQL migration tool on GCP: licences, locking, lint, where migrations run, a guarded GitLab CI job, and forward-only rollback."
type: tool
tags:
  - tools
  - ci-cd
  - reliability
  - kubernetes
  - gcp
created: 2026-10-21
modified: 2026-10-21
draft: false
---

[[postgres-expand-contract-migrations]] explains how to change a schema without downtime: expand, migrate data, switch code, contract. It does not say **which tool** applies the SQL, **where** that tool runs (a CI job, a Kubernetes Job, an Argo CD hook), or **how** to stop a migration from taking a production table lock for ten minutes. This note fills that gap for PostgreSQL on Cloud SQL ([[0027-cloud-sql-for-production-postgres]]), comparing the three tools teams most often shortlist: Flyway, Liquibase and Atlas.

> [!warning] Check the licence of the exact version you install
> As of 2026-10-21, per each project's repository: the **Flyway** engine is open source under Apache-2.0, and Redgate's Flyway Community and Enterprise editions are separate products, "not part of the Flyway open source project". **Liquibase** Community is under the Functional Source License (FSL-1.1-ALv2), with a commercial edition called Liquibase Secure; it was under Apache-2.0 before, so the licence depends on the version. **Atlas**'s repository is Apache-2.0, but the terms of the distributed binary and which features need a login or a paid plan were not verified. Licence terms are a procurement question: record the decision in [[devops-vendor-and-licence-management]].

> [!info] Not checked against current releases
> The tools' own documentation sites were not reachable when this note was written; facts were taken from their repositories, the PostgreSQL documentation source and the Cloud SQL Auth Proxy README on 2026-10-21. Not verified: Flyway command names and settings (`info`, `validate`, `migrate`, `baseline`, `repair`, `clean`, `cleanDisabled`, `validateOnMigrate`, the `flyway_schema_history` table) and which features need a paid edition; Liquibase's `update-sql`, `status`, `release-locks`, its `DATABASECHANGELOG` and `DATABASECHANGELOGLOCK` tables and which commands are paid; Atlas's `atlas.sum` file, any dry-run flag, and which analyzers need a login; each tool's switch for running a migration outside a transaction; GitLab CI keyword details; and Cloud SQL IAM database user setup. Run each tool's `--help` and read its docs before relying on a flag.

## Criteria

| Criterion                | What to look for                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Model                    | Versioned SQL files (apply in order), changelogs (abstract change sets), or declarative (desired schema, tool computes the diff) |
| Locking                  | Two pipelines must not migrate the same database at once                                                                 |
| Integrity                | Checksums of applied migrations, so an edited file is caught instead of silently skipped                                  |
| Preview                  | The exact SQL that will run, reviewable before it runs                                                                   |
| Undo                     | Down migrations or roll forward; [[0048-rollback-by-redeploying-previous-digest]] says forward only                       |
| Destructive-change lint  | Catch `DROP COLUMN`, type changes and table-rewriting statements before review                                            |
| PostgreSQL specifics     | `CREATE INDEX CONCURRENTLY` outside a transaction, `lock_timeout`, `statement_timeout`                                    |
| CI fit                   | A single binary or image, non-interactive, clear exit codes                                                              |
| Licence                  | See the warning above                                                                                                    |

## At a glance

| Concern               | Flyway                                              | Liquibase                                                  | Atlas                                                               |
| --------------------- | --------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| Licence (repo)        | Apache-2.0 engine; Redgate editions separate        | FSL-1.1-ALv2 Community; commercial Secure edition          | Apache-2.0 repository; binary terms not verified                    |
| Model                 | Versioned SQL (and Java) migrations                 | Changelogs (XML, YAML, JSON or SQL) of change sets         | Versioned (`migrate`) or declarative (`schema apply`)               |
| Author writes         | Plain SQL                                           | Change sets, or SQL wrapped as change sets                 | SQL, or an HCL/SQL desired schema that Atlas diffs                  |
| Preview               | Check the docs for a dry-run in your edition        | `update-sql` (not verified)                                | `schema apply` prints planned changes and asks to apply or abort    |
| Lint                  | Check the edition table                             | Not verified                                               | `migrate lint` with 50+ analyzers (destructive, data-dependent, locks) |
| Drift detection       | Check the edition table                             | Check the docs                                             | Advertised in the README                                            |
| Databases             | 50+ per its README, PostgreSQL included             | Many; check the docs                                       | Many, PostgreSQL included                                           |
| Release cadence       | Check the release notes                             | Quarterly Community releases from 5.0.2, plus nightlies    | Only the two latest minor CLI versions are supported                |
| Fits best             | Teams who want plain SQL and minimal abstraction    | Estates with existing changelogs or many database engines | Teams who want lint or declarative schemas and accept the terms     |

## The three tools

### Flyway

Migrations are SQL files named with a version, applied in order and recorded with checksums in a history table. A modified file that was already applied fails validation. The model maps one-to-one onto expand and contract: each step is a new, small versioned file.

```bash title="flyway (check names with flyway -? in your image)"
flyway -url="jdbc:postgresql://127.0.0.1:5432/app" -user="${DB_USER}" \
  -locations=filesystem:db/migrations info
flyway ... validate   # applied files still match their checksums
flyway ... migrate    # apply pending versions in order
flyway ... baseline   # adopt an existing database once, at a known version
```

Never enable `clean` (which drops everything in the schema) against anything but a disposable database; check that your configuration disables it, and that a production job cannot reach it.

### Liquibase

Changes are change sets in a changelog, tracked in a changelog table and serialised by a lock table. Preview with `update-sql` (prints the SQL without running it) and apply with `update`. The README quick start is `liquibase init start-h2`, `liquibase update` and `liquibase history`.

If a job dies mid-run, the lock row can stay set and every later run waits. `release-locks` clears it.

> [!warning] Clear a Liquibase lock only when nothing is running
> Releasing the lock while another migration is in progress lets two runs change the schema at once. Confirm with `pg_stat_activity` that no migration session is connected, and that no pipeline is running, before you release it.

### Atlas

Atlas supports both a versioned workflow and a declarative one. A **dev database** (`--dev-url`, for example a throwaway PostgreSQL container) is used to compute and check changes, so it never touches the real database while planning.

```bash title="atlas (from the project README)"
# Versioned: generate a new migration from the desired schema
atlas migrate diff add_order_status \
  --dir "file://db/migrations" \
  --to "file://schema.sql" \
  --dev-url "docker://postgres/16/dev"

# Lint the migration directory (destructive changes, locks, data-dependent changes)
atlas migrate lint --dir "file://db/migrations" --dev-url "docker://postgres/16/dev"

# Apply pending migrations
atlas migrate apply --url "${DATABASE_URL}" --dir "file://db/migrations"

# Declarative alternative: print the plan, then apply or abort
atlas schema apply --url "${DATABASE_URL}" --to "file://schema.sql" \
  --dev-url "docker://postgres/16/dev"
```

The `postgres/16` dev image is the README's example; use the same major version as your Cloud SQL instance. The README also lists a Kubernetes operator, a Terraform provider and IAM authentication for Cloud SQL; their details were not verified. Declarative `schema apply` is convenient in development, but in production prefer reviewed versioned files: expand and contract needs steps in a specific order across releases, which a single computed diff cannot express.

## PostgreSQL rules every tool must respect

These come from the PostgreSQL documentation and apply whichever tool runs the SQL.

- **Bound the wait for locks.** `lock_timeout` (default 0, disabled) aborts a statement that waits too long for a lock, so a migration queued behind a long transaction fails fast instead of blocking every query behind it. `statement_timeout` (default 0) bounds the whole statement. Setting `lock_timeout` in `postgresql.conf` is not recommended because it affects all sessions, and it is pointless at or above a non-zero `statement_timeout`. Set both in the migration session. Setting them per role with `ALTER ROLE migrator SET ...` is an option too; test it on your instance.
- **A plain `CREATE INDEX` locks out writes** (not reads) on the table until it finishes. Use `CREATE INDEX CONCURRENTLY` on any table that serves traffic.
- **`CREATE INDEX CONCURRENTLY` cannot run inside a transaction block.** Most tools wrap each migration in a transaction by default, so the concurrent index needs its own migration with the tool's non-transactional setting (each tool has one; the exact switch was not verified). Only one concurrent build can run on a table at a time.
- **A failed concurrent build leaves an `INVALID` index** that still slows writes. `IF NOT EXISTS` then skips the retry because the name exists. Drop it and run again, or rebuild it with `REINDEX INDEX CONCURRENTLY`.

```sql title="db/migrations/V41__orders_add_status.sql"
-- Expand step: nullable column, no default, no table rewrite.
SET lock_timeout = '3s';
SET statement_timeout = '30s';
ALTER TABLE orders ADD COLUMN status text;
```

```sql title="db/migrations/V42__orders_status_index.sql"
-- Must run outside a transaction: use the tool's non-transactional setting for this file.
-- A long build must not hit statement_timeout, or it leaves an INVALID index.
SET lock_timeout = '3s';
SET statement_timeout = 0;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status ON orders (status);
```

```sql title="find and clean up invalid indexes"
SELECT n.nspname AS schema, c.relname AS index_name
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT i.indisvalid;

-- Then, for each one found (outside a transaction):
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_orders_status;
```

## A lint gate that works with any tool

If you do not use Atlas, a small check in the merge request pipeline catches the worst mistakes. It is not a parser; it is a tripwire that forces a human to say "yes, this drop is the contract step".

```bash title="scripts/check-migrations.sh"
#!/usr/bin/env bash
# Fails on risky statements in new migration files. Needs GNU grep (the CI image has it).
# A file may opt out of the first two checks with a line: -- allow-destructive: <ticket and reason>
set -euo pipefail

status=0
for f in "$@"; do
  [ -f "$f" ] || continue
  body="$(grep -v -E '^[[:space:]]*--' "$f" || true)" # ignore comment lines
  allowed=false
  grep -q -E '^--[[:space:]]*allow-destructive:[[:space:]]*[^[:space:]]+' "$f" && allowed=true

  if [ "${allowed}" = false ] && grep -q -E -i \
    '\b(DROP[[:space:]]+(TABLE|COLUMN)|RENAME[[:space:]]+(TO|COLUMN)|ALTER[[:space:]]+COLUMN[[:space:]]+[^[:space:]]+[[:space:]]+(SET[[:space:]]+DATA[[:space:]]+)?TYPE|SET[[:space:]]+NOT[[:space:]]+NULL|TRUNCATE)\b' \
    <<<"${body}"; then
    echo "ERROR ${f}: destructive or locking change without an allow-destructive line"
    status=1
  fi

  if [ "${allowed}" = false ] \
    && grep -q -E -i '\bCREATE[[:space:]]+(UNIQUE[[:space:]]+)?INDEX\b' <<<"${body}" \
    && ! grep -q -E -i '\bINDEX[[:space:]]+CONCURRENTLY\b' <<<"${body}"; then
    echo "ERROR ${f}: CREATE INDEX without CONCURRENTLY blocks writes to the table while it builds"
    status=1
  fi

  if grep -q -E -i '\bCONCURRENTLY\b' <<<"${body}"; then
    statements="$(grep -v -E -i '^[[:space:]]*SET[[:space:]]' <<<"${body}" | tr -cd ';' | wc -c)"
    if [ "${statements}" -gt 1 ]; then
      echo "ERROR ${f}: a CONCURRENTLY statement must be the only statement in its migration"
      status=1
    fi
  fi
done
exit "${status}"
```

It was tested on 2026-10-21 with GNU grep against sample files: a plain expand step and a lone concurrent index pass; a `DROP COLUMN`, a type change, `SET NOT NULL`, a non-concurrent index and a concurrent index mixed with other statements fail; an `allow-destructive` line lets the drop through. Statements split across a line with a comment marker, or SQL generated at runtime, are out of its reach, which is why review still matters.

## Where migrations run

| Option                                  | For                                                                                   | Against                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| CI job before the deploy                | Visible in the pipeline, easy to gate on approval, logs next to the change             | The runner needs a network path to the instance and a database identity                  |
| Kubernetes Job (or Argo CD `PreSync` hook) | Runs inside the VPC with Workload Identity; tied to the release that needs it        | Hook failures are less visible; retries can re-run a half-applied migration; ordering with the app needs care |
| Application start-up                    | No extra moving parts                                                                 | Every replica races to migrate; a failure becomes a crash loop. Avoid it in production     |

Either of the first two is fine. What matters is that exactly one runner migrates a given database at a time, that it uses a short-lived identity, and that the app version being deployed works with the schema both before and after the migration (the expand and contract rule in [[zero-downtime-deployments-kubernetes]]).

With Argo CD, a migration Job annotated as a `PreSync` hook runs before the sync applies the new Deployment; read the Argo CD hook documentation for the delete policy, and make the Job idempotent because a retried sync runs it again. The GitOps flow is in [[0001-gitops-with-argocd]].

### Connecting from CI with the Cloud SQL Auth Proxy

The Cloud SQL Auth Proxy does the authentication and encryption. With `--auto-iam-authn` it logs in with IAM database authentication, so there is no database password at all. Requirements from its README:

- the instance allows IAM database authentication, and the principal is added as a database user;
- the proxy runs as that same principal;
- for a service account, the PostgreSQL user name is the account's email without `.gserviceaccount.com`, and the name must fit PostgreSQL's 63-character limit;
- the principal has the Cloud SQL Client role (or `cloudsql.instances.connect` and `cloudsql.instances.get`).

The proxy uses Application Default Credentials, so the GitLab job obtains them through Workload Identity Federation exactly as in [[0026-keyless-ci-auth-with-workload-identity-federation]]. It connects to the public IP by default; `--private-ip` selects the private IP, and the proxy does not set up the network for you, so the runner must be able to reach the VPC. `--quitquitquit` starts an admin server on `localhost:9091` whose `/quitquitquit` endpoint shuts the proxy down cleanly, which is how a job or a Job sidecar ends it.

## A complete GitLab CI job (Flyway)

The job uses one image with Flyway, the Cloud SQL Auth Proxy, `gcloud` and the PostgreSQL client, built in your own pipeline and referenced by digest. `MIGRATE_IMAGE` is a project CI/CD variable holding `registry.example.com/platform/db-migrate@sha256:...`; read the digest of an image you built with `crane digest` or `docker buildx imagetools inspect`. Do not use the proxy's `:latest` tag inside it. GitLab CI keywords below follow [[gitlab-ci-pipeline-structure]]; check them against your GitLab version.

```yaml title=".gitlab-ci.yml (migration jobs)"
stages: [verify, migrate, deploy]

variables:
  MIGRATIONS_DIR: db/migrations
  INSTANCE_CONNECTION_NAME: example-project:europe-west1:orders-prod
  DB_NAME: orders
  DB_IAM_USER: orders-migrator@example-project.iam

check-migrations:
  stage: verify
  image: ${MIGRATE_IMAGE}
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - git fetch --depth=50 origin "${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}"
    - |
      mapfile -t NEW_FILES < <(git diff --name-only --diff-filter=A \
        "origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}...HEAD" -- "${MIGRATIONS_DIR}")
      if [ "${#NEW_FILES[@]}" -gt 0 ]; then
        bash scripts/check-migrations.sh "${NEW_FILES[@]}"
      fi
    # Applied migrations must never be edited: modified files fail the merge request.
    - |
      if git diff --name-only --diff-filter=MDR \
           "origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}...HEAD" -- "${MIGRATIONS_DIR}" | grep -q .; then
        echo "ERROR: existing migration files were changed; add a new migration instead"; exit 1
      fi

migrate:production:
  stage: migrate
  image: ${MIGRATE_IMAGE}
  resource_group: db-orders-production   # one migration job at a time for this database
  environment:
    name: production
  id_tokens:
    GCP_ID_TOKEN:
      aud: https://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/ci-prod/providers/gitlab
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
  script:
    - set -eo pipefail
    - CRED_DIR="$(mktemp -d)"
    - echo "${GCP_ID_TOKEN}" > "${CRED_DIR}/id_token"
    - gcloud iam workload-identity-pools create-cred-config
      projects/123456789012/locations/global/workloadIdentityPools/ci-prod/providers/gitlab
      --service-account=orders-migrator@example-project.iam.gserviceaccount.com
      --credential-source-file="${CRED_DIR}/id_token"
      --output-file="${CRED_DIR}/wif.json"
    - export GOOGLE_APPLICATION_CREDENTIALS="${CRED_DIR}/wif.json"
    # Start the proxy as the migrator identity, private IP, fixed port, with the admin endpoint.
    - cloud-sql-proxy --auto-iam-authn --private-ip --port 5432 --quitquitquit
      "${INSTANCE_CONNECTION_NAME}" > "${CRED_DIR}/proxy.log" 2>&1 &
    - for i in $(seq 1 30); do pg_isready -h 127.0.0.1 -p 5432 && break; sleep 1; done
    - pg_isready -h 127.0.0.1 -p 5432
    # Flyway flag names: confirm with `flyway -?` in this image.
    - export FLYWAY_ARGS="-url=jdbc:postgresql://127.0.0.1:5432/${DB_NAME} -user=${DB_IAM_USER} -locations=filesystem:${MIGRATIONS_DIR}"
    - flyway ${FLYWAY_ARGS} info
    - flyway ${FLYWAY_ARGS} validate
    - flyway ${FLYWAY_ARGS} migrate
    - flyway ${FLYWAY_ARGS} info
    - curl -fsS -X POST http://127.0.0.1:9091/quitquitquit || true
```

`123456789012`, `ci-prod`, `orders-prod` and the account names are examples; use the pool, provider and service account from your WIF setup. The `deploy` stage that bumps the image digest runs after this job, so the new code only arrives once the expand step has landed. Keep the migrator identity separate from the application's runtime identity: only it holds DDL rights.

## Validation

After a migration:

```bash title="post-migration checks"
# Run through the proxy as the migrator, or from a bastion with the same identity.
psql "host=127.0.0.1 port=5432 dbname=orders user=orders-migrator@example-project.iam" <<'SQL'
-- No invalid indexes left behind
SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE NOT i.indisvalid;
-- No long lock waits right now
SELECT pid, wait_event_type, wait_event, state, now() - query_start AS running_for, left(query, 80)
FROM pg_stat_activity
WHERE wait_event_type = 'Lock'
ORDER BY running_for DESC;
SQL
```

Also check the tool's own status (`flyway info`, Liquibase `history`, `atlas migrate status` if your version has it) shows the expected version as applied, and the service's error rate and latency on its SLO dashboard did not move.

## Failure modes

| Failure                                   | Symptom                                                         | Prevention and fix                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Lock queue                                | Every query on a table stalls behind a waiting `ALTER`          | `lock_timeout` in the session; retry in a quieter window; find the blocking transaction first         |
| Half-applied migration                    | A multi-statement migration failed after some statements without a transaction | Keep migrations small; transactional unless they must not be; fix forward with a new version   |
| Concurrent index inside a transaction     | `CREATE INDEX CONCURRENTLY cannot run inside a transaction block` | Own file, non-transactional setting                                                                 |
| Invalid index                             | Index exists but is `INVALID`; retries with `IF NOT EXISTS` do nothing | Drop it concurrently and re-run, or `REINDEX INDEX CONCURRENTLY`                               |
| Checksum mismatch                         | Validation fails on a file that was edited after it was applied | Never edit applied files (the CI check above); if it really was a no-op change, use the tool's repair command after review |
| Racing pipelines                          | Two jobs migrate the same database                              | `resource_group` in GitLab and the tool's own lock; never migrate from application start-up           |
| Stale lock                                | Every run waits on a lock row after a crashed job               | Confirm nothing is running, then release it (see the Liquibase warning)                              |
| Proxy cannot connect                      | Timeouts on `127.0.0.1:5432`                                    | Check `proxy.log`, the Cloud SQL Client role, IAM authentication on the instance, and the network path to the private IP |

## Rollback: forward fix or point-in-time recovery

Down migrations are not used in production ([[0048-rollback-by-redeploying-previous-digest]]). That leaves two paths:

1. **Forward fix (the default).** Because expand steps are additive, the previous application version still works with the new schema. Roll the application back by reverting the digest, then write a new migration that corrects the mistake. Nothing is lost.
2. **Point-in-time recovery (the last resort).** If a migration destroyed data (a contract step ran too early, an `UPDATE` without a `WHERE`), restore a clone of the instance to a time just before the migration, compare, and copy back the affected data, or cut over to the clone. This is a data-loss incident: follow [[cloud-sql-ha-failover-recovery]] and [[backup-architecture-gke-cloud-sql-gcs]], and note that every write after the chosen time is lost on a cut-over.

Tool-level undo (Flyway undo migrations, Liquibase rollback; check which edition provides each) can help in development. Do not plan production recovery around it: an undo script is untested code running during an incident, against data that has changed since.

Every production migration is a production change: apply [[production-change-checklist]], including a named owner and a recent backup or confirmed point-in-time recovery window before a contract step.

## Recommendation

- **Default: Flyway's open-source engine with plain versioned SQL.** It maps cleanly to expand and contract, it adds the least abstraction, and its licence is the simplest. Pair it with the lint gate above and the PostgreSQL rules.
- **Atlas** when automated destructive-change and lock analysis is worth more to you than the extra tool, or when you want declarative schemas in development; confirm the licence and feature terms of the binary first.
- **Liquibase** when you already have changelogs, or need one tool across many database engines; confirm the FSL licence fits your use.
- **Run** migrations from a CI job with the Cloud SQL Auth Proxy, IAM database authentication and WIF, or from a Kubernetes Job with Workload Identity. Pool connections for the application separately ([[postgres-connection-pooling-gke]]); the migrator should connect directly.
- **Revisit** if the team moves to many database engines, if a licence changes, or if lint misses become incidents.

## Related

- [[postgres-expand-contract-migrations]]
- [[0027-cloud-sql-for-production-postgres]]
- [[0048-rollback-by-redeploying-previous-digest]]
- [[0026-keyless-ci-auth-with-workload-identity-federation]]
- [[zero-downtime-deployments-kubernetes]]
- [[postgres-connection-pooling-gke]]
- [[cloud-sql-ha-failover-recovery]]
- [[backup-architecture-gke-cloud-sql-gcs]]
- [[gitlab-ci-pipeline-structure]]
- [[production-change-checklist]]

## Sources

- [Flyway documentation](https://documentation.red-gate.com/fd)
- [Flyway repository](https://github.com/flyway/flyway) (licence and editions, read 2026-10-21)
- [Liquibase documentation](https://docs.liquibase.com/)
- [Liquibase repository](https://github.com/liquibase/liquibase) (licence, release cadence, read 2026-10-21)
- [Atlas documentation](https://atlasgo.io/docs)
- [Atlas repository](https://github.com/ariga/atlas) (commands and features, read 2026-10-21)
- [Cloud SQL Auth Proxy for PostgreSQL](https://cloud.google.com/sql/docs/postgres/sql-proxy)
- [Cloud SQL Auth Proxy repository](https://github.com/GoogleCloudPlatform/cloud-sql-proxy) (`--auto-iam-authn`, `--private-ip`, `--quitquitquit`, user naming, read 2026-10-21)
- [PostgreSQL: CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html)
- [PostgreSQL: client connection defaults](https://www.postgresql.org/docs/current/runtime-config-client.html) (`lock_timeout`, `statement_timeout`)
