---
title: Operating OpenTelemetry tail sampling
description: Keep useful traces with bounded sampling state, trace-aware routing, explicit loss budgets and rollout checks.
type: pattern
tags:
  - patterns
  - opentelemetry
  - observability
  - reliability
  - cost
created: 2026-10-29
modified: 2026-10-30
draft: false
evidence: source-reviewed
reviewed: 2026-10-30
review-due: 2027-04-30
destructive: true
---

Tail sampling is a stateful decision about traces, not just a percentage on an exporter. Use it when error, latency or business attributes justify retaining a trace that a head sampler could not identify at request start. The [[observability-pipeline-opentelemetry|pipeline reference design]] supplies the agent and gateway tiers; this note focuses on operating the sampling tier.

> [!warning] Sampling is irreversible downstream
> Spans not exported upstream cannot be recovered by a tail sampler. Traces discarded by the sampling tier cannot be reconstructed from the backend. Never use sampled traces as the only audit record or as an uncorrected denominator for availability.

## Route by trace ID before making decisions

Every span of one trace must reach the same sampling Collector instance. An ordinary load-balanced OTLP endpoint is not sufficient. Put a trace-aware routing tier before the sampler, with consistent backend membership across routers.

The Contrib load-balancing exporter supports `routing_key: traceID`. Current upstream documentation calls the exporter `load_balancing` and retains `loadbalancing` as a deprecated alias. Check the component name supported by the exact distribution and release you deploy; do not copy a `main`-branch example into an older binary without validation.

On Kubernetes, a headless Service can expose sampler endpoints to the router's DNS resolver. A normal Service exposing only its virtual IP does not give the router the individual sampler endpoints it needs.

Backend membership changes can remap in-flight traces. A restart can lose buffered sampling state, or decide on partial traces: on a graceful shutdown the processor by default makes decisions with the spans it already has, and `drop_pending_traces_on_shutdown` drops them instead. Check that the option exists in the release you deploy. Treat sampler scale-up, scale-down and rolling updates as potential trace-loss events, not stateless capacity changes. A PodDisruptionBudget alone does not preserve trace affinity or buffered spans.

## Start with a small, explainable policy

This is a processor fragment, not a complete Collector deployment. It assumes the timer-based `trace-complete` strategy described by current upstream documentation and does not enable experimental sampling features.

```yaml title="otel-sampling-processors.yaml"
processors:
  tail_sampling:
    decision_wait: 30s
    num_traces: 50000
    expected_new_traces_per_sec: 1000
    decision_cache:
      sampled_cache_size: 500000
      non_sampled_cache_size: 500000
    policies:
      - name: errors
        type: status_code
        status_code:
          status_codes: [ERROR]
      - name: slow
        type: latency
        latency:
          threshold_ms: 1000
      - name: baseline
        type: probabilistic
        probabilistic:
          sampling_percentage: 5
```

With these positive policies, a match on any policy retains the trace. Five percent is a baseline for other traces, **not** a total output cap; a surge in errors can retain most incoming traffic. A standalone rate-limiting policy alongside `errors` does not cap the other policy's output. If a global cap is necessary, design and test a composite policy and explicitly decide what useful traces may be lost.

The error policy checks span status `ERROR`, not an HTTP status attribute by itself. Verify instrumentation actually sets the span status. The latency policy uses the earliest span start and latest span end visible to the sampler; it cannot judge spans that never arrive.

Run context-dependent enrichment, such as `k8sattributes`, before tail sampling. The processor reassembles spans into new batches and loses their original request context.

## Size the waiting room

Use peak new traces per second multiplied by the decision window as an initial estimate of pending trace count, then add measured headroom for bursts and decision processing. At 1,000 new traces per second and 30 seconds, that estimate is 30,000 pending traces before headroom. This is a sizing heuristic, not a memory guarantee.

