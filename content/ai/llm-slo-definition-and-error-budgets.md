---
title: Defining SLOs and error budgets for LLM-backed services
description: Turn user-visible quality and latency expectations into measurable SLOs and safe operational decisions.
type: pattern
tags:
  - ai
  - reliability
  - observability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Start with the user journey

An LLM endpoint is not reliable merely because its HTTP handler returns 200. Define the service boundary around the outcome users consume: a response arrives within a useful time, meets the task's minimum quality bar, and does not violate the application's safety or privacy constraints. Identify separate journeys when their latency or failure consequences differ, such as interactive chat, asynchronous document processing, and agent tool execution. An asynchronous job can tolerate a longer completion window but still needs a clear deadline and a visible failure state.

Write the service-level objective (SLO) as a target over a fixed rolling window, with a precise eligible-event denominator. For an interactive answer, one event might be a user request that passes local input validation and is accepted for processing. Exclude only conditions outside the service promise, such as an explicitly rejected malformed request; do not exclude provider timeouts, throttling, application exceptions, empty completions, or safety refusals that the product expected to answer. If refusals are correct behavior for a request class, measure them separately rather than hiding them in either success or failure.

## Use multiple indicators

Build a small SLI set that explains user experience. A request success SLI can combine successful completion, a deadline, and a minimum output-validity condition. Track latency percentiles and time-to-first-token separately from full completion time; streaming can feel responsive while still timing out before a useful answer is complete. Measure provider errors, local errors, output-schema failures, policy failures, and fallback usage as separate diagnostic signals. Model quality is a separate SLI: evaluate representative outcomes with a fixed human-reviewed or deterministic rubric, not a raw count of tokens or HTTP codes.

Avoid asserting that every model response is correct. SLOs describe a measurable service promise and its acceptable failure rate, not a guarantee of semantic correctness. Use offline evaluation and sampled production review to estimate quality trends, and document the evaluation set's limitations. See [[llm-observability-tracing-and-slos]] for signal design, and [[model-version-pinning-and-upgrade-evals]] for release-quality comparisons.

## Choose denominator and window deliberately

Record the request population, aggregation window, and treatment of retries in the SLO definition. Count one logical user request as one event even if the service makes multiple provider attempts; otherwise retry storms can distort apparent availability. Report provider attempts separately. For streamed responses, state whether success means a first token, a complete response, or both. For queued workloads, distinguish accepted jobs from completed jobs and report age of the oldest pending item.

Use a rolling window aligned to the service's risk and release cadence. A long window gives a stable budget but can conceal a sharp recent regression, so pair it with a shorter diagnostic window. Segment dashboards by endpoint, model family, region, and traffic class only where each segment has enough volume to be statistically useful. Low-volume segments should use explicit counts and review rather than noisy percentage alerts.

## Translate budget into decisions

An error budget is the tolerated fraction of bad events implied by the SLO over its window. Agree in advance what happens when burn accelerates: slow or pause risky rollouts, reduce optional expensive work, route to an already evaluated fallback, or page the service owner if the user impact is immediate. Do not use a budget threshold as an automatic excuse to suppress correctness, security, or privacy controls. A budget is consumed by genuine user-impacting failure, including degradations hidden by an alternate model if its quality is lower than the promise.

Build burn-rate alerts from both a fast and a slower window. The fast view catches acute incidents; the slower view catches persistent erosion. Validate thresholds against historical traffic and normal bursts, and ensure alerts name the affected journey, SLI, observed burn, and first diagnostic links. An alert that only says “LLM error rate high” leaves the responder to reconstruct the service promise during an incident.

## Review and checklist

At launch, have the product owner, service owner, and on-call representative agree on:

- The exact eligible request or job population, completion deadline, and error classification.
- A latency objective, a quality or validity indicator, and any safety-specific metric.
- A denominator that counts logical requests rather than retry attempts.
- Dashboard segmentation, low-volume treatment, alert ownership, and runbook links.
- The response to budget burn, including rollout controls and fallback quality expectations.
- A review date and a change process when product behavior or provider contracts change.

Revisit the SLO after a material traffic shift, model migration, new streaming behavior, or change in user expectation. A target that is copied from a generic uptime template is not a service agreement. Record decisions and exclusions in plain language, and preserve raw enough telemetry to explain a bad event without storing user prompts by default. Engineering guidance is not legal advice where user commitments or regulated outcomes are involved.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Implementing SLOs](https://sre.google/workbook/implementing-slos/): SLI/SLO and error-budget operating patterns.
- [Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/): monitoring signals, alert quality, and user-facing service indicators.
- [Google Cloud Well-Architected Framework: Reliability pillar](https://cloud.google.com/architecture/framework/reliability): reliability practices and failure management.
