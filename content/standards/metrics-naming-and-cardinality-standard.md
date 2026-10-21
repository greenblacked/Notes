---
title: Metrics naming and cardinality standard
description: Metric and label naming, units, required metrics per service type, histogram buckets, recording rule names and a cardinality budget.
type: standard
tags:
  - standards
  - observability
  - prometheus
  - opentelemetry
  - cost
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Logs have a schema ([[structured-logging-conventions]]); metrics need one too. Without it, three services measure latency in three units, a dashboard sums milliseconds with seconds, and an alert written for one service cannot be copied to the next. The bigger risk is cost and stability: every distinct combination of label values is a separate time series, so one label holding user IDs or raw URLs can multiply a metric into millions of series, slow every query and, on Managed Service for Prometheus, raise the bill with the sample count. This standard fixes how metrics and labels are named, which metrics every service must expose, how histograms are bucketed, how recording rules are named, and how much cardinality a service may spend. Finding and fixing an explosion that already happened is in [[prometheus-high-cardinality-triage]].

## Scope

- Application metrics we instrument, whether with a Prometheus client library or OpenTelemetry, and exported to Google Cloud Managed Service for Prometheus ([[0042-managed-prometheus-for-application-metrics]]) or any other Prometheus-compatible backend.
- Recording rules and alert rules we write ([[0046-dashboards-and-alert-rules-as-code]]).
- Not in scope: names of metrics produced by third-party exporters, kube-state-metrics, cAdvisor or Google Cloud system metrics. We use those as they come, and only control which of them we keep.

