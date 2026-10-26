---
title: LLM serving autoscaling signals
description: Scale inference replicas using signals tied to unmet work and latency, while accounting for GPU placement and slow capacity acquisition.
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

## Replicas are not the only scaling unit

Autoscaling an inference service is a control problem with several delays: metric collection, scale decision, scheduler placement, node provisioning, image and model loading, readiness, and traffic convergence. A replica count can change quickly while usable GPU capacity takes much longer to appear. Design the controller around that lag; do not assume that a higher desired replica count immediately relieves a queue.

Kubernetes Horizontal Pod Autoscaling adjusts replicas based on configured metrics and resource behavior. It does not know model-specific saturation unless an appropriate metric adapter or controller supplies it, and it does not make GPU capacity available by itself. GPU node provisioning and device placement are separate concerns. For platform layout, see [[self-hosted-llm-inference-on-gke|self-hosted LLM inference on GKE]].

## Choose signals that describe demand and constraint

Useful signals can include queue age or depth, active sequences, admitted concurrency, request arrival rate, tokens awaiting prompt processing, token generation rate, per-replica utilization, and latency objective burn. The right signal depends on the engine and workload. vLLM documents its own serving metrics; names and semantics must be confirmed for the exact deployed version. Avoid assuming metric equivalence across runtimes.

CPU or memory utilization may help identify an obvious bottleneck, but neither necessarily reflects GPU work or user demand. GPU utilization can be high while requests are already missing latency goals, or low while queue demand accumulates behind a CPU-bound component. Pair a demand signal with a constraint or outcome signal. Use bounded labels and verify that the metric remains available during rollouts and node churn.

Scale on a signal with enough lead time to act. If the model takes a long time to load, queue age may already exceed the user's deadline before a newly created replica becomes Ready. A small warm reserve, scheduled capacity for known peaks, or a queue for non-interactive work can complement reactive scaling. These options cost more but reduce the risk of a controller chasing demand too late.

## Tune control-loop behavior

Scaling policies need stabilization and bounds. Rapid scale-up may be warranted during a burst, while rapid scale-down can interrupt active work or cause repeated model loads. Retain enough replicas to handle ongoing streams and preserve room for maintenance. Use readiness to prevent traffic from reaching a replica before model load and health checks succeed.

Set minimum and maximum replicas based on resource budget, quota, and cluster capacity. A maximum that exceeds the number of schedulable GPU sets creates pending pods rather than serving capacity. If a replica requires multiple accelerators, account for their joint placement. Confirm whether topology, node labels, device plugin resources, and autoscaler policy allow the shape to be scheduled.

Avoid oscillation. Scrape intervals, smoothing, scale-up cooldowns, scale-down stabilization, and noisy metrics can produce flapping. Test with a load pattern that includes sudden bursts, gradual ramps, idle periods, and node provisioning delays. Observe desired replicas, ready replicas, pending pods, startup time, queue age, and latency together.

## Failure modes and tradeoffs

- **Metric missing or stale:** scaling holds the wrong replica count. Alert on telemetry freshness and define safe behavior for unavailable metrics.
- **Pending GPU pods:** scheduler demand exceeds usable node capacity. Check accelerator type, topology, quota, and node-provisioning constraints.
- **Scale-down interrupts streams:** drain gracefully and allow active work to finish within a bounded termination window.
- **Replica lag:** newly ready pods receive traffic before they can serve at expected performance. Gate readiness on model initialization and route health.
- **Oscillation:** instances churn and repeatedly load large artifacts. Tune stabilization, bounds, and warm capacity.
- **False confidence in HPA:** pod count rises while accelerator supply does not. Monitor schedulable and ready device capacity separately.

## Operator checklist

- Select demand and service-outcome signals whose definitions are confirmed for the deployed engine.
- Measure metric lag, scheduling delay, node provisioning, image pull, model load, and readiness time.
- Configure replica bounds, scale behavior, graceful draining, and safe telemetry failure handling.
- Test spikes, low traffic, unavailable nodes, GPU quota exhaustion, and metric gaps.
- Keep interactive traffic bounded while new capacity starts; shed or defer where necessary.
- Revisit the controller after model, hardware, metric, or cluster-autoscaler changes.

Reactive scaling trades lower idle cost against delayed capacity. A warm pool or minimum replica count raises the baseline but can preserve latency during bursts. Set the balance from observed provisioning time, demand volatility, and the cost of missed requests.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Horizontal Pod Autoscaling | Kubernetes](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/): Kubernetes HPA behavior and supported metric model; not a GPU capacity controller by itself.
- [Parallelism and Scaling - vLLM](https://docs.vllm.ai/en/latest/serving/parallelism_scaling/): vLLM serving topology context; runtime metrics and availability must be checked against deployed version.
- [Liveness, Readiness, and Startup Probes | Kubernetes](https://kubernetes.io/docs/concepts/workloads/pods/probes/): probe roles for controlling traffic and restarts during startup.
