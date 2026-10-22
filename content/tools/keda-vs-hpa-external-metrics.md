---
title: KEDA vs HPA with external metrics on GKE
description: Scaling GKE workloads on queue depth and other external metrics with the HPA and a metrics adapter or with KEDA, including scale to zero and failure handling.
type: tool
tags:
  - tools
  - kubernetes
  - gke
  - reliability
  - prometheus
created: 2026-10-21
modified: 2026-10-21
draft: false
---

[[kubernetes-autoscaling]] covers the HPA on CPU and memory and ends with "use a custom or external metric" for workloads where CPU is the wrong signal. Queue consumers are the common case: a worker that reads a Pub/Sub subscription should scale on backlog, not on CPU, and an idle one should ideally run zero pods ([[pubsub-event-driven-messaging]] describes the messaging side). There are two ways to do that on GKE. The plain HPA reads an external metric through a metrics adapter you install. KEDA installs its own operator and metrics server, creates the HPA for you, and adds scale to zero, fallback and pause controls. This note compares them and gives working manifests for both.

> [!info] Not checked against current releases
> Written from the Kubernetes, KEDA and Custom Metrics Stackdriver Adapter documentation source on 2026-10-21; not checked against the published pages, so verify there. Not verified: the GKE tutorial for Pub/Sub autoscaling and its exact HPA manifest; the Managed Service for Prometheus HPA page; whether the Custom Metrics Stackdriver Adapter is actively maintained or offered as a GKE add-on; the label key used to select a Pub/Sub subscription in the external metric; the Pub/Sub metric delay in Cloud Monitoring; the Kubernetes version on which `HPAScaleToZero` is on by default in GKE; KEDA on Autopilot; the PromQL form of the Pub/Sub backlog metric used in the KEDA example.

> [!warning] KEDA's Google Cloud scalers are deprecated
> At the time of writing (2026-10-21), the KEDA scaler pages for `gcp-pubsub`, `gcp-stackdriver` and `gcp-cloudtasks` say the scaler is deprecated and will not receive changes. KEDA's "Google Cloud deprecations" post (2025-09-15) explains that they depend on Monitoring Query Language, says KEDA does not plan to remove them while Google supports MQL, and strongly encourages moving to the `prometheus` scaler against Managed Service for Prometheus. Only `gcp-storage` is stated as still supported. The KEDA examples below use the Prometheus scaler.

## Criteria

| Criterion             | Question                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Metric sources        | Can it read Cloud Monitoring metrics (Pub/Sub, Cloud Tasks), PromQL, and your own app metrics? |
| Scale to zero         | Can an idle consumer run zero pods, and what wakes it?                                         |
| HPA ownership         | Who creates the HPA, and what stops two controllers fighting over `replicas`?                  |
| Google Cloud auth     | Does the component reach Cloud Monitoring through Workload Identity, without keys?             |
| Metric source failure | What replica count do you get when the metric cannot be read?                                  |
| Cost and operations   | Extra components to run, upgrade, monitor and page on.                                         |

## At a glance

| Concern              | HPA + Custom Metrics Stackdriver Adapter               | HPA + Managed Prometheus adapter path              | KEDA                                                             |
| -------------------- | ------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------- |
| Metric source        | Any Cloud Monitoring metric (DOUBLE or INT64)          | PromQL through a query frontend and an adapter     | Many scalers; on Google Cloud, the Prometheus scaler against GMP |
| Components you run   | The adapter                                            | Query frontend plus adapter (details not verified) | Operator, metrics server, admission webhooks                     |
| Scale to zero        | Only with `HPAScaleToZero` on your GKE version (check) | Same                                               | Yes, the default `minReplicaCount` is 0                          |
| Who owns the HPA     | You                                                    | You                                                | KEDA creates and owns it                                         |
| Behaviour on failure | HPA stops acting on that metric                        | Same                                               | Optional `fallback` to a fixed or current replica count          |
| Jobs per event       | No                                                     | No                                                 | `ScaledJob`                                                      |

## The HPA path

The HPA reads external metrics from the `external.metrics.k8s.io` API. Something has to serve that API; on GKE that is usually the Custom Metrics Stackdriver Adapter, which exposes Cloud Monitoring metrics through the Custom and External Metrics APIs. Its README documents three rules worth knowing:

