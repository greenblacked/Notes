---
title: Inference batching and queueing
description: Balance accelerator-efficient batching against queue delay using bounded queues, explicit admission policy, and workload-aware latency objectives.
type: guide
tags:
  - ai
  - kubernetes
  - reliability
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Two different kinds of batching

Batching combines work to improve hardware efficiency, but the mechanism differs by serving engine. Offline inference can form larger batches before execution because the caller tolerates delayed completion. Interactive autoregressive serving must schedule sequences whose prompts and outputs have different lengths and progress at different rates. Continuous or iteration-level batching can admit new sequences between decode steps; a static batch that waits for every request to finish may waste capacity when outputs vary.

Batching is not free. The system waits for eligible work, allocates more memory, and can increase the time a request spends queued. A throughput gain is useful only if the resulting completion and streaming latencies still meet the workload's objective. Keep separate service classes if interactive generation and bulk embedding or summarization have incompatible deadlines.

The serving engine's scheduler details are provider- and version-specific. NVIDIA Triton documents dynamic batching for compatible stateless models, while token-generation engines have their own scheduling policies. Do not transfer a batch-size or delay parameter from one engine to another. For capacity assumptions beyond scheduling, see [[llm-inference-capacity-planning|LLM inference capacity planning]].

## Bound the queue deliberately

A queue absorbs short bursts; it does not create compute. If incoming work exceeds service capacity for long enough, queue depth and wait time grow without bound unless admission is limited. Choose a maximum queue age and size based on the request's deadline and memory cost. A count-only limit can be misleading if one queued request contains a very long prompt; token-based or estimated-work limits may better reflect resource use, when the server supports them.

Admission policy should specify what happens at the boundary: reject quickly with a retriable response, shed a lower-priority class, or defer asynchronous work to a durable job system. Make overload observable and predictable. Hidden queueing in several layers—client, gateway, application, and inference server—makes end-to-end deadlines difficult to enforce. Prefer one clearly owned admission point and propagate deadlines to downstream work.

Clients should use bounded retries with jitter and respect retry signals where the API provides them. Retrying queue-full or timeout responses immediately can multiply demand precisely when the server has least spare capacity. Distinguish retryable transport failures from permanent validation errors and from a request that may have completed but whose response was lost.

## Tune with a response-time budget

Set a budget for the components that compose request latency: queue wait, prefill, first-token delivery, decode, and response transfer. For streaming, also set an inter-token responsiveness objective; an acceptable first token does not guarantee a usable stream. Set a separate deadline for offline jobs. Measure distributions by request class and input/output length.

Run a controlled sweep of batch delay, maximum batch work, concurrency, and admission limits using representative traffic. For each point, collect throughput, time to first token, inter-token delay, full completion time, queue depth, cancellations, cache pressure, and errors. A setting is not an improvement if throughput rises while p95 or p99 latency violates the service objective. Test low-load behavior too: an aggressive wait window may be visible as avoidable first-token delay when traffic is sparse.

Some runtimes apply dynamic batching automatically or schedule token iterations across sequences. Verify the exact semantics in the deployed release and the model's compatibility. Avoid assuming that increasing a configured batch maximum forces that batch to fill or yields linear throughput gains.

## Failure modes and tradeoffs

- **Head-of-line delay:** a large or slow request holds a shared queue. Separate classes, cap request size, or use deadline-aware admission.
- **Queue avalanche:** backlog remains after a burst and new arrivals extend it. Shed work or pause admission before recovery becomes impossible.
- **Batch fragmentation:** incompatible shapes or model routes prevent requests from combining. Align routing and workloads only where isolation and latency allow.
- **Memory exhaustion:** larger batches increase activation or cache pressure. Reserve memory headroom and observe OOM events.
- **Retry amplification:** clients replay accepted work after uncertain failures. Use idempotency keys for job submission and bounded retry policies.
- **Cancellation waste:** disconnected clients continue consuming resources. Propagate cancellation where the runtime supports it, and measure cancellation timing.

## Operator checklist

- Define latency and completion objectives by workload class and request-size band.
- Bound both queue age and resource-weighted demand; document overload behavior.
- Verify one admission owner, deadline propagation, and retry/backoff semantics.
- Benchmark batch policies under sparse, steady, bursty, and overloaded arrivals.
- Alert on queue growth and rejection rate before latency objectives fail.
- Review batch behavior after runtime or model changes.

The right setting is workload-specific: smaller batches favor responsiveness and isolation, while fuller batches can improve efficiency at the cost of waiting and memory. Keep evidence from the workload test, not from a synthetic one-request benchmark.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Batchers — NVIDIA Triton Inference Server](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/batcher.html): documented dynamic batching behavior for Triton; applies to compatible Triton model serving.
- [Engine Arguments - vLLM](https://docs.vllm.ai/en/latest/configuration/engine_args/): versioned serving-engine configuration reference; verify scheduler options against the deployed release.
- [Horizontal Pod Autoscaling | Kubernetes](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/): Kubernetes replica scaling is distinct from request-level queue management.
