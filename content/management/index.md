---
title: Engineering management
description: Running a platform or DevOps team, covering people, hiring, planning, delivery and on-call health.
tags:
  - management
  - leadership
created: 2026-10-16
modified: 2026-10-21
draft: false
---

These notes cover the engineering manager's side of a platform or DevOps team. That means people, hiring, planning, delivery and keeping on-call sustainable. They are written as guides you can follow on a Monday morning, not as theory, and each one links out to the technical notes it relies on.

## Starting out

- [[first-90-days-as-em|First 90 days as an EM of an infra team]]: a practical plan for a new engineering manager of a DevOps or infra team: listening tour, mapping risks, early wins, trust and what not to change yet.
- [[delegation-and-ownership|Delegation and service ownership for a new EM]]: levels of delegation, service ownership, avoiding the prod-access bottleneck and a RACI for platform work, for EMs coming from a hands-on DevOps role.
- [[platform-team-operating-model|Platform team operating model]]: how to run a DevOps platform team as a product team, with Team Topologies interaction modes, golden paths, intake, a shield rotation and adoption metrics.
- [[team-charter|Writing a team charter]]: a one-page operating contract for a team, with mission, ownership, decision rights, working agreements, intake and on-call commitments, a full template and a platform team example.
- [[technology-radar-for-platform-tooling|A technology radar for platform tooling]]: keep platform tool choices visible and governed with a radar stored as code, rings tied to support obligations, a validator in CI and soft enforcement of hold.

## People

- [[one-on-ones|Running one-on-ones with platform engineers]]: cadence, agenda template, questions that surface burnout and career goals, note-taking and skip-levels for 1:1s on a DevOps or platform team.
- [[onboarding-engineers|Onboarding a DevOps or platform engineer]]: access checklist, 30/60/90 plan with concrete milestones, buddy system and measures for onboarding a new DevOps or platform engineer.
- [[hiring-devops-engineers|Hiring DevOps and SRE engineers]]: a structured hiring loop for DevOps and SRE roles, with a troubleshooting exercise, question bank, scoring rubric and debrief process.
- [[career-ladder-devops|Career ladder for DevOps and platform engineers]]: expectations by level from Engineer to Staff, plus the EM track split, with evidence examples and guidance on using the ladder in promotions.
- [[performance-feedback|Performance feedback and reviews]]: giving feedback with the SBI model, writing reviews, handling underperformance with an improvement plan, documenting and recognising good work.
- [[managing-conflict|Managing conflict]]: handling disagreement in technical teams, from tooling wars and design disputes to Dev versus Ops friction, using disagree-and-commit, escalation, ADRs and mediation.
- [[bus-factor-and-knowledge-transfer|Bus factor and knowledge transfer for platform systems]]: find single points of knowledge in infrastructure from commit and on-call data, then make them survivable with runbooks, pairing and rotations.
- [[offboarding-platform-engineers|Offboarding a platform engineer safely]]: hand over ownership, inventory and remove a leaving platform engineer's access across GCP, GKE, GitLab, Jenkins and Artifactory, and prove it is gone.
- [[platform-team-across-time-zones|Running a platform team across time zones]]: overlap maths that handles daylight saving, async decisions, written handoffs of in-flight changes, fair meeting slots and on-call for distributed teams.
- [[security-champions-programme|Running a security champions programme with product teams]]: scale security triage through one trained champion per product team, with agreed time, a responsibilities menu, platform support, a charter and honest metrics.
- [[contractors-and-managed-service-providers|Working with contractors and managed service providers on platform work]]: scope, access, review, knowledge transfer and exit for contractors and MSPs, with time-bound GCP and GitLab access and an expiry report.

## Planning and delivery

