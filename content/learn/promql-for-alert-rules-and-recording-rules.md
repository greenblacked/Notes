---
title: "Observability 04: PromQL for alert rules: rates, ratios, vector matching, histograms, absent and recording rules"
description: "Write the PromQL that alert rules need: rates, ratios, vector matching, histogram quantiles, missing series, and recording rules with tests."
type: guide
tags:
  - learning
  - prometheus
  - observability
  - reliability
created: 2026-10-19
modified: 2026-10-19
draft: false
---

> [!info] Level: middle | Time: about 4 h | You need: [[learn/first-prometheus-alert|Observability 03: Your first Prometheus alert]] | Lab: Prometheus in Docker or the P5 homelab from [[learn/lab-setup|Start 01: Set up your lab]], plus `promtool`

[[learn/first-prometheus-alert|Observability 03]] taught you what an alert is: the states, the labels, Alertmanager routing, and how to unit-test a rule with `promtool`. It used one query, a ratio of two sums, and asked you to trust it. This lesson is about the **query language itself**, because most bad alerts are bad queries: a `rate` over the wrong window, a ratio that returns nothing when traffic stops, a quantile averaged across instances, an alert that is silent because the metric disappeared. You will learn the handful of PromQL building blocks that alert rules use, and then how to put expensive or reused expressions into **recording rules** and test them.

> [!note] Nothing here was run for this page
> The queries, rule files and sample output follow the Prometheus documentation and are not verified. Series, values and output are illustrative and come from invented metrics. Check the documentation for the Prometheus version you run, especially for native histograms and newer functions.

## What you will learn

- The difference between instant vectors, range vectors and scalars, and why every counter query starts with `rate`.
- How to aggregate with `sum by` and `without`, and how to combine two vectors with `on`, `ignoring` and `group_left`.
- How to write a ratio that survives a zero denominator.
- How to take a quantile from a histogram, and what to keep in the aggregation.
- How to alert on missing data with `absent`, `absent_over_time` and `up == 0`, and how to predict a full disk with `predict_linear`.
- How to write recording rules with a naming convention, alert on them, and test them with `promql_expr_test`.

## Instant and range vectors

PromQL expressions have types, and most errors come from mixing them up.

- An **instant vector** is a set of time series, each with one sample at the evaluation time: `http_requests_total`. You can graph it, compare it, aggregate it.
- A **range vector** is a set of series with many samples over a window, written with a range selector: `http_requests_total[5m]`. You cannot graph or compare it; you pass it to a function that turns it back into an instant vector (`rate`, `increase`, `avg_over_time`, `max_over_time`).
- A **scalar** is a single number.

Selectors filter by label: `http_requests_total{job="api", code=~"5.."}`. The operators are `=`, `!=`, `=~` (regex match) and `!~`. Regexes are fully anchored, so `code=~"5.."` matches `500` and not `1500`. Label matchers on a name that does not exist match nothing, they do not error, which matters for the missing-data section below.

## Counters: rate, irate and increase

A **counter** only goes up (or resets to zero on restart). Its raw value is nearly useless; what you need is how fast it grows. Use `rate`:

```promql title="requests per second, per series"
rate(http_requests_total{job="api"}[5m])
```

`rate(x[5m])` computes the per-second average increase over the last five minutes, and handles counter resets. Related functions:

| Function         | Returns                                                 | Use for                                                            |
| ---------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| `rate(x[r])`     | Per-second average increase over the range.             | Alerts and graphs. The default choice.                             |
| `irate(x[r])`    | Per-second rate from the **last two** samples in range. | Fast-moving graphs. Too jumpy for alerts.                          |
| `increase(x[r])` | Total increase over the range (`rate * seconds`).       | Human-readable "errors in the last hour". Extrapolated, not exact. |

Two rules cost people the most time:

1. **Rate first, then sum.** `sum(rate(x[5m]))` is correct: each series' reset is handled inside `rate`, then the rates are added. `rate(sum(x)[5m:])` and `sum(x)` followed by `rate` are wrong or impossible, because summing counters first hides resets from individual instances.
2. **The range must cover several scrape intervals.** `rate` needs at least two samples in the window to produce anything. A common **rule of thumb** is a range of at least four times the scrape interval: with a 15 s scrape, `[1m]` is thin and `[5m]` is comfortable. It is a heuristic, not a law: a longer range smooths noise and delays detection; a shorter one reacts faster and flaps. For alerts, pick the range together with the `for:` duration from Observability 03.

