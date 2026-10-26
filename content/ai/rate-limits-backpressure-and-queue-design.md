---
title: Rate limits, backpressure, and queue design
description: Protect inference services from overload with explicit quotas, admission control, bounded queues, and retry behavior that does not amplify demand.
type: guide
tags:
  - ai
  - reliability
  - kubernetes
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Separate quota from capacity

A provider's rate limit constrains requests or tokens under provider-defined dimensions. A local serving system's capacity is constrained by compute, memory, queueing, and latency. Application quotas express what a tenant or service is allowed to consume. These are related but not interchangeable: a provider may accept the request while the local service is overloaded, or a healthy local replica may be unable to call a provider because an account quota is exhausted.

Document each limit's scope, units, reset behavior, and source. Provider details change and may depend on model, account tier, region, endpoint, or shared organization usage. Read the current provider documentation and response headers rather than hard-coding a claimed universal number. Separate model-specific quotas from global concurrency or spend budgets.

For local inference, use a gateway or admission layer to assign per-class and per-tenant budgets before work enters an expensive queue. The cost-control mechanisms in [[llm-api-cost-control|LLM API cost control]] complement—not replace—queue protection.

## Backpressure before saturation

Backpressure communicates that downstream capacity is constrained so upstream systems slow, reject, or defer new work. Enforce it as close as practical to the boundary where demand becomes expensive. Bound both queue size and maximum wait. A queue without a finite age can return stale answers and consume capacity long after the caller has given up.

Choose queue semantics by workload. Interactive generation usually needs prompt rejection or short bounded waiting; batch processing can use durable jobs and delayed execution. Track estimated work such as tokens, modality size, or expected service time if request count is a poor proxy and the system supports reliable estimates. Do not make fairness depend on untrusted client estimates.

Define overload responses and retry instructions. A caller should distinguish permanent validation failure, quota exhaustion, local queue rejection, provider throttling, and transient infrastructure failure. Return a retry delay only when it is meaningful and supported; clients should add jitter and cap both attempts and total elapsed time. Multiple retrying layers can multiply traffic exponentially, so assign retry ownership.

## Token and concurrency budgets

Request-rate limits alone may treat a tiny prompt and a long context as equal. Add input and output token caps, concurrent request limits, or work-unit quotas as appropriate. Reserve separate capacity for critical classes if the business requires it; ensure lower classes cannot consume all memory or queue slots. Fairness schemes such as weighted queues introduce complexity and should be tested under mixed traffic.

For streaming requests, hold the concurrency slot until completion or confirmed cancellation. A client disconnect that does not cancel upstream work may continue consuming quota and cache. For asynchronous jobs, distinguish accepted work from completed work and make submission idempotent, so retries do not enqueue duplicates.

Provider-specific throttling can return headers, status codes, or retry guidance. Implement against the provider's current documented API and preserve those semantics through the gateway. Do not translate every 429 into an immediate retry or expose provider-specific details that confuse callers.

## Failure modes and operations

- **Queue growth:** backlog exceeds future spare capacity; shed, defer, or reject before the age objective is breached.
- **Quota exhaustion:** provider refuses otherwise valid calls; alert on remaining headroom and coordinate quota requests through documented channels.
- **Retry amplification:** retrying at client, gateway, and SDK; choose one owner, bounded attempts, backoff, jitter, and deadline.
- **Noisy neighbor:** one tenant fills shared queues; isolate quotas and monitor per-tenant fairness without unbounded labels.
- **Stale work:** a request waits past its useful deadline; expire it and record the reason.
- **False scaling signal:** request count is low but token workload is high; autoscale using workload-correlated signals and guardrails.

## Checklist

- Inventory provider quotas, local resource limits, and application budgets as separate controls.
- Record units, scope, model/region applicability, reset behavior, and date checked for provider limits.
- Enforce request, token, concurrency, queue-depth, and queue-age bounds where applicable.
- Preserve deadlines and make overload outcomes consistent across API and streaming modes.
- Ensure retries are bounded across all layers; use idempotency for asynchronous submission.
- Alert on queue age, rejection, throttling, quota headroom, and sustained utilization.
- Load-test mixed tenants and burst scenarios; verify fairness and recovery after a burst.

The tradeoff is between rejecting work early and allowing a queue to absorb short variability. A bounded queue can smooth transient bursts; an unbounded queue transfers overload into user-visible latency, memory pressure, and delayed recovery. Set limits to match the service objective, not to hide inadequate capacity.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Rate limits | OpenAI API](https://developers.openai.com/api/docs/guides/rate-limits): OpenAI-specific rate limits and handling guidance; values depend on account and model.
- [Rate limits - Claude Platform Docs](https://platform.claude.com/docs/en/api/rate-limits): Anthropic rate-limit documentation; check current scope and response behavior.
- [Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html): Amazon Bedrock quotas; service quotas are provider- and region-specific.
- [Horizontal Pod Autoscaling | Kubernetes](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/): Kubernetes scaling inputs; HPA alone does not implement queue backpressure.
