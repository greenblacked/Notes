---
title: "Kubernetes autoscaling on GKE: HPA, VPA and the cluster autoscaler"
description: How the Horizontal Pod Autoscaler, Vertical Pod Autoscaler and GKE cluster autoscaler work together, with manifests, Terraform, pitfalls and checks.
type: pattern
tags:
  - patterns
  - kubernetes
  - gke
  - reliability
  - cost
created: 2026-10-17
modified: 2026-10-17
draft: false
---

This note is for senior DevOps engineers who run services on GKE and want autoscaling that is predictable and cheap. It covers the Horizontal Pod Autoscaler (HPA) v2 with scaling behavior, the Vertical Pod Autoscaler (VPA) used as a recommender, and the cluster autoscaler with node auto-provisioning. It leaves the sizing of requests and limits to [[patterns/kubernetes-resource-requests-and-limits]] and rollout safety to [[patterns/zero-downtime-deployments-kubernetes]].

> [!info] Scope and sources
> Written against the `autoscaling/v2` HPA API, the VPA custom resource that GKE offers, and the GKE cluster autoscaler, using kubernetes.io and cloud.google.com documentation. Terraform shown targets the Google provider.

> [!note] Not verified
> The claims below were written from documentation knowledge and were not checked against a running system or the current docs: GKE autoscaling profile names, node auto-provisioning settings, the status of the multidimensional pod autoscaler, and Terraform attribute names. Check them before relying on them.

## Which autoscaler does what

| Concern        | HPA                           | VPA                             | Cluster autoscaler                    |
| -------------- | ----------------------------- | ------------------------------- | ------------------------------------- |
| What it scales | Number of pod replicas        | Requests of containers          | Number of nodes                       |
| Trigger        | Metrics (CPU, memory, custom) | Observed usage over time        | Unschedulable pods, idle nodes        |
| Reaction time  | Seconds to minutes            | Slow, based on history          | Minutes (node start)                  |
| Best for       | Stateless services with load  | Right-sizing requests           | Matching capacity to pod demand       |
| Main risk      | Flapping, missing requests    | Restarts pods when set to apply | Blocked scale-down, hidden max limits |

They form a chain: HPA adds pods, pods that do not fit become Pending, the cluster autoscaler adds nodes. VPA tells you what the requests should be so the first two work on accurate numbers.

## Problem and when it applies

Fixed replica counts waste money at night and fail under load. Manual tuning does not survive traffic changes. Autoscaling fits stateless services with variable load and nodes that can come and go. It does not fit single-replica stateful workloads, or services whose startup takes longer than the traffic spikes you need to absorb.

## HPA

The HPA compares observed metrics with a target, as a ratio against the pod's request. For CPU utilization, that means a missing request makes the metric undefined, and the HPA does nothing useful.

`behavior` controls speed. Scale up quickly, scale down slowly: scaling down too eagerly causes flapping and cold starts.

```yaml title="deploy/web/hpa.yaml"
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web
  namespace: shop
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web
  minReplicas: 3
  maxReplicas: 30
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 65
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
        - type: Pods
          value: 4
          periodSeconds: 60
      selectPolicy: Max
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 20
          periodSeconds: 60
```

Notes:

- Set `minReplicas` to at least what you need for availability (two or three, spread over zones), not to what you need for cost.
- The numbers above are starting points. Tune them from load tests and real traffic.
- When an HPA manages the Deployment, do not also set a Deployment `replicas` value in Git that Argo CD will keep resetting; omit `replicas` from the manifest or ignore that field in the sync policy.

## VPA as a recommender

Run the VPA with `updateMode: "Off"`. It then publishes recommendations without evicting pods. A human or a pull request applies them to the manifests. This avoids surprise restarts and avoids conflicts with the HPA.

```yaml title="deploy/web/vpa.yaml"
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: web
  namespace: shop
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web
  updatePolicy:
    updateMode: "Off"
  resourcePolicy:
    containerPolicies:
      - containerName: "*"
        controlledResources: ["cpu", "memory"]
        minAllowed:
          cpu: 50m
          memory: 64Mi
```

The recommendation needs some days of representative traffic. Read it, compare it with current requests, and change requests through your normal review.

## Cluster autoscaler and node auto-provisioning

On GKE the cluster autoscaler adds nodes when pods cannot be scheduled and removes nodes that are underused and whose pods can move elsewhere. Node auto-provisioning goes further and creates node pools with shapes that fit pending pods, within limits you set. An autoscaling profile controls how eagerly it removes nodes; one profile favors keeping spare capacity and another favors higher utilization.

```hcl title="modules/gke/autoscaling.tf"
resource "google_container_cluster" "primary" {
  name     = "prod-eu"
  location = "europe-west1" # change: your region
  # ... network, private cluster and other settings omitted ...

  vertical_pod_autoscaling {
    enabled = true
  }

  # enables node auto-provisioning; per-pool autoscaling is the node pool block
  cluster_autoscaling {
    enabled             = true
    autoscaling_profile = "OPTIMIZE_UTILIZATION" # change: or "BALANCED"

    resource_limits {
      resource_type = "cpu"
      minimum       = 8
      maximum       = 400 # change: this is a hard ceiling, see pitfalls
    }

    resource_limits {
      resource_type = "memory"
      minimum       = 32
      maximum       = 1600 # change: GB
    }
  }
}

resource "google_container_node_pool" "general" {
  name     = "general"
  cluster  = google_container_cluster.primary.id
  location = google_container_cluster.primary.location

  autoscaling {
    total_min_node_count = 3  # change: across all zones
    total_max_node_count = 30 # change: a ceiling you have budgeted for
    location_policy      = "BALANCED"
  }

  node_config {
    machine_type = "e2-standard-4" # change: your machine type
  }
}
```

