---
title: Tempo vs Jaeger vs Cloud Trace for distributed tracing
description: Choosing a trace backend behind the OpenTelemetry Collector gateway on GKE between Grafana Tempo, Jaeger and Cloud Trace, with exporter configs and checks.
type: tool
tags:
  - tools
  - observability
  - opentelemetry
  - gke
  - gcp
  - cost
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Metrics and logs each have a backend comparison in these notes ([[prometheus-vs-cloud-monitoring]], [[loki-vs-elasticsearch-vs-cloud-logging]]); traces do not. [[0043-opentelemetry-collector-gateway]] sends all telemetry through an OpenTelemetry Collector gateway with tail sampling and leaves the trace backend open, and the pipeline in [[observability-pipeline-opentelemetry]] exports traces to a placeholder. This note fills that gap. It compares three backends that accept OTLP from the gateway: Grafana Tempo (self-hosted, object storage), Jaeger (self-hosted, database storage) and Google Cloud Trace (managed).

> [!info] Not checked against current releases
> Written from the Tempo and Jaeger documentation source, the OpenTelemetry Collector contrib READMEs and the Tempo changelog on 2026-10-21; not checked against Google's Cloud Trace pages, so verify there. Not verified: Cloud Trace quotas, retention, span and attribute limits and prices; Cloud Trace's OTLP ingestion endpoint and the roles it needs; whether the `googlecloud` exporter or OTLP with Google authentication is Google's recommended path today; Cloud Trace span-to-log linking behaviour; Tempo Helm chart names; Kafka sizing and managed Kafka options on Google Cloud; Jaeger adaptive sampling status, index sizing and Helm values; Collector exporter and processor names in the release you run; whether Tempo's deploy page advises against monolithic mode on Kubernetes for production. No prices are quoted.

## Criteria

| Criterion                  | Question                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| OTLP ingestion             | Can the gateway export OTLP directly, with Workload Identity rather than keys?                   |
| Storage                    | Object storage, a search database, or managed; what you must size, back up and upgrade.          |
| Query and attribute search | Find by trace ID only, or search on any span attribute (status, route, customer tier, duration)? |
| Span metrics               | Can it derive RED metrics, and does sampling distort them?                                       |
| Correlation                | Trace to logs, metrics exemplars to traces, one click in the tools engineers already use.        |
| Retention and cost drivers | What grows the bill: spans ingested, bytes stored, index size, queries.                          |
| Tenancy                    | Per-team isolation and access control.                                                           |
| Operations                 | Components to run and page on, and the authentication story.                                     |

## At a glance

| Concern        | Grafana Tempo                                                       | Jaeger (v2)                                                               | Cloud Trace                                                                 |
| -------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Model          | Self-hosted; traces in object storage as Parquet                    | Self-hosted; a distribution of the OpenTelemetry Collector                | Google-managed                                                              |
| Storage        | GCS, S3, Azure; plus a Kafka-compatible queue in microservices mode | Cassandra, Elasticsearch or OpenSearch (primary); ClickHouse experimental | Managed                                                                     |
| Ingestion      | OTLP                                                                | OTLP on 4317 (gRPC) and 4318 (HTTP)                                       | `googlecloud` Collector exporter (beta) or Google's OTLP API (not verified) |
| Query          | Trace ID and TraceQL; Grafana data source                           | Jaeger UI and API, search on tags                                         | Console Trace Explorer; API                                                 |
| Span metrics   | Optional metrics-generator (service graphs, span metrics)           | Service performance monitoring via the Collector (not compared here)      | Not verified                                                                |
| Authentication | None built in; put an authenticating proxy in front                 | Check the current docs                                                    | IAM                                                                         |
| You operate    | Tempo components, Kafka, bucket, proxy                              | Jaeger collectors and query, a search cluster                             | Nothing; quotas and IAM only                                                |

## Exporting from the gateway

