---
title: Service tiering standard
description: "One criticality scale for services and what each tier requires: SLOs, on-call, DR, restore drills, readiness review, change approval and patch deadlines."
type: standard
tags:
  - standards
  - reliability
  - on-call
  - incident-management
  - delivery
created: 2026-10-21
modified: 2026-10-21
draft: false
---

"Critical service" appears all over our standards: the readiness review re-reviews critical services yearly, restore drills are quarterly for the top tiers, freezes cover customer-facing services, and the workload baseline sets replicas per tier. Without one definition, every team decides for itself what "critical" means, usually in the middle of an incident. This standard defines one scale, tier 0 to tier 3, says how a service is placed on it, and lists what each tier requires in one matrix, so a tier is a set of commitments rather than a label.

The tier answers "how much does it hurt when this is down, and for whom?". It is independent of the data class ([[data-classification-and-handling-standard]]), which answers "how much does it hurt when this data leaks?". A tier 3 internal tool can hold Restricted data, and a tier 0 DNS service holds almost none. Both are recorded, and neither is derived from the other.

## Scope

Applies to every service, platform component and shared tool that runs in production or that production delivery depends on: customer-facing services, internal APIs, data pipelines, and platform foundations such as DNS, identity, CI runners and the artifact store. Libraries and one-off scripts have no tier; the services that use them do.

> [!info] Keywords
> MUST means the readiness review or a reviewer blocks the change. SHOULD means the service owner records why a deviation is acceptable. **All targets in this note are proposed team defaults, not vendor figures.** Where another standard already sets a number (restore drill cadence, PRR re-review interval, vulnerability deadlines, replica counts), this note links to it instead of repeating it, so the two cannot drift apart.

Not to be confused with the **error budget tiers** (healthy, at risk, exhausted) in [[error-budget-policy]], which describe a service's current budget, not its criticality.

## Classifying a service

Answer each question for the realistic worst case of a one-hour outage, and take the **highest single answer**, not the sum. A sum hides the one answer that matters: a service that blocks every deploy is critical even if no customer sees it.

| Question                                             | 0                         | 1                         | 2                                    | 3                                                             |
| ---------------------------------------------------- | ------------------------- | ------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| Who notices a one-hour outage?                       | Nobody, or one team later | Internal teams are slowed | Some customers see degraded features | Customers cannot use a core function                          |
| What depends on it?                                  | Nothing                   | One team's workflow       | Several services or teams            | Most production services, or every deploy                     |
| Revenue, contractual or regulatory impact            | None                      | Indirect                  | Measurable, recoverable              | Direct loss, a contract breach or a regulatory reporting duty |
| How long can it be down before the business is hurt? | Days                      | A working day             | A few hours                          | Minutes                                                       |

Mapping (proposed team default):

- **Tier 0, platform foundations**: the answer to "what depends on it?" is 3. Production cannot run, scale, deploy or recover without it. Examples: DNS, identity and access, the artifact store, CI runners that carry the hotfix path, the GitOps controller, the central secrets store, the network hub.
- **Tier 1, customer-critical**: any other answer is 3. Examples: checkout, payments, login, the public API.
- **Tier 2, degradable customer-facing or important internal**: the highest answer is 2. Examples: recommendations, search suggestions, reporting APIs, internal tools that block several teams.
- **Tier 3, internal best effort**: the highest answer is 0 or 1. Examples: internal dashboards, cost reports, a team's own bots.

The data owner and the service owner classify together, and the engineering manager approves. "Regulatory impact" is answered with the compliance team; the [[compliance/dora-eu-operational-resilience-for-engineers|DORA note]] explains the related idea of critical or important functions under EU rules, which this standard neither replaces nor interprets.

## What each tier requires

All values are proposed team defaults. Linked standards own their own numbers.

