---
title: Build vs buy for DevOps tooling
description: A decision framework for DevOps tooling with three-year total cost of ownership, lock-in and exit cost, and a worked CI and artifact repository example.
type: guide
tags:
  - management
  - leadership
  - cost
  - ci-cd
  - artifactory
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Every platform team eventually asks whether to build a capability in-house, adopt an open-source tool and run it, or pay for a product. The wrong answer is rarely visible in year one. A custom tool is cheap to start and expensive to own; a commercial product is expensive to buy and cheap to start. The honest comparison is a three-year view that includes the costs people forget: upgrades, patching, on-call, training and the cost of leaving.

## The decision question and scope

State the question narrowly: "What is the best way to provide <capability> to <consumers> for the next three years?" Write down the requirements first (must-have versus nice-to-have), the consumers and the constraints (security, data location, existing contracts). A decision about "an artifact repository" is a different decision from "a registry for container images only", and mixing them hides the real trade-off.

This note is about tooling decisions the team owns. For comparing two established tools technically see [[gitlab-ci-vs-jenkins]], [[argocd-vs-flux]] and [[terraform-vs-opentofu]]; for budget lines see [[engineering-budget-planning]].

## The four options

| Criterion               | Build in-house                    | Open source, self-hosted  | Commercial, self-hosted     | Managed SaaS or cloud service |
| ----------------------- | --------------------------------- | ------------------------- | --------------------------- | ----------------------------- |
| Fit to your exact needs | Highest                           | Medium, configurable      | Medium, configurable        | Lowest, provider decides      |
| Time to first value     | Slowest                           | Medium                    | Medium                      | Fastest                       |
| Operating effort        | You own everything                | You own upgrades, HA      | You own infrastructure      | Provider owns infrastructure  |
| Security patching       | You                               | You, with community fixes | You, with vendor fixes      | Provider, within its schedule |
| Support                 | Your team                         | Community or paid tier    | Vendor contract             | Vendor contract               |
| Lock-in                 | Low externally, high in knowledge | Low                       | Medium to high              | Medium to high                |
| Cost shape              | People time                       | Infrastructure and people | Licence plus infrastructure | Usage or seats                |
| Customisation limits    | None                              | Plugins and code          | Vendor extension points     | Provider features and APIs    |

The table lists criteria only. Prices, licence units and limits change; check the vendor's current terms when you build your own comparison.

## TCO model

Total cost of ownership is the sum of everything it takes to run the capability, over time. Include these lines for every option:

- **Licence or subscription:** the metric the vendor charges on (seats, storage, agents, usage). Check the current terms.
- **Infrastructure:** compute, storage, network, backups, a disaster recovery copy.
- **Engineering to build:** for in-house options, initial development.
- **Upgrades and patching:** engineer-hours per major and minor upgrade, per year.
- **On-call and incident cost:** pages, outages and the toil they create, see [[on-call-health]].
- **Security work:** vulnerability triage, hardening, access reviews.
- **Training and onboarding:** how long a new engineer takes to be productive.
- **Integration upkeep:** pipelines and tools that depend on it.
- **Opportunity cost:** what the same engineers would have built instead.
- **Exit cost:** see the exit checklist below.

```text title="tco-formula.txt"
# All figures are ILLUSTRATIVE placeholders. Fill in your own numbers.
# Y1..Y3 = year 1..3. Loaded_rate = fully loaded cost of one engineer-hour.

Licence_Y        = licence_metric_units * price_per_unit      # check vendor terms
Infra_Y          = compute + storage + network + backup + DR
Build_Y1         = build_hours * Loaded_rate                  # in-house only
Upgrade_Y        = upgrades_per_year * hours_per_upgrade * Loaded_rate
Patch_Y          = patch_hours_per_month * 12 * Loaded_rate
Oncall_Y         = pages_per_year * hours_per_page * Loaded_rate
Training_Y       = new_engineers_per_year * training_hours * Loaded_rate
Integration_Y    = integration_hours_per_year * Loaded_rate
Exit_reserve     = migration_hours * Loaded_rate              # amortised or at year 3

TCO_3yr = SUM over Y1..Y3 of
          (Licence_Y + Infra_Y + Upgrade_Y + Patch_Y + Oncall_Y
           + Training_Y + Integration_Y)
          + Build_Y1 + Exit_reserve

Compare TCO_3yr across the four options, then adjust for the
non-cost criteria in the table (fit, risk, speed).
```

Loaded rates come from finance, see [[engineering-budget-planning]]. Run the model with a low, expected and high case; if the winner changes between cases, the decision is sensitive and you should say so.

## The three-year view

Plot cumulative cost by option over 36 months. Build options start high and flatten if the tool stays stable, but usually creep up as upgrades, security fixes and new requirements arrive. Managed services start low and rise with usage. The crossing points tell you whether a two-year contract is a bargain or a trap. Also set a review date at 18 months; the best option for a team of eight is not necessarily the best for a team of thirty.

