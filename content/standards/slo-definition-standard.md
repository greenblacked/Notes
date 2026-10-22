---
title: SLO and SLI definition standard
description: What makes a valid SLO, with user-centred SLIs per service type, the SLO document, targets by tier, windows, SLO as code, exclusions and review.
type: standard
tags:
  - standards
  - reliability
  - observability
  - prometheus
  - on-call
created: 2026-10-21
modified: 2026-10-21
draft: false
aliases:
  - SLI definition standard
---

Several of our rules assume that a service has an SLO: paging only on burn rate ([[0045-page-only-on-slo-burn-rate]]), release gating on the error budget ([[error-budget-policy]]), and the launch gate in [[production-readiness-review]]. None of them says what a valid SLO is. Without that, an "SLO" can be a CPU threshold, a target nobody agreed to, or a query nobody can find. This standard defines how an SLI is chosen and measured, what the SLO document contains, which targets and windows we use, how the SLO is expressed as code, what may be excluded, and how it is owned and reviewed. It deliberately contains **no burn-rate mathematics**: alerting on an SLO is in [[slo-burn-rate-alerting]], and what to do when the budget runs out is in [[error-budget-policy]].

## Scope

Every service of tier 0, 1 or 2 in [[service-tiering-standard]] MUST have at least one SLO before its production readiness review. Tier 3 services SHOULD have one. Platform services (CI, artifact store, DNS, clusters) are services too, with internal users.

