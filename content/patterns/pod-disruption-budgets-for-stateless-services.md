---
title: PodDisruptionBudgets for stateless services
description: Choose minAvailable or maxUnavailable, set the unhealthy pod eviction policy, and avoid PDBs that deadlock GKE upgrades and node drains.
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

A PodDisruptionBudget (PDB) limits how many replicas of a workload the cluster may take down voluntarily at the same time. Node drains, GKE node pool upgrades and cluster autoscaler scale-downs all ask the Eviction API for permission, and the PDB is what answers. A good PDB turns a node upgrade into a non-event. A bad one either gives no protection or blocks the upgrade for hours.

> [!info] Not checked against live docs
> Nothing here was run against a live cluster. Check in the current Kubernetes docs: the release in which `spec.unhealthyPodEvictionPolicy` became stable, the exact behaviour of percentage rounding, and how GKE treats a PDB that blocks a drain during an upgrade (the timeout is a GKE detail that changes). Confirm field names with `kubectl explain poddisruptionbudget.spec`.

Scope: this note covers stateless services. Quorum-based stateful workloads need their own sizing, covered in [[stateful-workloads-gke]].

## Voluntary and involuntary disruption

A PDB only guards **voluntary** disruptions, the ones that go through the Eviction API:

- `kubectl drain` and node pool upgrades.
- Cluster autoscaler removing an underused node.
- Preemption by a higher priority pod is best effort and may ignore the budget (see [[priority-classes-and-preemption]]).

It does nothing for **involuntary** disruption: a node crash, an out-of-memory kill, a zone outage or a spot VM reclaim. Replica count, spread and health checks cover those, see [[topology-spread-constraints-gke]] and [[zero-downtime-deployments-kubernetes]]. A PDB is one layer, not an availability design.

Deleting a Pod directly, or scaling a Deployment down, also bypasses it. Only evictions are checked.

## minAvailable or maxUnavailable

You set one of the two, never both.

| Field            | Meaning                                  | Behaviour with HPA                                                       |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| `minAvailable`   | Healthy pods that must stay up           | Fixed floor. At low replica counts it can leave room for no eviction.    |
| `maxUnavailable` | Pods that may be down at the same moment | Scales with the replica count, so drain speed grows as the HPA scales up |

For stateless services behind an HPA, prefer `maxUnavailable`. With `minAvailable: 4` a deployment scaled down to 4 replicas has zero allowed disruptions and blocks every drain. With `maxUnavailable: 25%` the same deployment always allows some progress once it has enough replicas.

Percentages are rounded by Kubernetes. Check the current docs for the rounding direction, because it decides whether 25% of 3 replicas is zero or one. Integers avoid the question when the replica count is small and fixed.

## A complete example

```yaml title="pdb.yaml"
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: checkout
  namespace: shop
spec:
  maxUnavailable: 1
  unhealthyPodEvictionPolicy: AlwaysAllow
  selector:
    matchLabels:
      app.kubernetes.io/name: checkout
```

The selector must match the Pods of exactly one workload. Reuse the same labels the Deployment's own selector uses, as set out in [[helm-chart-conventions]].