`num_traces` bounds the count of stored traces, not their bytes; when it is full, the oldest trace is removed, possibly before its decision. Since Collector-contrib v0.145.0 the processor has `maximum_trace_size_bytes`, which drops a single oversized trace to protect the Collector; confirm your distribution includes it. Measure span counts, attribute sizes and heap use under representative load. `expected_new_traces_per_sec` helps allocate data structures; it is not an ingestion rate limiter.

Choose `decision_wait` from observed span arrival delay, including SDK batching and network retries, rather than request duration alone. A finite wait cannot guarantee complete traces. Larger waits increase buffered state and delay export.

Decision caches retain keep/drop decisions after trace data leaves memory. They help late spans follow an earlier decision, but are bounded and do not recover spans already lost. Size them separately from pending trace storage and much larger than `num_traces`, as upstream recommends, so a decision outlives the trace data; the example uses ten times `num_traces`. Validate behavior after cache eviction and after a Collector restart.

## Rollout acceptance

Before enabling sampling, capture a baseline for ingestion, exported trace volume, backend cost and Collector memory. In an isolated test path, send traces with known IDs for a healthy request, an error, a slow request, an error span arriving after the decision window, and a multi-service trace crossing multiple routing instances.

Require the expected error and slow traces within the window to be retained with their expected spans. Evaluate the probabilistic baseline over many eligible traces, not a single request. Repeat during a sampler restart and backend membership change; record incomplete and missing traces rather than counting export success as completeness.

Monitor receiver refusals, export failures, buffered trace pressure, early trace removals, decision latency and memory. Resolve the exact metric names against the deployed Collector version. Alert separately on unexpected loss and excessive retained volume.

## Evidence

### Sources checked

- [OpenTelemetry sampling concepts](https://opentelemetry.io/docs/concepts/sampling/): head/tail trade-offs, upstream loss and operating costs; checked 2026-10-29.
- [Tail sampling processor](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/processor/tailsamplingprocessor/README.md): statefulness, configuration fields, policy combination, context loss and decision caches; checked 2026-10-29.
- Tail sampling processor README at Collector-contrib `main` commit `6411c22`: `drop_pending_traces_on_shutdown`, `maximum_trace_size_bytes`, eviction of the oldest trace when `num_traces` is full and decision caches much greater than `num_traces`; checked 2026-10-30. `maximum_trace_size_bytes` was released in v0.145.0 (contrib `CHANGELOG.md`); the release that added `drop_pending_traces_on_shutdown` was not confirmed.
- [Load-balancing exporter](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/loadbalancingexporter/README.md): component naming, trace-ID routing, DNS endpoint discovery and membership changes; checked 2026-10-29.

### Not verified

No Collector binary, routing experiment or load test was run. Upstream `main` can describe unreleased functionality. Configuration compatibility, metric names, achievable completeness and memory budgets remain deployment-specific. Web pages listed as checked 2026-10-29 were not re-fetched on 2026-10-30 (no web access); the new claims were checked against the documentation sources listed with that date.

### Environment

An OpenTelemetry Collector distribution containing the tail-sampling processor and a trace-aware routing component. Pin a release and validate the assembled configuration with that binary before rollout.

### Prerequisites

A tested unsampled or previously sampled delivery path, known trace fixtures, explicit telemetry retention requirements, and capacity for the proposed policy's worst-case output.

### Expected results

The Rollout acceptance section defines retained trace and completeness checks; the sizing section defines the initial capacity estimate. Record observed loss and volume against team-agreed budgets.

### Failure conditions

Missing expected errors, fragmented traces, unexpected early removal, repeated memory pressure or export volume above the backend budget block rollout.

### Cleanup and rollback

Restore the previous versioned pipeline configuration and routing path. Provision backend capacity before returning to unsampled export; it can sharply increase volume. Allow for in-flight trace loss during the transition. A configuration rollback cannot restore discarded telemetry.

## Related

- [[observability-pipeline-opentelemetry]]
- [[metrics-naming-and-cardinality-standard]]
- [[slo-definition-standard]]