> [!info] Check the current docs
> Naming rules come from the Prometheus [naming](https://prometheus.io/docs/practices/naming/) and [instrumentation](https://prometheus.io/docs/practices/instrumentation/) practices, which Prometheus itself calls a style guide rather than a requirement; we make them mandatory. The OpenTelemetry to Prometheus mapping depends on the exporter's settings, and Managed Service for Prometheus cost controls and native histogram support were **not verified** for this note. The cardinality budget and the required-metric names are **proposed team defaults**.

## Metric names

Every metric name MUST:

1. **Use only the classic character set** `[a-zA-Z_:][a-zA-Z0-9_:]*`, in `snake_case`, with no `:` (colons are reserved for recording rules). Newer Prometheus versions accept wider character sets; we do not use them, so names survive every backend and query tool.
2. **Start with a single-word prefix** naming the application or domain: `orders_`, `payments_`, `http_` for generic HTTP server metrics from a library.
3. **Measure one quantity in one unit.** Never mix seconds and milliseconds in one metric, never put a total and a rate in one name.
4. **Use base units** and say the unit as a plural suffix: `_seconds`, `_bytes`, `_meters`. Ratios are `_ratio` with values from 0 to 1, not percentages.
5. **End counters in `_total`**, after the unit: `orders_processing_seconds_total`, `orders_created_total`.
6. **Use `_info` for metadata pseudo-metrics** with value 1 (`orders_build_info{version="1.14.2",revision="abc1234"}`) and `_timestamp_seconds` for Unix times (`orders_last_success_timestamp_seconds`).
7. **Not contain label names or values.** `http_requests_500_total` is wrong; `http_requests_total{code="500"}` is right.
8. **Pass the sum test.** `sum()` or `avg()` across all of the metric's labels must mean something. If it does not, it is two metrics.

| Wrong                       | Right                                                              | Why                                   |
| --------------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| `orders_latency_ms`         | `orders_request_duration_seconds` (histogram)                      | Base unit, describes what is measured |
| `orders_requests`           | `orders_requests_total`                                            | Counters end in `_total`              |
| `orders_cpu_percent`        | `orders_cpu_usage_ratio`                                           | Ratios 0 to 1                         |
| `orders_eu_errors_total`    | `orders_errors_total{region="eu"}`                                 | No label values in names              |
| `orders_queue_size_and_age` | `orders_queue_messages`, `orders_queue_oldest_message_age_seconds` | One quantity per metric               |
| `OrdersCacheHits`           | `orders_cache_hits_total`                                          | snake_case, counter suffix            |

## OpenTelemetry names

Services instrumented with OpenTelemetry use the [semantic conventions](https://opentelemetry.io/docs/specs/semconv/) for anything they cover (HTTP, RPC, database, messaging) and our naming rules for their own metrics. The conventions use dotted names and keep the unit in metadata rather than in the name, for example `http.server.request.duration`, a histogram in seconds (`s`).

The [OpenTelemetry Prometheus compatibility specification](https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/) describes how such a metric becomes a Prometheus series: invalid characters are replaced with `_`, the unit is added as a word suffix (`s` becomes `_seconds`), units in braces such as `{request}` are dropped, and monotonic sums get `_total`. So `http.server.request.duration` is queried as `http_server_request_duration_seconds_bucket`, `_sum` and `_count`. Resource attributes are exposed through a `target_info` metric, and scope labels such as `otel_scope_name` are added by default.

> [!warning] Translation depends on the exporter
> Collectors, exporters and recent Prometheus versions have settings that change the translation (for example keeping dots, or not adding suffixes). The behaviour above is the specification's default, not a promise about your pipeline. Check the configuration of the OpenTelemetry Collector gateway ([[0043-opentelemetry-collector-gateway]]) and query a real series before you write alerts against a translated name.

Rules for our own OpenTelemetry metrics: name them in the semantic-convention style (`orders.checkout.duration`), set the unit in metadata in UCUM (`s`, `By`, `1`), and do not put the unit in the name. They then translate to names that meet the Prometheus rules above. See [[observability-pipeline-opentelemetry]] for the pipeline.

## Labels

Labels are dimensions you will group or filter by. They are also the multiplier of cost.

**Every label value set MUST be bounded and small.** The Prometheus instrumentation guidance is to keep the cardinality of a metric's labels below 10 values for most metrics, to limit metrics above that to a handful across the system, and to look for alternatives above 100. Most metrics should have no labels at all beyond the ones the scrape adds (`job`, `instance`, `namespace` and so on).

**Forbidden as label values:**

| Forbidden                                                                 | Use instead                                                                  |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| User, customer, account, tenant or session IDs                            | Logs and traces; or a small, fixed `tier` or `plan` label                    |
| Email addresses, names, IP addresses                                      | Nothing. These are also personal data ([[structured-logging-conventions]])   |
| Raw URL paths (`/orders/12345`) or query strings                          | The route template from the router: `route="/orders/{id}"`                   |
| Request, trace or span IDs                                                | Exemplars, if the backend supports them; otherwise traces                    |
| Error messages or stack traces                                            | A bounded `reason` label from a fixed list (`timeout`, `refused`, `invalid`) |
| Timestamps, versions with build numbers, commit SHAs                      | An `_info` metric with one series per running version                        |
| Unbounded enumerations from input (country typed by user, free-text tags) | Map to a fixed list with `other`                                             |

**Label naming:** `snake_case`; no `__` prefix (reserved); the same name means the same thing everywhere (`code` is always the HTTP status code, `route` always the route template, `method` always the HTTP method). Do not add labels that the scrape already adds (`namespace`, `pod`, `cluster`); on Managed Service for Prometheus some target labels are protected and cannot be overwritten by relabelling.

## Required metrics per service type

The split by service type follows the Prometheus [instrumentation](https://prometheus.io/docs/practices/instrumentation/) page: online-serving systems, offline processing and batch jobs. Metric names below are our proposed defaults; libraries that already emit equivalent metrics (OpenTelemetry HTTP instrumentation, gRPC interceptors) satisfy the rule if their names meet the naming rules above.

| Service type                       | Required metrics (proposed names)                                                                                                                                                              | Answers                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| HTTP or gRPC API (RED)             | `http_requests_total{method,route,code}`; `http_request_duration_seconds` histogram `{method,route}`; `http_requests_in_flight` gauge                                                          | Rate, errors, duration               |
| Queue consumer or stream processor | `<app>_messages_processed_total{result}`; `<app>_message_processing_duration_seconds` histogram; `<app>_last_processed_timestamp_seconds`; `<app>_consumer_lag_seconds` or backlog in messages | Throughput, failures, freshness, lag |
| Batch or scheduled job             | `<job>_last_success_timestamp_seconds`; `<job>_duration_seconds` (gauge of the last run); `<job>_records_processed_total`; `<job>_failures_total`                                              | Did it run, did it succeed, how long |
| Resource pools (USE)               | `<app>_db_pool_connections{state}` (`in_use`, `idle`); `<app>_db_pool_wait_seconds` histogram; `<app>_worker_pool_utilization_ratio`                                                           | Utilization, saturation, errors      |
| Every service                      | `<app>_build_info{version,revision}` = 1                                                                                                                                                       | What is running                      |

- **Count failures next to totals.** Expose `..._total` and either a `code`/`result` label or a separate `..._failures_total`, so a failure ratio can be computed.
- **Count when the operation ends**, so the count, the errors and the duration describe the same requests.
- **Freshness beats success counts for pipelines.** "Last processed at" catches a stalled consumer that reports no errors because it receives nothing. The Prometheus naming page's own example is `data_pipeline_last_record_processed_timestamp_seconds`.
- **Batch jobs** that finish before a scrape push their metrics or are observed by their scheduler; the rules for that are in [[scheduled-jobs-standard]].
- **Node, container and Kubernetes object metrics** (CPU, memory, restarts) come from the platform's exporters; do not re-implement them in the application.

## Histograms

- **Latency and size MUST be histograms**, not summaries. Histogram buckets can be aggregated across instances and then turned into quantiles with `histogram_quantile`; summary quantiles cannot be aggregated ([histograms and summaries](https://prometheus.io/docs/practices/histograms/)).
- **Classic histograms are the default** on our platform. The Prometheus [histograms practice page](https://prometheus.io/docs/practices/histograms/) now says to use native histograms and prefer them over classic histograms and summaries where you can (read 2026-10-21 from its source repository). Whether Managed Service for Prometheus ingests native histograms was not verified, so native histograms need a platform decision before a team adopts them.
- **Bucket boundaries MUST include every SLO threshold** for that metric. If the latency SLO says "under 300 ms", there is a bucket boundary at exactly `0.3`, so the SLI is an exact bucket ratio and not an interpolation ([[slo-definition-standard]]).
- **Keep buckets few.** Each bucket is a series per label combination. Ten to twelve boundaries cover most services. Changing boundaries later breaks continuity of dashboards and SLO history, so choose them once and review them with the SLO.

```go title="metrics.go"
// Bucket boundaries in seconds; 0.3 is the SLO threshold and must stay.
var requestDuration = prometheus.NewHistogramVec(
	prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "Time from request received to response written.",
		Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2.5, 5, 10},
	},
	[]string{"method", "route"},
)
```

The example uses the Go client's `HistogramOpts`; other client libraries have equivalent options. It was not compiled for this note.

## Recording rule names

Recording rules follow the Prometheus [rules practice](https://prometheus.io/docs/practices/rules/): `level:metric:operations`.

- `level` is the aggregation level, the labels kept in the output (`job`, `service_route`).
- `metric` is the metric name, with `_total` removed when `rate()` or `irate()` is applied.
- `operations` lists what was applied, newest first (`rate5m`, `ratio_rate5m`, `p99`).
- Aggregate numerators and denominators separately, then divide; never average a ratio or an average. Use `without` or `by` explicitly.

```yaml title="rules/orders-api-recording.yaml"
groups:
  - name: orders-api.recording
    interval: 30s
    rules:
      - record: job:http_requests:rate5m
        expr: sum by (job) (rate(http_requests_total{job="orders-api"}[5m]))
      - record: job:http_request_errors:rate5m
        expr: sum by (job) (rate(http_requests_total{job="orders-api",code=~"5.."}[5m]))
      - record: job:http_request_errors_per_requests:ratio_rate5m
        expr: job:http_request_errors:rate5m / job:http_requests:rate5m
      - record: job_route:http_request_duration_seconds_bucket:rate5m
        expr: sum by (job, route, le) (rate(http_request_duration_seconds_bucket{job="orders-api"}[5m]))
```

SLO recording rules may use the `slo:` level prefix already used in [[slo-burn-rate-alerting]]; that is a deliberate local convention for rules that belong to an SLO. Query patterns are in [[promql-for-alert-rules-and-recording-rules]].

## Cardinality budget

| Budget (proposed default)                        | Limit                                                 | What happens above it                              |
| ------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------- |
| Values of one label on one metric                | 10 normally, 100 at most                              | Above 10: reviewer asks why; above 100: redesign   |
| Series of one metric, per service, in production | 1,000                                                 | Needs a review and an owner-approved exception     |
| Active series per service, in production         | 10,000                                                | The platform team reviews with the owner           |
| Samples per scrape, per target                   | Set as a scrape limit at about twice the normal value | The scrape fails and `up` is 0; a ticket is opened |

The per-label numbers come from the Prometheus instrumentation guidance; the series and samples numbers are our own and should be tuned from what your services actually expose. Prometheus has no built-in per-service budget, so the budget is enforced with scrape limits, a CI check and a monthly report.

**Estimate before you add a label.** Series of a metric is the product of its label value counts. A classic histogram with 12 bucket boundaries has 13 bucket series (the extra one is `le="+Inf"`) plus `_sum` and `_count`, so 15 series per label combination. With 5 methods, 40 routes and 3 pods that is `15 x 5 x 40 x 3 = 9,000` series, close to the whole service budget. Adding a `code` label with 10 values would make it 90,000.

**Measure.** These queries are standard PromQL but scan every series of the job; run them on a recent, short range and not in dashboards:

```promql
# Series per metric for one service, top 10
topk(10, count by (__name__) ({job="orders-api"}))

# Total active series for one service
count({job="orders-api"})

# Distinct values of one label on one metric
count(count by (route) (http_requests_total{job="orders-api"}))

# Samples per scrape per target after relabelling (cheap: one series per target)
sum by (job) (scrape_samples_post_metric_relabeling)

# New series per scrape: churn, which costs as much as cardinality
sum by (job) (scrape_series_added)
```

On self-managed Prometheus, `promtool tsdb analyze <data-dir>` reports label pair cardinality and churn from the TSDB itself. On Managed Service for Prometheus, ingestion volume is reported through Cloud Monitoring; which metrics to use for that, and the pricing model, were not verified here, see the [cost controls page](https://cloud.google.com/stackdriver/docs/managed-prometheus/cost-controls).

## CI checks

Two checks run in the merge request pipeline.

```bash title="ci/check-metrics.sh"
#!/usr/bin/env bash
set -euo pipefail
# 1. Lint the service's exposition: start it in the test job, then scrape it.
METRICS_URL="http://127.0.0.1:8080/metrics"
curl -sf "$METRICS_URL" -o metrics.txt
promtool check metrics < metrics.txt                      # naming and consistency lint
promtool check metrics --extended < metrics.txt | tail -n 20   # cardinality per metric

# 2. Validate and unit-test the rule files.
promtool check rules rules/*.yaml
promtool test rules tests/*.yaml
```

- `promtool check metrics` reads the exposition format on standard input and lints it; `--extended` adds cardinality information ([promtool reference](https://prometheus.io/docs/prometheus/latest/command-line/promtool/)). Which naming problems the linter reports is not listed in the reference; read its output and treat every finding as a failure unless the exception list covers it.
- `promtool check rules` validates syntax and, with `--lint-fatal`, exits non-zero on lint findings such as duplicate rules.
- The `--extended` output from a test instance shows series per metric. Compare it with the budget; a new metric whose series in the test exceed a few hundred will be far larger in production.

## Dropping and limiting at scrape

When a library emits metrics we do not use, or a label we cannot afford, drop it at scrape time rather than paying for it. In Prometheus, `metric_relabel_configs` runs on samples as the last step before ingestion, and per-scrape limits (`sample_limit`, `label_limit`, `label_name_length_limit`, `label_value_length_limit`) default to 0, meaning no limit ([configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)). If `sample_limit` is exceeded after relabelling, the whole scrape fails, which is loud by design.

On Managed Service for Prometheus the same controls live on the `PodMonitoring` resource ([operator API reference](https://github.com/GoogleCloudPlatform/prometheus-engine/blob/main/doc/api.md)):

```yaml title="podmonitoring.yaml"
apiVersion: monitoring.googleapis.com/v1
kind: PodMonitoring
metadata:
  name: orders-api
  namespace: orders-prod
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: orders-api
  limits:
    samples: 6000 # proposed: about twice the normal samples per scrape
    labels: 30 # proposed
    labelValueLength: 200 # proposed
  endpoints:
    - port: http
      path: /metrics
      interval: 30s
      metricRelabeling:
        # Drop Go runtime detail we never chart.
        - action: drop
          sourceLabels: [__name__]
          regex: go_memstats_.*_bytes_total|go_gc_heap_.*
        # Hypothetical: drop a per-path histogram a library adds; keep the route-templated one.
        - action: drop
          sourceLabels: [__name__]
          regex: http_server_requests_by_path_.*
```

Relabelling rules there may not overwrite the protected target labels (`project_id`, `location`, `cluster`, `namespace`, `job`, `instance` and others), and the `labelmap` action is not permitted. Prefer fixing the instrumentation to relabelling: a dropped label still costs CPU in the application, and relabelling hides the problem from the next reader.

## Exceptions

A metric that needs more cardinality than the budget (for example per-tenant metrics for a small, fixed set of enterprise tenants) gets an exception with the expected series count, an owner and a review date, as in [[policy-exception-and-waiver-process]]. The exception is recorded next to the PodMonitoring limits so the reason travels with the limit.

## Reviewer checklist

- [ ] New metric names follow the naming rules: prefix, base unit suffix, `_total` for counters, no label values in names.
- [ ] OpenTelemetry metrics use semantic conventions where they exist and a unit in metadata.
- [ ] Every label is bounded; none of the forbidden values appear; routes are templates.
- [ ] The service exposes the required metrics for its type, including `_build_info`.
- [ ] Latency is a histogram whose buckets include each SLO threshold; no summaries.
- [ ] Recording rules use `level:metric:operations` and aggregate before dividing.
- [ ] The estimated series count is in the merge request and inside the budget.
- [ ] `promtool check metrics` and `promtool check rules` pass in CI.
- [ ] Scrape limits are set on the PodMonitoring or scrape config.

## Sources

- [Prometheus: metric and label naming](https://prometheus.io/docs/practices/naming/)
- [Prometheus: instrumentation](https://prometheus.io/docs/practices/instrumentation/)
- [Prometheus: histograms and summaries](https://prometheus.io/docs/practices/histograms/)
- [Prometheus: recording rules](https://prometheus.io/docs/practices/rules/)
- [Prometheus: promtool](https://prometheus.io/docs/prometheus/latest/command-line/promtool/) and [configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
- [OpenTelemetry semantic conventions for metrics](https://opentelemetry.io/docs/specs/semconv/general/metrics/) and [HTTP metrics](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/)
- [OpenTelemetry: Prometheus and OpenMetrics compatibility](https://opentelemetry.io/docs/specs/otel/compatibility/prometheus_and_openmetrics/)
- [Managed Service for Prometheus operator API](https://github.com/GoogleCloudPlatform/prometheus-engine/blob/main/doc/api.md)
- [Managed Service for Prometheus cost controls](https://cloud.google.com/stackdriver/docs/managed-prometheus/cost-controls) (not verified for this note)

## Related

- [[structured-logging-conventions]]: the log equivalent of this standard.
- [[prometheus-high-cardinality-triage]]: when the budget has already been blown.
- [[multi-tenant-prometheus-architecture]]: limits per tenant at the platform level.
- [[0042-managed-prometheus-for-application-metrics]] and [[0043-opentelemetry-collector-gateway]]: where metrics go.
- [[observability-pipeline-opentelemetry]]: the OpenTelemetry pipeline.
- [[promql-for-alert-rules-and-recording-rules]]: writing the queries.
- [[alert-and-runbook-standard]] and [[slo-burn-rate-alerting]]: alerts built on these metrics.
- [[0046-dashboards-and-alert-rules-as-code]]: where rules live.
- [[slo-definition-standard]]: SLIs that depend on these names and buckets.
- [[scheduled-jobs-standard]]: metrics for jobs that do not live long enough to be scraped.