| Requirement                 | Tier 0                                                                                                     | Tier 1                                                  | Tier 2                                                                 | Tier 3                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| SLO                         | Required ([[slo-definition-standard]]); availability target around 99.95%                                  | Required; around 99.9%                                  | Required; around 99.5%                                                 | Optional                                         |
| Error budget policy         | Applies, with the release gate                                                                             | Applies, with the release gate                          | Applies; release gate optional                                         | Does not apply                                   |
| Paging                      | 24x7, primary and secondary on-call, platform escalation                                                   | 24x7                                                    | Business hours; out of hours only for SEV1                             | No paging; tickets in business hours             |
| Postmortem                  | SEV1, SEV2 and any SEV3 with impact on other teams                                                         | SEV1 and SEV2                                           | SEV1 and SEV2                                                          | When it teaches something                        |
| Disaster recovery approach  | Active-passive or active-active                                                                            | Warm standby or active-passive                          | Pilot light or backup and restore                                      | Backup and restore                               |
| Restore drill               | Quarterly                                                                                                  | Quarterly                                               | Quarterly                                                              | At least yearly                                  |
| Production readiness review | Before launch; re-review as a critical service                                                             | Before launch; re-review as a critical service          | Before launch; re-review on a change of shape or as a standard service | Short checklist: owner, alerts, runbook, backups |
| Change process              | Every change at least Medium risk; High changes need a second approver from another team and a window      | Per the risk class; High changes in a window            | Per the risk class                                                     | Per the risk class; usually Low                  |
| Freezes                     | Apply                                                                                                      | Apply                                                   | Apply when customer-facing                                             | Do not apply unless a higher tier depends on it  |
| Replicas, zones, priority   | As tier 0 in [[kubernetes-workload-baseline-standard]]                                                     | As tier 1 in the workload baseline                      | As tier 2 in the workload baseline                                     | As tier 3 in the workload baseline               |
| Vulnerability deadlines     | The internet-exposed rows of [[vulnerability-management-slas]], even for internal components               | The internet-exposed rows, even for internal components | By actual exposure                                                     | By actual exposure                               |
| Hard dependencies           | Only on tier 0                                                                                             | Tier 0 and 1; lower tiers only with a tested fallback   | Tier 0 to 2; tier 3 only with a tested fallback                        | Any                                              |
| Runbooks and alerts         | Every page-level alert has a runbook ([[alert-and-runbook-standard]]); dependency failure modes documented | Every page-level alert has a runbook                    | Every alert has a runbook                                              | An owner and a basic runbook                     |

How to read the rows:

- **SLO targets** are starting points for the SLO document, not promises. A tier 1 service whose users need 99.5% sets 99.5% and records why. A target the service has never met is a roadmap item, not an SLO.
- **Disaster recovery** names the approaches in [[architecture/disaster-recovery-tiers-rpo-rto]]. The business owner still sets the RPO and RTO; the tier gives the default starting point and the cost discussion.
- **Restore drills** apply [[adr/0051-backups-proven-by-quarterly-restore-drills|ADR-0051]], which requires quarterly drills for its top DR tiers and at least yearly drills for the rest. Its "tier 1 and tier 2" are DR tiers, not service tiers, and the DR tiers in [[architecture/disaster-recovery-tiers-rpo-rto]] are named (backup and restore up to active-active), not numbered, so the ADR's numbering has no anchor. This standard maps the drill cadence to service tiers instead: tiers 0 to 2 quarterly, tier 3 at least yearly (proposed). Follow-up: ADR-0051 should be updated to name the DR tiers it means; until then, this mapping applies.
- **Readiness review**: "critical service" in [[production-readiness-review]] means tier 0 and tier 1, plus any service that holds Restricted data. The second part keeps the review's "touches regulated data" clause, now expressed through the data class in [[data-classification-and-handling-standard]], because the tier and the data class are independent. Its re-review cadence applies unchanged.
- **Change process** uses the risk classes of [[production-change-checklist]] and the freeze kinds of [[change-freezes-and-maintenance-windows]].
- **Postmortems** follow [[adr/0050-incident-severity-levels-and-roles|ADR-0050]] (mandatory for SEV1 and SEV2) and [[blameless-postmortems]]; tier 0 adds SEV3 with cross-team impact because a small platform incident often hides a large latent risk.
- **Paging hours** must be sustainable. A 24x7 tier needs a rota big enough to be healthy ([[management/on-call-health]]); if the team cannot staff it, the conversation is about the tier or the staffing, not about quietly ignoring pages.

## The dependency rule

A service may not hard-depend on a service of a lower tier (a higher number) unless it has a fallback that has been tested: a cache with a known staleness, a degraded mode, a queue that absorbs the outage. Otherwise the lower-tier service effectively inherits the higher tier without its staffing or its controls, and the higher-tier SLO is fiction.

When a dependency breaks the rule, pick one:

1. Add and test the fallback ([[timeouts-retries-load-shedding]] covers the mechanics).
2. Raise the dependency's tier, with its owner's agreement and the staffing that comes with it.
3. Record an exception with an expiry while one of the above is done.

The readiness review checks this for every listed dependency.

## Where the tier is recorded

Use the same value everywhere: `tier-0`, `tier-1`, `tier-2` or `tier-3`. The value starts with a letter so that it is valid as a GCP label value as well as a Kubernetes label value.

| Where                | Key                                                                                                | Example                            |
| -------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Service catalog      | `example.com/service-tier` annotation and a `tier-N` tag in `catalog-info.yaml`                    | `example.com/service-tier: tier-1` |
| Repository           | README, owner section ([[repository-baseline-standard]])                                           | "Service tier: tier-1"             |
| Kubernetes namespace | Label `example.com/service-tier`                                                                   | `example.com/service-tier: tier-1` |
| GCP project          | Label `service-tier`, alongside the required labels of [[gcp-resource-naming-and-labels-standard]] | `service-tier=tier-1`              |
| Alerts               | Routing uses the namespace or project label, not a copy typed into each rule                       | n/a                                |

Change `example.com` to your own domain prefix. The catalog is the source of truth; the labels are copies written by the platform pipeline from it, so they cannot disagree for long. A periodic job compares them and opens a ticket on a mismatch.

