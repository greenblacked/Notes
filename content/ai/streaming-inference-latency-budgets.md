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
modified: 2026-10-26
draft: false
---

## One response has several latency dimensions

A streaming inference call is not a single duration. Users experience the delay until the request is accepted, the time to first visible output, pauses between chunks or tokens, and total completion time. Network buffering, proxies, application rendering, and server scheduling can each contribute. A service can meet a first-token objective and still deliver a frustrating stream if later output stalls.

Define objectives for each stage and workload class. A short interactive completion may need a bounded total duration; a long analysis stream may instead prioritize first-token responsiveness and a maximum gap between updates. Set the objective at the user-facing boundary and instrument backend components so the team can explain a miss. Avoid copying a provider's advertised latency as an SLO; external service behavior, route, region, and model can change.

Streaming metrics complement the token and trace signals described in [[llm-observability-tracing-and-slos|LLM observability and SLOs]]. This note focuses on how to break down and budget the stream.

## Measure milestones consistently

Record request start, admission decision, provider or engine dispatch, first response event, first non-empty content, subsequent chunk times, completion, cancellation, and transport error. Distinguish server event arrival from bytes rendered by the client; buffering can make them diverge. For locally hosted models, separate queue wait, prefill, decode, and transfer where instrumentation permits. For provider APIs, measure only the boundaries your application can observe and label them accordingly.

Use monotonic clocks for durations inside a process. Cross-service traces need propagation and clock discipline, but do not subtract unsynchronized wall clocks and treat the result as precise. Keep request IDs in traces rather than metric labels. Track histograms by bounded dimensions such as model family, route class, and response mode; avoid raw prompts, user identifiers, or exact arbitrary model strings as labels.

OpenTelemetry's current GenAI semantic conventions are maintained in the dedicated semantic-conventions-genai repository. The older OpenTelemetry documentation pages for those conventions explicitly say they have moved; use the repository as the canonical source and check its status and definitions before adopting field names. Instrumentation schema can evolve, so pin and document the convention revision used by dashboards.

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

## Sources

- [Streaming API responses | OpenAI API](https://developers.openai.com/api/docs/guides/streaming-responses): OpenAI-specific streaming response behavior; recheck current API semantics.
- [Generative AI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai): current dedicated repository for OpenTelemetry GenAI conventions; use its maintained definitions rather than the moved older docs pages.
- [Engine Arguments - vLLM](https://docs.vllm.ai/en/latest/configuration/engine_args/): serving-engine configuration; local timing instrumentation remains implementation-specific.