- Any Cloud Monitoring metric with value type DOUBLE or INT64 can be read as an external metric.
- The metric name replaces `/` with `|`, so `pubsub.googleapis.com/subscription/num_undelivered_messages` becomes `pubsub.googleapis.com|subscription|num_undelivered_messages`.
- DELTA and CUMULATIVE metrics are exposed as a per-second rate over the last five minutes.

### Install the adapter with Workload Identity

```bash title="custom metrics adapter with Workload Identity (follow the adapter README for the manifest)"
PROJECT_ID="example-project"
GSA="metrics-adapter@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create metrics-adapter --project="${PROJECT_ID}"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${GSA}" --role=roles/monitoring.viewer
gcloud iam service-accounts add-iam-policy-binding "${GSA}" \
  --role=roles/iam.workloadIdentityUser \
  --member="serviceAccount:${PROJECT_ID}.svc.id.goog[custom-metrics/custom-metrics-stackdriver-adapter]"

# Review, then apply the manifest named in the adapter README (deploy/production/adapter_new_resource_model.yaml)
kubectl apply -f adapter_new_resource_model.yaml
kubectl annotate serviceaccount custom-metrics-stackdriver-adapter -n custom-metrics \
  iam.gke.io/gcp-service-account="${GSA}"
```

Download the manifest from a tagged release, review it and commit it to your GitOps repository rather than applying a URL from `master`. The README notes the install needs cluster-admin on GKE. An optional `--external-metric-cache-ttl` flag caches external metric reads; see the README for the release it arrived in. See [[gke-workload-identity]] for the binding pattern.

### HPA on Pub/Sub backlog

```yaml title="deploy/orders-worker/hpa.yaml"
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: orders-worker
  namespace: orders
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: orders-worker
  minReplicas: 2
  maxReplicas: 40
  metrics:
    - type: External
      external:
        metric:
          name: pubsub.googleapis.com|subscription|num_undelivered_messages
          selector:
            matchLabels:
              resource.labels.subscription_id: orders-worker # label key not verified
        target:
          type: AverageValue
          averageValue: "100" # 100 undelivered messages per pod
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
        - type: Pods
          value: 5
          periodSeconds: 60
      selectPolicy: Max
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 20
          periodSeconds: 60
```

How it behaves:

- With `AverageValue`, the HPA divides the metric by the target, so a backlog of 2,000 messages asks for 20 pods. If several series match the selector, they are summed.
- `behavior` follows the same rules as for CPU: each policy has type `Pods` or `Percent`, `periodSeconds` is at most 1800, and with several policies the one that allows the most change wins unless `selectPolicy` says otherwise. The default tolerance is 10% cluster wide.
- The Kubernetes documentation prefers custom (object) metrics over external ones where possible, because the external metrics API can potentially expose any metric. Restrict who can read `external.metrics.k8s.io` with RBAC.
- Remove `spec.replicas` from the Deployment once an HPA owns it.

### HPA on a Managed Prometheus metric

[[0042-managed-prometheus-for-application-metrics]] puts application metrics in Managed Service for Prometheus. Driving a plain HPA from a PromQL query needs something that serves the External or Custom Metrics API from PromQL. The usual route is the GMP query frontend (its README describes it as a thin proxy that re-exposes the Prometheus HTTP API and authenticates to GMP itself) plus a Prometheus metrics adapter in front of it. That is two extra components to run. This note was not checked against Google's Managed Prometheus HPA page, so no manifest is given; follow that page. KEDA's Prometheus scaler talks to the GMP API directly and needs neither.

### Scale to zero with the HPA

Kubernetes allows `minReplicas: 0` only for HPAs with at least one Object or External metric, behind the `HPAScaleToZero` feature gate, which must be on in both kube-apiserver and kube-controller-manager. The upstream development-branch documentation, which can be ahead of any released version, describes it as on by default and adds a `ScaledToZero` status condition. Whether it is on for your GKE minor version was not verified; until you have confirmed it, use KEDA for scale to zero on GKE.

## The KEDA path

