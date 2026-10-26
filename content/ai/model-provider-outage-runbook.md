---
title: Responding to an LLM provider outage
description: A provider incident procedure for confirming impact, protecting traffic, communicating status, and restoring service safely.
type: runbook
tags:
  - ai
  - runbooks
  - reliability
  - incident-management
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Scope and trigger

Use this runbook when calls to an external or self-hosted model endpoint are failing, timing out, throttled, or returning materially degraded output across a meaningful share of production traffic. A single client-side error is not enough to declare a provider outage. Correlate the model gateway's outcomes with provider status information, your own dependency health, and unaffected traffic. Existing guidance in [[ai-assisted-incident-response]] governs incident roles and evidence; this document focuses on preserving the LLM-backed service.

Signals include a sharp rise in provider 5xx or quota responses, elevated connection and generation latency, incomplete streams, increased gateway timeout counts, a queue-age rise, or an unexpected drop in completed requests. A provider status page is evidence, not a substitute for checking your endpoint, credentials, network path, and rate-limit state. Pin down the time window and impacted model, deployment, region, tenant, and request class before changing routing.

## Triage without amplifying impact

The incident lead should establish severity, name a technical lead and communications owner, and capture a timeline. Check gateway dashboards for per-attempt outcomes, but aggregate to logical user requests for impact. Compare a low-risk health probe with representative traffic; do not replay sensitive production prompts as probes. Validate whether a shared authentication, DNS, egress, certificate, or quota change preceded the symptom. Look for retries that are increasing provider load or exhausting client connection pools.

Record a minimal incident snapshot: start time, affected routes and regions, request volume, success and latency changes, provider response classes, fallback behavior, and user-facing impact. Preserve correlation identifiers and bounded diagnostic metadata. Avoid copying prompts, completions, API keys, or account details into incident chat. Escalate to the provider through the approved support channel with timestamps, request IDs, region, model identifier, and sanitized error samples.

## Stabilize through known options

Consult the service's approved routing policy. If a pre-evaluated alternate model or region is available, compare its health and current capacity before shifting traffic. Use a limited, reversible traffic slice first when the incident permits; observe successful completions, output validity, latency, cost, and any safety-relevant change. A “healthy” endpoint is not sufficient if the alternative produces responses outside the product's accepted quality floor. See [[fallback-model-selection-and-quality-degradation]] for the trade-off and minimum gates.

If no acceptable alternative is ready, preserve correctness over apparent availability. Consider a clear degraded response, bounded queueing for tasks that can wait, or a temporary reduction in nonessential model features, with product approval where behavior changes. Avoid repeatedly resubmitting work that may already have completed upstream. Honor idempotency keys for jobs where supported and make client status visible. Keep admission control and concurrency bounded while dependency health is uncertain.

Do not change multiple routing dimensions at once. Record who approved the shift, the exact traffic cohort, the previous routing configuration, and the rollback condition. A rollback condition can be triggered by a higher error rate, quality regression, an unexpected data-location change, or cost beyond the incident guardrail. A human operator owns the decision to restore the normal route after provider recovery; a transient green status should not automatically send all traffic back.

## Recovery and communication

Confirm recovery using sustained successful requests, normal latency distribution, stable quota behavior, and representative output-validity samples. Watch for delayed queues, duplicated jobs, stale cached answers, and billing spikes before closing the incident. Return traffic in measured steps if the alternative route has accumulated state or a different quota envelope. Keep a rollback path available until the primary route has completed a representative observation period.

Communicate what users may see, which functions are affected, and when the next update will arrive. Distinguish confirmed facts from provider-reported status and internal hypotheses. Avoid promising a recovery time that the team does not control. At resolution, record impact, mitigations, model/region transitions, decisions, and open follow-up items. Feed recurring failure patterns into [[llm-slo-definition-and-error-budgets]] and dependency tests.

## Operator checklist

- Verify incident scope and compare provider, gateway, network, and application signals.
- Appoint incident roles; keep a timestamped record with sanitized evidence.
- Check whether retries, queueing, or concurrency are increasing the blast radius.
- Review approved fallbacks for capacity, quality, data location, and cost.
- Make one reversible change at a time and observe a representative cohort.
- Communicate degraded behavior and next update; do not promise provider recovery.
- Verify stable recovery, account for queued work, and document follow-ups.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html): provider quota behavior and quota scope; values can change.
- [Generative AI on Agent Platform quotas and system limits](https://cloud.google.com/vertex-ai/generative-ai/docs/quotas): provider quota categories; verify current project and region limits.
- [Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/): dependency failure and retry-amplification principles.
