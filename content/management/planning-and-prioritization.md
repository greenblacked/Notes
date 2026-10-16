---
title: Planning and prioritization
description: "Quarterly DevOps planning: capacity split, example OKRs, RICE and cost of delay, saying no, tracking in GitLab or Jira, and re-planning after incidents."
type: guide
tags:
  - management
  - team-process
  - delivery
  - leadership
created: 2026-10-16
modified: 2026-10-16
draft: false
---

A DevOps or platform team has more demand than capacity and a steady stream of unplanned work. Planning is mostly about deciding, explicitly, what will not get done. This note is a quarterly planning routine that I have found workable, with templates you can copy.

## Start with capacity

Work out how much time you really have before listing work.

1. Count engineers and subtract planned leave, public holidays, onboarding time and training.
2. Subtract on-call and shield load (see [[on-call-health]] and [[platform-team-operating-model]]).
3. Apply a focus factor. Meetings, reviews and context switching mean that an engineer-week is never five productive days. Pick a number from your own history, not from a book.

Then split what remains into four buckets. The ratios below are a starting point to adjust from your own data, not a standard.

| Bucket                       | What goes in it                                                            | Starting share  |
| ---------------------------- | -------------------------------------------------------------------------- | --------------- |
| Roadmap                      | New capabilities that serve the product goals                              | About 40 to 50% |
| KTLO                         | Keep the lights on: upgrades, patching, certificate renewals, cost reviews | About 20 to 25% |
| Interrupts                   | Support requests, small fixes, incident follow-up                          | About 15 to 20% |
| Toil reduction and tech debt | Automation, cleanup, see [[tech-debt-management]]                          | About 10 to 15% |

Look at last quarter's issue tracker to see what the real split was. If interrupts took 35% last quarter, planning for 15% is fiction. Either plan for the real number or fund the work that reduces it.

> [!note] Why a separate toil bucket
> Without a protected share, toil reduction loses every prioritisation fight against a feature with a deadline. Protecting a fixed share is simpler than arguing for each item.

## Gather and shape inputs

Collect candidate work from:

- stakeholder requests and product roadmaps;
- the debt register and EOL dates (for example a Kubernetes minor version leaving support);
- postmortem action items, see [[blameless-postmortems]];
- DORA and survey results, see [[dora-metrics]];
- security and compliance deadlines.

Write each candidate as a problem statement with an outcome and a rough size (small, medium, large, or in engineer-weeks). Do not estimate in more detail than you can defend.

## OKRs that fit a platform team

Objectives describe the outcome qualitatively. Key results are measurable outcomes, not tasks. Keep to two or three objectives per quarter.

```text title="Example OKRs"
Objective: New services reach production without help from the platform team
  KR1: Time from repository creation to first production deploy, median, drops from the Q3 baseline to a stated target
  KR2: 80% of new services created from the service template (baseline: measured at start of quarter)
  KR3: Support requests tagged "how do I deploy" fall by half

Objective: Cluster upgrades are routine, not events
  KR1: All production clusters on a supported Kubernetes minor version by the end of the quarter
  KR2: Upgrade runbook executed in staging within a week of each new minor release
  KR3: Zero unplanned downtime during upgrades

Objective: On-call is sustainable
  KR1: Pages per shift under the agreed threshold in 10 of 12 weeks
  KR2: Out-of-hours pages down by a stated fraction
```

Pitfalls: a KR that restates a task ("migrate 12 pipelines") is a deliverable, not an outcome, so say what improves. Pick KRs where you can measure a baseline today. If the objective needs a metric that does not exist, the first KR is to build it.

## Prioritisation frameworks

Use a framework to structure the argument, not to replace judgement.

**RICE.** Score = (Reach x Impact x Confidence) / Effort.

| Item                               | Reach (teams/quarter) | Impact (0.25 to 3) | Confidence | Effort (eng-weeks) | Score |
| ---------------------------------- | --------------------- | ------------------ | ---------- | ------------------ | ----- |
| Self-service namespace creation    | 12                    | 2                  | 80%        | 4                  | 4.8   |
| Migrate Jenkins job A to GitLab CI | 1                     | 1                  | 100%       | 3                  | 0.33  |
| Runner autoscaling                 | 25                    | 1                  | 50%        | 6                  | 2.1   |

The numbers are illustrative. RICE favours broad impact and punishes uncertain, large work, so check that foundational work is not always at the bottom.

**Cost of delay.** Ask what it costs per week to wait. Divide that by duration to get CD3 (cost of delay divided by duration) and do the highest first. This is the right lens for deadline-driven work: an EOL date, a certificate expiry, a contract. Categories help: fixed deadline, urgent and growing, steady, or intangible (like technical debt).

**Simple rules that work alongside.**

1. Anything with a hard external date goes in first.
2. Reliability and security risks that are likely and severe come before features.
3. Finish before you start. Limit work in progress.
4. Prefer work that unblocks many teams.

## Saying no

You will decline most requests. Do it in a way that preserves trust.

1. Acknowledge the problem behind the request.
2. State the trade-off: what is on the plan, what it would displace, and its priority.
3. Offer an alternative: self-service, a smaller version, a later quarter, or a pointer to docs.
4. Give a date when you will revisit.
5. Write it down in the request ticket.

```text title="Slack reply: declining for now"
Thanks, I see why this matters for checkout. We can't take it this quarter: the team is fully committed to the cluster upgrade (hard EOL date) and the pipeline template rollout. If we pick it up, something has to move out. Options: (a) a smaller version using the existing module, which we can help with in office hours; (b) we put it first in next quarter's planning. Which suits you better? I'll tag it for review on the date of the Q1 planning session.
```

Escalating a disagreement about priority is fine, and it should go to whoever owns the trade-off, not around you. See [[stakeholder-communication]].

## Track it in GitLab or Jira

Keep the tooling simple and visible.

- **GitLab.** Use an epic per objective or per initiative, issues under the epic, a milestone or iteration per quarter, and scoped labels for the bucket: `bucket::roadmap`, `bucket::ktlo`, `bucket::interrupt`, `bucket::toil`. A board by label gives you the capacity split at a glance.
- **Jira.** An epic per initiative, a component or label for the bucket, and a quick filter per bucket. A dashboard gadget for created versus resolved in each bucket shows the real split.
- **Tag every item** as it is created, including interrupts. A one-minute habit that gives you the data for next quarter.
- **Weekly review.** Compare actual work with the plan in your status update, see [[stakeholder-communication]].

## Re-plan when incidents hit

Incidents break plans. Decide the rules in advance.

1. **Absorb small ones.** Use the interrupt bucket. If it is not exhausted, there is nothing to re-plan.
2. **For a major incident**, record the real time spent. After the incident, estimate the follow-up work from the postmortem and compare it with capacity. See [[incident-response]].
3. **Swap, don't stack.** Name what comes out when something comes in. Tell stakeholders which commitments slip and to when.
4. **Mid-quarter checkpoint.** At about six weeks, compare progress with the plan and cut scope while it is still cheap.
5. **Do not re-plan daily.** Weekly adjustments are enough. Daily changes are churn.

## Quarter checklist

- Capacity worked out from real history.
- Buckets and shares agreed with your manager.
- Two or three objectives with baselines.
- Ranked list with a clear cut line, and a published list of what is below it.
- Debt and EOL items present, see [[tech-debt-management]].
- Mid-quarter review booked.
