---
title: Weekly operations review for a platform team
description: A one-hour weekly review of error budgets, pages, incidents, toil, capacity, CI health, cost and upcoming changes, with queries and a template.
type: guide
tags:
  - management
  - reliability
  - observability
  - on-call
  - team-process
created: 2026-10-21
modified: 2026-10-21
draft: false
---

A quarterly review ([[quarterly-engineering-review]]) is too slow to catch drift. By the time a quarter closes, a noisy alert has woken people for twelve weeks, a node pool has crept to its limit, and a cost anomaly has turned into a budget conversation. The weekly operations review is the team's short, data-first look at how the platform ran last week and what is coming next week. It is not a status meeting and not an incident review: it looks at trends, takes a few decisions and assigns actions.

> [!info] Scope and what is not verified
> The kube-state-metrics metric names, the PromQL functions and the GitLab pipelines API fields below follow the official documentation as read on 2026-10-21. The two Python scripts were tested against sample data and a local mock of the GitLab API, not a live instance. **Not verified**: the BigQuery billing export table and column names (written from memory; check your export schema), the Artifactory storage API field names, and which metric names exist in your setup (self-managed kube-state-metrics and a managed collector can differ). Every threshold is an example to set locally.

## Purpose and non-goals

The review answers four questions every week:

1. Are we inside our reliability targets, and is anything burning faster than last week?
2. Is the on-call load sustainable?
3. Is anything running out (capacity, budget, support lifetime)?
4. What risky change is coming that people should know about?

It is not the place to debug, to run a postmortem ([[incident-review-programme]] does that), or to report project progress. If a topic needs more than five minutes, it gets an owner and a separate slot.

## Attendees and presenter rotation

- **The outgoing on-call engineer presents.** They saw the week first-hand and the data is fresh; it also turns the on-call handover ([[on-call-health]]) into something the whole team hears.
- **The incoming on-call engineer** attends, so they hear what is fragile.
- **The engineering manager** owns the meeting and the action list, and decides when a decision is above the team.
- **The platform team,** plus a rotating guest from a consuming team once a month; their view of "how the platform ran" is often different.

Keep it to one hour, the same slot every week, with the document pre-filled before the meeting.

## Agenda

| Minutes  | Item                                                      | Output                                          |
| -------- | --------------------------------------------------------- | ----------------------------------------------- |
| 0 to 5   | Actions from last week: done, slipped, dropped            | Updated action list                             |
| 5 to 15  | SLOs and error budgets: tier changes, fastest burners     | Tier changes announced; reliability work queued |
| 15 to 25 | Pages and incidents: counts, after-hours, noisiest alerts | Alert fixes assigned                            |
| 25 to 32 | Toil: hours, top categories                               | Automation candidates                           |
| 32 to 42 | Capacity, CI health and storage                           | Scaling or clean-up actions                     |
| 42 to 48 | Cost anomalies                                            | Owner to explain or fix each                    |
| 48 to 55 | Next week: changes, freezes, EOL dates, people away       | Risks named, owners confirmed                   |
| 55 to 60 | Decisions and actions read back                           | Final action list                               |

The timings are an example; protect the last five minutes, because a review that ends without reading back the actions produces none.

## Inputs and how to pull them

Pre-fill the document the day before with the queries below. If a number needs a person to collect it by hand every week, automate it or drop it.

### SLOs and error budgets

Reuse the recording rule from [[error-budget-policy]], `slo:error_budget_remaining:ratio30d`, and show both the level and the change over the week. The `offset` modifier compares with the value seven days earlier.

```promql
# Remaining budget now (1 = untouched, 0 = exhausted), per service.
slo:error_budget_remaining:ratio30d

# Budget spent during the last week, in percentage points of the whole budget.
(slo:error_budget_remaining:ratio30d offset 7d - slo:error_budget_remaining:ratio30d) * 100

# Services in the at-risk or exhausted tier of the policy.
slo:error_budget_remaining:ratio30d < 0.25
```

Read it against the tiers in the policy. A service that spent more than a third of its budget in one week is worth a discussion even if it is still healthy. Paging itself follows [[slo-burn-rate-alerting]] and [[0045-page-only-on-slo-burn-rate]]; the weekly review looks at the slow trend the pages do not show.

### Pages and after-hours load

