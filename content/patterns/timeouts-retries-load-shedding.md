---
title: Timeouts, retry budgets and load shedding
description: Client and server mechanics that stop a partial failure from cascading, with Go examples, retry budgets, load shedding, alerts and a k6 overload test.
type: pattern
tags:
  - patterns
  - reliability
  - kubernetes
  - observability
created: 2026-10-17
modified: 2026-10-17
draft: false
---

Most large outages start small: one slow dependency, one overloaded pod. Then every caller waits, retries and piles on more load, and a partial failure becomes a full one. Four mechanics stop that: **deadlines** so nothing waits forever, **retries** that are capped and jittered, **retry budgets** so retries cannot multiply load, and **load shedding** so an overloaded server refuses work early and cheaply instead of failing all of it slowly.

This note covers client and server code. Service mesh configuration (Envoy and similar proxies) is out of scope and only mentioned briefly. The numbers in the examples are starting points, not standards; tune them from your own latency data and SLOs.

> [!info] What was checked
> The Go code and PromQL below follow the standard library and Prometheus as known, but were not compiled or run for this note, so it is not marked `verified`. Envoy field names and defaults are not verified and no mesh configuration is given.

## Deadlines and propagation

A deadline is a point in time by which the whole operation must finish. A timeout is the same idea measured from now. Set one at every hop, and make downstream deadlines shorter than the upstream one.

Rules that prevent most trouble:

- **Every call has a timeout.** Go's `http.Client{}` has none by default; a hung peer holds a goroutine and a connection forever. Set a per-attempt timeout and an overall deadline.
- **Propagate the remaining budget.** If the edge gives a request 2 seconds, the service that calls three dependencies must not give each of them 2 seconds. Pass the deadline on: gRPC does this natively through its context; for HTTP, carry the remaining time in a header of your own choosing (a convention you define, not a standard) and rebuild the context from it on the server.
- **Timeouts shrink going down the stack.** Client per-attempt timeout < server handler timeout < load balancer timeout < browser timeout, with margin. If the load balancer gives up first, the server keeps working on a request nobody is waiting for. Check your Cloudflare and GCP load balancer timeouts in their documentation; defaults differ and are not stated here.
- **Cancel work when the caller leaves.** In Go, pass `r.Context()` into every downstream call and database query so a cancelled request stops consuming resources.
- **Set server-side timeouts too.** `ReadHeaderTimeout`, `IdleTimeout` and a handler timeout protect the server from slow clients.

```go title="server.go"
package main

import (
	"log"
	"net/http"
	"time"
)

func newServer(h http.Handler) *http.Server {
	return &http.Server{
		Addr:              ":8080",
		Handler:           http.TimeoutHandler(h, 3*time.Second, `{"error":"timeout"}`), // handler budget; set below the LB timeout
		ReadHeaderTimeout: 2 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}

func main() {
	log.Fatal(newServer(http.NewServeMux()).ListenAndServe())
}
```

`http.TimeoutHandler` cancels the request context after the limit and replies 503; handlers must respect the context for that to free resources.

## Retries with jitter and caps

A retry helps when a failure is transient: a dropped connection, a pod that just restarted, a brief 503. It hurts when the server is overloaded, because it adds load exactly when load is the problem.

Retry rules:

- Retry only **idempotent** operations (GET, PUT, DELETE, or POST with an idempotency key). Never retry a non-idempotent call blindly.
- Retry only on errors that suggest a transient problem: connection errors, timeouts, `429`, `502`, `503`, `504`. Never retry `400`, `401`, `403`, `404` or `422`.
- Cap attempts. Three attempts in total (one try and two retries) is a common choice.
- Use **exponential backoff with full jitter**: wait a random time between zero and `min(cap, base * 2^attempt)`. Without jitter, clients that failed together retry together, in waves.
- Respect `Retry-After` when the server sends it.
- Stop when the overall deadline is near. A retry that cannot finish is wasted load.

A client that applies all of this (Go 1.22 or newer for `math/rand/v2`):

