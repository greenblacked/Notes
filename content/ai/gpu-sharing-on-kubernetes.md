---
title: GPU sharing on Kubernetes
description: Choose between whole-GPU allocation, time-slicing and hardware partitioning for inference on Kubernetes and GKE, and know when sharing is unsafe.
type: pattern
tags:
  - ai
  - kubernetes
  - gke
  - reliability
created: 2026-11-01
modified: 2026-11-02
draft: false
evidence: source-reviewed
reviewed: 2026-11-02
review-due: 2027-05-02
---

This note covers how to share GPUs between inference workloads on Kubernetes and GKE: whole-GPU allocation, time-slicing and hardware partitioning, the device plugin resource names that expose them, scheduling and quotas, monitoring, and the cases where sharing is unsafe. It is for platform and ML-serving engineers who own GPU node pools and decide how tenants consume them. It does not cover tenant isolation at the model, cache and data layers ([[multi-tenant-inference-isolation]]), cost and utilisation tuning inside a serving engine ([[gpu-utilization-and-serving-efficiency]]), autoscaling signals ([[llm-serving-autoscaling-signals]]), KV cache sizing ([[kv-cache-capacity-and-paging]]) or building a dedicated GPU serving stack on GKE ([[self-hosted-llm-inference-on-gke]]).

> [!note] Not verified
> The Kubernetes, gcloud, Terraform, vLLM and OpenTelemetry claims were read in local copies of the documentation and help text, not on the live sites. GPU-vendor documentation and GKE concept pages could not be checked at all. See the Evidence section. Before relying on this note, check: how your GPU vendor's device plugin configures time-slicing and whether replicas get separate memory; which partition profiles and machine types your GKE version supports; GKE-specific quota names and GPU metric exposure; the feature-gate state of Dynamic Resource Allocation on your cluster version; and any latency numbers, which must be measured in your own environment.

## The three modes

| Mode                  | What a tenant gets                              | Isolation                                                                      | Use when                                                              |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Whole GPU             | One full device, exclusively                    | Strongest. Nothing is shared except the node.                                  | Large models, strict latency targets, untrusted tenants               |
| Time-slicing          | A share of compute time on one device           | Weakest. Test for memory and fault isolation; do not assume it exists.         | Trusted, same-team, bursty or dev workloads                           |
| Hardware partitioning | A fixed slice of compute and memory (MIG-style) | Stronger data-plane isolation than time-slicing, but still one physical device | Several small models that each fit a slice, mixed tenants with review |

The core Kubernetes model is whole devices. GPUs are extended resources, which are integers only, cannot be overcommitted, and cannot be shared between containers. Any sharing mode below is therefore something a vendor plugin, a DRA driver or the platform adds on top, and its semantics belong to that vendor. A plugin may advertise time-sliced replicas of one GPU as several schedulable units; Kubernetes documentation does not describe this, so verify memory and fault behaviour with the vendor before trusting it.

## Resource names and what they mean

A device plugin advertises `vendor-domain/resourcetype`, for example `nvidia.com/gpu` or `amd.com/gpu`. A sharing mode may be exposed through that same name, so `nvidia.com/gpu: 1` can mean a full device on one node pool and a time-sliced replica or a partition on another. Document the meaning per node pool and enforce it, because the request alone does not tell the scheduler or a reviewer which one the tenant gets.

Rules that the core scheduler applies:

- GPUs go in `limits`. If you also set `requests`, they must equal `limits`; `requests` alone is rejected.
- Node selection is a separate decision. Use labels, node affinity or Node Feature Discovery to pick the GPU class, because the resource name does not say which model or partition size you get.
- On GKE, the `gcloud container node-pools create` and `update` help list an `--accelerator` flag with `gpu-partition-size`, `gpu-sharing-strategy` and `max-shared-clients-per-gpu` sub-fields. Accepted values, supported machine types and the resulting resource names are not covered here; take them from the current GKE documentation. What this note relies on is the label and taint you set yourself, shown next.

