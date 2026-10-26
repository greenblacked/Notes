---
title: KV cache capacity and paging
description: Plan autoregressive serving memory around the key-value cache, identify fragmentation and eviction risks, and validate paging behavior under real request mixes.
type: guide
tags:
  - ai
  - gke
  - kubernetes
  - cost
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Why cache is a capacity constraint

Autoregressive inference retains key and value tensors for prior tokens so the model need not recompute the entire context for each next token. This key-value cache grows with the number of active sequences and their retained context. In a busy serving process, cache memory competes with model weights, runtime workspace, and other allocations for accelerator memory. A deployment can load the weights successfully and still fail to admit its intended concurrency.

The exact bytes per token depend on architecture, layers, attention dimensions, dtype, parallelism, and runtime implementation. Avoid a universal formula detached from the model and engine. Use the model configuration and engine documentation to estimate, then compare with runtime-reported cache capacity and observed allocation. Keep the cache budget explicit in a per-model sizing record.

This is about runtime cache management, not weight artifact promotion. For overall demand and replica sizing, pair it with [[llm-inference-capacity-planning|LLM inference capacity planning]].

## Understand paging and block allocation

Some serving engines manage cache in fixed-size blocks or pages instead of requiring each sequence to receive one contiguous region. This can reduce external fragmentation and make sequence admission more flexible. Paging does not eliminate the underlying memory bound: active tokens still consume cache, and a large context or many concurrent sessions can exhaust available blocks.

Implementations differ in block sizing, prefix sharing, eviction, preemption, host offload, and cache accounting. vLLM's documented PagedAttention and prefix-caching behavior is specific to its versions and configuration. Treat terms such as “paged,” “swap,” or “prefix cache” as engine-defined features, not portable guarantees.

Prefix reuse can reduce repeated prefill work when requests share a prefix and the engine supports it. It is an optimization rather than an application-level correctness contract. Cache keys and isolation behavior must be understood for the deployed engine; never assume that prompts from different tenants can share cached state safely without checking the implementation and threat model. Do not put sensitive prompt material into operational dashboards to diagnose reuse.

## Size active context, not just model weights

Estimate the number of concurrently active tokens from prompt lengths, generated output, active sequence count, and any retained conversation state. Include long-context and tool-heavy requests that remain open while waiting on external calls. Streaming keeps sequence state live for the duration of generation; a disconnected client can waste reserved cache if cancellation is not propagated.

A maximum input length alone does not bound total active cache if many requests arrive concurrently. Conversely, a configured maximum sequence count does not ensure safe memory if each sequence has a large context. Use both admission limits and memory telemetry when supported. Include cache reservations during rollout overlap and model reload, not just steady state.

Run tests that combine different lengths, concurrent streams, cancellations, and prefix reuse rather than uniform short prompts. Monitor available cache blocks or engine-equivalent metrics alongside allocated GPU memory, queue length, evictions, preemptions, and request latency. Names and exact definitions vary by runtime; validate meaning against the versioned documentation.

## Paging and failure behavior

When cache pressure rises, a runtime might queue admission, preempt or recompute work, evict reusable prefixes, offload state, or reject requests. The exact behavior is implementation-specific. Each can produce different latency and cost effects. Preemption can preserve availability at the expense of wasted computation; offload can trade GPU memory for transfer latency and host-memory pressure. A cache eviction may be harmless for correctness but reduce throughput by removing reuse.

Do not set cache utilization as high as possible without testing. A small remaining margin can fail under a burst, a long request, or an operational restart. If the engine supports a cache fraction or block limit, use the documented meaning for that version and verify the realized allocation. A high configured fraction is not the same as an end-to-end capacity guarantee.

## Capacity checklist

- Record model architecture, serving-engine release, cache dtype, parallelism, and documented cache controls.
- Measure real cache use over a distribution of prompt lengths and concurrent generated tokens.
- Test long contexts, sustained streams, cancellations, mixed tenants, and overload.
- Set admission caps before memory pressure reaches an OOM or widespread preemption.
- Alert on cache exhaustion signals, queueing, evictions/preemptions, and tail latency.
- Revalidate after model, tokenizer, runtime, hardware, or cache-policy changes.

The main tradeoff is predictable: larger contexts and more concurrent sessions improve flexibility but consume cache and reduce the number of requests that fit. Paging can improve allocation efficiency; it does not make memory infinite or eliminate service-level admission policy.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [PagedAttention: Efficient Memory Management for Large Language Model Serving](https://arxiv.org/abs/2309.06180): primary research describing paged KV-cache management; results and implementation details should not be read as a guarantee for every serving engine.
- [Automatic Prefix Caching - vLLM](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/): vLLM-specific prefix reuse behavior; verify settings and compatibility against the deployed release.
- [Engine Arguments - vLLM](https://docs.vllm.ai/en/latest/configuration/engine_args/): engine configuration reference; exact cache controls are version-specific.
