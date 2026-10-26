---
title: Evidence collection for AI agent security incidents
description: Preserve enough AI workflow evidence to reconstruct decisions and actions while minimizing sensitive content and protecting chain of custody.
type: guide
tags:
  - ai
  - security
  - incident-management
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

An AI-agent incident may span a user request, model response, retrieval result, tool call, identity decision, network request, and downstream state change. Evidence must connect those events without turning routine telemetry into a repository of prompts, credentials, or personal data. Preserve records early, but collect only what is necessary and follow legal, privacy, and incident-response requirements. This note adds AI-specific evidence fields to [[ai/ai-assisted-incident-response]] and [[ai/runaway-or-compromised-ai-agent-response]].

## Preserve the execution context

Record an incident or trace identifier, workflow and deployment version, model provider and model identifier as exposed by the service, prompt-template or policy version, tool inventory, runtime image or package versions, and relevant configuration revision. Provider identifiers may be aliases or changeable values; record the observation time and avoid asserting that a label uniquely identifies immutable weights unless the provider confirms it. Preserve the timestamp source and clock context for each system.

For each model interaction, retain only the level of content required by the organization’s incident policy. Useful metadata may include request ID, actor or pseudonymous principal, tenant, data classification, token counts, route, decision, and outcome. If prompts or completions are retained, restrict access, redact secrets and unnecessary personal information, and define deletion dates. A trace without content can still establish sequence, while a content sample may be required to understand a specific manipulation; make the choice explicit rather than logging everything by default.

## Capture tool and authorization events

For every tool invocation, record the requested operation, validated arguments or a redacted representation, authenticated principal, delegation context, authorization policy and result, human approval reference, target resource, downstream response, and whether a side effect occurred. Distinguish a model-proposed action from an action accepted by the tool service. Include denied calls and policy failures where they help prove the boundary worked.

Correlate tool events with identity-provider and resource-service records. Preserve token metadata and grant identifiers where available, but never store bearer tokens, refresh tokens, passwords, or secrets as evidence. For browser workflows, retain the approved origin, action summary, account identity, and relevant screenshot or page capture only when needed. Screenshots may expose unrelated user information; store them in a restricted case repository and avoid broad ticket attachments.

## Protect integrity and chain of custody

Use access-controlled, append-only or tamper-evident storage where available. Record who collected evidence, when, from which system, and how it was transformed or redacted. Hash exported artifacts and preserve the original where policy allows. A hash establishes that a later copy matches the captured bytes, not that the source system’s record was truthful or complete. Preserve export queries, filter criteria, and collection-tool version so another responder can understand gaps.

Keep evidence in a case-specific location with least-privilege access, encryption, retention controls, and access logging. Separate raw evidence from working notes and sanitized summaries. Do not copy credentials or confidential user content into a general chat, issue tracker, or public post. If a provider or SaaS system holds relevant logs, request preservation through its approved process and record the request, response, retention window, and known limitations.

## Build a useful event timeline

Align events across the model gateway, agent orchestrator, tool servers, identity system, egress proxy, cloud audit logs, and affected application. Account for clock skew, asynchronous queues, retries, and provider-side operations that are not visible to the customer. Use stable correlation IDs, but do not assume a missing span means an action did not happen. Document known telemetry gaps and sources that were unavailable or expired.

OpenTelemetry’s GenAI semantic conventions have moved to the dedicated [semantic-conventions-genai repository](https://github.com/open-telemetry/semantic-conventions-genai); the old documentation page says it is no longer maintained. Attribute names and conventions can evolve, so record the instrumentation version and avoid claiming complete coverage based on a standard alone. [[ai/llm-observability-tracing-and-slos]] covers service-level observability; incident evidence additionally requires integrity, access, and retention controls.

## Failures, minimization, and response

Common evidence failures include logging only the final answer, losing tool arguments, recording unsynchronized timestamps, retaining no policy version, storing secrets in traces, and allowing operational teams to overwrite logs during cleanup. Another failure is collecting full prompts indiscriminately “just in case,” creating a privacy breach while attempting to investigate a security event. Set a documented baseline and an incident-specific procedure to preserve additional evidence when justified.

When compromise is suspected, follow the incident commander’s instructions, preserve relevant logs and artifacts before routine expiry, and record any containment action that changes system state. The evidence plan should not delay urgent safety or containment actions; record what was changed and why. Limit access to the incident team, maintain a decision log, and use sanitized derivatives for broader communications. Confirm legal hold, notification, and reporting obligations with appropriate organizational owners.

## Review checklist

- Can responders correlate model, tool, identity, network, and downstream events?
- Are model proposals distinguishable from authorized and executed actions?
- Are policy, prompt-template, runtime, and artifact versions recorded?
- Are token secrets excluded and sensitive content minimized by design?
- Is evidence integrity, custody, access, and retention documented?
- Are clocks, retries, asynchronous steps, and telemetry gaps accounted for?
- Can extra evidence be preserved quickly without broadening access?
- Are incident actions recorded without delaying necessary containment?

## Sources

- [NIST AI 600-1, Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): lifecycle risk-management context for generative AI.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework): AI RMF 1.0 overview and current revision notice.
- [OpenTelemetry GenAI semantic conventions repository](https://github.com/open-telemetry/semantic-conventions-genai): current location of evolving GenAI telemetry conventions.
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): agent security risks relevant to evidence planning.
- [Owner’s AI skills catalogue](https://ai.szolotov.com): reusable AI skills and workflows.
