---
title: Data retention and deletion in LLM systems
description: Map data copies across model workflows and implement reviewable retention, deletion, and evidence controls.
type: pattern
tags:
  - ai
  - security
  - compliance
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

> [!warning] Not legal or audit advice
> This engineering pattern does not determine a legal retention period or prove compliance. The organization's privacy, security, records, and legal owners must decide applicable obligations.

## Build a data lifecycle map

An LLM request can create many copies beyond the prompt sent to a provider. Map collection, preprocessing, gateway buffers, provider request, provider-side logs, response, cache, retrieval index, application database, traces, evaluation dataset, support ticket, backup, and export. For each location, record the data owner, data categories, purpose, access roles, retention mechanism, deletion path, and any provider or subprocessors involved. Include derived data such as embeddings, summaries, classifications, and model-generated labels; derived data may still disclose or remain linkable to source content.

Classify data before it enters the model path. Identify secrets, direct identifiers, confidential material, regulated categories, and data whose use is restricted by contract or policy. Minimize at source and apply a fail-closed filter before external calls where feasible. [[redacting-sensitive-data-before-llm-calls]] covers the outbound control; this note covers persistence and lifecycle. A prompt that is redacted at the gateway may still be retained in an upstream application log.

## Set retention by purpose

Assign a retention period to each copy based on operational need and approved records policy. Request/response content often does not need to persist in normal telemetry; counters, model versions, outcome classifications, and request IDs may be sufficient. Keep detailed usage accounting separate from content so finance can reconcile spend without retaining prompt text. Document exceptions for debugging or evaluation and constrain them by purpose, access, duration, and approval.

Do not infer provider retention from a marketing statement or a single configuration label. Verify the actual service, endpoint, region, account tier, feature, abuse-monitoring controls, and contract terms in current official documentation and account settings. Provider features differ and change. Record who checked and when, and make the data-flow inventory identify any unresolved provider-side retention assumptions.

## Make deletion requests verifiable

Deletion is a lifecycle workflow, not a single database operation. Define how an authorized request is identified, authenticated, scoped to records and derived artifacts, checked against legal holds or preservation needs, approved, executed by accountable owners, and recorded. A declaration should identify the systems and copies covered, exceptions, expected completion boundary, and evidence that the responsible system owners completed their part. The engineering process should not imply that a provider-side copy or backup was removed unless the provider confirmed that scope and status.

Protect evidence while a deletion request is processed. Use a case identifier rather than reproducing the subject's data in tickets. Record the applicable policy decision, systems queried, owner confirmations, unresolved dependencies, and completion date. For backups, logs, immutable records, or caches that cannot be selectively altered immediately, document the retention behavior and ensure the data does not re-enter active processing. Escalate conflicts between deletion and preservation requirements to authorized privacy/legal owners.

Avoid ad hoc manual cleanup from an incident channel. The controlled procedure needs a second-person review for high-risk data, an auditable record, and a recovery plan for accidental scope expansion. Preserve minimal proof of completion without retaining the content being removed. The exact balance of evidence and erasure obligations is jurisdiction- and policy-dependent; engineering guidance is not legal advice.

## Validate the lifecycle

Test with synthetic records containing unique markers and trace them through application stores, caches, indexes, exports, and backup restore exercises. Verify that retention expiry stops access and removes or isolates data according to the approved design. Test retries, dead-letter queues, observability pipelines, and evaluation copies; these are common orphan locations. Check that restored backups do not make expired content available again without an approved restore workflow.

Review the map on every new provider, endpoint, integration, logging field, retention setting, and product feature. A quarterly owner review can confirm contacts, policy references, and provider configuration evidence. For privacy incidents, follow the organization's incident process rather than improvising a retention change mid-investigation. See [[llm-tracing-with-sensitive-data-controls]] for telemetry safeguards and [[ai-coding-assistant-admin-controls]] for administrative data controls.

## Checklist

- Data flow includes source, derived data, logs, traces, caches, indexes, backups, and provider copies.
- Retention periods are approved and tied to a stated purpose.
- Data is minimized before model calls; content is excluded from routine telemetry.
- Provider-specific retention assumptions are tied to current documentation and account evidence.
- Deletion requests have authorization, scope review, owners, evidence, and exception escalation.
- Synthetic-marker tests cover secondary stores and backup restoration.
- Privacy/legal owners review jurisdictional and contractual questions.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Gemini Enterprise Agent Platform and zero data retention](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance): provider-specific data-governance description; verify endpoint and account applicability.
- [Data controls in the OpenAI platform](https://platform.openai.com/docs/guides/your-data): provider-specific retention and control details; confirm current product terms.
- [Data, privacy, and security for Foundry Models sold by Azure in Microsoft Foundry](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy): provider-specific processing information; check current scope and contract.
