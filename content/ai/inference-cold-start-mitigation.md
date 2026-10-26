---
title: Inference cold-start mitigation
description: Reduce time-to-ready for model-serving replicas by measuring each startup stage and balancing warm capacity against cost.
type: guide
tags:
  - ai
  - kubernetes
  - gke
  - reliability
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Measure what “cold” means

A cold start is not one operation. A pod may wait for scheduling and GPU allocation, pull an image, mount or download model artifacts, initialize runtime kernels, allocate weights and cache, run warm-up, pass readiness, and receive traffic. Each stage has a different owner and remedy. Measure timestamps from pod creation through first successful representative inference, and break out delays by stage.

Do not equate a Running pod with usable model capacity. Readiness should reflect whether the server has loaded the required model and can accept work. Startup probes can allow lengthy initialization without causing premature liveness restarts; readiness controls traffic separately. Probe configuration should reflect actual engine startup behavior and avoid turning a slow but progressing load into a restart loop.

Cold start mitigation complements, but does not replace, the scale signals in [[llm-serving-autoscaling-signals|LLM serving autoscaling signals]]. The autoscaler can request capacity, while image, node, and model startup determine when that capacity becomes useful.

## Reduce avoidable startup work

Use immutable, versioned images and model artifacts so caches can be reused safely and rollback remains clear. Keep the serving image appropriately sized; large unused dependencies add transfer and unpack time. Pre-pull images on eligible nodes where the platform supports it, but verify the behavior under node replacement and avoid relying on a cache that is not guaranteed to persist.

Stage model artifacts close to the serving nodes or use a documented artifact cache with integrity verification. Avoid downloading an unpinned “latest” model during startup. Separate artifact fetch, checksum validation, deserialization, and device allocation timings. A faster download is not helpful if initialization or GPU scheduling remains the bottleneck.

Tune parallelism and model loading against the actual node shape. A replica requiring multiple GPUs may wait for a complete placement group. Validate device plugin reporting, node labels, topology constraints, quotas, and autoscaler availability. Ensure weights and cache fit with headroom; repeated OOM and restart cycles create a worse cold-start storm.

Warm-up requests can prepare kernels and paths, but consume resources and must not be confused with readiness if they do not represent real serving behavior. Ensure they do not create customer-visible output or pollute state. If the engine has documented startup optimizations, verify compatibility with the exact release and hardware before enabling them.

## Choose a warm-capacity strategy

Keeping a minimum replica count or warm pool reduces latency during bursts but incurs idle cost. Scheduled capacity can work for predictable demand, but misses unscheduled peaks. Pre-scaling from forecasts can help if forecasts are reliable; retain a fallback to reactive controls. Scale-to-zero is attractive for cost but may be incompatible with tight interactive startup objectives, particularly when GPU nodes and large weights need provisioning.

Define separate behavior for interactive and asynchronous work. Interactive requests can use a warm route or fail fast when startup would exceed their deadline. Batch jobs can queue while a model loads. A gateway can route only to Ready replicas and return an honest overload response rather than send traffic into an unbounded startup queue.

## Failure modes and checklist

- **Image-pull bottleneck:** registry access, image size, or node cache causes delay. Measure pull and unpack separately.
- **Artifact fetch failure:** object access, checksum, or version mismatch blocks readiness. Alert and preserve the last known-good immutable artifact.
- **GPU placement delay:** no compatible node or device set is available. Check quotas, topology, and node provisioning.
- **Startup restart loop:** probes mistake slow initialization for failure. Use startup/readiness semantics and confirm progress signals.
- **Warm-up overload:** startup work competes with active replicas. Rate-limit warmups and monitor resource impact.
- **Hidden false readiness:** pod receives requests before model loaded. Gate endpoints on actual serving readiness.

### Checklist

- Measure create-to-ready and ready-to-first-successful-request by startup stage.
- Pin images, model artifacts, runtime versions, and checksums.
- Test node replacement, empty image cache, artifact outage, and GPU quota constraints.
- Configure startup/readiness/liveness probes for distinct purposes.
- Compare minimum replicas, scheduled warm capacity, and queueing against cost and latency goals.
- Define a rollback and traffic-drain path for model-load failures.

Warm capacity trades idle expense for response time and resilience. Optimize the slowest measured stage first; adding replicas cannot fix an unavailable artifact store or broken readiness contract.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Liveness, Readiness, and Startup Probes | Kubernetes](https://kubernetes.io/docs/concepts/workloads/pods/probes/): Kubernetes probe semantics and startup behavior.
- [Images | Kubernetes](https://kubernetes.io/docs/concepts/containers/images/): image pull behavior and Kubernetes image configuration.
- [Pod Lifecycle | Kubernetes](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/): pod lifecycle and termination behavior relevant to draining and startup.
