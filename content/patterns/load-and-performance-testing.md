---
title: Load and performance testing for services
description: Plan and run smoke, load, stress, soak and spike tests with k6 or Locust, set SLO-based pass criteria and turn the results into a documented capacity limit.
type: pattern
tags:
  - patterns
  - reliability
  - observability
  - kubernetes
  - delivery
created: 2026-10-17
modified: 2026-10-17
draft: false
---

A claim such as "this service handles 2,000 requests per second" is worth nothing until someone has produced the evidence. Production readiness reviews ask for capacity numbers, autoscaling needs a known per-pod limit to be set sensibly, and an incident review often ends with "we did not know where it would break". This note shows how to plan and run load tests, judge them against SLO-based pass criteria, and write down a capacity limit that a reviewer can check. It is for engineers who run services on GKE and have to defend a capacity number.

Autoscaling configuration is out of scope; see [[kubernetes-autoscaling]]. This note produces the numbers that configuration needs. Where the evidence goes in a review is in [[production-readiness-review]]. How the service should behave when it is overloaded is in [[timeouts-retries-load-shedding]]. Setting requests and limits from measured use is in [[kubernetes-resource-requests-and-limits]].

> [!info] Scope and assumptions
> HTTP services on GKE in front of Cloudflare, tested with k6 (primary) or Locust (alternative). Hostnames use `example.com`; the load generator address uses the documentation range `198.51.100.0/24`. Rates, durations and thresholds in the examples are illustrations to replace with your own.

> [!note] Not verified
> Written from knowledge of the tools, not run in this batch. Check before relying on it: the current k6 executor names and options (`ramping-arrival-rate`, `constant-arrival-rate`), the k6 output name and environment variables for Prometheus remote write (`experimental-prometheus-rw` in current versions, not verified; it may be renamed or promoted), the Prometheus flag that enables the remote write receiver, the Locust options, and whether the Google SRE Workbook has a chapter on load testing (this note does not cite one).

## Workload model from production traffic

A load test is only as good as its model of the traffic. Build the model from production data, not from guesses.

1. **Pick the window.** Use the busiest realistic hour from the last month, not the average and not the single highest spike. Note the date, and why it is representative.
2. **Measure the rate.** Requests per second at the edge or ingress (the load balancer or Cloudflare analytics), per endpoint group. Record the peak and the p50.
3. **Measure the mix.** The share of each endpoint group: reads versus writes, cheap versus expensive, cached versus uncached. A test that hits only `GET /health` proves nothing.
4. **Measure the shape.** Steady, diurnal, bursty (marketing mails, batch jobs, a retry storm after an outage). The shape decides which test types you need.
5. **Measure concurrency and think time.** Concurrent users or connections and the pause between requests. By Little's law, in-flight requests equal arrival rate times latency, so a service at 500 requests per second with 200 ms latency holds about 100 requests in flight.
6. **Add growth.** Multiply by the growth you must survive until the next review (a traffic forecast from product, for example) and by the peak events that are known.
7. **Open versus closed model.** A **closed** model has a fixed number of users who each wait for a response before the next request, so a slow service gets less load. An **open** model fixes the arrival rate of requests, as real internet traffic does, so a slow service gets a growing queue. Use the open model (arrival-rate executors) to find the breaking point; a closed model hides overload because it backs off as the service slows.

Write the model down as a small table in the test repository, with its source and date:

| Endpoint group        | Share of requests | Peak rate (illustrative) | Notes                                |
| --------------------- | ----------------- | ------------------------ | ------------------------------------ |
| `GET /api/items`      | 60%               | 600 per second           | Cacheable at the edge for 30 seconds |
| `GET /api/items/{id}` | 25%               | 250 per second           | Cache hit ratio about half           |
| `POST /api/orders`    | 10%               | 100 per second           | Writes to the database               |
| `GET /api/search`     | 5%                | 50 per second            | Expensive, bypasses the cache        |

Take the cache into account. If Cloudflare caches responses (see [[cloudflare-cache-strategy]]), a test through the edge measures the CDN. Decide what you want to measure: test the origin by calling the load balancer directly (with the edge rules in mind, see Guardrails), and test the full path separately to check the edge configuration.

## Pass criteria as SLO thresholds

Decide what "pass" means before you run, and take it from the SLO, not from the result you hoped for. If the SLO is "99.9% of requests succeed and 95% are faster than 300 ms", the test thresholds are the same numbers, measured over the test window. See [[slo-burn-rate-alerting]] for how the SLIs are defined and [[error-budget-policy]] for what happens when they are missed.

