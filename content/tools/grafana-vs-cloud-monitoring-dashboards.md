---
title: Grafana vs Cloud Monitoring dashboards
description: "Where to build dashboards for GKE: Grafana or Cloud Monitoring dashboards, how both read Managed Prometheus data, and how to keep them as code."
type: tool
tags:
  - tools
  - observability
  - gcp
  - prometheus
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Dashboards are the cheapest part of observability to build and the most expensive to keep honest. Two realistic homes exist for GKE: Grafana and Cloud Monitoring dashboards. Both can read Google Cloud Managed Service for Prometheus data with PromQL, so the decision is less about data and more about who maintains the dashboards, how they are reviewed and where the alerts live.

> [!info] Not checked against current releases
> Versions, editions, licences, deprecation status of query languages and prices were not checked when this note was written. Confirm them in the current documentation before relying on them.

## Scope: the dashboard layer only

This note covers the dashboard layer. Choosing the metrics backend is in [[prometheus-vs-cloud-monitoring]], and long-term storage is in [[thanos-vs-mimir-vs-victoriametrics]]. What a good dashboard contains (the golden signals, SLO panels, the drill-down order) is in [[observability-signals-and-dashboards]].

## At a glance

| Concern            | Grafana                                                          | Cloud Monitoring dashboards                                      |
| ------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| Hosting            | Self-hosted, or a managed Grafana offering                       | Part of Google Cloud; nothing to run                             |
| Data sources       | Many: Prometheus-compatible, Loki, Cloud Monitoring, SQL, others | Cloud Monitoring metrics, Managed Prometheus data, logs-based    |
| Query language     | PromQL for Prometheus sources; each source has its own language  | PromQL; check the current status of MQL before using it          |
| Dashboards as code | JSON models, file provisioning, Terraform provider, Grafonnet    | JSON via `gcloud` and the `google_monitoring_dashboard` resource |
| Access control     | Folders, teams, roles; SSO via OIDC                              | Google IAM on the project or metrics scope                       |
| Cross-project view | Via data source configuration                                    | Metrics scope across projects                                    |
| Alerting           | Grafana alerting, or alerts in the backend                       | Alert policies, tightly integrated with the data                 |
| Cost               | Hosting and operations; edition-dependent features               | Included with Cloud Monitoring; query costs follow the backend   |
| Portability        | High: works against any Prometheus-compatible source             | Low: JSON schema specific to Google                              |

## Data sources

Managed Service for Prometheus exposes a Prometheus-compatible query API. Cloud Monitoring dashboards read it directly with PromQL. Grafana reads it through the standard Prometheus data source, pointed at a query frontend, which is a small proxy deployed in the cluster that authenticates to Google with Workload Identity. Check the current Managed Prometheus documentation for how to deploy it and for the supported authentication method; the exact deployment manifests and image are in Google's guide.

```yaml title="grafana/provisioning/datasources/gmp.yaml"
apiVersion: 1
datasources:
  - name: Managed Prometheus
    type: prometheus
    access: proxy
    # URL of the in-cluster Managed Prometheus query frontend.
    # Verify the service name, namespace and port against the Google guide.
    url: http://frontend.monitoring.svc.cluster.local:9090
    isDefault: true
    jsonData:
      httpMethod: POST
      timeInterval: 30s
```

Grafana can also use the built-in Google Cloud Monitoring data source for native metrics (load balancer, Cloud SQL, GKE system metrics) that are not Prometheus metrics. A dashboard mixing the two is normal: application metrics via PromQL, platform metrics via Cloud Monitoring.

If you use Loki, the same Grafana can show logs next to metrics. See [[loki-vs-elasticsearch-vs-cloud-logging]].

## Query languages

Both tools accept PromQL against Managed Prometheus, which is the portable choice. Cloud Monitoring also has its own legacy query language, MQL. Google has announced changes to MQL support, and the current status should be checked in the Cloud Monitoring documentation before any new dashboard depends on it. A dashboard written in PromQL moves between Grafana and Cloud Monitoring with little change; one written in MQL does not move at all.

```text title="a portable PromQL panel query"
sum by (status) (
  rate(http_requests_total{namespace="shop", app="api"}[5m])
)
```

## Dashboards as code

A dashboard edited in the UI and never exported is a dashboard that drifts and disappears with the instance. Treat both options as code.

### Cloud Monitoring

```bash title="create and update from JSON"
gcloud monitoring dashboards create \
  --config-from-file=dashboard.json --project=example-project

gcloud monitoring dashboards list --project=example-project \
  --format='table(name,displayName)'
```

