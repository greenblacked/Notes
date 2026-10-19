---
title: Alert and runbook standard
description: Actionable-only paging, required alert labels and annotations, severity routing, rule tests, and required sections, testing and retirement of linked runbooks.
type: standard
tags:
  - standards
  - observability
  - on-call
  - prometheus
  - runbooks
  - incident-management
created: 2026-10-19
modified: 2026-10-19
draft: false
---

An alert is a request for a human to do something now. A runbook is what that human reads first. When either is weak, the cost lands at 03:00: pages nobody can act on, alerts with no link, runbooks that describe a system that no longer exists. This standard sets the rules for writing alerts, the labels and annotations they must carry, how they are tested before they ship, what a runbook must contain, and when both are retired. It complements [[slo-burn-rate-alerting]], which decides what to page on, and [[incident-response]], which says what happens after the page.

## Principles

1. **Every page is actionable and urgent.** If the on-call engineer cannot do anything useful in the next hour, or the problem can wait until morning, it is not a page. Make it a ticket or a dashboard.
2. **Alert on symptoms, not causes.** Page on what users feel (errors, latency, saturation that is about to cause either), and use cause-level signals (a node is down, a pod restarted) as dashboard panels and as diagnosis steps in the runbook. The Google SRE guidance on [monitoring distributed systems](https://sre.google/sre-book/monitoring-distributed-systems/) and the Prometheus [alerting practices](https://prometheus.io/docs/practices/alerting/) say the same.
3. **Every alert has a runbook and an owner.** An alert with no runbook link is a defect, not a draft.
4. **Fewer, better alerts.** Duplicated pages for one fault are routed and grouped so the engineer gets one notification.
5. **Alerts are code.** Rules live in Git, are reviewed and tested, and are deployed by pipeline (ADR [[adr/0046-dashboards-and-alert-rules-as-code]]).

## Required labels and annotations

> [!info] Our convention
> The label and annotation names below are **our convention**. Prometheus and Alertmanager do not require them; they treat labels and annotations as free-form. We require them so that routing, dashboards and checks can rely on them.

| Field         | Kind       | Rule                                                                                                     |
| ------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| `severity`    | label      | `page` or `ticket`, matching [[slo-burn-rate-alerting]]. Nothing else routes to a human                  |
| `team`        | label      | Team alias that owns the service and the on-call rota, for example `team-orders`                         |
| `service`     | label      | The service name, equal to `app.kubernetes.io/name` (see [[kubernetes-labels-and-annotations-standard]]) |
| `summary`     | annotation | One line, what is wrong, with no templating that can fail. Shown in the notification title               |
| `description` | annotation | What the alert means for users, the current value, and the threshold                                     |
| `runbook_url` | annotation | Link to the runbook for this alert, resolvable by on-call without extra access                           |

A dashboard-only rule has no `severity` label, which means Alertmanager's default route sends it nowhere that pages. That is intentional: recording the signal costs nothing, interrupting a person does.

## Severity and routing

| Severity | Meaning                                         | Delivery                    | Response expectation (proposed team default) |
| -------- | ----------------------------------------------- | --------------------------- | -------------------------------------------- |
| `page`   | User impact now or an error budget burning fast | Pager, immediately, 24x7    | Acknowledge within 15 minutes                |
| `ticket` | Needs a human soon, but not at night            | Ticket queue, working hours | Within 1 to 3 working days                   |
| none     | Useful signal                                   | Dashboard only              | None                                         |

Routing sends by `severity` and `team`, groups related alerts and inhibits noise from known parents (a cluster-down alert silences the per-pod alerts below it).

```yaml title="alertmanager.yml"
route:
  receiver: default-null
  group_by: [team, service, alertname]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers: [severity="page"]
      receiver: pager
      routes:
        - matchers: [team="team-orders"]
          receiver: pager-orders
    - matchers: [severity="ticket"]
      receiver: ticket-queue

inhibit_rules:
  - source_matchers: [alertname="ClusterUnreachable"]
    target_matchers: [severity="page"]
    equal: [cluster]

receivers:
  - name: default-null
  - name: pager
  - name: pager-orders
  - name: ticket-queue
```

The timings are examples; tune them from your own incident data. Receiver settings (pager integration keys, webhook URLs) are secrets and live outside this file. Check the [Alertmanager configuration docs](https://prometheus.io/docs/alerting/latest/configuration/) for the syntax of your version, in particular the `matchers` field.

## Naming and durations

- **Alert names** are `<Service><Symptom>` in CamelCase: `OrdersApiHighErrorRatio`, `OrdersApiLatencySloBurn`, `PaymentsQueueBacklog`. The name says what is wrong, not how it was measured. Avoid `Alert`, `Warning` and `Critical` in names.
- **`for:` durations** keep a short spike from paging. The value depends on the signal: a fast burn-rate alert may use a few minutes, a disk-fill prediction an hour. Choose it from how long the condition must last before a human can do something about it, and write that reason in a comment. A `for: 0m` page needs a justification.
- **Alert on ratios and rates, not raw counts**, so the rule survives traffic changes.
- **Do not alert on a single instance** unless that instance is the service. Aggregate with `sum by (service)`.

## Example rule

```yaml title="rules/orders-api.yaml"
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: orders-api-alerts
  namespace: monitoring
  labels:
    team: team-orders
spec:
  groups:
    - name: orders-api.slo
      rules:
        - alert: OrdersApiHighErrorRatio
          expr: |
            sum(rate(http_requests_total{service="orders-api",code=~"5.."}[5m]))
              /
            sum(rate(http_requests_total{service="orders-api"}[5m])) > 0.02
          for: 10m
          labels:
            severity: page
            team: team-orders
            service: orders-api
          annotations:
            summary: "orders-api is returning errors to users"
            description: >-
              5xx ratio is {{ $value | humanizePercentage }} over 5 minutes
              (threshold 2%). Users see failed checkouts.
            runbook_url: "https://runbooks.example.com/orders-api/high-error-ratio"

        - alert: OrdersApiDiskFillingSoon
          expr: predict_linear(node_filesystem_avail_bytes{service="orders-api"}[6h], 24 * 3600) < 0
          for: 1h
          labels:
            severity: ticket
            team: team-orders
            service: orders-api
          annotations:
            summary: "orders-api volume predicted to fill within 24 hours"
            description: "Free space on {{ $labels.instance }} is predicted to reach zero within a day."
            runbook_url: "https://runbooks.example.com/orders-api/disk-filling"
```

The threshold, window and metric names are examples; derive real ones from your SLO. For managed Prometheus the same rules are expressed through its rule resource; check the current Google Cloud Managed Service for Prometheus docs for the resource name. The decision between self-managed and managed metrics is in [[prometheus-vs-cloud-monitoring]].

## Testing alerts

An alert that has never fired in a test may never fire in production. Run two checks in CI.

**1. Syntax and rule unit tests with `promtool`.**

```bash title="CI commands"
promtool check rules rules/*.yaml
promtool test rules tests/alerts_test.yml
```

`promtool check rules` expects the plain Prometheus rule-file format, so a `PrometheusRule` custom resource is first converted or its `spec` extracted in CI. Check the [unit testing docs](https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/) for the file format of your version.

```yaml title="tests/alerts_test.yml"
rule_files:
  - ../rules/orders-api.rules.yaml

evaluation_interval: 1m

tests:
  - interval: 1m
    input_series:
      - series: 'http_requests_total{service="orders-api",code="200"}'
        values: "0+100x30"
      - series: 'http_requests_total{service="orders-api",code="500"}'
        values: "0+10x30"
    alert_rule_test:
      - eval_time: 20m
        alertname: OrdersApiHighErrorRatio
        exp_alerts:
          - exp_labels:
              severity: page
              team: team-orders
              service: orders-api
            exp_annotations:
              summary: "orders-api is returning errors to users"
              description: "5xx ratio is 9.091% over 5 minutes (threshold 2%). Users see failed checkouts."
              runbook_url: "https://runbooks.example.com/orders-api/high-error-ratio"
      - eval_time: 5m
        alertname: OrdersApiHighErrorRatio
        exp_alerts: []
```

The second case checks that the alert does not fire before `for:` has elapsed.

**2. Every `runbook_url` resolves.** A dead link is found in a pipeline, not during an incident.

```yaml title=".gitlab-ci.yml"
alert-runbook-links:
  stage: lint
  image: registry.example.com/ci/tools:1.2.0
  timeout: 5 minutes
  script:
    - |
      set -Eeuo pipefail
      grep -rhoE 'runbook_url: *"https?://[^"]+"' rules/ \
        | sed -E 's/.*"(https?:[^"]+)"/\1/' | sort -u \
        | while read -r url; do
            code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -L "$url" || true)"
            if [[ "$code" != "200" ]]; then echo "BROKEN ($code): $url" >&2; exit 1; fi
          done
```

Runbook hosts that require authentication need a token in the job, kept in a masked variable; otherwise check that the file exists in the runbook repository at the referenced path instead. The URLs in these examples use `example.com`. Add a lint that rejects rules missing `severity`, `team`, `service`, `summary` or `runbook_url`.

## Cloud Monitoring alerts

Alert policies in Cloud Monitoring carry the same information, with different field names. Map them so a responder sees one shape:

- Put `severity`, `team` and `service` in the policy's **user labels**.
- Put `summary`, the impact and the `runbook_url` in the policy's **documentation** field (Markdown). Keep it short: the first lines appear in the notification.
- Define the policy in Terraform ([[adr/0030-terraform-manages-gcp-infrastructure]]) so it is reviewed.

Notification channel types, documentation limits and label support change; check the [Cloud Monitoring alerting docs](https://cloud.google.com/monitoring/alerts).

## Runbook required sections

Every runbook linked from an alert has these sections, in this order. Short is good; complete is required.

1. **Symptom**: what the alert says and what the responder will see.
2. **User impact**: who is affected, and how badly.
3. **First checks**: exact commands with the expected output, so the responder can tell normal from abnormal.
4. **Decision points**: if X then do Y; if not, go to the next step.
5. **Mitigation and rollback**: how to stop the pain first, how to undo each step.
6. **Escalation**: who and when, with the on-call alias and the incident process ([[incident-response]]).
7. **Owner**: a team alias, not a person.
8. **`last_tested`**: the date of the last dry run or real use.

```markdown title="runbooks/orders-api/high-error-ratio.md"
---
title: OrdersApiHighErrorRatio
owner: team-orders
last_tested: 2026-09-14
---

## Symptom

Alert `OrdersApiHighErrorRatio` fires: more than 2% of requests return 5xx for 10 minutes.

## User impact

Checkout fails for a share of users equal to the error ratio.

## First checks

1. Is a deploy in progress or recent?
   `kubectl -n orders-prod rollout history deploy/orders-api | tail -3`
   Expected: the latest revision is older than the alert start.
2. Are pods healthy?
   `kubectl -n orders-prod get pods -l app.kubernetes.io/name=orders-api`
   Expected: all `Running`, `READY 1/1`.

## Decision points

- Errors started within 15 minutes of a rollout: roll back (below).
- Pods in `CrashLoopBackOff`: see https://runbooks.example.com/kubernetes/pod-troubleshooting.
- Database errors in the logs: escalate to the database on-call.

## Mitigation and rollback

`kubectl -n orders-prod rollout undo deploy/orders-api`
Verify: the error ratio in the dashboard drops within 5 minutes.

## Escalation

Page `team-orders-secondary` after 30 minutes without improvement, and declare an incident for any customer-visible outage.
```

Link generic diagnosis from the runbook, for example to [[kubernetes-pod-troubleshooting]] in this knowledge base, so the runbook only holds what is specific to the alert.

## Runbook writing rules

- **Write for 03:00.** Short sentences, numbered steps, one action per step, no history lessons.
- **Commands are copy-pasteable** with variables defined at the top, and say what a healthy result looks like.
- **Name the rollback next to each risky step**, not at the end.
- **Link, do not copy.** Link to the dashboard, the deploy history and the architecture note instead of pasting them; copies drift.
- **No secrets.** Say where the credential lives and how to request it.
- **One runbook per alert, or per failure class** when several alerts share a response. Do not write a general "troubleshooting" page and call it a runbook; link to [[kubernetes-pod-troubleshooting]] for the generic part.

## Testing and review

- **A dry run or game day each quarter** (a proposed team default) for every service with a `page` alert: one engineer who did not write the runbook follows it against a staging fault, and the author fixes what they stumble on. [[game-day-chaos-gke]] describes how to run them. Update `last_tested` afterwards.
- **A real incident counts as a test.** The postmortem ([[blameless-postmortems]]) lists runbook fixes as action items with owners.
- **Ownership is explicit.** A runbook without a current owner is orphaned; the owning team is reviewed when teams change, and orphaned runbooks are reassigned before the next quarter.
- **Review alerts with the same care as code.** A change to an expression, threshold or `for:` needs a reviewer from the owning team, and a test update.
- **Sustainable load.** If the pager load for a rota exceeds what [[on-call-health]] considers healthy, tune or remove alerts before adding people.

## Retirement

An alert that nobody acts on trains people to ignore the pager. Review each quarter:

- Any alert with **no action taken in 90 days** (a proposed team default) is reviewed for removal, downgrade to `ticket`, or a better expression.
- An alert that fired and was acknowledged without action more than twice in a quarter is noisy by definition: fix the threshold or delete it.
- When a service is retired, its rules, dashboards and runbooks are removed in the same change.
- Retired runbooks are deleted or marked archived, and links from remaining alerts are checked by the link job above.

## Checklist

- [ ] The alert is actionable now; otherwise it is a ticket or a dashboard.
- [ ] `severity` is `page` or `ticket`; `team` and `service` are set.
- [ ] `summary`, `description` and `runbook_url` are present and the URL resolves.
- [ ] The name is `<Service><Symptom>`; `for:` has a reason.
- [ ] `promtool check rules` and `promtool test rules` pass, including a negative case.
- [ ] The runbook has all eight sections, exact commands with expected output, and a rollback.
- [ ] `last_tested` is within the last quarter for `page` alerts.
- [ ] The owner is a team alias.

## Sources

- [Prometheus: Alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/)
- [Prometheus: Unit testing for rules](https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/)
- [Prometheus: Alerting practices](https://prometheus.io/docs/practices/alerting/)
- [Alertmanager: Configuration](https://prometheus.io/docs/alerting/latest/configuration/)
- [Google SRE Book: Monitoring distributed systems](https://sre.google/sre-book/monitoring-distributed-systems/)
- [Google SRE Workbook: On-call](https://sre.google/workbook/on-call/)
- [Google Cloud Monitoring: Alerting](https://cloud.google.com/monitoring/alerts)

## Related

- [[slo-burn-rate-alerting]]: what to page on.
- [[incident-response]]: what happens after the page.
- [[blameless-postmortems]]: feeding runbook fixes back.
- [[prometheus-vs-cloud-monitoring]]: where the rules run.
- [[on-call-health]]: keeping the pager sustainable.
- [[game-day-chaos-gke]]: testing runbooks with faults.
- [[kubernetes-pod-troubleshooting]]: generic diagnosis steps to link from runbooks.
- [[structured-logging-conventions]]: logs the first checks rely on.
