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
modified: 2026-11-24
draft: false
---

## Scope and trigger

Use this runbook when calls to an external or self-hosted model endpoint are failing, timing out, throttled, or returning materially degraded output across a meaningful share of production traffic. A single client-side error is not enough to declare a provider outage. Correlate the model gateway's outcomes with provider status information, your own dependency health, and unaffected traffic. Existing guidance in [[ai-assisted-incident-response]] governs incident roles and evidence; this document focuses on preserving the LLM-backed service.

Signals include a sharp rise in provider 5xx or quota responses, elevated connection and generation latency, incomplete streams, increased gateway timeout counts, a queue-age rise, or an unexpected drop in completed requests. A provider status page is evidence, not a substitute for checking your endpoint, credentials, network path, and rate-limit state. Pin down the time window and impacted model, deployment, region, tenant, and request class before changing routing.

## Signals and thresholds

The queries use the gateway metrics defined in [[llm-observability-tracing-and-slos]]. The thresholds are starting points; set yours from a month of normal traffic.

| Signal                  | Query (below)         | Start this runbook when                                              |
| ----------------------- | --------------------- | -------------------------------------------------------------------- |
| Provider attempt errors | `attempt_error_ratio` | Above 5% for 10 minutes on one model                                 |
| Throttling              | `throttled_attempts`  | Well above the model's normal rate while your request volume is flat |
| Failed user requests    | `request_error_ratio` | The route's SLO burn-rate alert fires                                |
| Latency                 | `p95_latency`         | p95 above twice the value at the same time last week                 |

```text title="Gateway queries (PromQL)"
# attempt_error_ratio: share of upstream attempts that failed, per model
sum by (model) (rate(llm_gateway_attempts_total{result=~"5xx|timeout"}[5m]))
  / sum by (model) (rate(llm_gateway_attempts_total[5m]))

# throttled_attempts: provider 429s per second, per model
sum by (model) (rate(llm_gateway_attempts_total{result="429"}[5m]))

# request_error_ratio: share of logical user requests that failed, per route
sum by (route) (rate(llm_gateway_requests_total{outcome=~"error|timeout|rate_limited"}[5m]))
  / sum by (route) (rate(llm_gateway_requests_total[5m]))

# p95_latency: per model
histogram_quantile(0.95, sum by (le, model) (rate(llm_gateway_request_duration_seconds_bucket[5m])))
```

If attempts fail but logical requests still succeed, retries are absorbing the fault; watch that the retries are not adding load ([[timeouts-retries-load-shedding]]).

## Decision owners

| Decision                                                       | Owner                                  | Recorded where                                    |
| -------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| Declare a provider outage and severity                         | Incident lead                          | Incident record                                   |
| Shift traffic to an approved fallback                          | Technical lead, with the service owner | Incident record, with the previous routing config |
| Change user-facing behaviour (degraded mode, disabled feature) | Product owner for the service          | Incident record                                   |
| Raise a provider support case                                  | Technical lead                         | Incident record, with the case ID                 |
| Return traffic to the primary route                            | Technical lead                         | Incident record, with the observation window      |

## Triage without amplifying impact

The incident lead should establish severity, name a technical lead and communications owner, and capture a timeline. Check gateway dashboards for per-attempt outcomes, but aggregate to logical user requests for impact. Compare a low-risk health probe with representative traffic; do not replay sensitive production prompts as probes. Validate whether a shared authentication, DNS, egress, certificate, or quota change preceded the symptom. Look for retries that are increasing provider load or exhausting client connection pools.

Record a minimal incident snapshot: start time, affected routes and regions, request volume, success and latency changes, provider response classes, fallback behavior, and user-facing impact. Preserve correlation identifiers and bounded diagnostic metadata. Avoid copying prompts, completions, API keys, or account details into incident chat. Escalate to the provider through the approved support channel with timestamps, request IDs, region, model identifier, and sanitized error samples.

## Stabilize through known options

Consult the service's approved routing policy. If a pre-evaluated alternate model or region is available, compare its health and current capacity before shifting traffic. Use a limited, reversible traffic slice first when the incident permits; observe successful completions, output validity, latency, cost, and any safety-relevant change. A “healthy” endpoint is not sufficient if the alternative produces responses outside the product's accepted quality floor. See [[fallback-model-selection-and-quality-degradation]] for the trade-off and minimum gates.

If no acceptable alternative is ready, preserve correctness over apparent availability. Consider a clear degraded response, bounded queueing for tasks that can wait, or a temporary reduction in nonessential model features, with product approval where behavior changes. Avoid repeatedly resubmitting work that may already have completed upstream. Honor idempotency keys for jobs where supported and make client status visible. Keep admission control and concurrency bounded while dependency health is uncertain.

Do not change multiple routing dimensions at once. Record who approved the shift, the exact traffic cohort, the previous routing configuration, and the rollback condition. A rollback condition can be triggered by a higher error rate, quality regression, an unexpected data-location change, or cost beyond the incident guardrail. A human operator owns the decision to restore the normal route after provider recovery; a transient green status should not automatically send all traffic back.