```hcl title="monitoring.tf"
resource "google_monitoring_dashboard" "api" {
  project        = "example-project"
  dashboard_json = file("${path.module}/dashboards/api.json")
}
```

Terraform owns the lifecycle; the JSON lives in Git and goes through the same review and plan checks as other infrastructure. See [[terraform-plan-policy-checks]]. Build the first version in the console, export the JSON, and commit it. Exports contain the dashboard `etag` and `name`, which you should strip so that Terraform manages them cleanly.

### Grafana

```yaml title="grafana/provisioning/dashboards/default.yaml"
apiVersion: 1
providers:
  - name: platform
    folder: Platform
    type: file
    allowUiUpdates: false
    options:
      path: /var/lib/grafana/dashboards
```

Mount the JSON files from a ConfigMap, or sync them with a sidecar or your GitOps tool. With `allowUiUpdates: false`, people cannot save changes that are lost at the next sync, which avoids a quiet drift. Dashboards can also be created by the Grafana Terraform provider, or generated with Grafonnet or similar libraries when you maintain many similar ones.

Keep these conventions in either tool:

- Template variables for cluster, namespace and app, not copies of the same dashboard.
- One dashboard per service with the same top row (rate, errors, duration), so on-call can navigate by muscle memory.
- A "last reviewed" convention in the description and an owner label.

## Access, folders and multi-team sharing

- **Cloud Monitoring** uses IAM. `roles/monitoring.viewer` lets people read; dashboards belong to a project, and a metrics scope can aggregate several projects. Sharing across teams in different projects is natural. Fine-grained per-dashboard permissions are limited, so check what the current IAM model allows.
- **Grafana** has folders, teams and roles, and SSO makes onboarding easy. It is the better fit for fine-grained sharing, public status views behind a proxy, and customer-specific folders. Remember that a data source credential is shared: anyone who can query the data source can read everything it can reach, so separate data sources per sensitivity.

Never put secrets or tokens in dashboard JSON, and avoid embedding raw customer identifiers in queries or panel titles.

## Where the alerting lives

Do not let the dashboard tool decide the alerting by accident. Options:

- **Alerts in the backend** (Prometheus rules, Managed Prometheus rule evaluation, Cloud Monitoring alert policies). They survive a Grafana outage and keep working while nobody is looking at a dashboard.
- **Grafana-managed alerts.** Convenient for multi-source rules, but your alerting then depends on Grafana's availability.

Prefer alerts that live next to the data, and use dashboards for diagnosis. Burn-rate rules are in [[slo-burn-rate-alerting]]. Link from each alert to the relevant dashboard so the responder lands on the right panel.

## Cost and ownership

Cloud Monitoring dashboards carry no separate hosting cost, but the queries they run count against the backend's usage. Grafana adds hosting, upgrades, SSO integration and backups for its database, or a managed Grafana subscription. Check the current editions and licence terms for any enterprise features you plan to use.

The real cost is ownership. Name an owner for the dashboard set, review them when a service changes, and delete dashboards nobody opened in a quarter.

## When to choose which

Choose **Cloud Monitoring dashboards** when:

- the team is small, all-in on GCP and wants nothing to run;
- the data is Google metrics plus Managed Prometheus;
- IAM at project level is enough access control.

Choose **Grafana** when:

- you have several data sources (Prometheus-compatible, Loki, SQL, Cloud Monitoring) and want one view;
- you need folder-level access control, rich visualisations or portability off GCP;
- someone owns the platform and its upgrades.

Both is a legitimate answer: Cloud Monitoring for platform and infrastructure, Grafana for application teams.

## Recommendation

Start with Cloud Monitoring dashboards for GKE platform health, defined in Terraform from reviewed JSON, and add Grafana when application teams need cross-source views, logs next to metrics, or finer access control. In both, write queries in PromQL, keep alerts in the backend, provision from Git and forbid UI-only edits. Revisit if MQL status, Grafana edition terms or your multi-cloud plans change.

## Related

- [[prometheus-vs-cloud-monitoring]]
- [[thanos-vs-mimir-vs-victoriametrics]]
- [[observability-signals-and-dashboards]]
- [[slo-burn-rate-alerting]]

## Sources

- [Grafana documentation](https://grafana.com/docs/grafana/latest/)
- [Cloud Monitoring dashboards](https://cloud.google.com/monitoring/dashboards)
- [Querying Managed Service for Prometheus](https://cloud.google.com/stackdriver/docs/managed-prometheus/query)