The node pool carries a label and a taint that you set when you create it or update it. On GKE Standard, `gcloud container node-pools create` takes `--node-labels` and `--node-taints` together, while `update` takes them in separate commands; in Terraform the same go in the pool's `node_config` as `labels` and a `taint` block. Pods then select the label with `nodeSelector` and tolerate the taint, as in the Deployment below.

```bash title="label-and-taint-gpu-pool.sh"
set -euo pipefail

CLUSTER="example-cluster"   # change: your GKE Standard cluster
LOCATION="europe-west4"     # change: the cluster's region
POOL="gpu-inference"        # change: the GPU node pool

# Each call replaces that kind of setting on the pool; update accepts
# only one of these flags per call.
gcloud container node-pools update "$POOL" \
  --cluster="$CLUSTER" \
  --location="$LOCATION" \
  --node-labels=workload=llm-inference,pool=gpu-inference,gpu-sharing=exclusive

gcloud container node-pools update "$POOL" \
  --cluster="$CLUSTER" \
  --location="$LOCATION" \
  --node-taints=dedicated=llm-inference:NoSchedule
```

```hcl title="gpu-pool-node-config.tf (fragment)"
node_config {
  labels = {
    workload    = "llm-inference"
    pool        = "gpu-inference"
    gpu-sharing = "exclusive"
  }

  taint {
    key    = "dedicated"
    value  = "llm-inference"
    effect = "NO_SCHEDULE"
  }
}
```

`update` takes labels and taints in separate commands, and each replaces the pool's whole set of that kind, so list every label and every taint the pool should keep. The labels and taint here match the serving pool built in [[self-hosted-llm-inference-on-gke]]; run the commands against that pool only with all of them, or its serving pods stop scheduling. Check what the nodes actually carry with `kubectl get nodes --show-labels` before relying on a selector.

```yaml title="inference-deployment.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: summariser
  namespace: team-search
spec:
  replicas: 2
  selector:
    matchLabels:
      app: summariser
  template:
    metadata:
      labels:
        app: summariser
    spec:
      automountServiceAccountToken: false
      nodeSelector:
        pool: gpu-inference # labels your platform team sets per node pool
        gpu-sharing: exclusive
      tolerations:
        - key: dedicated
          operator: Equal
          value: llm-inference
          effect: NoSchedule
      containers:
        - name: server
          image: registry.example.com/team-search/summariser@sha256:0000000000000000000000000000000000000000000000000000000000000000
          resources:
            requests:
              cpu: "4"
              memory: 24Gi
            limits:
              memory: 24Gi
              nvidia.com/gpu: 1
          securityContext:
            runAsNonRoot: true
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
            seccompProfile:
              type: RuntimeDefault
```

The digest is a placeholder. `runAsNonRoot` needs a numeric non-root UID, set either by the image or by `runAsUser`, and with a read-only root filesystem the server needs `emptyDir` mounts for any cache or temp paths it writes. See [[kubernetes-resource-requests-and-limits]] for the CPU and memory side.

## Quotas and scheduling

Quota counts GPUs by extended-resource name. Because overcommit is not allowed for extended resources, only the `requests.` form is meaningful.

```yaml title="gpu-quota.yaml"
apiVersion: v1
kind: ResourceQuota
metadata:
  name: gpu
  namespace: team-search
spec:
  hard:
    requests.nvidia.com/gpu: "4"
```

This counts whatever the plugin advertises. If a shared mode turns one device into several replicas, a quota of 4 may be four slices, not four GPUs, and tenants can end up with more or less than intended. Define the quota unit with the platform team per node pool, and keep sharing and exclusive pools under different resource names or different namespaces where the plugin allows it. Namespace-level patterns are in [[kubernetes-namespace-quotas-and-limitranges]] and [[0019-namespace-per-team-tenancy]].

