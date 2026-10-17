---
title: "Stateful workloads on GKE: StatefulSets, PDBs and node upgrades"
description: Shape StatefulSets, PodDisruptionBudgets, zone spread and regional disks so a quorum-based workload survives GKE node upgrades and drains.
type: pattern
tags:
  - patterns
  - kubernetes
  - gke
  - reliability
created: 2026-10-17
modified: 2026-10-17
draft: false
---

A quorum-based workload (etcd, a Kafka or ZooKeeper ensemble, a Postgres cluster with a consensus layer, Consul, a replicated cache) can lose one member and keep serving. It cannot lose two at once. GKE node upgrades, autoscaler scale-downs and manual drains all evict pods, so whether you survive depends on how the workload is shaped before the drain starts. [[gke-cluster-upgrade]] covers the control flow of an upgrade. This note covers what the StatefulSet, the PodDisruptionBudget (PDB), the topology and the disks must look like so that flow is safe.

> [!info] Scope and what is not verified
> The examples assume a three-member quorum workload on a regional GKE cluster. Two items were not checked against live documentation when this was written: whether `volumeClaimTemplates` can be resized in place on the Kubernetes version you run, and how long GKE surge upgrades wait on a PDB before evicting anyway. Both are called out where they matter. Check before relying on this.

## Quorum and PDB sizing

A quorum needs a majority: `floor(N/2) + 1` members. With three members the quorum is two, so exactly one member may be unavailable at a time. With five members the quorum is three and two may be down. The PDB must express that rule, not a percentage that happens to look reasonable.

| Members | Quorum | Tolerated down | PDB                                     |
| ------- | ------ | -------------- | --------------------------------------- |
| 3       | 2      | 1              | `maxUnavailable: 1` (`minAvailable: 2`) |
| 5       | 3      | 2              | `maxUnavailable: 2`                     |

Prefer `maxUnavailable` for a StatefulSet. It stays correct if you later scale the set, and it reads as "how many may be down". Check that the budget also covers pods that are Running but not Ready: a PDB counts only Ready pods as available, so a member that is still catching up already uses your one allowed disruption.

```yaml title="pdb-quorum.yaml"
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: kv-store
  namespace: data # change: your namespace
spec:
  maxUnavailable: 1 # 3-member quorum: one member may be down; change with the member count
  selector:
    matchLabels:
      app.kubernetes.io/name: kv-store # change: must match the StatefulSet pod labels exactly
```

Failure modes to avoid:

- `maxUnavailable: 0` or `minAvailable` equal to the replica count. Nothing can be evicted, so the node drain hangs and the upgrade stalls or is forced. This is the most common self-inflicted blocker.
- A selector that matches nothing. The PDB then protects nothing, and you find out during the upgrade. Check that `kubectl get pdb` shows the expected number of allowed disruptions.
- One PDB per StatefulSet is enough. Overlapping PDBs on the same pods make eviction behaviour hard to reason about.

## Update strategy and partitions

A StatefulSet replaces pods one at a time, in reverse ordinal order, when `updateStrategy` is `RollingUpdate`. Two fields give you control.

- `podManagementPolicy: OrderedReady` (the default) starts and stops pods one by one and waits for each to be Ready. Keep it for quorum systems. `Parallel` starts and stops everything at once and breaks the one-at-a-time assumption behind the PDB.
- `rollingUpdate.partition` holds back every pod with an ordinal below the partition number. Set it to the replica count to pause an update, then lower it step by step to roll one member at a time with a check in between. This is the canary mechanism for stateful sets.

```yaml title="statefulset-fragment.yaml"
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: kv-store
  namespace: data
spec:
  replicas: 3
  serviceName: kv-store-headless
  podManagementPolicy: OrderedReady
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      partition: 3 # 3 = hold all pods back; lower to 2, then 1, then 0 to roll one member at a time
  selector:
    matchLabels:
      app.kubernetes.io/name: kv-store
  template:
    metadata:
      labels:
        app.kubernetes.io/name: kv-store
    spec:
      terminationGracePeriodSeconds: 60 # change: enough time for a clean leave or leader hand-off
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app.kubernetes.io/name: kv-store
      containers:
        - name: kv-store
          image: registry.example.com/data/kv-store@sha256:<digest> # change: your image, pinned by digest
          readinessProbe: # change: must report Ready only when the member has rejoined the quorum
            exec:
              command: ["/bin/sh", "-c", "/opt/kv/bin/healthcheck --quorum"]
            periodSeconds: 10
            failureThreshold: 3
```

