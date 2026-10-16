---
title: Delegation and service ownership for a new EM
description: Levels of delegation, service ownership, avoiding the prod-access bottleneck and a RACI for platform work, for EMs coming from a hands-on DevOps role.
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

The hardest habit to break for a former hands-on DevOps engineer is doing the thing yourself because it is faster. It is faster, once. The team then learns that hard problems go to you, you become the single point of failure, and your own work (planning, people, stakeholders) slips. Delegation is how an EM scales.

## Why it is hard

- You are probably still the best person on the team at some tasks. That is fine; your job changed.
- You carry production knowledge in your head, and the cost of writing it down feels higher than doing the task.
- You may be the person with the broadest access (cluster admin, project owner, Artifactory admin) and therefore the default approver.
- Your identity is tied to being technically good. Stepping back can feel like losing it.

Signs you are the bottleneck: pull requests wait for your approval, people ask you in DMs how things work, you are the only person who has run the last three upgrades, and your calendar has no time for 1:1s.

## Levels of delegation

Use explicit levels so both sides know how much autonomy applies. A six-level scale works well in practice. It is a simplified form of seven-level models such as Management 3.0 Delegation Poker:

| Level                   | You say                            | Typical use                           |
| ----------------------- | ---------------------------------- | ------------------------------------- |
| 1. Do as I say          | "Run this exact change."           | New joiners, high-risk work           |
| 2. Research and report  | "Look into options, tell me."      | Early exploration                     |
| 3. Recommend            | "Propose a plan; I decide."        | Design choices with cross-team effect |
| 4. Decide with approval | "Decide, but check with me first." | Medium-risk changes                   |
| 5. Decide and inform    | "Decide; tell me afterwards."      | Established owners                    |
| 6. Decide and act       | "It's yours; no need to report."   | Trusted owners in a defined area      |

Agree the level for each task, in writing, and move it up over time. The level depends on the task and the person together. Someone can be at level 5 for pipeline changes and level 3 for Terraform state operations.

Delegate outcomes, not steps: "Reduce the median build time of the platform pipelines below ten minutes by end of quarter" rather than "enable caching in the pipelines". Set context, constraints (budget, no downtime), the deadline and the support available. Then check in at agreed points, not constantly.

When the result is different from what you would have done, ask whether it is wrong or only different. Give feedback ([[performance-feedback]]) on actual problems, and let go of style.

## Service ownership

Delegation needs somewhere to land. Define owners for every system.

- Each service, cluster add-on, pipeline template and Terraform module has **one named owner** and one backup. Teams, not individuals, are acceptable for large components, but a person still holds the pager and the roadmap.
- The owner is responsible for: the runbook, alerts and SLOs, dashboards, upgrades, incident follow-ups, documentation and the on-call handoff notes.
- Store ownership where tooling can see it. A `CODEOWNERS` file makes the owner the default reviewer:

```text title="CODEOWNERS"
# GitLab CODEOWNERS: owner for each area gets review requests automatically
[Platform pipelines]
/ci-templates/ @platform/ci-owners

[Cluster add-ons]
/clusters/addons/ingress/ @alice @bob
/clusters/addons/cert-manager/ @carol

[Terraform networking]
/terraform/modules/network/ @dave
```

GitLab looks for the file at the repository root, in `docs/` or in `.gitlab/`, and uses the first one it finds. The `[Section]` headers are GitLab CODEOWNERS sections. Check the GitLab Code Owners documentation for your version, including how sections interact with approval rules.

- Keep a one-page ownership table (service, owner, backup, runbook, SLO, on-call rotation) in the repo, and review it quarterly and whenever someone leaves or joins.
- Define "done" for ownership: for a system to be handed over, it has a runbook someone has actually run ([[incident-response]]), alerts that page for real symptoms ([[slo-burn-rate-alerting]]), and a documented rollback.

Owners also say no. A service owner may refuse changes that violate the service's constraints, with reasons, and escalate disagreements to you.

## Don't be the prod-access bottleneck

If you are the only person who can approve production changes or grant access, the team's speed equals your availability.

1. **Move approval into the process.** Use protected branches with merge request approvals from code owners and a checklist ([[production-change-checklist]]). Your approval is for exceptions and risky classes of change, not the default.
2. **Give access through groups with least privilege.** Use IAM and Kubernetes RBAC bound to groups, defined in Terraform. Time-limited elevation (just-in-time access) for the rare admin tasks, with an audit trail.
3. **Remove your own standing admin rights where you can.** Keep a break-glass path and test it. A manager who cannot accidentally change production is a safer manager.
4. **Write down decisions you keep making.** If you answer "can we deploy on Friday?" five times, write the rule once.
5. **Decide what requires you.** For example: changes to shared IAM, data deletion, cost over a threshold and security exceptions. Everything else has an owner.
6. **Have a deputy.** Someone else can approve when you are away. Test it with a planned absence.

> [!warning] Keep an auditable break-glass route
> Removing yourself from the approval path must not mean removing the audit trail. Emergency access should be logged and reviewed after use.

## RACI for platform work

RACI clarifies who does what: **R**esponsible (does the work), **A**ccountable (one person who answers for the outcome), **C**onsulted (two-way input), **I**nformed (one-way). Every row has exactly one A.

| Activity                                         | Service owner | Platform engineer | EM  | Security | Application team |
| ------------------------------------------------ | ------------- | ----------------- | --- | -------- | ---------------- |
| Routine cluster add-on upgrade                   | A/R           | R                 | I   | I        | I                |
| GKE minor upgrade ([[gke-cluster-upgrade]])      | R             | R                 | A   | C        | I                |
| New Terraform module                             | A/R           | R                 | I   | C        | C                |
| Production change via approved MR                | A             | R                 | I   |          | C                |
| Access grant to prod                             | R             |                   | A   | C        | I                |
| Incident command                                 | R (IC rota)   | R                 | A   | C        | C                |
| Postmortem actions                               | A             | R                 | I   | I        | C                |
| On-call rota design                              | C             | C                 | A/R |          | I                |
| Secret rotation ([[leaked-credential-rotation]]) | A             | R                 | I   | C        | I                |

During an incident the incident commander directs the response; the EM is accountable for there being a staffed, trained IC rota. See [[incident-response]].

Use it for recurring ambiguities, not as a form for everything. Two or three painful rows resolved are worth more than a complete matrix nobody reads. Review it when the team or the platform changes ([[platform-team-operating-model]]).

## Practical routine

- Weekly: list the things you did that someone else could do. Pick one to hand over this week.
- For each handover, pair once, then watch once, then step back. Keep the runbook updated as part of it.
- Track the "bus factor" per system. If one name appears everywhere, plan a rotation of ownership.
- Use [[one-on-ones]] to calibrate delegation levels and to hear when someone feels over- or under-trusted.
- Accept short-term dips in quality. They are the price of growing the team's capacity.

See also [[first-90-days-as-em]] for the order in which to hand things over and [[career-ladder-devops]] for how delegated ownership shows up as evidence for promotion.
