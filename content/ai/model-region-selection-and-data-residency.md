---
title: Selecting model regions and controlling data residency
description: Choose inference locations using a documented data-flow, service-capability, latency, resilience, and residency review.
type: pattern
tags:
  - ai
  - security
  - compliance
  - networking
created: 2026-10-26
modified: 2026-10-26
draft: false
---

> [!warning] Not legal or audit advice
> This engineering guidance helps document technical choices; it does not interpret residency, transfer, or localization law. Obtain review from the organization's privacy and legal owners.

## Map every processing location

“Region” can describe where a request is accepted, where inference runs, where logs are stored, where a cache lives, or where support access occurs. These are not necessarily the same. Document the complete path: user-facing service, gateway, model endpoint, model deployment, safety or moderation service, retrieval data, telemetry, backups, and provider support systems. For each component, record what data crosses the boundary, which location is selected, and which contractual or technical guarantee supports the claim.

Separate control plane from data plane. A control plane may manage deployments or configuration in a different location than inference, while logs and abuse monitoring can follow additional rules. Confirm the provider's exact product, endpoint, model class, and configuration, not just a broad cloud region name. The location page is a useful inventory, but availability and residency behavior can vary by model and feature and can change over time.

## Select using explicit criteria

Start with policy-approved data classes and required processing boundaries. Remove candidates that do not meet the requirement. Among eligible regions, compare model availability, quota and capacity, latency to the calling service, reliability, support model, cost, and failover options. Record why the chosen region satisfies each required condition and who approved the interpretation. Avoid assuming the nearest region is the right one if it lacks capacity or does not meet residency constraints.

Represent region and provider as explicit routing configuration with an allowlist. A default or global endpoint can distribute requests in ways that do not match a strict location requirement. Verify where inference and any fallback, cache, and observability export operate. Configure tests to assert the selected endpoint and deployment metadata; monitor route changes without recording sensitive request content. Do not allow an outage fallback to silently cross a boundary.

## Design failover before production

Resilience and residency can conflict. If the permitted region becomes unavailable, the correct behavior may be bounded queueing or a user-visible service limitation rather than failover elsewhere. Define the acceptable fallback set and degradation behavior during design, with product, platform, security, and privacy owners. Capacity-plan the allowed regions independently; a failover region with no reserved or tested headroom can be nominal only.

When a region change is approved, use a staged change process: validate endpoint identity, access controls, data-flow mapping, quotas, and representative quality; canary a limited cohort; compare latency, error rate, and cost; and retain a rollback path to the known compliant route. Keep evidence of the previous and new configuration and the approval. Do not treat infrastructure automation as proof that the destination is policy-compliant.

## Keep claims current

Maintain a dated region/model matrix containing provider, service, endpoint type, supported models, routing semantics, data-control references, and known exceptions. Assign an owner to check provider changes and revalidate high-risk assumptions at each model or endpoint change. Provider marketing material, service docs, contract terms, and account configuration may answer different questions; retain the specific source for each claim and note uncertainty.

Review the matrix after a new service, new telemetry destination, prompt cache, regional outage, or account-level policy change. Use a synthetic canary and configuration audit to detect drift. If the team discovers a route to an unapproved location, preserve evidence and follow the established incident process; do not make undocumented changes that could destroy useful audit evidence. See [[vertex-ai-private-access-from-gke]] for a specific private-access design and [[fallback-model-selection-and-quality-degradation]] for alternate-route limits.

## Checklist

- Data-flow inventory includes inference, control plane, logs, cache, retrieval, and support paths.
- Region choice is checked against policy-approved data categories and product capabilities.
- Routing uses an explicit allowlist and records effective endpoint metadata.
- Fallback behavior never crosses the approved boundary implicitly.
- Capacity and latency are tested in each permitted region.
- Claims cite current provider documentation and relevant contractual review.
- Owners and revalidation triggers are named.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Deployments and endpoints](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations): Google Cloud model deployment and location information; availability can vary by model.
- [Data, privacy, and security for Foundry Models sold by Azure in Microsoft Foundry](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy): Microsoft provider-specific processing details; check service and contract applicability.
- [Gemini Enterprise Agent Platform and zero data retention](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance): data governance controls and scope limitations.
