---
title: Career ladder for DevOps and platform engineers
description: Expectations by level from Engineer to Staff, plus the EM track split, with evidence examples and guidance on using the ladder in promotions.
type: guide
tags:
  - management
  - career
  - leadership
  - team-process
created: 2026-10-16
modified: 2026-10-16
draft: false
---

A career ladder tells engineers what is expected at their level and what the next one looks like. It also protects the manager from deciding promotions on gut feel. This ladder is a starting point for a small platform team; adapt names and scope to your company's own levels. It describes behaviour that a person demonstrates consistently over time, not tasks they have been given.

## Principles

- **Levels describe scope and impact, not tool knowledge.** A senior engineer is not someone who knows more Kubernetes flags; they operate on a bigger scope with less supervision.
- **Promotion recognises sustained performance at the next level**, usually six months or more. It is not a reward for time served or for performing the current role well.
- **Four dimensions**: technical scope, operational ownership, influence and leadership, communication. A person must meet the level in all four, with strength in at least one.
- **Two tracks above senior**: Staff (individual contributor) and Engineering Manager. Moving between them is a lateral move, not a promotion, and should be reversible.

## The levels

### Engineer

The engineer works on well-defined tasks within a service or area, with guidance.

| Dimension             | Expectations                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Technical scope       | Delivers tasks inside existing patterns: pipeline changes, Helm values, a Terraform module change. Learns the team's stack and conventions. |
| Operational ownership | Participates in on-call with support. Follows runbooks, escalates promptly, writes up what they did.                                        |
| Influence             | Asks good questions, accepts review, shares what they learn.                                                                                |
| Communication         | Clear updates, writes useful merge request descriptions, asks for help early.                                                               |

### Senior engineer

The engineer owns a system or area and delivers ambiguous work without supervision.

| Dimension             | Expectations                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Technical scope       | Designs and delivers medium-sized changes (a cluster add-on, a CI template, a module rewrite) with a considered design and a rollout plan. Understands failure modes.                            |
| Operational ownership | Is a named owner of one or more services with a runbook, alerts and an SLO. Leads incidents of moderate severity and writes the postmortem ([[blameless-postmortems]]). Reduces toil measurably. |
| Influence             | Mentors others and reviews work to a high standard. Sets patterns the team follows.                                                                                                              |
| Communication         | Writes design documents. Explains trade-offs to non-specialists and communicates status during incidents.                                                                                        |

### Staff engineer

The engineer solves problems that span teams or quarters and sets technical direction.

| Dimension             | Expectations                                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Technical scope       | Defines strategy for a domain (for example the deployment platform or the cluster fleet), including what not to build. Resolves problems that no team owns.          |
| Operational ownership | Shapes the operating model: on-call design, SLO policy, incident process ([[platform-team-operating-model]]). Prevents classes of incidents rather than single ones. |
| Influence             | Aligns multiple teams without authority. Grows senior engineers. Their decisions outlive their involvement.                                                          |
| Communication         | Writes the documents the organisation uses for decisions. Presents to leadership and to peers across departments.                                                    |

### Engineering manager

The manager owns the team's outcomes through other people.

| Dimension             | Expectations                                                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Technical scope       | Understands architecture well enough to challenge, not to design. Keeps technical debt and platform risks visible ([[tech-debt-management]]).                           |
| Operational ownership | Ensures on-call is sustainable ([[on-call-health]]), incident follow-ups close and ownership is clear.                                                                  |
| Influence             | Hires, coaches, resolves conflict ([[managing-conflict]]) and creates conditions where people grow. Represents the team's priorities ([[planning-and-prioritization]]). |
| Communication         | Sets direction, shares context, gives clear feedback, and reports to stakeholders ([[stakeholder-communication]]).                                                      |

An EM is not a promotion from senior engineer; it is a different job with different skills. Staff and EM are peers in seniority.

## Examples of evidence

Evidence is concrete, observable and dated. Collect it over the whole period, not in the week before the review.

| Level                    | Typical evidence                                                                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engineer to senior       | Designed and shipped the migration of a pipeline from Jenkins to GitLab CI ([[gitlab-ci-vs-jenkins]]) with zero failed releases. Became owner of the artifact promotion flow. Reduced mean time to restore for the service from 40 to 15 minutes. Mentored two new joiners. |
| Senior to staff          | Led the multi-quarter GKE fleet upgrade across five teams, with a published runbook ([[gke-cluster-upgrade]]). Removed a recurring class of incidents through a platform default. Wrote the RFC that three teams adopted.                                                   |
| Engineer meeting the bar | Merged changes with few review rounds. Handled shadowed on-call incidents correctly and improved a runbook.                                                                                                                                                                 |
| EM readiness             | Ran a retrospective that changed team practice. Delegated successfully. Handled a difficult conversation well. Understands budget and planning basics.                                                                                                                      |

Not evidence: hours worked, number of commits, being busy during incidents, tool certifications on their own.

## Using the ladder in promotions

1. **Set expectations early.** In 1:1s ([[one-on-ones]]), map current work to the next level and agree stretch tasks.
2. **Gather evidence monthly.** A shared document the engineer and manager both update: what was done, what it changed, who can confirm it.
3. **Write the promotion case**: one page with level, the four dimensions, three to five examples with outcomes, and quotes from peers or stakeholders. Describe the gap that remains, honestly.
4. **Calibrate** with other managers. Compare cases against the same bar, particularly for people who work quietly or on glue work like documentation and on-call improvements, which is easy to undervalue.
5. **Decide twice a year**, not ad hoc, so that decisions are comparable.
6. **Feedback after a "not yet"** must be specific: which dimension, what evidence would change the answer, and a date to revisit. See [[performance-feedback]].

> [!warning] Beware of promotion by hero work
> Rewarding only people who rescue outages encourages fragile systems. Weight prevention, documentation and operability work equally with fire-fighting.

## Common pitfalls

- Inflating titles to retain someone; it makes the next promotion harder and the ladder meaningless.
- Promoting to fill a gap, such as making the strongest operator a senior without scope.
- Judging only technical output and forgetting communication, which gets harder at every level.
- Letting the ladder become a checklist. It guides conversations; judgement still applies.

Review the ladder annually with the team and change it in the open.
