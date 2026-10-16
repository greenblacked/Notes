---
title: First 90 days as an EM of an infra team
description: "A practical plan for a new engineering manager of a DevOps or infra team: listening tour, mapping risks, early wins, trust and what not to change yet."
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

The first 90 days decide whether the team sees you as someone who helps or someone who arrives with opinions. As an EM of an infrastructure team you inherit pagers, hidden risks and long-standing arrangements. The plan below sequences learning, small visible improvements and trust-building before large changes. It works whether you were promoted from inside the team or hired from outside, though the starting point differs (see the last section).

## Days 1 to 30: listen and map

### Listening tour

Meet everyone in 1:1 in the first two weeks, and then the people who depend on the team.

- **Each engineer** (45 minutes): what is working well, what hurts, what you would change first, what they are proud of, what they are afraid will break. Ask about on-call, how decisions are made and what they need from you. Use the structure in [[one-on-ones]].
- **Your manager**: priorities, what success looks like at 90 days, how you will be judged, budget, headcount.
- **Stakeholders**: application teams, security, support, product and finance. Ask "what do you need from platform that you do not get?" and "when did we last let you down?"
- **Peer managers**: shared dependencies, hand-offs and known conflicts ([[managing-conflict]]).
- Take notes in one document, grouped by theme. Look for what many people say independently.

Say clearly that you are listening first. Promise only what you can deliver: "I will share what I learned in four weeks."

### Map systems and risks

Build a picture from data as well as conversations. A simple worksheet:

| Area                | What to collect                                                                 | Where                                          |
| ------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------- |
| On-call load        | Pages per week, out-of-hours pages, non-actionable share, who carries the most  | Paging tool ([[on-call-health]])               |
| Toil                | Repetitive manual work in hours per week, by task                               | Team survey, ticket history                    |
| Incidents           | Last 6 to 12 months: count, severity, repeat causes, closed follow-ups          | Postmortems ([[blameless-postmortems]])        |
| Tech debt           | Unsupported versions, single-person systems, fragile pipelines, missing backups | Architecture review ([[tech-debt-management]]) |
| Delivery            | Deploy frequency, lead time, change failure rate, time to restore               | [[dora-metrics]]                               |
| Ownership           | Which systems have owners, runbooks, SLOs                                       | [[delegation-and-ownership]]                   |
| Access and security | Who has admin, stale credentials, audit gaps                                    | IAM, RBAC, Artifactory permissions             |
| People              | Skills, single points of failure, career aspirations, flight risks              | 1:1s                                           |

Ask for a read-only view of production access and dashboards. Understand the architecture by reading the repositories and running one deploy to dev with an engineer.

Identify the top five risks and rank by likelihood and impact. Example: "Only one person can upgrade GKE", "no restore test of the Terraform state bucket", "on-call: two people take 70% of out-of-hours pages".

### Handling production responsibility

- Join the on-call rotation as an observer, not as primary, for at least one cycle. You learn what the team experiences.
- Read the incident response process ([[incident-response]]) and attend, don't lead, the first incidents.
- Do not make production changes in your first month.

## Days 31 to 60: early wins and shared priorities

Share what you heard. A short written summary: themes, risks, what you plan to do first, what you will not do yet. Invite corrections. Then pick 2 or 3 small wins that

- address a pain many people named,
- are finishable in weeks,
- are visible to the team and stakeholders.

Typical examples:

- delete or fix the five noisiest alerts and measure the drop in pages;
- write or repair the runbook for the most frequent incident;
- remove one manual deploy step by fixing a CI template ([[gitlab-ci-pipeline-structure]]);
- unblock a long-waiting access request process;
- start a weekly 30-minute planning review so priorities are visible ([[planning-and-prioritization]]);
- ensure each system has a named owner and backup.

Give credit to the engineers who do the work. Report outcomes to stakeholders ([[stakeholder-communication]]).

Agree team goals with your manager and the team, 3 to 5 outcomes for the next two quarters, each with a measure. Pick measures that reflect health, not volume: pages per on-call week, change failure rate, time to restore, percentage of services with runbooks.

## Days 61 to 90: build trust and direction

- Hold a team retrospective on how the team works; run it and act on at least one item.
- Start the regular rhythms: weekly 1:1s, a short team meeting, a monthly review of incidents and toil, quarterly career conversations ([[career-ladder-devops]]).
- Give first feedback ([[performance-feedback]]); positive first, specific and brief.
- Begin delegating: hand over one recurring responsibility you took on by default.
- Decide a hiring or backfill plan if capacity is a problem ([[hiring-devops-engineers]]), using the evidence you gathered.
- Present a 6-month plan: the top risks, the proposed investments, what you need and what the team will stop doing.

## Building trust

- Be consistent: do what you say, on time, and tell people when you cannot.
- Protect the team from interruptions and unplanned work; say no on their behalf with reasons.
- Admit what you do not know. Former engineers are tempted to prove technical credibility; ask questions instead.
- Be present during incidents without taking over. Ask "what do you need from me?"
- Treat mistakes as system failures first. This is the clearest signal of the culture you want.
- Do not criticise predecessors, and do not use "at my old company".

## What not to change too early

Resist these in the first 90 days unless they are causing active harm:

- **Tooling replacements** (CI system, GitOps tool, monitoring stack). Understand why choices were made; see [[gitlab-ci-vs-jenkins]] and [[argocd-vs-flux]] for how to compare options when the time comes.
- **On-call structure**, except for urgent fatigue issues. Fix noise first, then redesign the rota.
- **Team structure and titles.** People need stability while they learn to trust you.
- **Process overhauls.** Add one process at a time and drop one for every new one.
- **Architecture bets.** Gather evidence and write a decision record ([[0001-gitops-with-argocd]] shows the format).
- **Performance conclusions.** What looks like underperformance may be unclear expectations or a broken system.

Things you should change quickly are safety issues: secrets in public repos, a single admin with no backup, unpatched critical vulnerabilities, backups that were never restored. Escalate and fix those, explaining why.

> [!tip] Keep a decision log
> Write down what you changed, why and what you expected. At day 90 you can check whether the evidence supports it.

## Variants

- **Promoted from within**: be explicit about the change in your role, discuss boundaries with former peers, and hand over your hands-on responsibilities with a date. Expect awkwardness; name it.
- **Hired from outside**: you have less context; spend more time on the listening tour and ask a team member to be your guide.
- **Taking over a team in crisis**: stabilise first. Reduce pages, protect people, then follow the plan above at a faster pace.

## Checkpoint at day 90

Answer in writing, share with your manager and the team:

1. What are the top three risks, and what is being done about each?
2. What did we improve, and how do we know?
3. Does each person know what is expected of them, and what they can grow into?
4. Who is the second person for each critical system?
5. What will I stop doing, and what will the team stop doing?
