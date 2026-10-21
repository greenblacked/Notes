---
title: OpenCost vs Kubecost vs GKE cost allocation
description: Comparing GKE cost allocation in the billing export, OpenCost and Kubecost for per-workload cost, idle cost and request efficiency on GKE.
type: tool
tags:
  - tools
  - gke
  - cost
  - kubernetes
  - gcp
created: 2026-10-21
modified: 2026-10-21
draft: false
---

[[finops-cost-allocation-and-guardrails]] allocates Google Cloud spend with labels and the BigQuery billing export, and stops at the cluster: a shared GKE cluster is one line on the bill. Teams then ask three questions the bill cannot answer. What does my namespace cost? How much of the cluster is idle? How far are my requests above what I use? Three tools answer them on GKE: GKE cost allocation, which puts namespace and label breakdowns into the billing export; OpenCost, the open-source cost model that reads Prometheus; and Kubecost, the commercial product built on the same origins. This note compares them and recommends an order of adoption.

> [!info] Not checked against current releases
> Written from the `gcloud` 570.0.0 help text, the Terraform Google provider documentation source, and the OpenCost and Kubecost repositories on 2026-10-21; Google's cost allocation and billing export pages could not be opened. Not verified: the label keys and column names GKE cost allocation writes to the export, its limits, Autopilot behaviour and the delay until data appears; the billing export schema and latency; Kubecost editions, licence, free tier and pricing, and whether Kubecost 3.x needs Prometheus on GKE; OpenCost's CNCF maturity level; how OpenCost connects to Managed Service for Prometheus; how OpenCost handles Autopilot per-pod billing. No prices are quoted.

## Criteria

| Criterion                 | Question                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| Data source and discounts | Does the number come from the invoice (with committed use and negotiated discounts) or from list prices? |
| Idle and unallocated cost | Is capacity nobody requested shown, hidden, or spread silently over teams?                               |
| Granularity               | Cluster, namespace, label, workload, pod, container; per day or per hour.                                |
| Autopilot                 | Autopilot bills by pod requests, not nodes; does the tool model that?                                    |
| UI and API                | Who looks at it: engineers in a UI, finance in BigQuery and BI, or automation through an API.            |
| Data location             | Billing data in your BigQuery, or cost data in a cluster component and its storage.                      |
| Operating cost            | Components to run, secure and upgrade.                                                                   |

## At a glance

| Concern           | GKE cost allocation                                               | OpenCost                                                                | Kubecost                                                 |
| ----------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| What it is        | Cluster setting that adds Kubernetes breakdowns to billing export | Open-source cost model and API (Apache-2.0), plus a separate UI         | Commercial product; documentation now on IBM Docs        |
| Data source       | Your billing data in BigQuery                                     | Prometheus metrics plus cloud list prices; optional billing integration | Its own agent and database in 3.x (per the chart README) |
| Discounts         | As billed                                                         | Allocation API uses on-demand list pricing                              | Not verified                                             |
| Breakdown         | Cluster, namespace, label ("informational", per the CLI help)     | Cluster, node, namespace, controller, pod, container, label, annotation | Similar plus more views; check the current docs          |
| Idle cost         | Not verified how it is shown                                      | `__idle__` allocation, or shared with `shareIdle`                       | Yes; check the current docs                              |
| Requests vs usage | No                                                                | Yes                                                                     | Yes, with recommendations                                |
| You operate       | Nothing extra                                                     | Exporter, Prometheus capacity, UI auth                                  | Agent, database, UI auth, licence                        |

## GKE cost allocation

The cheapest step: one cluster setting, no new component. The `gcloud` help says that, when enabled, "you can get informational GKE cost breakdowns by cluster, namespace and label in your billing data exported to BigQuery". It requires the standard billing export to BigQuery, which the FinOps architecture note already sets up.

```bash title="enable on an existing cluster"
gcloud container clusters update example-cluster \
  --region=europe-west1 --project=example-project \
  --enable-cost-allocation
# turn off again: --no-enable-cost-allocation
gcloud container clusters describe example-cluster \
  --region=europe-west1 --project=example-project \
  --format='value(costManagementConfig.enabled)'
```

