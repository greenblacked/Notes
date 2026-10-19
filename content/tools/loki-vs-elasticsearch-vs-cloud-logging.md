---
title: Loki vs Elasticsearch vs Cloud Logging
description: "Comparing label-indexed Loki, full-text Elasticsearch and Google Cloud Logging for GKE logs: query model, retention, cost drivers and operations."
type: tool
tags:
  - tools
  - observability
  - gke
  - gcp
  - cost
created: 2026-10-19
modified: 2026-10-19
draft: false
---

On GKE, container stdout and stderr already flow into Cloud Logging by default. The question is whether that is enough, or whether you also want Grafana Loki or Elasticsearch. The honest answer is usually "Cloud Logging for most things, plus something else for a specific reason", and the reason is almost always query ergonomics, cost at volume, or data residency. This note compares the three on the criteria that decide that.

> [!info] Not checked against current releases
> Versions, licences, retention defaults, quotas and prices were not checked when this note was written. Confirm them in the current documentation and pricing pages before relying on them.

## Criteria

- **Index model:** what is indexed determines query speed, storage size and cost.
- **Query language:** how easily on-call engineers can ask a new question at 03:00.
- **Retention and cost drivers:** what you pay for as volume grows.
- **Operations:** who gets paged when the log system is down.
- **Access and audit:** who can read which logs, and which logs must never be dropped.

## At a glance

| Concern        | Loki                                                  | Elasticsearch                                         | Cloud Logging                                                      |
| -------------- | ----------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| Index model    | Indexes only labels; log lines are compressed chunks  | Full-text inverted index over fields                  | Managed; fields queryable, indexing handled by the service         |
| Query language | LogQL (label selector, then line filters and parsers) | KQL, Lucene or ES\|QL, depending on the tool          | Logging query language                                             |
| Storage        | Object storage (GCS) for chunks and index             | Local or attached disks on data nodes, plus snapshots | Log buckets in Google's backend                                    |
| Cost driver    | Ingest volume, query load, label cardinality          | Disk, memory and shard count on your nodes            | Ingestion volume and retention beyond included periods; check docs |
| Operations     | You run distributor, ingester, querier and compactor  | You run a cluster, shards, upgrades and ILM           | None                                                               |
| Best at        | Cheap storage and querying by known labels            | Free-text search and analytics over large text        | Zero-ops default with IAM, audit and routing built in              |
| Weak at        | Ad-hoc full-text search over unlabeled data at scale  | Cost and care at high ingest volume                   | Cost at very high volume; vendor lock-in for queries               |

## Index model

**Loki** indexes labels, not content. You select a stream by labels (`namespace`, `app`, `cluster`), then filter the lines by text or parse them. This makes storage cheap, because the index is tiny, but it means every query must start from a narrow label selector. Queries that begin with "search everything for this string over 30 days" are slow and expensive.

**Elasticsearch** builds an inverted index over every field. Free-text and aggregation queries are fast and flexible. The price is disk, memory and operational care: the index is often as large as the raw data, and shard count and mapping decisions are permanent-ish.

**Cloud Logging** hides the index. You write filters over `resource.labels`, `severity` and `jsonPayload` fields and the service answers. You neither tune nor see the index, which is the point.

## Query languages

The same question, "errors from the `api` app in the `shop` namespace in the last hour that mention `timeout`":

```text title="LogQL (Loki)"
{namespace="shop", app="api"} |= "timeout" | json | level="error"
```

```text title="Logging query language (Cloud Logging)"
resource.type="k8s_container"
resource.labels.namespace_name="shop"
labels."k8s-pod/app"="api"
severity>=ERROR
textPayload:"timeout" OR jsonPayload.message:"timeout"
```

Elasticsearch in Kibana with KQL looks like `kubernetes.namespace: "shop" and kubernetes.labels.app: "api" and message: "timeout"`. Exact field names depend on your shipper and mappings.

LogQL also has metric queries (`rate`, `count_over_time`) so you can alert on log patterns with the same Prometheus-style tooling. In Cloud Logging, the equivalent is a log-based metric. For daily search tips see [[searching-logs]].

## Storage, retention and cost drivers

- **Loki:** the bill is object storage plus the compute for ingesters and queriers. Retention is set globally or per tenant in the compactor. The dominant risk is label cardinality: it multiplies streams and inflates the index.
- **Elasticsearch:** nodes with fast disks and enough heap. Retention is governed by index lifecycle management, moving indices from hot to warm to deleted. Capacity planning is a continuous job.
- **Cloud Logging:** you pay for ingestion into buckets and for retention beyond what is included. The `_Required` bucket holds audit and system events, and the `_Default` bucket holds everything else. Retention defaults and prices change, so check the current documentation and pricing page.

```bash title="inspect and change Cloud Logging retention"
gcloud logging buckets describe _Default --location=global --project=example-project

gcloud logging buckets update _Default \
  --location=global --project=example-project \
  --retention-days=30
```

## Cost control in Cloud Logging

Three levers, in order of safety:

