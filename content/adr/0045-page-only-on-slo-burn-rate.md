---
title: On-call is paged only by SLO burn-rate alerts
description: A page means user impact at a rate that would exhaust the error budget; cause-based alerts go to tickets or dashboards through one routing path.
type: adr
tags:
  - adr
  - reliability
  - observability
  - on-call
  - incident-management
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0045
---

## Context

On-call engineers are paged by a mixture of alerts: CPU above a threshold, memory above a threshold, a pod restart, a disk at 80%, and a few real symptom alerts. Most pages need no action, some describe a cause that never reaches users, and a few real incidents arrive buried among them. The result is alert fatigue, slower response to real problems and engineers who dread the rota ([[on-call-health]]).

Cause-based alerts also fail in the other direction. A user-facing outage with no obvious resource anomaly pages nobody, because no threshold was crossed.

We already have service level objectives and an error-budget policy ([[error-budget-policy]]). The missing piece is a rule that ties paging to them.

## Decision

We will **page a human only when an SLO burn-rate alert fires**. Every other signal goes to a ticket, a chat channel or a dashboard.

- A page means: users are being harmed now, at a rate that would exhaust the error budget fast enough that waiting is not acceptable.
- Alerts use multi-window, multi-burn-rate rules as described in [[slo-burn-rate-alerting]]: a fast-burn rule over a short window pages immediately, and a slower-burn rule over a longer window opens a ticket. The window and burn-rate numbers live in that pattern, not here, so they can be tuned in one place.
- Cause-based alerts (saturation, restarts, queue depth, certificate expiry) are kept as warnings. They route to a ticket queue or a team channel with an owner. A cause alert is promoted to a page only if it predicts imminent SLO burn and no symptom alert would catch it in time. That exception is written down with its reasoning.
- One routing path: alert rules carry `severity` and `team` labels, and a single Alertmanager (or Cloud Monitoring notification channel set) route per severity delivers to one paging tool. Which paging product is a team choice; the routing configuration is in Git ([[0046-dashboards-and-alert-rules-as-code]]).
- Every paging alert links to a runbook and to the service's SLO dashboard, and carries the severity vocabulary from [[0050-incident-severity-levels-and-roles]].
- Quarterly, the on-call group reviews alert quality: pages per shift, share of pages that needed action, pages with no runbook, and alerts that never fired. Alerts with poor signal are fixed or deleted.

```yaml title="slo-burn-rate-rules.yaml"
groups:
  - name: checkout-slo
    rules:
      - alert: CheckoutErrorBudgetFastBurn
        expr: |
          (
            sum(rate(http_requests_total{service="checkout",code=~"5.."}[5m]))
            / sum(rate(http_requests_total{service="checkout"}[5m]))
          ) > (14.4 * 0.001)
          and
          (
            sum(rate(http_requests_total{service="checkout",code=~"5.."}[1h]))
            / sum(rate(http_requests_total{service="checkout"}[1h]))
          ) > (14.4 * 0.001)
        for: 2m
        labels:
          severity: page
          team: payments
        annotations:
          summary: "Checkout is burning its error budget fast"
          runbook_url: "https://runbooks.example.com/checkout/error-budget"
```

The 0.001 error budget and the 14.4 multiplier are an example for a 99.9% objective over a 30-day window. Derive your own from the pattern note.

> [!info] Claims not checked against current docs
> The burn-rate multipliers and window pairs are quoted from memory of the SRE workbook's approach and must be checked against it. Alertmanager route syntax and GMP rule resource fields change; check the current documentation for the version you run.

## Consequences

Easier:

- Pages correlate with user impact, so each one is worth waking up for.
- Real outages with no obvious resource anomaly still page, because the symptom is measured directly.
- Capacity and hygiene problems stop interrupting sleep and become planned work.
- A shared routing path makes ownership and escalation auditable.

Harder or newly required:

- Every paged service needs an SLI and an SLO first. A service without one has no paging alert until it has one, which pushes teams to define them.
- A well-built SLI needs good request metrics; a poor one produces false confidence or false alarms.
- Some failures need an early cause alert because burn-rate alerts detect only after users are affected. The exception process above covers them, and abuse of it brings back the old noise.
- Low-traffic services have noisy ratios. They need a minimum request rate or a synthetic probe to make the ratio meaningful.
- Teams used to threshold pages may feel less protected at first. The quarterly review is where this is discussed with evidence.

## Alternatives considered

- **Threshold pages on CPU and memory.** Familiar and cheap to write, but it measures causes, not harm, and drives alert fatigue. Rejected as a paging policy.
- **Per-team routing and tooling.** Maximum autonomy, but no common severity meaning and impossible to audit. Rejected in favour of one path with team-level labels.
- **Email alerts for everything.** Nothing is urgent, so nothing is read. Rejected.

## Validation

```bash
set -o pipefail
RULES_DIR="./monitoring/rules"

# Every rule file passes promtool
promtool check rules "${RULES_DIR}"/*.yaml

# No alert carries severity=page without a runbook_url (prints offenders; empty output is good)
yq -r '.groups[].rules[] | select(.labels.severity == "page") | select(.annotations.runbook_url == null) | .alert' "${RULES_DIR}"/*.yaml

# List every paging alert for the quarterly review
yq -r '.groups[].rules[] | select(.labels.severity == "page") | .alert' "${RULES_DIR}"/*.yaml | sort
```

## References

- Alerting on SLOs: https://sre.google/workbook/alerting-on-slos/
- Alertmanager: https://prometheus.io/docs/alerting/latest/alertmanager/
- Related notes: [[slo-burn-rate-alerting]], [[error-budget-policy]], [[on-call-health]], [[incident-response]]
- Related ADRs: [[0046-dashboards-and-alert-rules-as-code]], [[0050-incident-severity-levels-and-roles]], [[0042-managed-prometheus-for-application-metrics]]