The readiness probe is what makes `OrderedReady`, the partition and the PDB safe. If a pod reports Ready before it has rejoined the quorum, the next eviction is allowed too early. Make the probe check cluster membership, not just that the port is open. Set requests and limits as described in [[kubernetes-resource-requests-and-limits]]: a stateful pod that is OOM-killed during a resync costs you a second disruption.

Rolling an update with the partition:

```bash
NAMESPACE=data
STS=kv-store

# 1. Apply the new template with partition equal to replicas (nothing rolls).
# 2. Lower the partition one step at a time and wait for Ready between steps.
for P in 2 1 0; do
  kubectl -n "$NAMESPACE" patch statefulset "$STS" \
    -p "{\"spec\":{\"updateStrategy\":{\"rollingUpdate\":{\"partition\":${P}}}}}"
  kubectl -n "$NAMESPACE" rollout status statefulset/"$STS" --timeout=600s
  # Run the application quorum check here before the next step (see Pre-drain check).
done
```

## Topology spread across zones

Quorum is only useful if one zone failure cannot take two members. Spread members across zones with a `topologySpreadConstraint` on `topology.kubernetes.io/zone`, `maxSkew: 1` and `whenUnsatisfiable: DoNotSchedule` (shown in the fragment above). With three members and three zones, each zone gets one. A zone outage then removes one member and the quorum holds.

Trade-offs to know about:

- `DoNotSchedule` leaves a pod Pending when no zone satisfies the constraint, for example when a zone has no capacity or a node pool exists in only two zones. That is the correct failure for a quorum system, because a second member in the same zone would hide the risk. See [[kubernetes-pod-troubleshooting]] for reading the Pending reason.
- `ScheduleAnyway` is a soft preference. Use it for caches you can rebuild, not for quorum members.
- Make sure every zone you spread over has a node pool with room for the pod and its disk. A regional cluster does not guarantee that.
- Spread constraints are evaluated at scheduling time only. After a node pool is recreated or pods are rescheduled, check that the spread still holds.

## Storage classes and regional PD

A standard Persistent Disk lives in one zone, so the pod that uses it can only run in that zone. A regional Persistent Disk replicates synchronously between two zones in a region and can be re-attached in the other zone if the first fails. Use the GKE Persistent Disk CSI driver (`pd.csi.storage.gke.io`) and set `replication-type: regional-pd`.

```yaml title="storageclass-regional.yaml"
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: regional-balanced
provisioner: pd.csi.storage.gke.io
parameters:
  type: pd-balanced # change: disk type that fits your IOPS and cost needs
  replication-type: regional-pd
volumeBindingMode: WaitForFirstConsumer # create the disk where the pod is scheduled
allowVolumeExpansion: true # required to grow volumes later
reclaimPolicy: Retain # keep the disk if the PVC is deleted by mistake; clean up deliberately
allowedTopologies:
  - matchLabelExpressions:
      - key: topology.gke.io/zone
        values:
          - us-central1-a # change: the two zones the disk replicates between
          - us-central1-b
```

Points to decide deliberately:

- **A regional disk covers two zones, not three.** A three-zone spread with regional PD means the member in the third zone cannot use a disk replicated between the other two. Either run the spread over the two disk zones, or use zonal disks and rely on application-level replication across three zones. For a workload that already replicates data between members (most quorum systems do), zonal disks plus a three-zone spread is the common choice, and regional PD pays off for single-instance databases that have no replica of their own. Choose by asking which failure the replication already covers.
- `WaitForFirstConsumer` stops the volume being created in a zone before the scheduler has chosen one.
- `Retain` protects data but leaves orphaned disks that cost money. Pair it with a periodic list of unattached disks, as described in [[finops-cost-allocation-and-guardrails]].
- Disks are not backups. A deleted or corrupted volume is replicated too. See [[backup-architecture-gke-cloud-sql-gcs]] for snapshots, Backup for GKE and restore drills.

