---
title: Pod priority classes and preemption
description: Protect critical workloads with tiered PriorityClasses, keep batch jobs non-preempting, and avoid preemption storms on GKE Standard and Autopilot.
type: pattern
tags:
  - patterns
  - kubernetes
  - gke
  - reliability
created: 2026-10-19
modified: 2026-10-19
draft: false
---

When a cluster is full, the scheduler has to decide who waits. Without priorities every Pod is equal, so a nightly batch job can take the last free CPU from a payment service that needs to scale up. Priority classes make that decision explicit: important Pods schedule first and may evict less important ones to get room.

> [!info] Not checked against live docs
> Nothing here was run on a cluster. Check the current Kubernetes docs for the `PriorityClass` fields and the quota `scopeSelector` syntax, and check the GKE docs for what Autopilot allows. Autopilot restricts or manages some scheduling features, and those rules change. The priority values below are illustrative.

## When it matters

Priority is worth setting up when at least one of these is true:

- The cluster runs close to full, with the cluster autoscaler adding nodes slowly.
- Platform daemons (ingress, DNS, logging agents, operators) share nodes with tenant workloads.
- Batch and interactive workloads share a node pool.
- You want spare headroom for fast scale-up (see [Balloon pods](#balloon-pods-for-headroom)).

On an empty cluster with generous autoscaling it changes nothing. It is a tool for contention, not a performance feature.

## How the scheduler uses it

Three effects, in order of importance:

1. **Queue order.** Pending Pods with higher priority are tried first.
2. **Preemption.** If a high priority Pod cannot be placed, the scheduler looks for a node where evicting lower priority Pods would make room. It picks victims, gives them their termination grace period, then places the Pod. Preemption does not guarantee that the PodDisruptionBudget is honoured: it is best effort. See [[pod-disruption-budgets-for-stateless-services]].
3. **Eviction order under node pressure.** Kubelet eviction considers priority together with resource usage relative to requests. Setting requests properly matters more, see [[kubernetes-resource-requests-and-limits]] and [[node-resource-pressure-triage]].

A Pod gets its priority from `spec.priorityClassName`, resolved to a number when the Pod is created. Changing a class later does not rewrite running Pods.

## A tiered class set

Keep the set small. Four tiers is enough for almost every platform.

```yaml title="priority-classes.yaml"
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: platform-critical
value: 1000000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
description: "Cluster add-ons owned by the platform team (ingress, DNS, operators)."
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: prod-high
value: 100000
globalDefault: false
preemptionPolicy: PreemptLowerPriority
description: "Customer-facing production services."
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: standard
value: 1000
globalDefault: true
preemptionPolicy: PreemptLowerPriority
description: "Default for everything that does not say otherwise."
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: batch
value: 100
globalDefault: false
preemptionPolicy: Never
description: "Batch and CI jobs. Wait in the queue, never evict others."
```

Design rules:

- **One `globalDefault: true` only.** Kubernetes allows a single global default. Pods that name no class get it. Without one, Pods default to priority 0. Making `standard` the default and giving it a positive value means a forgotten class cannot end up below `batch`.
- **`preemptionPolicy: Never` for batch.** A non-preempting Pod still queues ahead of lower-priority Pods, but it waits for free capacity instead of evicting running ones. Batch jobs rarely deserve to kill a service.
- **Leave gaps** between values so you can add a tier later without renumbering.
- **Only the platform owns the classes.** Ship them from the cluster bootstrap repository, not from application charts.

## Built-in system classes

Kubernetes ships `system-cluster-critical` and `system-node-critical`, with very high values. They exist for components the cluster cannot run without, such as DNS or the node agent. Application teams must not use them: a Pod with these classes can preempt nearly everything, and usage is normally restricted to the `kube-system` namespace by an admission rule. Check the current docs for the exact restriction in your version. Use `platform-critical` for your own add-ons instead.

## Restricting who may use high classes

Any user who can create a Pod can name any `PriorityClass`. Unless something stops them, a team will mark everything `prod-high`. Two controls:

**ResourceQuota with a priority scope.** This caps how much a namespace may consume at a given class:

```yaml title="quota-prod-high.yaml"
apiVersion: v1
kind: ResourceQuota
metadata:
  name: prod-high-only-here
  namespace: team-a
spec:
  hard:
    pods: "0"
  scopeSelector:
    matchExpressions:
      - operator: In
        scopeName: PriorityClass
        values: ["prod-high"]
```

With `pods: "0"`, namespace `team-a` cannot run any `prod-high` Pod. In namespaces that are allowed, set real limits for `cpu`, `memory` and `pods` instead of zero. This pattern gives an allow-list by quota: apply the zero quota to every tenant namespace by default, and raise it for those with an agreed production tier. Check the quota docs for the scope selector syntax on your version.

**Admission policy.** A Kyverno or ValidatingAdmissionPolicy rule that rejects `priorityClassName` values not on a per-namespace allow-list is more explicit and gives better error messages. See [[conftest-policy-gate-for-manifests]] for the CI-side equivalent and [[gke-platform-topology-and-tenancy]] for how namespaces map to teams.

## Balloon pods for headroom

The cluster autoscaler adds a node only after a Pod is Pending, and a new node takes minutes. To get instant capacity, run a low-priority Deployment of "balloon" Pods that do nothing but request resources.

```yaml title="balloon.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: headroom
  namespace: platform
spec:
  replicas: 3
  selector:
    matchLabels:
      app: headroom
  template:
    metadata:
      labels:
        app: headroom
    spec:
      priorityClassName: headroom-low
      terminationGracePeriodSeconds: 0
      containers:
        - name: pause
          image: registry.k8s.io/pause:3.9
          resources:
            requests:
              cpu: "1"
              memory: 1Gi
```

This needs a `headroom-low` PriorityClass with a value below `batch` (for example 10, or negative; check the docs for allowed ranges). When a real Pod arrives, it preempts a balloon Pod and starts immediately; the evicted balloon goes Pending and triggers the autoscaler to add a node in the background. You pay for the idle capacity. Size it from observed scale-up bursts, and see [[kubernetes-autoscaling]].

Verify the image tag in your own registry mirror before using it. The tag above is an example.

## GKE Standard and Autopilot

On **Standard**, you control node pools and the classes work as described. Separate node pools plus taints are still the stronger isolation tool when you need guarantees, since priority only decides who loses under contention.

On **Autopilot**, Google manages nodes and capacity. Some scheduling features are restricted and the balloon pattern may behave differently, because capacity is provisioned per Pod. Do not assume the Standard behaviour. Read the Autopilot capacity provisioning page linked in the sources and test in a non-production cluster.

## Stateful workloads

A preempted stateful Pod is a disruption you did not plan: a database replica evicted by a batch burst will fail over or lose quorum. Give stateful workloads a class high enough that routine batch never preempts them, set their PDBs per [[stateful-workloads-gke]], and keep batch non-preempting. Do not put quorum members at the same priority as the best-effort workloads sharing their nodes.

## Failure modes

| Symptom                                         | Cause                                                           | Fix                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Everything is `prod-high`                       | No restriction on who may use the class                         | Quota scope or admission allow-list                                            |
| Preemption cascade: A evicts B, B evicts C      | Many tiers, tight capacity, all with `PreemptLowerPriority`     | Fewer tiers, `Never` for batch, add capacity or headroom                       |
| Evicted Pod loops through Pending and Running   | Evicted workload has higher requests than it can ever get again | Right-size requests, add node pool capacity                                    |
| High priority Pod still Pending                 | Preemption would not help: taints, affinity or volume zone      | Read the Pod events: the scheduler states why no node qualified                |
| Service dropped below its PDB during a burst    | Preemption does not honour PDBs strictly                        | Give it a higher class than the aggressor, add capacity                        |
| New default class changes behaviour of old Pods | `globalDefault` applies to Pods created after the change        | Introduce the default before workloads exist, or roll deployments after change |

## Verify

```bash title="inspect classes and preemptions"
kubectl get priorityclass
kubectl get pod -A -o custom-columns=NS:.metadata.namespace,NAME:.metadata.name,CLASS:.spec.priorityClassName,PRIO:.spec.priority | sort -k3 | head -50
kubectl get events -A --field-selector reason=Preempted
```

Test in staging: fill a node pool with `batch` Pods, then create a `prod-high` Pod and confirm the batch Pod is evicted and the high priority Pod is scheduled. Then create a `batch` Pod on a full cluster and confirm it stays Pending without evicting anything.

For monitoring, count Pending Pods per class and alert when `prod-high` Pods stay Pending for several minutes. Scheduler preemption metrics exist too; check the scheduler metrics list for your version.

## Rollback

1. Stop new use: remove the class from the offending chart, or relax the admission rule.
2. Existing Pods keep their resolved priority number, so changing a class value has no effect on them until they are recreated. Roll the Deployments.
3. A `PriorityClass` that is in use can still be deleted, but new Pods that name it are rejected. Remove references first.
4. To undo `globalDefault`, set another class as default or none, then roll workloads.

## Related

- [[kubernetes-resource-requests-and-limits]]
- [[kubernetes-autoscaling]]
- [[stateful-workloads-gke]]
- [[pod-disruption-budgets-for-stateless-services]]
- [[gke-platform-topology-and-tenancy]]
- [[node-resource-pressure-triage]]

## Sources

- https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/
- https://kubernetes.io/docs/concepts/policy/resource-quotas/
- https://cloud.google.com/kubernetes-engine/docs/how-to/capacity-provisioning
