---
title: Namespace resource quotas and LimitRanges
description: Bound namespace resource allocations without blocking rollouts, and distinguish quota admission failures from scheduling failures.
type: pattern
tags:
  - patterns
  - kubernetes
  - reliability
  - cost
created: 2026-10-29
modified: 2026-10-30
draft: false
evidence: source-reviewed
reviewed: 2026-10-29
review-due: 2027-04-29
---

Use ResourceQuota to bound a namespace's aggregate allocations and object counts. Use LimitRange to supply container defaults and constrain individual allocations. Neither reserves physical cluster capacity nor replaces [[kubernetes-resource-requests-and-limits|workload sizing]].

## What each policy controls

| Policy                       | Enforced against                                                                           | What it does not do                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| ResourceQuota                | Aggregate requests, limits, storage requests and selected object counts within a namespace | Guarantee nodes exist, distribute capacity fairly between pending workloads, or measure actual CPU usage |
| LimitRange                   | Individual container, Pod or PVC resource specifications                                   | Resize existing Pods when the policy changes                                                             |
| Node capacity and scheduling | Admitted Pods and their placement constraints                                              | Admit a Pod that quota enforcement has rejected                                                          |

Quota violations reject API requests with `403 Forbidden`. A Deployment can be accepted while its ReplicaSet cannot create Pods: a successful apply is not a successful rollout. Conversely, an admitted Pod with `FailedScheduling` events is a scheduler problem, not necessarily a quota problem.

## A namespace baseline

This example budgets CPU **requests**, not CPU limits: the LimitRange defaults a CPU request but sets no default CPU limit, so containers that omit one are not throttled (see [[kubernetes-resource-requests-and-limits]] for that trade-off). Memory gets both a default request and a default limit because the quota caps `limits.memory`. If the namespace must enforce CPU limits, add a `cpu` entry to `default` and `limits.cpu` to the quota together.

```yaml title="namespace-budget.yaml"
apiVersion: v1
kind: LimitRange
metadata:
  name: container-defaults
  namespace: team-a
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      default:
        memory: 512Mi
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: namespace-budget
  namespace: team-a
spec:
  hard:
    requests.cpu: "8"
    requests.memory: 16Gi
    limits.memory: 32Gi
    pods: "40"
    count/jobs.batch: "20"
    persistentvolumeclaims: "10"
    requests.storage: 200Gi
```

These are illustrative budgets, not production sizing. The namespace must already exist. Review the rendered resources from every workload, including sidecars and batch jobs, before adopting the policy.

LimitRange defaulting occurs during admission; quota evaluates the resulting resource requirements. LimitRange does not check its defaults against what a container asks for: a container requesting `1Gi` of memory without a memory limit gets this example's injected `512Mi` limit, a request above its limit, and the API server rejects the Pod as invalid (the request must be less than or equal to the limit). Workloads above the defaults must set compatible explicit requests and limits. Keep one defaults-owning LimitRange per namespace: with multiple LimitRanges, selection of defaults is not deterministic.

The `pods` quota counts non-terminal Pods. `count/jobs.batch` counts Job objects, including completed Jobs that still exist. Choose history retention in [[patterns/kubernetes-jobs-and-cronjobs|Jobs and CronJobs]] alongside the object budget.

## Budget for peaks, not the steady state

As an engineering sizing rule, budget the maximum simultaneous allocations from services at their HPA ceiling, rollout surge, Jobs and sidecars, then add measured headroom. Do the calculation independently for every quota dimension.

For example, ten single-container replicas requesting `500m` CPU need five CPU of request quota. A rollout with two additional replicas needs six CPU before counting anything else in the namespace. Eight CPU of quota does not ensure the cluster can actually schedule six CPU of requests.

Do not treat the sum of all namespace quotas as available cluster capacity. Quotas can collectively exceed capacity; admitted workloads may still be pending. Connect quota planning to [[kubernetes-autoscaling]] and [[zero-downtime-deployments-kubernetes]].

## Rollout and verification

Start with a representative non-production namespace. Record existing policies and usage, then review and apply the manifest through the normal delivery path. ResourceQuota has no built-in audit-only mode; introducing one can immediately block new admissions.

```bash
NAMESPACE="team-a"

kubectl get resourcequota,limitrange --namespace "${NAMESPACE}" -o yaml
kubectl describe resourcequota --namespace "${NAMESPACE}"
kubectl describe limitrange --namespace "${NAMESPACE}"
kubectl get deployment,replicaset,pods --namespace "${NAMESPACE}"
kubectl get events --namespace "${NAMESPACE}" --sort-by=.metadata.creationTimestamp
```

After rollout, require all intended replicas to become ready, inspect the admitted Pods' `resources`, and compare quota usage with the calculated peak. In a disposable namespace, test a Pod with missing resources, an explicit request above the default limit, and a workload above the quota. Record which objects are rejected and check controller events for `FailedCreate`.

Server-side dry-run can check an individual admission request, but is not a simulation of many concurrent Pod creations. Dry-running a Deployment does not exercise admission for its future Pods.

## Failure handling and recovery

- **Pod never exists:** inspect ReplicaSet events and the API error. Correct the missing resource field or insufficient quota rather than adding nodes.
- **Pod exists but is pending:** inspect scheduling events, node capacity, affinity and volume constraints.
- **Previously healthy workload cannot roll out:** compare quota usage with surge and HPA peaks. Existing Pods are not evicted to make room.
- **Defaults surprise a team:** make resource declarations explicit and review their HPA implications before changing the defaults.

Recover by restoring the previously reviewed quota and LimitRange manifests through the same delivery path. Reverting a LimitRange does not undo defaults already injected into existing Pods; inspect newly created Pods during the next controlled rollout. Restrict permission to modify these policies so the quota is an enforced boundary, not a suggestion.

## Evidence

### Sources checked

- [Kubernetes resource quotas](https://kubernetes.io/docs/concepts/policy/resource-quotas/): namespace scope, rejection semantics, controller admission, quota keys and non-retroactive enforcement; checked 2026-10-29.
- [Kubernetes LimitRanges](https://kubernetes.io/docs/concepts/policy/limit-range/): defaulting, request/limit conflicts, multiple-default ambiguity and unchanged existing Pods; checked 2026-10-29.
- Kubernetes website source for the two pages above ([kubernetes/website](https://github.com/kubernetes/website/tree/main/content/en/docs/concepts/policy), commit `491f14e`): `403 Forbidden` rejections, `pods` counting only non-terminal Pods, `count/jobs.batch`, non-deterministic defaults with several LimitRanges and defaults not checked against requests; checked 2026-10-30.

### Not verified

No cluster commands or admission experiments were run. The budgets and rollout checklist are engineering recommendations; distribution-specific admission changes and capacity must be checked on the target cluster.

## Related

- [[kubernetes-resource-requests-and-limits]]
- [[kubernetes-autoscaling]]
- [[gke-platform-topology-and-tenancy]]
