---
title: Prompt caching and data isolation
description: Use prompt-prefix caching only after understanding provider semantics, tenant boundaries, sensitive data exposure and cache lifecycle.
type: pattern
tags:
  - ai
  - security
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Prompt caching can reduce repeated processing and sometimes cost or latency by reusing a shared prefix. It does not mean the application may share prompts across users, nor does it establish privacy, data retention or zero-retention guarantees. Treat it as a provider feature with a data-flow and tenancy review, not as a generic HTTP cache. Cost controls are also discussed in [[llm-api-cost-control]].

## Identify what is cached

Draw the request path and identify which content is stable and which varies: system policy, tool schemas, shared reference material, tenant configuration, user-specific records and conversation history. Cache only content whose reuse is expected and whose scope is safe under the provider's documented cache behavior. A stable public instruction prefix is a different risk from a prefix containing customer records or a tenant-specific API schema.

Read the current provider documentation for the exact caching mechanism, eligibility thresholds, expiration behavior, regional processing, data retention and cache partitioning. Features and defaults differ by provider and model and may change. Do not infer isolation from a cache key that your application never controls. When the provider does not clearly document tenant separation for the intended usage, ask the provider or choose not to share that content across trust boundaries.

Keep tenant-specific and user-specific data after the shared prefix where supported by the API, but do not treat message order as a proven isolation guarantee. The cache mechanism's matching rules and provider-side keying must be verified. Application-level tenant authorization and data redaction remain mandatory. Do not place secrets into prompts on the theory that they will expire from a cache.

## Privacy, retention and observability

Caching and retention are distinct concerns. A cache hit does not say whether request content is retained for abuse monitoring, service improvement or contractual processing. Review the provider's applicable product settings, terms and data processing commitments separately. Avoid promising a deletion property unless the provider documentation or contract explicitly supports it for the exact endpoint and account configuration.

Telemetry should record cache outcome, provider, model and route if supported, but not raw prompt prefixes, cache keys containing user identifiers, or sensitive text. Use stable low-cardinality metrics; keep request-specific diagnostics in access-controlled traces. The evolving GenAI attributes in [[llm-observability-tracing-and-slos]] should be checked against the current OpenTelemetry repository before standardizing dashboards.

## Cost and latency tradeoffs

Caching is useful when requests share an identical prefix and the provider actually reports cache reads. It may not help if dynamic fields are inserted early, prompt revisions churn, or calls are too sparse for the cache lifetime. Measure cache-read tokens, total tokens, latency and cost on the same route. Do not optimize hit rate at the expense of tenant boundaries or outdated instructions. A cache hit on a stale policy is still a correctness failure.

Compare caching with other choices such as reducing prompt size, retrieving only needed context or moving stable instructions into application configuration. Treat provider cache prices and retention as changeable; verify current pricing and semantics before forecasting savings.

## Failure modes and checklist

Risks include cross-tenant content in a reusable prefix, a cache key reused across environments, assumptions that cache invalidation occurs immediately after a policy change, and sensitive text leaking through request logging. Another failure is monitoring only cost reduction and missing a jump in stale prompt behavior.

- [ ] Data-flow diagram distinguishes shared, tenant-specific and user-specific content.
- [ ] Current provider documentation confirms cache matching, scope and retention.
- [ ] No secret or unnecessary personal data is included in cacheable prefixes.
- [ ] Tenant authorization is enforced independently of cache behavior.
- [ ] Policy/model revision changes invalidate or safely segregate old prefixes.
- [ ] Logs and metrics exclude raw prompts and sensitive cache keys.
- [ ] Cache hit, miss, latency and quality are measured together.
- [ ] Privacy and retention statements match contractual reality.

## Sources

- [OpenAI: Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) — current provider guide on reusable prefixes and diagnostics; supported models and behavior can change.
- [Anthropic: Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — describes automatic caching and explicit breakpoints; inspect current TTL and feature terms.
- [Anthropic: API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) — provider retention documentation; configuration and contractual scope matter.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