```go title="client/retry.go"
package client

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"strconv"
	"time"
)

const (
	maxAttempts    = 3                      // one try plus two retries
	overallTimeout = 2 * time.Second        // total time for the whole call, retries included
	attemptTimeout = 700 * time.Millisecond // per attempt; change to about p99 latency plus margin
	baseBackoff    = 50 * time.Millisecond
	maxBackoff     = 500 * time.Millisecond
)

var ErrRetryBudgetExhausted = errors.New("retry budget exhausted")

// Client wraps an http.Client with a deadline, jittered retries and a retry budget.
type Client struct {
	HTTP   *http.Client
	Budget *RetryBudget // may be nil to disable the budget (not recommended)
}

// Get performs an idempotent GET. The caller must close the response body.
func (c *Client) Get(ctx context.Context, url string) (*http.Response, error) {
	ctx, cancel := context.WithTimeout(ctx, overallTimeout)
	defer cancel()

	if c.Budget != nil {
		c.Budget.OnRequest()
	}

	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			if c.Budget != nil && !c.Budget.AllowRetry() {
				return nil, fmt.Errorf("%w after %d attempt(s): %v", ErrRetryBudgetExhausted, attempt, lastErr)
			}
			if err := sleep(ctx, backoff(attempt, lastErr)); err != nil {
				return nil, err
			}
		}

		resp, err := c.attempt(ctx, url)
		if err == nil && !retryableStatus(resp.StatusCode) {
			return resp, nil
		}
		if err == nil {
			lastErr = &statusError{code: resp.StatusCode, retryAfter: resp.Header.Get("Retry-After")}
			io.Copy(io.Discard, io.LimitReader(resp.Body, 4096)) // drain so the connection can be reused
			resp.Body.Close()
		} else {
			lastErr = err
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	return nil, fmt.Errorf("giving up after %d attempts: %w", maxAttempts, lastErr)
}

func (c *Client) attempt(ctx context.Context, url string) (*http.Response, error) {
	ctx, cancel := context.WithTimeout(ctx, attemptTimeout)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		cancel()
		return nil, err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		cancel()
		return nil, err
	}
	// Release the per-attempt context when the caller closes the body.
	resp.Body = &cancelOnClose{ReadCloser: resp.Body, cancel: cancel}
	return resp, nil
}

type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (b *cancelOnClose) Close() error {
	err := b.ReadCloser.Close()
	b.cancel()
	return err
}

type statusError struct {
	code       int
	retryAfter string
}

func (e *statusError) Error() string { return fmt.Sprintf("upstream returned HTTP %d", e.code) }

func retryableStatus(code int) bool {
	switch code {
	case http.StatusTooManyRequests, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	}
	return false
}

// backoff returns full-jitter exponential backoff, raised to Retry-After when the server asked.
func backoff(attempt int, lastErr error) time.Duration {
	ceiling := min(maxBackoff, baseBackoff<<attempt)
	d := rand.N(ceiling + 1) // uniform in [0, ceiling]
	var se *statusError
	if errors.As(lastErr, &se) && se.retryAfter != "" {
		if secs, err := strconv.Atoi(se.retryAfter); err == nil && secs >= 0 {
			if ra := time.Duration(secs) * time.Second; ra > d {
				d = ra // the overall deadline still bounds the wait
			}
		}
	}
	return d
}

func sleep(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
```

Notes on the code: a `Retry-After` longer than the remaining deadline ends the call at the deadline rather than sleeping past it. Add jitter to `Retry-After` as well in production if many clients get the same value. Replace the status list and timeouts to match your service.

**Layering multiplies retries.** If a browser, an edge proxy, a gateway and a service each make 3 attempts, one user request can become 81 calls to the database. Retry at **one** layer, usually the one closest to the user of the failure, and have the others fail fast.

## Retry budgets

A per-request cap does not stop a retry storm: with 3 attempts each, a full outage still triples load. A **retry budget** limits retries as a share of all traffic, so retries stay a small fraction when failures are widespread. A common recommendation is to allow retries up to about 10% of requests; that is a rule of thumb from industry practice, not a standard, so tune it.

A token bucket implements it. Every request adds a fraction of a token; every retry spends one whole token. At a 10% ratio, ten requests earn one retry.

