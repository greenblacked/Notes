---
title: Writing a team charter
description: A one-page operating contract for a team, with mission, ownership, decision rights, working agreements, intake and on-call commitments, a full template and a platform team example.
type: guide
tags:
  - management
  - team-process
  - leadership
  - delivery
created: 2026-10-17
modified: 2026-10-17
draft: false
---

A team charter is a short document that says what the team is for, what it owns, who decides what, how it works and what others can expect from it. It is the first thing I write when I inherit a team or form a new one, because most team friction is a disagreement about one of those five things that nobody wrote down. This note covers the team level. How one engineer works is covered elsewhere, for example [[delegation-and-ownership]] and [[one-on-ones]].

It fits next to [[platform-team-operating-model]] (how a platform team behaves as a product team), [[on-call-health]] (what the team promises about paging) and [[stakeholder-communication]] (how the team talks to people outside it).

> [!note] Not verified
> The vocabulary and definitions here come from memory and general practice. Check them against primary sources before you quote them to others: the Team Topologies terms (team types and interaction modes, from the book by Skelton and Pais), the DACI and RACI role definitions as defined by their authors or by Atlassian's Team Playbook, and any URL for those. No external page was opened while writing this note, so none is linked.

## Why a charter

- **A new engineer can read it in five minutes** and know what the team does and where to ask.
- **Neighbouring teams stop guessing.** "Is that yours?" has a written answer, including the boundaries that are still unclear.
- **Decisions stop bouncing.** When it says who decides on an API change, an argument becomes a lookup.
- **Overload becomes visible.** A team that owns forty things and has six people can see the mismatch in the "owns" list, and you can use the list to say no or to ask for headcount.
- **Reorgs and handovers are easier.** The charter is the starting point of [[team-reorg-runbook]] and the handover checklist when a service moves.

A charter is not a strategy, a roadmap or a job description. Keep it to one or two pages. If it needs ten, the team has too many mandates, and that is itself the finding.

Write it with the team, not for it. A charter handed down from above will be ignored. A draft by the manager, edited in a team session and approved by the manager's manager and the main customer teams, will be used.

## Mission

One or two sentences: who the team serves, and what changes for them because the team exists. State an outcome, not an activity.

- Weak: "The DevOps team manages Kubernetes, Terraform and CI."
- Better: "Stream-aligned teams ship and run their services safely without needing to know how the cluster, the pipeline or the edge works."

Add a short list of **customers** (teams, functions, external parties) and **what good looks like** in two or three measures the team will look at every quarter, for example time from merge to production, change failure rate or the share of services on the supported path. See [[dora-metrics]] for the delivery measures, and be careful not to turn them into targets that get gamed.

## Owns and does not own

This is the most useful section and the hardest to write. Two lists.

**Owns** means the team is accountable: it answers pages, fixes bugs, upgrades the dependency, keeps the documentation and is the one who says yes or no to changes. List the owned things by name: services, clusters, modules, pipelines, domains, runbooks.

**Does not own** is just as important. It lists things people often assume the team owns, and says who does. Examples: "application deployment manifests (owned by service teams, we provide the chart)", "the corporate identity provider (owned by IT)", "security policy decisions (owned by security, we implement and enforce)".

Add a third short list, **Shared or unclear**, for things where ownership is under discussion. Give each an owner of the decision and a date. An honest "unclear, to be settled by 2026-12-01" is better than a false clear line.

Rules I use:

1. Every service in the production inventory has exactly one owning team. If two teams think they own it, neither does.
2. A thing the team owns is also something it can operate: it has an on-call rotation, a runbook and monitoring. If not, either fix that or say "owned, not yet operable" in the shared list.
3. Link to the source of truth (service catalogue, CODEOWNERS file) rather than copying a long list that will go stale.

## Decision rights

For each type of decision, say who does what. Two common models:

- **DACI**: Driver (runs the decision and drives it to a conclusion), Approver (the one person who decides), Contributors (give input), Informed (told afterwards).
- **RACI**: Responsible (does the work), Accountable (answers for the result, one person), Consulted (two-way input), Informed (one-way).

