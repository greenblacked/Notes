---
title: Model inventory and owner registration
description: Maintain a service-facing inventory of models, endpoints, data flows, owners, and lifecycle decisions.
type: pattern
tags:
  - ai
  - audit
  - management
  - compliance
created: 2026-10-26
modified: 2026-10-26
draft: false
---

> [!warning] Not legal or audit advice
> An inventory supports engineering accountability but does not determine legal classification or satisfy an audit by itself. Involve the appropriate governance and legal owners.

## Inventory the deployed integration

A useful model inventory answers operational questions: what is running, who owns it, what user journey depends on it, where data flows, how it is monitored, and how it can be changed or retired. Record each integration or deployed model endpoint as a separate item, even when teams share a provider. Shared API access does not imply shared purpose, data classes, risk, or reliability owner.

Minimum fields should include a stable inventory ID, service and environment, product purpose, provider and endpoint, model/deployment identifier and revision where available, region, owner and backup contact, service criticality, data categories, inputs and outputs, tool permissions, safety and human-review boundaries, SLO/dashboard, cost center, fallback, release process, and lifecycle state. Include dates for last operational review and next planned review. Mark unknown values explicitly and assign an owner to resolve them instead of leaving ambiguous blanks.

Separate a model name from the integration that invokes it. The same model can power a low-risk summarizer and a consequential recommendation flow with different controls. Include prompt and tool versions or links to their managed repositories, not the full prompt text in an inventory that may have broader readership. Link to data-flow diagrams and approved provider terms through access-controlled references.

## Establish ownership and sources of truth

Assign a service owner accountable for the integration's behavior and incident response, a technical owner for the gateway or deployment, and a data owner for the inputs and outputs. Name a secondary contact and an escalation route. Ownership is not satisfied by a generic platform team if no one accepts the product risk. Use role-based groups rather than personal email where possible, and verify that those groups remain monitored.

Treat the registry as a pointer-rich source of truth, not a duplicated configuration database. Where possible, populate provider, model, region, and version from deployment metadata or gateway configuration. Record the source and last synchronization time. A mismatch between inventory and runtime should generate a review task, not be hidden by a manual update. Keep security-sensitive details accessible only to approved roles.

Lifecycle states can be proposed, approved for test, production, paused, and pending retirement. Define the transition owner and evidence required for each state. Production readiness should include owner acceptance, data-flow review, evaluation, monitoring, spend attribution, and a supported fallback or clear degraded behavior. [[llm-change-management-and-release-gates]] explains promotion gates; [[model-version-pinning-and-upgrade-evals]] describes model lifecycle details.

## Review and measure completeness

Run periodic checks for orphaned endpoints, stale owners, mutable model aliases, missing region data, unknown retention behavior, and expired provider credentials or quotas. Compare inventory entries with gateway logs, cloud deployment APIs, billing exports, and repository configuration. Use aggregate metadata; do not export prompts to discover integrations. Reconcile differences with each service owner and preserve the review outcome.

Track completeness as actionable fields rather than a single percentage. A missing owner is an operational gap; missing region or data categories can be a privacy or policy blocker; a stale pricing record is a forecast risk. Define escalation for unresolved high-risk gaps and an exception owner with an expiry date. A registry that accepts production entries with no owner or data flow is an address book, not a control.

## Checklist

- Every production integration has a stable ID, purpose, owner, and backup contact.
- Provider, model revision, region, data classes, and tool boundaries are documented.
- Runtime metadata is compared with inventory records.
- SLO, dashboard, cost center, fallback, and release links are present.
- Unknowns have owners and due dates; exceptions are reviewed and expire.
- Access to sensitive inventory fields is role-scoped.
- Inventory review detects stale owners and unregistered deployments.

For risk frameworks, describe the version and status accurately. NIST says its AI RMF 1.0 is being revised; it can inform risk-management conversations but should not be called the current unrevised final standard. Engineering guidance is not legal advice. See [[ai-coding-assistant-admin-controls]] for assistant-specific administrative inventory concerns.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [NIST AI Risk Management Framework Playbook](https://airc.nist.gov/airmf-resources/playbook/): companion guidance for AI RMF 1.0; the page notes that revision is underway.
- [GitHub: OpenTelemetry GenAI Semantic Conventions](https://github.com/open-telemetry/semantic-conventions-genai): evolving conventions for identifying and observing GenAI operations.
- [Google SRE: Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/): operational signal and ownership context.