Routing changes go through the router configuration in [[model-router-policy]] and the failover paths in [[model-provider-failover-and-routing]]. Before shifting traffic, save the current routing configuration to the incident record; it is the rollback.

## Recovery and communication

Confirm recovery using sustained successful requests, normal latency distribution, stable quota behavior, and representative output-validity samples. Watch for delayed queues, duplicated jobs, stale cached answers, and billing spikes before closing the incident. Return traffic in measured steps if the alternative route has accumulated state or a different quota envelope. Keep a rollback path available until the primary route has completed a representative observation period.

Communicate what users may see, which functions are affected, and when the next update will arrive. Distinguish confirmed facts from provider-reported status and internal hypotheses. Avoid promising a recovery time that the team does not control. At resolution, record impact, mitigations, model/region transitions, decisions, and open follow-up items. Feed recurring failure patterns into [[llm-slo-definition-and-error-budgets]] and dependency tests.

**Rollback check.** After restoring the saved routing configuration, `request_error_ratio` and `p95_latency` for the route return to their pre-incident values within one observation window, and `attempt_error_ratio` for the fallback model drops to zero traffic. If not, the restore did not take; compare the live router configuration with the saved one.

## Operator checklist

- Verify incident scope and compare provider, gateway, network, and application signals.
- Appoint incident roles; keep a timestamped record with sanitized evidence.
- Check whether retries, queueing, or concurrency are increasing the blast radius.
- Review approved fallbacks for capacity, quality, data location, and cost.
- Make one reversible change at a time and observe a representative cohort.
- Communicate degraded behavior and next update; do not promise provider recovery.
- Verify stable recovery, account for queued work, and document follow-ups.

## Evidence

Unrated. The procedure is operating practice and has not been run. The checks below were made on 2026-11-02. Scope: the procedure's factual claims were searched for in the local primary sources; the runbook is almost entirely operating practice, and the provider-specific claims could not be reached.

### Sources checked

- The linked notes [[ai-assisted-incident-response]], [[fallback-model-selection-and-quality-degradation]] and [[llm-slo-definition-and-error-budgets]] exist on this site and are the targets of the references in the text. Read 2026-11-02.
- Confirmed: the [OpenTelemetry GenAI semantic conventions, gen-ai-spans.md](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/gen-ai/gen-ai-spans.md) (checked 2026-11-02 against open-telemetry/semantic-conventions-genai commit 244465e) define a GenAI span as a logical operation as observed by the caller, covering the duration of the operation with all automatic retries. This supports the distinction in the triage section between per-attempt outcomes and logical user requests. Time-to-first-chunk is likewise measured from before the first attempt and includes failed attempts and retry backoff (client-inference.md in the same directory).
- Searched, with no claim confirmed or contradicted, for provider outages, quota responses, idempotency keys and retry amplification: the [Kubernetes docs](https://kubernetes.io/docs/) (checked 2026-11-02 against kubernetes/website commit 491f14e), the [Prometheus docs](https://prometheus.io/docs/) (checked 2026-11-02 against prometheus/prometheus commit ef78ff6) and the vLLM docs (checked 2026-11-02 against vllm-project/vllm commit 8530a77). None states or contradicts a claim in this note, so nothing was corrected.

### Not verified

- The three entries under Sources (two provider quota pages and one article on timeouts, retries and backoff) are vendor websites that were not reachable. The statements about provider quota behaviour, quota scope and retry amplification attributed to them are unchecked. Their stated page titles, URLs and descriptions are unchecked as well.
- Whether any given provider supports idempotency keys, and how provider status pages and quota responses behave; the text only says "where supported".
- The incident process (roles, snapshot contents, communication cadence, rollback conditions, operator checklist) is general engineering guidance, not a documented claim.
- The PromQL queries and thresholds were not run; the metric names come from this site's gateway design, not a product.
- Nothing was run.

### Environment

An external or self-hosted model endpoint reached through a model gateway, with dashboards for per-attempt outcomes, a routing policy, and an incident channel. No versions were recorded because nothing was run.

### Prerequisites

Authority to change routing, an approved fallback policy, access to gateway and provider dashboards, and an incident record. See the Scope and trigger and Stabilize through known options sections.

### Expected results

Traffic is served by the primary or an approved alternate route with success rate and latency back near normal, quality samples valid, and queued work accounted for. See the Recovery and communication section.

### Failure conditions

Error rate or latency rises after a routing change, output quality falls below the accepted floor, data location or cost leaves the guardrail, or duplicated jobs appear. See the rollback conditions in Stabilize through known options.

### Cleanup and rollback

Restore the recorded previous routing configuration, return traffic in measured steps, and keep the rollback path until the primary route has had a representative observation period. See Recovery and communication.

## Sources

- [Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html): provider quota behaviour and scope; values can change.
- [Generative AI on Agent Platform quotas and system limits](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/quotas): provider quota categories; verify current project and region limits. The old Vertex AI quotas URL is reported to redirect here (not re-read for this revision).
- [Timeouts, retries, and backoff with jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/): dependency failure and retry-amplification principles.