## Worked example: artifact proxy and repository

Requirement: a single place to proxy public dependencies, store internal build artifacts and promote them between stages; see [[artifact-promotion-artifactory]]. Consumers: roughly all pipelines. Options:

- **In-house proxy:** a small service in front of upstream registries with a storage bucket. Cheap to start; but you must build caching correctness, authentication, retention (see [[artifact-retention-policy]]), promotion metadata and vulnerability metadata, and you become the owner of an outage that blocks every build.
- **Commercial repository manager (for example Artifactory):** supports many package types, promotion and metadata out of the box. Costs include the licence, a highly available deployment, upgrades and administration. Check the vendor's current licensing and editions.
- **Cloud-managed registry (for example Artifact Registry on GCP):** low operating effort, native IAM integration, fewer package-type and promotion features than a full repository manager. Check the current documentation for supported formats and features.

A fair outcome might be: buy the repository manager if you need many formats, promotion and a single audit point; use the cloud-managed registry if you mostly store container images and a few language packages and your promotion is tag-based. The point is not the winner, it is that the choice is recorded with its reasons and review triggers. Licensing mechanics, metering and renewals are in [[devops-vendor-and-licence-management]].

## Worked example: custom pipeline runner

Requirement: executors for CI jobs with fast start-up and isolation. Options are a custom runner service, GitLab Runner on Kubernetes, or Jenkins agents.

- **Custom runner:** you design scheduling, isolation, secrets handling, log streaming and cleanup. Rarely justified; every one of those is a mature solved problem elsewhere, and a security flaw in a custom executor is yours alone.
- **GitLab Runner:** an open-source executor that integrates with GitLab CI; autoscaling and Kubernetes executors exist. You own the cluster, the node pools and the security model, see [[gitlab-runners-on-gke]]. Check the current runner documentation for executors and scaling options.
- **Jenkins agents:** flexible and plugin-rich, with a controller you must harden and upgrade, see [[jenkins-controller-and-agent-hardening]].

Here the cost is dominated by operating effort and security, not licences. Treat any decision for a custom runner as needing an unusually strong reason.

## Lock-in and exit cost

Lock-in is any dependency that makes leaving costly. Estimate it before you sign or build.

```markdown title="exit-cost-checklist.md"
## Exit cost checklist: <tool>

- [ ] Data export: what formats exist, how long a full export takes, how it is verified
- [ ] Metadata export: permissions, properties, audit logs, build info
- [ ] Pipeline coupling: how many repositories reference the tool's URL or API
- [ ] Proprietary features used: query languages, plugins, workflow DSLs
- [ ] Credentials: tokens, service accounts and webhooks to rotate on exit
- [ ] Retraining: engineer-hours to move to the replacement
- [ ] Dual-run period: duration and cost of paying for both
- [ ] Contract: notice period, minimum term, data deletion commitment
- [ ] Owner and a rehearsed exit test within the last 12 months
```

A tool with a cheap exit gives you negotiating power and the freedom to revisit the decision. A tool you cannot leave is a dependency you should treat as strategic and fund accordingly.

## Recording the decision

Every build or buy decision becomes an ADR from the template, not a chat message. Include the requirements, the options considered, the TCO assumptions (with the date), the lock-in assessment and the review triggers. See [[adr/index|the ADR index]] for the process and status lifecycle. Accepted ADRs are immutable, so when circumstances change, write a new ADR that supersedes the old one.

## Review triggers

Write them into the ADR so the decision is revisited deliberately:

- **Renewal:** at least 90 days before a contract renewal.
- **Major version change:** a new major release or a change in licensing terms.
- **Ownership change:** the vendor is acquired or the open-source project changes governance.
- **Security incident:** a serious vulnerability or breach involving the tool.
- **Team or scale change:** consumers double, or the team that operates it shrinks.
- **Cost drift:** actual spend exceeds the model by an agreed margin.

## Sources

- [GitLab Runner documentation](https://docs.gitlab.com/runner/): executors and autoscaling. Check the current docs.
- [Jenkins user documentation](https://www.jenkins.io/doc/book/): controller and agent architecture. Check the current docs.
- [JFrog documentation](https://jfrog.com/help/): product editions and features. Check the current docs and licensing terms.
- [Artifact Registry documentation](https://cloud.google.com/artifact-registry/docs): supported formats and features. Check the current docs.

## Related

- [[gitlab-ci-vs-jenkins]]
- [[argocd-vs-flux]]
- [[terraform-vs-opentofu]]
- [[engineering-budget-planning]]
- [[artifact-promotion-artifactory]]
- [[gitlab-runners-on-gke]]
- [[devops-vendor-and-licence-management]]
- [[adr/index|The ADR index]]