> [!warning] Disk types and regional PD limits are not verified
> Which `type` values support `regional-pd`, the allowed zone pairs and any size limits were not checked against current GKE documentation. Confirm them for your region and GKE version before you commit to a layout.

## Volume expansion and volumeClaimTemplates limits

With `allowVolumeExpansion: true` on the StorageClass, you grow a volume by editing the PVC. Grow each member's PVC in turn and check the filesystem inside the pod.

```bash
NAMESPACE=data
STS=kv-store
NEW_SIZE=200Gi # change: the new size; you can only grow, never shrink

for i in 0 1 2; do
  kubectl -n "$NAMESPACE" patch pvc "data-${STS}-${i}" \
    -p "{\"spec\":{\"resources\":{\"requests\":{\"storage\":\"${NEW_SIZE}\"}}}}"
done

kubectl -n "$NAMESPACE" get pvc -l app.kubernetes.io/name="$STS" -w
kubectl -n "$NAMESPACE" describe pvc "data-${STS}-0" | grep -i -A3 conditions
```

The PVC name is `<template name>-<statefulset name>-<ordinal>`. Here the claim template is called `data`. Change it if yours differs.

The limitation is in the StatefulSet itself. Historically the `volumeClaimTemplates` field of an existing StatefulSet is immutable, so changing the size there is rejected. The result is a drift: the PVCs are 200Gi but the template still says 100Gi, and any new member (from scaling up) gets the old size. The usual workaround is:

1. Patch all PVCs as above.
2. Delete the StatefulSet object without deleting the pods: `kubectl -n data delete statefulset kv-store --cascade=orphan`.
3. Re-apply the StatefulSet from Git with the new size in `volumeClaimTemplates`. The existing pods and PVCs are adopted.

Update the size in Git in the same change, so GitOps does not revert it.

> [!warning] In-place template resize is not verified
> Newer Kubernetes releases have work in progress to allow `volumeClaimTemplates` changes. Whether your Kubernetes version supports it was not verified. Test on a non-production StatefulSet first and keep the orphan-and-recreate procedure as the fallback.

Other limits: expansion is online for the PD CSI driver in most cases, but a failed resize leaves the PVC with a condition such as `FileSystemResizePending`. Do not start several resizes across members at once. Resize one member, confirm the filesystem has grown, then continue.

## Upgrade and drain behaviour on GKE

During a node pool upgrade, GKE cordons a node and drains it, which evicts pods through the eviction API, and the eviction respects PDBs. With surge upgrades, the node pool replaces nodes in batches set by `maxSurge` and `maxUnavailable`. Nodes in a batch drain in parallel, so several members of the same StatefulSet can be evicted in one batch if their PDB allows it. With `maxUnavailable: 1` in the PDB, only one eviction is allowed at a time, and the others wait.

Things that go wrong:

- **PDB timeout.** GKE does not wait for a PDB forever. After a limit, the drain proceeds even if the budget is not satisfied. Do not rely on the PDB as an absolute guarantee; rely on it plus the pre-drain check below.
- **Slow shutdown.** A pod whose `terminationGracePeriodSeconds` is long holds the drain. A pod that ignores SIGTERM is killed at the end of the grace period, which for a leader can mean an election.
- **Local state.** Pods that use `emptyDir` or local SSD lose their data when the node is replaced. Quorum systems tolerate this only if resync is fast and tested.
- **Reschedule delay.** A zonal disk can only attach where it lives. If that zone has no capacity at that moment, the pod stays Pending and the PDB counts it as unavailable.

> [!warning] GKE surge-upgrade PDB timeout is not verified
> The exact time GKE waits on a PDB during surge upgrades, and what it does when the wait ends, was not checked against current documentation. Look it up for your GKE version and release channel before you build a runbook around a number.

Control when upgrades happen with a maintenance window and exclusions, so they do not land during a peak or while a stateful migration is under way. See [[change-freezes-and-maintenance-windows]] for the policy side.