| Criterion      | Example threshold                                         | Source                                          |
| -------------- | --------------------------------------------------------- | ----------------------------------------------- |
| Latency        | p95 below 300 ms, p99 below 800 ms                        | Latency SLO of the service                      |
| Errors         | Failed requests below 1%                                  | Availability SLO, with a margin                 |
| Saturation     | Node and pod CPU below an agreed share; no memory growth  | Capacity policy                                 |
| Dependencies   | Database connections below pool limit, queue depth stable | Dependency limits                               |
| Load generator | No dropped iterations                                     | A test that cannot generate the load is invalid |

Rules:

- **Fail the run automatically.** Thresholds in the tool turn a test into a gate that returns a non-zero exit code, so it can run in CI (see the pipeline example below).
- **Use percentiles, never averages.** An average of 100 ms can hide a p99 of five seconds.
- **Check the generator.** If the load generator is the bottleneck (CPU saturated, dropped iterations), the result describes the generator. Watch its CPU and the `dropped_iterations` metric.
- **Pass criteria in the repository.** Changing a threshold is a reviewed change, like changing an SLO.

## Environment and data parity

A test in a smaller or different environment gives numbers for that environment. Be explicit about the gaps.

| Aspect            | What to match                                                    | What to do if you cannot                                                               |
| ----------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Compute           | Machine types, pod requests and limits, JVM or runtime flags     | State the difference; do not extrapolate across machine types                          |
| Replicas          | Fix the replica count for capacity tests; disable the autoscaler | Measure per-pod capacity and scale linearly only as an estimate, then confirm at scale |
| Data volume       | Table sizes, index sizes, cache size close to production         | Load a realistic data set; an empty database is far faster                             |
| Data distribution | Hot keys, tenant sizes                                           | Replay real distributions (anonymised)                                                 |
| Dependencies      | Real database, real cache; third-party APIs stubbed              | Stub external services with realistic latency                                          |
| Network path      | Same load balancer, ingress and mesh as production               | Include the path you need to measure                                                   |
| Configuration     | Same chart values, feature flags, connection pool sizes          | Diff the values against production                                                     |
| Noisy neighbours  | Dedicated or lightly loaded node pool                            | Note it; repeat the test to see the spread                                             |

Practical points on GKE:

- Run the system under test in a **staging cluster built from the same Terraform and Helm values** as production, with scaled-down capacity only where you can state the scaling rule.
- Run the load generator **outside** the nodes under test, in a separate node pool or cluster in the same region, so it neither steals CPU nor skews the network path. For a Kubernetes-native runner, the k6 Operator exists (check its current status and version).
- Warm up. Caches, JIT compilers and connection pools need minutes to reach steady state; exclude the warm-up from the result.
- A database connection limit is a common first bottleneck. See [[postgres-connection-pooling-gke]] and [[postgres-expand-contract-migrations]] if schema changes are involved.
- Reset state between runs, or compare runs from the same starting state.

## Test matrix

Different questions need different tests. Keep this table in the repository and run the right row at the right moment.

| Test       | Question it answers                                 | Load shape                                                 | Typical length     | When to run                                                     |
| ---------- | --------------------------------------------------- | ---------------------------------------------------------- | ------------------ | --------------------------------------------------------------- |
| Smoke      | Does the script and the service work at all?        | Minimal load (1 to 2 users or a trickle of requests)       | 1 to 2 minutes     | Every merge request, after every deploy to stage                |
| Load       | Does it meet the SLO at expected peak?              | Ramp to expected peak and hold                             | 15 to 30 minutes   | Before release of a risky change; monthly or per quarter        |
| Stress     | Where does it break, and how?                       | Ramp past the peak in steps until the SLO fails            | Until failure      | Before capacity planning; production readiness review           |
| Soak       | Does it leak memory, connections or disk over time? | Steady moderate load (for example 60 to 70% of peak)       | Hours, up to a day | Before a major release; after dependency upgrades               |
| Spike      | Does it survive a sudden jump and recover?          | Jump to a multiple of the peak for a short time, then back | 10 to 20 minutes   | Before an event; to check load shedding and autoscaler reaction |
| Breakpoint | What is the maximum rate at the SLO?                | Continuous ramp until a threshold aborts the run           | Until failure      | To produce the capacity number                                  |

