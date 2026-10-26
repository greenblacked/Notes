---
title: LLM inference capacity planning
description: Estimate serving capacity from workload shape, latency objectives, memory, and measured saturation rather than a single tokens-per-second figure.
type: guide
tags:
  - ai
  - gke
  - kubernetes
  - cost
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Start with the workload, not the accelerator

Capacity planning for inference is a sizing exercise under uncertainty. A model's advertised throughput is not a service capacity guarantee: it depends on model revision, precision, prompt and output lengths, concurrency, serving engine, accelerator, and the latency objective. Define the workload before choosing hardware. Separate interactive requests from batch jobs and identify the distributions of input tokens, generated tokens, arrival rate, and concurrent sessions. Averages alone hide long prompts and bursts.

Write down the service objective in user terms: acceptable time to first token, inter-token responsiveness, completion time, and error rate at a specified load. A request that streams quickly but takes minutes to finish can meet a first-token target and still fail its completion target. Define percentile goals and the measurement window; do not size from a single best-case run.

Capacity planning does not replace the platform mechanics in [[self-hosted-llm-inference-on-gke|self-hosted inference on GKE]]. That note covers cluster and deployment choices. This one focuses on turning a workload into a defensible capacity envelope.

## Build a demand model

Estimate request concurrency using observed arrival rate and time in service, but use it as a starting point, not a final answer. Generation time varies with output length and queueing. Track prompt and completion token distributions separately, including p50, p95, and tail cases. Segment demand by model and workload class; requests for different models may compete for distinct memory pools or GPU partitions even if they share an API.

Model peak demand as a time series, not just a monthly average. Include known bursts, retries, rollout overlap, maintenance, and the number of replicas that can be unavailable without breaching objectives. Distinguish normal demand from an agreed failover or recovery scenario. Avoid assuming that a retry storm is safely handled by provisioning extra GPUs: retries can amplify overload unless clients and servers use bounded attempts and backoff.

For each model-serving configuration, record a capacity curve: sustainable arrival rate and token throughput against concurrency, queue depth, and latency. Benchmark the exact image, model revision, tokenizer, hardware class, parallelism, and request mix intended for production. Sweep concurrency gradually, repeat runs, and include warm-up and steady-state periods. Stop increasing load when tail latency or errors cross the objective; the point at which throughput stops rising is usually a warning, not a target.

## Account for memory and placement

Budget accelerator memory for model weights, runtime workspace, key-value cache, graph capture or other engine allocations, and safety headroom. These components vary by engine and model configuration. Parameter count alone is not a sufficient memory estimate. Use the serving engine's current documented memory controls, then verify actual allocation under the intended workload. Include host memory, CPU, network, and storage constraints where weights or caches are staged.

A replica is not necessarily one GPU. Tensor or pipeline parallel configurations can require a set of devices to be scheduled together, changing the placement and failure domain. Plan for available device topology and node capacity, including whether a full replica can be scheduled after one node is drained. If a cluster autoscaler cannot obtain the required shape quickly, additional queued demand does not create capacity.

Keep some headroom for variance and safe operations. It should reflect measured burstiness, replica loss, rollout strategy, and provisioning delay rather than a universal percentage. Too much reserve ties up expensive accelerators; too little turns small deviations into queue growth and latency collapse.

## Validate the plan operationally

Capacity is a joint property of the model, engine, hardware, scheduler, and traffic policy. Use a repeatable load test with representative data sizes, arrival patterns, cancellation, streaming clients, and realistic timeouts. Validate the failure case separately: one replica unavailable, slow node provisioning, a model load failure, and a traffic spike. Check that readiness does not advertise a replica until it can accept work.

Re-evaluate after model or engine upgrades and when request distributions shift. Keep a rollback path to the previous tested configuration. A throughput increase that consumes cache headroom or raises tail latency may be a regression for the service even if aggregate tokens per second improves.

### Planning checklist

- Record demand distributions, workload classes, peak scenarios, and percentile objectives.
- Benchmark the production model, engine, hardware, and traffic mix; keep the test report with exact versions.
- Plot latency, errors, queue depth, memory, and throughput together as concurrency rises.
- Confirm replica placement, rollout overlap, recovery capacity, and node provisioning assumptions.
- Define thresholds that stop admission or shed lower-priority work before queues grow without bound.
- Re-run the envelope after material changes and preserve the last known-good configuration.

Tradeoffs should be explicit: reserve capacity buys recovery and latency stability at ongoing cost, while high utilization lowers idle cost but leaves less room for bursts and maintenance. Neither is universally correct; choose against a stated objective and revisit it with production evidence.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Parallelism and Scaling - vLLM](https://docs.vllm.ai/en/latest/serving/parallelism_scaling/): serving topology and scaling considerations.
- [Engine Arguments - vLLM](https://docs.vllm.ai/en/latest/configuration/engine_args/): documented engine configuration options; check the deployed version before using an argument.
- [Horizontal Pod Autoscaling | Kubernetes](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/): Kubernetes scaling behavior and metric inputs; not a model-capacity estimator.
