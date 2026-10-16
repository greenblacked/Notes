---
title: Incident response
description: "A practical incident process: declare, severity levels, roles, Slack conventions, update cadence and templates, mitigation first, handover and follow-up."
type: runbook
tags:
  - runbooks
  - incident-management
  - on-call
  - reliability
created: 2026-10-16
modified: 2026-10-16
draft: false
---

This is the process for running a production incident with a small team. It is deliberately light: one page you can follow at 03:00. The aim is to restore service quickly, keep everyone informed without distracting the people fixing it, and learn afterwards.

## When to use

- A customer-facing service is down or badly degraded, or an SLO is burning fast (see [[slo-burn-rate-alerting]]).
- Data loss, a security event or a leaked secret is suspected (for a leaked credential, also open [[leaked-credential-rotation]]).
- You are unsure whether it is an incident. Declare it; closing a false alarm costs ten minutes, a late declaration costs much more.

Planned changes that go wrong are incidents too. Routine tickets, single-user problems and known maintenance are not.

## Preconditions

- An on-call rota with a named primary and secondary, and a way to page them. Rota health is a management concern, see [[on-call-health]].
- A paging tool, a Slack workspace with the incident channel convention below, a status page, and a shared incident template (document or issue).
- Dashboards and logs reachable without the thing that is broken (a monitoring stack that lives in the failing cluster is a trap).
- Everyone on call has read this page and has done one practice run.

## Steps

### 1. Declare

Anyone can declare. Do it as soon as customer impact is likely, before you understand the cause.

1. Page the on-call if not already paged.
2. Create a channel `#inc-YYYYMMDD-short-name` (for example `#inc-20261016-checkout-5xx`).
3. Post the opening message and pin it:

```text
INCIDENT DECLARED
Severity: SEV2 (provisional)
Impact: checkout API returning 5xx for ~30% of requests since 14:05 UTC
Incident Commander: @name
Ops lead: @name
Comms: @name
Next update: 14:30 UTC
Doc / dashboard: <link>
```

4. Assign the roles below. One person can hold two roles in a small incident, but never the Incident Commander and Ops lead roles together past the first minutes.

### 2. Severity levels

Set provisionally, adjust as facts arrive. Raise early, lower freely.

| Level | Meaning                                                                | Response                                       | Update cadence                |
| ----- | ---------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------- |
| SEV1  | Full outage of a critical service, data loss or active security breach | Page everyone needed, all hands, exec informed | every 15 min                  |
| SEV2  | Major degradation, a large share of users or a key feature affected    | Page on-call and relevant owners               | every 30 min                  |
| SEV3  | Limited impact, workaround exists, or a non-critical service down      | On-call handles in working hours or next page  | every 60 min or at milestones |
| SEV4  | Minor issue, no customer impact                                        | Ticket, no incident channel                    | none                          |

Adjust the thresholds to your own SLOs and agree them with the product owners in advance.

### 3. Roles

- **Incident Commander (IC):** owns the incident, not the fix. Keeps the timeline, makes decisions, decides severity, asks for help, calls the end. Does not type commands in production. If you are the first responder and nobody else is there, you are IC until you hand over.
- **Ops lead (operations):** investigates and executes mitigation. Pulls in subject-matter experts. Reports findings to the IC in short sentences.
- **Comms lead:** writes internal and external updates on the agreed cadence, updates the status page, handles stakeholder questions so the others are not interrupted.
- **Scribe (optional):** records the timeline with times: what was seen, what was decided, what was changed. A bot or the Comms lead can do it in small incidents.

Everyone else observes in the channel, answers questions asked of them, and does not start side work without telling the IC.

### 4. Slack conventions

- One channel per incident. Name it `#inc-<date>-<short-name>`; archive it after the postmortem.
- Top-level messages are facts and decisions. Use threads for discussion. The IC pins the current summary.
- Prefix timeline entries with the time and a tag: `14:12 ACTION @ops rolled back to v1.8.2`. A scribe can search these later.
- Do not paste secrets, customer data or full logs; link to the log query instead.
- Use a call or huddle for voice, and post the link in the channel. Decisions made in a call are restated in the channel.
- Keep chatter and speculation out of the main channel: `#inc-...-side` for deep dives.