Either works. Pick one for the team and use it consistently. DACI suits decisions, RACI suits work. The key rules, whichever you choose, are one approver or accountable person per row, and a small number of consulted people.

Example table for a platform team (adapt the roles, and use job roles, not names):

| Decision type                             | Driver / Responsible | Approver / Accountable | Contributors / Consulted          | Informed                    |
| ----------------------------------------- | -------------------- | ---------------------- | --------------------------------- | --------------------------- |
| Change to a public module or pipeline API | Module maintainer    | Tech lead              | Two consumer teams, security      | All consumers (changelog)   |
| Major version upgrade of a shared module  | Module maintainer    | Tech lead              | Consumer teams, SRE               | All consumers, with notice  |
| Kubernetes minor version upgrade          | Platform engineer    | Engineering manager    | Service team leads, security      | Everyone, ahead of the date |
| On-call rotation shape and schedule       | Engineering manager  | Engineering manager    | The team, HR where required       | Stakeholders, support       |
| Hiring: role definition and bar           | Engineering manager  | Director               | Team, recruiter, cross-team peers | Neighbouring team leads     |
| Hiring: individual offer                  | Engineering manager  | Director               | Interview panel                   | The team                    |
| Exception to a security baseline          | Requesting team      | Security lead          | Platform tech lead                | Compliance owner            |
| Break-glass access to production          | Engineer on call     | Incident commander     | Security                          | Audit log, reviewed after   |

Notes:

- **Delegate the decision, not the accountability.** The approver can name someone else for a class of decisions; write that down, with limits (for example "any module change that does not alter inputs or outputs").
- **Time-box approvals.** An approver who does not respond within the agreed time (three working days is a common choice) lets the driver proceed, unless the decision is irreversible. State this in the charter.
- **Reversible versus irreversible.** Make reversible decisions fast with few people, and reserve slow consensus for the one-way doors. A decision about a rollback-able config is not an architecture review. See [[production-change-checklist]] for the checks that sit around the change itself.
- **Disagree and commit.** Say how disputes escalate: first to the manager of the decision approver, with a one-page summary of the options.

## Working agreements

Working agreements are the small, checkable behaviours that make the team predictable. Keep them few (six to ten) and phrase them so anyone can see whether they were met.

Examples (set your own numbers, and revisit them when they stop fitting):

- **First review within 1 business day.** A pull request gets a first human response within one business day. The author does not have to chase. The team sees the age of open requests on a board.
- **Pull requests stay small.** Aim for a change a reviewer can read in 15 to 20 minutes; as a guide, a few hundred changed lines at most, excluding generated files. Split larger work, or agree an exception in advance. See [[code-review]].
- **Two kinds of review.** A code owner approves changes in their area. A second person reads for risk on changes to production configuration.
- **Merge requests carry a reason.** The description says why, how it was tested and how to roll it back.
- **Pipelines stay green.** A red default branch is the team's top priority, ahead of new work.
- **No work only in one head.** Anything done twice becomes a runbook or a script.
- **Written first.** Decisions with long-term consequences get a short written record (an ADR or a note in the repository), see [[adr/index]].
- **Meetings.** One weekly planning and one retrospective every two weeks, with a written agenda. Decline meetings without one.
- **Core hours.** The overlap window in which everyone is reachable (for example four hours), so people in different time zones can plan.
- **Interrupt budget.** One person per week takes the interrupt rotation (questions, requests and reviews from outside), so the others have focus time. This is the shield role from [[platform-team-operating-model]].

If a working agreement is broken often, either the number is wrong or the team lacks capacity. Treat it as information in the retrospective, not as a failure of individuals.

## Interfaces and intake

Other teams need to know how to reach you and what to expect.

- **Front door.** One channel for questions and one form or issue template for work. Link both. Avoid direct messages to individuals as an intake route.
- **Intake categories.** Question, bug, request, feature idea, and the response each gets. For example: questions in the channel within one business day, bugs triaged twice a week, requests either planned, declined with reasons or redirected.
- **How requests are prioritised.** One paragraph in plain words: customer impact, risk reduction, and alignment with the quarterly plan. Link to [[planning-and-prioritization]].
- **Dependencies on other teams.** The charter lists the teams this team depends on and what it needs from them, and the teams that depend on it. For dependencies that cause delays, track them in the way the department agrees; do not hide them in chat.
- **Interaction modes.** If you use Team Topologies vocabulary, state per neighbour whether you collaborate for a time, provide a service, or facilitate. Say when a collaboration ends. (Vocabulary not verified, see the note at the top.)
- **Communication.** Where status goes (a weekly note), where incidents go (the incident channel), and where announcements of changes go. See [[stakeholder-communication]].