The durations are common practice, not rules; choose what shows the behaviour you care about. The stress and spike tests are where the behaviour in [[timeouts-retries-load-shedding]] is verified: whether the service sheds load, returns clean 429 or 503 responses and recovers, or whether it collapses and stays down.

## Running and observing

### A k6 script

The script below uses the `ramping-arrival-rate` executor (an open model) and encodes the pass criteria as thresholds. The profile is chosen by an environment variable so one file covers the matrix. Secrets come from the environment and never from the file.

```javascript title="loadtest/service.js"
import http from "k6/http"
import { check } from "k6"

// CHANGE: BASE_URL points at the system under test, never at an unprepared production.
const BASE_URL = __ENV.BASE_URL || "https://stage.example.com"
// CHANGE: the token must be a dedicated test credential, injected by the pipeline.
const TOKEN = __ENV.TEST_TOKEN || ""
// CHANGE: PEAK_RPS comes from your workload model.
const PEAK_RPS = Number(__ENV.PEAK_RPS || 100)
const PROFILE = __ENV.PROFILE || "smoke"

const profiles = {
  smoke: {
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs: 5,
    maxVUs: 20,
    stages: [{ target: 2, duration: "1m" }],
  },
  load: {
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs: 50,
    maxVUs: 500,
    stages: [
      { target: PEAK_RPS, duration: "5m" }, // ramp up, discard from analysis
      { target: PEAK_RPS, duration: "20m" }, // hold at expected peak
      { target: 0, duration: "2m" },
    ],
  },
  stress: {
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs: 100,
    maxVUs: 2000,
    stages: [
      { target: PEAK_RPS, duration: "5m" },
      { target: PEAK_RPS * 1.5, duration: "5m" },
      { target: PEAK_RPS * 2, duration: "5m" },
      { target: PEAK_RPS * 3, duration: "5m" },
      { target: 0, duration: "2m" },
    ],
  },
  soak: {
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs: 50,
    maxVUs: 500,
    stages: [
      { target: PEAK_RPS * 0.6, duration: "10m" },
      { target: PEAK_RPS * 0.6, duration: "4h" },
      { target: 0, duration: "5m" },
    ],
  },
  spike: {
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs: 100,
    maxVUs: 2000,
    stages: [
      { target: PEAK_RPS * 0.5, duration: "5m" },
      { target: PEAK_RPS * 3, duration: "30s" },
      { target: PEAK_RPS * 3, duration: "3m" },
      { target: PEAK_RPS * 0.5, duration: "30s" },
      { target: PEAK_RPS * 0.5, duration: "5m" }, // recovery: latency must return to normal
    ],
  },
}

export const options = {
  scenarios: {
    traffic: {
      executor: "ramping-arrival-rate",
      ...profiles[PROFILE],
    },
  },
  thresholds: {
    // Pass criteria taken from the SLO.
    http_req_duration: [
      { threshold: "p(95)<300", abortOnFail: true, delayAbortEval: "1m" },
      "p(99)<800",
    ],
    http_req_failed: [{ threshold: "rate<0.01", abortOnFail: true, delayAbortEval: "1m" }],
    // The generator itself must keep up; otherwise the run is invalid.
    dropped_iterations: ["count<1"],
    checks: ["rate>0.99"],
  },
  // Tag the run so dashboards can separate it from real traffic.
  tags: { testid: __ENV.TEST_ID || "local", profile: PROFILE },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
}

// Headers sent with every request. The User-Agent lets the edge and the logs recognise test traffic.
function params(name, extraHeaders) {
  return {
    headers: Object.assign(
      {
        Authorization: `Bearer ${TOKEN}`,
        "User-Agent": "loadtest/1.0",
        "X-Load-Test": __ENV.TEST_ID || "local",
      },
      extraHeaders || {},
    ),
    tags: { name },
  }
}

// Request mix from the workload model, as cumulative weights.
const mix = [
  { weight: 0.6, run: () => http.get(`${BASE_URL}/api/items`, params("list_items")) },
  {
    weight: 0.85,
    run: () =>
      http.get(`${BASE_URL}/api/items/${1 + Math.floor(Math.random() * 1000)}`, params("get_item")),
  },
  {
    weight: 0.95,
    run: () =>
      http.post(
        `${BASE_URL}/api/orders`,
        JSON.stringify({ itemId: 1, quantity: 1 }),
        params("create_order", { "Content-Type": "application/json" }),
      ),
  },
  { weight: 1.0, run: () => http.get(`${BASE_URL}/api/search?q=test`, params("search")) },
]

export function setup() {
  // Refuse to run against anything that is not a stage host unless explicitly allowed.
  if (BASE_URL.indexOf("stage.") === -1 && __ENV.ALLOW_NON_STAGE !== "yes") {
    throw new Error("Refusing to run against a non-stage host. See the production guardrails.")
  }
}

export default function () {
  const r = Math.random()
  const pick = mix.find((m) => r <= m.weight)
  const res = pick.run()
  check(res, { "status is 2xx": (x) => x.status >= 200 && x.status < 300 })
}
```