KEDA splits scaling into two phases. **Activation** (0 to 1 and back) is decided by KEDA itself, using `activationThreshold`; a trigger is active only when the value is strictly greater than it. **Scaling** (1 to N) is done by an HPA that KEDA creates and feeds through its own external metrics server. If `minReplicaCount` is 1 or more, the scaler is always active and activation values are ignored.

### Install

```bash title="install KEDA (pin a chart version you have reviewed)"
CHART_VERSION="<pinned chart version>"
helm repo add kedacore https://kedacore.github.io/charts
helm repo update
helm upgrade --install keda kedacore/keda \
  --namespace keda --create-namespace --version "${CHART_VERSION}"
kubectl -n keda get deploy
```

- The chart manages the CRDs. Check KEDA's Kubernetes compatibility table for your cluster version before upgrading either.
- On GKE, the control plane must reach KEDA's metrics server and webhooks on port 6443 of the pod range. KEDA's cluster page says 443 does not apply to Google Cloud. On private clusters, add a firewall rule for 6443 from the control plane range, or the HPA reports that it cannot get external metrics.
- The operator, metrics server and admission webhooks each request 100m CPU and 100Mi memory in the default manifests. KEDA's documentation says full high availability is not supported because of upstream limitations, so plan for a short metrics outage during its upgrades.

### Workload Identity for the operator

```bash title="let keda-operator read Managed Prometheus"
PROJECT_ID="example-project"
GSA="keda-operator@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create keda-operator --project="${PROJECT_ID}"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${GSA}" --role=roles/monitoring.viewer
gcloud iam service-accounts add-iam-policy-binding "${GSA}" \
  --role=roles/iam.workloadIdentityUser \
  --member="serviceAccount:${PROJECT_ID}.svc.id.goog[keda/keda-operator]"
kubectl annotate serviceaccount keda-operator -n keda \
  iam.gke.io/gcp-service-account="${GSA}"
kubectl -n keda rollout restart deploy/keda-operator
```

In a GitOps setup, set the annotation through the chart values instead of `kubectl annotate`, so Argo CD does not remove it.

### ScaledObject on Pub/Sub backlog through Managed Prometheus

```yaml title="deploy/orders-worker/scaledobject.yaml"
apiVersion: keda.sh/v1alpha1
kind: ClusterTriggerAuthentication
metadata:
  name: gcp-workload-identity
spec:
  podIdentity:
    provider: gcp
---
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: orders-worker
  namespace: orders
spec:
  scaleTargetRef:
    name: orders-worker
  pollingInterval: 30
  cooldownPeriod: 600 # wait 10 minutes of inactivity before going to zero
  minReplicaCount: 0
  maxReplicaCount: 40
  fallback:
    failureThreshold: 3
    replicas: 6
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        scaleDown:
          stabilizationWindowSeconds: 300
          policies:
            - type: Percent
              value: 20
              periodSeconds: 60
  triggers:
    - type: prometheus
      metadata:
        serverAddress: https://monitoring.googleapis.com/v1/projects/example-project/location/global/prometheus
        # Not verified: the PromQL name and labels of the subscription backlog metric. Test in Metrics Explorer first.
        query: 'max(max_over_time({"__name__"="pubsub.googleapis.com/subscription/num_undelivered_messages","monitored_resource"="pubsub_subscription","subscription_id"="orders-worker"}[2m]))'
        threshold: "100"
        activationThreshold: "0"
      authenticationRef:
        kind: ClusterTriggerAuthentication
        name: gcp-workload-identity
```

What each part does:

- `serverAddress` is the GMP Prometheus HTTP API, as documented on KEDA's Prometheus scaler page; the only supported authentication for it is GCP Workload Identity.
- The query follows the pattern of the KEDA deprecation post, which migrates the Stackdriver scaler to `{"__name__"="pubsub.googleapis.com/topic/...","monitored_resource"="pubsub_topic",...}`. The subscription form above is inferred from that pattern; run it in Metrics Explorer's PromQL tab before you rely on it.
- The default `metricType` is `AverageValue`, so `threshold: "100"` means 100 messages per replica, the same as the HPA example.
- `cooldownPeriod` applies only to going back to zero; 1 to N and back is the HPA's `behavior`.
- `fallback` applies after three consecutive failures to read the metric: KEDA feeds the HPA a synthetic value so it settles at six replicas (`behavior: static`, the default). Other behaviours keep the current count or only move one way. Fallback works for `Value` and `AverageValue` triggers except CPU and memory, and only on ScaledObjects.

