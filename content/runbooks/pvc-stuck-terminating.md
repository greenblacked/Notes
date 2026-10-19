---
title: PersistentVolumeClaim or PersistentVolume stuck in Terminating
description: Find which Pod, finalizer or volume attachment holds a PVC or PV in Terminating, check the reclaim policy, and release it without losing data.
type: runbook
tags:
  - runbooks
  - kubernetes
  - gke
  - gcp
  - reliability
created: 2026-10-19
modified: 2026-10-19
draft: false
---

How to diagnose a PersistentVolumeClaim (PVC) or PersistentVolume (PV) that stays in `Terminating`, and release it safely. The delete is usually waiting for something real: a Pod still mounting the claim, a volume still attached to a node, or a finalizer owned by a controller that is not running. The fix is to satisfy that wait, not to bypass it.

> [!info] Scope and verification
> The commands were not run against a live cluster and the note is not marked `verified`. Finalizer names and CSI behaviour differ by Kubernetes and driver version. Check the current Kubernetes finalizer and persistent-volume documentation, and the GKE persistent disk CSI driver page, before acting.

## When to use

- `kubectl get pvc` shows `Terminating` for longer than a few minutes.
- A PV is `Terminating` or `Released` and its disk is not cleaned up.
- A namespace delete hangs on PVCs; see also [[namespace-stuck-terminating]].
- A StatefulSet was scaled down or deleted and its claims will not go away.

## Preconditions

- A current snapshot or backup of the data you care about. See [[backup-architecture-gke-cloud-sql-gcs]] for the backup design and [[stateful-workloads-gke]] for storage behaviour on GKE.
- A change or incident record. Some steps below can lead to data loss.
- Permission to patch PVs, which are cluster scoped.

```bash
PROJECT=example-project
NS=app
PVC=data-db-0
gcloud config set project "$PROJECT"
```

> [!danger] Removing finalizers can orphan or delete disks
> Patching a finalizer away skips the cleanup that the finalizer guards. Depending on the reclaim policy, that can leave an orphaned, billed disk, or delete a disk that you needed. Do the steps in order and use the finalizer patch last.

## Steps

### 1. Describe the claim and read its finalizers

```bash
kubectl -n "$NS" get pvc "$PVC" -o wide
kubectl -n "$NS" get pvc "$PVC" -o jsonpath='{.metadata.deletionTimestamp}{"\n"}{.metadata.finalizers}{"\n"}'
kubectl -n "$NS" describe pvc "$PVC" | sed -n '/Used By:/,/Events:/p;/Events:/,$p'
```

The two built-in finalizers to know are:

- `kubernetes.io/pvc-protection`: the PVC is not removed while any Pod uses it. This is a safety feature, and the `Used By:` line shows the culprit.
- `kubernetes.io/pv-protection`: the PV is not removed while it is bound to a claim.

Other finalizers, for example from a snapshot controller or a backup tool, belong to those controllers.

### 2. Find the Pods that use the claim

`Used By` can miss Pods that are `Completed`, `Failed` or `Terminating`, all of which still count for the protection check.

```bash
kubectl get pods -A -o json | jq -r --arg ns "$NS" --arg pvc "$PVC" '
  .items[]
  | select(.metadata.namespace==$ns)
  | select(any(.spec.volumes[]?; .persistentVolumeClaim.claimName==$pvc))
  | "\(.metadata.namespace)/\(.metadata.name)\t\(.status.phase)\t\(.metadata.deletionTimestamp // "-")"'
```

Also check for workloads that will recreate the Pod: a Deployment, StatefulSet, Job or CronJob. If they exist, scaling to zero or deleting the owner is how the consumer actually goes away.

```bash
kubectl -n "$NS" get deploy,sts,job,cronjob
```

A StatefulSet's PVCs are not deleted when the StatefulSet is deleted or scaled down, unless its `persistentVolumeClaimRetentionPolicy` says so. Check whether the claims were meant to be removed at all before forcing anything.

### 3. Check the PV and the disk behind it

```bash
PV=$(kubectl -n "$NS" get pvc "$PVC" -o jsonpath='{.spec.volumeName}')
kubectl get pv "$PV" -o jsonpath='{.spec.persistentVolumeReclaimPolicy}{"\t"}{.status.phase}{"\t"}{.spec.csi.volumeHandle}{"\n"}'
kubectl describe pv "$PV" | sed -n '/Finalizers:/,/Source:/p;/Events:/,$p'
```

The `volumeHandle` on GKE persistent disk volumes holds the disk's project, location and name. Compare it with the disk:

```bash
DISK=pvc-0000-example
ZONE=europe-west1-b
gcloud compute disks describe "$DISK" --zone "$ZONE" \
  --format="yaml(name,status,users,sizeGb,type,labels)"
```

The `users` field lists the VM instances the disk is attached to. If a node still appears there, the detach has not happened yet.

The `persistentVolumeReclaimPolicy` decides what happens to the disk when the claim goes away:

- `Delete`: the disk is deleted along with the PV. Know this before you remove the claim.
- `Retain`: the PV becomes `Released` and the disk stays for manual handling.

Set `Retain` first if the data matters and you are about to try anything risky:

```bash
kubectl patch pv "$PV" -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
```

Record the original value so you can restore it. A manual snapshot is the other safety net:

```bash
gcloud compute disks snapshot "$DISK" --zone "$ZONE" --snapshot-names "pre-release-$(date +%Y%m%d%H%M)"
```

### 4. Check volume attachments and the CSI driver

```bash
kubectl get volumeattachments -o custom-columns='NAME:.metadata.name,NODE:.spec.nodeName,PV:.spec.source.persistentVolumeName,ATTACHED:.status.attached'
kubectl get volumeattachments | grep "$PV"

kubectl -n kube-system get pods | grep -i 'pd-csi\|csi'
kubectl -n kube-system logs -l app=gcp-compute-persistent-disk-csi-driver -c csi-attacher --tail=100
```

Labels and container names depend on the driver version, so list them first. Frequent causes:

- The node that held the attachment is gone or `NotReady`; the attach/detach controller needs time or the node needs replacing. See [[gke-node-notready-triage]].
- The CSI controller Pod is down or lacks permission to detach.
- A `VolumeAttachment` has a finalizer waiting for the external attacher.

### 5. Release cleanly

1. Delete or scale down the consumer so no Pod references the claim:

```bash
kubectl -n "$NS" scale statefulset/db --replicas=0
kubectl -n "$NS" delete pod <completed-or-stuck-pod>
```

2. Wait for the detach, then for the protection finalizer to clear on its own:

```bash
kubectl -n "$NS" get pvc "$PVC" -w
gcloud compute disks describe "$DISK" --zone "$ZONE" --format="value(users)"
```

3. If a Pod is `Terminating` on a dead node and blocks the detach, deal with that Pod first; see [[kubernetes-pod-troubleshooting]].

Most stuck claims clear at this step.

### 6. Last resort: patch out the finalizer

Only when no Pod, attachment or controller holds the object, the data is backed up, and the reclaim policy is `Retain` (or you accept the disk deletion):

```bash
kubectl -n "$NS" patch pvc "$PVC" --type=merge -p '{"metadata":{"finalizers":null}}'
# for a PV that is stuck
kubectl patch pv "$PV" --type=merge -p '{"metadata":{"finalizers":null}}'
```

Afterwards, find and handle the disk. With `Retain` it stays and is billed until you delete it deliberately:

```bash
gcloud compute disks list --filter="name~$DISK"
```

Patching removes the guard rail, so write down in the incident record which finalizer you removed and why.

## Validation

```bash
kubectl -n "$NS" get pvc "$PVC"                 # NotFound if intended, or Bound if kept
kubectl get pv "$PV"                            # NotFound, or Released/Available as intended
kubectl get volumeattachments | grep "$PV" || echo "no attachment"
gcloud compute disks describe "$DISK" --zone "$ZONE" --format="value(users)"   # empty
```

If you kept the data, restore the reclaim policy and confirm a Pod can mount a fresh claim. If you released a retained PV for reuse, clear its `claimRef` deliberately; do not reuse it blindly.

## Rollback

- Reclaim policy: set it back to its original value with `kubectl patch pv "$PV" -p '{"spec":{"persistentVolumeReclaimPolicy":"Delete"}}'` only after the claim state is settled.
- Scaled-down workloads: scale back up; the StatefulSet recreates Pods and reattaches the claims that still exist.
- Deleted objects cannot be recovered: restore from the snapshot taken in step 3, creating a new disk and a PV that points at it, or from your backup tool.
- If a finalizer patch was a mistake, there is nothing to undo. Recreate the object from the saved YAML (`kubectl get pvc -o yaml > pvc-backup.yaml` before step 6).

## Troubleshooting

| Symptom                                         | Likely cause and fix                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Used By` shows a Pod you cannot find           | A Completed or Terminating Pod, or a Pod in another namespace for a shared PV. Use the `jq` query.        |
| PVC clears but PV stays `Released`              | Reclaim policy `Retain`, by design. Delete the PV and disk deliberately once data is safe.                |
| Disk still attached to a deleted node           | Stale attachment. Wait for the detach controller or delete the stale `VolumeAttachment` as a last resort. |
| PVC recreated immediately after delete          | A StatefulSet template or GitOps controller recreates it. Remove the owner or sync setting first.         |
| New Pod stuck `ContainerCreating` after release | Multi-attach error. Confirm the old attachment is gone; see the Pod events.                               |
| Snapshot controller finalizer blocks            | A `VolumeSnapshot` still references the claim. Delete or detach the snapshot objects first.               |

## Related

- [[stateful-workloads-gke]] for how storage classes, zones and failover behave.
- [[kubernetes-pod-troubleshooting]] for Pod-level volume and mount errors.
- [[backup-architecture-gke-cloud-sql-gcs]] for snapshots and restore design.
- [[namespace-stuck-terminating]] for the same family of finalizer problems at namespace scope.

## Sources

- [Kubernetes: Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
- [Kubernetes: Finalizers](https://kubernetes.io/docs/concepts/overview/working-with-objects/finalizers/)
- [GKE: Persistent Disk CSI driver](https://cloud.google.com/kubernetes-engine/docs/how-to/persistent-volumes/gce-pd-csi-driver)