```hcl title="modules/gke/cost-allocation.tf"
resource "google_container_cluster" "primary" {
  # ... other settings omitted ...

  cost_management_config {
    enabled = true
  }
}
```

Do not confuse it with **GKE usage metering** (`resource_usage_export_config` in Terraform), an older, separate feature that writes resource usage to its own BigQuery dataset and can deploy a network egress metering DaemonSet.

A namespace query has to read the Kubernetes labels GKE adds to the export rows. The label keys below are placeholders: check the cost allocation page and the schema of your export table (`bq show --schema`) before using it.

```sql title="queries/gke-cost-by-namespace.sql (skeleton: verify the label keys and fields)"
-- Replace the table with your detailed or standard billing export table.
-- NOT VERIFIED: the key that holds the namespace, and whether it sits in labels or system_labels.
DECLARE ns_key STRING DEFAULT 'k8s-namespace';

SELECT
  project.id AS project_id,
  (SELECT l.value FROM UNNEST(labels) AS l WHERE l.key = ns_key) AS namespace,
  ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0)), 2) AS net_cost
FROM `example-billing.billing_export.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX`
-- No service filter: node cost can be billed under Compute Engine SKUs that carry the Kubernetes labels.
WHERE EXISTS (SELECT 1 FROM UNNEST(labels) AS l WHERE l.key = ns_key)
  AND usage_start_time >= TIMESTAMP('2026-10-01')
  AND usage_start_time <  TIMESTAMP('2026-11-01')
GROUP BY project_id, namespace
ORDER BY net_cost DESC;
```

Practical points:

- Net cost includes credits, so committed use discounts and negotiated pricing are already in the number. That is the main advantage over any list-price model.
- The skeleton filters on the presence of the namespace label, not on the Kubernetes Engine service, because node charges can appear under Compute Engine depending on cluster mode. Run it once grouped by `service.description` as well to see which services carry the Kubernetes labels.
- Report what the query does not attribute: compare its total with the clusters' total cost for the same period (the same projects' rows without the namespace label). As in the FinOps note, the size of that unallocated share is the health metric of the allocation.
- Build a BigQuery view on top of this, give finance and team leads read access, and put a Looker Studio or Grafana dashboard over the view.

## OpenCost

OpenCost is an Apache-2.0 cost model with a specification and a Go implementation; its README says it was originally developed and open sourced by Kubecost. It reads resource requests and usage from Prometheus, prices nodes, disks and network, and serves allocations through an API and a separate UI. It installs with Helm only; the standalone manifests were removed.

```bash title="install OpenCost (pin the chart version; values below)"
CHART_VERSION="<pinned chart version>"
helm repo add opencost-charts https://opencost.github.io/opencost-helm-chart
helm repo update
helm upgrade --install opencost opencost-charts/opencost \
  --namespace opencost --create-namespace \
  --version "${CHART_VERSION}" -f opencost-values.yaml
kubectl -n opencost rollout status deploy/opencost
```

```yaml title="opencost-values.yaml (sketch; check keys against the chart's values.yaml)"
opencost:
  exporter:
    defaultClusterId: example-cluster
    resources:
      requests:
        cpu: 10m # example from the OpenCost docs, not a sizing guarantee
        memory: 55Mi
      limits:
        memory: 1Gi
  dataRetention:
    dailyResolutionDays: 30 # default 15
  prometheus:
    internal:
      namespaceName: monitoring
      serviceName: prometheus-kube-prometheus-prometheus
      port: 9090
```

### Prometheus on GKE

The chart assumes an existing Prometheus. If you follow [[0042-managed-prometheus-for-application-metrics]], OpenCost needs a Prometheus-compatible query endpoint in front of Managed Service for Prometheus, typically the GMP query frontend; point the chart's external Prometheus setting at it (check the chart's values for the key). That wiring was not verified for this note.

OpenCost's own GCP page documents a known break on Managed Prometheus: GMP relabels `namespace` to `exported_namespace`, and OpenCost's queries fail with "found duplicate series for the match group ... many-to-many matching not allowed". The documented workaround is to stop the label override on the `PodMonitoring` and `ClusterPodMonitoring` resources that scrape kube-state-metrics and the OpenCost exporter:

```yaml title="PodMonitoring fragment from the OpenCost GCP page"
spec:
  targetLabels:
    metadata: []
```