Defaults worth knowing: `pollingInterval` 30 seconds, `cooldownPeriod` 300 seconds, `minReplicaCount` 0, `maxReplicaCount` 100. The generated HPA is named `keda-hpa-<scaledobject-name>`.

### ScaledJob for long-running work

The HPA cannot choose which pod to remove on scale down. KEDA's documentation uses the example of a three-hour message: the HPA may terminate a pod 2.9 hours into processing it. Its two options are to delay termination (handle `SIGTERM`, set `terminationGracePeriodSeconds`, accept a long `Terminating` state) or to run each unit of work as a Kubernetes Job with a `ScaledJob` (`jobTargetRef`, `scalingStrategy`, `successfulJobsHistoryLimit` defaulting to 100). For anything that runs longer than a few minutes, prefer the Job.

## One owner for the HPA

KEDA creates and owns the HPA for a ScaledObject. Never also create your own HPA for the same Deployment: two HPAs on one target fight, and the replica count oscillates.

- To migrate an existing HPA to KEDA without deleting it first, set the annotation `scaledobject.keda.sh/transfer-hpa-ownership: "true"` and `advanced.horizontalPodAutoscalerConfig.name` to the existing HPA's name.
- `validations.keda.sh/hpa-ownership: "true"` disables KEDA's admission check for this; leave it alone.
- Remove `spec.replicas` from the Deployment manifest, and tell Argo CD to ignore it so syncs do not reset the count (see [[argocd-sync-failure-and-drift]]):

```yaml title="Argo CD Application: ignore replicas managed by the autoscaler"
spec:
  ignoreDifferences:
    - group: apps
      kind: Deployment
      jsonPointers:
        - /spec/replicas
```

Operational switches on the ScaledObject: `autoscaling.keda.sh/paused: "true"` freezes the current count; `autoscaling.keda.sh/paused-replicas: "0"` scales to that number and pauses. Use them in incidents instead of deleting the ScaledObject.

## Failure modes

- **Adapter or KEDA metrics server down.** The HPA shows `ScalingActive False` with a failed-to-get-metric reason and keeps the current replica count. Without KEDA's `fallback`, a backlog then grows unattended. Alert on the HPA condition and on the components' readiness ([[alert-and-runbook-standard]]).
- **Cold start against the SLO.** From zero, the first message waits for the polling interval, the metric delay, scheduling, possibly a new node, image pull and start-up. If the consumer has a latency SLO, keep `minReplicaCount: 1` and scale to zero only off hours, or accept the delay explicitly.
- **Thrash.** A bursty queue with a short scale-down window adds and removes pods every minute. Use a scale-down stabilization window of several minutes and size the per-pod target from a load test ([[load-and-performance-testing]]).
- **Metric lag.** Cloud Monitoring metrics such as Pub/Sub backlog arrive with a delay (not quantified here). The autoscaler reacts to the past; set `maxReplicaCount` and scale-up policies so a spike does not overshoot into node exhaustion.
- **Pending pods.** The HPA asks for 40 pods and the cluster autoscaler has to add nodes. Requests must be right ([[kubernetes-resource-requests-and-limits]]), and a low priority class for batch consumers keeps them from evicting serving pods ([[priority-classes-and-preemption]]).
- **Disruption budgets.** A PDB with `minAvailable` equal to the replica count blocks node drains when the HPA holds a consumer at its minimum ([[pod-disruption-budgets-for-stateless-services]]). For queue consumers, a percentage-based `maxUnavailable` is usually safer.
- **Expired or missing IAM.** Workload Identity binding removed, or `roles/monitoring.viewer` missing: expect permission errors in the KEDA operator log and a ScaledObject that is not ready.

## Validation

