---
title: Prometheus vs Cloud Monitoring
description: Choosing between self-managed Prometheus, Google Cloud Managed Service for Prometheus and Cloud Monitoring for GKE metrics.
type: tool
tags:
  - tools
  - prometheus
  - observability
  - gke
  - cost
created: 2026-10-16
modified: 2026-10-16
draft: false
---

On GKE there are three realistic ways to get metrics and alerts: run Prometheus yourself, use Google Cloud Managed Service for Prometheus (GMP), or use Cloud Monitoring's native metrics. They are not exclusive. GMP stores Prometheus metrics in Cloud Monitoring's backend (Monarch), so the real choice is who runs collection and rule evaluation.

> [!note] Not independently verified
> The Google documentation host could not be fetched when this note was written. Confirm GMP behaviour, limits and retention on the Google Cloud documentation and pricing pages before committing.

## At a glance

| Concern        | Self-managed Prometheus                     | Managed Service for Prometheus                                             | Cloud Monitoring (native)                         |
| -------------- | ------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| Who runs it    | You: server, storage, HA, upgrades          | Google runs storage and query; collectors run in cluster                   | Google                                            |
| Collection     | Prometheus scrapes                          | Managed collection (`PodMonitoring`) or self-deployed collectors           | Agents and built-in GKE system metrics            |
| Query language | PromQL                                      | PromQL, via the Prometheus-compatible query API                            | MQL and Monitoring filters; PromQL also supported |
| Retention      | You choose, bound by disk                   | Set by the service; check current docs                                     | Set per metric type; check current docs           |
| Alerting       | Prometheus rules plus Alertmanager          | Managed rule evaluation, or Cloud Monitoring alert policies                | Alert policies                                    |
| Scaling        | Federation, Thanos or Mimir for large scale | Handled by the backend                                                     | Handled by the backend                            |
| Dashboards     | Grafana                                     | Grafana through the Prometheus data source, or Cloud Monitoring dashboards | Cloud Monitoring dashboards                       |
| Portability    | Highest                                     | High: PromQL, exporters, Prometheus config concepts                        | Lowest                                            |

## Self-managed Prometheus

You run Prometheus (typically via the Prometheus Operator or `kube-prometheus-stack`), Alertmanager and long-term storage if needed. You get full control over scrape config, recording rules, relabelling and retention. You also own capacity planning, HA pairs, upgrades and the failure mode where Prometheus is down while the cluster is on fire. A single server does not give long-term retention or a global view across clusters; that needs Thanos, Mimir or similar.

Choose it when you need multi-cloud portability, very custom pipelines, or data to stay out of the Google backend.

## Managed Service for Prometheus

GMP keeps the Prometheus data model and PromQL but moves storage and querying to Google. With managed collection, a Google-operated collector runs in the cluster and scrapes targets declared with `PodMonitoring` or `ClusterPodMonitoring` resources.

```yaml title="podmonitoring.yaml"
apiVersion: monitoring.googleapis.com/v1
kind: PodMonitoring
metadata:
  name: api
  namespace: shop
spec:
  selector:
    matchLabels:
      app: api
  endpoints:
    - port: metrics
      interval: 30s
```

Points to know:

- Existing exporters and `/metrics` endpoints work unchanged. The resource model differs from the Prometheus Operator's `ServiceMonitor`.
- You can query with PromQL from Cloud Monitoring, Grafana (using the Prometheus data source against the GMP endpoint) or the API. Verify which PromQL features and functions are supported in the current docs, especially for rules and subqueries.
- Global queries across clusters and projects are possible because data lives in one backend, scoped by metrics scope.
- Recording and alerting rules can be evaluated by managed rule evaluation, using `Rules` resources, with alerts sent to a managed or self-hosted Alertmanager.

## Cloud Monitoring

GKE system and workload metrics are available in Cloud Monitoring without Prometheus. Alert policies, uptime checks, SLO monitoring and notification channels are integrated with the rest of Google Cloud (Pub/Sub, Cloud Run, Cloud SQL). It is the lowest-effort path for infrastructure metrics and for teams that do not know PromQL.

The downside is lock-in: dashboards, alert policies and metric names are Google-specific, and custom application metrics need either the Cloud Monitoring API or Prometheus-style collection.

## Cost model

Do not guess; use the calculators.

- **Self-managed:** compute and disk for Prometheus, Alertmanager and any long-term store, plus engineer time. Cost scales with series count and retention.
- **GMP and Cloud Monitoring:** priced on usage, such as samples ingested and API reads; the dimensions and rates change. See the [Google Cloud Observability pricing page](https://cloud.google.com/stackdriver/pricing).
- **High cardinality is the cost driver in all three.** Labels such as user ID, pod name with unbounded churn or full URL paths multiply series. Drop or aggregate them at scrape time with relabelling.

Estimate before migrating: count active series (`sum(prometheus_tsdb_head_series)`, the active series in each server's head block; sum across your Prometheus servers; avoid `count({__name__=~".+"})`, which touches every series and is expensive on large servers), scrape interval and number of clusters, then put those into the pricing calculator.

## Alerting

Whichever backend you choose, alert on symptoms tied to service level objectives, not on every resource metric. Multi-window burn-rate alerts are covered in [[slo-burn-rate-alerting]]. Keep rules in Git, validate them in CI (`promtool check rules`), and route to one on-call system so [[on-call-health]] is not damaged by duplicate pages from two stacks.

```bash
RULES=alerts/slo.rules.yaml
promtool check rules "$RULES"
```

## When to choose which

Choose **self-managed Prometheus** when portability, custom pipelines or strict data residency outweigh operational effort.

Choose **Managed Service for Prometheus** when you already use PromQL and Prometheus exporters and want Google to run storage, scaling and retention.

Choose **Cloud Monitoring native** when you mainly need GKE and GCP service metrics and integrated alerting with minimal setup.

## Recommendation for GKE

Use Cloud Monitoring's built-in GKE metrics for the platform layer, and Managed Service for Prometheus for application metrics, with PromQL as the common query and alerting language and Grafana for dashboards. Keep rules and dashboards in Git. Run self-managed Prometheus only for a specific requirement that GMP cannot meet, and review series cardinality monthly whichever way you go.
