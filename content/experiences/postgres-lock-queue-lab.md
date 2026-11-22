---
title: A lock queue behind an ALTER, reproduced in a lab
description: A Postgres 17 lab run that reproduced one idle transaction blocking an ALTER and every later reader, and measured what cancelling each session actually does.
type: note
tags:
  - experiences
  - postgres
  - reliability
created: 2026-11-22
modified: 2026-11-22
draft: false
evidence: lab-tested
reviewed: 2026-11-22
review-due: 2027-05-22
---

This is a lab case, not a production incident: a single container, one table, three sessions, run on 2026-11-22. It is recorded because the mechanism is easy to describe and easy to get wrong, and because the numbers below answer questions that a diagram cannot: which session to cancel, what happens to the sessions behind it, and what the defaults allow.

The procedure that came out of it is [[postgres-lock-queue-triage]].

> [!info] What this case is and is not
> Everything below was run. It was not run against a production database, and the timings are those of a laptop container with no load. The evidence level is `lab-tested`; nothing here is `operationally-verified`.

## Context

A migration is running, an application query is slow, and then the whole table stops answering. The usual shape is a chain rather than a single lock:

1. One transaction holds a lock on a row, or just sits `idle in transaction` holding it.
2. A schema change arrives. `ALTER TABLE` needs `ACCESS EXCLUSIVE`, which conflicts with everything, so it waits.
3. Every ordinary reader that arrives afterwards needs only `ACCESS SHARE`. That does not conflict with the first transaction's `ROW EXCLUSIVE` lock, but it does conflict with the waiting `ACCESS EXCLUSIVE`, so each reader queues behind the `ALTER`.

The result is that a read-only query hangs for a reason that has nothing to do with the row it wanted. That third step is the part people miss, and it is the part this lab reproduces.

## The experiment

One container, one table, three sessions. The holder is deliberately harmless: it updates one row and then does nothing, which is what a forgotten transaction looks like.

```bash title="setup"
docker run -d --name pg-lock-lab \
  -e POSTGRES_PASSWORD=lab -e POSTGRES_DB=lab postgres:17-alpine

docker exec pg-lock-lab psql -U postgres -d lab -c \
  "CREATE TABLE accounts (id int PRIMARY KEY, balance numeric NOT NULL);
   INSERT INTO accounts VALUES (1, 100), (2, 100);"
```

```sql title="session A: hold a row lock, then sit idle in transaction"
BEGIN;
UPDATE accounts SET balance = balance - 1 WHERE id = 1;
-- the client then goes quiet for two minutes
```

```sql title="session B: a schema change that needs ACCESS EXCLUSIVE"
SET lock_timeout = '0';
ALTER TABLE accounts ADD COLUMN note text;
```

```sql title="session C: an ordinary read"
SELECT count(*) AS accounts FROM accounts;
```

Session A was started with a client that sends the two statements and then stops reading, so the server sees `idle in transaction` rather than `active`. That distinction matters for the diagnosis, and it is what a real application connection pool leak looks like.

## What happened

The chain, read from `pg_stat_activity`:

```text
 pid |        state        | wait_event_type | blocked_by |                    query
-----+---------------------+-----------------+------------+------------------------------------------
 175 | idle in transaction | Client          | {}         | UPDATE accounts SET balance=balance-1 WH
 189 | active              | Lock            | {175}      | ALTER TABLE accounts ADD COLUMN note tex
 197 | active              | Lock            | {189}      | SELECT count(*) AS accounts FROM account
```

Three things to read from it:

- The holder is `idle in transaction` with `wait_event_type` `Client`: it is not working, it is waiting for its client. That is the fault, not the symptom.
- The `ALTER` is blocked by the holder only. `pg_blocking_pids` gives direct blockers, not the root.
- The reader is blocked by the `ALTER`, not by the holder. It would have run fine against the holder alone.

The lock table shows the same thing from the lock side, which is what makes the third line surprising:

```text
 pid | locktype |        mode         | granted | relname
-----+----------+---------------------+---------+----------
 115 | relation | AccessExclusiveLock | f       | accounts
 122 | relation | AccessShareLock     | f       | accounts
  94 | relation | RowExclusiveLock    | t       | accounts
```

`AccessShareLock` and `RowExclusiveLock` do not conflict. The reader is queued only because the ungranted `AccessExclusiveLock` is ahead of it.

### Finding the root, not the middle

`pg_blocking_pids` returns one level. Walking it to the head of the chain gives the session that is blocked by nobody, which is the one to act on:

```sql title="root of each chain"
WITH RECURSIVE walk AS (
  SELECT pid AS blocked, pid AS node, 0 AS depth
  FROM pg_stat_activity
  WHERE cardinality(pg_blocking_pids(pid)) > 0
  UNION ALL
  SELECT w.blocked, b.pid, w.depth + 1
  FROM walk w
  CROSS JOIN LATERAL unnest(pg_blocking_pids(w.node)) AS b(pid)
  WHERE w.depth < 10
)
SELECT blocked, node AS root, max(depth) AS depth
FROM walk
WHERE cardinality(pg_blocking_pids(node)) = 0
GROUP BY blocked, node
ORDER BY blocked;
```

```text
 blocked | root | depth
---------+------+-------
     189 |  175 |     1
     197 |  175 |     2
```

Both the `ALTER` and the reader trace back to the idle transaction.

### What each cancellation actually does

Cancelling the `ALTER` in the middle of the chain:

```sql
SELECT pg_cancel_backend(189);
```

```text
 pid |        state        | wait_event_type | blocked_by |                    query
-----+---------------------+-----------------+------------+------------------------------------------
 175 | idle in transaction | Client          | {}         | UPDATE accounts SET balance=balance-1 WH
```

The reader completed immediately once the `ALTER` left the queue, and the holder was untouched. So for restoring service, the `ALTER` is the right thing to cancel: it is usually retried by a migration job, and it is the only session blocking the readers. The holder is still there and will do this again.

That is the distinction the runbook is built on:

- **Restore service:** cancel the waiting DDL. Readers flow, the migration retries, nobody loses a customer transaction.
- **Fix the cause:** deal with the root, which is the idle transaction.
- **Never** reach for `pg_terminate_backend` on the root as a first move if it might be a customer's transaction mid-flight.

### The defaults that allow it

```text
idle_in_transaction_session_timeout|0|ms
lock_timeout|0|ms
statement_timeout|0|ms
```

All three are `0`, which means disabled. Nothing in a default PostgreSQL 17 server will stop an idle transaction from holding a lock indefinitely, and nothing will stop an `ALTER` from waiting forever and queueing readers behind it. The holder in this run had been idle for 26 seconds when measured, and would have stayed until its client did something.

### The prevention, measured

`lock_timeout` on the `ALTER` makes the migration fail fast instead of queueing readers:

```sql
SET lock_timeout = '2s';
ALTER TABLE accounts ADD COLUMN note text;
```

```text
SET
ERROR:  canceling statement due to lock timeout
```

`idle_in_transaction_session_timeout` on the server removes the holder instead:

```sql
ALTER SYSTEM SET idle_in_transaction_session_timeout = '2s';
SELECT pg_reload_conf();
```

With that set, a session that goes idle in a transaction is terminated:

```text
BEGIN
UPDATE 1
FATAL:  terminating connection due to idle-in-transaction timeout
server closed the connection unexpectedly
```

One detail worth knowing: the client saw nothing until it tried to send another statement. The server had already ended the session, but a client blocked on its own input does not notice until it writes. In the run, the message appeared only after a following `SELECT 1;` was sent.

## What it means

Four rules came out of this run:

1. **Read `state` before `blocked_by`.** `idle in transaction` with `wait_event_type` `Client` is a forgotten transaction, not a slow query. The fix is different.
2. **Find the root, then decide which session to act on.** They are not the same session: the root is what to fix, the waiting DDL is what to cancel to restore service.
3. **A waiting `ALTER` is an outage amplifier.** It converts one blocked row into a blocked table. That is why migrations carry `lock_timeout`, and why the DDL is the first thing to cancel during the incident.
4. **The defaults do not protect you.** `lock_timeout`, `idle_in_transaction_session_timeout` and `statement_timeout` are all `0` unless someone set them.

The first rule is the one that a diagram does not teach. The second is the one that stops people terminating the wrong session.

## Evidence

### Sources checked

