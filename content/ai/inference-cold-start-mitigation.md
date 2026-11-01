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
modified: 2026-11-01
draft: false
evidence: source-reviewed
reviewed: 2026-11-01
review-due: 2027-05-01
---

## Measure what “cold” means

A cold start is not one operation. A pod may wait for scheduling and GPU allocation, pull an image, mount or download model artifacts, initialize runtime kernels, allocate weights and cache, run warm-up, pass readiness, and receive traffic. Each stage has a different owner and remedy. Measure timestamps from pod creation through first successful representative inference, and break out delays by stage.

Do not equate a Running pod with usable model capacity. Readiness should reflect whether the server has loaded the required model and can accept work. When a startup probe is configured, Kubernetes does not run liveness or readiness probes until it succeeds, which gives slow initialization time to finish; a readiness probe then controls whether the Pod is listed in Service EndpointSlices. If the startup probe itself fails, the kubelet kills the container and the restart policy applies, so size its failure threshold and period to the real load time. Probe configuration should reflect actual engine startup behavior and avoid turning a slow but progressing load into a restart loop.

Cold start mitigation complements, but does not replace, the scale signals in [[llm-serving-autoscaling-signals|LLM serving autoscaling signals]]. The autoscaler can request capacity, while image, node, and model startup determine when that capacity becomes useful.

## Reduce avoidable startup work

Use immutable, versioned images and model artifacts so caches can be reused safely and rollback remains clear. Keep the serving image appropriately sized; large unused dependencies add transfer and unpack time. Pre-pull images on eligible nodes where you control node configuration, but verify the behavior under node replacement: the Kubernetes images documentation says pre-pulled images do not work reliably when a cloud provider manages nodes and replaces them automatically. The kubelet uses a local image instead of pulling only when `imagePullPolicy` is `IfNotPresent` or `Never`; with `Always` the container runtime still contacts the registry, though it skips layers already cached on the node.

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

## Evidence

### Sources checked

- [Liveness, Readiness, and Startup Probes | Kubernetes](https://kubernetes.io/docs/concepts/workloads/pods/probes/): startup probe delays liveness and readiness probes; startup probe failure kills the container and applies the restart policy; readiness gates EndpointSlice membership. Checked 2026-11-01 against the Kubernetes website repository at commit 491f14e (`content/en/docs/concepts/workloads/pods/probes.md`).
- [Images | Kubernetes](https://kubernetes.io/docs/concepts/containers/images/): a local image is used instead of pulling when `imagePullPolicy` is `IfNotPresent` or `Never`; pre-pulled images are unreliable where a cloud provider manages and replaces nodes automatically; with `Always` the runtime contacts the registry but downloads only layers not already cached. Checked 2026-11-01 against the Kubernetes website repository at commit 491f14e (`content/en/docs/concepts/containers/images.md`).
- [Pod Lifecycle | Kubernetes](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/): `Pending` covers scheduling and image download, `Running` does not imply `Ready`, terminating endpoints report not ready so load balancers skip them. Checked 2026-11-01 against the Kubernetes website repository at commit 491f14e (`content/en/docs/concepts/workloads/pods/pod-lifecycle.md`).

### Not verified

- GKE and Google Cloud behaviour (GPU node provisioning, quotas, image streaming or caching features, node auto-provisioning) depends on Google Cloud documentation, which was not available locally; the note makes only generic statements and the `gke` tag is not a verified claim.
- Inference-engine startup behaviour, optimizations and warm-up semantics: the note names no engine or flags, and none were checked.
- Generic operational advice (warm pools, scheduled capacity, forecast pre-scaling, scale-to-zero trade-offs, gateway routing and overload responses, multi-GPU placement, device plugin and topology checks) is engineering judgement, not backed by a cited source.
- Nothing was run; no timings were measured.

## Sources

- [Liveness, Readiness, and Startup Probes | Kubernetes](https://kubernetes.io/docs/concepts/workloads/pods/probes/): Kubernetes probe semantics and startup behavior.
- [Images | Kubernetes](https://kubernetes.io/docs/concepts/containers/images/): image pull behavior and Kubernetes image configuration.
- [Pod Lifecycle | Kubernetes](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/): pod lifecycle and termination behavior relevant to draining and startup.