### 5. Mitigate first, then diagnose

Restoring service beats understanding. In order of preference:

1. **Roll back** the last change (deploy, config, feature flag, infrastructure). Ask "what changed?" first; most incidents follow a change. See [[helm-release-rollback]].
2. **Disable** the feature or traffic path (flag off, rate limit, shed load, fail over).
3. **Scale** or restart if the cause is capacity or a stuck process, noting that restarts destroy evidence: capture logs and a heap or goroutine dump first when cheap.
4. **Fix forward** only when rollback is impossible and the fix is small and understood.

The IC asks the Ops lead at regular intervals: what is the current hypothesis, what are you doing, and what do you need. Time-box any hypothesis (for example 15 minutes) before trying another. Every production change during an incident is announced in the channel before it is made.

### 6. Status updates

Update on the cadence even when there is nothing new; silence is read as "nobody is working on it".

Internal update template:

```text
UPDATE 14:30 UTC | SEV2 | Investigating
Impact: <who and what, with numbers>
What we know: <facts only>
What we are doing: <current mitigation / next step and owner>
Next update: 15:00 UTC
```

External status page template (plain language, no internal names):

```text
Investigating: We are aware of errors affecting checkout for some customers.
Our engineers are working on it. Next update by 15:00 UTC.

Identified: The cause has been identified and a fix is being applied.

Monitoring: A fix has been applied. We are monitoring the recovery.

Resolved: This incident is resolved. Checkout is operating normally.
```

State impact and next steps, not guessed causes or blame.

### 7. Handover

If an incident runs past about two hours or the responders are tired, hand over deliberately. A fresh IC and Ops lead take over in a short call and the outgoing IC posts:

```text
HANDOVER 17:00 UTC
Outgoing IC: @a -> Incoming IC: @b
Status: mitigated at 16:40 by disabling feature X; error rate 0.2%, monitoring
Open: root cause unknown; suspect cache change deployed 14:00
Timeline: <doc link>
Next update: 17:30 UTC
```

The incoming IC acknowledges explicitly. Responders who have worked a long night go home; do not rely on heroics.

### 8. Close

Close when impact has ended and the service has been stable for an agreed period (for example 30 to 60 minutes), the status page says resolved, and temporary mitigations are either removed or tracked.

1. Post the resolution message with the end time and impact summary.
2. Record start, detection, mitigation and end times in the incident doc: these give time to detect and time to recover, see [[dora-metrics]].
3. Create follow-up tickets for anything still open, such as a temporary workaround.
4. For SEV1 and SEV2, hold the review within 5 working days and publish the final version within 10, as set in [[blameless-postmortems]].

## Validation

An incident was handled well if:

- the first update went out within the cadence of its severity;
- each production change appears in the timeline with a time and an owner;
- impact ended and the dashboards confirm it (error rate, latency, queue depth), not just "the alert stopped";
- the status page and the internal channel agree;
- a postmortem is scheduled with an owner and a date.

## Rollback

There is nothing to undo in the process itself. Mitigations you applied might need undoing: list every temporary change (flag flipped, limit raised, node cordoned, alert muted) in the incident doc, and remove each with an owner and date. For application rollbacks, follow the relevant runbook, and for a change that made things worse, revert it before trying anything new.

## Troubleshooting

| Symptom                                        | Fix                                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Everyone is debugging, nobody is coordinating  | Name an IC now. If it is you, say so in the channel and start the timeline.                           |
| Too many people in the channel offering advice | IC asks for observers to mute; keep the Ops lead's group small and direct.                            |
| The cause is unknown and the clock is running  | Stop investigating the cause. Ask what changed, roll it back, or disable the path.                    |
| Leadership wants updates every few minutes     | Comms owns this. Give leaders the channel link and cadence, and keep the responders out of that loop. |
| Responders are exhausted                       | Hand over. Rest is part of the process, not a delay to it.                                            |
| The monitoring itself is down                  | Use the out-of-band checks (cloud console, synthetic checks) and note the gap for the review.         |

After closing, write the review as a [[blameless-postmortems|blameless postmortem]]. Focus on the system and on what made the failure possible or hard to see, not on the person who clicked.
