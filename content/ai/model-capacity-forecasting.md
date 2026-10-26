---
title: Forecasting capacity for LLM workloads
description: Forecast request, token, concurrency, and quota demand against latency goals before traffic outgrows provider capacity.
type: pattern
tags:
  - ai
  - reliability
  - cost
  - observability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Forecast the actual workload

Capacity planning for inference is not a single requests-per-second number. Collect request rate by workload class, prompt-size distribution, output tokens, generation duration, concurrency, streaming behavior, retries, region, and model. Include scheduled evaluation and batch traffic, not only end-user calls. If a service uses tools or multiple model steps, model the total attempts per logical request and the shape of the peak, rather than dividing total monthly tokens by seconds in a month.

Build forecasts from measured traffic and explicit product assumptions. Include baseline, expected growth, a realistic peak, and a stress case. Note what drives each scenario: launch adoption, seasonal peaks, backfill, agent-loop frequency, or a model change that alters token use. Keep request counts and token volumes separate. A lower-throughput model can still exceed token or output capacity if generations are longer.

## Translate demand into constraints

Provider quota units differ by service, model, region, and account, and can be revised. Before launch, check current official quota documentation and the actual project or account limits. Confirm whether the relevant limit applies to requests, tokens, concurrent jobs, provisioned throughput, or a combination. Record the date of the check and leave a safety margin. A documentation page is not proof that your account has been granted a particular limit.

Estimate sustained and burst demand per region and model. For a rough concurrency view, relate request arrival rate to average service time, then check tail latency and output length; the average is not a capacity guarantee. Load tests should reproduce the model's prompt and generation distribution, not send tiny fixed prompts. Measure queue time, time to first token, completion latency, throttling, timeout rate, and output quality. Use bounded synthetic data, and coordinate provider-side load tests where required.

Plan for shared dependencies too: network connection pools, gateway CPU, telemetry export, retrieval stores, tool services, and rate-limit stores. A model quota can be sufficient while the gateway saturates or trace export backpressure blocks requests. Set admission limits and queue deadlines so demand above known capacity degrades deliberately rather than accumulating indefinitely.

## Capacity decisions

For each workload, define its priority, latency target, maximum queue age, and acceptable degradation. Interactive flows may need immediate admission control; offline work may wait in a bounded queue. Reserve capacity for critical journeys, but ensure allocation cannot strand capacity indefinitely when that journey is idle. If providers offer reservation or provisioned capacity options, compare the current contractual unit economics and failover limitations rather than assuming reserved capacity guarantees uninterrupted service.

When forecast demand approaches a quota or tested saturation point, choose among raising a quota through the provider's documented process, scheduling batch work, smoothing bursts, reducing unnecessary context, selecting an already-evaluated model, or limiting launch scope. Each option has quality and cost consequences. Avoid depending on a best-effort quota increase during an outage. See [[fallback-model-selection-and-quality-degradation]] for fallback bounds, [[llm-slo-definition-and-error-budgets]] for user-facing objectives, and [[self-hosted-llm-inference-on-gke]] for capacity considerations in a self-hosted deployment.

Define a headroom trigger with a named owner and a lead time before the expected demand arrives. A trigger should include projected peak utilization, observed throttling, and confidence range. Reforecast after material product launches, model changes, provider quota changes, or a sustained shift in request duration. Track forecast error and record whether errors were caused by traffic assumptions or provider behavior.

## Operational checklist

- Segment traffic and tokens by task, model, region, and interactive/batch class.
- Include retries, multi-step workflows, long-output tails, and non-model dependencies.
- Verify effective account limits and pricing in current provider sources.
- Load test representative payloads with safety margins and bounded concurrency.
- Define admission, queue, and priority behavior when forecast capacity is exceeded.
- Assign an owner and lead time to each headroom trigger.
- Reforecast after product, model, quota, or latency-distribution changes.

Do not use production customer content in load tests unless it has been approved and transformed under the data policy. Estimates are uncertain; document assumptions instead of presenting a single precise capacity number. Capacity plans support operational decisions, not provider guarantees.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Generative AI on Agent Platform quotas and system limits](https://cloud.google.com/vertex-ai/generative-ai/docs/quotas): quota dimensions; verify effective limits for the project and region.
- [Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html): provider quota scopes and limits, which are subject to change.
- [Google Cloud Well-Architected Framework: Reliability pillar](https://cloud.google.com/architecture/framework/reliability): capacity, resilience, and operational planning principles.