1. **Route, do not drop.** A sink exports matching entries to Cloud Storage, BigQuery or Pub/Sub, usually cheaper for long retention. The original still lands in the bucket unless you exclude it.
2. **Shorten retention** on buckets whose logs have no long-term value.
3. **Exclusions** drop matching entries at ingest. They are not recoverable: once excluded, the data is gone for incident review as well as for cost.

```bash title="archive sink to Cloud Storage"
gcloud storage buckets create gs://example-log-archive \
  --project=example-project --location=europe-west1 \
  --uniform-bucket-level-access

gcloud logging sinks create example-archive \
  storage.googleapis.com/example-log-archive \
  --project=example-project \
  --log-filter='resource.type="k8s_container" AND severity<ERROR'
```

The sink has a writer identity. Grant it `roles/storage.objectCreator` on the bucket only, and read the identity from `gcloud logging sinks describe example-archive`.

Typical noisy sources worth attention: health-check requests logged at INFO, debug logging left on in production, and load balancer logs at 100% sampling for static assets. Fix the source first; exclude only as a last step, and test the filter with a read before saving it:

```bash title="check what a filter would match"
gcloud logging read \
  'resource.type="k8s_container" AND labels."k8s-pod/app"="api" AND textPayload:"GET /healthz"' \
  --project=example-project --limit=5 --freshness=1h
```

## Audit logs must not be excluded

> [!warning] Do not exclude audit logs
> Admin Activity audit logs and the data you need for investigations are the evidence trail for security and compliance. Never write an exclusion that matches audit log names or `protoPayload` audit entries, and review exclusions in code review. See [[gcp-audit-logs-siem]] for routing audit logs to a SIEM and [[pci-dss-and-gdpr-for-devops-logs-and-data]] for what must not appear in logs at all.

Application logs raise the opposite problem: they must not contain card numbers, tokens or personal data. Scrub at the source, because every system above stores what it receives.

## Operations and failure modes

- **Loki label cardinality.** Putting `pod_name`, request IDs or user IDs into labels creates a stream per value. Ingesters run out of memory and queries slow down. Keep labels to a small, stable set and keep identifiers in the line.
- **Loki ingestion limits.** Per-tenant rate limits reject bursts with HTTP 429. The shipper (Promtail, Alloy or the OpenTelemetry Collector) retries, but sustained overload drops logs. Alert on the discarded-samples metric.
- **Elasticsearch shard sprawl.** Many small daily indices multiply shards, and each shard costs heap. Use index templates with sensible shard counts and rollover by size.
- **Elasticsearch disk watermarks.** When a node passes the flood-stage watermark, indices become read-only and ingestion stops. Alert well before that.
- **Cloud Logging quotas.** Write and read API quotas can throttle shippers and heavy `gcloud logging read` loops. Check the current limits and request increases ahead of need.
- **Shipping failures.** Whichever backend, the agent on the node is a failure point. Watch its restarts and backlog, and make sure it has resource requests so it is not evicted first.
- **Time zone and clock skew.** Entries with timestamps in the future or past land outside the queried window and look missing.

The shipper layer is covered in [[observability-pipeline-opentelemetry]]. If you collect with the OpenTelemetry Collector, you can send the same stream to more than one backend during a migration.

## When to choose which

Choose **Cloud Logging** when:

- you want no log infrastructure to run and your teams are already on GCP;
- IAM, audit and routing from one console meet your needs;
- volume is moderate, or the exclusion and routing levers keep cost acceptable.

Choose **Loki** when:

- volume is high, queries are mostly by known labels, and storage cost matters;
- you already use Grafana and want logs, metrics and traces in one place;
- you accept running a distributed system or a managed Loki offering.

Choose **Elasticsearch** when:

- you need full-text search, analytics and security-style queries over large text corpora;
- you have people who can operate it, or use a managed Elasticsearch offering.

## Recommendation

Default to Cloud Logging with retention set per bucket, a sink to Cloud Storage for anything that must be kept, and audit logs routed to your SIEM. Add Loki when log volume or Grafana-centred workflows make the managed cost or ergonomics unattractive, and keep labels disciplined from day one. Choose Elasticsearch only when full-text search is a real requirement, since it carries the highest operational cost of the three. Revisit when volume grows by an order of magnitude, when a pricing change shifts the balance, or when a compliance requirement changes retention. Cost modelling should use your own measured ingestion volume, not list prices copied from a blog.

## Related

- [[observability-pipeline-opentelemetry]]
- [[gcp-audit-logs-siem]]
- [[pci-dss-and-gdpr-for-devops-logs-and-data]]
- [[prometheus-vs-cloud-monitoring]]
- [[searching-logs]]

## Sources

- [Grafana Loki documentation](https://grafana.com/docs/loki/latest/)
- [Elastic documentation](https://www.elastic.co/docs/)
- [Cloud Logging routing overview](https://cloud.google.com/logging/docs/routing/overview)
- [Cloud Logging buckets](https://cloud.google.com/logging/docs/buckets)
- [Google Cloud Observability pricing](https://cloud.google.com/stackdriver/pricing)