Check which other dashboards rely on the relabelled labels before changing a shared monitor. If you run a sharded Prometheus, set OpenCost to a global query endpoint (Thanos Query, Mimir or similar; see [[thanos-vs-mimir-vs-victoriametrics]]), and avoid scraping kube-state-metrics twice.

### GCP pricing

OpenCost detects Google Cloud from `node.spec.providerID` and fetches node prices from the Cloud Billing API, which needs an API key passed as `opencost.exporter.cloudProviderApiKey` (environment variable `CLOUD_PROVIDER_API_KEY`). Create the key restricted to the Cloud Billing API, store it in Secret Manager or a Kubernetes Secret, and never commit it in a values file. Whether the chart can read it from an existing Secret was not verified; check the values file.

For billing-accurate numbers, OpenCost's cloud cost integration reads the BigQuery billing export. Its GCP page asks for a service account with `roles/compute.viewer`, `roles/bigquery.user`, `roles/bigquery.dataViewer` and `roles/bigquery.jobUser`, configured in a `cloud-integration.json`, and its example creates a service account key. Prefer [[gke-workload-identity]] if the integration supports it; that was not verified.

### Querying the API

```bash title="cost by namespace for the last 7 days, idle shown separately"
kubectl -n opencost port-forward deployment/opencost 9003 &
curl -sG http://localhost:9003/allocation \
  -d window=7d -d aggregate=namespace -d includeIdle=true \
  | jq '.data[0] | to_entries | map({ns: .key, cost: .value.totalCost}) | sort_by(-.cost)'
```

- `window` takes values such as `today`, `7d` or an RFC3339 range; `aggregate` takes `namespace`, `controller`, `pod`, `label:<name>` and others, or a comma list.
- `includeIdle=true` with `shareIdle=false` (both documented defaults are false) puts unused capacity in an `__idle__` row. `shareIdle=true` spreads it in proportion to each allocation's cost; use that only once teams agree to pay for headroom.
- The allocation API is based on on-demand list pricing. It will not match the invoice when you have committed use discounts. That is expected; see reconciliation below.
- The response fields used in the `jq` filter are illustrative; check the API page for the current response shape.

Comparing requests with usage per container is OpenCost's most useful output for engineers: it is the input for rightsizing requests ([[kubernetes-resource-requests-and-limits]]) and for tuning autoscaling targets ([[kubernetes-autoscaling]]).

## What Kubecost adds

The Kubecost chart README points to official documentation on IBM Docs and an IBM support contact, so the product is now IBM-owned; the old documentation host was unreachable when this note was written. Per that README, Kubecost 3.x replaced its 2.x architecture: a ClickHouse database instead of DuckDB, a "Direct" metrics source instead of Prometheus, and a `finops-agent` that the README credits with ten-minute metric granularity and lower memory use (vendor claims). A 3.x primary re-ingests all data on first start, which the README says can take from 20 minutes to two days.

What it typically adds over OpenCost is product: saved reports, multi-cluster views, alerts, recommendations, and support. The licence of the application, the free tier and the price were not verified; the chart repository's Apache-2.0 licence says nothing about them. Evaluate it as a purchase ([[build-vs-buy-devops-tools]]), with a data-location and access review, since it holds a detailed map of every workload.

## Reconciling the totals

The three tools will never agree to the cent. Reconcile once, document why, and report the gaps:

| Gap                   | Cause                                                    | How to handle it                                                                     |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Idle capacity         | Nodes bigger than the sum of requests                    | Show as a separate platform line; do not hide it in team totals                      |
| System namespaces     | `kube-system`, `gke-*`, monitoring and policy agents     | Platform overhead line, or share by agreed key                                       |
| Shared load balancers | One ingress or gateway serving many teams                | Allocate by request share from metrics, or treat as platform                         |
| Network egress        | Not always attributable to a pod                         | Report separately; usage metering's egress option or flow logs if it matters         |
| Discounts and credits | Committed use discounts, sustained use, negotiated rates | Billing export is the truth; scale model numbers by the ratio of billed to list cost |
| Autopilot             | Billed by pod requests; node-based models do not apply   | Use the billing export; verify OpenCost's handling before relying on it              |