> [!info] Check the current docs
> The SLO concepts follow the Google SRE book chapter on [service level objectives](https://sre.google/sre-book/service-level-objectives/) and the SRE workbook chapter on [implementing SLOs](https://sre.google/workbook/implementing-slos/), but neither was re-read for this note, so the rules below are stated as **our** rules, not as quotes. The Cloud Monitoring limits come from the Terraform `google_monitoring_slo` documentation; the Cloud Monitoring [SLO monitoring guide](https://cloud.google.com/stackdriver/docs/solutions/slo-monitoring) was not verified. Targets, windows and review cadence are **proposed team defaults**.

## Terms

- **SLI (service level indicator):** a measurement of one aspect of the service as users experience it, expressed as a ratio: **good events / valid events**, between 0 and 1.
- **SLO (service level objective):** a target for an SLI over a window, for example "99.9% of valid requests succeed, over a rolling 30 days". The Terraform provider documentation for Cloud Monitoring describes an SLO the same way: an SLI, a performance goal and a period.
- **Error budget:** `1 - target`, the share of valid events that may be bad in the window.
- **SLA:** a contract with consequences. An SLA, if one exists, is looser than the SLO, so the SLO warns before the contract is broken. This standard does not cover SLAs.

## Rules for a valid SLO

1. **User-centred.** The SLI measures something a user (a person, or a calling service) would notice: a failed request, a slow page, stale data, a job that did not run. CPU, memory, pod restarts and queue length are causes, not SLIs.
2. **Measured as close to the user as practical.** Prefer the load balancer or gateway over the pod, and synthetic probes for low-traffic paths. A pod-level metric misses requests that never reached a pod.
3. **A ratio of events.** Define the valid events (what counts at all) and the good events (what counts as success). Health checks, synthetic traffic that is not part of the SLI, and requests rejected because the client was wrong (most 4xx) are not valid events.
4. **Few per service.** One to three SLOs per critical user journey; rarely more than five per service. Each SLO must be one that someone would act on.
5. **A target the dependencies can support.** A service cannot promise more than the product of its hard dependencies' availability unless it has fallbacks ([[timeouts-retries-load-shedding]]). Writing 99.99% on top of a 99.9% dependency is fiction.
6. **Never 100%.** A 100% target forbids every change and every failure, so it is ignored the first week.
7. **Agreed and owned.** The product owner agrees the target; one team owns the SLO and its alerts; the engineering manager signs the error budget policy that consumes it.
8. **Written down as code** (see below), with a document a person can read.

## SLI menu by service type

Pick from this menu before inventing something new. "Good" and "valid" must be defined precisely in the SLO document.

| Service type                  | SLI                | Good event / valid event (example)                                                                                                        |
| ----------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Request/response (HTTP, gRPC) | Availability       | Responses that are not 5xx (or gRPC `UNAVAILABLE`, `INTERNAL`, `DEADLINE_EXCEEDED`) / all requests except health checks and client errors |
|                               | Latency            | Requests served faster than the threshold (for example 300 ms) / all valid requests                                                       |
| Pipeline or stream processing | Freshness          | Minutes in which the newest processed record is less than N minutes old / all minutes                                                     |
|                               | Correctness        | Records that pass validation downstream / records processed                                                                               |
| Batch and scheduled jobs      | Completion on time | Runs that finished successfully before their deadline / scheduled runs                                                                    |
| Storage or data service       | Durability proxy   | Restore drills that recovered all data within the RPO / restore drills ([[0051-backups-proven-by-quarterly-restore-drills]])              |
| CI platform (internal users)  | Job start latency  | Jobs that started within 2 minutes of being queued / jobs queued                                                                          |
|                               | Platform success   | Jobs that did not fail for platform reasons (runner lost, image pull, infra timeout) / all jobs                                           |

Notes:

- **Latency SLIs use a threshold, not a percentile.** "99% of requests under 300 ms" is a ratio of good events, so it composes with error budgets. A p99 graph is a useful dashboard, not an SLI.
- **The latency threshold must be a histogram bucket boundary** in the metric, as required by [[metrics-naming-and-cardinality-standard]], so the SLI is exact.
- **Freshness and completion SLIs** need the timestamp metrics (`..._last_success_timestamp_seconds`) from the metrics standard, and the job rules in [[scheduled-jobs-standard]].
- **CI SLIs exclude user failures**: a failing test is the pipeline working. Classifying platform failures needs a failure-reason label in the CI metrics ([[ci-pipeline-standard]]).

## Targets by tier

| Tier (from [[service-tiering-standard]]) | Availability target (proposed default) | Latency target (proposed default) |
| ---------------------------------------- | -------------------------------------- | --------------------------------- |
| 0: platform foundations                  | 99.95%                                 | 99% under the agreed threshold    |
| 1: customer-critical                     | 99.9%                                  | 99% under the agreed threshold    |
| 2: customer-facing, degradable           | 99.5%                                  | 95% under the agreed threshold    |
| 3: internal, best effort                 | 99% or no SLO                          | Optional                          |

These are starting points, not entitlements. A new service starts with a target its last 30 days of data already meet, then tightens it once the team can defend it. Changing a target is a change-controlled decision (see Change control).

> [!warning] Cloud Monitoring SLO limits
> The Terraform `google_monitoring_slo` resource documents `goal` as `0 < goal <= 0.999` and `rolling_period_days` as 1 to 30 days. A 99.95% target or a window longer than 30 days cannot be expressed as a Cloud Monitoring SLO. For those, compute the SLI with Prometheus recording rules (below).

## Windows

- **Rolling 30 days** is the default window for the SLO and its error budget, matching [[error-budget-policy]] and [[slo-burn-rate-alerting]]. A rolling window does not reset on the first of the month, so the budget reflects what users experienced recently.
- **Calendar month** is used only for reporting to stakeholders who think in months. It is a view of the same SLI, not a second SLO.
- **Low-traffic services** (fewer than about 1,000 valid events a day, proposed threshold) add synthetic probes so the ratio is meaningful, or use a longer window with Prometheus, because a single failure otherwise consumes a large share of the budget.

## The SLO document

Every SLO has a short document, kept in the service repository next to the rules that implement it (`slo/<slo-id>.yaml`). The format below is our own schema, not OpenSLO; it is readable by people and by a CI check.

```yaml title="slo/orders-api-availability.yaml"
slo_id: orders-api-availability
service: orders-api
owner: team-orders # team alias, not a person
tier: 1
journey: "Customer places an order"
sli:
  type: availability
  description: "Share of order API requests answered without a server error."
  measured_at: "External HTTPS load balancer, backend service orders-api"
  valid_events: "All instrumented requests (health checks are not instrumented), excluding 4xx except 429"
  good_events: "Valid requests answered with a status other than 5xx and 429"
  source: prometheus
  good_query: >-
    sum(rate(http_requests_total{job="orders-api",code!~"4..|5.."}[5m]))
  valid_query: >-
    sum(rate(http_requests_total{job="orders-api",code!~"4.."}[5m]))
    + (sum(rate(http_requests_total{job="orders-api",code="429"}[5m])) or vector(0))
objective:
  target: 0.999
  window: rolling-30d
dependencies:
  - service: payments-api
    slo: payments-api-availability # target 0.9995
  - service: cloud-sql-orders
    note: "Regional instance with HA; see the database runbook"
exclusions:
  - "Planned maintenance announced 5 working days ahead, listed in error-budget-policy"
alerting: "slo-burn-rate-alerting, page on fast burn"
error_budget_policy: "standards/error-budget-policy"
agreed_by:
  product_owner: "Product owner, Orders"
  date: 2026-10-21
review:
  last: 2026-10-21
  next: 2027-01-21
history:
  - date: 2026-10-21
    change: "Initial SLO at 99.9%, based on 30 days at 99.94%"
```

Rules for the document:

- `good_query` and `valid_query` are real queries, tested against production data before the SLO is agreed. The example excludes client errors except `429`, because rate limiting a legitimate client is our failure, not theirs; write the exclusion that fits your API. The `or vector(0)` keeps the sum defined when no `429` series exists yet; without it the whole expression returns nothing. With no traffic at all the `valid` denominator has no series and the ratio returns no data, which is correct (nothing to measure); the burn-rate alerts must treat absent data as "no signal", not as a breach or as healthy.
- `owner` and `agreed_by` name roles or teams; no personal data in a public-facing repository.
- `history` records every change of target, SLI definition or window, with the reason.

## SLO as code

The document is the human contract; the SLI and its burn alerts are code, deployed through the rule pipeline in [[0046-dashboards-and-alert-rules-as-code]].

### Prometheus recording rules

The SLI is recorded once and reused by alerts and dashboards. Names follow the `level:metric:operations` convention with the `slo:` level used in [[slo-burn-rate-alerting]].

```yaml title="rules/slo-orders-api.yaml"
groups:
  - name: slo-orders-api-sli
    interval: 30s
    rules:
      # Availability: bad / valid over 5 minutes, using the definitions in the SLO document
      # (valid = everything except 4xx, plus 429; good = not 4xx and not 5xx).
      # "or vector(0)" on good: with only errors there may be no good series at all,
      # and an empty numerator would make the ratio empty instead of 1.
      - record: slo:http_error_ratio:rate5m
        expr: |
          1 - (
            (sum(rate(http_requests_total{job="orders-api",code!~"4..|5.."}[5m])) or vector(0))
            /
            (
              sum(rate(http_requests_total{job="orders-api",code!~"4.."}[5m]))
              + (sum(rate(http_requests_total{job="orders-api",code="429"}[5m])) or vector(0))
            )
          )
        labels: { service: orders-api, slo_id: orders-api-availability }

      # Latency: share of requests slower than the 300 ms threshold.
      # Requires a bucket boundary at exactly le="0.3".
      - record: slo:http_latency_bad_ratio:rate5m
        expr: |
          1 - (
            sum(rate(http_request_duration_seconds_bucket{job="orders-api",le="0.3"}[5m]))
            /
            sum(rate(http_request_duration_seconds_count{job="orders-api"}[5m]))
          )
        labels: { service: orders-api, slo_id: orders-api-latency }
```

Longer windows (the burn-rate windows and the 30-day budget) are built on these, as shown in [[slo-burn-rate-alerting]] and [[error-budget-policy]]. Every rule file ships with a `promtool test rules` unit test that feeds a known series and checks the ratio, as in [[alert-and-runbook-standard]]. Query patterns are in [[promql-for-alert-rules-and-recording-rules]].

### Cloud Monitoring SLOs with Terraform

Where the SLI is available as a Cloud Monitoring metric (for example load balancer request counts) and the target is 99.9% or lower, the SLO can live in Cloud Monitoring. The `google_monitoring_slo` resource takes exactly one of `request_based_sli`, `windows_based_sli` or `basic_sli`; a `request_based_sli` uses `good_total_ratio` (exactly two of `good_service_filter`, `bad_service_filter` and `total_service_filter`) or `distribution_cut`.

```hcl title="slo/orders-api.tf"
resource "google_monitoring_custom_service" "orders_api" {
  service_id   = "orders-api"
  display_name = "orders-api"
}

resource "google_monitoring_slo" "orders_api_availability" {
  service             = google_monitoring_custom_service.orders_api.service_id
  slo_id              = "orders-api-availability"
  display_name        = "orders-api availability, 99.9% over 30 days"
  goal                = 0.999 # the documented maximum
  rolling_period_days = 30    # the documented maximum

  request_based_sli {
    good_total_ratio {
      # Example filters: replace with the metric and labels of your load balancer
      # or service. Check filter syntax in the Cloud Monitoring documentation.
      bad_service_filter   = "metric.type=\"loadbalancing.googleapis.com/https/request_count\" resource.type=\"https_lb_rule\" resource.label.\"backend_target_name\"=\"orders-api\" metric.label.\"response_code_class\"=\"500\""
      total_service_filter = "metric.type=\"loadbalancing.googleapis.com/https/request_count\" resource.type=\"https_lb_rule\" resource.label.\"backend_target_name\"=\"orders-api\""
    }
  }

  user_labels = {
    team = "team-orders"
    tier = "tier-1"
  }
}
```

The resource arguments are from the provider documentation; the load balancer metric type, resource type and label names in the filters were **not verified** for this note. Build the filter in Metrics Explorer first and paste the working version. Whether Cloud Monitoring SLOs can use Managed Service for Prometheus metrics directly was not verified either; if your SLI exists only in Prometheus, keep it in recording rules.

### OpenSLO

[OpenSLO](https://github.com/OpenSLO/OpenSLO) is an open, vendor-neutral specification for describing SLOs in YAML. It is an option if we adopt a tool that consumes it; its document kinds and fields, and which tools support which version, were not evaluated for this note. Until then, our own document format above is the source of truth.

## Exclusions

Exclusions are decided **before** the window, never after an incident.

- **Allowed:** planned maintenance announced in advance under [[change-freezes-and-maintenance-windows]] and listed in the error budget policy; synthetic and load-test traffic, which is labelled and filtered out of `valid_query`; requests the service correctly refused (client errors other than rate limiting).
- **Not allowed:** dependency outages (users do not care whose fault it was; the dependency's failure is evidence that the SLO's dependency assumption is wrong), incidents "outside our control", deploy-induced errors.
- An exclusion is written in the SLO document, implemented in the query or as a recorded maintenance window, and reviewed quarterly. [[error-budget-policy]] holds the policy-level exclusion list; the SLO document must not contradict it.

## Change control and review

- **Creating an SLO** happens at or before the production readiness review, with the product owner's agreement recorded.
- **Changing a target, window or SLI definition** is a merge request that updates the document's `history`, with the data that justifies it (at least 30 days of the SLI). Tightening takes effect at once; loosening needs the product owner's and the engineering manager's approval, so a team cannot escape its budget by moving the line.
- **Quarterly review**, in the meeting defined by [[error-budget-policy]]: does each SLO still match what users experience (compare with support tickets and incidents), was the budget ever exhausted, did any incident hurt users without moving the SLI (a sign of a wrong SLI), and is any SLO never close to its target (a sign it is too loose).
- **After a SEV1 or SEV2** ([[0050-incident-severity-levels-and-roles]]), the postmortem ([[blameless-postmortems]]) checks whether the SLI saw the incident. If it did not, fixing the SLI is an action item.

## Anti-patterns

| Anti-pattern                                      | Why it fails                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| CPU, memory or pod restarts as an SLI             | Causes, not symptoms; users can be fine at 95% CPU and broken at 20%                      |
| A 100% or 99.999% target without the architecture | Every deploy breaches it; the SLO is ignored                                              |
| Measuring at the pod                              | Misses load balancer errors, routing failures and requests that never arrived             |
| An internal health check as the SLI               | It passes while real requests fail                                                        |
| A p99 latency value as the target                 | Not a ratio of events, so it cannot produce an error budget; it also hides traffic volume |
| Ten SLOs per service                              | Nobody can act on all of them; burn alerts multiply                                       |
| Excluding the incident after it happened          | The SLO stops describing users and becomes a negotiation                                  |
| Copying a target from another company             | Their users, architecture and costs are not ours                                          |

## Reviewer checklist

- [ ] The SLI is user-centred and measured as close to the user as practical.
- [ ] Good and valid events are defined precisely, and the queries are tested on real data.
- [ ] The target matches the tier, is not 100%, and is supported by the dependencies.
- [ ] Window is rolling 30 days unless there is a recorded reason.
- [ ] Latency thresholds are histogram bucket boundaries.
- [ ] The SLO document has owner, tier, dependencies, exclusions, agreement, review date and history.
- [ ] Recording rules (or the Cloud Monitoring SLO) exist, have unit tests and respect the Cloud Monitoring limits.
- [ ] Burn-rate alerts exist per [[slo-burn-rate-alerting]] and link a runbook.
- [ ] Exclusions agree with [[error-budget-policy]].

## Sources

- [Google SRE book: Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) (further reading; not re-read for this note)
- [Google SRE workbook: Implementing SLOs](https://sre.google/workbook/implementing-slos/) (further reading; not re-read for this note)
- [Cloud Monitoring SLO monitoring](https://cloud.google.com/stackdriver/docs/solutions/slo-monitoring) (not verified for this note)
- [Terraform `google_monitoring_slo`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_slo): arguments, `goal` and `rolling_period_days` limits, SLI types
- [Cloud Monitoring API: services.serviceLevelObjectives](https://cloud.google.com/monitoring/api/ref_v3/rest/v3/services.serviceLevelObjectives)
- [OpenSLO specification](https://github.com/OpenSLO/OpenSLO)
- [Prometheus recording rules practice](https://prometheus.io/docs/practices/rules/)

## Related

- [[error-budget-policy]]: what happens when the budget is spent.
- [[slo-burn-rate-alerting]] and [[0045-page-only-on-slo-burn-rate]]: alerting on the SLO.
- [[alert-and-runbook-standard]]: labels, routing and tests for the alerts.
- [[production-readiness-review]]: where the first SLO is agreed.
- [[metrics-naming-and-cardinality-standard]]: the metrics the SLIs are built from.
- [[service-tiering-standard]]: the tiers behind the targets.
- [[learn/slis-slos-and-error-budgets|Observability 05: SLIs, SLOs and error budgets]]: the concepts, taught from first principles with a tested lab.