Regional clusters spread nodes over zones, so whether limits apply per zone or in total depends on which attributes you use. Read the provider documentation for the attributes you choose.

## Interactions and conflicts

- **HPA and VPA on the same metric.** If the VPA applies changes to CPU requests while the HPA scales on CPU utilization, the two fight: changing the request changes the utilization the HPA sees. Keep the VPA in `Off` mode, or use HPA on a custom metric when the VPA applies changes.
- **PodDisruptionBudgets and scale-down.** The cluster autoscaler respects PDBs when it drains nodes. A PDB that allows zero disruptions blocks scale-down forever.
- **Requests drive everything.** The scheduler, the HPA's utilization ratio and the autoscaler's node choice all use requests. Wrong requests produce wrong scaling.
- **Startup time.** HPA sees a new pod only after it is scheduled and ready. If nodes must also start, scale-up takes minutes. Keep some headroom (a higher `minReplicas`, or overprovisioning with low-priority placeholder pods).

```yaml title="deploy/web/pdb.yaml"
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web
  namespace: shop
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: web
```

Use `maxUnavailable: 1` (or a percentage) rather than `minAvailable` equal to the replica count, so nodes can still drain.

## Example: a web service

Putting it together for a stateless web service:

1. Set realistic `requests` on the Deployment (CPU, memory), reviewed with the VPA recommendation.
2. Add the HPA above with 3 minimum replicas spread by topology spread constraints.
3. Add the PDB.
4. Enable the cluster autoscaler on the node pool with a budgeted maximum.
5. Add a readiness probe so new pods only receive traffic when ready (see [[patterns/zero-downtime-deployments-kubernetes]]).
6. Load test, watch the scale-up and scale-down, and adjust the behavior policies.

Cost matters here: unused headroom is cost. Link the autoscaling limits to your budgets in [[architecture/finops-cost-allocation-and-guardrails]], and decide the node layout together with [[architecture/gke-platform-topology-and-tenancy]].

## Pitfalls

- **No CPU request.** The HPA reports `unknown` for utilization and never scales.
- **HPA and VPA both applying on CPU.** See above.
- **Scale-down blocked.** Pods with local storage, pods without a controller, restrictive PDBs, and pods annotated as not safe to evict keep nodes alive.
- **Hidden ceilings.** `maxReplicas`, node pool `max` and the cluster-wide resource limits are three ceilings. Quotas on the project are a fourth. The lowest one wins and the symptom is Pending pods.
- **Flapping.** Short stabilization windows with spiky metrics cause repeated scale up and down. Lengthen the scale-down window.
- **Scaling on the wrong signal.** CPU is a poor signal for queue consumers or IO-bound services. Use a custom or external metric such as queue depth or requests per second.
- **Forgetting the dependency.** More pods can overload the database. Cap `maxReplicas` using what the backend can handle.

## Verify

```bash
set -euo pipefail

NAMESPACE="shop"   # change: your namespace
APP="web"          # change: your HPA and Deployment name

kubectl get hpa "${APP}" -n "${NAMESPACE}"
kubectl describe hpa "${APP}" -n "${NAMESPACE}"

# VPA recommendations (read them, do not apply blindly)
kubectl get vpa "${APP}" -n "${NAMESPACE}" -o yaml

# Pods that cannot be scheduled and why
kubectl get pods -n "${NAMESPACE}" --field-selector=status.phase=Pending
kubectl get events -n "${NAMESPACE}" --sort-by=.lastTimestamp | tail -n 20

# Autoscaler activity on nodes
kubectl get events -A --field-selector reason=TriggeredScaleUp
kubectl get events -A --field-selector reason=ScaleDown
```

Expected: the HPA shows real current and target values (not `<unknown>`), the VPA has a recommendation per container, and scale-up events appear when you load test.

## Rollback

- Remove or relax the HPA by setting `minReplicas` and `maxReplicas` to a fixed, known-good count, then deleting it if needed. Argo CD or Helm will restore it if it is in Git, so change Git.
- Set the VPA to `Off` or delete it; this has no effect on running pods.
- To undo node autoscaling changes, revert the Terraform change. Reverting restores the previous limits; existing nodes stay until the autoscaler removes them under those limits.
- For a bad rollout of the requests, use [[runbooks/helm-release-rollback]].

## Related

- [[patterns/kubernetes-resource-requests-and-limits]]: how to size the requests every autoscaler depends on.
- [[patterns/zero-downtime-deployments-kubernetes]]: probes, PDBs and rollout settings that keep scaling safe.
- [[architecture/gke-platform-topology-and-tenancy]]: node pool and cluster layout that autoscaling runs inside.
- [[architecture/finops-cost-allocation-and-guardrails]]: where autoscaling limits meet budgets.