```go title="client/budget.go"
package client

import "sync"

// RetryBudget allows retries up to Ratio of the request volume, with a burst of Max tokens.
type RetryBudget struct {
	mu     sync.Mutex
	tokens float64
	max    float64
	ratio  float64
}

// NewRetryBudget returns a budget. Example: NewRetryBudget(0.1, 10) allows retries
// at 10% of requests, with a burst of up to 10 retries after a quiet period.
func NewRetryBudget(ratio, max float64) *RetryBudget {
	return &RetryBudget{tokens: max, max: max, ratio: ratio}
}

// OnRequest records an original (non-retry) request.
func (b *RetryBudget) OnRequest() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.tokens = min(b.max, b.tokens+b.ratio)
}

// AllowRetry spends one token if available.
func (b *RetryBudget) AllowRetry() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}
```

Create one budget per downstream service and share it across all calls to that service, otherwise each caller has its own allowance and the total is not bounded. A fixed token count refilled by time is a simpler variant, but the ratio form scales with traffic, which is what you want.

When the budget is empty the client returns the last error quickly. Count those events (see Metrics and alerts below); a budget that is often empty means the dependency is unhealthy, not that the budget is too small.

## Circuit breaking

A circuit breaker stops sending requests to a dependency that is clearly failing, so the caller fails fast and the dependency gets room to recover. It has three states:

- **Closed:** requests flow; failures are counted over a window.
- **Open:** after the failure rate crosses a threshold (for example, more than 50% failures over at least 20 requests in 10 seconds), requests fail immediately without calling the dependency.
- **Half-open:** after a cool-down, a few trial requests go through. Success closes the circuit; failure reopens it.

Practical advice:

- Pair the breaker with a fallback where you have one: cached data, a default, a degraded feature. A breaker with no fallback just converts a slow error into a fast one, which is still better.
- Scope breakers per dependency, and per host where one bad instance should not block healthy ones. Outlier detection (ejecting a bad instance from the load-balancing pool) is the instance-level version of the same idea.
- Do not count `4xx` client errors as failures.
- Proxies such as Envoy offer circuit breaker limits (maximum connections, pending requests, retries) and outlier detection. The configuration is mesh-specific, so see the service mesh documentation; field names and defaults are not verified here.

In Go, libraries such as `sony/gobreaker` implement the state machine. Verify the current API of whichever library you pick; it is not shown here.

## Load shedding and priority

Shedding means a server refuses some requests early to keep serving the rest well. An overloaded server that accepts everything queues work, latency rises past the clients' timeouts, the clients retry, and the server spends its time on requests whose callers have already given up. Rejecting quickly is cheaper than failing slowly.

Design points:

- Shed on a signal that tracks saturation: in-flight requests (used below), queue depth or queue wait time. CPU alone is a lagging signal.
- Return `503 Service Unavailable` with `Retry-After`. Clients and proxies understand it, and a well-behaved client backs off.
- Shed by **priority**. Health checks and critical traffic (payments, login) should survive longest; batch and background work should be refused first.
- Shed before expensive work: at the front of the middleware chain, before parsing bodies, authentication calls or database access.
- Keep the in-flight limit near what one pod can serve with good latency (measure it with [[load-and-performance-testing]]), not at the maximum it can survive.

```go title="server/shed.go"
package server

import (
	"math/rand/v2"
	"net/http"
	"strconv"
	"sync/atomic"
)

// Priority header values. The header is a convention between your own services;
// strip or overwrite it at the edge so that external clients cannot claim "critical".
const (
	PriorityHeader   = "X-Request-Priority"
	PriorityCritical = "critical"
	PriorityBatch    = "batch"
)

type Shedder struct {
	limit    int64 // maximum in-flight requests for critical traffic; change to measured capacity
	inflight atomic.Int64

	Requests atomic.Int64 // export as server_requests_total
	Shed     atomic.Int64 // export as server_shed_total
}

func NewShedder(limit int64) *Shedder { return &Shedder{limit: limit} }

// limitFor gives lower-priority traffic a smaller share of the capacity.
func (s *Shedder) limitFor(priority string) int64 {
	switch priority {
	case PriorityCritical:
		return s.limit
	case PriorityBatch:
		return s.limit / 2
	default:
		return s.limit * 8 / 10
	}
}

func (s *Shedder) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Never shed health probes: a failed probe restarts the pod and makes things worse.
		if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
			next.ServeHTTP(w, r)
			return
		}
		s.Requests.Add(1)

		n := s.inflight.Add(1)
		defer s.inflight.Add(-1)

		if n > s.limitFor(r.Header.Get(PriorityHeader)) {
			s.Shed.Add(1)
			// Jitter Retry-After between 1 and 3 seconds so clients do not return together.
			w.Header().Set("Retry-After", strconv.Itoa(1+rand.IntN(3)))
			http.Error(w, "overloaded, retry later", http.StatusServiceUnavailable)
			return
		}
		next.ServeHTTP(w, r)
	})
}
```

