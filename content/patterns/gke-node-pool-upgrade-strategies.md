---
title: "GKE node pool upgrade strategies: surge and blue-green"
description: Choose surge or blue-green upgrades per GKE node pool, set them in Terraform, and plan for PDBs, quota, soak time and rollback.
type: pattern
tags:
  - patterns
  - gke
  - kubernetes
  - reliability
  - terraform
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Every GKE node pool has to be upgraded: new Kubernetes versions, security patches and node image updates all replace nodes. The strategy you set on the pool decides how many nodes are replaced at once, how much extra capacity you pay for during the upgrade, and whether you can go back. The default suits a stateless pool and is a poor fit for GPU, reserved or stateful pools.

> [!info] Not checked against live docs
> Nothing here was run against GKE. Check the current GKE docs and the Terraform provider docs before copying: the names and defaults of the surge and blue-green settings, the allowed ranges, how GKE bounds a drain, and which pool types support which strategy (Spot, GPU and Autopilot behave differently). The Terraform block below is an illustration, verify every argument with `terraform validate` against your provider version.

Scope: this note is the per-pool strategy and its code. The step-by-step upgrade procedure, with checks at each stage, is in the runbook [[gke-cluster-upgrade]].

## The problem with drains

An upgrade replaces nodes by cordoning, draining and deleting them. A drain evicts Pods through the Eviction API, so PodDisruptionBudgets apply, and each evicted Pod must become Ready elsewhere before the budget allows the next one. The cost of an upgrade is therefore roughly:

(nodes to replace / nodes handled in parallel) x (time to drain and re-schedule one batch)

Surge and blue-green settings change the two factors. Capacity and quota set the limit on how far you can push them.

## Surge upgrades

With surge, GKE creates extra nodes with the new version, then drains and deletes old nodes, a few at a time. Two settings control it:

- **Max surge**: how many extra nodes may exist at once during the upgrade.
- **Max unavailable**: how many existing nodes may be down at once.

| Setting            | Effect                                                 | Cost                                             |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------ |
| Surge 1, unavail 0 | One extra node, then one old node drains. Safest, slow | One node of quota and spend                      |
| Surge 3, unavail 0 | Three nodes replaced per round, no loss of capacity    | Three nodes of quota and spend                   |
| Surge 0, unavail 1 | No extra nodes, one node of capacity missing at a time | No extra quota, risk if the pool has no headroom |

Higher surge speeds the upgrade up in proportion to the pool size, but each batch drains more Pods at the same time, so PDBs and the readiness time of your workloads become the limit. The surge nodes also count against project quota, and an upgrade that cannot get quota fails or stalls. Check the quota in the pool's region before raising it.

A rollback of a surge upgrade does not exist as a button. Once nodes are replaced, going back means creating a new pool at the old version (if the version is still offered) and moving workloads. Plan upgrades in dev and stage first.

## Blue-green upgrades

With blue-green, GKE creates a full second set of nodes (green) at the new version, cordons and drains the old set (blue) in batches, then holds the old nodes for a **soak** period before deleting them. During the soak you can roll back: GKE can uncordon the blue nodes and return Pods to them.

Settings to look up in the docs:

- **Batch size**, as a node count or percentage, controlling how many blue nodes drain at once.
- **Batch soak duration**, a pause between batches that lets you watch the metrics.
- **Node pool soak duration**, how long blue nodes remain after all batches finish.

Blue-green needs up to double the pool's capacity at the peak, in CPU, memory, IPs and quota. For a large GPU pool that is often not available, and the upgrade will fail to create the green set. Reservations and committed use discounts also matter: surge nodes may not be covered by them.

## Choosing per pool type

| Pool type                         | Recommended                                              | Why                                                                                                   |
| --------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Stateless services, many replicas | Surge, moderate surge, unavailable 0                     | Cheap, fast. PDBs and readiness gate the pace. See [[pod-disruption-budgets-for-stateless-services]]. |
| Stateful, quorum workloads        | Blue-green with batch and soak, or surge 1 unavailable 0 | Slow, controlled drains. Rollback during soak. See [[stateful-workloads-gke]].                        |
| GPU or reserved capacity          | Surge 0 / unavailable 1, or plan a new pool              | Double capacity is rarely available. Check the GPU quota rules for upgrades.                          |
| Spot or preemptible               | Surge, small                                             | Workloads already tolerate loss. Do not pay double for nodes that may vanish.                         |
| Small dev pool                    | Surge 1, unavailable 0                                   | Simplicity.                                                                                           |

Keep stateful and stateless workloads in separate pools so each can have its own strategy, see [[gke-platform-topology-and-tenancy]].

## Declaring it in Terraform

