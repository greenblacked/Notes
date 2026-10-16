---
title: Tech debt management
description: How to identify, record, score and pay down infrastructure tech debt, with a debt register format, capacity budgeting and a way to make the case to leadership.
type: guide
tags:
  - management
  - leadership
  - team-process
  - reliability
created: 2026-10-16
modified: 2026-10-16
draft: false
---

Infrastructure debt is different from application debt. It tends to be invisible until a vendor deadline, a security advisory or an outage makes it urgent, and then the cost is paid all at once. The aim is to make it visible, put a price on it, and pay a steady instalment instead of a lump sum.

## What counts as infrastructure debt

Not every irritation is debt. Debt is a known gap between the current state and the state you need, which carries ongoing cost or risk. Typical items in a DevOps estate:

- **Version drift.** A Kubernetes minor version approaching end of support, old node images, Terraform provider and module versions several majors behind, outdated Helm chart dependencies.
- **Snowflake automation.** Jenkins jobs configured by hand in the UI, Chef cookbooks nobody dares touch, scripts on a single machine.
- **Missing safety nets.** No state backups, no tested restore, no staging parity.
- **Undocumented knowledge.** Systems where only one person knows the recovery path.
- **Unowned things.** Dashboards, alerts, projects and service accounts with no owner.
- **Wrong-shaped structure.** Giant Terraform states, monolithic pipelines. See [[terraform-module-and-state-layout]] and [[gitlab-ci-pipeline-structure]].

Sources for finding it: upgrade and EOL calendars, dependency scanners, `terraform` plan output with warnings, deprecation notices from your cloud provider, postmortem actions, onboarding pain (what confuses new engineers, see [[onboarding-engineers]]), and a simple team retro question: "what slows you down every week?"

## The debt register

Keep one list, in the same tracker as your planned work, so debt competes openly with features. A GitLab issue label `debt` or a dedicated Jira issue type works. Each entry has a fixed set of fields.

```markdown title="debt-register-entry.md"
**ID:** DEBT-014
**Title:** Production GKE clusters on a Kubernetes minor version nearing end of support
**Category:** version drift | snowflake | safety net | knowledge | ownership | structure
**Owner:** <person or team>
**Description:** What is wrong, in two or three sentences.
**Impact if ignored:** Concrete consequence (security exposure, forced upgrade under pressure, outage, slow delivery).
**Deadline / trigger:** External date or event, or "none".
**Interest:** Ongoing cost per month (hours lost, incidents, workarounds).
**Effort to fix:** S / M / L, or engineer-weeks.
**Dependencies:** Other debt or teams.
**Score:** see below
**Status:** identified | planned | in progress | done | accepted (will not fix)
**Linked:** runbook, ADR, tickets
```

Record the **interest**, not just the principal. A job that costs two hours a week to babysit has a known interest rate and that is what makes the argument.

## Scoring

Use a transparent score that your team can recompute. A simple one:

| Factor                              | 1               | 2                                      | 3                                                |
| ----------------------------------- | --------------- | -------------------------------------- | ------------------------------------------------ |
| Risk if it fails or is ignored      | Minor annoyance | Degraded service or compliance finding | Outage, data loss or security exposure           |
| Likelihood within 12 months         | Unlikely        | Possible                               | Likely or certain (for example a fixed EOL date) |
| Ongoing interest                    | Negligible      | Noticeable weekly cost                 | Blocks other work                                |
| Spread (teams or services affected) | One             | Several                                | Most                                             |

Priority = risk x likelihood + interest + spread. Divide by effort to get a "value for effort" ordering, as with RICE in [[planning-and-prioritization]]. Treat anything with a hard deadline separately: schedule backwards from the date, leaving margin for staging, rollout and surprises.

Review the scores quarterly. A debt item that is never scored higher than the cut line for a year is a candidate for an explicit decision to accept it. Writing "accepted, because..." is a legitimate outcome.

### Worked examples