## Operational commitments

What the team promises about operating what it owns. Keep it honest: only promise what the team can meet.

- **On-call.** Which services are covered, the hours (24x7 or business hours), the rotation size, who is the escalation point, and the response targets (for example acknowledge a page within 15 minutes). A rotation of fewer than five or six people for 24x7 coverage is a burnout risk, see [[on-call-health]].
- **Severity and escalation.** Link to [[incident-response]] and the paging policy.
- **Service levels.** The SLOs for owned services and the support commitment, for example "first response to a request within one working day". Link to the SLO definitions, see [[slo-burn-rate-alerting]] and [[error-budget-policy]].
- **Production readiness.** What a service must have before the team takes it on, see [[production-readiness-review]].
- **Maintenance windows and freezes.** When changes happen, and what the team does around freezes, see [[change-freezes-and-maintenance-windows]].
- **Post-incident practice.** Blameless reviews within a set time, with actions tracked, see [[blameless-postmortems]].
- **Toil.** The share of time the team aims to keep for engineering work against operational work, and how it is measured (see [[toil-budget]]).
- **Security and compliance duties.** Patching timelines the team commits to, see [[vulnerability-management-slas]].

## Review and change history

A charter that is never reviewed becomes fiction. Treat it as code.

- **Keep `charter.md` in the team's own repository**, at the root or in `docs/`, next to the code and runbooks the team owns. A copy on a wiki page drifts; link to the repository file instead.
- **Change it by pull request.** The diff is the change history, the review is the consultation, and the approval from the named approver is the decision. Anyone on the team can propose a change.
- **Review twice a year and after a trigger.** Triggers: a reorg, a new mandate, headcount change of more than a quarter of the team, a serious incident that exposed unclear ownership, or a repeated argument about who decides.
- **Keep a short change log at the bottom.** One line per change with the date, the pull request link and the reason.
- **Make it findable.** Link from the team's channel topic, the service catalogue and the onboarding checklist, see [[onboarding-engineers]].

## The template

Copy this into `charter.md` in the team repository. Delete the guidance in square brackets as you fill each section. Names of roles, not people.

```markdown title="charter.md"
# Team charter: [Team name]

Status: [draft | approved on YYYY-MM-DD by <role>]
Next review: [YYYY-MM-DD]
Contact: [channel and intake link]

## Mission

[One or two sentences: who we serve and what changes for them.]

Customers: [teams, functions]
What good looks like (reviewed quarterly):

- [Measure 1 and how it is measured]
- [Measure 2]

## Owns

| Thing  | Kind                         | Source of truth                |
| ------ | ---------------------------- | ------------------------------ |
| [name] | [service / module / cluster] | [catalogue or repository link] |

## Does not own

| Thing   | Owned by | What we provide |
| ------- | -------- | --------------- |
| [thing] | [team]   | [what we do]    |

## Shared or unclear

| Thing   | Question | Decider | Settle by  |
| ------- | -------- | ------- | ---------- |
| [thing] | [..]     | [role]  | YYYY-MM-DD |

## Decision rights

Model: [DACI | RACI]
Time limit for approval: [N working days; silence means go ahead unless irreversible]
Escalation: [role, with a one-page summary]

| Decision type | Driver / R | Approver / A | Contributors / C | Informed / I |
| ------------- | ---------- | ------------ | ---------------- | ------------ |
| [..]          | [..]       | [..]         | [..]             | [..]         |

## Working agreements

- [First review of a pull request within N business days]
- [Pull request size guide]
- [Pipeline and default branch rules]
- [Meetings and core hours]
- [Interrupt rotation]

## Interfaces and intake

- Questions: [channel]
- Work requests: [form or issue template]
- Triage cadence: [twice a week]
- How we prioritise: [one paragraph]
- We depend on: [teams and what we need]
- Depend on us: [teams and what they can expect]

## Operational commitments

- On-call: [services, hours, rotation size, escalation, response targets]
- Service levels: [SLO links, support response time]
- Readiness bar for new services: [link]
- Post-incident reviews: [timeline and tracking]
- Toil and capacity: [target share of engineering time]

## Review and change history

Reviewed [twice a year] and after a reorg, new mandate or incident showing unclear ownership.
Changed by pull request, approved by [role].

| Date       | Change  | Link | Reason |
| ---------- | ------- | ---- | ------ |
| YYYY-MM-DD | Created | [PR] | [..]   |
```