Run it:

```bash
BASE_URL=https://stage.example.com
PEAK_RPS=100
export TEST_TOKEN   # injected by the pipeline from the secret store, never typed here

k6 run -e BASE_URL="$BASE_URL" -e PEAK_RPS="$PEAK_RPS" -e PROFILE=smoke    loadtest/service.js
k6 run -e BASE_URL="$BASE_URL" -e PEAK_RPS="$PEAK_RPS" -e PROFILE=load \
  -e TEST_ID="$(date +%Y%m%d-%H%M)" loadtest/service.js
echo "exit code: $?"   # non-zero when a threshold fails
```

Test the `preAllocatedVUs` and `maxVUs` values: if k6 needs more virtual users than `maxVUs` to keep the arrival rate, it reports dropped iterations and the threshold above fails, which is what you want. Put `maxVUs` high enough that the target rate is reachable when the service is slow.

### Output to Prometheus

Send test metrics to the same Prometheus and Grafana you use for the service, so you see load generator and service metrics on one time axis. In current k6 versions the output is `experimental-prometheus-rw` and it needs the remote write receiver enabled on Prometheus (not verified for your versions).

```bash
# Prometheus must run with the remote write receiver enabled (a startup flag, check your version).
export K6_PROMETHEUS_RW_SERVER_URL=https://prometheus.stage.example.com/api/v1/write
export K6_PROMETHEUS_RW_TREND_STATS="p(95),p(99),avg,max"
k6 run -o experimental-prometheus-rw -e PROFILE=load -e TEST_ID=run-42 loadtest/service.js
```

In the dashboard show, on one screen:

- **Load generator:** requests per second, `k6_http_req_duration` percentiles, failed rate, `k6_dropped_iterations_total` (metric names depend on the output version).
- **Service:** request rate, error rate and latency percentiles by the service's own metrics, so you can compare the client view with the server view (the difference is network and queuing).
- **Saturation:** CPU and memory per pod against requests and limits, CPU throttling, restarts, HPA replica count.
- **Dependencies:** database connections, query time, cache hit ratio, queue depth.
- **Nodes:** if pods look healthy but latency is high, check the node, see [[node-resource-pressure-triage]].

Mark the start and end of the test on the dashboards (an annotation, or the `testid` label), so a reviewer can find the window later.

### A Locust alternative

Locust is Python-based and a good fit when scenarios need real logic. It runs a **closed** model by default (a number of users), so set up the arrival rate with care: use `constant_throughput` per user, or a custom load shape, and watch the achieved rate.

```python title="loadtest/locustfile.py"
import os
import random

from locust import HttpUser, LoadTestShape, constant_throughput, task

# CHANGE: the token is a dedicated test credential from the pipeline.
TOKEN = os.environ.get("TEST_TOKEN", "")
PEAK_USERS = int(os.environ.get("PEAK_USERS", "200"))


class ApiUser(HttpUser):
    # Each simulated user aims for about 1 request per second.
    wait_time = constant_throughput(1)

    def on_start(self):
        self.client.headers.update(
            {"Authorization": f"Bearer {TOKEN}", "User-Agent": "loadtest/1.0"}
        )

    @task(60)
    def list_items(self):
        self.client.get("/api/items", name="list_items")

    @task(25)
    def get_item(self):
        self.client.get(f"/api/items/{random.randint(1, 1000)}", name="get_item")

    @task(10)
    def create_order(self):
        with self.client.post(
            "/api/orders", json={"itemId": 1, "quantity": 1}, name="create_order", catch_response=True
        ) as resp:
            if resp.status_code >= 300:
                resp.failure(f"unexpected status {resp.status_code}")

    @task(5)
    def search(self):
        self.client.get("/api/search", params={"q": "test"}, name="search")


class StepShape(LoadTestShape):
    """Ramp in steps and stop at the end, so the run can be repeated."""

    step_time = 300  # seconds per step
    steps = [0.25, 0.5, 0.75, 1.0, 1.5]

    def tick(self):
        run_time = self.get_run_time()
        index = int(run_time // self.step_time)
        if index >= len(self.steps):
            return None
        users = max(1, int(PEAK_USERS * self.steps[index]))
        return users, max(1, users // 10)
```