The gateway from [[0043-opentelemetry-collector-gateway]] keeps its receivers, `memory_limiter` and `tail_sampling`; only the trace exporter changes. Component names and options move between Collector releases, so check them against the contrib README for the version you run.

```yaml title="gateway exporters: pick one (verify names for your Collector release)"
exporters:
  # Tempo: OTLP to the distributor (in-cluster service name is illustrative)
  otlp/tempo:
    endpoint: tempo-distributor.tracing.svc.cluster.local:4317
    tls:
      insecure: true # only inside the cluster with network policy; use TLS across trust boundaries

  # Jaeger v2: OTLP to the Jaeger collector role
  otlp/jaeger:
    endpoint: jaeger-collector.tracing.svc.cluster.local:4317
    tls:
      insecure: true

  # Cloud Trace: Google Cloud exporter, credentials from Workload Identity
  googlecloud:
    project: example-project

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, tail_sampling, batch]
      exporters: [googlecloud] # or otlp/tempo, or otlp/jaeger
```

For Cloud Trace, the `googlecloud` exporter (stability beta for traces in its README, included in the contrib distribution) uses Application Default Credentials. On GKE, including Autopilot per its README, run the gateway under a Kubernetes service account bound through Workload Identity to a Google service account with `roles/cloudtrace.agent` ([[gke-workload-identity]]). Its `trace.endpoint` defaults to `cloudtrace.googleapis.com`. Outside Google Cloud it falls back to a key file, which ADR 0043 rules out. Google also offers an OTLP ingestion API; whether that is now the preferred path, and which role it needs, was not verified.

## Tempo on GKE

Tempo stores traces in object storage as Apache Parquet and queries them by trace ID or with TraceQL. Two facts from the current documentation change the old "Tempo is just a bucket" story:

- **Kafka in production.** In Tempo 3.x, monolithic mode (`-target=all`, the default) needs no Kafka: the distributor pushes in-process to the live-store and metrics-generator. Microservices mode requires a Kafka-compatible queue (Apache Kafka, Redpanda or WarpStream are named) as a write-ahead log between distributors and the components that consume from it, and is the mode the architecture page recommends for production. Read the current deploy page before sizing; a production Tempo means operating or buying a Kafka-compatible service.
- **No built-in authentication.** The documentation says Tempo has no authentication layer and you must run an authenticating reverse proxy in front of it.

```yaml title="tempo storage block (sketch; verify keys for your Tempo version)"
storage:
  trace:
    backend: gcs
    gcs:
      bucket_name: example-project-tempo-traces
```

- Access to the bucket comes from Workload Identity (or `GOOGLE_APPLICATION_CREDENTIALS`). The identity needs `storage.objects.create`, `storage.objects.delete`, `storage.objects.get`, `storage.objects.list` and `storage.buckets.get` on the bucket; grant a custom role on that bucket only.
- `block_retention` defaults to 336h (14 days), set in the compaction configuration. The documentation's sizing rule is simple: bytes ingested per day times retention days is roughly the bytes stored.
- The default block format is `vParquet5`; TraceQL needs Parquet blocks.
- Tempo 3.0 also turned on retry-after responses when the distributor is overloaded, removed the OpenCensus receiver and consolidated configuration; `tempo-cli migrate config` converts 2.x configuration. Read the changelog before upgrading.

**Metrics-generator.** Optional. It consumes spans and produces service graphs, span metrics and host info, then remote-writes them to a Prometheus-compatible backend. The Tempo documentation warns that if traces are sampled before they reach Tempo, where you generate metrics depends on how you sample. With ADR 0043's tail sampling at the gateway, span metrics computed in Tempo count only the sampled traces and undercount everything else. Compute RED metrics before sampling (the `spanmetrics` connector in the agent tier) or take them from the services' own metrics ([[0042-managed-prometheus-for-application-metrics]]). Each extra span-metric dimension raises cardinality.

## Jaeger v2