## Worked example: a GKE platform team that owns the Cloudflare edge

This is an illustrative charter for a fictional team, "Platform Runtime", at a fictional company. The numbers are examples of what a team could choose; they are not recommendations.

```markdown title="charter.md"
# Team charter: Platform Runtime

Status: approved on 2026-10-17 by the Director of Engineering
Next review: 2027-04-17
Contact: #platform-runtime and the issue template "Platform request"

## Mission

Product teams deploy and run their services on Kubernetes and behind our edge
without needing to know how the cluster, the pipeline or the CDN works.

Customers: the eight product teams, the security team, the support team.
What good looks like (reviewed quarterly):

- A new service reaches production through the template in under one day.
- 90% of services run on the supported pipeline and chart versions.
- Edge and cluster SLOs met in the quarter (see the SLO document).

## Owns

| Thing                                                                       | Kind           | Source of truth                          |
| --------------------------------------------------------------------------- | -------------- | ---------------------------------------- |
| GKE clusters (prod, stage) and node pools                                   | Infrastructure | Terraform repository "platform-infra"    |
| Cloudflare zone example.com (DNS, WAF, cache, rate limits, Access, Workers) | Edge           | Terraform repository "edge-config"       |
| GitLab CI templates and shared runners                                      | Tooling        | Repository "ci-templates"                |
| Helm chart library and Artifactory proxies                                  | Tooling        | Repositories "charts", Artifactory admin |
| Observability stack (Prometheus, alerting)                                  | Service        | Repository "observability"               |

## Does not own

| Thing                                    | Owned by           | What we provide                            |
| ---------------------------------------- | ------------------ | ------------------------------------------ |
| Application manifests and service config | Product teams      | Chart library, examples, review on request |
| WAF policy decisions and risk acceptance | Security           | We implement rules and report on them      |
| Corporate identity provider              | IT                 | We integrate with it                       |
| Cloud billing and budgets                | Finance and FinOps | Cost labels and a monthly report           |
| Databases (Cloud SQL, instances)         | Data platform team | Network access and secrets plumbing        |

## Shared or unclear

| Thing                          | Question                                     | Decider                 | Settle by  |
| ------------------------------ | -------------------------------------------- | ----------------------- | ---------- |
| Cloudflare Workers per product | Who owns Worker code the product teams write | Director of Engineering | 2026-12-01 |

## Decision rights

Model: DACI
Time limit for approval: 3 working days; silence means go ahead, except for
irreversible changes (data deletion, key destruction, DNS zone transfers)
Escalation: the Director of Engineering, with a one-page summary

| Decision type                            | Driver              | Approver            | Contributors                 | Informed                  |
| ---------------------------------------- | ------------------- | ------------------- | ---------------------------- | ------------------------- |
| Breaking change to a Terraform module    | Module maintainer   | Tech lead           | Two consumer teams, security | All consumers             |
| Module version upgrade for all consumers | Module maintainer   | Tech lead           | Consumer teams               | All consumers             |
| Cloudflare WAF or rate limit rule change | Platform engineer   | Security lead       | Tech lead, service owner     | Support, incident channel |
| GKE minor version upgrade                | Platform engineer   | Engineering manager | Team leads, security         | Everyone, 2 weeks ahead   |
| On-call rotation shape                   | Engineering manager | Engineering manager | The team                     | Stakeholders              |
| Hiring: role and bar                     | Engineering manager | Director            | Team, recruiter              | Neighbouring leads        |

## Working agreements

- First human review of a merge request within 1 business day.
- Merge requests stay readable in 20 minutes: about 400 changed lines at most,
  excluding generated files, unless agreed in the description.
- Changes to the edge go through the same pipeline and plan review as
  infrastructure; no changes in the Cloudflare dashboard.
- A red default branch is fixed before new work starts.
- One engineer per week is on the interrupt rotation.
- Core hours 10:00 to 14:00 UTC; weekly planning on Monday, retrospective every
  second Thursday.

## Interfaces and intake

- Questions: #platform-runtime, answered within 1 business day.
- Work requests: issue template "Platform request", triaged on Tuesday and Friday.
- How we prioritise: security and reliability risk first, then adoption blockers
  for product teams, then new capabilities from the quarterly plan.
- We depend on: Security (policy), IT (identity), Finance (budgets).
- Depend on us: all product teams; support (edge status page and incident updates).

## Operational commitments

- On-call: 24x7 for the clusters, the edge and the CI platform. Rotation of
  six people, one week at a time, escalation to the engineering manager.
  Acknowledge a page within 15 minutes.
- Service levels: cluster and edge SLOs are in the SLO document; first response
  to a request within 1 business day.
- Readiness bar for new services: production readiness review before go-live.
- Post-incident reviews within 5 working days; actions tracked in the board.
- Toil: aim to spend at most 40% of the team's time on operational work.

## Review and change history

Reviewed twice a year and after a reorg, new mandate or incident showing
unclear ownership. Changed by pull request, approved by the Director.

| Date       | Change  | Link | Reason                     |
| ---------- | ------- | ---- | -------------------------- |
| 2026-10-17 | Created | PR 1 | Team formed from two teams |
```