```bash
HOST=https://stage.example.com
export TEST_TOKEN   # injected by the pipeline
locust -f loadtest/locustfile.py --headless --host "$HOST" \
  --csv results/run-42 --html results/run-42.html --only-summary
```

Locust does not enforce thresholds by itself. Add a post-run check on the CSV (failure ratio, p95) or use its `quitting` event to set a non-zero exit code when the SLO is missed (check the current event API). With the shape class, `--users` and `--run-time` are controlled by the shape.

### A CI job

Run the smoke test on every merge to the stage branch, and the load test on a schedule or on demand. Keep the load test out of merge request pipelines to protect shared environments.

```yaml title=".gitlab-ci.yml"
loadtest-smoke:
  stage: verify
  image:
    name: grafana/k6:latest # CHANGE: pin a version and mirror it in Artifactory
    entrypoint: [""] # the image's entrypoint is k6; GitLab needs a shell
  rules:
    - if: '$CI_COMMIT_BRANCH == "stage"'
  variables:
    BASE_URL: "https://stage.example.com"
    PROFILE: "smoke"
  script:
    - k6 run -e BASE_URL="$BASE_URL" -e PROFILE="$PROFILE" loadtest/service.js
  # TEST_TOKEN is a masked, protected CI/CD variable scoped to the stage environment.

loadtest-load:
  stage: verify
  image:
    name: grafana/k6:latest # CHANGE: pin a version and mirror it in Artifactory
    entrypoint: [""] # the image's entrypoint is k6; GitLab needs a shell
  rules:
    - if: '$CI_PIPELINE_SOURCE == "schedule" && $LOADTEST == "true"'
      when: always
    - if: '$CI_COMMIT_BRANCH == "stage"'
      when: manual
  variables:
    BASE_URL: "https://stage.example.com"
    PROFILE: "load"
    PEAK_RPS: "100"
  script:
    - k6 run -e BASE_URL="$BASE_URL" -e PROFILE="$PROFILE" -e PEAK_RPS="$PEAK_RPS" -e TEST_ID="$CI_PIPELINE_ID" loadtest/service.js
  timeout: 2h
```

Do not use `latest` for the image in a real pipeline: pin a version and pull it through your registry proxy, as in [[artifact-promotion-artifactory]]. See [[gitlab-ci-pipeline-structure]] for where such a stage fits.

### Reading the results

- Find the **knee**: the rate at which latency starts to rise sharply while throughput stops growing. Past the knee, extra load turns into queuing and errors.
- Identify the **first saturated resource**: CPU, memory, a database connection pool, a thread pool, a lock, a downstream rate limit, file descriptors, conntrack or the load balancer. The bottleneck is whatever saturates first. Use the USE method from [[node-resource-pressure-triage]] on the nodes and the metrics above on the pods.
- Look at the **failure mode**: does error rate rise smoothly, do requests time out, does the service crash and restart, does it recover after the load stops? A clean degradation with 429 or 503 is a good result; a crash loop is a finding.
- Repeat the passing run at least once. Variance between runs of the same test tells you how much a result can be trusted; if two runs differ by 20%, a claim of 5% headroom is noise.
- Change one thing at a time between runs, and write down what changed.

## Capacity report

The result of the work is a short report that a reviewer can read in five minutes. Keep it in the service repository (or link it from the production readiness review) and refresh it when something material changes: a new major version, a different machine type, a changed dependency or after a year.