```bash title="Find namespaces and projects without a tier"
# Kubernetes: namespaces without the tier label (system namespaces excluded by hand)
kubectl get namespaces -l '!example.com/service-tier' -o name

# GCP: projects without the service-tier label
gcloud projects list --filter='-labels.service-tier:*' --format='value(projectId)'
```

The hyphenated key parses and evaluates as intended in the filter engine of the installed Google Cloud SDK 570.0.0 (checked locally on 2026-10-21 against sample data, not against a live organisation). Whether `projects list` evaluates it client-side or server-side was not verified; check a known untiered project appears before trusting an empty result.

## Reviewing and changing a tier

Review the tier:

- at the production readiness review and each re-review;
- yearly, as part of the catalog review;
- after any SEV1 or SEV2 in which the service took part, as a cause or as a victim;
- when a new set of dependents, a new contract or a new regulatory duty arrives.

A tier change is a merge request to `catalog-info.yaml` with the classification answers in the description, approved by the service owner and the engineering manager. A move into or out of tier 0 or tier 1 also needs the platform or SRE lead, because it changes paging, DR and drill commitments. Record the decision and its date in the README; write an ADR only when the change alters a platform commitment (for example making a service tier 0). Then update the requirements: an upgrade starts a dated plan to meet the new tier (proposed default 90 days); a downgrade takes effect only after the commitments that depend on it (dependents, contracts) are checked.

## Worked example

Four fictional services, classified with the questions above.

| Service          | Who notices | Dependents                                                    | Business impact | Tolerable downtime | Highest answer | Tier   | Data class   |
| ---------------- | ----------- | ------------------------------------------------------------- | --------------- | ------------------ | -------------- | ------ | ------------ |
| `artifact-proxy` | 1           | **3** (every deploy and every node scale-up pulls through it) | 2               | 2                  | 3 (dependents) | tier-0 | Internal     |
| `ledger-api`     | **3**       | 2                                                             | **3**           | **3**              | 3              | tier-1 | Restricted   |
| `search-suggest` | **2**       | 1                                                             | **2**           | 1                  | 2              | tier-2 | Internal     |
| `cost-report`    | **1**       | 0                                                             | 0               | 0                  | 1              | tier-3 | Confidential |

What follows from it:

- `artifact-proxy` is tier 0 although no customer calls it, because production cannot scale or deploy without it. It gets 24x7 paging with platform escalation, an active-passive design, quarterly restore drills and the internet-exposed vulnerability deadlines.
- `ledger-api` is tier 1 and Restricted: tier 1 reliability commitments plus the data handling of the Restricted class (CMEK, perimeter, no standing access). The two axes add up; neither replaces the other.
- `search-suggest` can fail without stopping a purchase. If the checkout page calls it, checkout (tier 1) must treat it as optional with a timeout and an empty fallback, or the dependency rule is broken.
- `cost-report` is tier 3 but Confidential: no paging, but its data still follows the Confidential handling rules.

## Exceptions

A service that cannot meet its tier's requirements yet (a new tier 1 service without a tested DR plan, a dependency without a fallback) records the requirement, the reason, the risk accepted, the plan and an expiry date (proposed default 90 days) through [[compliance/policy-exception-and-waiver-process]], approved by the engineering manager. A tier 0 or tier 1 service without an owner team or without paging is never accepted as an exception.

## Reviewer checklist

- [ ] The tier comes from the classification questions, with the answers recorded in the merge request.
- [ ] The tier is the same in the catalog, README, namespace label and project label.
- [ ] The tier's requirements are met or covered by a dated exception: SLO, paging, DR approach, restore drills, PRR, replicas and zones.
- [ ] Every hard dependency is the same tier or higher, or has a tested fallback.
- [ ] Paging hours match a rota that can sustain them.
- [ ] The data class is recorded separately and its handling rules are applied independently.

## Sources

These are further reading. They were not re-read for this note, and no figure in it is taken from them.

- [Google SRE workbook: Implementing SLOs](https://sre.google/workbook/implementing-slos/)
- [Google Cloud Architecture Framework: reliability](https://cloud.google.com/architecture/framework/reliability)
- [Google Cloud: Disaster recovery planning guide](https://cloud.google.com/architecture/dr-scenarios-planning-guide)

## Related

- [[production-readiness-review]]: the review that confirms a tier's requirements.
- [[architecture/disaster-recovery-tiers-rpo-rto]]: DR approaches and their cost.
- [[adr/0051-backups-proven-by-quarterly-restore-drills]]: restore drill evidence.
- [[adr/0050-incident-severity-levels-and-roles]]: SEV1 to SEV4 and postmortem duty.
- [[error-budget-policy]] and [[slo-definition-standard]]: SLOs and what happens when the budget runs out.
- [[vulnerability-management-slas]]: remediation deadlines.
- [[architecture/internal-developer-platform-architecture]]: the catalog that holds it.