`increase` and `rate` extrapolate to the window edges, so `increase(x[1h])` can return a non-integer such as `3.2` for a counter that went up by 3. That is expected.

## Aggregation: sum by and without

Aggregation operators (`sum`, `avg`, `min`, `max`, `count`, `topk`) collapse many series into fewer. You choose which labels to keep:

```promql title="requests per second per service, dropping everything else"
sum by (service) (rate(http_requests_total[5m]))
```

```promql title="the same idea, written as the labels to drop"
sum without (instance, pod) (rate(http_requests_total[5m]))
```

- `by (a, b)` keeps only labels `a` and `b`.
- `without (a, b)` keeps all labels **except** `a` and `b`. It is safer in a recording rule, because new labels added later stay available.
- Aggregate away `instance` and `pod` for service-level alerts, so a rolling restart does not create a different series.

Useful variants: `count by (job) (up == 0)` counts failing targets per job, `topk(5, ...)` lists the heaviest series, and `max by (job) (...)` finds the worst instance of a group.

## Vector matching

A binary operator between two instant vectors (`+`, `/`, `>`) matches series **with identical label sets** by default. In real queries the two sides rarely have the same labels, so you tell PromQL how to match.

- `on (labels)` matches only on the listed labels.
- `ignoring (labels)` matches on all labels except the listed ones.
- `group_left` / `group_right` handles a many-to-one match and copies labels from the "one" side.

```promql title="error ratio per service: both sides summed to the same labels"
sum by (service) (rate(http_requests_total{code=~"5.."}[5m]))
/
sum by (service) (rate(http_requests_total[5m]))
```

When the labels already match after aggregation, no modifier is needed. When they do not, say what to match:

```promql title="ignore a label that only one side has"
sum by (service, code) (rate(http_requests_total[5m]))
/ ignoring (code) group_left
sum by (service) (rate(http_requests_total[5m]))
```

The left side has one series per `(service, code)`; the right side has one per `service`. `ignoring (code)` makes them match on `service`; `group_left` says the left side has many series per right-side series (many-to-one), so the result keeps `code` and gives you the share of each status code per service.

A very common use is **joining with an info metric** to add a label such as a team or version:

```promql title="add the team label to a rate using an info metric"
sum by (service) (rate(http_requests_total[5m]))
* on (service) group_left (team)
service_info
```

`service_info` has value `1` and a `team` label, so multiplying by it leaves the rate unchanged and copies `team` onto the result. If two series on the "one" side match the same left series, the query fails with a "many-to-many matching not allowed" error; the fix is almost always to aggregate that side so it has one series per matching key.

## Ratios and the zero denominator

An error ratio is `errors / total`. When there is no traffic, `total` is `0`, and `0 / 0` is `NaN`. A comparison with `NaN` is never true, so the alert **does not fire**, which may be what you want (no traffic, no errors) or may hide an outage (the load balancer stopped sending traffic). Decide on purpose.

```promql title="ratio that produces no series when there is no traffic"
sum by (service) (rate(http_requests_total{code=~"5.."}[5m]))
/
(sum by (service) (rate(http_requests_total[5m])) > 0)
```

Filtering the denominator with `> 0` drops the series where it is zero, so the division returns **no data** instead of `NaN`. Compare:

- The `NaN` form: the series exists, its value is not a number, and `> 0.05` is false.
- The filtered form: no series, so the alert is simply not evaluated for that service.

If "no traffic at all" should itself page you, alert separately on low or zero traffic:

```promql title="traffic dropped to zero"
sum by (service) (rate(http_requests_total[5m])) == 0
```

A second trap is a low-traffic service: one failed request out of three is a 33% error ratio. Add a minimum request rate to the condition, or alert on the ratio over a longer window ([[patterns/slo-burn-rate-alerting]] covers the multi-window approach properly and is not taught again here).

## Histograms

A classic Prometheus **histogram** exposes three kinds of series: `x_bucket{le="..."}` (cumulative counts of observations at most `le`), `x_sum` and `x_count`. To estimate a quantile:

```promql title="p99 latency per service over 5 minutes"
histogram_quantile(
  0.99,
  sum by (le, service) (rate(http_request_duration_seconds_bucket[5m]))
)
```

Rules to remember:

- **Keep `le`** in the `sum by`. The function needs the bucket boundaries; dropping `le` makes the result meaningless or an error.
- **Aggregate the bucket rates, then take the quantile.** Never average quantiles across instances (`avg(histogram_quantile(...))` is not the global quantile). Summing bucket rates across instances and then computing the quantile gives the correct fleet-wide estimate.
- The result is an **estimate**: it interpolates inside the bucket that contains the quantile. Accuracy depends on your bucket boundaries; a value of `0.9s` could be anywhere in the 0.5 to 1 bucket. Put bucket boundaries around your SLO threshold.
- For an SLO "99% under 300 ms" it is often better to compare `rate(..._bucket{le="0.3"})` with `rate(..._count)` directly, which needs no interpolation.

Prometheus also has **native histograms**, a newer, more precise representation that does not need a fixed bucket list. Their availability, how you enable them, and the query syntax differ from the classic form and depend on the Prometheus version and client library. Check the current docs before using them. The histogram practices page in the sources covers how histograms and summaries compare.

## Missing data

An alert that cannot see its data is silent, which is the worst failure of monitoring. A query on a metric that no longer exists returns an **empty result**, and an empty result never satisfies `> threshold`. Three tools handle it.

**`up == 0`.** Prometheus records `up` for every scrape target: `1` if the scrape worked, `0` if not. It detects a target that is down or unreachable:

```promql title="a target is down"
up{job="api"} == 0
```

**`absent(v)`** returns a one-element vector with value `1` if the instant vector `v` has **no** series, and nothing otherwise. It detects a metric that vanished:

```promql title="no series at all for this job"
absent(up{job="api"})
```

`absent` takes labels from equality matchers in the selector, so write the selector with exact matchers if you want those labels on the alert.

**`absent_over_time(v[range])`** is the same idea for a range: it fires if there was no sample at all in the window. It tolerates a short gap that `absent` would report:

```promql title="no samples for 10 minutes"
absent_over_time(http_requests_total{job="api"}[10m])
```

A practical rule: alert on `up == 0` for "the target is down", on `absent`/`absent_over_time` for "the whole job disappeared" (a deleted deployment, a broken service discovery), and make sure every important alert has a partner that notices when its input is missing. A "dead man's switch" alert that always fires and is watched externally covers Prometheus itself being down ([[learn/first-prometheus-alert]] covers routing).

## predict_linear

`predict_linear(v[range], t)` fits a straight line through the samples in the range and extrapolates `t` seconds ahead. It is the standard way to alert on a disk that will fill:

```promql title="disk will be full in 4 hours at the current rate"
predict_linear(node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"}[6h], 4 * 3600) < 0
```

Read it as: "if the last six hours' trend continues, free space will be below zero in four hours". Cautions: a linear fit is wrong for spiky or cyclical usage (a nightly backup makes a sawtooth), so use a long window, add a minimum usage condition (`and node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.4`) to avoid alerts on mostly empty disks, and treat it as an early warning with a lower severity than "disk 95% full". For gauges only: do not use it on counters.

## Recording rules

A **recording rule** evaluates an expression on a schedule and stores the result as a new series. Two reasons to use one:

1. **Cost.** A dashboard or alert that evaluates `sum by (service) (rate(...[5m]))` over thousands of series every few seconds is slow. Computing it once per minute in a rule makes the heavy work happen once.
2. **Reuse and clarity.** One definition of "request rate per service" that every alert and dashboard uses, instead of five copies that drift.

```yaml title="rules/api-recording.yml"
groups:
  - name: api-recording
    interval: 1m
    rules:
      - record: service:http_requests:rate5m
        expr: sum by (service) (rate(http_requests_total[5m]))

      - record: service:http_errors:rate5m
        expr: sum by (service) (rate(http_requests_total{code=~"5.."}[5m]))

      - record: service:http_error_ratio:rate5m
        expr: |
          service:http_errors:rate5m
          /
          (service:http_requests:rate5m > 0)
```

Notes on the file:

- Rules in a **group** run sequentially, in order, at the group's interval, so a later rule in the same group can use an earlier one's result from the same evaluation. Rules in different groups run independently and can run in parallel.
- The **naming convention** is `level:metric:operations`. `level` is the aggregation level, i.e. the labels the series is kept by (`service`); `metric` is the base metric name (`http_requests`); `operations` lists the functions applied, newest first (`rate5m`). Counters lose the `_total` suffix after `rate`. The convention (from the Prometheus rules best practices) tells readers at a glance what a series is.
- Use `without` or `by` consistently so a recorded series does not lose labels the alert needs.

