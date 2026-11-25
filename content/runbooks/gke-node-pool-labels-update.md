---
title: Change GKE node pool labels without dropping the others
description: gcloud --node-labels replaces every user-set label on a node pool; read the current set, merge, apply, check, and restore from the saved copy.
type: runbook
tags:
  - runbooks
  - gke
  - kubernetes
  - reliability
created: 2026-11-24
modified: 2026-11-25
draft: false
evidence: source-reviewed
reviewed: 2026-11-24
review-due: 2027-05-24
destructive: true
---

`gcloud container node-pools update --node-labels` does not add a label. It replaces every user-specified Kubernetes label on every node of the pool with the list you pass. A label that a `nodeSelector` depends on disappears if you leave it out, and Pods that need it stop scheduling. `--node-taints` behaves the same way for taints. This note is the one place on the site for that rule; other runbooks link here.

> [!warning] The update overwrites, and it is live at once
> The new labels are applied in place to the Node objects of existing nodes, without re-creating them. Leaving out a label removes it from running nodes immediately. Avoid relabelling a pool during an incident. To select a pool's nodes you usually need no label of your own: GKE sets `cloud.google.com/gke-nodepool=<pool name>` on every node.

## When to use

- You need a new label on a pool, for example `pool=<name>` for `-l pool=...` selectors, and the pool already has labels.
- A runbook says to label a pool before relying on a selector.

If the pool is managed by Terraform, change the labels there instead; a `gcloud` change is drift that the next apply may revert.

## Preconditions

- GKE Standard (the GKE page covers Standard clusters only) and permission to update node pools.
- `gcloud`, `kubectl` pointed at the same cluster, and `jq`.

```bash
CLUSTER=prod-gke          # change: the cluster name
LOCATION=europe-west1     # change: the cluster's region or zone
POOL=general              # change: the node pool
NEW_KEY=pool              # change: the label key to add or change
NEW_VALUE="$POOL"         # change: its value

gcloud config list --format="value(core.project)"   # must print the project you expect
kubectl config current-context                      # must be the same cluster
```

## Steps

### 1. Save the pool as it is now

```bash
gcloud container node-pools describe "$POOL" --cluster "$CLUSTER" --location "$LOCATION" \
  --format=json > "node-pool-$POOL-before.json"
jq '.config.labels // {}' "node-pool-$POOL-before.json"
kubectl get nodes -l cloud.google.com/gke-nodepool="$POOL" -L "$NEW_KEY"
```

### 2. Build the full list: every existing label plus the new one

```bash
LABELS=$(jq -r --arg k "$NEW_KEY" --arg v "$NEW_VALUE" \
  '(.config.labels // {}) + {($k): $v} | to_entries | map("\(.key)=\(.value)") | join(",")' \
  "node-pool-$POOL-before.json")
printf '%s\n' "$LABELS"   # every label printed by step 1 must still be here
```

Avoid keys that clash with the labels Kubernetes and GKE set themselves; the API reference says the result of a clash is unpredictable.

### 3. Apply

Run the label change as its own update call; the reference lists the update flags in a group of which exactly one must be given.

```bash
gcloud container node-pools update "$POOL" --cluster "$CLUSTER" --location "$LOCATION" \
  --node-labels="$LABELS"
```

## Validation

```bash
gcloud container node-pools describe "$POOL" --cluster "$CLUSTER" --location "$LOCATION" \
  --format=json | jq '.config.labels'
kubectl get nodes -l cloud.google.com/gke-nodepool="$POOL" -L "$NEW_KEY"
kubectl get pods -A --field-selector=status.phase=Pending | head
```

The pool shows the old labels plus the new one, every node shows the new value, and no new Pods are `Pending`.

## Rollback

Re-apply the saved set. If `OLD_LABELS` comes out empty (the pool had no user labels), the guard stops the command: how to clear every label with this flag is not verified here.

```bash
OLD_LABELS=$(jq -r '(.config.labels // {}) | to_entries | map("\(.key)=\(.value)") | join(",")' \
  "node-pool-$POOL-before.json")
printf '%s\n' "$OLD_LABELS"
[ -n "$OLD_LABELS" ] && gcloud container node-pools update "$POOL" --cluster "$CLUSTER" --location "$LOCATION" \
  --node-labels="$OLD_LABELS"
```

## Troubleshooting

| Symptom                                          | Cause                                      | Fix                            |
| ------------------------------------------------ | ------------------------------------------ | ------------------------------ |
| Pods `Pending` with `didn't match node affinity` | A label was left out of `--node-labels`    | Roll back with the saved set   |
| The label comes back or goes again later         | Terraform or another tool manages the pool | Change the labels in that tool |
| `update` refuses the flag combination            | More than one update flag in one call      | Run one `update` per change    |

## Evidence

### Sources checked

- [gcloud container node-pools update](https://docs.cloud.google.com/sdk/gcloud/reference/container/node-pools/update): `--node-labels` replaces all user-specified labels on all nodes, is applied in place without re-creating nodes, and the labels can be used in `nodeSelector`; `--node-taints` also replaces all user-specified taints; the update flags are a group of which exactly one must be specified. Checked 2026-11-24.
- [Update Kubernetes node labels and taints for node pools](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/update-existing-nodepools): the update overwrites previous user-specified values, without re-creating the node pool; GKE Standard. Checked 2026-11-24.
- [About node pools](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/node-pools): every node has the `cloud.google.com/gke-nodepool` label with the pool's name. Checked 2026-11-24.
- [NodeConfig REST reference](https://docs.cloud.google.com/kubernetes-engine/docs/reference/rest/v1/NodeConfig): `labels` are the Kubernetes labels applied to each node; clashes with default label keys are unpredictable. Checked 2026-11-24.
- [kubectl get](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_get/): `-L` label columns and `-l` selectors. Checked 2026-11-24.

### Not verified

- How to clear all user labels with `--node-labels` (an empty value), and whether labels added directly with `kubectl label` are kept or removed by the update.
- Whether a Terraform-managed pool reverts the change on the next apply; the Terraform provider fields were not read for this note.
- The exact `FailedScheduling` message in the troubleshooting table, and whether an update is refused while a pool upgrade runs.
- The `.config.labels` path in `describe` output is taken from the NodeConfig reference, not from a real response.
- Autopilot behaviour. Nothing was run.

### Environment

GKE Standard, `gcloud`, `kubectl` and `jq`; bash or zsh.

### Prerequisites

See Preconditions. Also a change record, and agreement from the teams whose workloads select on the pool's labels.

### Expected results

See Validation: the saved labels plus the new one on the pool and on every node, and no new `Pending` Pods.

### Failure conditions

The `update` call fails; any saved label is missing afterwards; Pods start going `Pending`. Roll back at once.

### Cleanup and rollback

See Rollback. Delete `node-pool-$POOL-before.json` once the change has held.

## Related

- [[gke-cluster-upgrade]], [[gke-cluster-autoscaler-not-scaling-up]], [[gke-node-notready-triage]] and [[gpu-pods-pending-on-gke]]: the runbooks that label pools.
- [[runbooks/index|Runbooks]].
