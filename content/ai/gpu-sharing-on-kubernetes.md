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
---

This note covers how to share GPUs between inference workloads on Kubernetes and GKE: whole-GPU allocation, time-slicing and hardware partitioning, the device plugin resource names that expose them, scheduling and quotas, monitoring, and the cases where sharing is unsafe. It is for platform and ML-serving engineers who own GPU node pools and decide how tenants consume them. It does not cover tenant isolation at the model, cache and data layers ([[multi-tenant-inference-isolation]]), cost and utilisation tuning inside a serving engine ([[gpu-utilization-and-serving-efficiency]]), autoscaling signals ([[llm-serving-autoscaling-signals]]), KV cache sizing ([[kv-cache-capacity-and-paging]]) or building a dedicated GPU serving stack on GKE ([[self-hosted-llm-inference-on-gke]]).

> [!note] Not verified
> The Kubernetes, gcloud and Terraform claims were read in local copies of the documentation and help text, not on the live sites. GPU-vendor documentation and GKE concept pages could not be checked at all. Before relying on this note, check: how your GPU vendor's device plugin configures time-slicing and whether replicas get separate memory; which partition profiles and machine types your GKE version supports; GKE-specific quota names and GPU metric exposure; the feature-gate state of Dynamic Resource Allocation on your cluster version; and any latency numbers, which must be measured in your own environment.

## The three modes

| Mode                  | What a tenant gets                              | Isolation                                                                      | Use when                                                              |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Whole GPU             | One full device, exclusively                    | Strongest. Nothing is shared except the node.                                  | Large models, strict latency targets, untrusted tenants               |
| Time-slicing          | A share of compute time on one device           | Weakest. Test for memory and fault isolation; do not assume it exists.         | Trusted, same-team, bursty or dev workloads                           |
| Hardware partitioning | A fixed slice of compute and memory (MIG-style) | Stronger data-plane isolation than time-slicing, but still one physical device | Several small models that each fit a slice, mixed tenants with review |

The core Kubernetes model is whole devices. GPUs are extended resources, which are integers only, cannot be overcommitted, and cannot be shared between containers. Every sharing mode below is therefore something a vendor plugin or a DRA driver adds on top, and its semantics belong to that vendor. Vendor plugins can advertise time-sliced replicas of one GPU as several schedulable units; verify memory and fault behaviour with the vendor before trusting it.

## Resource names and what they mean

A device plugin advertises `vendor-domain/resourcetype`, for example `nvidia.com/gpu` or `amd.com/gpu`. Any sharing mode you enable is usually exposed through that same name, so `nvidia.com/gpu: 1` can mean a full device on one node pool and a time-sliced replica or a partition on another. Document the meaning per node pool and enforce it, because the request alone does not tell the scheduler or a reviewer which one the tenant gets.

Rules that the core scheduler applies:

- GPUs go in `limits`. If you also set `requests`, they must equal `limits`; `requests` alone is rejected.
- Node selection is a separate decision. Use labels, node affinity or Node Feature Discovery to pick the GPU class, because the resource name does not say which model or partition size you get.
- GKE-specific node pool options for enabling sharing are not covered here; take them from the current GKE documentation. What this note relies on is the label and taint you set yourself, shown next.

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
  --node-labels=pool=gpu-inference,gpu-sharing=exclusive

gcloud container node-pools update "$POOL" \
  --cluster="$CLUSTER" \
  --location="$LOCATION" \
  --node-taints=dedicated=gpu:NoSchedule