Every paging tool can export alert history, but the formats differ. The script below reads a neutral CSV (`created_at`, `service`, `alert`, `urgency`); map your tool's export columns to those names. It counts pages in the week, high-urgency pages, pages outside working hours in the team's time zone (weekends count as after hours) and the noisiest alerts.

```python title="pages_summary.py"
#!/usr/bin/env python3
"""Summarise a week of pages from a CSV export. Standard library only.

Expected columns (map your paging tool's export to these names):
  created_at  ISO 8601 timestamp with offset, e.g. 2026-10-14T02:13:00+00:00
  service     owning service
  alert       alert name
  urgency     high or low
"""
import argparse
import csv
import sys
from collections import Counter
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo


def parse_ts(value: str) -> datetime:
    ts = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    if ts.tzinfo is None:
        raise ValueError(f"timestamp without offset: {value!r}")
    return ts


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("csv_file")
    ap.add_argument("--end", required=True, help="end of the week, YYYY-MM-DD (exclusive)")
    ap.add_argument("--tz", default="UTC", help="team time zone for after-hours, e.g. Europe/Berlin")
    ap.add_argument("--day-start", default="09:00")
    ap.add_argument("--day-end", default="18:00")
    ap.add_argument("--top", type=int, default=5)
    args = ap.parse_args()

    tz = ZoneInfo(args.tz)
    end = datetime.combine(datetime.fromisoformat(args.end).date(), time(0), tzinfo=tz)
    start = end - timedelta(days=7)
    day_start = time.fromisoformat(args.day_start)
    day_end = time.fromisoformat(args.day_end)

    total = high = after_hours = 0
    by_alert, by_service = Counter(), Counter()
    with open(args.csv_file, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        missing = {"created_at", "service", "alert", "urgency"} - set(reader.fieldnames or [])
        if missing:
            print(f"missing columns: {', '.join(sorted(missing))}", file=sys.stderr)
            return 2
        for row in reader:
            local = parse_ts(row["created_at"]).astimezone(tz)
            if not start <= local < end:
                continue
            total += 1
            high += row["urgency"].strip().lower() == "high"
            weekend = local.weekday() >= 5
            if weekend or not day_start <= local.time() < day_end:
                after_hours += 1
            by_alert[row["alert"].strip()] += 1
            by_service[row["service"].strip()] += 1

    print(f"Pages {start:%Y-%m-%d} to {end - timedelta(days=1):%Y-%m-%d} ({args.tz})")
    print(f"  total: {total}  high urgency: {high}  after hours: {after_hours}")
    print("  top alerts:")
    for name, count in by_alert.most_common(args.top):
        print(f"    {count:4d}  {name}")
    print("  by service:")
    for name, count in by_service.most_common():
        print(f"    {count:4d}  {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

```bash
python3 pages_summary.py pages-export.csv --end 2026-10-19 --tz Europe/Berlin
```

```text
Pages 2026-10-12 to 2026-10-18 (Europe/Berlin)
  total: 4  high urgency: 3  after hours: 3
  top alerts:
       2  CheckoutErrorBudgetBurn
       2  RunnerQueueSaturated
  by service:
       2  checkout
       2  ci-runners
```

The output above is from sample data. For a team spread over several time zones, run it once per engineer's zone for the pages they took ([[platform-team-across-time-zones]]). An alert that appears in the top list two weeks running gets an owner and a fix by the alert standard ([[alert-and-runbook-standard]]): tune, demote to a ticket, or delete.

### Incidents and toil

- **Incidents:** list last week's incidents with severity, status of the review and overdue actions from the tracker described in [[incident-review-programme]]. The weekly review checks that reviews happen; it does not repeat them.
- **Toil:** total hours logged and the top three categories from the toil log in [[toil-budget]]. A category that grows three weeks in a row is an automation candidate.

### GKE capacity

kube-state-metrics exposes `kube_pod_container_resource_requests` and `kube_node_status_allocatable`, both with `resource` and `unit` labels (CPU in cores, memory in bytes). The ratio of requested to allocatable resources shows how close the scheduler is to running out, which matters more than actual usage for whether new pods fit.

```promql
# Requested share of allocatable CPU and memory, per cluster.
sum by (cluster) (kube_pod_container_resource_requests{resource="cpu"})
  / sum by (cluster) (kube_node_status_allocatable{resource="cpu"})

sum by (cluster) (kube_pod_container_resource_requests{resource="memory"})
  / sum by (cluster) (kube_node_status_allocatable{resource="memory"})