```markdown title="docs/capacity-report.md"
# Capacity report: [service name]

Date: [YYYY-MM-DD]
Author: [name or role]
Commit / image: [git SHA or image digest]
Environment: [cluster, node pool machine type, replica count, requests and limits]
Test tool and profile: [k6 version, script path, profile]
Dashboard / raw results: [link]

## Result

| Item                         | Value                                 |
| ---------------------------- | ------------------------------------- |
| Pass criteria                | p95 < 300 ms, errors < 1% (from SLO)  |
| Max sustained RPS at the SLO | [N per second, whole service]         |
| Per-pod capacity             | [N per second at replicas = R]        |
| Expected peak (today)        | [N per second, source and date]       |
| Forecast peak at [date]      | [N per second, source]                |
| Headroom at expected peak    | [(max - peak) / max, as a percentage] |
| Required headroom (policy)   | [percentage, source of the policy]    |

## Bottleneck

[The first saturated resource, with graph links. Example: database connection pool
at N connections; CPU of pods at N% with throttling; downstream API limit.]

## Failure mode at overload

[What happens past the limit: shed load with 503, queue, crash and restart.
Time to recover after the load stops.]

## Soak result

[Duration, memory and connection trends, restarts.]

## Spike result

[Peak multiple tested, effect on SLO, recovery time, autoscaler reaction time.]

## Actions

| Action                                   | Owner  | Due        |
| ---------------------------------------- | ------ | ---------- |
| [Raise the pool size, add an index, ...] | [role] | YYYY-MM-DD |

## Caveats

[Differences from production: data size, machine types, stubs, cache state.
What was not tested.]

## Next test

[Date or trigger: next release, forecast crossing X, dependency upgrade.]
```

How to use the numbers:

- **Headroom** is `(max RPS at SLO - expected peak) / max RPS at SLO`. The required headroom is a team or company policy (it depends on forecast uncertainty and how quickly you can add capacity); this note does not recommend a number.
- **Autoscaler settings** come from per-pod capacity and the spike result: the target utilisation, minimum replicas and how quickly new pods become ready. The configuration itself is in [[kubernetes-autoscaling]].
- **Requests and limits** come from the resource use at the load level you want to carry, see [[kubernetes-resource-requests-and-limits]].
- **Alert thresholds** on saturation should fire well before the knee.

## Replaying production traffic

Replaying real traffic gives a realistic mix, but a log holds personal data and credentials. Replay only after the sensitive fields are removed, and only into environments that are allowed to hold what remains.

Rules:

1. **Take only what you need:** method, path template, a safe subset of query parameters, status class and body size. Drop everything else.
2. **Remove or replace:** `Authorization` and cookie headers, tokens and API keys in query strings, email addresses, names, phone numbers, account numbers, IP addresses, free-text fields, and any request bodies. Replace identifiers with values from a synthetic test data set.
3. **Check with a person who owns the data protection duty** whether even the reduced log is personal data (path segments often contain IDs). See [[pci-dss-and-gdpr-for-devops-logs-and-data]].
4. **Delete the replay file** when the test is done, or keep it only in a store with the same retention as the source logs.
5. **Never replay write requests** into a shared or production-like system with real side effects (emails, payments, webhooks) unless those are stubbed.

A sketch that turns access logs in JSON lines into a replay file, keeping only safe fields:

```python title="loadtest/sanitize_access_log.py"
#!/usr/bin/env python3
"""Turn JSON-lines access logs into a sanitised replay file.

Input line example (fields depend on your log format, CHANGE the names):
  {"method": "GET", "path": "/api/items/8123", "status": 200}
Output: a JSON array of {"method", "path"} with ids replaced by a placeholder
that the load test fills from synthetic data.
"""
import json
import re
import sys

ALLOWED_METHODS = {"GET"}  # replay only safe methods by default
UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
NUMBER = re.compile(r"/\d+(?=/|$)")


def sanitise(path: str) -> str:
    # Drop the query string completely: it can hold tokens and personal data.
    path = path.split("?", 1)[0]
    path = UUID.sub("{uuid}", path)
    path = NUMBER.sub("/{id}", path)
    return path


def main(src: str, dst: str) -> None:
    out = []
    with open(src, encoding="utf-8") as handle:
        for line in handle:
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            method = str(record.get("method", "")).upper()
            if method not in ALLOWED_METHODS:
                continue
            if int(record.get("status", 0)) >= 500:
                continue  # replay the mix of valid requests, not the failures
            out.append({"method": method, "path": sanitise(str(record.get("path", "")))})
    with open(dst, "w", encoding="utf-8") as handle:
        json.dump(out, handle)
    print(f"wrote {len(out)} requests to {dst}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: sanitize_access_log.py <access.jsonl> <replay.json>")
    main(sys.argv[1], sys.argv[2])
```

