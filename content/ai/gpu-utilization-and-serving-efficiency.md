---
title: GPU utilization and serving efficiency
description: Diagnose whether inference accelerators are productively serving requests and improve efficiency without mistaking utilization for user value.
type: guide
tags:
  - ai
  - gke
  - kubernetes
  - observability
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Utilization is a symptom, not a service objective

GPU utilization is useful for locating idle or saturated resources, but it does not tell whether users receive timely, correct responses. A high utilization reading can coexist with growing queues and poor latency; a low reading can reflect bursty arrivals, CPU-bound tokenization, model loading, a memory bottleneck, or an instrumentation gap. Pair device metrics with request-level outcomes and engine-level work counters.

This note addresses the runtime efficiency of an already selected serving configuration, not model-version pinning or API billing. For end-to-end signals and SLOs, see [[llm-observability-tracing-and-slos|LLM observability and SLOs]].

## Observe the whole path

At the device layer, collect utilization, memory used, power or clocks where available, and accelerator health signals. NVIDIA DCGM Exporter exposes GPU telemetry for Prometheus-style scraping; check its documentation and the deployed DCGM and driver compatibility before relying on particular metrics. Metrics may have different names or availability across exporter versions and hardware.

At the serving layer, collect active sequences, scheduled work, waiting requests, prompt and generation token rates, cache occupancy, model-load time, and errors when the engine exposes them. At the application layer, measure queue wait, time to first token, inter-token delay, completion time, cancellations, and request class. Correlate these at a common resolution without putting prompt contents, customer identifiers, or unbounded model names into metric labels.

Inspect CPU and memory pressure too. Tokenization, preprocessing, detokenization, network transfer, and orchestration can constrain the pipeline even while GPU execution is underutilized. Node-level telemetry should distinguish host-wide pressure from container limits. A dashboard showing only device utilization makes diagnosis easy to misattribute.

## Find bottlenecks with controlled experiments

Establish a baseline with realistic request lengths and concurrency. Change one factor at a time: batch policy, worker count, parallelism, precision, or admission limit. Record software versions and configuration with each test. Compare throughput only when response quality, latency percentiles, and failure rate remain within the service's acceptance criteria.

If utilization is low and latency is also low, the issue may simply be low demand. If utilization is low while queue wait rises, inspect scheduling, CPU saturation, model synchronization, and data transfer. If utilization is high while queue depth and tail latency grow, the deployment may be saturated; reduce admission or add tested capacity rather than pushing utilization higher. If memory is close to exhaustion but compute use is modest, the workload may be constrained by weights or cache rather than arithmetic.

Efficiency changes often shift bottlenecks. Batching can improve accelerator occupancy while adding wait for the first item in a batch. Larger batches can require more cache and workspace. Model parallelism can expose more memory but add communication. Quantization may reduce memory and increase throughput, but needs task-specific quality checks. Measure end-to-end behavior after every change.

## Avoid misleading rollups

Aggregate utilization across heterogeneous cards can conceal one saturated replica and several idle ones. Break down by node, device, model deployment, and accelerator class, then relate it to request routing. Use distributions or per-replica panels rather than a single cluster average.

Do not treat every memory allocation as a leak. Some serving engines reserve memory by design for cache or workspace. Compare observed allocation to documented behavior for the deployed release and watch trends across load and restarts. Conversely, a stable average can hide sudden OOM failures during model reload or traffic surges.

Metrics have costs and gaps. High-cardinality labels increase monitoring load; frequent polling can itself be expensive. Exporter failures, stale samples, missing permissions, and scrape gaps need alerts distinct from genuine zero utilization. Avoid making autoscaling decisions from a metric whose collection path is not tested during node replacement.

## Operational checklist

- Pair DCGM or vendor telemetry with engine queue/cache metrics and application latency.
- Label the hardware, model, replica, and configuration carefully while keeping labels bounded.
- Test alerting for missing telemetry, stale samples, device failure, and sustained saturation.
- Maintain benchmark records so that versions and traffic shape are comparable.
- Evaluate each efficiency change against latency, errors, quality, and cost per successful request.
- Treat sustained queue growth as a demand-management issue, not a target utilization to chase.

The tradeoff is direct: maximizing busy time can reduce idle cost, but leaves less slack for bursts and maintenance. A lower, deliberate utilization target may improve resilience. Set it from measured workload variance and provisioning time, not a generic rule.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [DCGM Exporter Documentation](https://docs.nvidia.com/datacenter/dcgm/latest/gpu-telemetry/dcgm-exporter.html): exporter purpose and deployment documentation; metric availability is environment-specific.
- [Feature Overview - NVIDIA DCGM](https://docs.nvidia.com/datacenter/dcgm/latest/user-guide/feature-overview.html): DCGM capabilities and telemetry context.
- [Parallelism and Scaling - vLLM](https://docs.vllm.ai/en/latest/serving/parallelism_scaling/): serving topology considerations that influence utilization and communication.