# Pods that could not be scheduled at any point in the last week.
max_over_time(sum by (cluster) (kube_pod_status_unschedulable)[7d:1h])
```

Caveats: the `cluster` label exists only if your collection adds it; drop the `by (cluster)` otherwise. Request series of finished pods may still be counted unless you filter to running and pending pods, for example by joining with `kube_pod_status_phase{phase=~"Pending|Running"} == 1` on `namespace` and `pod`. The kube-state-metrics docs themselves recommend kube-scheduler's `kube_pod_resource_request` metric as more precise if you scrape it. Which names exist depends on whether you run kube-state-metrics yourself or a managed collector ([[0042-managed-prometheus-for-application-metrics]]): check before building the panel. What ratio is "too high" depends on autoscaling headroom; set your own line, for example when the cluster autoscaler can no longer add nodes within the node pool limits.

### CI health

The GitLab pipelines API lists pipelines per project with `ref`, `status` and `updated_after` filters; durations (`duration`, `queued_duration`) come from the single-pipeline endpoint. The script below reports, for the default branch of selected projects, the success rate of finished pipelines and the median duration and queue time.

```python title="ci_health.py"
#!/usr/bin/env python3
"""Weekly CI health for a list of GitLab projects: default-branch pipeline
success rate and median duration over the last N days. Standard library only.

  GITLAB_URL=https://gitlab.example.com GITLAB_TOKEN=... \
    python3 ci_health.py --project platform/ci-templates --project 29 --ref main
"""
import argparse
import json
import os
import statistics
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

FINISHED = {"success", "failed", "canceled"}


def get(url: str, token: str):
    req = urllib.request.Request(url, headers={"PRIVATE-TOKEN": token})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp), resp.headers.get("x-next-page", "")


def pipelines(base: str, token: str, project: str, ref: str, since: str):
    pid = urllib.parse.quote(project, safe="")
    page = "1"
    while page:
        query = urllib.parse.urlencode(
            {"ref": ref, "updated_after": since, "per_page": 100, "page": page}
        )
        items, page = get(f"{base}/api/v4/projects/{pid}/pipelines?{query}", token)
        yield from items