Then use the file in k6 and substitute the placeholders with synthetic IDs:

```javascript title="loadtest/replay.js"
import http from "k6/http"
import { SharedArray } from "k6/data"

const requests = new SharedArray("replay", () => JSON.parse(open("./replay.json")))
const BASE_URL = __ENV.BASE_URL || "https://stage.example.com"

export const options = {
  scenarios: {
    replay: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE || 50),
      timeUnit: "1s",
      duration: "10m",
      preAllocatedVUs: 50,
      maxVUs: 500,
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<300"],
    http_req_failed: ["rate<0.01"],
  },
}

export default function () {
  const item = requests[Math.floor(Math.random() * requests.length)]
  // Fill placeholders with ids that exist in the synthetic test data set.
  const path = item.path
    .replace("{id}", String(1 + Math.floor(Math.random() * 1000)))
    .replace("{uuid}", "00000000-0000-4000-8000-000000000001")
  http.get(`${BASE_URL}${path}`, { tags: { name: item.path } })
}
```

The sanitiser is a starting point. Test it on a sample and review the output with the data protection owner before using real logs. Anything not on the allow list is dropped by design.

## Guardrails for any test touching production

Prefer a production-like staging environment. When you must test in production (for example to check the real edge or a capacity claim that staging cannot support), add controls.

- **Approval and notice.** A change ticket, a time window outside the peak, and a heads-up to on-call, support and the owners of dependencies. See [[production-change-checklist]] and [[change-freezes-and-maintenance-windows]].
- **A kill switch and a person holding it.** Someone watches the dashboards and can stop the run in seconds. Thresholds with `abortOnFail` are the automatic backstop, not the only one.
- **A hard rate cap.** The script's maximum rate cannot exceed the agreed ceiling, independent of the arguments. Ramp slowly; stop at the first user-visible symptom or at SLO burn (see [[slo-burn-rate-alerting]]).
- **Mark the traffic.** A distinct `User-Agent` and a header such as `X-Load-Test: <id>` so it can be filtered from dashboards, analytics and fraud rules, and refused by the service if the test flag is off.
- **Synthetic tenants and data only.** Tests write to accounts created for the purpose, which are deleted afterwards. No real customer data, no real payments, emails or webhooks: stub them or route them to sandboxes.
- **Do not hit third parties.** Mock or sandbox external APIs; their owners did not agree to your load test, and their terms may forbid it. Check the terms of your CDN and cloud provider before testing through them (not verified here).
- **Coordinate with the edge.** A single load generator address will trigger rate limiting and bot rules. Tell the edge owners, allowlist the generator addresses (for example `198.51.100.10`) for the test window with a rule that expires, and do not switch the protection off for everyone. The edge rules are in [[edge-waf-rate-limiting]]. Also check whether your cloud provider requires notice for large tests (not verified).
- **Protect shared resources.** Databases, queues and downstream services have other users. Confirm their limits and use read-mostly profiles in production.
- **Watch cost.** Egress, logging and autoscaled nodes are billed. A soak test can generate a lot of logs; see [[gcp-audit-logs-siem]] for the volume levers and keep test traffic out of paid analytics.
- **Observability on.** Do not run a production test with monitoring in a degraded state.
- **Record it.** Keep the result, the approval and the follow-up actions with the capacity report. A test that caused an incident is reviewed like one, see [[blameless-postmortems]].

A game day is a related exercise that injects failures rather than load, see [[game-day-chaos-gke]].

## Checklist

1. Workload model written down from production data, with the source and date.
2. Pass criteria copied from the SLO and stored as thresholds in the script.
3. Open-model executor for breakpoint and stress tests; generator capacity checked.
4. Environment gaps listed; autoscaler fixed or disabled for capacity runs.
5. Smoke test in CI; load, stress, soak and spike tests scheduled by the matrix.
6. Metrics from the generator and the service on one dashboard, with the test window marked.
7. Capacity report with max RPS at the SLO, bottleneck, headroom and actions.
8. Replay data sanitised and reviewed; production tests only with the guardrails above.
9. Test repeated after material changes, and before the next production readiness review.

## See also

- [[production-readiness-review]]
- [[timeouts-retries-load-shedding]]
- [[kubernetes-autoscaling]]
- [[kubernetes-resource-requests-and-limits]]
- [[slo-burn-rate-alerting]]
- [[error-budget-policy]]
- [[postgres-connection-pooling-gke]]