```bash
CLUSTER=prod-eu # change: cluster name
LOCATION=europe-west1 # change: region or zone
PROJECT=example-prod-project # change: project ID

# Block auto-upgrades of nodes and control plane for a bounded period.
# Check flag names and scope values with: gcloud container clusters update --help
gcloud container clusters update "$CLUSTER" \
  --location "$LOCATION" --project "$PROJECT" \
  --add-maintenance-exclusion-name "stateful-migration" \
  --add-maintenance-exclusion-start "2026-11-02T00:00:00Z" \
  --add-maintenance-exclusion-end "2026-11-16T00:00:00Z" \
  --add-maintenance-exclusion-scope no_minor_or_node_upgrades
```

An exclusion is a delay, not a fix. It has a maximum length and the cluster must still be upgraded. Use it to move an upgrade away from a risky week and to run the upgrade yourself under supervision, as in [[gke-cluster-upgrade]].

> [!warning] Maintenance exclusion flags and scopes are not verified
> The flag names, scope values and maximum exclusion length above were written from memory of the `gcloud container clusters update` interface. Confirm them with `--help` on your gcloud version.

## Pre-drain check

Before you start an upgrade, a manual drain or a partition step, confirm that the workload is healthy and has all its members. The script checks the Kubernetes view (all pods Ready, PDB allows one disruption) and then asks the application whether the quorum is whole. The application check is the part that matters, so replace the example with your system's own command.

```bash
#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-data}"          # change: namespace
STS="${STS:-kv-store}"                  # change: StatefulSet name
PDB="${PDB:-kv-store}"                  # change: PDB name
REPLICAS_EXPECTED="${REPLICAS_EXPECTED:-3}"

# 1. All pods Ready and at the expected count.
READY=$(kubectl -n "$NAMESPACE" get statefulset "$STS" -o jsonpath='{.status.readyReplicas}')
READY="${READY:-0}"
if [[ "$READY" != "$REPLICAS_EXPECTED" ]]; then
  echo "NOT SAFE: ${READY}/${REPLICAS_EXPECTED} pods Ready" >&2
  exit 1
fi

# 2. The PDB must allow at least one disruption right now.
ALLOWED=$(kubectl -n "$NAMESPACE" get pdb "$PDB" -o jsonpath='{.status.disruptionsAllowed}')
if [[ "${ALLOWED:-0}" -lt 1 ]]; then
  echo "NOT SAFE: PDB ${PDB} allows ${ALLOWED:-0} disruptions" >&2
  exit 1
fi

# 3. Ask the application. Example for etcd; replace with your system's quorum check.
#    Fails if any member is unhealthy or unreachable.
kubectl -n "$NAMESPACE" exec "${STS}-0" -- \
  etcdctl endpoint health --cluster --command-timeout=5s

# 4. Members spread across zones: no zone holds more than one member.
kubectl -n "$NAMESPACE" get pods -l "app.kubernetes.io/name=${STS}" \
  -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}' |
  while read -r node; do
    kubectl get node "$node" -o jsonpath='{.metadata.labels.topology\.kubernetes\.io/zone}{"\n"}'
  done | sort | uniq -c | awk '$1 > 1 { print "NOT SAFE: zone " $2 " holds " $1 " members" > "/dev/stderr"; bad=1 } END { exit bad }'

echo "OK: ${READY}/${REPLICAS_EXPECTED} Ready, PDB allows ${ALLOWED}, quorum healthy, spread correct"
```

Run it before the change and again after each node or partition step. A non-zero exit means stop. Include it in the change record per [[production-change-checklist]].

## Related notes

- [[gke-cluster-upgrade]]: the upgrade procedure these settings protect.
- [[kubernetes-resource-requests-and-limits]]: sizing so members are not OOM-killed during resync.
- [[kubernetes-pod-troubleshooting]]: Pending pods, stuck PVCs and failed probes.
- [[backup-architecture-gke-cloud-sql-gcs]]: backups and restore drills, which replicated disks do not replace.
- [[change-freezes-and-maintenance-windows]]: when upgrades are allowed to run.
