---
title: "Reranking and retrieval depth"
description: "Choose candidate depth and reranking stages by measuring evidence coverage, ranking quality, latency and context pressure."
type: guide
tags:
  - ai
  - reliability
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Retrieval depth decides how many candidates are available for downstream selection; reranking decides how to order that pool for the final context. Increasing top-k can raise the chance of retrieving evidence but also increases irrelevant context, duplicate passages, compute, privacy exposure and latency. Reranking cannot recover evidence that the initial retriever never surfaced. Use the retrieval evaluation approach in [[rag-over-runbooks-for-on-call]] as the quality gate, then tune candidate depth and ranking separately.

## 01 Define the ranking pipeline

A common pipeline retrieves a moderate candidate set from one or more indexes, applies mandatory authorization, deduplicates by source/chunk identity, optionally filters stale or unsupported items, reranks the authorized candidates, and selects a context-bounded set with diversity. Record the candidate count at every stage. A reranker is a scoring component, not an authorization boundary or truth verifier. It may be a cross-encoder, search-service semantic ranker, or another model; its input limits, supported fields, latency and availability depend on the provider.

Set an explicit budget for candidates, reranker input length, final passages and total prompt tokens. Truncate only at meaningful boundaries and preserve source anchors. Prefer retrieving a child span then expanding to its parent section when context needs surrounding definitions; do not expand every candidate to an entire file. Diversify results by document and section when duplicate chunks or repeated copies otherwise consume the context budget. Keep all selection decisions traceable to stable IDs and index versions.

## 02 Select a useful candidate depth

Evaluate a sweep of candidate depths (for example, small, medium and larger values chosen for your corpus), not a single guessed k. For each question, calculate whether any acceptable evidence appears in the candidate pool before reranking, after reranking, and in the final context. This separates first-stage recall failure from ranking and context-selection failure. Include multi-hop or multi-span questions where the answer requires distinct sources, plus questions where top candidates are misleading or outdated.

Choose depth against a business-weighted target: missed critical evidence may cost more than a few additional irrelevant passages, but broad retrieval must not overwhelm the generator or violate a data-minimization objective. Measure p95 and p99 end-to-end latency under realistic concurrency, not just a model's isolated scoring time. A higher depth may increase provider calls or service resource use and can trigger throttling. Cache or parallelize only if keys, invalidation and isolation remain correct; see [[retrieval-cache-invalidation]].

## 03 Reranker selection and evaluation

Compare the baseline retriever order with reranked order on a held-out set. Use ranking metrics such as reciprocal rank or nDCG alongside evidence recall and end-to-end citation support. Inspect query classes that depend on exact values, dates, negation, tables, version distinctions and multilingual semantics; a semantically plausible score may still miss a critical qualifier. Evaluate at the same authorized candidate set, and preserve a no-rerank baseline for comparison and rollback.

Provider-managed semantic ranking can simplify operations but introduces service-specific limits, latency, charges and field eligibility. A self-hosted model gives control but creates model-serving and version management duties. A general LLM prompted to rank passages may be expensive and less deterministic; constrain it to ordering already-authorized candidates and validate outputs against allowed IDs. Structured output can enforce shape, not correctness. Keep model and prompt versions pinned, and do not use raw scores as calibrated confidence without evidence. Check [[model-version-pinning-and-upgrade-evals]] when the ranker model changes.

## 04 Failure modes and controls

Failure modes include shallow candidate recall, reranking candidates with inconsistent source freshness, ordering duplicates ahead of diverse evidence, truncating away table headers, scoring excessive text past model limits, retries that multiply latency, and treating rank score as a factuality judgment. A provider outage must have an explicit fallback: use baseline retrieval only if its quality is acceptable, otherwise return a constrained abstention. Do not expand the candidate pool during an outage unless the changed privacy and cost behavior is approved.

Track candidate counts, pre/post ranking metrics, reranker latency and errors, context tokens, deduplication ratio, fallback share and outcome quality. Use opaque request IDs and bounded labels rather than source text. Alert on quality regressions and high tail latency by ranker/index version. During a quality incident, test first-stage recall separately; raising reranker sophistication does not fix missing index coverage.

## 05 Review checklist

- Is the pre-rerank candidate pool large enough for critical evidence but bounded operationally?
- Can evaluation distinguish retrieval misses from ranking and final-context selection errors?
- Are authorization and freshness checked before reranker/model exposure?
- Are truncation, table structure, duplicates, source diversity and parent expansion handled?
- Have latency, capacity, token budget, concurrency and provider failure paths been tested?
- Is score interpretation cautious, output constrained, and the ranker version recorded?
- Can operators fall back or abstain without widening access or losing incident visibility?

For broader AI practice resources, see [the owner's AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Semantic Ranking Overview](https://learn.microsoft.com/en-us/azure/search/semantic-search-overview): Microsoft Learn documentation on semantic reranking in Azure AI Search; feature availability and input constraints are service-specific.
- [Create a Vector Query](https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-query): Microsoft Learn on vector query controls and result configuration; check current API version details before implementation.
- [Generative AI with RAG](https://docs.cloud.google.com/architecture/rag-reference-architectures): Google Cloud's RAG architecture index, last reviewed 2025-09-22, for retrieval-to-generation system context.