Ship the PDB in the same Helm chart or Kustomize base as the Deployment, so that a service never exists without one. Enforce this with a policy gate, see [A policy check](#a-policy-check).

## Unhealthy pods and the eviction policy

By default (`IfHealthyBudget`) an unhealthy Pod, one that is Running but not Ready, can only be evicted if the budget is currently healthy. Consider a crash-looping replica on a node you want to drain: the budget is already at its limit because of the unhealthy Pod, so the eviction is refused, and the drain waits on a Pod that is useless anyway.

`unhealthyPodEvictionPolicy: AlwaysAllow` lets such Pods be evicted regardless of the budget. For stateless services this is almost always the right choice, because evicting a not-ready pod costs no capacity. Keep `IfHealthyBudget` for workloads where a not-ready Pod might still be doing something useful, such as a database member that is catching up.

Check the current docs for the release where this field became stable, and for how it behaves on your GKE version. If your control plane predates it, the field is rejected or ignored.

## Interactions

**HPA.** The HPA changes the replica count, the PDB does not. With `maxUnavailable` the allowed disruptions follow. See [[kubernetes-autoscaling]].

**Surge upgrades.** A GKE surge upgrade creates extra nodes, cordons old ones and drains them. Each drain is a series of evictions that the PDB gates. Details of the strategies are in [[gke-node-pool-upgrade-strategies]].

**Cluster autoscaler.** It will not remove a node when doing so would violate a PDB, so an over-tight budget shows up as nodes that never scale down and a higher bill.

**Readiness.** Allowed disruptions are computed from Ready pods. If the replacement Pod takes two minutes to become Ready, the next eviction waits two minutes. Slow startup multiplies drain time by the number of nodes.

## Pitfalls

1. **Single replica with `minAvailable: 1`.** Zero disruptions allowed, forever. The drain blocks until someone deletes the Pod. Either run at least two replicas or do not create a PDB for that service (and accept downtime on upgrade).
2. **`maxUnavailable: 0`.** Same effect as above, written differently. It is sometimes added on purpose by people who want the cluster to never touch the service. That is an outage plan for the upgrade, not a protection.
3. **A selector that matches nothing.** The PDB is valid and protects nothing. `ALLOWED DISRUPTIONS` shows 0 and `EXPECTED PODS` shows 0. Check the label spelling.
4. **A selector that matches Pods from two workloads.** The budget is shared, and one noisy service eats the other's allowance.
5. **Two PDBs selecting the same Pod.** Eviction is refused with an error, since Kubernetes does not know which to honour.
6. **A budget larger than the capacity the service actually needs.** `minAvailable: 100%` is another form of zero.

## A policy check

Catch these at pull request time instead of during an upgrade. The Rego below is for Conftest; the same idea works in Kyverno. See [[conftest-policy-gate-for-manifests]] for how to wire a gate in CI.

```rego title="policy/pdb.rego"
package main

import rego.v1

deny contains msg if {
  input.kind == "PodDisruptionBudget"
  input.spec.maxUnavailable == 0
  msg := sprintf("PDB %s: maxUnavailable 0 blocks every drain", [input.metadata.name])
}

deny contains msg if {
  input.kind == "PodDisruptionBudget"
  input.spec.minAvailable == "100%"
  msg := sprintf("PDB %s: minAvailable 100%% blocks every drain", [input.metadata.name])
}

deny contains msg if {
  input.kind == "PodDisruptionBudget"
  not input.spec.unhealthyPodEvictionPolicy
  msg := sprintf("PDB %s: set unhealthyPodEvictionPolicy explicitly", [input.metadata.name])
}
```

A check for "Deployment with more than one replica has a PDB" needs the whole rendered manifest set, which Conftest can read with `--combine`. Check the Conftest docs for the exact input shape in your version.

## Audit before an upgrade

List every PDB that currently allows no disruption:

```bash title="pre-upgrade audit"
kubectl get pdb -A

kubectl get pdb -A -o json | jq -r '
  .items[]
  | select(.status.disruptionsAllowed == 0)
  | [.metadata.namespace, .metadata.name,
     .status.currentHealthy, .status.desiredHealthy, .status.expectedPods]
  | @tsv'
```

Each line is a service that would block a drain right now. Common causes: the Deployment is mid-rollout, a replica is not Ready, there is only one replica, or the budget is as strict as the replica count.

Then rehearse a drain without evicting anything:

```bash title="server-side dry run"
kubectl drain NODE_NAME --ignore-daemonsets --delete-emptydir-data --dry-run=server
```

Replace `NODE_NAME` with a real node from `kubectl get nodes`. The server-side dry run asks the API server what would happen, and PDBs are part of that answer. Check `kubectl drain --help` for the flags in your client version.

## Test it in staging

1. Run the upgrade of a staging node pool with real traffic, or a load test from [[load-and-performance-testing]].
2. Watch `kubectl get pdb -A -w` in one terminal and the error rate in a dashboard in another.
3. Time the drain per node. If it takes longer than the platform's drain timeout, upgrades in production will hit the timeout.
4. Record the result next to the service so the next upgrade does not rediscover it.

## Observability

Alert on the symptom, not on each PDB: nodes that stay cordoned for a long time, upgrades that run past their window, and drains blocked by a PDB. The kube-state-metrics series for PDBs (`kube_poddisruptionbudget_status_pod_disruptions_allowed` and friends; check the exact names for your version) can drive a ticket-level alert when allowed disruptions stay at zero for a long period on a workload that has more than one replica.

## Rollback

A PDB is a plain object, so rollback is quick and safe.

1. Find the blocker: `kubectl get pdb -A` and the audit above.
2. Fix the cause first, for example scale up the Deployment or fix the failing Pod.
3. If the upgrade must go on now, relax the budget in Git (change `maxUnavailable` and let GitOps apply it) rather than deleting the PDB by hand, which Argo CD will revert.
4. After the upgrade, restore the original value and record why it was too tight.

Do not delete PDBs across a namespace to unblock an upgrade. That removes protection from services that were fine.

## Checklist

- Every multi-replica service has one PDB, with the same labels as its Deployment.
- `maxUnavailable` for services behind an HPA, with `unhealthyPodEvictionPolicy: AlwaysAllow`.
- No `maxUnavailable: 0`, no `minAvailable` equal to the replica count.
- Policy check in CI, audit and `--dry-run=server` before each upgrade.
- Stateful quorum workloads follow [[stateful-workloads-gke]].

## Related

- [[zero-downtime-deployments-kubernetes]]
- [[stateful-workloads-gke]]
- [[gke-cluster-upgrade]]
- [[kubernetes-autoscaling]]
- [[conftest-policy-gate-for-manifests]]
- [[gke-node-pool-upgrade-strategies]]
- [[topology-spread-constraints-gke]]
- [[priority-classes-and-preemption]]

## Sources

- https://kubernetes.io/docs/concepts/workloads/pods/disruptions/
- https://kubernetes.io/docs/tasks/run-application/configure-pdb/
- https://cloud.google.com/kubernetes-engine/docs/concepts/cluster-upgrades
