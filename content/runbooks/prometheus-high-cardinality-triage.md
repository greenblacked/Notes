---
title: Prometheus high cardinality triage
description: Find the metric or label exploding the series count, stop growth with scrape limits and relabeling, and recover Prometheus memory safely.
type: runbook
tags:
  - runbooks
  - prometheus
  - observability
  - reliability
  - cost
created: 2026-10-19
modified: 2026-10-19
draft: false
---

How to find and stop a cardinality explosion in Prometheus: a metric, label or target that creates new time series faster than the server can hold them. Symptoms are memory growth, OOM kills, slow queries and, with managed services, a surprising bill. The fix has three layers: stop the growth now, fix the instrumentation, and let old series age out.

> [!info] Scope and verification
> The queries and config were not run against a live Prometheus and the note is not marked `verified`. Endpoint names and config options below match the Prometheus documentation as known; check the version you run, and the current docs for the exact behaviour of `sample_limit` and the TSDB status API. No pricing is quoted.

## When to use

- Prometheus restarts with `OOMKilled`, or memory climbs steadily with no traffic change.
- `prometheus_tsdb_head_series` rises sharply or continuously.
- Queries time out, rules take longer than their interval, or the UI is slow.
- A Managed Service for Prometheus or hosted bill rises without new services.
- A deploy added a label such as user ID, request path, pod UID or trace ID to a metric.

## Preconditions

- Access to the Prometheus UI or API and to the repo that holds scrape configs, `ServiceMonitor` or `PodMonitor` objects, and rules.
- Permission to change scrape configuration through your normal change flow; see [[production-change-checklist]].
- A way to find who owns a metric: job and namespace labels, service catalog.
- Know whether the instance is self-managed (Prometheus Operator, kube-prometheus-stack) or Google Cloud Managed Service for Prometheus. See [[prometheus-vs-cloud-monitoring]] for the trade-offs.

```bash
PROM=http://127.0.0.1:9090        # port-forward target, see below
NS=monitoring
kubectl -n "$NS" port-forward svc/prometheus-operated 9090:9090 &
```

## Steps

### 1. Measure head series and growth

```bash
curl -s "$PROM/api/v1/query" --data-urlencode 'query=prometheus_tsdb_head_series' | jq '.data.result[0].value'
curl -s "$PROM/api/v1/query" --data-urlencode 'query=deriv(prometheus_tsdb_head_series[30m])' | jq '.data.result[0].value'
curl -s "$PROM/api/v1/query" --data-urlencode 'query=rate(prometheus_tsdb_head_series_created_total[5m])' | jq '.data.result[0].value'
```

Useful related signals: `process_resident_memory_bytes`, `prometheus_tsdb_head_chunks`, and `prometheus_target_scrape_pool_exceeded_target_limit_total`. Compare with the same time yesterday to see whether growth started at a deploy. Dashboards should chart these; see [[observability-signals-and-dashboards]].

A flat but too-high series count is a capacity problem. A steep, continuing rise is an explosion, and it is the urgent one.

### 2. Find the offending metric and label

The TSDB status endpoint is the cheapest first stop. Check the Prometheus API documentation for the response format in your version.

```bash
curl -s "$PROM/api/v1/status/tsdb" | jq '.data.seriesCountByMetricName[:10]'
curl -s "$PROM/api/v1/status/tsdb" | jq '.data.labelValueCountByLabelName[:10]'
curl -s "$PROM/api/v1/status/tsdb" | jq '.data.seriesCountByLabelValuePair[:10]'
```

`seriesCountByMetricName` names the top metrics by series. `labelValueCountByLabelName` names labels with the most distinct values, which is where an unbounded label shows up (`path`, `user_id`, `pod_uid`, `trace_id`).

To go further with PromQL, remember it is expensive on a struggling server:

```promql
# Heavy: touches every series. Run once, off-peak if possible, with a short time range.
topk(10, count by (__name__) ({__name__=~".+"}))
```

Safer targeted forms, once you know the metric:

```promql
topk(10, count by (job) (http_request_duration_seconds_bucket))
count(count by (path) (http_requests_total))
```

### 3. Find the target and the change

```promql
# Series produced per scrape, by target
topk(10, scrape_samples_scraped)
topk(10, scrape_series_added)
topk(10, count by (job, namespace) (up))
```

`scrape_series_added` shows targets introducing new series each scrape. Correlate the start of growth with a deploy in the owning namespace, and look at one raw exposition to see the offending label:

```bash
kubectl -n app port-forward deploy/api 8080:8080 &
curl -s http://127.0.0.1:8080/metrics | awk -F'[{,]' '/^http_requests_total/ {print $0}' | head -20
```

Check also for histograms: every bucket multiplies series by the number of label combinations, so a histogram with an unbounded label is the usual heavy hitter.

### 4. Stop the growth

Choose the least destructive control that works. All of these go through your normal config flow and are safe to roll back.

**Drop the offending label** (keeps the metric, removes the explosive dimension). `labeldrop` matches label names:

```yaml title="prometheus-scrape-snippet.yaml"
scrape_configs:
  - job_name: api
    kubernetes_sd_configs:
      - role: pod
    metric_relabel_configs:
      - regex: "path|user_id"
        action: labeldrop
```

`labeldrop` applies to all metrics from that job. To drop a label on one metric only, rewrite the label first with a condition:

```yaml title="prometheus-scrape-snippet.yaml"
metric_relabel_configs:
  - source_labels: [__name__, path]
    regex: "http_requests_total;.+"
    target_label: path
    replacement: ""
    action: replace
```

Removing a label can merge series into duplicates with the same label set in one scrape, which Prometheus rejects as duplicate samples. Test against a copy first.

**Drop a whole metric** that nobody needs:

```yaml title="prometheus-scrape-snippet.yaml"
metric_relabel_configs:
  - source_labels: [__name__]
    regex: "debug_.*|http_request_size_bytes_bucket"
    action: drop
```

**Set limits per job** so one team cannot take down the server:

```yaml title="prometheus-scrape-snippet.yaml"
scrape_configs:
  - job_name: api
    sample_limit: 50000
    label_limit: 30
    label_value_length_limit: 200
```

The numbers are examples, not recommendations; choose them from your own baseline. When `sample_limit` is exceeded, the scrape is treated as failed and, as far as the docs state, the samples from that scrape are discarded, so `up` goes to 0 and your `up == 0` alerts fire. Verify this behaviour for your version, and warn owners before enabling. The same limit options exist on the Operator objects:

```yaml title="servicemonitor-limits.yaml"
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: api
  namespace: monitoring
spec:
  sampleLimit: 50000
  labelLimit: 30
  selector:
    matchLabels:
      app: api
  endpoints:
    - port: metrics
      metricRelabelings:
        - sourceLabels: [__name__]
          regex: "debug_.*"
          action: drop
```

> [!warning] Dropping a metric breaks what uses it
> Before you drop or relabel a metric, search recording rules, alert rules, dashboards and SLO queries for it. A dropped metric turns alerts that use it silent, which is worse than noisy. Grep your rule repo: `grep -rn "http_request_size_bytes" rules/ dashboards/`. See [[slo-burn-rate-alerting]] for SLO queries that depend on specific histograms.

### 5. Fix at the source

Relabeling is a tourniquet. The real fix is in the code or exporter:

- Never put unbounded values (user IDs, emails, full URLs, request IDs, timestamps, error strings) in labels. Use bounded enums or route templates (`/users/:id`).
- Keep histogram bucket counts modest and label sets small.
- Move high-cardinality detail to logs or traces instead, which is the role they play in [[observability-pipeline-opentelemetry]].
- Follow the naming and labeling guidance in the Prometheus practices documentation.

File an issue with the owning team and link the incident; track removal of the relabel workaround.

### 6. Let old series age out

