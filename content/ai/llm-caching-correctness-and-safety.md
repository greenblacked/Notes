---
title: Correctness and safety for LLM caching
description: Cache model work only when the key, scope, freshness, and privacy behavior preserve the original request's meaning.
type: pattern
tags:
  - ai
  - reliability
  - security
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Choose the cache boundary

Caching can reduce latency and repeated inference cost, but it changes the semantics of a request. Distinguish provider-managed prompt-prefix caching from an application cache of complete outputs. A provider cache reuses eligible internal context according to provider rules; it does not mean an answer is safe to reuse for another user. An application response cache stores an output and needs an explicit correctness, privacy, and invalidation design.

Cache only operations whose output is stable enough for reuse. A deterministic transformation over public, versioned inputs is a better candidate than a personalized recommendation, live operational decision, or response dependent on current account permissions. For each candidate, state the acceptable staleness, whether exact replay is safe, and what event invalidates the entry. If the team cannot identify the complete set of output-affecting inputs, it cannot build a reliable key.

## Build a complete, scoped key

An application key should represent every factor that can change an answer: normalized request, model and pinned revision, system and user prompt versions, tool definitions, retrieval corpus or document versions, locale, safety policy, sampling parameters, and output schema. Include tenant and authorization scope where results can differ by user or organization. Avoid placing raw sensitive text in a cache key that may appear in logs or diagnostics; use a keyed digest with a documented rotation strategy if a content-derived key is required. Hashing does not make the cached value anonymous.

Never let a cache hit bypass current authentication, authorization, policy checks, or data-access controls. Revalidate access at retrieval time. Do not share a result across tenants merely because the prompt text matches. If policy or model version changes, old entries must not be treated as current by default. A cache should fail closed to recomputation when key construction, authorization scope, or freshness metadata is missing.

## Freshness and invalidation

Assign a time-to-live based on the underlying data's update interval and the harm of stale output. A short TTL alone is not sufficient for sensitive data: define event-based invalidation for document updates, permission changes, account closure, policy revision, and model migration. For retrieval-grounded answers, key or validate against the corpus snapshot and document versions. Record source versions with the cache entry so a hit can be explained later.

Use bounded cache size and an eviction policy appropriate to the data classification. Define what happens during cache backend unavailability: bypassing to the model may increase spend and latency, so enforce concurrency and budget guardrails rather than allowing a burst to overwhelm the provider. Conversely, stale-cache fallback should only be allowed for a task where stale content is explicitly acceptable. Make the degraded behavior observable and user-visible when it affects the answer.

Provider prompt-cache semantics and prices are product-specific and can change. Treat them as an optimization, not a correctness guarantee. Validate eligibility, minimum prefix behavior, retention controls, and regional processing in the provider's current documentation. Do not assume cached prompt context means the provider retains no data or that the content is isolated by your application tenant.

## Validate cache behavior

Test both cache misses and hits using paired requests where one factor changes at a time: tenant, access role, locale, prompt revision, retrieval version, tool schema, safety policy, and model revision. Assert that incompatible inputs do not hit the same entry. Test permission changes between fill and read, invalidation delays, concurrent fills, and cache backend outages. Inspect cache keys, values, telemetry, and error paths for prompt leakage.

Measure hit rate alongside correctness, staleness, tenant isolation, latency, and realized savings. A high hit rate is not a success metric by itself. Track cache-hit output validation and sampled user outcomes at the same standard as generated responses. Keep a kill switch as a controlled operational capability, with owner, audit trail, and an explicit cost/latency impact estimate; do not silently change cache scope during an incident.

## Checklist

- Document the eligible operation and why reuse preserves meaning.
- Include model, prompt, tools, policy, data version, and tenant scope in identity.
- Revalidate authorization on every read and use event-driven invalidation where possible.
- Choose TTL and stale behavior from risk, not convenience.
- Bound backend failure behavior and expected fallback spend.
- Test key separation, invalidation, permission changes, and privacy leakage.
- Review provider caching terms and current product behavior before enabling it.

Do not place personal or confidential values into a broadly accessible cache without the data owner's approval. Engineering guidance is not legal advice; privacy and contractual requirements need review by the appropriate owner. See [[redacting-sensitive-data-before-llm-calls]] for upstream data handling.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Prompt caching](https://platform.openai.com/docs/guides/prompt-caching): OpenAI's provider-managed prompt-cache behavior; details may change.
- [Context caching overview](https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview): Google Cloud context-cache concepts and lifecycle.
- [Prompt caching for faster model inference - Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html): Amazon Bedrock provider-specific caching behavior.