```

```hcl title="gpu-pool-node-config.tf (fragment)"
node_config {
  labels = {
    pool        = "gpu-inference"
    gpu-sharing = "exclusive"
  }

  taint {
    key    = "dedicated"
    value  = "gpu"
    effect = "NO_SCHEDULE"
  }
}
```

`update` takes labels and taints in separate commands, and each replaces the pool's whole set of that kind, so list every label and every taint the pool should keep. Check what the nodes actually carry with `kubectl get nodes --show-labels` before relying on a selector.

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
          value: gpu
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

The digest is a placeholder. `runAsNonRoot` only passes if the image declares a numeric non-root user, and with a read-only root filesystem the server needs `emptyDir` mounts for any cache or temp paths it writes. See [[kubernetes-resource-requests-and-limits]] for the CPU and memory side.

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

Size memory before you share. A serving engine such as vLLM claims a fraction of device memory through `gpu_memory_utilization` (0.9 is the value in the documentation's examples and sweeps; check the default for your version). Two engines on one unpartitioned or time-sliced GPU compete for memory, not only compute, and a partition must hold weights plus KV cache with headroom for the engine.

## Dynamic Resource Allocation

DRA is the structured alternative for partitioned devices. It adds device classes, CEL filtering and claim-based sharing across pods, which the device-plugin model does not offer. Two separately gated features cover partitioning: partitionable devices (`DRAPartitionableDevices`), where logical devices consume shared counters so the scheduler will not allocate partitions that together exceed the physical device, and device compatibility groups (`DRADeviceCompatibilityGroups`), which let a driver declare mutually exclusive modes, such as a partition mode and a virtual-GPU mode, so the scheduler rejects that combination. Each depends on your Kubernetes version and feature gates, so confirm the state on the target cluster before recommending it.

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

A sudden jump in allocatable GPUs on a node usually means someone enabled time-slicing or partitioning there. Treat that as a change needing review.

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

- The tenants are mutually untrusted, or the workloads handle different data classifications. Kubernetes separates hard and soft multi-tenancy and says data-plane isolation needs extra attention; time-slicing does not provide it by default.
- One tenant's crash must not affect another. When a device goes unhealthy the kubelet lowers allocatable, but pods already on it keep their assignment and usually fail, so one fault can hit every tenant on that device.
- A latency objective is tight and unmeasured. No local source quantifies noisy-neighbour impact, so measure with a realistic load before promising it.
- Memory use is unpredictable, for example long-context traffic with a large KV cache.

The default for regulated or cross-tenant work is a whole GPU per tenant or a reviewed hardware partition. Time-slicing stays within one trust boundary.

## Failure modes

- **Silent meaning change.** The same `nvidia.com/gpu: 1` request lands on a time-sliced pool and the service meets contention nobody expected.
- **Memory fight.** Two engines each claim most of the device memory and one fails to start or is killed under load.
- **Quota in the wrong unit.** A namespace quota counts slices as devices and a tenant takes far more capacity than budgeted.
- **Fault blast radius.** One device error takes down every pod on a shared GPU, and those pods stay assigned to the failed device, failing or crash-looping rather than moving.
- **Plugin outage.** The kubelet restarts, the plugin does not detect it and re-register, and GPU capacity vanishes from the node. Treat plugin DaemonSet health as a node-level SLO.
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

## Sources

- [Kubernetes: Schedule GPUs](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/): backs `limits` and `requests` rules and node selection for GPU type.
- [Kubernetes: Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) and [Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/): back the `NoSchedule` taint, a toleration with `operator: Equal` matching key, value and effect, and `nodeSelector` on node labels. Checked 2026-11-02 (commit 491f14e).
- `gcloud container node-pools create --help` and `update --help` (Google Cloud SDK 570.0.0): back `--node-labels` and `--node-taints`, the `key=value:NoSchedule` format, and that `update` accepts only one of them per call and replaces all user-specified labels or taints. Checked 2026-11-02 (help text only).
- [Terraform google_container_cluster](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/container_cluster): backs `node_config` `labels` and the `taint` block with `key`, `value` and `effect` (`NO_SCHEDULE`). Checked 2026-11-02 (commit c4248bd).
- [Kubernetes: Resource Quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/): backs `requests.`-only quota for extended resources.
- [Kubernetes: Device Plugins](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/): backs resource naming, integer-only extended resources, unhealthy devices and plugin re-registration after kubelet restarts.
- [Kubernetes: Multi-tenancy](https://kubernetes.io/docs/concepts/security/multi-tenancy/): backs hard versus soft tenancy and data-plane isolation concerns.
- [Kubernetes: Dynamic Resource Allocation](https://kubernetes.io/docs/concepts/resource-management/dynamic-resource-allocation/) and its DRA features page: back device classes, CEL filtering, claims, partitionable devices and compatibility groups. Feature-gate stages were not checked.
- [vLLM metrics design](https://docs.vllm.ai/en/latest/design/metrics/): backs `vllm:kv_cache_usage_perc`.
- [OpenTelemetry GenAI metrics](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/): backs the `gen_ai.server.*` metric names. The URL path is inferred and should be confirmed.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