Wire it in with `http.Handle("/", shedder.Middleware(mux))`, and export the two counters with your metrics library under the names used in the alerts below.

Two cautions:

- A fixed in-flight limit is simple and predictable but must be re-measured as the code changes. Adaptive limiters exist; the fixed form is the one to start with.
- Shedding at the pod protects the pod, but the load balancer may then send the retry to the next pod, which is also full. Retry budgets on the client side stop that loop.

## Interaction with autoscaling

Autoscaling reacts in minutes; overload arrives in seconds. Shedding and timeouts keep the service alive in the gap. See [[kubernetes-autoscaling]] for HPA and cluster autoscaler behaviour.

- **Scale on a signal that sees saturation.** CPU-based HPA does not see a queue of blocked requests. Consider scaling on in-flight requests or request rate per pod as well.
- **Set the shedding limit below the point of collapse and above the normal load.** If shedding starts at normal load, the autoscaler never sees real demand through its CPU metric because shed requests are cheap. Alert on shed ratio so the capacity problem is visible.
- **Retry storms trigger bad scale-ups.** A retry-driven load spike makes the HPA add pods that start cold, hit the same overloaded dependency (database connections, for example), and make it worse. A retry budget removes the spike.
- **Cold pods need readiness gating.** New pods must pass readiness before getting traffic and have requests and limits that match the load, see [[kubernetes-resource-requests-and-limits]]. During rollouts, use graceful termination so in-flight requests finish, see [[zero-downtime-deployments-kubernetes]].
- **Cluster capacity lags further.** If nodes must be added, pods stay `Pending`; keep headroom for critical services.
- **Do not let the autoscaler hide a dependency limit.** More pods against a database with a fixed connection limit makes the failure worse. Cap the replica count to what the dependency can serve.

## Metrics and alerts

Measure the mechanics, or you will not know when they are saving you or hiding a problem. Suggested metrics (names are examples; match your conventions):

| Metric                                | Type    | Meaning                           |
| ------------------------------------- | ------- | --------------------------------- |
| `client_requests_total{dependency}`   | counter | Original requests to a dependency |
| `client_retries_total{dependency}`    | counter | Retry attempts made               |
| `client_retry_budget_exhausted_total` | counter | Retries refused by the budget     |
| `client_circuit_state{dependency}`    | gauge   | 0 closed, 1 half-open, 2 open     |
| `server_requests_total{priority}`     | counter | Requests reaching the shedder     |
| `server_shed_total{priority}`         | counter | Requests shed                     |
| `server_inflight_requests`            | gauge   | Current in-flight requests        |

Alerts on the retry ratio and the shed ratio (as a Prometheus rules file):

```yaml title="timeouts-retries-alerts.yaml"
groups:
  - name: overload-protection
    rules:
      - alert: HighRetryRatio
        expr: |
          sum by (dependency) (rate(client_retries_total[5m]))
            /
          sum by (dependency) (rate(client_requests_total[5m])) > 0.10
        for: 10m
        labels:
          severity: ticket # change to page if the dependency is on the critical path
        annotations:
          summary: "Retries to {{ $labels.dependency }} exceed 10% of requests"
          description: "A dependency is failing often enough that retries are material load. Check it before the budget runs out."

      - alert: RetryBudgetExhausted
        expr: sum by (dependency) (rate(client_retry_budget_exhausted_total[5m])) > 0
        for: 10m
        labels:
          severity: ticket
        annotations:
          summary: "Retry budget for {{ $labels.dependency }} is empty"

      - alert: HighShedRatio
        expr: |
          sum by (service) (rate(server_shed_total[5m]))
            /
          sum by (service) (rate(server_requests_total[5m])) > 0.01
        for: 5m
        labels:
          severity: page
        annotations:
          summary: "{{ $labels.service }} is shedding more than 1% of requests"
          description: "Capacity is short or a dependency is slow. Shed requests count against the SLO, see the error budget policy."
```

