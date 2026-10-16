---
title: SLO burn rate alerting
description: Define SLIs and SLOs for HTTP services and alert on error budget burn with multi-window, multi-burn-rate rules in Prometheus and Cloud Monitoring.
type: pattern
tags:
  - patterns
  - observability
  - reliability
  - prometheus
  - gcp
  - on-call
created: 2026-10-16
modified: 2026-10-16
draft: false
---

Alerting on raw error rate or latency thresholds pages people for blips and misses slow leaks. Alerting on **error budget burn** ties pages to user impact: you are paged when the service is consuming its allowed unreliability fast enough to matter. This is the approach from the Google SRE Workbook chapter "Alerting on SLOs". Good alerts also protect the team; see [[on-call-health]].

> [!info] Figures checked from memory
> The SRE Workbook site was unreachable when this was written. The burn rates and windows below (14.4, 6 and 1 with their windows) are the widely used values from that chapter for a 30-day SLO, but compare them with the chapter before adopting them as policy.

## SLIs and SLOs for an HTTP service

An SLI is a ratio of good events to valid events. Two cover most HTTP services:

| SLI          | Good event                                                  | Valid event                                               |
| ------------ | ----------------------------------------------------------- | --------------------------------------------------------- |
| Availability | Response status is not 5xx                                  | Every request, excluding probes and 4xx caused by clients |
| Latency      | Request served faster than a threshold (for example 300 ms) | Every request                                             |

Measure at the edge closest to the user (load balancer or ingress) where you can, not only inside the app. Decide what counts: do 429s count, are health checks excluded, and is a client-side 499 an error.

An SLO is a target over a window: for example "99.9% of requests succeed over 30 days". The **error budget** is the remainder: 0.1%, so about 43 minutes of full outage per 30 days. Pick targets from what users need and what the dependencies can support, not from aspiration; a 99.99% SLO on a service that depends on a 99.9% one is fiction. Rolling windows (28 or 30 days) are easier to alert on than calendar months.

The budget is a management tool as much as a technical one: when it is spent, reliability work takes priority over features. That conversation belongs in [[planning-and-prioritization]].

## Burn rate

Burn rate is how fast you consume budget relative to the rate that would exactly exhaust it at the end of the window.

```text
burn rate = observed error ratio / (1 - SLO)
```

For a 99.9% SLO, a 1% error ratio is a burn rate of 10. At burn rate 1 the budget runs out exactly at the end of the window; at 10 it runs out in three days of a 30-day window.

## Multi-window, multi-burn-rate alerts

A single window either reacts too slowly or flaps. The workbook recommends pairing a long window (is the burn significant?) with a short window (is it still happening?), using about one twelfth of the long window for the short one. For a 30-day SLO:

| Severity | Burn rate | Long window | Short window | Budget consumed at alert time |
| -------- | --------- | ----------- | ------------ | ----------------------------- |
| Page     | 14.4      | 1 hour      | 5 minutes    | 2%                            |
| Page     | 6         | 6 hours     | 30 minutes   | 5%                            |
| Ticket   | 1         | 3 days      | 6 hours      | 10%                           |

Both windows must exceed the threshold for the alert to fire, so it resolves quickly once the problem stops. Fast burns page, slow burns create tickets for working hours.

## Prometheus recording rules

This assumes a request counter `http_requests_total` with `job` and `code` labels (adjust to your metrics; see [[prometheus-vs-cloud-monitoring]] for choosing where metrics live). First record the error ratio over each window:

```yaml title="slo-recording-rules.yaml"
groups:
  - name: slo-payments-api-availability
    rules:
      - record: slo:http_error_ratio:rate5m
        expr: |
          sum(rate(http_requests_total{job="payments-api",code=~"5.."}[5m]))
          /
          sum(rate(http_requests_total{job="payments-api"}[5m]))
        labels: { service: payments-api }
      - record: slo:http_error_ratio:rate30m
        expr: |
          sum(rate(http_requests_total{job="payments-api",code=~"5.."}[30m]))
          /
          sum(rate(http_requests_total{job="payments-api"}[30m]))
        labels: { service: payments-api }
      - record: slo:http_error_ratio:rate1h
        expr: |
          sum(rate(http_requests_total{job="payments-api",code=~"5.."}[1h]))
          /
          sum(rate(http_requests_total{job="payments-api"}[1h]))
        labels: { service: payments-api }
      - record: slo:http_error_ratio:rate6h
        expr: |
          sum(rate(http_requests_total{job="payments-api",code=~"5.."}[6h]))
          /
          sum(rate(http_requests_total{job="payments-api"}[6h]))
        labels: { service: payments-api }
      - record: slo:http_error_ratio:rate3d
        expr: |
          sum(rate(http_requests_total{job="payments-api",code=~"5.."}[3d]))
          /
          sum(rate(http_requests_total{job="payments-api"}[3d]))
        labels: { service: payments-api }
```