Size memory before you share. A serving engine such as vLLM pre-allocates GPU memory for its KV cache using the fraction set by `gpu_memory_utilization` (0.9 is the value in the documentation's examples and sweeps; check the default for your version). Two engines on one unpartitioned or time-sliced GPU compete for memory, not only compute, and a partition must hold weights plus KV cache with headroom for the engine.

## Dynamic Resource Allocation

DRA is the structured alternative for partitioned devices. It adds device classes, CEL filtering and sharing a device between containers or pods through a resource claim, whereas the device-plugin model does not share devices between containers. Two features cover partitioning, and the second builds on the first: partitionable devices (`DRAPartitionableDevices`), where logical devices consume shared counters so the scheduler will not allocate partitions that together exceed the physical device, and device compatibility groups, which exist only on partitionable devices, need both `DRAPartitionableDevices` and `DRADeviceCompatibilityGroups` enabled, and let a driver declare mutually exclusive modes, such as a partition mode and a virtual-GPU mode, so the scheduler rejects that combination. Both depend on your Kubernetes version and feature gates, so confirm the state on the target cluster before recommending it.

## Monitoring

GPU utilisation from DCGM-style exporters says a device is busy, not that a tenant is being served well. On a shared device, high utilisation can mean healthy packing or heavy contention. Alert on serving signals per tenant instead:

- `vllm:kv_cache_usage_perc`, the fraction of KV blocks in use (0 to 1), for memory pressure.
- Time to first token, time per output token and request duration, named `gen_ai.server.time_to_first_token`, `gen_ai.server.time_per_output_token` and `gen_ai.server.request.duration` in the OpenTelemetry GenAI conventions, where they are still marked Development and may change.

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

# Report GPUs advertised per node so sharing changes are visible.
kubectl get nodes -o json |
  jq -r '.items[] | [.metadata.name, (.status.allocatable["nvidia.com/gpu"] // "0")] | @tsv'
```

A sudden jump in allocatable GPUs on a node can mean someone enabled time-slicing or partitioning there. Treat that as a change needing review.

```yaml title=".gitlab-ci.yml"
gpu-quota-check:
  stage: test
  image: registry.example.com/platform/kubectl:1.0.0
  script:
    - set -Eeuo pipefail
    - kubectl apply --dry-run=server -f gpu-quota.yaml
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        - gpu-quota.yaml
```

Server-side dry-run catches schema and admission errors before merge. Run it with credentials limited to a non-production cluster.

## When sharing is unsafe

Do not share a device between tenants when any of these holds, unless a documented review accepts the residual risk:

- The tenants are mutually untrusted, or the workloads handle different data classifications. Kubernetes describes hard multi-tenancy, where tenants do not trust each other, as often needing extra attention to data-plane isolation; do not assume time-slicing provides it.
- One tenant's crash must not affect another. When a device goes unhealthy the kubelet lowers allocatable, but pods already on it keep their assignment and usually fail, so one fault can hit every tenant on that device.
- A latency objective is tight and unmeasured. No local source quantifies noisy-neighbour impact, so measure with a realistic load before promising it.
- Memory use is unpredictable, for example long-context traffic with a large KV cache.

The default for regulated or cross-tenant work is a whole GPU per tenant or a reviewed hardware partition. Time-slicing stays within one trust boundary.

## Failure modes

- **Silent meaning change.** The same `nvidia.com/gpu: 1` request lands on a time-sliced pool and the service meets contention nobody expected.
- **Memory fight.** Two engines each claim most of the device memory and one fails to start or is killed under load.
- **Quota in the wrong unit.** A namespace quota counts slices as devices and a tenant takes far more capacity than budgeted.
- **Fault blast radius.** One device error takes down every pod on a shared GPU, and those pods stay assigned to the failed device, failing or crash-looping rather than moving.
- **Plugin outage.** The kubelet restarts and the plugin does not detect it and re-register (the documented expectation is that it does). Treat the resulting loss of GPU capacity on the node as likely. Treat plugin DaemonSet health as a node-level SLO.
- **Averages hide starvation.** The dashboard shows 70 percent GPU utilisation while one tenant waits behind another.
- **Unreviewed DRA reliance.** A manifest assumes a feature gate that the cluster does not enable.

## Review checklist

- [ ] Each GPU node pool has a documented mode: whole, time-sliced or partitioned.
- [ ] The meaning of the GPU resource name per pool is written down and enforced by labels or taints.
- [ ] GPUs are set in `limits`, and `requests` equals `limits` or is omitted.
- [ ] ResourceQuota uses `requests.<resource name>` with a defined unit per pool.
- [ ] Memory per tenant was sized for weights, KV cache and headroom.
- [ ] Mutually untrusted tenants never share a device without a recorded review.
- [ ] Vendor behaviour for memory and fault isolation was tested, not assumed.
- [ ] Alerts use per-tenant latency and KV cache pressure, not GPU percentage alone.
- [ ] Device plugin health and node allocatable changes are monitored.
- [ ] The DRA feature-gate state was checked against the cluster version.
- [ ] Containers run non-root with a restricted `securityContext`.

## Evidence

Source-reviewed on 2026-11-02. Nothing was run. Scope: Kubernetes GPU scheduling, device plugin, quota, DRA and tenancy behaviour, GKE node pool labels and taints, and the serving metric names quoted in the monitoring section.

### Sources checked

- [Schedule GPUs | Kubernetes](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/): GPU resources such as `amd.com/gpu` and `nvidia.com/gpu`; GPUs belong in `limits`; limits without requests is allowed, both must be equal, requests without limits is not allowed; node labels and Node Feature Discovery to pick GPU type. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Device Plugins | Kubernetes](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/): `vendor-domain/resourcetype` naming; extended resources are integer-only and cannot be overcommitted; devices cannot be shared between containers; plugin must re-register after a kubelet restart; unhealthy devices lower allocatable while assigned pods keep the device and usually fail or crash-loop. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Resource Quotas | Kubernetes](https://kubernetes.io/docs/concepts/policy/resource-quotas/): only `requests.`-prefixed quota items are allowed for extended resources, for example `requests.nvidia.com/gpu`. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) and [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/): `NoSchedule` taint, toleration with `operator: Equal`, and `nodeSelector` on node labels. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Multi-tenancy | Kubernetes](https://kubernetes.io/docs/concepts/security/multi-tenancy/): hard versus soft multi-tenancy, extra attention to data-plane isolation for hard tenancy, and noisy-neighbour concerns. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Dynamic Resource Allocation | Kubernetes](https://kubernetes.io/docs/concepts/resource-management/dynamic-resource-allocation/) and [DRA Features](https://kubernetes.io/docs/concepts/resource-management/dynamic-resource-allocation/dra-features/): CEL device filtering, device sharing through resource claims, device classes; partitionable devices with shared counters (`DRAPartitionableDevices`); compatibility groups so the scheduler rejects incompatible modes such as MIG and vGPU; they build on partitionable devices and need both `DRAPartitionableDevices` and `DRADeviceCompatibilityGroups` enabled. Checked 2026-11-02 against kubernetes/website commit 491f14e.
- [Metrics | vLLM](https://docs.vllm.ai/en/latest/design/metrics/): `vllm:kv_cache_usage_perc` is a gauge for the fraction of used KV cache blocks (0 to 1); `gpu_memory_utilization="0.9"` appears in the sample cache config output (`docs/design/metrics.md`) and in the sweeps example. [Optimization](https://docs.vllm.ai/en/latest/configuration/optimization/) says vLLM pre-allocates GPU cache using that percentage. Checked 2026-11-02 against vllm commit 8530a77.
- [Semantic conventions for generative AI metrics | OpenTelemetry](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/gen-ai/gen-ai-metrics.md): `gen_ai.server.request.duration`, `gen_ai.server.time_per_output_token` and `gen_ai.server.time_to_first_token` are defined as histograms with Development stability (read from `docs/gen-ai/gen-ai-metrics.md` in the semantic-conventions repository; the public URL is the usual mapping of that path). Checked 2026-11-02 against semantic-conventions-genai commit 244465e.
- [gcloud container node-pools create](https://cloud.google.com/sdk/gcloud/reference/container/node-pools/create) and [update](https://cloud.google.com/sdk/gcloud/reference/container/node-pools/update): `--node-labels` and `--node-taints` exist on both; the `key=value:NoSchedule` format; on `update` exactly one of a group of flags (including these two) may be given per call, and each replaces all user-specified labels or taints; `--accelerator` lists `gpu-partition-size`, `gpu-sharing-strategy` and `max-shared-clients-per-gpu`. Read from `gcloud ... --help` only, Google Cloud SDK 570.0.0, 2026-11-02.
- [google_container_cluster | Terraform provider for Google](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/container_cluster): `node_config` `labels` and `taint` with `key`, `value` and `effect` (`NO_SCHEDULE`). Checked 2026-11-02 against the provider documentation commit c4248bd.
- [Job rules | GitLab](https://docs.gitlab.com/ci/jobs/job_rules/): `rules:if` with `$CI_PIPELINE_SOURCE == "merge_request_event"` and `rules:changes`. Checked 2026-11-02 against gitlabhq commit d7b9a61.

### Not verified

- GPU-vendor behaviour was not checked: how time-slicing is configured, whether replicas get separate memory or fault isolation, which resource names a sharing mode exposes, and MIG-style partition profiles.
- GKE documentation was not reachable: supported machine types, accelerator sub-field values, GKE-specific quota names and GPU metric exposure.
- Feature-gate maturity of the DRA features on your cluster version was not resolved; the pages use feature-state shortcodes that were not rendered.
- The `kubectl apply --dry-run=server` behaviour (schema and admission checks) was not confirmed against kubectl reference text beyond its use in other pages.
- The isolation ranking in the mode table, the unsafe-sharing criteria, the failure-mode list and the review checklist are engineering guidance, not documented claims. No local source quantifies noisy-neighbour impact.
- The `runAsNonRoot` and `emptyDir` advice in the manifest note is engineering guidance; no local Kubernetes page states the numeric-UID rule.
- What happens to advertised GPU capacity when a plugin fails to re-register after a kubelet restart is inference; the Device Plugins page only says the plugin is expected to re-register.
- Nothing was run.

## Sources

- [Kubernetes: Schedule GPUs](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/): backs `limits` and `requests` rules and node selection for GPU type. Checked 2026-11-02 (commit 491f14e).
- [Kubernetes: Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) and [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/): back the `NoSchedule` taint, a toleration with `operator: Equal` matching key, value and effect, and `nodeSelector` on node labels. Checked 2026-11-02 (commit 491f14e).
- `gcloud container node-pools create --help` and `update --help` (Google Cloud SDK 570.0.0): back `--node-labels` and `--node-taints`, the `key=value:NoSchedule` format, and that `update` accepts only one of them per call and replaces all user-specified labels or taints. Checked 2026-11-02 (help text only).
- [Terraform google_container_cluster](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/container_cluster): backs `node_config` `labels` and the `taint` block with `key`, `value` and `effect` (`NO_SCHEDULE`). Checked 2026-11-02 (commit c4248bd).
- [Kubernetes: Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/): backs `requests.`-only quota for extended resources. Checked 2026-11-02 (commit 491f14e).
- [Kubernetes: Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/): backs resource naming, integer-only extended resources, unhealthy devices and plugin re-registration after kubelet restarts. Checked 2026-11-02 (commit 491f14e).
- [Kubernetes: Multi-tenancy](https://kubernetes.io/docs/concepts/security/multi-tenancy/): backs hard versus soft tenancy and data-plane isolation concerns. Checked 2026-11-02 (commit 491f14e).
- [Kubernetes: Dynamic Resource Allocation](https://kubernetes.io/docs/concepts/resource-management/dynamic-resource-allocation/) and its DRA features page: back device classes, CEL filtering, claims, partitionable devices and compatibility groups (which need both gates enabled). Feature-gate stages were not checked. Checked 2026-11-02 (commit 491f14e).
- [vLLM metrics design](https://docs.vllm.ai/en/latest/design/metrics/): backs `vllm:kv_cache_usage_perc` and the 0.9 example value. Checked 2026-11-02 (commit 8530a77).
- [OpenTelemetry GenAI metrics](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/gen-ai/gen-ai-metrics.md): backs the `gen_ai.server.*` metric names and their Development status. Checked 2026-11-02 (semantic-conventions-genai commit 244465e); the public URL is inferred from the repository path.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
