---
title: Retry, timeout, and circuit-breaker policy for LLM calls
description: Bound latency and provider load with explicit deadlines, retry eligibility, and dependency isolation.
type: pattern
tags:
  - ai
  - reliability
  - runbooks
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Begin with a request deadline

Every model operation should have an end-to-end deadline derived from the user journey, not an arbitrary client default. Allocate portions of that deadline to queueing, connection setup, generation, tools, and response delivery. The total must fit within the caller's deadline and product latency objective. A streaming request needs separate limits for time to first token and time between chunks, plus a maximum total duration. A timeout must cancel or stop downstream work where supported; otherwise abandoned requests may continue consuming capacity and cost.

Use distinct connect and response timeouts when the client allows it. Keep the values configurable by workload class because short interactive answers and long document analysis have different latency distributions. Derive values from observed tail latency and test under load. A timeout that is too short creates avoidable retries; one that is too long pins concurrency and delays useful failure.

## Classify retry eligibility

Retry only transient failures that are safe to repeat and have a reasonable chance of recovery. Candidate conditions may include a connection reset before request acceptance, a documented transient server error, or a quota response with a retry hint. Confirm the current provider's semantics; status codes and headers are not universal guarantees. Do not retry invalid requests, authentication and permission failures, policy refusals, unsupported models, or deterministic application errors.

Use a small, explicit attempt budget and an overall deadline. Apply exponential backoff with jitter and honor provider retry guidance where available, while ensuring the delay cannot exceed the request deadline. Add a concurrency limit for retries so a broad outage does not multiply load. Track one logical request separately from each provider attempt. A timeout after request submission may be ambiguous: the provider could have completed work even though the client did not receive it. Avoid retrying non-idempotent workflows unless duplicate work and charges are acceptable or an idempotency mechanism is documented.

For streaming, establish whether the client has received partial output. Replaying a partially delivered response can produce duplicate or contradictory content. Stop retrying after user-visible output unless the protocol supports a safe resume. Instead, close with a clear partial-result status or offer a new request under explicit product behavior.

## Use circuit breakers carefully

A circuit breaker can prevent repeated calls to an unhealthy dependency. Define its scope (provider, model, region, or endpoint), the rolling failure signal, open duration, and limited half-open probe behavior. Exclude caller errors and policy refusals from dependency failure counts. Keep enough separation that an isolated model failure does not block healthy workloads. A breaker should never be the only safety control; add admission limits and bounded queues.

Avoid synchronized reset storms. Jitter probe timing or use a controlled canary, and ensure only a bounded number of probes run at once. A provider can recover gradually, so a single successful health probe should not necessarily route all production traffic back. Track open/half-open/closed state, transitions, the triggering signal, and the volume affected. Alert on a breaker that stays open beyond its expected recovery window, but avoid paging for every expected transition during an incident.

## Configure and observe

Centralize retry and timeout policy in the model gateway where practical, while allowing task-specific deadlines with reviewed limits. Make defaults visible and record changes. Expose metrics for logical request outcomes, attempts per request, retry delay, timeout phase, cancellation result, breaker state, queue time, and provider error class. Keep labels bounded; never use prompt text or a raw customer identifier as a metric dimension.

Load-test transient failures, slow responses, partial streams, quota pressure, and breaker recovery. Confirm that the system does not exceed its request deadline, retry budget, or cost ceiling. Compare attempted and successful work, because an apparent recovery in success rate can conceal a large increase in duplicate attempts. See [[model-provider-outage-runbook]] for incident response and [[llm-slo-definition-and-error-budgets]] for service objectives.

## Checklist

- One total deadline includes queueing, retries, tools, and delivery.
- Retry only eligible transient failures, with bounded attempts and jitter.
- Respect documented provider hints and verify current semantics.
- Treat post-submit timeout and partial-stream cases as ambiguous.
- Scope breakers narrowly and use bounded, staged recovery probes.
- Monitor attempt amplification and cost as well as logical success.
- Test slow, failed, partially delivered, and recovering dependencies.

The policy must be reviewed when provider behavior, client libraries, or streaming contracts change. Do not use retries to conceal persistent capacity or quality failures. See [[llm-observability-tracing-and-slos]] for instrumentation of model and tool calls.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/): timeout selection and retry-amplification patterns.
- [Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html): provider quota dimensions; retry behavior and limits can change.
- [OpenTelemetry Trace API](https://opentelemetry.io/docs/specs/otel/trace/api/): trace context for representing logical operations and attempts.