Series created during the explosion stay in the head until their chunks are compacted and retention removes them. Memory drops after the head block is cut, which can take hours, and a restart reloads from the WAL, so expect memory to stay high until compaction catches up. Restarting immediately may only add replay time. Check the current Prometheus storage documentation for the head and WAL behaviour in your version.

Deleting series with the admin API is optional and risky:

```bash
# Requires --web.enable-admin-api, which is off by default and should stay off in shared environments.
curl -s -X POST "$PROM/api/v1/admin/tsdb/delete_series" --data-urlencode 'match[]={__name__="http_requests_total",path=~".+"}'
curl -s -X POST "$PROM/api/v1/admin/tsdb/clean_tombstones"
```

Enabling the admin API exposes destructive endpoints. Turn it on only temporarily, behind authentication or via a port-forward, and turn it off again. Deleted data cannot be recovered.

### 7. Managed Service for Prometheus and cost

With Google Cloud Managed Service for Prometheus, ingestion cost is driven by the number of samples ingested, so the same relabeling and limits apply at the collector. Check the current pricing documentation for the unit and any free allowances; this note quotes no prices. A cost owner should track ingested samples by metric; see [[finops-cost-allocation-and-guardrails]].

## Validation

```bash
curl -s "$PROM/api/v1/query" --data-urlencode 'query=deriv(prometheus_tsdb_head_series[30m])' | jq '.data.result[0].value'
curl -s "$PROM/api/v1/status/tsdb" | jq '.data.seriesCountByMetricName[:5]'
curl -s "$PROM/api/v1/targets" | jq '[.data.activeTargets[] | select(.health!="up")] | length'
```

Confirm:

- Series growth has flattened and memory is stable.
- No new targets are failing, especially those with a new `sample_limit`.
- Alert rules, recording rules and dashboards that used the changed metric still return data. Run a test alert; see [[first-prometheus-alert]].
- Scrape duration and rule evaluation time are back inside their intervals.

## Rollback

- Revert the relabel or limit commit in git and let the config reload (`kill -HUP`, the `/-/reload` endpoint if enabled, or the Operator rollout).
- Restore a dropped metric by reverting; values dropped before the revert are gone, and gaps remain.
- If a `sample_limit` causes `up == 0` alerts, raise or remove it, then fix the producer.
- Remove any temporary admin API flag and restart Prometheus with the previous arguments.

## Troubleshooting

| Symptom                                           | Likely cause and fix                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Prometheus OOMs on start, before you can query    | WAL replay of a huge head. Give it temporary memory, or move the data and restart cautiously.    |
| `topk(... {__name__=~".+"})` times out            | Too heavy. Use `/api/v1/status/tsdb` instead.                                                    |
| After relabeling, targets show `duplicate sample` | `labeldrop` merged series. Keep the discriminating label or aggregate in the app.                |
| `up == 0` alerts after setting `sample_limit`     | Scrape fails once the limit is exceeded. Raise the limit or fix the source.                      |
| Series count is stable but memory is high         | Many long-lived series or large labels. Check `labelValueCountByLabelName` and label lengths.    |
| Cost stays high after relabel                     | The drop ran on the server after ingestion, or collector config did not reload. Check collector. |

## Related

- [[prometheus-vs-cloud-monitoring]] for the managed or self-hosted decision.
- [[observability-signals-and-dashboards]] for which signals to chart.
- [[first-prometheus-alert]] for validating rules after a change.
- [[slo-burn-rate-alerting]] for SLO queries that depend on specific metrics.
- [[observability-pipeline-opentelemetry]] for moving high-cardinality detail out of metrics.
- [[finops-cost-allocation-and-guardrails]] for tracking observability spend.

## Sources

- [Prometheus HTTP API: TSDB stats](https://prometheus.io/docs/prometheus/latest/querying/api/#tsdb-stats)
- [Prometheus configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
- [Prometheus: metric and label naming](https://prometheus.io/docs/practices/naming/)
- [Google Cloud Managed Service for Prometheus](https://cloud.google.com/stackdriver/docs/managed-prometheus)