```bash title="check the autoscaling chain end to end"
NS=orders
kubectl -n "${NS}" get scaledobject orders-worker
kubectl -n "${NS}" describe scaledobject orders-worker | sed -n '/Conditions/,/Events/p'
kubectl -n "${NS}" get hpa
kubectl -n "${NS}" describe hpa keda-hpa-orders-worker | sed -n '/Conditions/,$p'

# Is the external metrics API served, and by whom?
kubectl get apiservice v1beta1.external.metrics.k8s.io
kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1" | jq '.resources[].name'

# KEDA operator errors
kubectl -n keda logs deploy/keda-operator --since=15m | grep -i -E 'error|permission'
```

Healthy output shows the ScaledObject `READY True`, the HPA conditions `AbleToScale True` and `ScalingActive True`, and the APIService `Available True`. For the adapter path, read the metric value directly to see what the HPA sees; the metric name is URL-encoded and the namespace is the HPA's namespace:

```bash
kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1/namespaces/orders/pubsub.googleapis.com%7Csubscription%7Cnum_undelivered_messages" | jq .
```

Then publish a test batch to the subscription's topic in a non-production project and watch the replica count rise and fall: `kubectl -n orders get deploy orders-worker -w`.

## Rollback

- **KEDA ScaledObject misbehaving.** Pause it with `autoscaling.keda.sh/paused-replicas` set to a safe count, fix, then remove the annotation. Deleting the ScaledObject deletes its HPA; with `advanced.restoreToOriginalReplicaCount: false` (the default) the Deployment keeps its current count.
- **Back to a plain HPA.** Delete the ScaledObject, set a fixed `replicas` temporarily, then apply your own HPA.
- **Remove KEDA entirely.** Delete all ScaledObjects and ScaledJobs first, then `helm uninstall keda --namespace keda`. Removing the operator first leaves HPAs pointing at a metrics API that no longer exists.

## Recommendation

Use **KEDA with the Prometheus scaler against Managed Service for Prometheus** for queue consumers and anything that should scale to zero. It needs no separate adapter, has fallback and pause controls, and supports Jobs for long work. Keep the plain **HPA on CPU or memory** for request-serving workloads ([[kubernetes-autoscaling]]), and use the HPA with the Custom Metrics Stackdriver Adapter only where you already run it and do not need scale to zero. Do not adopt the deprecated `gcp-pubsub` scaler for new work. Revisit when GKE documents `HPAScaleToZero` as on for your version and a supported metrics adapter path, at which point the plain HPA may be enough. For which backend holds the metrics, see [[prometheus-vs-cloud-monitoring]].

## Related

- [[kubernetes-autoscaling]]
- [[pubsub-event-driven-messaging]]
- [[kubernetes-resource-requests-and-limits]]
- [[pod-disruption-budgets-for-stateless-services]]
- [[priority-classes-and-preemption]]
- [[load-and-performance-testing]]
- [[gke-workload-identity]]
- [[0042-managed-prometheus-for-application-metrics]]

## Sources

- [Kubernetes: Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Kubernetes: HPA walkthrough, metrics not related to Kubernetes objects](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/)
- [KEDA: scaling deployments](https://keda.sh/docs/latest/concepts/scaling-deployments/)
- [KEDA: ScaledObject specification](https://keda.sh/docs/latest/reference/scaledobject-spec/)
- [KEDA: Prometheus scaler](https://keda.sh/docs/latest/scalers/prometheus/)
- [KEDA: Google Cloud Pub/Sub scaler (deprecated)](https://keda.sh/docs/latest/scalers/gcp-pub-sub/)
- [KEDA: GCP Workload Identity](https://keda.sh/docs/latest/authentication-providers/gcp-workload-identity/)
- [KEDA: cluster requirements](https://keda.sh/docs/latest/operate/cluster/)
- [KEDA blog: Google Cloud deprecations](https://keda.sh/blog/2025-09-15-gcp-deprecations/)
- [Custom Metrics Stackdriver Adapter](https://github.com/GoogleCloudPlatform/k8s-stackdriver/tree/master/custom-metrics-stackdriver-adapter)
- [Managed Service for Prometheus: HPA](https://cloud.google.com/stackdriver/docs/managed-prometheus/hpa)
- [GKE tutorial: autoscaling on metrics](https://cloud.google.com/kubernetes-engine/docs/tutorials/autoscaling-metrics)
- [Argo CD: diffing customization](https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/)