## Showback, then chargeback

1. **Showback.** Publish the namespace view monthly with the `unallocated` and idle lines. Owners come from [[0019-namespace-per-team-tenancy]] and the label standard ([[kubernetes-labels-and-annotations-standard]]).
2. **Fix the data.** Chase unlabelled namespaces and workloads until `unallocated` is small.
3. **Rightsizing.** Feed requests-vs-usage into team backlogs; track the gap as a metric.
4. **Chargeback.** Only once teams trust the numbers, and finance agrees on how idle and shared costs are split. Feed the result into [[engineering-budget-planning]].

## Failure modes

- **Unlabelled namespaces.** Cost lands in `unallocated`, and the report loses credibility. Enforce owner labels at admission.
- **Short Prometheus retention.** OpenCost cannot report a period for which Prometheus has no data. Its own daily retention (15 days by default) is separate from Prometheus retention; check both.
- **Double counting.** Adding OpenCost's numbers to the billing export, or scraping kube-state-metrics twice, doubles costs. Pick one source of truth per report.
- **Broken queries on Managed Prometheus.** The `exported_namespace` relabelling above; symptoms are empty or erroring allocations.
- **Cost UI exposed without authentication.** The OpenCost UI and API show every workload, namespace and label in the cluster. Keep them behind `kubectl port-forward`, IAP or an authenticating proxy; never a public load balancer.
- **API keys in Git.** The pricing API key or a billing service account key committed in a values file. Use a Secret and keyless identity.

## Validation

```bash
# Cost allocation is on
gcloud container clusters describe example-cluster --region=europe-west1 \
  --project=example-project --format='value(costManagementConfig.enabled)'

# OpenCost is running and answering
kubectl -n opencost get pods
kubectl -n opencost logs deploy/opencost --since=15m | grep -i -E 'error|prometheus'
curl -sG http://localhost:9003/allocation -d window=1d -d aggregate=namespace | jq '.code'
```

Then compare one week of OpenCost's total for a cluster with the billing export's net cost for the same cluster and week. A ratio that is stable week to week is fine; a ratio that jumps means a data problem.

## Recommendation

Start with **GKE cost allocation plus a BigQuery view**: it costs no new component, uses billed prices with discounts, and finance already trusts the billing export. Add **OpenCost** when engineers need requests-vs-usage and idle per workload, run it behind authentication, and fix the Managed Prometheus label issue first. Consider **Kubecost** only when you need its reports, multi-cluster product and support enough to buy them, after verifying its current licence and architecture on IBM Docs. Compare which metrics backend feeds OpenCost in [[prometheus-vs-cloud-monitoring]].

## Related

- [[finops-cost-allocation-and-guardrails]]
- [[engineering-budget-planning]]
- [[kubernetes-resource-requests-and-limits]]
- [[kubernetes-autoscaling]]
- [[kubernetes-labels-and-annotations-standard]]
- [[0019-namespace-per-team-tenancy]]
- [[prometheus-vs-cloud-monitoring]]
- [[0042-managed-prometheus-for-application-metrics]]
- [[build-vs-buy-devops-tools]]
- [[thanos-vs-mimir-vs-victoriametrics]]

## Sources

- [GKE cost allocations](https://cloud.google.com/kubernetes-engine/docs/how-to/cost-allocations)
- [Export Cloud Billing data to BigQuery](https://cloud.google.com/billing/docs/how-to/export-data-bigquery)
- [gcloud container clusters update](https://cloud.google.com/sdk/gcloud/reference/container/clusters/update)
- [Terraform google_container_cluster](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/container_cluster)
- [OpenCost installation](https://www.opencost.io/docs/installation/install)
- [OpenCost on GCP](https://www.opencost.io/docs/configuration/gcp)
- [OpenCost and Prometheus](https://www.opencost.io/docs/installation/prometheus)
- [OpenCost API](https://www.opencost.io/docs/integrations/api)
- [OpenCost repository](https://github.com/opencost/opencost)
- [Kubecost documentation on IBM Docs](https://www.ibm.com/docs/en/kubecost/self-hosted/3.x)
- [Kubecost Helm chart](https://github.com/kubecost/cost-analyzer-helm-chart)
