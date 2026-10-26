---
title: Model provider failover and routing
description: Route inference across approved providers using explicit health, capability, residency, deadline, and failure policies rather than blind retries.
type: guide
tags:
  - ai
  - architecture
  - reliability
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Failover is a semantic change

Routing between model providers is not equivalent to switching interchangeable compute endpoints. Providers can differ in model revisions, tokenization, supported modalities, context behavior, safety settings, structured output, streaming, rate limits, data location, and error semantics. A route that preserves an API shape may still change answer quality, cost, or compliance posture.

Define an approved route matrix before an outage. For each application class, specify primary and eligible secondary model/provider/region combinations, required capabilities, data restrictions, quality envelope, and operator ownership. Do not let a generic fallback route select any available model. If no secondary meets the constraints, rejecting or queueing work may be safer than sending it to an unapproved endpoint.

This note covers runtime route policy, not account-level spend limits. See [[llm-api-cost-control|LLM API cost control]] for budgets and token caps.

## Route on observable conditions

Separate provider health from individual request errors. A timeout, explicit overload response, credential error, invalid request, policy denial, and model-specific failure call for different actions. A circuit breaker can suppress repeated attempts to a backend with a persistent failure, while a short-lived retry may be reasonable for a transient error. Establish thresholds from service behavior and test them; do not assume a single provider status signal captures all failure modes.

Honor caller deadlines and avoid retrying after the useful response window. Use a bounded retry count, exponential backoff with jitter, and a per-attempt timeout derived from the remaining deadline. If the provider may have accepted the call but the response was lost, a retry may duplicate work or cost. Use an idempotency mechanism where the provider supports it, and track request state where the application owns the operation.

Streaming requires special handling. Once content has reached the caller, transparently restarting against a different provider can duplicate or contradict visible output. Define whether a partially streamed answer is terminated with an explicit error, resumed only under a documented protocol, or marked incomplete. Do not splice outputs from two models without a product-level design and tests.

## Preserve policy and quality

Check data residency and privacy rules before changing region or provider. Provider failover should not bypass the request's tenant authorization, redaction, or model allowlist. Keep provider credentials separate and scoped. Record the chosen route and reason without logging prompt content. Ensure audit fields can distinguish normal routing, a canary, and emergency failover.

Test secondary routes on a fixed evaluation suite and real request shapes. Compare schema validity, refusal behavior, latency, cost, and application-specific quality. A model name match is not proof of equivalent capability. Pin endpoint/model identifiers where providers support immutable versions, and revalidate after provider changes; labels and aliases may move.

Keep routing policy simple enough to understand during an incident. A complex scoring function with poorly explained weights can make emergency behavior unpredictable. Prefer a small set of transparent rules: eligible routes, health gate, request capability gate, priority order, then bounded retries.

## Failure modes

- **Retry storm:** multiple layers retry the same failure. Assign one retry owner and cap attempts across the full call path.
- **Cross-provider drift:** fallback responses violate product expectations. Gate routes with evaluations and visible behavior differences.
- **Policy bypass:** emergency configuration ignores region or model restrictions. Use an audited, pre-approved route matrix.
- **Flapping health:** rapid route oscillation increases failures. Use hysteresis and cooldowns, with operator override.
- **Partial stream duplication:** restarted response repeats or conflicts with delivered text. Treat stream interruption as explicit and test it.
- **Stale credentials or quota:** route looks healthy but cannot accept production traffic. Test auth and quota readiness independently.

## Readiness checklist

- Document eligible primary and secondary routes, region constraints, and required capabilities.
- Verify both routes' credentials, quota posture, latency, and error mapping.
- Test hard failures, slow responses, throttling, and partially delivered streams.
- Bound retries across client, gateway, and provider SDK; preserve end-to-end deadlines.
- Keep model versions and route decisions traceable without payload logging.
- Rehearse failover and failback, including a route back to the previously tested primary.

Failover trades availability against behavioral consistency and governance. Choose the accepted degradation explicitly. If no route preserves mandatory controls, fail safely and communicate the limitation rather than silently relaxing policy.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Rate limits | OpenAI API](https://developers.openai.com/api/docs/guides/rate-limits): OpenAI-specific rate limit and response guidance; behavior and limits can vary by account and model.
- [Rate limits - Claude Platform Docs](https://platform.claude.com/docs/en/api/rate-limits): Anthropic-specific rate-limit behavior; confirm current account and endpoint details.
- [Rate limits | Gemini API](https://ai.google.dev/gemini-api/docs/rate-limits): Google AI Studio Gemini API quotas and rate-limit guidance; not interchangeable with Vertex AI quotas.
- [Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html): Amazon Bedrock quota documentation; quotas vary by account, model, and region.
