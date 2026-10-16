---
title: Blameless postmortems
description: When a postmortem is required, how to run it without blame, and a full template with timeline, contributing factors and tracked action items.
type: standard
tags:
  - standards
  - incident-management
  - reliability
created: 2026-10-16
modified: 2026-10-16
draft: false
---

A postmortem is a written record of an incident that explains what happened, why the system allowed it, and what will change. Its purpose is learning and prevention, not accountability for individuals. This standard applies to every team that runs production services. The live response process is in [[incident-response]].

## When a postmortem is required

Write one when any of these is true:

- customer-visible impact above the agreed SLO or error budget threshold;
- data loss or data exposure of any size;
- a security incident, including a leaked credential ([[leaked-credential-rotation]]);
- a page that needed more than one team or took longer than the target time to mitigate;
- a rollback or manual intervention in production that was not planned;
- a near miss that the on-call engineer or manager judges instructive.

Anyone can request a postmortem. Declining needs a reason recorded in the incident ticket.

## Blameless principles

- **People did the reasonable thing given what they knew.** Ask what made the action sensible at the time.
- **Contributing factors, not a root cause.** Complex failures have several necessary conditions. Naming one "root cause" usually ends the analysis early and tends to land on a person.
- **No names as causes.** Use roles ("the on-call engineer") in the narrative. Names appear only in the responder list and as action owners.
- **Fix systems.** Missing guardrails, ambiguous runbooks, unsafe defaults and noisy alerts are system problems. "Be more careful" is never an action item.
- **Be specific and honest.** A postmortem that hides a mistake teaches nothing. Psychological safety is a manager's job; see [[on-call-health]].

> [!warning] Blame shows up in word choice
> Phrases like "failed to", "forgot", "should have" and "carelessly" signal blame. Rewrite as what the system made easy or hard.

## Timeline and ownership

| When                   | What                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| During the incident    | Incident commander keeps a running timeline in the incident channel |
| Within 2 working days  | Owner assigned; draft with timeline and impact written              |
| Within 5 working days  | Review meeting held; contributing factors and actions agreed        |
| Within 10 working days | Final version published and linked from the incident ticket         |

These are targets; state the actual dates in the document. The postmortem owner is not necessarily the person who handled the incident, and should not be the person most affected by the discussion.

## Writing the analysis

1. **Timeline.** Use UTC timestamps. Record detection, escalation, mitigation attempts (including those that failed) and resolution. Separate facts from interpretation.
2. **Impact.** Quantify: duration, percent of requests failing, users or tenants affected, data affected, SLO budget burned.
3. **Contributing factors.** Look at triggers, latent conditions, detection gaps and response gaps. A useful prompt is "what would have had to be true for this not to happen or to be shorter?"
4. **What went well.** Recognise good practice so it is repeated.
5. **Where we got lucky.** Name conditions that limited the impact by chance.

## Action items

Every action item has:

- a clear outcome, testable as done or not done;
- one named owner (a team is not an owner);
- a due date, typically within 30 to 90 days for important items;
- a priority and a ticket in the normal backlog;
- a type: prevent, detect, or mitigate.

Prefer fewer, better actions. Prioritise those that remove a class of failure over those that patch the single instance. Capacity for actions must be planned; see [[tech-debt-management]].

## Review meeting

30 to 60 minutes, facilitated by someone who was not an incident participant. Agenda: read the timeline silently, correct facts, discuss contributing factors, agree actions and owners, decide on distribution. The facilitator stops blame statements and reframes them. Record decisions in the document, not only verbally.

## Template

```markdown title="postmortem-template.md"
# Postmortem: <short description> (<YYYY-MM-DD>)

| Field              | Value                     |
| ------------------ | ------------------------- |
| Status             | Draft / In review / Final |
| Severity           | SEV1 / SEV2 / SEV3        |
| Incident ticket    | <link>                    |
| Postmortem owner   | <role or name>            |
| Incident commander | <role or name>            |
| Responders         | <list>                    |
| Review meeting     | <date>                    |

## Summary

Two or three sentences: what happened, who was affected, how it was resolved.

## Impact

- Duration: <start UTC> to <end UTC> (<minutes>)
- Customer impact: <what users experienced; percentage or count>
- Data impact: <none / description>
- SLO and error budget: <budget burned>

## Timeline (UTC)

| Time  | Event                                |
| ----- | ------------------------------------ |
| 00:00 | <change deployed / trigger occurred> |
| 00:00 | <first alert or report>              |
| 00:00 | <escalation>                         |
| 00:00 | <mitigation attempted and result>    |
| 00:00 | <service restored>                   |

## Detection

How did we find out? How long after the start? Could we have found out sooner?

## Contributing factors

- <Factor 1: describe the condition, not a person>
- <Factor 2>
- <Factor 3>

## Response

What helped, what slowed us down (tools, access, documentation, communication).

## What went well

- <item>

## Where we got lucky

- <item>

## Action items

| Action   | Type                        | Owner  | Priority | Due        | Ticket |
| -------- | --------------------------- | ------ | -------- | ---------- | ------ |
| <action> | prevent / detect / mitigate | <name> | P1       | YYYY-MM-DD | <link> |

## Lessons learned

What should other teams know?

## Appendix

Graphs, logs, links to chat history, related incidents.
```

## Follow-up tracking

- Action items live as tickets in the owning team's backlog, labelled `postmortem-action`.
- A postmortem is closed only when its high-priority actions are done or consciously deferred with a recorded reason.
- Review open actions in the team's regular planning meeting and report overdue ones to the engineering manager (see [[planning-and-prioritization]]).
- Once a quarter, review postmortems together for recurring themes. Repeated factors justify a project, not another action item.
- Publish final postmortems where the wider engineering organisation can read them.