def main() -> int:
    ap = argparse.ArgumentParser(description="Weekly CI health from the GitLab pipelines API")
    ap.add_argument("--project", action="append", required=True, help="ID or full path; repeat")
    ap.add_argument("--ref", default="main")
    ap.add_argument("--days", type=int, default=7)
    args = ap.parse_args()

    base = os.environ.get("GITLAB_URL", "https://gitlab.example.com").rstrip("/")
    token = os.environ.get("GITLAB_TOKEN")
    if not token:
        print("export GITLAB_TOKEN (read_api scope)", file=sys.stderr)
        return 2
    since = (datetime.now(timezone.utc) - timedelta(days=args.days)).strftime("%Y-%m-%dT%H:%M:%SZ")

    print(f"{'project':40} {'runs':>5} {'success':>8} {'median min':>11} {'median queue s':>15}")
    for project in args.project:
        runs = [p for p in pipelines(base, token, project, args.ref, since) if p["status"] in FINISHED]
        ok = sum(p["status"] == "success" for p in runs)
        durations, queued = [], []
        pid = urllib.parse.quote(project, safe="")
        for p in runs:  # one call per pipeline: durations are only in the detail view
            detail, _ = get(f"{base}/api/v4/projects/{pid}/pipelines/{p['id']}", token)
            if detail.get("duration") is not None:
                durations.append(detail["duration"] / 60)
            if detail.get("queued_duration") is not None:
                queued.append(detail["queued_duration"])
        rate = f"{ok / len(runs):.0%}" if runs else "n/a"
        med = f"{statistics.median(durations):.1f}" if durations else "n/a"
        medq = f"{statistics.median(queued):.0f}" if queued else "n/a"
        print(f"{project:40} {len(runs):5d} {rate:>8} {med:>11} {medq:>15}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Use a read-only token from a CI variable or the environment, never in the script. Cancelled pipelines count as not successful here; if your team cancels superseded pipelines routinely, drop `canceled` from `FINISHED`. Child pipelines are excluded from the list by default (the pipelines API returns them only when `source` is set to `parent_pipeline`). The script makes one request per pipeline, so keep the project list to the platform's own repositories and the central templates ([[gitlab-ci-pipeline-structure]]), and check the API rate limits on your instance before running it across many projects. Rising queue time usually means runner capacity, not slow jobs.

### Artifactory storage

Artifactory has a storage summary endpoint (`GET /artifactory/api/storageinfo`, with a separate call to trigger recalculation), returning binaries, repository and file store summaries. Record the total and the largest repositories weekly and plot the trend; a repository that grows faster than the rest usually lacks a cleanup policy ([[artifactory-repository-design]]). The exact response fields and how often the figures are refreshed are **not verified** here: check the JFrog REST API documentation for your version.

```bash
ARTIFACTORY_URL="https://artifactory.example.com"
# Token from the environment, passed on stdin so it is not in the process list.
printf 'header = "Authorization: Bearer %s"\n' "$ARTIFACTORY_TOKEN" |
  curl -sS --fail --config - "${ARTIFACTORY_URL}/artifactory/api/storageinfo" |
  jq -r '.repositoriesSummaryList
    | map(select(.repoKey != "TOTAL"))
    | sort_by(.usedSpaceInBytes // 0 | tonumber) | reverse | .[:10][]
    | [.repoKey, .usedSpace] | @tsv'
```

The field names (`repoKey`, `usedSpace`, `usedSpaceInBytes`) are taken from JFrog's own Go client library, which models the number either as a number or a string (hence `tonumber`); the `TOTAL` row is an assumption. Inspect one response from your instance and adjust the filter.

### Cost anomalies

The Cloud Billing export to BigQuery gives daily cost per project and service. The query below compares last week with the average of the four weeks before and lists the biggest increases. It is a sketch: the table name and columns depend on your export, so check the schema in the current docs before using it.

```sql title="weekly-cost-anomalies.sql"
-- Sketch, not verified against your export: check table and column names first.
WITH daily AS (
  SELECT
    project.id AS project_id,
    service.description AS service_name,
    DATE(usage_start_time) AS day,
    SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS net_cost
  FROM `example-billing.billing_export.gcp_billing_export_v1_EXAMPLE`
  WHERE DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL 35 DAY)
  GROUP BY project_id, service_name, day
),
weekly AS (
  SELECT
    project_id,
    service_name,
    SUM(IF(day >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY), net_cost, 0)) AS last_week,
    SUM(IF(day < DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY), net_cost, 0)) / 4 AS avg_prior_week
  FROM daily
  GROUP BY project_id, service_name
)
SELECT project_id, service_name,
  ROUND(last_week, 2) AS last_week,
  ROUND(avg_prior_week, 2) AS avg_prior_week,
  ROUND(last_week - avg_prior_week, 2) AS delta
FROM weekly
WHERE last_week - avg_prior_week > 100   -- example threshold in billing currency
ORDER BY delta DESC
LIMIT 20;
```

Billing data arrives with a delay, so the last day or two is often incomplete; compare complete days only, or read the trend with that in mind. Each anomaly gets an owner who explains it by next week ("planned load test", "new environment") or fixes it. Allocation by label and budget alerts are in [[finops-cost-allocation-and-guardrails]].

### Next week

- **Changes:** risky changes planned for next week from the change calendar, each with an owner and a rollback.
- **Freezes and maintenance windows:** upcoming freezes and GKE maintenance windows ([[change-freezes-and-maintenance-windows]]).
- **End-of-life dates:** rows of the EOL register that turned "at risk" ([[end-of-life-tracking-platform-versions]]).
- **People:** holidays and on-call swaps that leave a gap in a critical skill.

## Document template

Create the document from a template the day before, fill the numbers by script, and leave the commentary to the presenter.

```markdown title="weekly-ops-review-template.md"
# Weekly operations review: week ending YYYY-MM-DD

Presenter (outgoing on-call): @handle Incoming on-call: @handle

## Actions from last week

| Action | Owner | Due | Status |
| ------ | ----- | --- | ------ |

## SLOs and error budgets

| Service | Budget remaining | Spent this week | Tier | Comment |
| ------- | ---------------- | --------------- | ---- | ------- |

## Pages and incidents

Pages: N (high: N, after hours: N) Last week: N
Noisiest alerts: ...
Incidents: SEV, title, review date, overdue actions

## Toil

Hours: N Top categories: ...

## Capacity, CI and storage

CPU requested / allocatable: prod N%, non-prod N% Unschedulable pods: N
CI default-branch success: N% Median duration: N min Median queue: N s
Artifactory total: N TB (+N% week on week)

## Cost anomalies

| Project | Service | Delta | Owner | Explanation |
| ------- | ------- | ----- | ----- | ----------- |

## Next week

Changes: ... Freezes: ... EOL at risk: ... People away: ...

## Decisions

## New actions

| Action | Owner | Due |
| ------ | ----- | --- |
```

## Decisions the meeting may take

Write down in advance what the weekly review can decide on its own, so it does not become a meeting that only escalates:

- Move a service into a stricter error-budget tier, and announce it, as the policy says.
- Pause a non-urgent risky change planned for next week.
- Assign an alert fix, demote an alert or delete one that has never been actionable.
- Put an automation task at the top of next sprint's interrupt slice, within the team's toil budget.
- Ask a team to explain a cost anomaly by a date.

Anything that changes another team's roadmap, spends beyond the agreed budget or changes a policy goes to the manager's escalation path with the data from the review attached.

## Action tracking

- Every action has one owner and a due date, recorded in the team's tracker with a `weekly-ops` label, not only in the meeting notes.
- Start every meeting with the open actions. Slipped twice means either re-plan it explicitly or drop it explicitly; an action that silently ages is worse than none.
- Count actions opened and closed per week. If the open list only grows, the review is producing more work than the team can do: take fewer, bigger actions.

## Feeding the quarterly review

The weekly documents are the raw material for [[quarterly-engineering-review]]. At the end of the quarter, pull the thirteen weekly rows into trends: budget spent per service, pages per week, after-hours share, toil hours, capacity headroom, CI success and cost deltas. Combine them with delivery numbers from [[dora-metrics]]. A trend line built from thirteen honest weekly numbers is far more convincing than one quarterly estimate.

## Signs the review is failing

- The presenter reads numbers aloud and nobody asks a question.
- The same noisy alert is on the list for a month.
- Actions have no owners, or the owner is "the team".
- The meeting regularly overruns, or is cancelled when the week was busy (busy weeks are when it matters most).
- Numbers are collected by hand on the morning of the meeting.
- Consumers never attend, and are surprised by changes the review knew about.

## Common mistakes

- **Turning it into an incident review.** Note the incident, check the review is scheduled, move on.
- **Too many metrics.** Pick the dozen that lead to action; drop any number nobody has acted on in a quarter.
- **Absolute numbers without trend.** "14 pages" means nothing without last week and the quarter's median.
- **Thresholds copied from elsewhere.** Start from your own last quarter's data and write the line down.
- **The manager presents.** The on-call engineer knows what happened; the manager runs the meeting.
- **No link to the error budget policy.** If the policy says a tier change pauses risky changes, the review is where that is applied, every week.

## Sources

- [kube-state-metrics: pod metrics](https://github.com/kubernetes/kube-state-metrics/blob/main/docs/metrics/workload/pod-metrics.md) and [node metrics](https://github.com/kubernetes/kube-state-metrics/blob/main/docs/metrics/cluster/node-metrics.md): `kube_pod_container_resource_requests`, `kube_node_status_allocatable`, `kube_pod_status_phase`, `kube_pod_status_unschedulable`.
- [Prometheus: querying basics](https://prometheus.io/docs/prometheus/latest/querying/basics/), [functions](https://prometheus.io/docs/prometheus/latest/querying/functions/) and [operators](https://prometheus.io/docs/prometheus/latest/querying/operators/): `offset`, subqueries, over-time functions and vector matching.
- [Google SRE Workbook: Implementing SLOs](https://sre.google/workbook/implementing-slos/): background on SLOs and error budgets. Check the current text.
- [GitLab: pipelines API](https://docs.gitlab.com/api/pipelines/) and [REST API pagination](https://docs.gitlab.com/api/rest/): filters, fields and the `x-next-page` header.
- [Export Cloud Billing data to BigQuery](https://cloud.google.com/billing/docs/how-to/export-data-bigquery): export tables and schema. Check the current docs.

## Related

- [[error-budget-policy]] and [[slo-burn-rate-alerting]]: the budget rules and the pages that fire on them.
- [[on-call-health]]: on-call load.
- [[toil-budget]]: the toil log the review reads.
- [[incident-review-programme]]: where incidents are reviewed in depth.
- [[quarterly-engineering-review]]: the quarterly roll-up.
- [[finops-cost-allocation-and-guardrails]]: labels and budgets behind the cost query.
- [[end-of-life-tracking-platform-versions]]: a forward-looking input.