What the example shows:

- **The edge is listed as owned, with the policy decisions listed as not owned.** The team builds and runs the Cloudflare configuration through Terraform and its pipeline, and security decides what the rules should be. That split avoids both "the platform team blocked my traffic" and "security changed production without telling us".
- **A shared or unclear row with a date.** Worker code written by product teams is the common source of arguments, so it is named instead of left to surface in an incident.
- **Every decision row has one approver.** Where two roles seem to be needed (security and platform for a WAF rule), one approves and the other contributes.
- **The numbers are the team's own.** The 15-minute acknowledgement time, the 400 lines and the 40% toil share are examples. Choose numbers you can measure and meet.

Related: how the edge rules are managed is in [[edge-waf-rate-limiting]] and [[cloudflare-cache-strategy]], service levels are in [[slo-burn-rate-alerting]] and [[error-budget-policy]], and the dependencies that cross team boundaries are managed in [[cross-team-dependencies]].

## Introducing the charter

1. **Draft it yourself first** from what you know, marking guesses clearly. A blank page makes a poor workshop.
2. **Workshop it with the team** for 60 minutes. Ask each person to mark anything that is wrong, missing or unclear. Spend the time on "owns" and "decision rights".
3. **Check it with the neighbours.** Send the "does not own" and "interfaces" sections to the teams named in them. They will correct you.
4. **Get the approver to sign it** (by approving the pull request).
5. **Use it.** Point people to it when a boundary question arises. Link it in onboarding and update it in the retrospective when it no longer matches reality.

Common failure modes:

| Failure                      | Sign                                            | Fix                                                      |
| ---------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| A wish list, not a contract  | Promises nobody measures                        | Remove what you cannot meet; add measures                |
| Too long                     | Nobody has read it in months                    | Cut to two pages; move detail to linked documents        |
| Written by the manager alone | The team shrugs when asked about it             | Redo it as a workshop                                    |
| Frozen                       | The last change is a year old and wrong         | Calendar the review; trigger it after reorgs             |
| "Owns" without capacity      | Many owned items, no on-call, constant overload | Show the list to leadership and negotiate scope or staff |
| Decision rights ignored      | Decisions made in chat by the loudest voice     | Point to the table; fix the table if it is wrong         |

## See also

- [[platform-team-operating-model]]
- [[delegation-and-ownership]]
- [[on-call-health]]
- [[stakeholder-communication]]
- [[planning-and-prioritization]]
- [[first-90-days-as-em]]