- [[planning-and-prioritization|Planning and prioritization]]: quarterly planning for a DevOps team, with a capacity split, example OKRs, RICE and cost of delay, saying no, tracking in GitLab or Jira, and re-planning after incidents.
- [[dora-metrics|DORA metrics for a platform team]]: definitions of the DORA software delivery metrics, how to measure them from GitLab CI, Jenkins and incident data, and how to avoid gaming them.
- [[tech-debt-management|Tech debt management]]: how to identify, record, score and pay down infrastructure tech debt, with a debt register format, capacity budgeting and a way to make the case to leadership.
- [[stakeholder-communication|Stakeholder communication]]: communicating up and across as a DevOps lead, with copy-paste templates for status updates, incident comms, RFC summaries, migration expectations and risk registers.
- [[ai/rolling-out-ai-tools-in-a-team|Rolling out AI coding tools in a DevOps team]]: piloting AI coding and review assistants with a baseline, outcome metrics, security review and a go or no-go decision.
- [[cross-team-dependencies|Managing cross-team dependencies]]: identify, record, track and escalate dependencies between teams, with a register, request template, escalation path and a worked Helm chart example.
- [[inner-source-platform|Inner-source contribution model for platform code]]: how product teams change platform-owned Helm charts, Terraform modules and pipeline templates through merge requests while the platform team keeps ownership and review standards.
- [[engineering-budget-planning|Engineering budget planning and forecasting]]: how an engineering manager builds an annual budget, forecasts monthly, explains variance and tracks vendor renewals, with templates and a worked hire example.
- [[quarterly-engineering-review|Quarterly engineering review and roadmap]]: a one-page quarterly review for engineering managers covering commitments, DORA and incidents, capacity split, risks, a Now/Next/Later roadmap and blameless reporting.
- [[build-vs-buy-devops-tools|Build vs buy for DevOps tooling]]: a decision framework for DevOps tooling with three-year total cost of ownership, lock-in and exit cost, and a worked CI and artifact repository example.
- [[devops-vendor-and-licence-management|Vendor and licence management for DevOps tools]]: own, meter and renew Artifactory, SonarQube, GitLab and Jenkins support licences, with usage metering, true-up risk and a tested exit plan.
- [[end-of-life-tracking-platform-versions|Tracking end-of-life dates for platform software]]: one owned end-of-life calendar for GKE, Kubernetes, Terraform, Jenkins, Chef and other platform tools, with automated checks and an upgrade budget.
- [[platform-product-discovery|Platform product discovery before building]]: how a platform team validates a developer problem with interviews, assumptions and a paper golden path before committing engineering time.
- [[platform-roadmap-multi-quarter|Writing a multi-quarter platform roadmap]]: outcome-based platform roadmap themes for 12 to 18 months, with capacity bands, dependencies, confidence by horizon and a published change log.
- [[jenkins-to-gitlab-migration-programme|Running a Jenkins to GitLab CI migration as a programme]]: sequence, staff, communicate and close out a Jenkins to GitLab CI migration across many teams, with waves, parallel runs and a retirement gate.
- [[decommissioning-platform-services|Decommissioning and retiring platform tooling]]: decide when a legacy tool or platform service is retired, then run consumer discovery, deprecation, read-only freeze, archive and cost removal.
- [[rfc-and-design-review-process|RFC and design review process for platform changes]]: when a platform change needs an RFC, its lifecycle to a decision, one named decider, a template with rollback and cost, docs-as-code review and timeboxes.
- [[developer-experience-surveys|Developer experience surveys for platform teams]]: run a repeatable developer experience survey for a platform, with question design, a question bank, anonymity rules, an analysis script and follow-up.
- [[fleet-wide-change-campaigns|Running fleet-wide change campaigns across many repositories]]: plan, automate, track and enforce a change that must land in every team's repositories, from inventory and bot merge requests to deadlines and exceptions.
- [[flow-metrics-and-forecasting|Flow metrics and forecasting for platform work]]: use WIP, cycle time, throughput and work item age from GitLab issues, and a Monte Carlo forecast, to answer "when will it be done" with honest ranges.

## Operations

- [[on-call-health|On-call health]]: designing a sustainable on-call rotation, with alert hygiene, load metrics, a handover template, escalation paths and burnout signals for a DevOps team.
- [[incident-response|Incident response]] and [[blameless-postmortems|blameless postmortems]]: how the team runs an incident and learns from it.

> [!note] Adapt the numbers
> Percentages, scores and templates in these guides are starting points. Replace them with your own team's data, and check anything about pay, working time or performance processes against your company policy and local law.

- [[team-reorg-runbook|Splitting, merging and reorganising teams]]: a checklist-driven runbook for the change event of a team reorg, covering readiness, ownership and on-call re-cut, access moves, communication, a week -2 to week 4 timeline and rollback triggers.
- [[incident-review-programme|Running an incident review programme across many teams]]: schedule, facilitate, track and measure postmortem reviews across teams so action items get done and the process does not become theatre.
- [[on-call-compensation-and-recovery|On-call compensation, incident fatigue and recovery time]]: design an auditable on-call compensation policy and fatigue rules for long incidents: shift limits, relief handover and recovery time afterwards.
- [[weekly-operations-review|Weekly operations review for a platform team]]: a one-hour weekly review of error budgets, pages, incidents, toil, capacity, CI health, cost and upcoming changes, with queries and a template.
- [[critical-vulnerability-response-programme|Coordinating a fleet-wide response to a critical vulnerability]]: run a widely exploited CVE as an incident, with an inventory of running images, triage, mitigation, base-image-first rebuilds and proof by rescan.