Then alert on the recorded series. The alert is short and readable:

```yaml title="rules/api-alerts.yml"
groups:
  - name: api-alerts
    rules:
      - alert: ApiHighErrorRatio
        expr: service:http_error_ratio:rate5m > 0.05
        for: 10m
        labels:
          severity: page
        annotations:
          summary: "{{ $labels.service }}: error ratio {{ $value | humanizePercentage }}"
```

The cost: a recorded series is only as fresh as its evaluation interval, and an alert on top of it inherits the delay. Keep recording and alerting rules in separate groups so a slow recording group does not hold the alert up, and remember that a recording rule that produces no data (because its input is missing) produces no series, so the missing-data alerts should watch the input metric as well, not only the recorded one.

Check the files with `promtool check rules rules/*.yml`, as in Observability 03.

## Testing recording rules

`promtool test rules` can unit-test recording rules as well as alerts, with the `promql_expr_test` block. Observability 03 explains the test file and `input_series` notation, and they are not repeated here: this section adds what is specific to expressions.

```yaml title="tests/api-recording_test.yml"
rule_files:
  - ../rules/api-recording.yml

evaluation_interval: 1m

tests:
  - interval: 1m
    input_series:
      - series: 'http_requests_total{service="shop", code="200", instance="a"}'
        values: "0+54x30" # +54 per minute = 0.9 per second
      - series: 'http_requests_total{service="shop", code="500", instance="a"}'
        values: "0+6x30" # +6 per minute = 0.1 per second

    promql_expr_test:
      - expr: service:http_requests:rate5m
        eval_time: 10m
        exp_samples:
          - labels: 'service:http_requests:rate5m{service="shop"}'
            value: 1

      - expr: service:http_error_ratio:rate5m
        eval_time: 10m
        exp_samples:
          - labels: 'service:http_error_ratio:rate5m{service="shop"}'
            value: 0.1
```

```bash title="run the tests"
promtool check rules rules/api-recording.yml rules/api-alerts.yml
promtool test rules tests/api-recording_test.yml
```

```text
Unit Testing:  tests/api-recording_test.yml
  SUCCESS
```

_Illustrative._

The input is `0+54x30`: start at 0, add 54 each interval, 30 times. Total request rate is `0.9 + 0.1 = 1` per second, the error rate is `0.1`, and the ratio is `0.1`. Choosing round numbers makes the expected values easy to check by hand, which is the point of a test. Add a case with zero traffic and expect no samples (`exp_samples: []`) to prove that the `> 0` guard works.

## Hands-on exercises

You need Prometheus (Docker is enough) and `promtool`. Exercises 1 to 5 use `promtool test rules` with synthetic series, so you do not need a live target; exercises 6 and 7 use a running Prometheus. All output is illustrative.

1. **Set up a workspace and a test harness.**

   ```bash
   mkdir -p ~/promql-lab/{rules,tests} && cd ~/promql-lab
   promtool --version | head -1
   ```

   Expected: a `promtool` version line.
   If you see something else: install it as in Observability 03 (distribution package or the upstream release archive).

2. **Rate over a counter, with the wrong and right sum.** Create `rules/api-recording.yml` from the recording rules section and `tests/api-recording_test.yml` from the test section. Run:

   ```bash
   promtool check rules rules/api-recording.yml
   promtool test rules tests/api-recording_test.yml
   ```

   Expected: `SUCCESS`.
   If you see something else: a "rule_files" path error means the path is relative to the test file. A value mismatch prints expected and got values; check the arithmetic of `0+54x30`.

3. **Break the test on purpose and read the diff.** Change an expected value from `0.1` to `0.2`, rerun, then restore it.
   Expected: `FAILED` with `exp:` and `got:` sample lists.
   If you see something else: if it passes, you edited the wrong sample or the file under a different path.

4. **Test the zero-denominator guard.** Add a second test with `input_series` that is all zeros (`values: '0+0x30'`) for both series, and expect no samples for the ratio:

   ```yaml
   promql_expr_test:
     - expr: service:http_error_ratio:rate5m
       eval_time: 10m
       exp_samples: []
   ```

   Expected: `SUCCESS`.
   If you see something else: if you get a `NaN` sample, the `> 0` filter is missing or in the wrong place.