```hcl title="node-pool.tf"
resource "google_container_node_pool" "stateless" {
  name     = "stateless"
  project  = "example-prod"
  location = "europe-west1"
  cluster  = google_container_cluster.main.name

  autoscaling {
    min_node_count = 3
    max_node_count = 20
  }

  upgrade_settings {
    strategy        = "SURGE"
    max_surge       = 2
    max_unavailable = 0
  }
}

resource "google_container_node_pool" "stateful" {
  name     = "stateful"
  project  = "example-prod"
  location = "europe-west1"
  cluster  = google_container_cluster.main.name

  node_count = 3

  upgrade_settings {
    strategy = "BLUE_GREEN"

    blue_green_settings {
      node_pool_soak_duration = "3600s"

      standard_rollout_policy {
        batch_node_count    = 1
        batch_soak_duration = "300s"
      }
    }
  }
}
```

Check the provider docs for the exact argument names and for how `max_surge` and `max_unavailable` combine with the `strategy` value in your provider version. Keep the pools in a reviewed module with the rest of the cluster, see [[terraform-module-and-state-layout]].

Or change an existing pool from the command line:

```bash title="gcloud surge settings"
gcloud container node-pools update stateless \
  --cluster=main --location=europe-west1 --project=example-prod \
  --max-surge-upgrade=2 --max-unavailable-upgrade=0
```

Run `gcloud container node-pools update --help` for the flags that select blue-green and its soak settings in your gcloud version.

## Maintenance windows, exclusions and channels

The strategy says how; the maintenance policy says when. Configure:

- A **maintenance window** outside peak hours, so automatic upgrades happen when the on-call is awake.
- **Maintenance exclusions** around launches, freezes and holiday periods. Check the docs for which exclusion scopes block which kinds of upgrade, and for any maximum length.
- A **release channel** per environment: for example a faster channel for dev and a stable one for prod, so problems show up in dev weeks ahead. Confirm channel names and behaviour in the docs.

Automatic upgrades with a bad window are the most common source of surprise node churn.

## Graceful termination and drain limits

Pods get `terminationGracePeriodSeconds` to finish. A service with a 10 minute grace period slows every batch. GKE bounds how long it waits for a drain on its own and then proceeds, so a Pod that ignores SIGTERM is killed eventually, and a PDB that cannot be satisfied does not block forever. The exact limits are not documented here; read the upgrade page in the sources. Do not rely on the platform timeout: fix the PDB or the shutdown behaviour. See [[zero-downtime-deployments-kubernetes]] for preStop hooks and connection draining.

## Failure modes

| Symptom                                       | Cause                                                         | Fix                                                              |
| --------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Upgrade stalls on one node                    | PDB with zero allowed disruptions, or a Pod stuck terminating | Audit PDBs before the upgrade, fix the blocker, see the PDB note |
| Upgrade fails creating nodes                  | Not enough quota, IPs or stock for surge or green nodes       | Request quota, lower surge, pick another time or zone            |
| Services dip during a batch                   | Too many Pods drained at once for the replica count           | Lower surge or batch size, add replicas, add spread              |
| Soak hides a bug until the old nodes are gone | Nobody watched the metrics during the soak                    | Define success metrics and an owner before the upgrade starts    |
| Stateful member loses quorum                  | Drain evicted two members, or a PDB was missing               | Quorum PDB, blue-green with small batches                        |
| Cost spike after upgrade                      | Blue nodes kept after a long soak, or surge nodes left behind | Set a finite soak, check for orphan nodes after completion       |

## Pre-checks and post-checks

Before:

1. `kubectl get pdb -A` and the zero-disruption audit from [[pod-disruption-budgets-for-stateless-services]].
2. Quota headroom for surge or double capacity in the pool's region.
3. The target version is available in the release channel, and release notes were read for deprecated APIs.
4. A recent backup for stateful data, see [[backup-architecture-gke-cloud-sql-gcs]].

After:

1. `kubectl get nodes -o wide` shows the expected version on every node.
2. No Pods Pending or crash-looping: `kubectl get pods -A --field-selector=status.phase!=Running`.
3. SLO dashboards are normal, see [[slo-burn-rate-alerting]].
4. The old pool or blue nodes are gone after the soak and billing for them has stopped.

## Rollback

- **Blue-green, during soak.** Use the rollback action in the console or the gcloud command listed in the upgrade docs. Blue nodes are uncordoned and workloads return. Look up the exact command for your version before you need it.
- **Blue-green, after soak** and **surge**. There is no in-place rollback. Create a new pool at the previous version if GKE still offers it, taint the upgraded pool, drain it into the new one, and delete it. Control plane downgrades are generally not supported, so confirm in the docs.
- **Settings.** Reverting the strategy in Terraform changes only future upgrades.

## Related

- [[gke-cluster-upgrade]]
- [[stateful-workloads-gke]]
- [[pod-disruption-budgets-for-stateless-services]]
- [[zero-downtime-deployments-kubernetes]]
- [[kubernetes-autoscaling]]
- [[terraform-module-and-state-layout]]

## Sources

- https://cloud.google.com/kubernetes-engine/docs/concepts/node-pool-upgrade-strategies
- https://cloud.google.com/kubernetes-engine/docs/how-to/node-pool-upgrade-strategies
- https://cloud.google.com/kubernetes-engine/docs/concepts/maintenance-windows-and-exclusions
- https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/container_node_pool
