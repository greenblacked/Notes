---
title: Validating generated SQL before execution
description: Treat model-produced SQL as untrusted code and validate its intent, scope, and effects before any database accepts it.
type: guide
tags:
  - ai
  - security
  - audit
created: 2026-10-26
modified: 2026-11-02
evidence: source-reviewed
reviewed: 2026-11-02
review-due: 2027-05-02
draft: false
---

## Treat SQL as an executable proposal

Generated SQL can be syntactically valid and still update the wrong tenant, bypass an authorization filter, scan an enormous table, or destroy data. Do not execute SQL merely because it came from a trusted model or passed a parser. A database permission boundary, not a prompt, must prevent an assistant from exceeding its task.

First classify the request: read-only query, data change, schema change, or administrative operation. State the intended tables, keys, row scope, expected result shape, and acceptable cost. Ask for a query and a plain-language explanation of its join path, filters, grouping, and side effects. If the request is ambiguous about tenant, time window, or deletion semantics, stop and resolve the requirement rather than letting the model invent a default.

This is narrower than [[ai-assisted-database-migration-review]], which evaluates versioned schema changes and deployment sequencing. The broader permission boundary is covered in [[securing-ai-agents-in-ci-and-cloud]]. For shell execution boundaries, see [[safe-shell-command-generation-for-agents]].

## Review and execution workflow

1. **Use the application interface where possible.** Prefer parameterized application queries and typed query builders over concatenating generated SQL with user data. In PostgreSQL, PREPARE accepts only SELECT, INSERT, UPDATE, DELETE, MERGE or VALUES statements, and parameter symbols stand only for data values, not identifiers; select identifiers from a fixed allowlist rather than interpolating arbitrary names.
2. **Parse and classify.** Use a dialect-aware parser or reviewed query tooling to identify statement types, referenced tables, functions, and multiple statements. Parsing is only a structural control: it cannot prove business correctness or that a function is harmless.
3. **Constrain the database principal.** Use a read-only role for analysis, with access only to approved schemas and views. A read-only transaction is a useful extra layer, but PostgreSQL documents it as a high-level notion that does not prevent all writes to disk, so it does not replace role privileges. For write tasks, use a separate narrowly scoped identity in a disposable or staging database. Never provide production superuser or owner credentials to an agent.
4. **Inspect query intent.** Check that every join has the intended key, filters constrain the intended tenant and time range, null behavior is understood, and pagination is stable. For a mutation, inspect the exact predicate and count the affected rows before applying it.
5. **Preview safely.** Run a read query against a representative non-production snapshot. For `UPDATE` or `DELETE`, use a transaction in an isolated environment, inspect the affected-row count and before/after values, then roll back. Use plain `EXPLAIN` for cost estimates without execution; `EXPLAIN ANALYZE` actually executes the statement, so wrap a data-changing one in a transaction that you roll back. Do not assume a transaction removes external side effects from triggers, extensions, or application hooks.
6. **Apply independent limits.** Set statement timeout (PostgreSQL disables it by default, and applies it to each statement of a multi-statement simple query separately), resource quotas, row limits, and network restrictions at the database or service layer when available. `LIMIT` is not a safe substitute for a complete mutation predicate and may not constrain all query work.
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

## Evidence

Source-reviewed on 2026-11-02. Nothing was run. Scope: the PostgreSQL and OWASP LLM statements in this note.

### Sources checked

- [PostgreSQL documentation: PREPARE](https://www.postgresql.org/docs/current/sql-prepare.html): parameters referenced by position ($1, $2); allowed statement kinds are SELECT, INSERT, UPDATE, DELETE, MERGE and VALUES. Checked 2026-11-02 against postgres commit cc4bf6e (doc/src/sgml/ref/prepare.sgml, version 18.6).
- [PostgreSQL documentation: EXPLAIN](https://www.postgresql.org/docs/current/sql-explain.html): plain EXPLAIN shows estimated costs; ANALYZE actually executes the statement and its side effects occur, with BEGIN / EXPLAIN ANALYZE / ROLLBACK as the documented way to avoid changing data. Checked 2026-11-02 against postgres commit cc4bf6e (doc/src/sgml/ref/explain.sgml).
- [PostgreSQL documentation: ROLLBACK](https://www.postgresql.org/docs/current/sql-rollback.html): rollback discards all updates made by the transaction. Checked 2026-11-02 against postgres commit cc4bf6e (doc/src/sgml/ref/rollback.sgml).
- [PostgreSQL documentation: SET TRANSACTION](https://www.postgresql.org/docs/current/sql-set-transaction.html): READ ONLY is a high-level notion that does not prevent all writes to disk. Checked 2026-11-02 against postgres commit cc4bf6e (doc/src/sgml/ref/set_transaction.sgml).
- [PostgreSQL documentation: Client connection defaults, statement_timeout](https://www.postgresql.org/docs/current/runtime-config-client.html): zero (default) disables the timeout; applied to each statement of a multi-statement simple query separately (since version 13). Checked 2026-11-02 against postgres commit cc4bf6e (doc/src/sgml/config.sgml).
- [PostgreSQL documentation: PL/pgSQL, Executing Dynamic Commands](https://www.postgresql.org/docs/current/plpgsql-statements.html#PLPGSQL-STATEMENTS-EXECUTING-DYN): parameter symbols can only be used for data values; table or column names must be inserted textually (quote_ident or format %I). Checked 2026-11-02 against postgres commit cc4bf6e (doc/src/sgml/plpgsql.sgml).
- [PostgreSQL documentation: Transactions tutorial](https://www.postgresql.org/docs/current/tutorial-transactions.html): a transaction groups steps into an all-or-nothing operation, and ROLLBACK abandons its updates. Checked 2026-11-02 against postgres commit cc4bf6e (doc/src/sgml/advanced.sgml).
- [OWASP Top 10 for LLM Applications 2025: LLM05 Improper Output Handling and LLM06 Excessive Agency](https://genai.owasp.org/llm-top-10/): unparameterized model-generated SQL causes SQL injection; use parameterized queries; limit database permissions of the agent identity (read access only where that is enough) and require human approval for high-impact actions. Checked 2026-11-02 against owasp-llm commit 99f4395.

### Not verified

- The OWASP SQL Injection Prevention Cheat Sheet was not available locally; its listing under Sources is kept for general reference only.
- Claims that parameter binding prevents values from changing query structure, that triggers, extensions or hooks have effects a rollback cannot undo, and that a server may commit before the client sees a timeout, and that LIMIT may not bound all query work (sorts, aggregates, or joins can run before rows are limited) are standard engineering knowledge not read in a specific page.
- Engineering guidance (tenant isolation in trusted policy, dialect-aware parsing, failure modes such as cross joins, review workflow and approval roles) is not claim-by-claim documented.
- Behavior of other database dialects was not checked; only PostgreSQL 18.6 documentation was read.
- Nothing was run.

## Sources

- [PostgreSQL 18 Documentation: PREPARE](https://www.postgresql.org/docs/current/sql-prepare.html): parameterized prepared statements and execution semantics; verify dialect-specific behavior.
- [PostgreSQL 18 Documentation: Transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html): transaction grouping and rollback concepts.
- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html): parameterized-query and validation defenses (not read; see Not verified).
- [LLM05:2025 Improper Output Handling](https://genai.owasp.org/llm-top-10/): model-generated SQL executed without parameterization leads to SQL injection.
- [LLM06:2025 Excessive Agency](https://genai.owasp.org/llm-top-10/): minimize permissions at the database identity and require human approval for high-impact actions.