- [PostgreSQL 17: Client Connection Defaults](https://www.postgresql.org/docs/17/runtime-config-client.html): the behaviour and zero defaults of `lock_timeout`, `idle_in_transaction_session_timeout` and `statement_timeout`, and that `transaction_timeout` exists in 17 and is ignored when it is shorter than the other two; checked 2026-11-22.
- [PostgreSQL 17: Lock Management](https://www.postgresql.org/docs/17/runtime-config-locks.html): `deadlock_timeout` and `log_lock_waits`, which determine when a lock wait is logged; checked 2026-11-22.
- [PostgreSQL 17: Monitoring Database Activity](https://www.postgresql.org/docs/17/monitoring-stats.html): `pg_stat_activity` columns used above (`state`, `wait_event_type`, `wait_event`, `state_change`); checked 2026-11-22.
- [PostgreSQL 17: System Administration Functions](https://www.postgresql.org/docs/17/functions-admin.html): `pg_blocking_pids`, `pg_cancel_backend`, `pg_terminate_backend` and `pg_reload_conf`; checked 2026-11-22.

### Not verified

- The lock mode names (`AccessShareLock`, `RowExclusiveLock`, `AccessExclusiveLock`) and their conflict matrix were read from the run's own `pg_locks` output, not re-derived from the concurrency chapter.
- Only the `idle in transaction` holder was reproduced. An `active` holder mid-statement behaves the same way in this lab, but the `state` value differs and that was not recorded as a separate case.
- Timings are from a local container with no other load; they say nothing about how long a queue takes to build on a busy server.
- `transaction_timeout` was not exercised. The docs say it is ignored when it is shorter than `statement_timeout` or `idle_in_transaction_session_timeout`; that was read, not run.
- The behaviour of `pg_cancel_backend` on a session inside a multi-statement transaction, and whether the client sees an error or a silent rollback, was not tested beyond the single case above.

### Environment

Docker 29.9.2 on Windows, with the official `postgres:17-alpine` image. The server reported `PostgreSQL 17.12 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit`. The client was `psql` from the same image.

### Prerequisites

Docker with permission to run containers. No existing database, cluster or data: the container is created for the run and removed after it. No network access is needed beyond pulling the image.

### Expected results

A three-session chain in `pg_stat_activity` where the reader's `blocked_by` names the `ALTER` and not the holder; cancelling the `ALTER` lets the reader finish while the holder remains; a `lock_timeout` of 2 seconds turns the `ALTER` into `ERROR: canceling statement due to lock timeout`.

### Failure conditions

- No chain appears: check that the holder's transaction is still open (`state` is `idle in transaction`, not `idle`) and that the `ALTER` has actually started.
- The reader finishes immediately: the `ALTER` has not reached the lock wait yet, or it was already cancelled. Re-run the `ALTER` before the reader.
- `pg_blocking_pids` returns `{}` for every session: the holder's transaction has ended.

### Cleanup and rollback

The whole experiment is one container and one table:

```bash
docker rm -f pg-lock-lab
```

If the container was started with `ALTER SYSTEM SET idle_in_transaction_session_timeout`, that setting lives only in this container's `postgresql.auto.conf` and disappears with it. Nothing outside the container was changed.

### Lab run

Host: Windows with Docker 29.9.2. Image: `postgres:17-alpine`, server `PostgreSQL 17.12 on x86_64-pc-linux-musl`, `psql` from the same image. Date: 2026-11-22.

Commands, in order (the holder and the `ALTER` were started detached so they could wait):

```bash
docker run -d --name pg-lock-lab -e POSTGRES_PASSWORD=lab -e POSTGRES_DB=lab postgres:17-alpine
docker exec pg-lock-lab psql -U postgres -d lab -c "CREATE TABLE accounts (id int PRIMARY KEY, balance numeric NOT NULL); INSERT INTO accounts VALUES (1, 100), (2, 100);"

# holder: BEGIN; UPDATE; then idle in transaction
docker exec -d pg-lock-lab bash -c "(printf 'BEGIN;\nUPDATE accounts SET balance=balance-1 WHERE id=1;\n'; sleep 120) | psql -U postgres -d lab -q"
# ALTER, then a reader behind it
docker exec -d pg-lock-lab psql -U postgres -d lab -c "SET lock_timeout='0'; ALTER TABLE accounts ADD COLUMN note text;"
docker exec -d pg-lock-lab psql -U postgres -d lab -c "SELECT count(*) AS accounts FROM accounts;"

docker exec pg-lock-lab psql -U postgres -d lab -c \
  "select pid, state, wait_event_type, pg_blocking_pids(pid) as blocked_by, left(regexp_replace(query,'\s+',' ','g'),40) as q from pg_stat_activity where datname='lab' and pid<>pg_backend_pid() order by pid"
```

Observed output, at the moment all three sessions existed:

```text
 pid |        state        | wait_event_type | blocked_by |                    q
-----+---------------------+-----------------+------------+------------------------------------------
 175 | idle in transaction | Client          | {}         | UPDATE accounts SET balance=balance-1 WH
 189 | active              | Lock            | {175}      | ALTER TABLE accounts ADD COLUMN note tex
 197 | active              | Lock            | {189}      | SELECT count(*) AS accounts FROM account
```

Then `pg_cancel_backend(189)` was run, and the reader (197) disappeared from `pg_stat_activity` while the holder (175) stayed. Then, with a fresh holder, `ALTER SYSTEM SET idle_in_transaction_session_timeout='2s'` was applied and a session was left idle; it was present at 1.2 seconds and gone at 4.2 seconds, and the client printed `FATAL: terminating connection due to idle-in-transaction timeout` on its next statement.

## Related

- [[postgres-lock-queue-triage]]: the runbook built from this case.
- [[postgres-expand-contract-migrations]]: why migrations carry `lock_timeout`, and how to run DDL on a live table.
- [[postgres-autovacuum-health-and-tuning]]: the other long-transaction problem, where an idle transaction pins the xmin horizon.
- [[experiences/index|Experiences]]: the section this note belongs to.
