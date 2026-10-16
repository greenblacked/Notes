---
title: Kubernetes resource requests and limits
description: How requests and limits drive scheduling, QoS and throttling, how to size them from real usage, and the traps with GKE Autopilot, the JVM and Go.
type: pattern
tags:
  - patterns
  - kubernetes
  - gke
  - reliability
  - cost
created: 2026-10-16
modified: 2026-10-16
draft: false
---

Requests and limits are the contract between a workload and the cluster. Wrong values show up as evictions, OOM kills, CPU throttling, unschedulable Pods and a large cloud bill, usually at the worst time. The semantics are described in the Kubernetes documentation ("Resource Management for Pods and Containers"); this note is the working method.

## What each setting does

| Setting                            | Used by                 | Effect                                                                                                                                                                                                 |
| ---------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `requests.cpu` / `requests.memory` | Scheduler, kubelet, HPA | The amount reserved for the Pod on a node. The scheduler places a Pod only where the sum of requests fits the node's allocatable capacity. CPU request also sets relative CPU weight under contention. |
| `limits.cpu`                       | Linux CFS quota         | A hard ceiling per scheduling period. Exceeding it throttles the container; it is not killed.                                                                                                          |
| `limits.memory`                    | cgroup memory limit     | A hard ceiling. Exceeding it triggers the OOM killer for that container.                                                                                                                               |

Key consequences:

- **Scheduling uses requests, not usage.** A cluster can be 20 percent utilised and still full if requests are inflated.
- **CPU is compressible, memory is not.** CPU pressure slows things down. Memory pressure kills things.
- **HPA percentages are relative to requests.** A CPU target of 70 percent means 70 percent of the request, so an inflated request makes autoscaling slow to react and a tiny one makes it flap.

### Ephemeral storage

`ephemeral-storage` is a third resource you can request and limit. It covers the container's writable layer, container logs and `emptyDir` volumes that do not use `medium: Memory`. Requests are used for scheduling against the node's allocatable ephemeral storage. A Pod that exceeds its ephemeral-storage limit is evicted by the kubelet, not throttled, and a node under disk pressure evicts Pods too.

```yaml title="deployment.yaml (excerpt)"
resources:
  requests:
    ephemeral-storage: 1Gi # example size
  limits:
    ephemeral-storage: 2Gi # example size
```

The sizes above are examples. Size them from observed usage, and keep large scratch data on a persistent volume or object storage instead.

## QoS classes

Kubernetes derives a QoS class from the requests and limits. It decides eviction order under node pressure.

| Class      | Condition                                                   | Eviction priority |
| ---------- | ----------------------------------------------------------- | ----------------- |
| Guaranteed | Every container has CPU and memory requests equal to limits | Last              |
| Burstable  | At least one request or limit set, but not Guaranteed       | Middle            |
| BestEffort | No requests or limits at all                                | First             |

See the class on a running Pod:

```bash
NAMESPACE="payments"
POD="my-service-7d9f6c9b8-abcde"

kubectl get pod "${POD}" --namespace "${NAMESPACE}" -o jsonpath='{.status.qosClass}{"\n"}'
```

Never run production workloads as BestEffort. For most services Burstable is correct. Use Guaranteed for the few that must not be evicted (databases, ingress controllers).

## CPU throttling vs OOMKill

These look similar from the outside (a slow or restarting service) and have opposite fixes.

**CPU throttling.** The container is not killed; it just stops running for the rest of each CFS period once it has used its quota. Latency spikes with no error. Detect it with cAdvisor metrics in Prometheus:

```text
sum by (namespace, pod, container) (
  rate(container_cpu_cfs_throttled_periods_total[5m])
)
/
sum by (namespace, pod, container) (
  rate(container_cpu_cfs_periods_total[5m])
)
```

A sustained ratio above a few percent on a latency-sensitive service is a problem. Fixes are to raise the CPU limit, or remove it and rely on requests. Many teams set CPU requests but no CPU limit for exactly this reason; this is a trade-off, not a rule. Without a limit a noisy neighbour can use idle CPU, but requests still guarantee your share under contention. Namespaces with a ResourceQuota on limits, or Autopilot, may force a limit anyway.

**OOMKill.** The container exceeds its memory limit and is killed with exit code 137. Confirm:

```bash
kubectl describe pod "${POD}" --namespace "${NAMESPACE}" | grep -A5 'Last State'
kubectl get pod "${POD}" --namespace "${NAMESPACE}" \
  -o jsonpath='{.status.containerStatuses[*].lastState.terminated.reason}{"\n"}'
```

The reason is `OOMKilled`. The fix is to raise the limit or reduce the application's memory, never to raise only the request. Do not forget that a node can also be out of memory, in which case the kubelet evicts Pods; that shows as `Evicted`, not `OOMKilled`. Troubleshooting steps are in [[kubernetes-pod-troubleshooting]].

## Sizing from real usage

Do not guess. Measure under representative load, then add headroom.

1. **Point-in-time view**, to sanity check:

```bash
kubectl top pod --namespace "${NAMESPACE}" --containers
kubectl top node
```

`kubectl top` needs metrics-server (present on GKE by default) and shows only current values.

2. **History from Prometheus or Cloud Monitoring.** Look at least a week, including peak days and deploys:

```text
# Peak working set memory per container over 7 days
max_over_time(container_memory_working_set_bytes{namespace="payments", container="app"}[7d])

# CPU usage 95th percentile
quantile_over_time(0.95, rate(container_cpu_usage_seconds_total{namespace="payments", container="app"}[5m])[7d:5m])
```

`container_memory_working_set_bytes` is the figure the kubelet uses for eviction decisions and is the right one for sizing; OOM decisions track memory including some cache, so keep headroom.

3. **Vertical Pod Autoscaler in recommendation mode.** Install the VPA (on GKE, enable vertical Pod autoscaling on the cluster) and create an object that only recommends:

```yaml title="vpa.yaml"
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: my-service
  namespace: payments
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-service
  updatePolicy:
    updateMode: "Off"
```

```bash
kubectl get vpa my-service --namespace payments -o jsonpath='{.status.recommendation.containerRecommendations}{"\n"}'
```

`updateMode: "Off"` produces recommendations without restarting anything. Use them as input to a reviewed change in the chart values, not as an autopilot. Do not run VPA in an updating mode and HPA on the same CPU or memory metric for the same workload; they fight.

4. **Apply a rule**, then revisit. A common starting point: memory request equal to memory limit at peak plus 20 to 30 percent headroom; CPU request near the 90th to 95th percentile of steady-state usage. Re-check after major releases and quarterly. Record the sizing rationale in the chart values comment so the next person can challenge it.

Recent Kubernetes versions can resize a running container's resources in place without recreating the Pod, but support depends on the version and the cluster; check the current Kubernetes documentation and your GKE version before relying on it.

**Investigating evictions.** If Pods disappear with status `Evicted`, list them and check the node for disk pressure; the steps after that are in [[kubernetes-pod-troubleshooting]]:

```bash
NODE="gke-platform-1-pool-1-abcd"   # example node name

kubectl get events -A --field-selector reason=Evicted
kubectl describe node "${NODE}" | grep -A8 Conditions   # look for DiskPressure and MemoryPressure
```

## LimitRange and ResourceQuota

These are namespace guardrails. A LimitRange sets defaults and bounds per container so a forgotten spec does not create a BestEffort Pod; a ResourceQuota caps the total a namespace can request.

```yaml title="namespace-guardrails.yaml"
apiVersion: v1
kind: LimitRange
metadata:
  name: defaults
  namespace: payments
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      default:
        memory: 512Mi
      max:
        memory: 4Gi
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute
  namespace: payments
spec:
  hard:
    requests.cpu: "20"
    requests.memory: 64Gi
    limits.memory: 96Gi
    pods: "200"
```

Once a quota covers a resource, every Pod in the namespace must specify it, or it is rejected. The LimitRange defaults are what keep that from breaking deployments. Defaults only apply at admission; they do not fix existing Pods.

## GKE Autopilot notes

On Autopilot you pay for the resources your Pods request, not for nodes, so requests are directly your bill. Autopilot also enforces minimum and maximum request values, may adjust requests (for example to meet ratios or minimums), and applies different behaviour to Pods that burst. The exact minimums, ratios, supported compute classes and billing rules change between releases. Check the GKE Autopilot documentation ("Resource requests in Autopilot") for the current figures instead of copying numbers from a note. Practical points that stay true: set requests deliberately for every container including sidecars, expect Autopilot to mutate the Pod spec if you are below its minimums, and compare what you asked for with what was applied:

```bash
kubectl get pod "${POD}" --namespace "${NAMESPACE}" -o jsonpath='{.spec.containers[*].resources}{"\n"}'
```

## Runtime caveats

**JVM.** Modern JVMs are container-aware and size the heap from the cgroup limit. Use percentages rather than fixed `-Xmx`, and leave room for non-heap memory (metaspace, thread stacks, direct buffers, code cache):

```bash
JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70 -XX:InitialRAMPercentage=50"
```

A container limit of 1 GiB with `-Xmx1g` will be OOM killed. The JVM also derives the number of GC and compiler threads from the visible CPUs, so very low CPU limits (under one core) can hurt startup and throttle hard; give JVM services at least a full core of request. Startup is CPU-heavy, so combine with a startup probe rather than a long liveness delay; see [[zero-downtime-deployments-kubernetes]].

**Go.** The Go runtime does not stop at the container's memory limit by default; set a soft limit below it so the garbage collector works harder before the kernel kills the process:

```bash
GOMEMLIMIT=450MiB   # for a 512Mi container limit; leave headroom for non-Go memory
```

Since Go 1.25, the runtime sets `GOMAXPROCS` from the container CPU limit on Linux when `GOMAXPROCS` is not set explicitly, and updates it if the limit changes; `GODEBUG` settings can turn this off (see the Go 1.25 release notes). On older Go versions set it explicitly (downward API `resourceFieldRef` on `limits.cpu`) or use `automaxprocs`. The runtime does not read the memory limit: set `GOMEMLIMIT` a little below the container memory limit.

**Node.js, Python.** Set the old-space or worker count explicitly (for example `--max-old-space-size`) so it fits inside the memory limit.

## Rollout practice

- Put requests and limits in the chart values, per environment ([[helm-chart-conventions]]), reviewed like code.
- Alert on throttling ratio, restarts with reason `OOMKilled`, and Pending Pods; wire them into your SLO alerting ([[slo-burn-rate-alerting]]).
- Check cost impact when you change requests across many workloads; requests are what you reserve and pay for.
