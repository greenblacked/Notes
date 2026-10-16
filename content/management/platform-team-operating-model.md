---
title: Platform team operating model
description: How to run a DevOps platform team as a product team, with Team Topologies interaction modes, golden paths, intake, a shield rotation and adoption metrics.
type: guide
tags:
  - management
  - team-process
  - leadership
  - delivery
created: 2026-10-16
modified: 2026-10-16
draft: false
---

A platform team that works as a ticket queue for infrastructure requests will always be behind, and its users will route around it. A platform team that works as a product team has customers, a roadmap, a quality bar and a way to learn whether anyone uses what it ships. This note describes the operating model I would set up for a team that owns CI/CD, Kubernetes, Terraform modules and shared tooling.

## Team types and interaction modes

The vocabulary comes from the book Team Topologies (Skelton and Pais). Four team types, three interaction modes.

| Team type             | Purpose                                                                           | Example in our estate                                                 |
| --------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Stream-aligned        | Delivers a flow of work for one product or service area                           | A payments team that owns its services end to end                     |
| Platform              | Provides internal services that reduce the cognitive load of stream-aligned teams | The DevOps team: GitLab CI templates, GKE clusters, Terraform modules |
| Enabling              | Helps other teams adopt a capability, then steps away                             | A temporary SRE or security pair that coaches teams on SLOs           |
| Complicated-subsystem | Owns a part that needs specialist knowledge                                       | A data-plane or ML-serving component                                  |

The interaction modes matter more day to day, because each has a different cost.

- **Collaboration.** Two teams work closely on something new for a bounded period. High cost for both sides, so use it for discovery, for example building the first version of a golden path with one pilot team.
- **X-as-a-Service.** One team consumes what the other provides with minimal coordination. This is the steady state for a mature platform: documented, versioned, supported.
- **Facilitating.** One team helps another learn or adopt something. This is what the platform team does when it runs office hours or pairs on a migration.

Be explicit about which mode you are in with each team and when it changes. Most friction I have seen comes from a platform team that thinks it is providing a service while the consumer thinks they are in a collaboration, or the reverse.

## Platform as a product

Treat the platform like a product with named customers.

- **Customers.** Stream-aligned teams, plus the security and compliance functions that depend on the controls you ship.
- **A product owner.** Someone, usually the EM or a senior engineer, owns prioritisation and says no. See [[planning-and-prioritization]].
- **A roadmap in problems, not tools.** "Reduce time to first production deploy for a new service" beats "adopt Backstage".
- **Discovery.** Interview a few developers every quarter. Watch someone create a new service from scratch without helping them.
- **Documentation and support as part of the product.** An undocumented feature does not exist for the consumer.

## Golden paths

A golden path is the supported, opinionated way to do a common task, with the paved road well maintained and the exits open. Examples: a service template that gives you a repository, a pipeline, a Helm chart, a namespace and dashboards; a Terraform module for a Cloud SQL instance.

Rules I apply:

1. **Optional but attractive.** If teams must use it, it is a mandate and you need the support to match. If they choose it because it is faster, you have a product.
2. **Cover the 80% case.** Document how to leave the path and what support you then provide (usually less).
3. **Versioned and upgradeable.** Teams must be able to pull in improvements. Pipeline templates should be included by version, as in [[gitlab-ci-pipeline-structure]], and charts follow [[helm-chart-conventions]].
4. **Owned.** Each path has a named owner and a changelog.
5. **Measured.** You can say how many services use it and how they fare. See the adoption section below.

## Internal service levels

Teams plan around what you promise. Write it down so that promises are deliberate.

| Service               | Objective (example, set your own)                                | Measured by            |
| --------------------- | ---------------------------------------------------------------- | ---------------------- |
| Shared CI runners     | Job queue wait time stays under a stated threshold for most jobs | Runner metrics         |
| Cluster availability  | A stated monthly availability for the control plane and ingress  | Uptime checks and SLIs |
| Support requests      | First response within one working day                            | Intake tool            |
| New service bootstrap | Available self-service, no ticket                                | Template usage         |

Treat these as internal SLOs, not contracts with penalties. Alert on burn rate as described in [[slo-burn-rate-alerting]]. When you miss a target, run a review in the style of [[blameless-postmortems]] and feed the result into the roadmap.

## Intake and request process

One front door, with a visible queue.

1. **Channel for questions, form for work.** A support channel for quick questions, an issue template for anything that takes more than an hour.
2. **Triage twice a week.** The shield engineer (below) labels each request: question, bug, request, feature idea. Requests that need design go to the planning backlog.
3. **Categorise by outcome.** Self-service answer, small fix, planned work, declined with reasons.
4. **Publish the queue.** A board that anyone can read removes most "any update?" messages.
5. **Close the loop.** Reply in the same thread when work ships.

```markdown title=".gitlab/issue_templates/platform-request.md"
## What are you trying to achieve?

## Who is affected, and by when does it matter?

## What have you tried or looked at already?

## Impact if we do nothing

/label ~"platform::triage"
```

## The shield (interrupt) rotation

Interrupts destroy planned work unless one person absorbs them. Assign one engineer per week, or per sprint, as the shield.

- The shield owns the support channel, triage, and small fixes. Everyone else is not interrupted except for incidents.
- Make the role real: no roadmap commitments for that person that week, and a handover note at the end.
- Rotate across the whole team, including seniors, so that knowledge spreads and the load is fair.
- Track what the shield spends time on. Repeated questions become documentation, repeated requests become self-service. This feeds the toil-reduction share in [[planning-and-prioritization]].
- The shield is not the on-call engineer. Keep the two rotations separate unless the team is very small. See [[on-call-health]].

## Measuring adoption and developer experience

Output metrics (features shipped) tell you little. Measure whether the platform is used and whether it helps.

- **Adoption.** Percentage of services on the current pipeline template version, on the golden-path chart, using the shared Terraform modules. Count both reach and currency.
- **Time to first deploy.** From repository creation to a running service in production for a new service.
- **Support load.** Requests per week, by category, and the share answered by documentation.
- **Delivery performance.** The metrics in [[dora-metrics]], per team, used to find problems rather than to rank teams.
- **Satisfaction.** A short quarterly survey: would you recommend the platform, what slows you down most. Keep the questions the same so that you can see trends.
- **Voluntary use.** If adoption stalls, ask why before pushing. Usually a gap in the path, not stubbornness.

> [!tip] Start with a baseline
> Run the survey and measure time to first deploy before you change anything. Without a baseline the first quarter's improvements are anecdotes.

## Failure modes

- **Ticket-queue platform.** All work arrives as requests, none is planned. Fix: shield rotation, self-service, a roadmap with explicit capacity.
- **Ivory tower.** The team builds what it finds interesting. Fix: pilot customers and regular interviews.
- **Mandate without support.** A required tool without migration help creates resentment. Fix: budget migration help, or make adoption optional until it is ready. See [[stakeholder-communication]] for managing expectations.
- **Hero dependency.** One person knows how the cluster is built. Fix: runbooks such as [[runbooks/index|the runbooks]], pairing, and rotating the shield.
