---
title: Streaming inference latency budgets
description: Set and instrument separate budgets for request acceptance, first token, ongoing stream cadence, and completion.
type: guide
tags:
  - ai
  - reliability
  - observability
  - opentelemetry
created: 2026-10-26
modified: 2026-11-01
draft: false
evidence: source-reviewed
reviewed: 2026-11-01
review-due: 2027-05-01
---

## One response has several latency dimensions

A streaming inference call is not a single duration. Users experience the delay until the request is accepted, the time to first visible output, pauses between chunks or tokens, and total completion time. Network buffering, proxies, application rendering, and server scheduling can each contribute. A service can meet a first-token objective and still deliver a frustrating stream if later output stalls.

Define objectives for each stage and workload class. A short interactive completion may need a bounded total duration; a long analysis stream may instead prioritize first-token responsiveness and a maximum gap between updates. Set the objective at the user-facing boundary and instrument backend components so the team can explain a miss. Avoid copying a provider's advertised latency as an SLO; external service behavior, route, region, and model can change.

Streaming metrics complement the token and trace signals described in [[llm-observability-tracing-and-slos|LLM observability and SLOs]]. This note focuses on how to break down and budget the stream.

## Measure milestones consistently

Record request start, admission decision, provider or engine dispatch, first response event, first non-empty content, subsequent chunk times, completion, cancellation, and transport error. Distinguish server event arrival from bytes rendered by the client; buffering can make them diverge. For locally hosted models, separate queue wait, prefill, decode, and transfer where instrumentation permits. For provider APIs, measure only the boundaries your application can observe and label them accordingly.

Use monotonic clocks for durations inside a process. Cross-service traces need propagation and clock discipline, but do not subtract unsynchronized wall clocks and treat the result as precise. Keep request IDs in traces rather than metric labels. Track histograms by bounded dimensions such as model family, route class, and response mode; avoid raw prompts, user identifiers, or exact arbitrary model strings as labels.

OpenTelemetry's GenAI semantic conventions are maintained in the dedicated semantic-conventions-genai repository, and its GenAI documentation is marked with status Development, so names and definitions may change. Older OpenTelemetry documentation pages may have moved to that repository; check the current docs for your version. Use the repository as the canonical source and check its status and definitions before adopting field names. Instrumentation schema can evolve, so pin and document the convention revision used by dashboards.

## Allocate the budget

Set a total user-visible budget and divide it into stages. For a local path, a useful decomposition is admission/queue, prompt processing, first-token generation, inter-token generation, and network delivery. For a hosted provider path, include gateway policy, outbound connection, provider response, and downstream streaming. Leave margin for variation rather than assigning every millisecond to the median case.

Tail percentiles matter because queues and long prompts create skew. Review p50 and tail percentiles for first-token and completion separately, and compare by input/output length. For streams, compute time between events and maximum observed gap; a mean chunk rate can hide stalls. Do not report only time to first byte if the first event may contain metadata but no user-visible content.

Set explicit timeouts and cancellation propagation. A caller deadline should leave time for cleanup and a useful error response. On client disconnect, cancel upstream generation when possible; otherwise the stream can continue to consume tokens or GPU cache after the user has left. Provider-specific cancellation semantics must be confirmed in current provider docs.

## Diagnose and respond to misses

- **High queue wait:** admission exceeds available service capacity; shed or defer work and revisit capacity.
- **Slow first content:** inspect prompt length, prefill, route, model load, and network establishment.
- **Irregular gaps:** investigate decode saturation, batching delay, proxy buffering, and client event handling.
- **Fast stream but slow finish:** inspect output-length distribution, throttling, and sustained generation rate.
- **Good server metrics, poor user experience:** test buffering and rendering through the real ingress and client.
- **Many incomplete streams:** distinguish intentional cancel, deadline, transport reset, and server fault.

Avoid optimizing the first-token measure by emitting non-informative filler. That can make the chart improve while the user remains blocked. Report a service-level objective only for the observable outcome that matters and retain stage measurements for diagnosis.

## Checklist

- Define first-content, stream-gap, completion, and error objectives by route class.
- Mark milestones at application, engine/provider, and client boundaries.
- Test streaming through production-like proxy and client paths, including disconnects.
- Configure total deadline, per-stage timeout, cancellation propagation, and bounded retries.
- Check histogram cardinality and avoid recording sensitive content.
- Revisit the budget after routing, model, runtime, or client changes.

The tradeoff is between fast initial response, full completion time, reliability under congestion, and the cost of continuing generation. A clear budget allows the team to decide which requests to queue, reject, truncate, or move to asynchronous processing.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Evidence

### Sources checked

- [Generative AI semantic conventions repository](https://github.com/open-telemetry/semantic-conventions-genai): the GenAI conventions live in a dedicated repository, and their documentation carries status Development (docs/gen-ai/README.md). Source repository commit 244465e, checked 2026-11-01.
- [Engine Arguments - vLLM](https://docs.vllm.ai/en/latest/configuration/engine_args/): the page exists and describes engine configuration for offline and online serving (docs/configuration/engine_args.md). Source repository commit 8530a77, checked 2026-11-01.
- [Generative AI metrics](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-metrics.md): the conventions define histograms `gen_ai.server.time_to_first_token` (covers queue and prefill time) and `gen_ai.server.time_per_output_token` (decode phase), both with Development stability (docs/gen-ai/gen-ai-metrics.md). Source repository commit 244465e, checked 2026-11-01.
- [Generative AI attribute registry](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/registry/attributes/gen-ai.md): `gen_ai.response.time_to_first_chunk` counts only stream events carrying new, non-empty output, not empty start events or events with only usage, IDs or keep-alives, which backs the warning against reporting only time to first byte (docs/registry/attributes/gen-ai.md). Source repository commit 244465e, checked 2026-11-01.
- [Metrics - vLLM](https://docs.vllm.ai/en/latest/design/metrics/): vLLM exposes separate histograms for queue time, prefill time, decode time, time to first token, inter-token latency (between consecutive streamed outputs) and end-to-end latency, which backs separating queue wait, prefill, decode and stream gaps for locally hosted models (docs/design/metrics.md). Source repository commit 8530a77, checked 2026-11-01.

### Not verified

- That the older OpenTelemetry documentation pages for GenAI conventions say they have moved: not found in the OpenTelemetry specification checkout (commit 25ebe40) or the conventions repository, so the note now says only that they may have moved.
- The advice on monotonic clocks and on keeping request IDs, user identifiers and raw prompts out of metric labels: no matching guidance was found in the local OpenTelemetry specification or Prometheus docs checkouts.
- Provider-specific behaviour, including cancellation semantics, which depends on the provider's own current documentation.
- The general latency, budgeting and monitoring guidance, which is advice rather than a documented claim.
- Any claim depending on GKE or Google Cloud documentation: those docs were not available locally and nothing in the note was checked against them.

## Sources

- Your model provider's own documentation for the provider-specific behaviour this note mentions (features, limits, pricing, data retention and terms change; check the current pages before relying on them).
- [Generative AI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai): current dedicated repository for OpenTelemetry GenAI conventions; use its maintained definitions rather than older docs pages, which may have moved.
- [Engine Arguments - vLLM](https://docs.vllm.ai/en/latest/configuration/engine_args/): serving-engine configuration. Engine timing instrumentation is implementation-specific; check the current docs for your version.
- [Metrics - vLLM](https://docs.vllm.ai/en/latest/design/metrics/): queue, prefill, decode, first-token and inter-token latency histograms for one serving engine.
