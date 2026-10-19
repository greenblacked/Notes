---
title: Spreading stateless replicas across zones and nodes on GKE
description: Use topologySpreadConstraints to spread replicas across zones and nodes, pick whenUnsatisfiable, and combine spread with PDBs, HPA and regional node pools.
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

Three replicas that all land on one node, or in one zone, are one failure from an outage. `topologySpreadConstraints` tell the scheduler to keep replicas evenly spread across failure domains. On a regional GKE cluster this is the cheapest way to survive the loss of a zone or of a single node.

> [!info] Not checked against live docs
> Nothing here was run on a cluster. Check the current Kubernetes docs for the release in which `minDomains` and `matchLabelKeys` became stable, and for the defaults of `nodeAffinityPolicy` and `nodeTaintsPolicy`. If your control plane is older, the fields may be rejected or silently dropped. Use `kubectl explain pod.spec.topologySpreadConstraints` to see what your cluster supports.

Scope: stateless services. Spread for StatefulSets and quorum workloads, including regional disks, lives in [[stateful-workloads-gke]].

## Why anti-affinity alone is not enough

Pod anti-affinity can say "never put two of these on the same node" (required) or "prefer not to" (preferred). Both are blunt:

- Required anti-affinity makes the 4th replica unschedulable on a 3-node pool, even though two per node would be fine.
- Preferred anti-affinity is a weight, and under pressure the scheduler ignores it.
- Neither can express "at most one more in zone A than in zone B".

Topology spread states the goal as a number, the maximum **skew**: the difference in matching Pod count between the most and least loaded domain.

## Two constraints: zone and node

Use both. The zone constraint protects against a zone outage. The node constraint protects against a single node loss and makes a drain touch fewer replicas.

```yaml title="deployment.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: shop
spec:
  replicas: 6
  selector:
    matchLabels:
      app.kubernetes.io/name: checkout
  template:
    metadata:
      labels:
        app.kubernetes.io/name: checkout
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: checkout
          matchLabelKeys:
            - pod-template-hash
        - maxSkew: 1
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: checkout
          matchLabelKeys:
            - pod-template-hash
      containers:
        - name: app
          image: registry.example.com/shop/checkout:1.0.0
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
```

The example hard-enforces the zone spread and softly prefers the node spread. That combination is the usual default for a service with a modest replica count.

## The fields that matter

**`maxSkew`.** The allowed difference between domains. `1` means perfectly even, or off by one. Larger values trade evenness for schedulability.

**`topologyKey`.** A node label. `topology.kubernetes.io/zone` and `kubernetes.io/hostname` are set by GKE. Every eligible node must carry the label, or the constraint cannot count it.

**`whenUnsatisfiable`.**

| Value            | Behaviour                                                | Use when                                                                     |
| ---------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `DoNotSchedule`  | The Pod stays Pending if placing it would break the skew | Zone spread for services where losing a zone must not take them out          |
| `ScheduleAnyway` | The scheduler prefers the best option but never blocks   | Node spread, or any service where being scheduled beats being perfectly even |

**`labelSelector`.** Which Pods are counted. It must match the Pods of this workload only.

**`matchLabelKeys` with `pod-template-hash`.** During a rolling update, old and new ReplicaSet Pods carry the same app labels. Without this key the scheduler counts both generations together, and the new Pods get spread relative to Pods that are about to disappear. Adding `pod-template-hash` makes each generation spread on its own. Check the docs for the release in which this became generally available.

**`minDomains`.** With `DoNotSchedule`, requires at least this many domains to exist before the skew rule is considered satisfied. Setting `minDomains: 3` on a three-zone region means that if only two zones have eligible nodes, extra Pods stay Pending rather than piling into two zones. This pairs well with the cluster autoscaler, which then adds a node in the missing zone. Check the docs for the release status and the constraint that it applies only with `DoNotSchedule`.

**`nodeAffinityPolicy` and `nodeTaintsPolicy`.** They decide whether nodes excluded by the Pod's node affinity or taints still count as domains. Check the current defaults; they matter when a Pod is restricted to a tainted node pool, because an excluded zone with no eligible nodes can otherwise block scheduling.

## Regional clusters, node pools and the autoscaler

A regional GKE cluster has nodes in several zones, and a node pool can span all of them or a subset. Spread only works over domains that actually have nodes (or will get them):

- A pool restricted to two zones gives a two-zone world, whatever the region offers. Confirm with `gcloud container node-pools describe`.
- With `DoNotSchedule` the cluster autoscaler sees a Pending Pod and can scale up the pool in the zone that is lacking capacity. Check the GKE autoscaler docs for how it handles zonal constraints, including location policy options such as balanced versus any.
- Autoscaler scale-down removes nodes by utilisation and does not know about spread. After scale-down the skew can exceed `maxSkew`.