Thresholds (10% and 1%) are starting values. Tie them to your SLO: shed requests are errors from the user's point of view, so they spend the error budget, see [[error-budget-policy]] and [[slo-burn-rate-alerting]]. Alert on symptoms users feel first; use these retry and shed alerts as early warning and diagnosis.

## Testing under overload

Do not wait for production to find out. Run an overload test in a production-like environment and check that the system degrades gracefully and recovers. Methods and tooling are in [[load-and-performance-testing]].

Plan:

1. **Baseline.** Find the rate at which p99 latency is still within the SLO. Set the shedding limit from this.
2. **Ramp past capacity.** Drive 2 to 3 times the baseline rate with an **open-model** generator (fixed arrival rate), not a fixed number of users. A closed model slows down when the server slows down and hides overload.
3. **Inject a dependency fault.** Add latency or errors to one dependency (a fault-injection tool, or a stub that sleeps) and watch retries and the breaker.
4. **Hold, then drop the load.** Confirm the system recovers by itself without a restart and the shed ratio returns to zero.
5. **Pass criteria.** Critical requests keep their latency target; batch requests are shed first; shed responses carry `Retry-After`; retry ratio stays under the budget; no pod restarts from failed probes; the autoscaler adds pods without a thundering herd on the database.

A k6 script for steps 2 and 4. The target URL is a placeholder to change; point it at a test environment, never at production without agreement:

```javascript title="overload.js"
import http from "k6/http"
import { check } from "k6"
import { Counter } from "k6/metrics"

const BASE_URL = __ENV.BASE_URL || "https://staging.example.com" // change to your test environment
const shed = new Counter("shed_responses")
const shedWithoutRetryAfter = new Counter("shed_without_retry_after")

export const options = {
  scenarios: {
    overload: {
      executor: "ramping-arrival-rate", // open model: fixed arrival rate regardless of latency
      startRate: 50,
      timeUnit: "1s",
      preAllocatedVUs: 200,
      maxVUs: 1000,
      stages: [
        { target: 100, duration: "2m" }, // about baseline
        { target: 300, duration: "3m" }, // 3x baseline: shedding should start
        { target: 100, duration: "3m" }, // back to baseline: recovery
      ],
    },
  },
  thresholds: {
    "http_req_duration{priority:critical}": ["p(99)<1000"], // change to your SLO
    "checks{priority:critical}": ["rate>0.99"],
    shed_without_retry_after: ["count==0"],
  },
}

export default function () {
  // Mix of traffic: 10% critical, 70% default, 20% batch.
  const roll = Math.random()
  const priority = roll < 0.1 ? "critical" : roll < 0.8 ? "default" : "batch"

  const res = http.get(`${BASE_URL}/api/items`, {
    headers: { "X-Request-Priority": priority },
    tags: { priority },
  })

  if (res.status === 503) {
    shed.add(1)
    if (!res.headers["Retry-After"]) {
      shedWithoutRetryAfter.add(1)
    }
  }
  check(res, { "status is 200": (r) => r.status === 200 }, { priority })
}
```

Read the result by priority: critical should stay near 100% success while batch absorbs the shedding. Watch the retry and shed metrics from the Metrics and alerts section on a dashboard during the run. Record the measured limit and the date in the service's runbook so the next change can be compared.

> [!warning] Test where it is safe
> An overload test intentionally degrades the target. Run it in staging or an isolated environment, announce it, and have a stop button. Do not run it against shared dependencies you do not own.

## Related

- [[kubernetes-resource-requests-and-limits]] and [[kubernetes-autoscaling]] for capacity and scaling behaviour.
- [[zero-downtime-deployments-kubernetes]] for graceful shutdown during rollouts.
- [[error-budget-policy]] and [[slo-burn-rate-alerting]] for how shed and failed requests count against the SLO.
- [[load-and-performance-testing]] for load test design.
