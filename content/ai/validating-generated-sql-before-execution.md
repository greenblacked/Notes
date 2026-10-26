---
title: Validating generated SQL before execution
description: Treat model-produced SQL as untrusted code and validate its intent, scope, and effects before any database accepts it.
type: guide
tags:
  - ai
  - security
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Treat SQL as an executable proposal

Generated SQL can be syntactically valid and still update the wrong tenant, bypass an authorization filter, scan an enormous table, or destroy data. Do not execute SQL merely because it came from a trusted model or passed a parser. A database permission boundary, not a prompt, must prevent an assistant from exceeding its task.

First classify the request: read-only query, data change, schema change, or administrative operation. State the intended tables, keys, row scope, expected result shape, and acceptable cost. Ask for a query and a plain-language explanation of its join path, filters, grouping, and side effects. If the request is ambiguous about tenant, time window, or deletion semantics, stop and resolve the requirement rather than letting the model invent a default.

This is narrower than [[ai-assisted-database-migration-review]], which evaluates versioned schema changes and deployment sequencing. The broader permission boundary is covered in [[securing-ai-agents-in-ci-and-cloud]]. For shell execution boundaries, see [[safe-shell-command-generation-for-agents]].

## Review and execution workflow

1. **Use the application interface where possible.** Prefer parameterized application queries and typed query builders over concatenating generated SQL with user data. Database identifiers often cannot be bound like values; select identifiers from a fixed allowlist rather than interpolating arbitrary names.
2. **Parse and classify.** Use a dialect-aware parser or reviewed query tooling to identify statement types, referenced tables, functions, and multiple statements. Parsing is only a structural control: it cannot prove business correctness or that a function is harmless.
3. **Constrain the database principal.** Use a read-only role for analysis, with access only to approved schemas and views. For write tasks, use a separate narrowly scoped identity in a disposable or staging database. Never provide production superuser or owner credentials to an agent.
4. **Inspect query intent.** Check that every join has the intended key, filters constrain the intended tenant and time range, null behavior is understood, and pagination is stable. For a mutation, inspect the exact predicate and count the affected rows before applying it.
5. **Preview safely.** Run a read query against a representative non-production snapshot. For `UPDATE` or `DELETE`, use a transaction in an isolated environment, inspect the affected-row count and before/after values, then roll back. Do not assume a transaction removes external side effects from triggers, extensions, or application hooks.
6. **Apply independent limits.** Set statement timeout, resource quotas, row limits, and network restrictions at the database or service layer when available. `LIMIT` is not a safe substitute for a complete mutation predicate and may not constrain all query work.
7. **Require a human approval for writes.** A qualified owner reviews the exact SQL, environment, parameters, expected impact, and rollback path. Execute through the established deployment or migration path and retain an audit trail of approval and result.

Bind values separately from SQL text. Parameterization both avoids common injection patterns and prevents values from changing query structure; it does not authorize access to rows. Enforce tenant isolation and authorization in trusted application or database policy, not in an unverified generated `WHERE` clause.

## Failure modes and guardrails

Common errors include an omitted predicate, an accidental cross join, a join on a non-unique column, incorrect aggregation after a one-to-many join, unsafe assumptions about `NULL`, a dialect mismatch, and a destructive operation hidden in a multi-statement string. Model explanations can omit a side effect, and tests on a tiny fixture may not reveal a production-scale scan. A valid execution plan says something about cost estimates, not correctness.

Reject statements outside the requested class, including unexpected DDL, privilege changes, functions with side effects, and multiple statements. Do not automatically “repair” a query after a syntax error and execute the revision; re-run the full review on the new exact text. If a query returns a surprising number of rows, stop and investigate. Do not retry mutations blindly after a timeout because the server may have committed before the client lost the response.

For emergency fixes, use the normal incident and database-change procedures; urgency is not permission to widen credentials. Preserve the generated statement and review record when needed for audit, but avoid logging sensitive parameter values. If an unexpected write occurs, stop subsequent runs, notify the database owner, preserve transaction and audit evidence, and follow the established recovery plan.

## Decision checklist

- Is the target database, schema, tenant, and operation explicit?
- Is the SQL dialect known, and are identifiers allowlisted?
- Are values passed as bound parameters rather than concatenated?
- Does the execution identity have only necessary read/write rights?
- Have joins, filters, nulls, side effects, row counts, and cost been reviewed?
- Was the exact statement tested on a non-production dataset?
- For writes, is there human approval, a recovery plan, and an audit record?

If a control cannot be established, keep the output advisory and do not execute it. Any production write should use the same approval and deployment safeguards as equivalent human-authored SQL.

## Related

- [Owner’s AI skills catalogue](https://ai.szolotov.com).

## Sources

- [PostgreSQL 18 Documentation: PREPARE](https://www.postgresql.org/docs/current/sql-prepare.html): parameterized prepared statements and execution semantics; verify dialect-specific behavior.
- [PostgreSQL 18 Documentation: Transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html): transaction grouping and rollback concepts.
- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html): parameterized-query and validation defenses.