5. **Test a reset.** Use values `'0 60 120 0 60 120'` for a counter series and test `increase`/`rate` at a time after the reset.
   Expected: `rate` reports a sensible positive value and does not go negative, because it handles the reset.
   If you see something else: if your arithmetic disagrees with the output, remember extrapolation to the window edges; use a longer series or a window that matches the sample spacing.

6. **Run a query against a real target.** Start Prometheus scraping itself and run, in the expression browser at `http://127.0.0.1:9090`:

   ```promql
   sum by (job) (rate(prometheus_http_requests_total[5m]))
   ```

   Expected: one series per job with a small positive value.
   If you see something else: "no data" in the first minutes is normal: the range needs at least two samples. Wait for a few scrape intervals.

7. **Practise missing data.** Add a scrape target that does not exist (for example `127.0.0.1:9999`) in a job named `ghost`, reload, and run:

   ```promql
   up{job="ghost"} == 0
   absent(up{job="nope"})
   count by (job) (up == 0)
   ```

   Expected: the first returns the dead target, the second returns `1` (no series with that job), the third lists `ghost`.
   If you see something else: if `absent` returns nothing, a series with that exact label exists; use a job name you never configured.

8. **Compute a histogram quantile.** Query a histogram your Prometheus exposes, such as `prometheus_http_request_duration_seconds_bucket`:

   ```promql
   histogram_quantile(0.99, sum by (le, handler) (rate(prometheus_http_request_duration_seconds_bucket[5m])))
   ```

   Then remove `le` from the `by` clause.
   Expected: the first returns a latency per handler; the second returns nothing useful or an error, which shows why `le` must stay.
   If you see something else: if no series exist for the metric name in your version, list histograms with `{__name__=~".*_bucket"}`.

9. **Predict a disk.** On a host with `node_exporter`, run the `predict_linear` query with a one-hour range and `1 * 3600`; then with a six-hour range.
   Expected: results differ with the window, which shows how sensitive the fit is to the range.
   If you see something else: without `node_exporter` the metrics do not exist; use any gauge that trends, for example `prometheus_tsdb_storage_blocks_bytes`.

10. **Write the alert on the recorded series and test it.** Add `rules/api-alerts.yml` and extend the test with an `alert_rule_test` that expects `ApiHighErrorRatio` to fire at 20 minutes with a 10% error ratio and not at 5 minutes (the `for: 10m` still pending). The alert test format is in Observability 03.
    Expected: `SUCCESS`.
    If you see something else: if the alert never fires in the test, the recording rule group must be evaluated before the alert; the test's `evaluation_interval` must be small enough that the recorded series exists at the time you test.

Clean up: `rm -rf ~/promql-lab`, and stop the Prometheus container if you started one.

## Common mistakes

- **Using a counter's raw value.** Why it bites: it only grows and resets on restart. Fix: `rate` or `increase`.
- **Summing before `rate`.** Why it bites: it hides counter resets of individual instances. Fix: `sum(rate(x[5m]))`.
- **A range shorter than the scrape interval allows.** Why it bites: `rate` returns nothing with fewer than two samples. Fix: a range of several scrape intervals, as a rule of thumb at least four.
- **`irate` in alerts.** Why it bites: it reacts to two samples and flaps. Fix: `rate` with a sensible window.
- **Dividing without handling zero.** Why it bites: `NaN` makes the alert silent when traffic stops, or an unmatched side makes the whole query empty. Fix: filter the denominator and alert separately on traffic dropping.
- **Mismatched labels in a ratio.** Why it bites: the division returns nothing because the label sets differ. Fix: aggregate both sides to the same labels, or use `on`/`ignoring`.
- **Many-to-many matching.** Why it bites: the query errors. Fix: aggregate the "one" side to one series per key and use `group_left`.
- **Dropping `le` or averaging quantiles.** Why it bites: the quantile is meaningless. Fix: `sum by (le, ...) (rate(..._bucket[5m]))`, then `histogram_quantile`.
- **No alert for missing data.** Why it bites: a vanished metric gives an empty result and the alert never fires. Fix: `up == 0`, `absent` and `absent_over_time` partners.
- **`predict_linear` on spiky data.** Why it bites: false positives at every backup. Fix: a long window, a usage condition, and lower severity.
- **Recording rules with inconsistent names or lost labels.** Why it bites: nobody can tell what a series is, and alerts lose the labels they need. Fix: `level:metric:operations`, and `without` where you can.
- **Alerting on a recording rule without watching its input.** Why it bites: if the input metric disappears the recorded series disappears too. Fix: a missing-data alert on the source.