Jaeger v2 is a customised distribution of the OpenTelemetry Collector with roles: collector, query, ingester (from Kafka) and all-in-one. It receives OTLP on 4317 and 4318 and serves its UI on 16686. The all-in-one image with in-memory storage is for local work only:

```bash title="local Jaeger for development"
docker run --rm --name jaeger \
  -p 16686:16686 -p 4317:4317 -p 4318:4318 \
  jaegertracing/jaeger:<pinned-version>
```

For production, Jaeger needs a database. **There is no object storage (GCS) backend.** The primary supported backends are Cassandra, Elasticsearch and OpenSearch; ClickHouse is experimental behind a feature gate; Badger is single-instance; a remote storage API lets others plug in. The project distinguishes primary storage (short retention, its example says about two weeks) from archive storage for traces kept longer. In practice, Jaeger on GKE means running or buying an OpenSearch or Elasticsearch cluster and owning its index lifecycle, which is the same operational load compared in [[loki-vs-elasticsearch-vs-cloud-logging]]. Kubernetes deployment is through the OpenTelemetry Operator or the Jaeger v2 Helm chart.

## Cloud Trace

Cloud Trace is the zero-operations option: no storage, no Kafka, no proxy. Access is IAM, the console links traces from requests, and on GKE the gateway exports with Workload Identity. Its quotas, retention, span size and attribute limits, and price were not verified for this note; read the Cloud Trace quotas and pricing pages before committing, because those limits decide whether high-cardinality attributes and long traces survive.

Trace-to-log correlation in Google Cloud uses the special log fields from [[structured-logging-conventions]]: `logging.googleapis.com/trace` with the value `projects/PROJECT_ID/traces/TRACE_ID`, and the span ID field described there. Services that already follow that standard get log-to-trace links in the console without extra work ([[logging-architecture-gke-and-cloud-logging]]).

## Correlation across signals

Whatever the backend, correlation is built in the services, not in the backend:

- Every log line inside a request carries the trace and span IDs ([[structured-logging-conventions]]).
- Metrics carry exemplars (a trace ID attached to a histogram sample) where the SDK and backend support them, so a latency spike in a dashboard links to a real trace. Tempo's TraceQL documentation mentions exemplars and TraceQL metrics; Grafana wiring was not verified here.
- Dashboards link from a service panel to its traces ([[grafana-vs-cloud-monitoring-dashboards]], [[observability-signals-and-dashboards]]).
- Context propagation must cross every hop, including the mesh. A sidecar or gateway that drops `traceparent` splits one trace into two ([[service-mesh-on-gke]]).

## Sampling dominates cost

For every backend, the bill follows spans kept. Tail sampling at the gateway (keep all errors, all slow traces, a small share of the rest) is the main cost control, and it applies equally to all three. Practical rules:

- Decide the keep ratio per service tier; record it with the ADR's thresholds.
- Drop or truncate large attributes (SQL text, payloads) in the gateway before export; they cost storage and may hold personal data.
- Never add unbounded values (user IDs, request IDs) as span-metric dimensions.
- Watch the gateway's own exporter and drop metrics: a backend that throttles turns into silent data loss in the Collector queue.

## Validation

Send a known test trace through the real path (agent, gateway, backend), then find it.

```bash title="send one test trace through the agent (service names illustrative)"
kubectl -n observability port-forward svc/otel-agent 4317:4317 &
# Install: go install github.com/open-telemetry/opentelemetry-collector-contrib/cmd/telemetrygen@<pinned-version>
telemetrygen traces --otlp-insecure --traces 1 --service telemetrygen-check
```

`telemetrygen` defaults to `localhost:4317`, hence the port-forward; check `telemetrygen traces --help` for the endpoint flag if you point it elsewhere. Tail sampling may drop a single healthy test trace, so either send enough traces for the probabilistic share, or add a gateway policy that always keeps `service.name = telemetrygen-check`.

Find it:

- **Tempo:** in Grafana Explore with the Tempo data source, run the TraceQL query `{ resource.service.name = "telemetrygen-check" }`.
- **Jaeger:** open the UI, choose the `telemetrygen-check` service, search.
- **Cloud Trace:** open Trace Explorer in the project and filter on the service name.

Then check the gateway is not losing data. ADR 0043 names the Collector metrics to watch; their exact names were not verified:

```bash title="gateway exporter health (metric names to verify for your Collector version)"
kubectl -n observability port-forward deploy/otel-gateway 8888:8888 &
curl -s localhost:8888/metrics | grep -E 'otelcol_exporter_send_failed_spans|otelcol_exporter_queue_size|otelcol_processor_dropped_spans'
```

Non-zero, growing send failures mean the backend is rejecting or throttling: check the gateway log for quota (Cloud Trace), auth or connection errors.

## Failure modes

- **Dropped spans at the gateway.** Undersized memory for tail sampling's decision wait, or an exporter queue that fills while the backend is slow. Alert on drop and failure counters.
- **Broken propagation.** Async hops (queues, batch jobs) and some proxies do not forward trace context; traces end at the boundary. Test propagation across every hop type, not only HTTP.
- **High-cardinality attributes.** Attribute search is the point of tracing, but a span-metrics dimension per user ID explodes the metrics backend. Keep dimensions to service, route, status and similar.
- **Many small objects in GCS (Tempo).** Very low or bursty volumes produce many small blocks, raising operation counts and cost. Watch bucket operation metrics, and let compaction work.
- **Search cluster saturation (Jaeger).** Index growth without lifecycle policies fills disks; queries time out first, then ingestion fails.
- **Quota exhaustion (Cloud Trace).** Writes rejected under a spike; the gateway's queue then fills. Check the quota page and alert on export failures.
- **Unauthenticated Tempo.** Exposing the query endpoint without a proxy exposes every trace, including any personal data in attributes.

## Recommendation

Start with **Cloud Trace** behind the existing gateway. It needs no new stateful system, works with Workload Identity, and already links to Cloud Logging through the trace fields the logging standard requires. Revisit after confirming its limits and prices against your span volume.

Move to **Tempo** when you need TraceQL across attributes in Grafana next to Prometheus and Loki, multi-cloud portability, or cheaper long retention on object storage, and you are ready to run its components, a Kafka-compatible queue and an authenticating proxy. Choose **Jaeger** only if you already operate OpenSearch or Elasticsearch well and want its UI; it has no object storage option.

What would change the answer: Cloud Trace limits that reject your attributes or volume; a team-wide move to Grafana as the single pane (see [[grafana-vs-cloud-monitoring-dashboards]]); or a managed Tempo offering that removes the Kafka and proxy work. Revisit alongside [[thanos-vs-mimir-vs-victoriametrics]] if the metrics side also moves to a self-hosted Grafana stack.

## Related

- [[observability-pipeline-opentelemetry]]
- [[0043-opentelemetry-collector-gateway]]
- [[loki-vs-elasticsearch-vs-cloud-logging]]
- [[prometheus-vs-cloud-monitoring]]
- [[grafana-vs-cloud-monitoring-dashboards]]
- [[thanos-vs-mimir-vs-victoriametrics]]
- [[structured-logging-conventions]]
- [[service-mesh-on-gke]]

## Sources

- [Grafana Tempo documentation](https://grafana.com/docs/tempo/latest/)
- [Tempo changelog](https://github.com/grafana/tempo/blob/main/CHANGELOG.md)
- [Jaeger documentation](https://www.jaegertracing.io/docs/latest/)
- [Jaeger repository](https://github.com/jaegertracing/jaeger)
- [Cloud Trace documentation](https://cloud.google.com/trace/docs)
- [Google Cloud exporter for the OpenTelemetry Collector](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/exporter/googlecloudexporter)
- [telemetrygen](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/cmd/telemetrygen)
- [Tail sampling processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/tailsamplingprocessor)
- [OpenTelemetry Collector configuration](https://opentelemetry.io/docs/collector/configuration/)
