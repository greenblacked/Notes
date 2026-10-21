---
title: "Observability 05: SLIs, SLOs and error budgets, from a first SLO to a burn-rate alert"
description: Choose an SLI, set an SLO, work out the error budget, record the SLI in Prometheus and page only on a tested multi-window burn-rate alert.
type: guide
tags:
  - learning
  - observability
  - reliability
  - prometheus
  - on-call
created: 2026-10-21
modified: 2026-10-21
draft: false
---

> [!info] Level: middle | Time: about 3 h | You need: [[learn/first-prometheus-alert|Observability 03: Your first Prometheus alert]] and [[learn/promql-for-alert-rules-and-recording-rules|Observability 04: PromQL for alert rules]] | Lab: `promtool` and `bc` on Lab A from [[learn/lab-setup|Start 01: Set up your lab]]; optionally the Prometheus from P5 in [[learn/lab-setup#The homelab ladder|the homelab ladder]]

"Is the service reliable enough?" has no answer until you say **what** you measure, **how good** it must be, and **over what period**. That is an SLO. Once you have one, two hard questions get simple answers: "should this page someone at 3 a.m.?" (only if the SLO is in danger) and "can we ship this risky change?" (only if there is budget left). This lesson takes one HTTP service from nothing to a written SLO, an error budget you can compute by hand, recording rules for the SLI, and a multi-window burn-rate alert that you unit-test with `promtool` before it pages anyone.

It is the foundation for [[adr/0045-page-only-on-slo-burn-rate|ADR 0045]], which pages on-call only on SLO burn rate, and for [[patterns/slo-burn-rate-alerting]], the production version of the rules you write here.

> [!note] What was run for this page
> The rule files and unit tests in this lesson were run with `promtool` 2.45.3 (the Ubuntu package) on 2026-10-21, and the budget arithmetic with `bc`; their output below is observed. Nothing ran against a live Prometheus, so dashboards and live query results are illustrative. Not checked against the SRE book and workbook for this page: definitions are written in this page's own words, and the burn-rate parameters are the workbook's recommended values as reproduced by open-source SLO generators. Compare them with the chapter "Alerting on SLOs" before adopting them as policy.

## What you will learn

- What SLIs, SLOs and SLAs are, and why your SLO must be stricter than any SLA.
- How to choose an SLI for request-driven services, pipelines and batch jobs, and where to measure it.
- How to compute an error budget in minutes and in requests, and what rolling and calendar windows change.
- What a burn rate is, and why a multi-window, multi-burn-rate alert pages fast on outages and stays quiet on blips.
- How to write the SLI as recording rules, the alert on top of them, and unit tests that prove both.
- How to write a one-page SLO document and the error budget policy that gives it teeth.

## SLI, SLO and SLA

- An **SLI** (service level indicator) is a measurement of what users experience, written as a ratio: **good events / valid events**. "The share of HTTP requests that returned a non-5xx response" or "the share of requests answered in under 300 ms". A ratio between 0 and 1 (or 0% and 100%) is easy to compare across services and windows.
- An **SLO** (service level objective) is a target for an SLI over a window: "99.9% of requests succeed, measured over a rolling 30 days". It is an internal engineering target.
- An **SLA** (service level agreement) is a contract with customers, with consequences (credits, penalties) when it is missed. It is a business and legal document.

Set the SLO **stricter** than the SLA, so you notice and react before you owe anyone money. Many internal services have SLOs and no SLA at all.

"Valid events" matters: decide what you exclude. Health checks, requests rejected because the client was wrong (most 4xx), and traffic from your own load tests usually do not count. Write the exclusions down, or the number will be argued about in every incident.

## Choosing SLIs

Ask "what would a user complain about?" and measure that, not CPU or pod restarts.

| Service type                 | Typical SLIs                      | Good event example                            |
| ---------------------------- | --------------------------------- | --------------------------------------------- |
| Request-driven (API, web)    | Availability, latency             | Non-5xx response; response in under 300 ms    |
| Data pipeline or queue       | Freshness, correctness, coverage  | Record processed within 10 minutes of arrival |
| Batch job (backups, reports) | Success, completion time          | Nightly run finished successfully by 06:00    |
| Storage                      | Durability, availability of reads | Read returned the object                      |

Two or three SLIs per service is plenty. One availability and one latency SLI covers most APIs.

**Latency SLIs are ratios too.** Do not set an SLO on an average or a percentile of percentiles. Count requests faster than a threshold, using a histogram bucket that sits exactly on the threshold:

```promql
sum by (job) (rate(http_request_duration_seconds_bucket{job="api", le="0.3"}[5m]))
/
sum by (job) (rate(http_request_duration_seconds_count{job="api"}[5m]))
```

This is "the share of requests answered in 300 ms or less". It only works if the histogram has a `le="0.3"` bucket; choose the buckets with the SLO in mind.

### Where to measure

The closer to the user, the more truthful, and the harder:

- **At the application.** Easy, detailed, but misses requests that never reached it (a broken load balancer, DNS, TLS).
- **At the load balancer or ingress.** Sees every request that reached your edge, including ones the app never saw. Usually the best default for HTTP.
- **From a synthetic client (probe).** Sees what an outside user sees, but samples a few paths, not real traffic.

A common production combination: the SLO on load balancer metrics, plus a synthetic probe as a second signal for "no traffic at all", which a ratio cannot see.

## The error budget

If the SLO is 99.9%, you are allowed 0.1% bad events. That allowance is the **error budget**: `budget = 1 - SLO`. In requests, `allowed bad requests = (1 - SLO) * total requests`. In time, for a total outage, `allowed minutes = (1 - SLO) * minutes in the window`.

A 30-day window is 30 x 24 x 60 = 43,200 minutes:

```bash
for slo in 99 99.5 99.9 99.95 99.99; do
  printf '%s%% -> ' "$slo"
  echo "(1 - $slo / 100) * 30 * 24 * 60" | bc -l
done
```

```text
99% -> 432.00000000000000000000
99.5% -> 216.00000000000000000000
99.9% -> 43.20000000000000000000
99.95% -> 21.60000000000000000000
99.99% -> 4.32000000000000000000
```

_Observed with `bc`._ So 99.9% over 30 days is **43.2 minutes of total outage**, and 99.99% is 4.32 minutes, less than one slow manual rollback. Each extra nine costs about ten times more engineering, which is why 100% is never the target.

The minutes are only for a **total** outage. A partial failure spends budget more slowly: 10% of requests failing for an hour spends 0.1 x 60 = 6 "full-outage minutes". For request SLIs, think in requests: at 2 million requests per 30 days, 99.9% allows 2,000 failed requests.

### Rolling or calendar windows

- A **rolling** window (the last 30 days, re-evaluated continuously) reflects what users felt recently. Bad days fall out of the window 30 days later. Best for alerting and day-to-day decisions.
- A **calendar** window (this month) resets on the 1st. It fits reporting and SLAs, but a bad day on the 30th is forgotten on the 1st, and a team can be tempted to "spend" the rest of the month's budget.

Use a rolling window for the SLO and alerts, and report calendar numbers if the business asks for them.

## Burn rate

The **burn rate** is how fast you spend budget compared with spending it exactly evenly over the window:

```text
burn rate = observed error ratio / (1 - SLO)
```

At 99.9%, an error ratio of 0.1% is burn rate 1: the budget lasts exactly 30 days. An error ratio of 1.44% is burn rate 14.4. Another way to read it: if you spend a share `b` of the budget in a time `t`, the burn rate is `b x (window / t)`.

```bash
echo '0.02 * 720 / 1; 0.05 * 720 / 6; 0.10 * 720 / 72' | bc -l   # 720 h = 30 days
echo '30 * 24 / 14.4; 30 * 24 / 6; 30 / 1' | bc -l              # time to empty the budget
```

```text
14.40000000000000000000
6.00000000000000000000
1.00000000000000000000
50.00000000000000000000
120.00000000000000000000
30.00000000000000000000
```

_Observed._ So "2% of the budget in 1 hour" is burn rate 14.4, which empties the whole budget in 50 hours; burn rate 6 empties it in 120 hours (5 days); burn rate 1 in the full 30 days.

### Why not alert on the error ratio directly?

- "Errors above 0.1% for 5 minutes" pages on every blip that would cost a fraction of a percent of the budget, so on-call learns to ignore it.
- "Errors above 0.1% over 30 days" only fires after the budget is gone.

A burn-rate alert asks the useful question: **at this speed, how soon is the SLO in danger?** Fast burns page now; slow burns become a ticket.

### Multi-window, multi-burn-rate

Each alert checks a **long window** (is enough budget really being spent?) and a **short window** (is it still happening right now?), both above the same burn rate. The long window prevents paging on a 2-minute blip; the short window makes the alert clear soon after the problem ends instead of an hour later. In these parameters the short window is 1/12 of the long one.

The SRE workbook's recommended starting point for a 30-day SLO, as reproduced by open-source SLO generators:

| Severity | Budget spent | Long window | Short window | Burn rate |
| -------- | ------------ | ----------- | ------------ | --------- |
| Page     | 2%           | 1 hour      | 5 minutes    | 14.4      |
| Page     | 5%           | 6 hours     | 30 minutes   | 6         |
| Ticket   | 10%          | 3 days      | 6 hours      | 1         |

Some generators add a fourth tier (10% in 1 day, short window 2 hours, burn rate 3) as a ticket. Compare the table with the workbook chapter "Alerting on SLOs" before you adopt it; the numbers in [[patterns/slo-burn-rate-alerting]] are the same three tiers.

## The SLI as recording rules

Burn-rate alerts evaluate the same ratio over five windows. Recording rules compute each once per minute, keep the alert expressions short, and give dashboards the same numbers the alerts use. The names follow the Prometheus convention `level:metric:operations`: aggregated by `job`, an errors-per-requests ratio, over a rate window.

```yaml title="slo-rules.yml"
groups:
  - name: slo-api-availability
    interval: 1m
    rules:
      # SLI: share of requests that failed (5xx), per job, over several windows.
      - record: job:http_errors_per_requests:ratio_rate5m
        expr: |
          sum by (job) (rate(http_requests_total{code=~"5.."}[5m]))
          /
          sum by (job) (rate(http_requests_total[5m]))
      - record: job:http_errors_per_requests:ratio_rate30m
        expr: |
          sum by (job) (rate(http_requests_total{code=~"5.."}[30m]))
          /
          sum by (job) (rate(http_requests_total[30m]))
      - record: job:http_errors_per_requests:ratio_rate1h
        expr: |
          sum by (job) (rate(http_requests_total{code=~"5.."}[1h]))
          /
          sum by (job) (rate(http_requests_total[1h]))
      - record: job:http_errors_per_requests:ratio_rate6h
        expr: |
          sum by (job) (rate(http_requests_total{code=~"5.."}[6h]))
          /
          sum by (job) (rate(http_requests_total[6h]))
      - record: job:http_errors_per_requests:ratio_rate3d
        expr: |
          sum by (job) (rate(http_requests_total{code=~"5.."}[3d]))
          /
          sum by (job) (rate(http_requests_total[3d]))

  - name: slo-api-availability-alerts
    interval: 1m
    rules:
      # SLO 99.9% over 30 days: the error budget is 0.1% = 0.001 of requests.
      - alert: ApiErrorBudgetBurnFast
        expr: |
          job:http_errors_per_requests:ratio_rate1h{job="api"} > (14.4 * 0.001)
          and
          job:http_errors_per_requests:ratio_rate5m{job="api"} > (14.4 * 0.001)
        for: 2m
        labels:
          severity: page
        annotations:
          summary: "api is burning its 30-day error budget at 14.4x or faster (2% in 1 hour)"
          runbook_url: "https://runbooks.example.com/api/error-budget-burn"
      - alert: ApiErrorBudgetBurnMedium
        expr: |
          job:http_errors_per_requests:ratio_rate6h{job="api"} > (6 * 0.001)
          and
          job:http_errors_per_requests:ratio_rate30m{job="api"} > (6 * 0.001)
        for: 5m
        labels:
          severity: page
        annotations:
          summary: "api is burning its 30-day error budget at 6x or faster (5% in 6 hours)"
          runbook_url: "https://runbooks.example.com/api/error-budget-burn"
      - alert: ApiErrorBudgetBurnSlow
        expr: |
          job:http_errors_per_requests:ratio_rate3d{job="api"} > (1 * 0.001)
          and
          job:http_errors_per_requests:ratio_rate6h{job="api"} > (1 * 0.001)
        for: 30m
        labels:
          severity: ticket
        annotations:
          summary: "api is on course to spend its whole 30-day error budget (10% in 3 days)"
          runbook_url: "https://runbooks.example.com/api/error-budget-burn"
```

Why it is written this way:

- **Sum first, then divide.** Numerator and denominator are aggregated separately and then divided. Averaging per-instance ratios would weight an idle instance like a busy one.
- **The threshold is `burn rate x budget`.** `14.4 * 0.001` is an error ratio of 1.44%. Changing the SLO means changing one number, so keep it visible (or in a recording rule of its own, as the pattern note does).
- **No traffic, no ratio.** With zero requests the division returns nothing, and the alert stays silent. That is correct for the SLO, but it means an SLO alert cannot detect "the service is down and nobody can reach it" if the metric source is the service itself. Add an `absent()` or synthetic-probe alert for that case ([[learn/promql-for-alert-rules-and-recording-rules|Observability 04]] covers `absent`).
- **`for` is short.** The two windows already filter noise; a long `for` only delays the page.
- **A 3-day range is expensive.** `rate(...[3d])` reads three days of samples every minute. On a busy Prometheus, compute the long windows from a 5-minute recording rule with `avg_over_time` or evaluate them less often, as the pattern note discusses, and watch the rule evaluation duration.

## Testing the alert with promtool

An alert you have never seen fire is a guess. `promtool test rules` feeds synthetic series into the rules and checks what fires when. Series notation: `'0+980x180'` means start at 0 and add 980 per step for 180 steps; with `interval: 1m` that is a counter growing by 980 a minute for three hours.

```yaml title="slo-rules-test.yml"
rule_files:
  - slo-rules.yml
evaluation_interval: 1m
tests:
  # 2% errors: 20x the 0.1% budget rate. Fast burn must page.
  - name: sustained-burn-pages
    interval: 1m
    input_series:
      - series: 'http_requests_total{job="api",code="200"}'
        values: "0+980x180"
      - series: 'http_requests_total{job="api",code="500"}'
        values: "0+20x180"
    promql_expr_test:
      - expr: job:http_errors_per_requests:ratio_rate5m
        eval_time: 90m
        exp_samples:
          - labels: 'job:http_errors_per_requests:ratio_rate5m{job="api"}'
            value: 0.02
    alert_rule_test:
      - eval_time: 90m
        alertname: ApiErrorBudgetBurnFast
        exp_alerts:
          - exp_labels:
              severity: page
              job: api
            exp_annotations:
              summary: "api is burning its 30-day error budget at 14.4x or faster (2% in 1 hour)"
              runbook_url: "https://runbooks.example.com/api/error-budget-burn"

  # 0.05% errors: half the budget rate. Nothing may page.
  - name: healthy-no-page
    interval: 1m
    input_series:
      - series: 'http_requests_total{job="api",code="200"}'
        values: "0+999.5x180"
      - series: 'http_requests_total{job="api",code="500"}'
        values: "0+0.5x180"
    alert_rule_test:
      - eval_time: 90m
        alertname: ApiErrorBudgetBurnFast
        exp_alerts: []
      - eval_time: 90m
        alertname: ApiErrorBudgetBurnMedium
        exp_alerts: []

  # 60 healthy minutes, 10 minutes of 100% errors, 30 healthy minutes.
  # The fast alert pages during the outage and clears soon after it, thanks to the 5m window.
  - name: outage-pages-then-clears
    interval: 1m
    input_series:
      - series: 'http_requests_total{job="api",code="200"}'
        values: "0+1000x60 60000+0x10 60000+1000x30"
      - series: 'http_requests_total{job="api",code="500"}'
        values: "0+0x60 0+1000x10 10000+0x30"
    alert_rule_test:
      - eval_time: 65m
        alertname: ApiErrorBudgetBurnFast
        exp_alerts:
          - exp_labels:
              severity: page
              job: api
            exp_annotations:
              summary: "api is burning its 30-day error budget at 14.4x or faster (2% in 1 hour)"
              runbook_url: "https://runbooks.example.com/api/error-budget-burn"
      - eval_time: 85m
        alertname: ApiErrorBudgetBurnFast
        exp_alerts: []
```

```bash
promtool check rules slo-rules.yml
promtool test rules slo-rules-test.yml
```

```text
Checking slo-rules.yml
  SUCCESS: 8 rules found

Unit Testing:  slo-rules-test.yml
  SUCCESS
```

_Observed with promtool 2.45.3._

The third test is the one that teaches. At minute 85 the 1-hour error ratio is still far above 1.44% (ten minutes of total failure are inside the last hour), so a single-window alert would keep paging for most of an hour after recovery. The 5-minute window has been clean since minute 75, so the multi-window alert has cleared. Prove the opposite once: change the second `eval_time` to `72m` (two minutes after the outage ends) and the test fails, because the alert is still firing then:

```text
Unit Testing:  neg-test.yml
  FAILED:
    name: outage-pages-then-clears,
    alertname: ApiErrorBudgetBurnFast, time: 1h12m,
        exp:[],
        got:[
            0:
              Labels:{alertname="ApiErrorBudgetBurnFast", job="api", severity="page"}
              Annotations:{runbook_url="https://runbooks.example.com/api/error-budget-burn", summary="api is burning its 30-day error budget at 14.4x or faster (2% in 1 hour)"}
            ]
```

_Observed with promtool 2.45.3._ The current "Unit testing for rules" page also documents test-file options such as `start_timestamp` and `fuzzy_compare`; they may not exist in 2.45, so check that page for your version before using them.

## The error budget policy

An SLO without consequences is a dashboard. The **error budget policy** says, in advance and agreed with product owners, what happens as budget is spent:

- Budget healthy: ship at the normal pace; spend budget on experiments and planned risky changes.
- Budget mostly spent (for example under 25% left): extra review for risky changes, prioritise the reliability work the last incidents identified.
- Budget exhausted: freeze non-urgent feature releases for the service until the rolling window recovers; only fixes and reliability work ship. A single incident that burns a large share gets a postmortem.

The point is that the conversation happens once, calmly, instead of during every incident. The platform's version is [[standards/error-budget-policy]]; [[learn/on-call-incidents-and-postmortems|Incidents 02]] covers the postmortems it asks for, and [[management/dora-metrics]] shows how change failure rate and recovery time tell the same story from the delivery side.

## The SLO document

Write each SLO on one page, next to the code that implements it, and review it at least yearly:

```markdown title="slo-api.md"
# SLO: api availability

- Service and owner: api, team Lab Platform (on-call rotation "lab-platform").
- SLI: share of HTTP requests to api that return a non-5xx status, measured at the ingress.
  Valid events: all requests except /healthz and requests from the load-test client.
- SLO: 99.9% over a rolling 30 days.
- Error budget: 0.1% of requests (43.2 minutes of total outage per 30 days).
- Alerts: burn rate 14.4 over 1h and 5m (page), 6 over 6h and 30m (page), 1 over 3d and 6h (ticket).
  Rules: slo-rules.yml, tests: slo-rules-test.yml.
- Policy: standards/error-budget-policy applies. Budget exhausted means a release freeze for api.
- Dependencies and known gaps: the SLI cannot see total loss of traffic; a synthetic probe alert covers it.
- Reviewed: <date>, next review <date>.
```

A production readiness review ([[standards/production-readiness-review]]) asks for exactly this document before a service takes real traffic.

## Hands-on exercises

You need `promtool` (from your distribution's Prometheus package or the release archive) and `bc`. Work in `~/slo-lab`.

1. **Compute budgets by hand, then check them.** On paper, compute the 30-day full-outage budget for 99%, 99.9% and 99.99%, and the number of allowed failed requests for 99.9% at 5 million requests a month. Then run the `bc` loop from "The error budget" and `echo '(1 - 0.999) * 5000000' | bc -l`.
   Expected: 432, 43.2 and 4.32 minutes; 5,000 requests.
   If you see something else: `bc` without `-l` does integer division and prints 0; add `-l`.

2. **Compute burn rates.** What burn rate spends 5% of the budget in 6 hours on a 30-day SLO, and how long would the whole budget last at that rate? Check with the second `bc` block.
   Expected: 6, and 120 hours (5 days).
   If you see something else: check you used 720 hours for 30 days.

3. **Write and check the recording rules.**

   ```bash
   mkdir -p ~/slo-lab && cd ~/slo-lab
   # create slo-rules.yml from the section above
   promtool check rules slo-rules.yml
   ```

   Expected: `SUCCESS: 8 rules found`.
   If you see something else: a YAML error names the line (indentation under `expr: |` is the usual cause); a parse error in an expression names the rule.

4. **Run the unit tests.** Create `slo-rules-test.yml` from the testing section and run `promtool test rules slo-rules-test.yml`.
   Expected: `SUCCESS`.
   If you see something else: a "could not find" rule-file error means the path is relative to the test file's directory. A value mismatch on the ratio prints `exp` and `got` samples; recheck the series arithmetic (20 of 1,000 requests is 0.02).

5. **Break it on purpose.** Copy the test file to `neg-test.yml`, change the `85m` evaluation to `72m`, and run it.
   Expected: `FAILED` with `exp:[]` and a `got` alert, as shown above. Explain in one sentence why the alert is still firing at minute 72.
   If you see something else: if it passes, you edited the first evaluation (`65m`) instead of the second.

6. **Add a latency SLI.** Write a recording rule `job:http_requests_fast_per_requests:ratio_rate5m` with the histogram expression from "Choosing SLIs", and a `promql_expr_test` with two input series (`http_request_duration_seconds_bucket{job="api",le="0.3"}` growing by 900 a minute and `http_request_duration_seconds_count{job="api"}` growing by 1,000) that expects `0.9` at `eval_time: 20m`.
   Expected: `SUCCESS` (observed with promtool 2.45.3).
   If you see something else: if no sample comes back, check the label sets: both series need `job="api"` and the bucket needs `le="0.3"`. If you try 990 of 1,000 and expect `0.99`, promtool 2.45.3 fails with `got: ... 9.899999999999999E-01`: values are compared exactly, and floating-point division is not exact. Choose values that divide exactly, or check whether your promtool version has a fuzzy comparison option.

7. **Write the SLO document.** Fill in the one-page template for a service in your homelab (P5 has Prometheus scraping something). Decide and write down the valid-events exclusions.
   Expected: a page another engineer could implement and argue with.
   If you see something else: if you cannot say what users complain about, ask whoever uses the service before picking the SLI.

8. **Optional: load the rules into the P5 Prometheus.** Add `slo-rules.yml` to `rule_files` in its configuration, reload it, and query `job:http_errors_per_requests:ratio_rate5m` in the expression browser.
   Expected: one series per `job` that exposes `http_requests_total`, or nothing if no job has that metric (then adapt the metric and label names to what you scrape).
   If you see something else: the Prometheus "Rules" page shows evaluation errors and durations per rule.

## Common mistakes

- **A 100% target.** It leaves no budget, so every change is a violation and the SLO is ignored. Pick a target users would actually notice missing.
- **SLIs on averages or percentiles.** An average hides the slow tail; a percentile cannot be summed across instances. Count good events against a threshold.
- **Measuring only at the app.** Requests that never reach it are invisible. Measure at the edge where possible, and add a probe for total loss of traffic.
- **Too many SLOs.** Twenty SLOs per service means none is watched. Two or three per service, each with an owner.
- **Single-window burn alerts.** One long window pages late and clears late; one short window pages on blips. Use both.
- **Low-traffic services with request ratios.** At ten requests an hour, one failure is a 10% error ratio and a 100x burn. Use longer windows, count-based thresholds or synthetic traffic for these, and say so in the SLO document.
- **No policy.** Without an agreed error budget policy, a spent budget changes nothing. Agree it before the first incident.
- **Untested alert rules.** A typo in a label matcher makes an alert silently never fire. Keep `promtool test rules` in CI next to the rules ([[adr/0046-dashboards-and-alert-rules-as-code|ADR 0046]]).

## Check your understanding

1. What is the difference between an SLO and an SLA, and which one should be stricter?
2. A 99.5% SLO over 30 days: how many minutes of total outage is the budget, and how many failed requests at 4 million requests?
3. What does burn rate 14.4 mean for a 30-day budget?
4. Why does a burn-rate alert need a short window as well as a long one?
5. Why should a latency SLI count requests under a threshold instead of alerting on the 99th percentile?
6. The service received no traffic for an hour because DNS broke. Did the availability SLO alert fire? What catches this?

> [!question]- Answers
>
> 1. An SLO is an internal reliability target; an SLA is a contract with penalties. The SLO should be stricter, so you react before the SLA is breached.
> 2. (1 - 0.995) x 43,200 = 216 minutes; 0.005 x 4,000,000 = 20,000 failed requests.
> 3. Budget is being spent 14.4 times faster than an even spend; if it continues, the whole 30-day budget is gone in 30 x 24 / 14.4 = 50 hours. Sustained for 1 hour, it spends 2% of the budget.
> 4. The long window proves enough budget is really being spent (no paging on blips); the short window proves it is still happening, so the alert clears soon after recovery instead of firing for the rest of the long window.
> 5. Counted good-event ratios can be summed across instances and windows and turned into an error budget. Percentiles cannot be aggregated correctly and give no budget arithmetic.
> 6. Probably not: with no requests, the ratio has no samples, so the alert is silent. A synthetic probe from outside, or an `absent()` / traffic-drop alert, catches it.

## Next steps

Next lesson: continue in [[learn/index|the learning path]] with [[learn/on-call-incidents-and-postmortems|Incidents 02: Your first on-call shift, incidents and blameless postmortems]] if you have not done it. Previous lesson: [[learn/promql-for-alert-rules-and-recording-rules|Observability 04: PromQL for alert rules]].

To go deeper:

- [[patterns/slo-burn-rate-alerting]] for the production rules, Cloud Monitoring SLOs and Grafana panels.
- [[adr/0045-page-only-on-slo-burn-rate]] and [[standards/error-budget-policy]] for how paging and budgets are governed here.
- [[standards/production-readiness-review]] for where the SLO document is required.
- [[management/on-call-health]] for measuring whether paging is sustainable.
- [[runbooks/prometheus-high-cardinality-triage]] if long-window recording rules make your Prometheus slow.

## Sources

- Google SRE book, chapter "Service Level Objectives", and SRE workbook, chapters "Implementing SLOs" and "Alerting on SLOs" (https://sre.google/books/): the concepts and the multi-window, multi-burn-rate method. Not checked against these chapters for this page; verify there.
- sloth (https://github.com/slok/sloth), file `internal/alert/windows/google-30d.yaml`, which states its windows come from the workbook chapter: the burn-rate table values, read 2026-10-21.
- google/slo-generator README (https://github.com/google/slo-generator): the SLI, error budget and burn-rate definitions.
- Prometheus documentation, "Recording rules", "Alerting rules" and "Unit testing for rules" (https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/), and "Defining recording rules" in the best practices (https://prometheus.io/docs/practices/rules/): the test file format and the rule naming and aggregation conventions. All rule files and tests in this lesson were run with promtool 2.45.3 on 2026-10-21.
- Not verified: verbatim SRE book and workbook text and whether the workbook itself lists the 1-day tier; behaviour against a live Prometheus; Cloud Monitoring SLO features (see the pattern note); the cost of 3-day range queries on your Prometheus. Check the current docs.
