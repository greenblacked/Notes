---
title: PagerDuty vs Opsgenie vs Grafana IRM for on-call paging
description: "Choosing the tool that delivers pages from Alertmanager and Cloud Monitoring: routing, schedules as code, testing the path, and Opsgenie's end of sale."
type: tool
tags:
  - tools
  - on-call
  - incident-management
  - observability
  - prometheus
created: 2026-10-21
modified: 2026-10-21
draft: false
---

[[0045-page-only-on-slo-burn-rate]] decides **what** pages a human: only SLO burn-rate alerts. [[0050-incident-severity-levels-and-roles]] decides **how** an incident runs once someone is paged. Neither picks the product in the middle, the one that turns an alert into a phone ringing at 03:00, knows who is on call, and escalates when nobody answers. ADR 0045 leaves that to the team ("which paging product is a team choice"). This note is the input to that choice: PagerDuty, Opsgenie and Grafana's incident response and management product (Grafana IRM, which absorbed Grafana OnCall).

The choice is more urgent than it looks, because two of the three options changed status in 2025.

> [!warning] Product status changed in 2025: check before you commit
> - **Opsgenie:** Atlassian announced the end of sale and end of support of standalone Opsgenie. The dates reported for the announcement are end of sale on 2025-06-04 and end of support on 2027-04-05, after which access stops and data not moved is deleted, with Jira Service Management or Compass as the migration targets. These dates come from a secondary summary of Atlassian's pages, not from the pages themselves: confirm them on the [Opsgenie product page](https://www.atlassian.com/software/opsgenie) before planning around them.
> - **Grafana OnCall OSS:** the [project README](https://github.com/grafana/oncall) states that Grafana OnCall (OSS) entered maintenance mode on 2025-03-11 and is scheduled to be archived on 2026-03-24, with only critical bugs and CVEs rated CVSS 7.0 or higher fixed until then. It recommends Grafana Cloud IRM instead. Check the repository state today; whether self-hosted installs keep any cloud connectivity after the archive was not verified.
> - Neither of these is a reason to panic-migrate, but neither should be the target of a **new** rollout.

> [!info] Not checked against current releases
> Checked on 2026-10-21 against the Alertmanager configuration reference and the Terraform provider repositories (their main branches). Not verified: prices, seat rules and free tiers of all three products; SSO and SCIM, data residency and mobile delivery guarantees; PagerDuty Events API v2 deduplication semantics and rate limits; the current list of native Cloud Monitoring channel types (including whether Opsgenie is one); heartbeat or dead man's switch features of each product; and whether the Grafana OnCall Terraform resources work unchanged against Grafana Cloud IRM. Read the vendor pages linked under Sources before relying on any of them.

## What the paging tool must do

The monitoring stack decides that something is wrong. The paging tool decides **who** hears about it, **how**, and **what happens if they do not answer**. Judge candidates on these criteria, in roughly this order of weight:

| Criterion                     | What to check                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Ingestion                     | A native Alertmanager receiver or a documented webhook, and a Cloud Monitoring notification channel or webhook path                 |
| Deduplication and grouping    | Repeated notifications for the same alert group update one incident instead of paging again                                          |
| Escalation                    | Multi-step policies with delays, loops and fallbacks to a secondary and to a manager                                                 |
| Schedules and overrides       | Layered rotations, time zones, holiday overrides and swaps without an admin                                                          |
| Delivery                      | Push, SMS and voice, delivery receipts, and behaviour when the phone is in do-not-disturb                                            |
| Incident workflow             | Acknowledge, reassign, add responders, link to the severity and roles of ADR 0050, postmortem export                                 |
| Configuration as code         | A maintained Terraform provider for services, schedules, escalation policies and integrations                                       |
| Identity                      | SSO, SCIM provisioning and deprovisioning, and role scoping per team                                                                 |
| Data residency and retention  | Where incident data and phone numbers live, and how long                                                                             |
| Exit cost                     | Export of schedules and incident history, and how much routing would need to change to swap tools                                   |

The last row matters more than it used to. A paging tool is a vendor dependency like any other: record it in [[devops-vendor-and-licence-management]] and track its lifecycle in [[end-of-life-tracking-platform-versions]], with an owner and a review date.

## At a glance

| Concern                  | PagerDuty                                              | Opsgenie                                                            | Grafana IRM (Cloud)                                                         |
| ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Status at time of writing | Active commercial product                             | End of sale announced; end of support reported for 2027-04-05       | Active; OnCall OSS in maintenance and scheduled for archive                 |
| Alertmanager integration | Native `pagerduty_configs` (Events API v2 routing key) | Native `opsgenie_configs`                                           | `webhook_configs` to an Alertmanager integration (no native receiver)       |
| Cloud Monitoring         | Native PagerDuty channel with a service key            | Not verified as a native channel; webhook path                      | Webhook path; check the current channel list                                |
| Terraform provider       | `pagerduty/pagerduty`: teams, users, schedules, escalation policies | `opsgenie/opsgenie`: teams, schedules; maintenance after end of sale not verified | `grafana/grafana`: `grafana_oncall_*` schedules, escalation chains, integrations, routes |
| Schedules                | Layered schedules with overrides                       | Schedules with rotations                                            | Schedules and on-call shifts                                                |
| Fits best                | Large or multi-tool estates that want the most mature paging product | Existing users only, while planning the exit                       | Teams already on Grafana Cloud for metrics, logs and dashboards              |
| Pricing                  | Check the vendor pricing page                          | Check your contract; no new sales                                   | Check the vendor pricing page                                               |

## Alertmanager routing to each tool

The routing tree stays the same whatever the tool: `severity="page"` goes to the paging receiver, `severity="ticket"` to the team queue, and anything without a severity goes nowhere that interrupts a person ([[alert-and-runbook-standard]]). Only the receiver changes.

Keep every secret out of the YAML. Alertmanager has `*_file` variants for each of these receivers, and they are mutually exclusive with the inline field: `routing_key` or `routing_key_file`, `api_key` or `api_key_file`, `url` or `url_file`. Mount the files from a Kubernetes Secret that is synced from your secret store, so the configuration can live in Git ([[0046-dashboards-and-alert-rules-as-code]]).

```yaml title="alertmanager.yaml"
global:
  resolve_timeout: 5m

route:
  receiver: "null"
  group_by: [alertname, service, team]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers: [alertname="Watchdog"]
      receiver: heartbeat
      group_wait: 0s
      group_interval: 1m
      repeat_interval: 1m
    - matchers: [severity="page", team="payments"]
      receiver: payments-page
    - matchers: [severity="ticket", team="payments"]
      receiver: payments-ticket
    # Catch-all: a page whose team matched no route above still reaches a person.
    - matchers: [severity="page"]
      receiver: platform-page

receivers:
  - name: "null"

  - name: heartbeat
    webhook_configs:
      - url_file: /etc/alertmanager/secrets/heartbeat-url

  # PagerDuty, Events API v2. The Opsgenie and Grafana IRM variants follow below.
  - name: payments-page
    pagerduty_configs:
      - routing_key_file: /etc/alertmanager/secrets/pagerduty-payments-routing-key
        severity: critical
        description: '{{ .CommonLabels.alertname }}: {{ .CommonAnnotations.summary }}'
        client: Alertmanager
        client_url: '{{ .ExternalURL }}'
        # Setting details replaces the default map (firing, resolved, num_firing, num_resolved).
        details:
          runbook: '{{ .CommonAnnotations.runbook_url }}'
          service: '{{ .CommonLabels.service }}'
          num_firing: '{{ .Alerts.Firing | len }}'

  - name: payments-ticket
    webhook_configs:
      - url_file: /etc/alertmanager/secrets/payments-ticket-webhook-url

  - name: platform-page
    pagerduty_configs:
      - routing_key_file: /etc/alertmanager/secrets/pagerduty-platform-routing-key
        description: 'UNROUTED page {{ .CommonLabels.alertname }} (team={{ .CommonLabels.team }})'
```

The PagerDuty receiver posts to `https://events.pagerduty.com/v2/enqueue` unless `url` or `global.pagerduty_url` overrides it. `severity` defaults to `error`. Use `routing_key` (or its file) for an Events API v2 integration; the older `service_key` belongs to the legacy "Prometheus" integration type, and the two cannot be combined.

For Opsgenie the receiver looks like this. `message` is limited to 130 characters, so keep the summary short and put detail in the description or details; by default `details` carries all common labels.

```yaml title="alertmanager.yaml (Opsgenie receiver)"
receivers:
  - name: payments-page
    opsgenie_configs:
      - api_key_file: /etc/alertmanager/secrets/opsgenie-api-key
        message: '{{ .CommonLabels.alertname }} on {{ .CommonLabels.service }}'
        description: '{{ .CommonAnnotations.summary }} Runbook: {{ .CommonAnnotations.runbook_url }}'
        # Exactly one of id, name or username; type is team, teams, user, escalation or schedule.
        responders:
          - type: team
            name: payments
```

Grafana IRM has no native receiver in the Alertmanager configuration reference. The usual path is a `webhook_configs` receiver pointing at an Alertmanager-type integration created in IRM. The integration URL contains a token, so it goes in `url_file`, never `url`:

```yaml title="alertmanager.yaml (Grafana IRM receiver)"
receivers:
  - name: payments-page
    webhook_configs:
      - url_file: /etc/alertmanager/secrets/grafana-irm-payments-url
        # send_resolved defaults to true; keep it so IRM can auto-resolve.
        # max_alerts defaults to 0 (all alerts in the group).
```

The webhook body Alertmanager sends is JSON with `"version": "4"`, `groupKey`, `status`, `receiver`, `groupLabels`, `commonLabels`, `commonAnnotations`, `externalURL` and an `alerts` array. A webhook `timeout` set above `group_interval` has no effect.

`send_resolved` defaults to `true` for all three receivers. Leave it on: a paging tool that never hears "resolved" leaves incidents open, and the next real page lands on top of stale noise.

### Validate the routing before it ships

`amtool` ships with Alertmanager releases. Test that a page-severity alert for the team actually lands on the paging receiver, in CI, on every change to the file:

```bash title="test-routing.sh"
#!/usr/bin/env bash
set -euo pipefail
CONFIG="alertmanager.yaml"

amtool config routes test --config.file="${CONFIG}" --tree \
  --verify.receivers=payments-page \
  severity=page team=payments alertname=CheckoutErrorBudgetFastBurn

amtool config routes test --config.file="${CONFIG}" --tree \
  --verify.receivers=payments-ticket \
  severity=ticket team=payments alertname=CertificateExpiresSoon

# A page for a team without its own route lands on the platform catch-all.
amtool config routes test --config.file="${CONFIG}" --tree \
  --verify.receivers=platform-page \
  severity=page team=unknown alertname=SomethingNew

# An alert without severity must not reach a human.
amtool config routes test --config.file="${CONFIG}" --tree \
  --verify.receivers=null \
  team=payments alertname=HighCPU
```

Run `amtool check-config alertmanager.yaml` as well if your version has it (`amtool --help` lists the subcommands); it was not confirmed for this note. A missing secret file is not caught by routing tests, so the deploy should also check that every `*_file` path exists in the mounted Secret.

## Cloud Monitoring notification channels

Teams that alert from Cloud Monitoring as well as Prometheus ([[prometheus-vs-cloud-monitoring]]) need the same paging target there. Channels are Terraform resources. The `type` must match a notification channel descriptor type, so list the descriptors for your project instead of guessing:

```bash title="list channel types"
PROJECT_ID="example-project"
curl -sS -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://monitoring.googleapis.com/v3/projects/${PROJECT_ID}/notificationChannelDescriptors" \
  | jq -r '.channelDescriptors[]?.type'
```

The response field name (`channelDescriptors`) follows the API's list pattern and was not checked against a live response; if the `jq` filter prints nothing, inspect the raw JSON.

The secret part of a channel goes in `sensitive_labels`, which supports `service_key` for PagerDuty, `auth_token` for Slack and `password` for basic-auth webhooks. Those values are stored in plain text in the raw Terraform state. The provider's write-only variants (`service_key_wo`, `auth_token_wo`, `password_wo`, with a matching `*_wo_version` to trigger an update) keep the value out of state; they need a Terraform and Google provider version that support write-only arguments, so check both before using them.

```hcl title="monitoring-channels.tf"
variable "pagerduty_payments_service_key" {
  description = "PagerDuty integration key for the payments service, injected by CI from the secret store."
  type        = string
  sensitive   = true
}

resource "google_monitoring_notification_channel" "payments_page" {
  project      = "example-project"
  display_name = "payments - page (PagerDuty)"
  type         = "pagerduty" # confirm with the descriptor list above

  sensitive_labels {
    service_key_wo         = var.pagerduty_payments_service_key
    service_key_wo_version = 1 # bump to push a rotated key
  }

  user_labels = {
    team     = "payments"
    severity = "page"
  }
}
```

Whether the PagerDuty channel's `service_key` expects an Events API v2 routing key or a legacy integration key was not verified; check the Cloud Monitoring notification options page and the PagerDuty integration guide together. For tools without a native channel, use a webhook channel to the tool's generic or Cloud Monitoring integration, with the token kept in `password_wo` or in the URL handled as a secret.

## Schedules and escalation as code

Schedules edited by hand in a web UI drift: people leave, rotations stop matching the team, and the escalation policy points at someone who is no longer on call. Keep the structure (teams, schedules, escalation policies, integrations) in Terraform, and let people make day-to-day overrides and swaps in the UI.

PagerDuty's provider (`pagerduty/pagerduty`) takes a `token` and its README asks for Terraform 1.1.0 or newer. An escalation policy references schedules with `schedule_reference` targets:

```hcl title="pagerduty-payments.tf"
terraform {
  required_providers {
    pagerduty = {
      source = "pagerduty/pagerduty"
      # Add a version constraint for the release you tested; the lock file records the exact one.
    }
  }
}

provider "pagerduty" {
  # token is read from the PAGERDUTY_TOKEN environment variable, set by CI from the secret store; never commit it.
}

resource "pagerduty_team" "payments" {
  name = "Payments"
}

resource "pagerduty_schedule" "payments_primary" {
  name      = "Payments primary"
  time_zone = "Europe/Kyiv"
  teams     = [pagerduty_team.payments.id]

  layer {
    name                         = "Weekly"
    start                        = "2026-11-02T09:00:00+02:00"
    rotation_virtual_start       = "2026-11-02T09:00:00+02:00"
    rotation_turn_length_seconds = 604800
    users                        = var.payments_rotation_user_ids
  }
}

resource "pagerduty_escalation_policy" "payments" {
  name      = "Payments"
  num_loops = 2
  teams     = [pagerduty_team.payments.id]

  rule {
    escalation_delay_in_minutes = 10
    target {
      type = "schedule_reference"
      id   = pagerduty_schedule.payments_primary.id
    }
  }

  rule {
    escalation_delay_in_minutes = 15
    target {
      type = "user_reference"
      id   = var.payments_engineering_manager_user_id
    }
  }
}
```

`escalation_rule_assignment_strategy` returns HTTP 403 on accounts without the Teams feature; leave it out unless your plan has it. The `Europe/Kyiv` time zone and the start dates are examples.

Grafana's provider exposes `grafana_oncall_schedule`, `grafana_oncall_on_call_shift`, `grafana_oncall_escalation_chain`, `grafana_oncall_escalation`, `grafana_oncall_integration` and `grafana_oncall_route`. The integration `type` accepts values such as `alertmanager`, `grafana_alerting`, `webhook` and `stackdriver`. Opsgenie's provider has `opsgenie_team` and `opsgenie_schedule`. Read each resource's current documentation before writing it; for the Opsgenie provider, check whether it is still maintained.

Whatever the tool, the schedule design itself (rotation length, follow-the-sun, secondary on call, recovery time after a bad night) belongs to [[on-call-health]] and [[on-call-compensation-and-recovery]], not to the tool's defaults.

## Testing the whole path

A paging path that has never been tested end to end is a hypothesis. Test three things, at three cadences.

1. **On every config change:** the `amtool` routing tests above, in CI.
2. **Continuously:** a dead man's switch. An alert rule that always fires (often named `Watchdog`, a convention rather than something the Alertmanager docs define) is routed to a heartbeat endpoint that expects it every few minutes. If the heartbeat stops, the monitoring pipeline itself is broken (Prometheus down, Alertmanager down, network to the paging tool cut), and the receiving side pages through a path that does not depend on your cluster. Paging products commonly offer such a heartbeat or check-in endpoint; whether each of these three does, and how it behaves, was not verified, so read the docs of the one you pick. Any external uptime or heartbeat service that can page works too.
3. **Monthly, in working hours:** send a real test page to the on-call phone and time it from alert to acknowledgement. Tell the on-call engineer it is coming.

```yaml title="watchdog-rule.yaml"
groups:
  - name: meta
    rules:
      - alert: Watchdog
        expr: vector(1)
        labels:
          severity: heartbeat
        annotations:
          summary: "Always firing. If the heartbeat receiver stops seeing this, alerting is broken."
```

The `heartbeat` route in the Alertmanager example above matches it by name. Keep its `repeat_interval` well below the heartbeat timeout configured on the receiving side, otherwise the heartbeat expires between repeats and pages for nothing.

For the monthly test, a short-lived alert pushed with `amtool alert add` exercises the real receiver. Its flags (labels, annotations, end time) were not confirmed for this note, so run `amtool alert add --help` first, and use `severity=page` with an obviously test-only `alertname` and `team` so nobody mistakes it for an incident.

## Failure modes

| Failure                                  | What happens                                                         | Mitigation                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Paging tool outage                       | Alerts fire, nobody is told                                          | Dead man's switch from outside; a documented fallback (team chat plus phone tree) in [[incident-response]]     |
| Alert storm                              | Dozens of pages for one cause                                        | `group_by` on `alertname`, `service`, `team`; inhibition rules; the tool's own grouping                        |
| Unrouted alert                           | A page-worthy alert lands on the default route                       | A catch-all `severity="page"` route after the team routes, to a platform-owned receiver; a routing test for it |
| Stale schedule                           | The policy pages someone who left or is on leave                     | Schedules in Terraform, deprovisioning through SCIM where available, a monthly schedule review                 |
| Expired or rotated key                   | Notifications fail silently                                          | Alert on Alertmanager notification failures; rotate keys through the secret store and the `*_file` mounts      |
| Phone settings                           | The page arrives but makes no sound                                  | Each engineer runs the tool's own test notification after phone or OS updates                                  |

Alertmanager exports metrics on failed notifications. Alert on them (as a ticket, not a page) so a broken integration is seen before an incident finds it.

## Migrating between tools

Run both tools in parallel; never cut over in one step.

1. Recreate teams, schedules and escalation policies in the new tool from Terraform.
2. Add the new receiver **alongside** the old one. A single Alertmanager receiver can hold several integrations, so `payments-page` can contain both `opsgenie_configs` and `pagerduty_configs`. During this phase the new tool's escalation policy notifies by low-urgency channel only, so people are not paged twice.
3. Compare for two to four weeks: every incident in the old tool has a matching incident in the new one, with the same grouping.
4. Switch urgency: the new tool pages, the old one only records.
5. Remove the old receiver after a full rotation cycle without gaps, then delete its keys and integrations.

Rollback at any step is reverting the routing commit. Keep the old tool's schedules current until step 5 is done.

## Recommendation

- **New setups:** PagerDuty if you want the most established standalone paging product and several monitoring sources feed it; Grafana IRM if you already run on Grafana Cloud and want alerting, on-call and incidents in one place. Decide on the criteria table, the price you are quoted and an exit test, not on feature lists.
- **Opsgenie today:** plan the exit now, against the end-of-support date Atlassian publishes. Migrating with months to spare is a project; migrating in the last weeks is an incident.
- **Self-hosted Grafana OnCall OSS:** treat it as end of life. Move to a supported product before the archive date stated in the README, or document the accepted risk if that date has passed.
- **In every case:** configuration in Terraform and Git, secrets only through `*_file` and write-only fields, routing tests in CI, a dead man's switch, and a monthly test page.

Revisit when the vendor's status changes again, when your monitoring stack changes ([[prometheus-vs-cloud-monitoring]]), or when the on-call review in [[0045-page-only-on-slo-burn-rate]] shows pages arriving late or not at all.

## Related

- [[0045-page-only-on-slo-burn-rate]]
- [[0050-incident-severity-levels-and-roles]]
- [[slo-burn-rate-alerting]]
- [[alert-and-runbook-standard]]
- [[incident-response]]
- [[on-call-health]]
- [[on-call-compensation-and-recovery]]
- [[prometheus-vs-cloud-monitoring]]
- [[devops-vendor-and-licence-management]]
- [[end-of-life-tracking-platform-versions]]

## Sources

- [Alertmanager configuration reference](https://prometheus.io/docs/alerting/latest/configuration/) (receiver fields, `*_file` fields and defaults; read from its source in the Alertmanager repository on 2026-10-21)
- [Alertmanager repository](https://github.com/prometheus/alertmanager) (`amtool` usage)
- [PagerDuty Events API v2 overview](https://developer.pagerduty.com/docs/events-api-v2/overview)
- [PagerDuty Terraform provider](https://registry.terraform.io/providers/PagerDuty/pagerduty/latest/docs)
- [Grafana Terraform provider](https://registry.terraform.io/providers/grafana/grafana/latest/docs)
- [Google provider: `google_monitoring_notification_channel`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_notification_channel)
- [Cloud Monitoring notification options](https://cloud.google.com/monitoring/support/notification-options)
- [Opsgenie product page](https://www.atlassian.com/software/opsgenie)
- [Grafana OnCall repository and README](https://github.com/grafana/oncall)
- [Grafana OnCall maintenance mode announcement](https://grafana.com/blog/2025/03/11/grafana-oncall-maintenance-mode/)
- [Grafana Cloud alerting and IRM documentation](https://grafana.com/docs/grafana-cloud/alerting-and-irm/)
