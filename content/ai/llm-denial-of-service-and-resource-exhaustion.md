---
title: Denial of service and resource exhaustion in LLM systems
description: Bound model, tool, retrieval, and infrastructure consumption to keep AI services available and costs predictable under hostile or accidental load.
type: guide
tags:
  - ai
  - security
  - reliability
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

LLM workloads can consume resources through large inputs, retries, expensive retrieval, long tool chains, parallel branches, or unbounded output. Causes range from abusive traffic to provider failure or a reasonable task that triggers a loop. Outcomes include outage, queue starvation, runaway spend, or shared-infrastructure pressure. This note narrows [[ai/llm-api-cost-control]] to availability controls across the request path.

## Map consumption across the request

Measure and cap upload size, parsing time, retrieval breadth, context/output tokens, tool calls, retries, parallelism, duration, and downstream work. A small request may expand into many retrieved chunks or agent steps. Identify shared provider, database, vector, worker, browser, and tool-service bottlenecks.

Define cost and availability budgets by tenant, user, workflow, and service. The budget should include retries and background work, not just the first model call. Make the maximum possible spend and concurrency calculable from policy where possible. Avoid a single global quota that allows one tenant or one automated workflow to exhaust the service for everyone else. Keep administrative and incident-response paths available under load.

## Enforce limits at multiple layers

Apply request admission controls before expensive processing: authentication, per-principal rate limits, payload and file-size caps, concurrency limits, queue depth limits, and deadlines. Reject work that cannot finish within its budget. Limit context assembly, output tokens, retrieval count, tool calls, recursion depth, and parallel branches in the orchestrator. Give every child task a budget drawn from the parent budget rather than creating independent unlimited budgets.

Use bounded retries with jitter and distinguish transient errors from permanent denial, invalid requests, quota exhaustion, and provider overload. A retry should not multiply an operation with side effects; use idempotency or reconciliation. Apply circuit breakers or backpressure when a dependency is degraded. Fail with a clear, retryable or non-retryable state rather than allowing the agent to repeatedly reinterpret an error and try again.

Keep separate limits for model spend, compute, storage, and external services. Provider quotas and rate limits change and may be enforced differently by model, project, region, and account. Check current provider documentation and account settings. Do not treat a provider quota as a complete application-level budget; a workflow might still flood your own tool endpoints or incur costs across multiple providers.

## Protect against amplification

An agent can amplify a small input by repeatedly searching, calling tools, or spawning work. Require explicit caps for depth, steps, concurrency, and elapsed time, and have the scheduler enforce them even if the model requests more. Do not permit tool output to reset or enlarge the budget. If a model call times out, determine whether the provider may still be processing it before resubmitting. Deduplicate equivalent jobs where safe and cache only when authorization, data freshness, and privacy permit.

Treat content parsing, OCR, embedding, and conversion as resource-consuming operations with their own limits. Reject archive bombs, extreme page counts, oversized dimensions, pathological metadata, and unsupported inputs using safe parsers and isolated workers. A content type label or extension is not proof that a file is cheap to process. If processing fails, avoid automatic retries without a retry budget.

## Observe saturation and cost

Track request volume, queue age, active work, token usage, tool-call counts, retries, throttling, provider errors, latency, cancellations, and cost by workflow and tenant. Use privacy-preserving aggregation and avoid logging raw prompts simply to explain a cost spike. Alert on departures from known baselines, sudden fan-out, repeated retries, and exhausted budgets. Distinguish a denial from a service error to avoid hiding abuse as ordinary failures.

OpenTelemetry’s GenAI semantic conventions have moved to the dedicated repository at [semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai); the older OpenTelemetry documentation page is no longer maintained. Treat these conventions as evolving and avoid depending on experimental or vendor-specific attributes without checking current definitions. Use traces to follow one request across retrieval and tools, but redact secrets and sensitive prompt content. General AI observability is also discussed in [[ai/llm-observability-tracing-and-slos]].

## Degrade safely and recover

Define service behavior when budgets are exhausted: queue, reject, return a partial answer, or offer a lower-cost path. Degradation must not silently bypass authorization or safety review. Reserve capacity for control-plane operations, tenant isolation, and incident response. A manual kill switch should target the affected workflow or tenant rather than disabling every AI feature by default, unless broader containment is necessary.

Test load and failure behavior in a controlled environment with synthetic requests. Measure resource use under the expected maximum input and a bounded fan-out case. Verify that cancellation reaches active tools, retries stop at the configured ceiling, and queues shed load predictably. Do not conduct denial testing against shared provider infrastructure or third-party services without explicit authorization. NIST’s risk-management framework supports evaluating reliability and impacts, while OWASP’s LLM risk taxonomy provides a useful application-security vocabulary.

## Review checklist

- Are limits defined for every expensive stage, including fan-out and retries?
- Is resource use budgeted per tenant and workflow, not only globally?
- Can the scheduler enforce a parent budget across child tasks and tools?
- Are timeouts, cancellation, idempotency, backpressure, and circuit breaking tested?
- Are parsing and media conversion bounded and isolated?
- Are metrics useful without exposing sensitive prompts or identifiers?
- Are provider quotas checked but not mistaken for full application budgets?
- Is there a safe degradation and targeted containment path?

## Sources

- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/): includes unbounded consumption as an application risk; consult the published current taxonomy.
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): agent-specific risks from autonomy, tools, and cascading work.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework): AI RMF 1.0 overview; NIST says the framework is under revision as of 2026-10-26.
- [OpenTelemetry GenAI semantic conventions repository](https://github.com/open-telemetry/semantic-conventions-genai): maintained location for evolving GenAI telemetry conventions.
- [Owner’s AI skills catalogue](https://ai.szolotov.com): reusable AI skills and workflows.