| Item                                 | Risk | Likelihood | Interest | Spread | Effort | Comment                                                                                      |
| ------------------------------------ | ---- | ---------- | -------- | ------ | ------ | -------------------------------------------------------------------------------------------- |
| GKE minor version near EOL           | 3    | 3          | 2        | 3      | M      | Hard date. Plan with [[gke-cluster-upgrade]]                                                 |
| Terraform provider two majors behind | 2    | 2          | 1        | 2      | M      | Do in small steps, read the upgrade guide, plan before apply                                 |
| Helm chart dependencies unpinned     | 2    | 2          | 2        | 2      | S      | See [[helm-chart-conventions]]                                                               |
| Hand-made Jenkins jobs               | 2    | 2          | 3        | 2      | L      | Migrate with [[jenkins-shared-libraries]] or move to GitLab CI, see [[gitlab-ci-vs-jenkins]] |

The scores are illustrative.

## Paying it down

1. **Budget a fixed share of capacity.** The toil and debt bucket in the quarterly plan, typically a sizeable minority of team time. Treat it as non-negotiable, as you would security patching. Starting ranges are in [[planning-and-prioritization]].
2. **Small and continuous beats big and rare.** Upgrading a provider one minor at a time is a pull request. Skipping three majors is a project.
3. **Attach debt to roadmap work.** If you are touching a module anyway, leave it better (the boy-scout rule), and budget for it in the estimate.
4. **Automate the detection.** Renovate or Dependabot for versions, a scheduled pipeline that reports outdated providers and charts, a calendar of EOL dates owned by a named person.
5. **Make the right thing the default.** Update the golden path, see [[platform-team-operating-model]], so that new services do not recreate old debt.
6. **Timebox spikes.** If a debt item is unclear, spend two days finding out how big it is and re-estimate.
7. **Finish by decommissioning.** Old systems stay on the bill until they are switched off. Include the removal in the definition of done.
8. **Do not borrow silently.** When you take a shortcut under deadline, write the register entry at the time, with an owner and a date.

> [!warning] Upgrades are changes
> Version upgrades of clusters and providers are production changes. Run them through [[production-change-checklist]], test in staging, and have a rollback.

## Making the case to leadership

Leaders fund risk reduction and speed, not tidiness. Translate debt into their terms.

- **Use deadlines and consequences.** "Our clusters lose vendor support on this date. After that we get no security patches, and the forced upgrade will cost more."
- **Show the interest.** "The manual Jenkins deployments cost roughly N engineer-hours a month and caused M incidents this year." Use your own figures from the tracker and postmortems.
- **Link to delivery metrics.** If lead time or recovery time is worse because of a specific debt item, say so, see [[dora-metrics]].
- **Offer options.** Do now at cost X, do later at cost Y with risk Z, or accept the risk with sign-off.
- **Ask for a standing allocation** rather than a one-off project. Present the register and the plan.
- **Report progress.** Include debt burn-down in the weekly status, see [[stakeholder-communication]].

```text title="Email: debt budget request (short version)"
Subject: Proposal: protect 15% of platform capacity for debt reduction

We have 23 open items on our debt register. Two have hard external dates (Kubernetes support end in December, a certificate authority change in Q1). Together these will take about 8 engineer-weeks if we start now, and noticeably more if we leave them.

Proposal: hold 15% of the team's capacity each quarter for the register, ordered by score, with a quarterly review of what was done. Cost: roughly one roadmap item per quarter deferred.

Decision needed from you: agree to the allocation or tell us which roadmap item should give way. Details and the register are linked.
```

Replace the figures with your own. If you cannot supply numbers, the first task is to start tracking them.

## Common mistakes

- A register no one reads. Review it at every planning session.
- Scoring by annoyance rather than risk.
- Treating all debt as bad. Some is a conscious, recorded choice.
- Rewrites instead of incremental change.
- Doing debt work with no testing or rollback because "it is only maintenance".
