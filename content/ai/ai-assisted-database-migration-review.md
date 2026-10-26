---
title: AI-assisted database migration review
description: Review generated schema migrations for correctness, deployment safety, data preservation, and a tested recovery path.
type: guide
tags:
  - ai
  - reliability
  - security
  - ci-cd
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Migration output is a proposal

Database migration tools and language models can generate plausible schema changes from model definitions, but neither understands every production invariant. A migration that applies cleanly to an empty test database can lock a large table, break old application instances during rollout, discard data, or fail halfway through on real distributions. Review the migration as a production change, not as a mechanical companion file.

Begin with the product-level contract: what data changes, which readers and writers use it, whether old and new application versions will overlap, and what the recovery strategy is. Ask the model to explain each operation and identify assumptions, then compare the explanation with the actual SQL and the database engine's behavior. Use the existing migration framework and naming/order rules. Do not accept a generated migration solely because autogeneration reports no difference afterward.

This note covers database schema/data migrations, not SQL query execution generally; see [[validating-generated-sql-before-execution]] for query-level controls. Infrastructure change review is covered separately in [[validating-ai-generated-infrastructure-code]].

## Review and rollout workflow

1. **Inspect the diff against the declared model.** Confirm the migration is limited to intended tables, indexes, constraints, and data transformations. Investigate every operation that the tool adds or omits. Verify the selected database dialect and migration-tool version.
2. **Look for data-loss and compatibility hazards.** Review column drops/renames, type narrowing, default changes, nullable-to-not-null transitions, uniqueness constraints, cascades, and backfills. Confirm that constraints match actual application invariants and that data is preserved or intentionally transformed.
3. **Assess operational impact.** Determine likely table size, lock behavior, index-build strategy, transaction semantics, replication effects, and timeout behavior for the exact engine/version. Do not generalize from a small local database. Test on representative anonymized data when possible.
4. **Plan for mixed versions.** Prefer an expand-migrate-contract sequence when the deployment has overlapping application versions: add compatible structures, deploy code that can use both, backfill in bounded batches, switch reads/writes, then remove obsolete structures in a later reviewed change. This pattern is a design option, not a universal requirement.
5. **Test more than a fresh install.** Apply the migration from the previous released schema, test upgrade and supported downgrade paths, validate post-migration data invariants, and test application behavior before and after rollout. Where downgrade is unsafe, document forward-recovery steps instead of pretending rollback is available.
6. **Stage and observe.** Use the normal migration pipeline with a narrowly scoped identity. Set operational monitoring for duration, locks, replication lag, errors, and application health. Define stop conditions and who may pause the rollout.
7. **Review exact deployment artifacts.** The reviewer should inspect generated migration source, SQL emitted by the framework where available, framework version, test results, execution order, and cleanup plan. A regenerated file is a new diff and requires a fresh review.

Backfills deserve their own design: idempotent batches, explicit progress, throttling, restart behavior, data validation, and a defined point at which old and new representations agree. Do not put an unbounded data rewrite into a schema migration merely because the generated code is concise.

## Failure modes and recovery

Autogeneration may mistake a rename for drop-and-create, miss an application-only invariant, emit unsupported operations, or assume a default that changes existing rows. Reviewers may focus on source-level syntax and miss implicit locking or an index build that blocks writes. A transaction may be unavailable or behave differently for particular DDL. “Rollback” may restore the schema while losing newly written data or reversing a transformation that is not reversible.

If migration output is uncertain, require a database owner to confirm its behavior against official engine documentation or a representative test. Do not execute exploratory migrations on production. If deployment fails, stop further schema changes and follow the pre-approved recovery decision tree; preserve logs and state, and avoid repeatedly applying a non-idempotent migration. If the migration may have altered or exposed records unexpectedly, invoke the incident and data-recovery process.

## Decision checklist

- Is the migration derived from an explicit schema/product requirement?
- Were generated operations checked for rename errors, data loss, and omitted invariants?
- Are engine, framework, and production-scale locking/transaction behaviors understood?
- Can old and new app versions safely coexist during deployment?
- Are backfills bounded, restartable, and validated?
- Have upgrade, downgrade or forward-recovery, and data invariants been tested?
- Are approvals, stop conditions, monitoring, and ownership explicit?

Defer the change if the rollback path is unclear, critical data invariants are unknown, or a large-table operation lacks a tested rollout plan.

## Related

- [Owner’s AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Alembic: Auto Generating Migrations](https://alembic.sqlalchemy.org/en/latest/autogenerate.html): limits and review expectations for migration autogeneration.
- [PostgreSQL 18 Documentation: ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html): operation-specific behavior; verify against the production engine version.
- [Redgate Flyway: Versioned migrations](https://documentation.red-gate.com/fd/versioned-migrations-273973333.html): versioned migration workflow and execution concepts.