Then the alerts, for a 99.9% SLO (error budget 0.001). Thresholds are burn rate times 0.001:

```yaml title="slo-alert-rules.yaml"
groups:
  - name: slo-payments-api-alerts
    rules:
      - alert: PaymentsApiErrorBudgetBurnFast
        expr: |
          slo:http_error_ratio:rate1h{service="payments-api"} > (14.4 * 0.001)
          and
          slo:http_error_ratio:rate5m{service="payments-api"} > (14.4 * 0.001)
        labels:
          severity: page
          service: payments-api
        annotations:
          summary: "payments-api is burning error budget at 14.4x or more"
          runbook_url: "https://example.com/runbooks/payments-api-slo-burn"
      - alert: PaymentsApiErrorBudgetBurnMedium
        expr: |
          slo:http_error_ratio:rate6h{service="payments-api"} > (6 * 0.001)
          and
          slo:http_error_ratio:rate30m{service="payments-api"} > (6 * 0.001)
        labels:
          severity: page
          service: payments-api
        annotations:
          summary: "payments-api is burning error budget at 6x or more"
          runbook_url: "https://example.com/runbooks/payments-api-slo-burn"
      - alert: PaymentsApiErrorBudgetBurnSlow
        expr: |
          slo:http_error_ratio:rate3d{service="payments-api"} > (1 * 0.001)
          and
          slo:http_error_ratio:rate6h{service="payments-api"} > (1 * 0.001)
        labels:
          severity: ticket
          service: payments-api
        annotations:
          summary: "payments-api is on course to exhaust its 30-day error budget"
          runbook_url: "https://example.com/runbooks/payments-api-slo-burn"
```

Validate rules before deploying and test with real history:

```bash
promtool check rules slo-recording-rules.yaml slo-alert-rules.yaml
```

Practical issues:

- **Low traffic.** With few requests, one error produces a huge ratio. Add a minimum request-rate condition, or use a longer window for small services.
- **No traffic at all** gives `NaN` and no alert; add an absence or synthetic-probe alert separately.
- A three-day window needs three days of retained data at the evaluation resolution. Recording rules keep this cheap.
- Generators such as Sloth or Pyrra produce these rules from a short SLO spec, and reduce copy-paste errors if you have many services.

## Cloud Monitoring equivalent

Cloud Monitoring has SLOs as first-class objects: define a service, an SLI (request-based availability or latency, using built-in metrics such as load balancer or Cloud Run request counts, or a custom metric), a goal and a rolling or calendar compliance period. You then create alerting policies of type "SLO burn rate" on that SLO, specifying a lookback duration and a burn-rate threshold. To reproduce the table above, create separate policies: 1 hour at 14.4, 6 hours at 6, and 3 days at 1. Policies natively evaluate one lookback window, so there is no short-window pairing, and short blips can be longer-lived than with the Prometheus rules; compensate with a sensible notification delay.

Define the SLOs in Terraform (`google_monitoring_slo`, `google_monitoring_alert_policy`) so they are reviewed like code; the layout in [[terraform-module-and-state-layout]] applies. Check the current resource arguments in the provider docs.

## Linking alerts to runbooks

Every paging alert needs a `runbook_url` annotation, and the runbook should answer: what does this alert mean for users, what to check first (recent deploys, dependency health, saturation), how to mitigate (rollback, scale, failover), and who to escalate to. Start from [[incident-response]] and the [[kubernetes-pod-troubleshooting]] runbook. In Alertmanager, route `severity: page` to the pager, `severity: ticket` to the team queue, and include the runbook URL in the notification template.

For a 5% budget loss in a window, hold a short review; for an exhausted budget, follow your policy (freeze risky releases, prioritise reliability work), agreed in advance with product and engineering leadership. Feed incidents into [[blameless-postmortems]].

## Checklist

1. SLI defined, measured at the edge, with an explicit list of excluded traffic.
2. SLO agreed with the product owner, written down with its window.
3. Recording rules and three alerts deployed; `promtool` clean.
4. Each alert has severity routing and a runbook link.
5. Replay a past incident against the rules to confirm the alert would have fired and when.
6. Review SLO and alert quality monthly: pages per week, false positives and missed incidents.