## Check your understanding

1. Why is `sum(rate(x[5m]))` correct while a `rate` of a summed counter is not?
2. A service has a scrape interval of 30 seconds. Is `rate(x[1m])` a good choice for an alert, and why?
3. An error ratio alert never fires during a total outage where the load balancer sends no traffic. What is happening and how do you cover it?
4. Why must `le` be kept in the aggregation of a `histogram_quantile`?
5. What is the difference between `absent(v)` and `up == 0`?
6. Which parts does the recording rule name `service:http_error_ratio:rate5m` encode?

> [!question]- Answers
>
> 1. `rate` handles resets within each series. Summing counters first merges series so a reset in one instance looks like a drop in the sum, which breaks the calculation. Rate first, then aggregate.
> 2. Probably not: a one-minute range holds only about two samples, and any missed scrape leaves fewer than two, so the result is empty or unstable. A rule of thumb is a range of several scrape intervals, for example 2 to 5 minutes.
> 3. The denominator is zero, the ratio is `NaN`, and `NaN > 0.05` is false, so the alert stays silent. Filter the denominator with `> 0` on purpose, and add a separate alert on traffic dropping to zero or on the target being down.
> 4. `histogram_quantile` uses the bucket boundaries in the `le` label to interpolate the quantile. Without them it cannot work, and aggregating without `le` mixes buckets.
> 5. `up == 0` finds a target that exists but whose last scrape failed. `absent(v)` returns a value only when the vector has no series at all, which detects a metric or a whole job that vanished.
> 6. The level (`service`, the labels it is kept by), the base metric (`http_error_ratio`) and the operations applied (`rate5m`).

## Next steps

Next lesson: [[learn/slis-slos-and-error-budgets|Observability 05: SLIs, SLOs and error budgets]], which ends in burn-rate alerting (see also [[patterns/slo-burn-rate-alerting]]). If you have not done it, do [[learn/on-call-incidents-and-postmortems|Incidents 02: Your first on-call shift, incidents and blameless postmortems]] too. Previous lessons: [[learn/first-prometheus-alert|Observability 03]] for alert rules and [[learn/observability-signals-and-dashboards|Observability 01]] for the signals. For hosts, the saturation signals you can alert on come from [[learn/linux-performance-triage-with-mpstat-pidstat-sar-and-psi|Linux 06]], including pressure stall information.

To go deeper:

- [[patterns/slo-burn-rate-alerting]] for multi-window burn-rate alerts, which this lesson only links.
- [[standards/error-budget-policy]] for what to do when the budget is spent.
- [[tools/prometheus-vs-cloud-monitoring]] for self-managed Prometheus and managed alternatives, which may support only part of PromQL.
- [[learn/on-call-incidents-and-postmortems]] for how an alert becomes an incident.

## Sources

- Prometheus documentation, "Querying basics" (https://prometheus.io/docs/prometheus/latest/querying/basics/), for selectors, instant and range vectors and matchers.
- Prometheus documentation, "Querying functions" (https://prometheus.io/docs/prometheus/latest/querying/functions/), for `rate`, `irate`, `increase`, `histogram_quantile`, `absent`, `absent_over_time` and `predict_linear`.
- Prometheus documentation, "Querying operators" (https://prometheus.io/docs/prometheus/latest/querying/operators/), for aggregation and vector matching with `on`, `ignoring` and `group_left`.
- Prometheus documentation, "Defining recording rules" (https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/) and "Recording rules" best practices (https://prometheus.io/docs/practices/rules/), for groups and the `level:metric:operations` naming.
- Prometheus documentation, "Histograms and summaries" (https://prometheus.io/docs/practices/histograms/), for quantile accuracy and bucket choice.
- Prometheus documentation, "Unit testing for rules" (https://prometheus.io/docs/prometheus/latest/configuration/unit_testing_rules/), for `promql_expr_test` and `input_series`.
- Not verified: all query results and test output (illustrative), the behaviour of native histograms and their syntax on your version, the exact empty-result and `NaN` behaviour on every version, and which functions a managed Prometheus service supports. Check the current docs.