See [[kubernetes-autoscaling]] for HPA and cluster autoscaler behaviour.

## Spread applies only at scheduling time

The scheduler evaluates spread when it places a Pod. It never moves a running Pod. So skew appears when:

- Replicas are removed unevenly (HPA scale-down, a node deleted, a failed zone recovering).
- Nodes are added after Pods already settled elsewhere.
- Pods were placed with `ScheduleAnyway` under pressure.

Options, from simplest:

1. Do nothing. A rolling update recreates Pods, and with `pod-template-hash` in `matchLabelKeys` the new generation is spread correctly.
2. Run `kubectl rollout restart` during a quiet period after a major capacity event.
3. Run the Kubernetes descheduler with its topology spread strategy to evict Pods that violate constraints. It adds a component to operate and relies on PDBs to stay safe. See [[pod-disruption-budgets-for-stateless-services]].

## Cluster-wide defaults

Kubernetes can apply default spread constraints to Pods that define none (the scheduler configuration has `defaultConstraints`). On GKE the control plane scheduler configuration is managed by Google, so check what the managed default is before relying on it. Set explicit constraints in the chart; a reusable Helm helper keeps them consistent, see [[helm-chart-conventions]].

## Failure modes

| Symptom                                          | Cause                                                           | Fix                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Pods Pending, events mention unsatisfied spread  | `DoNotSchedule`, a zone has no capacity or quota                | Add capacity in that zone, check IP and CPU quota, or use `ScheduleAnyway` for node spread |
| Pods Pending after a zone outage                 | Hard zone constraint with `maxSkew: 1` and fewer eligible zones | Accept `ScheduleAnyway` for the zone constraint, or run enough replicas                    |
| Rollout stalls halfway                           | Surge Pods cannot satisfy the skew while old Pods still count   | Add `matchLabelKeys: [pod-template-hash]`, raise `maxSurge`                                |
| Uneven zones after scale-down                    | Spread is not re-evaluated for running Pods                     | Restart the rollout or use the descheduler                                                 |
| Constraint ignored by a single-zone pool         | Only one domain exists                                          | Add zones to the node pool                                                                 |
| Everything lands in one zone despite constraints | `labelSelector` matches no Pods, so the count is always zero    | Fix the selector, compare it to the Pod labels                                             |

## Verify

Count replicas per zone by joining Pods to node labels:

```bash title="pods per zone"
NS=shop
APP=checkout

for node in $(kubectl -n "${NS}" get pods -l app.kubernetes.io/name="${APP}" \
    -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}'); do
  kubectl get node "${node}" -o jsonpath='{.metadata.labels.topology\.kubernetes\.io/zone}{"\n"}'
done | sort | uniq -c
```

A healthy six-replica service over three zones prints `2` for each. Repeat with `kubernetes.io/hostname` to see the per-node spread.

In staging, test the failure you care about: cordon and drain all nodes in one zone and watch where the replicas go and whether any stay Pending. Use a server-side dry run first, `kubectl drain NODE_NAME --dry-run=server`, as described in [[pod-disruption-budgets-for-stateless-services]].

## Rollback

Spread constraints are part of the Pod template, so changing them triggers a rollout.

1. Relax the constraint in Git: `DoNotSchedule` to `ScheduleAnyway`, or raise `maxSkew`.
2. Let the rollout finish. Pending Pods from the strict version are replaced.
3. If an emergency needs Pods running now, apply the change with a quick `kubectl patch` and reconcile Git straight after, since GitOps will otherwise revert it.
4. Recheck the zone count after capacity is restored, then restore the strict setting.

## Checklist

- Zone constraint with `DoNotSchedule` and node constraint with `ScheduleAnyway` as a starting point.
- `matchLabelKeys: [pod-template-hash]` where the control plane supports it.
- At least as many replicas as zones, and node pools that actually cover the zones.
- A PDB per [[pod-disruption-budgets-for-stateless-services]], tested with a drain in staging.
- Requests set, see [[kubernetes-resource-requests-and-limits]], so the scheduler has real numbers.

## Related

- [[stateful-workloads-gke]]
- [[zero-downtime-deployments-kubernetes]]
- [[kubernetes-autoscaling]]
- [[pod-disruption-budgets-for-stateless-services]]
- [[gke-platform-topology-and-tenancy]]
- [[gke-node-pool-upgrade-strategies]]

## Sources

- [kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/)
- [cloud.google.com/kubernetes-engine/docs/concepts/regional-clusters](https://cloud.google.com/kubernetes-engine/docs/concepts/regional-clusters)
