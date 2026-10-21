---
title: Production readiness review
description: A once-per-service launch gate with a checklist, evidence links, a go, conditional-go or no-go record, and a re-review schedule for critical services.
type: standard
tags:
  - standards
  - reliability
  - on-call
  - management
created: 2026-10-17
modified: 2026-10-21
draft: false
---

A production readiness review (PRR) is the gate between "the service works" and "we can run it". It asks one question: if this service breaks at 03:00, do we know it, can we fix it, and have we proved it? It runs once per service before launch, then again on a schedule for critical services and after a major incident. The output is a dated record with one of three outcomes: go, go with conditions, or no-go.

> [!info] Scope and sources
> This is a team standard, not a quote from a book. It follows the idea of the launch checklist in the Google SRE book and the readiness material in the SRE Workbook. The exact chapter titles of the "Launch Coordination Checklist" and any Workbook readiness content are not verified here. Check them before citing a chapter by name. Every number in this note (the 12-month cadence, the example dates) is a recommendation or an illustration, not a sourced rule.

## Purpose and when to run

The review exists to move surprises from production to a meeting. It also gives an engineering manager a single place where the SLO, alerts, rollback, on-call and capacity evidence meet, instead of five documents that nobody reads together.

Run it:

- **Before first launch** of any service that takes production traffic or holds production data. A service not yet public still needs it if other services will depend on it.
- **Before a major change in shape**: a new region, a move to a new data store, a ten-fold traffic increase, or a new critical dependency.
- **On a schedule** for critical services (see [[production-readiness-review#Re-review cadence|re-review cadence]]).
- **After a SEV1 incident** on the service, as a way to check the follow-up actions actually closed the gap (see [[blameless-postmortems]]).

Who attends: the service owner (presents), an engineer from outside the team (challenges), the on-call lead, and the engineering manager who accepts the risk. The reviewer from outside the team matters. Owners miss their own blind spots.

Keep it to 60 minutes. The evidence is collected before the meeting. If the owner is collecting links during the meeting, the answer is no-go for now.

## Relation to the production change checklist

The two documents have different jobs.

| Aspect       | Production readiness review                    | [[production-change-checklist\|Production change checklist]] |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------ |
| Unit         | A service                                      | A single change                                              |
| Frequency    | Once at launch, then yearly or after an event  | Every production change                                      |
| Question     | Can we operate this service?                   | Can we change it safely right now?                           |
| Output       | Go, conditional go or no-go record             | A completed checklist in the MR or ticket                    |
| Typical gaps | No alert for the main failure, untested backup | No rollback plan, no stop condition                          |

A service that passed its PRR still needs the change checklist for every High change. A service with a perfect change record can still fail a PRR because nobody ever tested restore.

## Review checklist

Each item is a yes or no. A "yes" needs a link in the evidence column. A "yes" with no link is treated as "no". The owner fills the table before the meeting.

### SLOs and SLIs

- The SLIs are defined and measured at the edge closest to the user.
- An SLO is agreed with the product owner, with a window (for example 30 days).
- Burn rate alerts exist and have fired in a test (see [[slo-burn-rate-alerting]]).

### Dependency failure modes and fallbacks

List every dependency the service needs to answer a request. For each one, say what the service does when it is slow, down or returning errors. "We have not tested this" is a valid entry. It is also a risk to record.

### Capacity and headroom evidence

- Expected peak load, with the source of the number.
- A load test that reached at least that peak with headroom, run on a production-like environment (see [[load-and-performance-testing]]).
- Quotas checked: GCP project quotas, Cloud SQL connections, node pool limits.
- Autoscaling limits set, and the cost of the maximum known.

### Dashboards, alerts and runbooks

- One dashboard with the golden signals and the SLO status.
- Every page-level alert links to a runbook. Page-level alerts are for symptoms users feel, not for causes.
- No alert that needs a human at night but has no action.

### Rollback path

- The last three releases were rolled back or could be rolled back in a rehearsal (see [[helm-release-rollback]]).
- Database changes follow expand and contract so code rollback does not need data rollback (see [[postgres-expand-contract-migrations]]).
- Backups exist and a restore has been tested within the last quarter.

### On-call and ownership

- A named owner team and a paging target in the on-call tool.
- The rota has enough people to avoid single-person weeks (see [[on-call-health]]).
- The team has done at least one failure drill (see [[game-day-chaos-gke]]).

### Known risks

Every risk has an owner, a due date and a decision: fix, mitigate, or accept. "Accept" needs the name of the manager who accepted it.

## Decision outcomes

| Outcome            | Meaning                                                                         | What happens next                                                  |
| ------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Go                 | Every item is yes with evidence, or the gap is accepted and written down.       | Launch. Schedule the next review.                                  |
| Go with conditions | Launch is safe enough, but named gaps remain. Each has an owner and a due date. | Launch. Conditions are tracked. Missed conditions re-open the PRR. |
| No-go              | A gap could cause an outage with no detection, no rollback or data loss.        | Do not launch. Fix the blocking items, then repeat the review.     |

Use no-go for gaps in detection, rollback and data safety. Do not use it for gaps in polish. A conditional go with more than about five conditions is usually a no-go in disguise. The point of conditions is to be few and checked.

The decision belongs to the engineering manager who owns the service, with the outside reviewer able to escalate to the director if they disagree. Write down the disagreement.

## Re-review cadence

Recommendation, not a sourced rule:

- **Critical services**: every 12 months, or within 30 days after a SEV1, whichever comes first.
- **Other production services**: when their shape changes, or every 24 months.
- **Conditional go**: the conditions are checked by the due date. If one is missed, the manager decides to extend once with a reason, or the service returns to review.

Define "critical" before you need it: a service whose outage stops revenue, blocks other teams' production, or touches regulated data. Keep the list in the team charter or service catalogue and review it yearly. [[service-tiering-standard]] makes this concrete: critical means tier 0 or tier 1, or any service that holds Restricted data.

In a re-review, do not start from a blank page. Copy the last record, re-check each evidence link (links rot, dashboards get renamed), and focus on what changed: new dependencies, new traffic, new owners.

## Template

Copy this into the service repository or the team wiki. Name it with the service and the date.

```markdown title="prr-<service>-<date>.md"
# Production readiness review: <service>

- Service and owner team:
- Criticality: critical / standard
- Review date:
- Reviewers (owner, outside reviewer, on-call lead, manager):
- Type: launch / scheduled / post-SEV1 / major change
- Previous review (link):

## SLOs

- SLIs and where they are measured:
- SLO and window:
- Burn rate alerts (link):

## Checklist

| Item                                       | Yes / No | Evidence link |
| ------------------------------------------ | -------- | ------------- |
| SLIs defined and measured at the edge      |          |               |
| SLO agreed with product owner              |          |               |
| Burn rate alerts tested                    |          |               |
| Load test reached expected peak + headroom |          |               |
| Quotas and autoscaling limits checked      |          |               |
| Dashboard with golden signals and SLO      |          |               |
| Every page-level alert has a runbook       |          |               |
| Rollback rehearsed in the last 3 releases  |          |               |
| Schema changes use expand and contract     |          |               |
| Restore tested in the last quarter         |          |               |
| Named owner and paging target              |          |               |
| Failure drill done                         |          |               |

## Dependencies

| Name | Failure mode (slow / down / wrong answer) | Fallback and tested? |
| ---- | ----------------------------------------- | -------------------- |
|      |                                           |                      |

## Known risks

| Risk | Owner | Decision (fix / mitigate / accept) | Due |
| ---- | ----- | ---------------------------------- | --- |
|      |       |                                    |     |

## Decision

- Outcome: go / go with conditions / no-go
- Conditions (owner, due date):
- Next review date:
- Dissent, if any:
```

## Worked example: conditional go

An illustrative record for a fictional `orders-api` service. The service names, people and dates are made up.

```markdown title="prr-orders-api-2026-10-17.md"
# Production readiness review: orders-api

- Owner team: Checkout platform
- Criticality: critical
- Review date: 2026-10-17
- Reviewers: A. Owner (owner), B. Outsider (outside reviewer), C. Oncall (on-call lead), D. Manager
- Type: launch

## Result

- SLO: 99.9% of requests not 5xx over 30 days. Burn rate alerts tested on staging.
- Load test reached 1.5 times the expected peak of 400 requests per second.
- Rollback rehearsed in each of the last three releases. Restore from Cloud SQL backup tested on 2026-10-09.

| Item                                       | Yes / No | Evidence link                                      |
| ------------------------------------------ | -------- | -------------------------------------------------- |
| Burn rate alerts tested                    | Yes      | https://example.com/prr/orders-api/burn-test       |
| Load test reached expected peak + headroom | Yes      | https://example.com/prr/orders-api/load-2026-10-12 |
| Rollback rehearsed in the last 3 releases  | Yes      | https://example.com/prr/orders-api/rollbacks       |
| Restore tested in the last quarter         | Yes      | https://example.com/prr/orders-api/restore-test    |

## Dependencies

| Name        | Failure mode | Fallback                                            |
| ----------- | ------------ | --------------------------------------------------- |
| Cloud SQL   | Down         | Read-only mode for order history; writes return 503 |
| payments-ga | Slow (>2 s)  | Timeout at 1 s, queue the capture for retry         |
| Redis cache | Down         | Fall through to the database; load not yet tested   |

## Decision

- Outcome: go with conditions
- Condition 1: Test Redis-down behaviour under load on staging and attach the report. Owner: A. Owner. Due: 2026-11-07.
- Condition 2: Add a runbook link to the `OrdersApiHighLatency` page alert and review it with the on-call lead. Owner: C. Oncall. Due: 2026-10-31.
- Next review: 2027-10-17, or within 30 days of a SEV1.
- Dissent: none.
```

Two conditions, each with a named owner and a date. If the Redis test shows the database cannot absorb the fall-through, the manager re-opens the review instead of extending the date.

## Related notes

- [[production-change-checklist]] for per-change checks.
- [[slo-burn-rate-alerting]] for the alerts the review asks about.
- [[blameless-postmortems]] for the post-SEV1 trigger.
- [[on-call-health]] for rota size and alert quality.
- [[load-and-performance-testing]] and [[game-day-chaos-gke]] for the capacity and failure evidence.
