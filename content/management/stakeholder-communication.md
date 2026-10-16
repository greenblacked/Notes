---
title: Stakeholder communication
description: Communicating up and across as a DevOps lead, with templates for status updates, incident comms, RFC summaries, migration expectations and risk registers.
type: guide
tags:
  - management
  - leadership
  - team-process
  - incident-management
created: 2026-10-16
modified: 2026-10-16
draft: false
---

Most stakeholder trouble is surprise, not bad news. Leaders can plan around a slipped migration if they hear early and clearly. They cannot plan around a status update that says "on track" until the week of the deadline. This note collects the formats I use, with templates you can paste into Slack or email.

## Principles

1. **Lead with the point.** Status, decision needed, or impact, in the first line.
2. **Say what you need.** Every message ends with an ask (a decision, a review, or "no action needed").
3. **Separate facts, assessment and plan.** What happened, what you think it means, what you will do.
4. **Be specific about dates and confidence.** "Done by 14 November, fairly confident" beats "soon".
5. **Write for a reader who skips.** Short paragraphs, plain words, no jargon the reader has not used themselves.
6. **Send bad news early, in person where possible,** then follow with the written version.

## Weekly status update

One short, regular update to your manager and interested stakeholders. Keep the structure fixed so people learn where to look. Use a traffic-light status only if you define what each colour means: green is on plan, amber is at risk and you have a mitigation, red is off plan and you need help.

```text title="Slack: weekly status (short version)"
Platform team, week of 12 Oct
Status: AMBER (GKE upgrade slipped 1 week, see below)
Shipped: pipeline template v3 rolled out to 9 of 14 services; runner autoscaling in staging
Next: upgrade staging clusters; start Terraform provider bump
Risks: <cluster version> reaches end of support on <date>, upgrade needs 3 more weeks of capacity
Need: decision by Friday on whether we defer the Jenkins decommission to Q1
Metrics: pages 11 (last week 17), out-of-hours 2; lead time stable
```

Text in `<angle brackets>` is a placeholder.

```text title="Email: weekly status (full version)"
Subject: Platform team status, week of 12 October (amber)

Summary
The GKE upgrade slipped by one week because of a deprecated API in two services. Everything else is on plan. I need a decision on the Jenkins decommission date (below).

Progress against the quarter's objectives
1. New services reach production without help: pipeline template v3 on 9 of 14 services (target 14 by end of November).
2. Cluster upgrades are routine: staging done; production starts next week.
3. On-call is sustainable: 11 pages last week, 2 out of hours.

Risks and issues
- Kubernetes version support ends in December. The upgrade needs about three more weeks of capacity. Mitigation: moving the Terraform provider update to next quarter.
- Two services still use a removed API. Their teams are fixing it this sprint.

Decision needed
Defer the Jenkins decommission from November to February to protect the upgrade work? I recommend yes. Reply by Friday.

Planned for next week
Staging upgrades, start production upgrade, provider update planning.
```

Link the update to the board for the full list, and measure actual versus planned work using the buckets from [[planning-and-prioritization]].

## Incident communication to executives

Executives need three things: what is the impact, what are you doing, when is the next update. Not the stack trace. Run the technical response from [[incident-response]] and nominate one person who owns communications so engineers can keep working.

```text title="Slack: incident update to execs (copy-paste)"
INCIDENT UPDATE 14:30 UTC (update 2)
Impact: checkout API errors for about 20% of customers since 13:55
Cause: not yet confirmed; started after the 13:50 config change
Action: change rolled back at 14:20; monitoring error rate
Next update: 15:00, or sooner if status changes
Owner: Priya (incident lead). Comms: Tom
```

Rules:

- Use a fixed cadence and keep it even when there is nothing new ("no change, next update 15:30").
- State impact in customer terms, not component names.
- Do not speculate on cause. Say "not yet confirmed".
- Do not assign blame in the channel. The review comes later, see [[blameless-postmortems]].
- Close with a resolved message, plus a link to the review and its date.

```text title="Email: post-incident summary to leadership"
Subject: Incident summary: checkout errors on 14 October

What happened: Between 13:55 and 14:20 UTC about a fifth of checkout requests failed.
Customer impact: Estimated N failed orders, no data loss.
Cause: A configuration change reduced a connection pool limit below demand. [One sentence, no names.]
How we fixed it: Rolled back the change at 14:20; error rate normal by 14:30.
What we are changing: Add the limit to pre-deploy checks; add an alert on pool saturation; review the change process (owner, date).
Full review: blameless review on 17 October, document linked here.
```

## One-page proposal or RFC summary

Long design documents rarely reach decision-makers. Attach a one-page summary. The decision itself, once taken, belongs in an ADR, see [[adr/index|ADRs]].

```markdown title="rfc-summary.md"
## Proposal: <title>

**Author / date / status:** <name>, <date>, draft or in review

**Problem.** Two or three sentences. Who is affected and how, with evidence.

**Proposal.** What we would do, in plain language. One diagram if it helps.

**Alternatives considered.** Option A, option B, do nothing. One line each on why not.

**Cost and effort.** Engineer-weeks, money, and what it displaces from the plan.

**Risks and mitigations.** Top three.

**Rollout and rollback.** How we do it safely, and how we undo it.

**Decision needed.** Approve, reject or amend by <date>. Decision owner: <name>.
```

A good test: could a director decide from this page alone? If not, the page is hiding the real trade-off.

## Managing expectations on migrations

Migrations (Jenkins to GitLab CI, a cluster move, a Helm restructure) run late for predictable reasons: the long tail of snowflake jobs, owners who are busy, and hidden dependencies.

- **Inventory first.** Count what exists before promising a date. For Jenkins jobs, export the list and classify: trivial, needs work, unknown.
- **Give ranges and milestones.** "Pilot in October, 80% by January, the last 20% depends on team availability."
- **State what you need from others.** Each team must test and approve their own cut-over.
- **Show progress as a burn-down** of items left, not a percentage of effort spent.
- **Define done,** including decommissioning the old system. A migration is not finished while both exist.
- **Keep a rollback** for each step. For tool decisions see [[gitlab-ci-vs-jenkins]].
- **Re-forecast openly** each time the inventory changes.

## Risk register

A short list kept current is better than a long list kept in a drawer. Review it monthly with your manager.

| ID  | Risk                                                     | Likelihood | Impact | Owner     | Mitigation                              | Trigger / date         | Status     |
| --- | -------------------------------------------------------- | ---------- | ------ | --------- | --------------------------------------- | ---------------------- | ---------- |
| R1  | Kubernetes version reaches end of support before upgrade | High       | High   | EM        | Reserve capacity, upgrade staging first | Support end date       | Open       |
| R2  | Single engineer knows the Chef cookbooks                 | Medium     | High   | Lead      | Pair, document, rotate                  | Quarterly review       | Mitigating |
| R3  | Jenkins plugin without maintainer                        | Medium     | Medium | Tech lead | Replace in migration                    | Next security advisory | Open       |

Score as high, medium, low, with a one-line definition for each so that the scale is shared. Close risks explicitly. Tie items to the debt register in [[tech-debt-management]] when the cause is old technology.

## Writing for different audiences

- **Your manager:** status, risks, decisions, your own concerns about capacity or people.
- **Peers (product, security, other platform teams):** dependencies, dates they need to know about, how to reach you. See [[platform-team-operating-model]].
- **Executives:** outcomes, cost, risk, and one clear ask.
- **Engineers on your team:** the reasoning behind decisions, not just the outcome.
