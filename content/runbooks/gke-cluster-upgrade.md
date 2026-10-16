---
title: GKE cluster upgrade
description: "Upgrade a GKE control plane and node pools safely: channels, maintenance windows, deprecated API checks, surge or blue-green, PDBs, validation, rollback limits"
type: runbook
tags:
  - runbooks
  - gke
  - gcp
  - kubernetes
  - reliability
created: 2026-10-16
modified: 2026-10-16
draft: false
---

How to upgrade a GKE Standard cluster to a newer Kubernetes version with predictable impact. GKE upgrades clusters automatically on a release channel; this runbook covers the manual or pre-empted path you use when you want to control the timing, and the checks that belong before any upgrade, automatic or not.

> [!info] Scope and verification
> The Google Cloud documentation was not reachable when this note was written, so the commands come from the `gcloud container` command groups as known and are not marked `verified`. Run `gcloud container clusters upgrade --help` and `gcloud container node-pools update --help` before use, and compare the flags below with the current GKE upgrade documentation on cloud.google.com.

## When to use

- A minor or patch version is available and you want to move before the automatic upgrade does.
- The cluster's version is approaching end of support and the automatic upgrade is blocked by an exclusion or a failing check.
- You are changing node pool upgrade settings (surge or blue-green) ahead of a planned upgrade.

For Autopilot clusters, GKE manages nodes; the control plane steps and the API checks still apply, but the node pool steps do not. On Autopilot, nodes follow the control plane version automatically. Application-level upgrades are a different procedure, see [[helm-release-rollback]].

## Preconditions

- A change record and an agreed window, following [[production-change-checklist]].
- Roles that include `container.clusters.update` (for example `roles/container.admin`).
- The target version is available in the cluster's channel and location.
- A working restore path for stateful workloads (verified backups or snapshots).
- Workloads run at least two replicas and have PodDisruptionBudgets, see [[zero-downtime-deployments-kubernetes]].

```bash
PROJECT=my-project
LOCATION=europe-west1          # region for a regional cluster, zone for a zonal one
CLUSTER=prod-1
POOL=default-pool
gcloud config set project "$PROJECT"
```

## Steps

### 1. Understand the current state

```bash
gcloud container clusters describe "$CLUSTER" --location "$LOCATION" \
  --format="value(currentMasterVersion,releaseChannel.channel,maintenancePolicy)"

gcloud container node-pools list --cluster "$CLUSTER" --location "$LOCATION" \
  --format="table(name,version,config.machineType,autoscaling.enabled)"

# Versions GKE offers here, per channel
gcloud container get-server-config --location "$LOCATION" \
  --format="yaml(channels)"
```

Rules to keep in mind:

- Upgrade the control plane first, one minor version at a time. Under the upstream [Kubernetes version skew policy](https://kubernetes.io/releases/version-skew-policy/), a kubelet may be up to three minor versions older than the API server (since Kubernetes 1.28) and never newer; GKE's own node pool rules can be stricter, so check the GKE version skew documentation for your cluster.
- A cluster enrolled in a release channel gets versions on that channel's schedule. Use the channel to set pace, and use a manual upgrade to go sooner.

### 2. Release channels, maintenance windows and exclusions

Choose the channel to match risk appetite: Rapid, Regular, Stable or Extended (check the docs for which versions each carries and how long Extended supports a minor). Using the same channel across dev, stage and prod, with dev on a faster channel, gives you early warning.

Set a maintenance window and, if needed, an exclusion so automatic upgrades do not land in a freeze:

```bash
# Recurring window: 4 hours on weekends (times are UTC)
gcloud container clusters update "$CLUSTER" --location "$LOCATION" \
  --maintenance-window-start "2026-10-17T02:00:00Z" \
  --maintenance-window-end "2026-10-17T06:00:00Z" \
  --maintenance-window-recurrence "FREQ=WEEKLY;BYDAY=SA,SU"

# Block automatic upgrades during a freeze (check the allowed scope and maximum length in the docs)
gcloud container clusters update "$CLUSTER" --location "$LOCATION" \
  --add-maintenance-exclusion-name "year-end-freeze" \
  --add-maintenance-exclusion-start "2026-12-15T00:00:00Z" \
  --add-maintenance-exclusion-end "2027-01-05T00:00:00Z" \
  --add-maintenance-exclusion-scope no_minor_upgrades
```

An exclusion postpones automatic upgrades, not end of support: a version that reaches end of life is upgraded regardless. The maintenance window only constrains automatic maintenance; a manual upgrade you start runs immediately.

### 3. Check for deprecated and removed APIs

This is the step that prevents the worst surprises. A removed API makes manifests fail to apply and controllers that still call it break.

```bash
# Requests the API server has seen to deprecated APIs, with the release in which each is removed
kubectl get --raw /metrics | grep apiserver_requested_deprecated_apis

# Which API versions a resource is served on
kubectl api-versions | sort
```

Also review the GKE console's deprecation insights and recommendations for the cluster, and read the release notes for the target version. Scan manifests, Helm charts and CI templates in git with a tool such as `pluto` or `kubent` (run it against both the cluster and the repository). Fix findings before upgrading: update the chart or manifest, not only the live object.

Third-party components need their own check: ingress controllers, cert-manager, Argo CD, service mesh and CSI drivers each publish a Kubernetes compatibility matrix.

### 4. Pre-flight workload checks

```bash
# Anything unhealthy now will be blamed on the upgrade
kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded
kubectl get nodes

# PDBs that would block draining: ALLOWED DISRUPTIONS = 0
kubectl get pdb -A

# Workloads with a single replica, or on local storage
kubectl get deploy,sts -A -o custom-columns=NS:.metadata.namespace,NAME:.metadata.name,REPLICAS:.spec.replicas | awk '$3==1'
```

A PDB with `ALLOWED DISRUPTIONS` of 0 (for example `minAvailable` equal to the replica count, or `maxUnavailable: 0`) cannot be drained. During a node upgrade GKE respects PDBs for a limited time only (check the docs for the current period), after which pods are evicted anyway. Fix the PDB first; do not rely on the timeout.

Take a backup, record the current versions, and check that monitoring dashboards and alerts exist for the services you will watch.

### 5. Choose the node upgrade strategy

| Strategy        | How it works                                                                             | Use when                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Surge (default) | Creates extra nodes (`maxSurge`), drains and replaces old nodes in rolling fashion       | Most stateless pools; cheapest; no rollback of the nodes mid-way                                                                       |
| Blue-green      | Creates a full set of new nodes, cordons old, drains in batches, soaks, then deletes old | Critical pools where you want a pause and a fast way back before old nodes are removed; costs about double capacity during the upgrade |

Configure before the upgrade:

```bash
# Surge: one extra node, none unavailable (slowest, safest)
gcloud container node-pools update "$POOL" --cluster "$CLUSTER" --location "$LOCATION" \
  --max-surge-upgrade 1 --max-unavailable-upgrade 0

# Blue-green with a 1 hour soak after each batch
gcloud container node-pools update "$POOL" --cluster "$CLUSTER" --location "$LOCATION" \
  --enable-blue-green-upgrade \
  --standard-rollout-policy=batch-node-count=1,batch-soak-duration=3600s \
  --node-pool-soak-duration=7200s
```

Check surge capacity first: surge nodes need quota (CPU, IPs, GPUs) in the zone. Pools using GPUs or reserved resources often cannot surge and need `--max-unavailable-upgrade` instead.

### 6. Upgrade the control plane

Do this first and alone. Use an explicit version from `get-server-config`:

```bash
TARGET=1.NN.N-gke.NNNN         # copy exactly from get-server-config
gcloud container clusters upgrade "$CLUSTER" --location "$LOCATION" \
  --master --cluster-version "$TARGET"
```

A zonal cluster's control plane is unavailable for writes while it is replaced; a regional cluster keeps serving because its replicas are upgraded one at a time, but plan for brief API latency. Running workloads keep running. Track the operation:

```bash
gcloud container operations list --filter="targetLink~$CLUSTER AND status=RUNNING"
```

Validate the control plane (below) before touching nodes.

### 7. Upgrade node pools

One pool at a time, least critical first:

```bash
gcloud container clusters upgrade "$CLUSTER" --location "$LOCATION" \
  --node-pool "$POOL" --cluster-version "$TARGET"
```

Without `--cluster-version`, the pool moves to the control plane version. Watch the rollout from a second terminal:

```bash
kubectl get nodes -L cloud.google.com/gke-nodepool -w
kubectl get pods -A -o wide --field-selector=status.phase!=Running,status.phase!=Succeeded
```

For blue-green, the upgrade pauses in the soak period; you can complete it early or roll back during the soak:

```bash
gcloud container node-pools complete-upgrade "$POOL" --cluster "$CLUSTER" --location "$LOCATION"
gcloud container node-pools rollback "$POOL" --cluster "$CLUSTER" --location "$LOCATION"
```

## Validation

```bash
gcloud container clusters describe "$CLUSTER" --location "$LOCATION" --format="value(currentMasterVersion)"
gcloud container node-pools list --cluster "$CLUSTER" --location "$LOCATION" --format="table(name,version,status)"
kubectl get nodes                                  # all Ready, expected version
kubectl get pods -A | grep -vE "Running|Completed"   # nothing unexpected
kubectl get --raw='/readyz?verbose' | tail -5
```

Then confirm at the service level: error rate and latency against the pre-upgrade baseline, ingress responding, certificates and DNS unchanged, HPAs and the cluster autoscaler working, and a deploy through the pipeline succeeding. Keep watching for a day: some failures appear only at the next rollout.

## Rollback

> [!warning] You cannot generally downgrade a control plane
> Treat a control plane minor upgrade as one-way. GKE does not support downgrading the control plane to an earlier minor version in the normal flow, and the API server may have already migrated stored objects. Check the current GKE docs for any rollback-safe or two-step control plane upgrade option and for what is allowed for patch versions, and do not plan around a downgrade you have not tested.

What you can do:

- **Before upgrading:** the only real safety net is validation in a lower environment on the same channel, plus the deprecated API check above.
- **Control plane problem after upgrade:** fix forward (patch the incompatible workload or component), or open a support case for a platform-side fault. Restoring from backup into a new cluster at the old version is the full fallback for severe cases.
- **Node pools, surge:** a pool upgrade cannot be reversed in place, but you can create a new pool at an older version (still within version skew of the control plane), cordon and drain the upgraded pool, and delete it.
- **Node pools, blue-green:** during the soak, `gcloud container node-pools rollback` returns workloads to the old nodes. After the soak, the old nodes are gone.
- **Cancel a running upgrade:** a running node pool upgrade can be cancelled with `gcloud container operations cancel OPERATION_ID`, which stops further nodes but does not revert nodes already upgraded.

## Troubleshooting

| Symptom                                                 | Cause and fix                                                                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Requested version "not valid" or not offered            | It is not in the cluster's channel or location. Use a version from `get-server-config`; a manual upgrade can be to any available version, a channel bounds the automatic ones. |
| Node upgrade stalls on a node                           | A PDB with 0 allowed disruptions or a pod that will not terminate. Find it with `kubectl get pdb -A` and `kubectl get pods -A -o wide`, then fix the PDB or the pod.           |
| Surge upgrade fails with quota or IP errors             | No capacity for surge nodes. Raise quota, free IPs, or set `--max-surge-upgrade 0 --max-unavailable-upgrade 1`.                                                                |
| Workloads fail with "no matches for kind" after upgrade | A removed API. Update the manifest or chart and redeploy; see step 3 next time.                                                                                                |
| Webhooks time out and block deployments                 | Admission webhook pods were on a draining node and the webhook fails closed. Restore the webhook, and set a sensible `failurePolicy` and replica count.                        |
| Automatic upgrade keeps not happening                   | An exclusion or window applies, or the cluster is not on a channel. Check `maintenancePolicy` in `clusters describe`.                                                          |
| Local SSD or `emptyDir` data lost                       | Node replacement discards local data. Keep durable state on PVs.                                                                                                               |

If an incident results from the upgrade, run it through [[incident-response]] and write it up as a [[blameless-postmortems|blameless postmortem]].
