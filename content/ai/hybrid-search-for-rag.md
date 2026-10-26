---
title: "Hybrid search for RAG"
description: "Combine lexical and semantic retrieval when their complementary strengths improve measured evidence recall."
type: guide
tags:
  - ai
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Hybrid search combines lexical matching with vector similarity so retrieval can cover both exact terms and semantic paraphrases. It is useful where identifiers, error codes, product names or quoted text matter alongside natural-language intent. It is not an automatic relevance upgrade: poor tokenization, duplicated candidate sets, unsuitable fusion or stale lexical fields can make results worse. The baseline RAG workflow in [[rag-over-runbooks-for-on-call]] emphasizes evaluated retrieval; use that same discipline when deciding whether hybrid search is warranted.

## 01 When to combine retrieval methods

Lexical search is often strong for rare identifiers, exact phrase fragments, acronyms and values that appear verbatim. Dense-vector search can find semantically related passages even when the question uses different wording. A hybrid design makes both candidate streams visible, then merges or reranks them. Validate whether your corpus's queries contain enough exact-match behavior to justify the extra indexing, ingestion and tuning complexity. Query classification can selectively route queries, but starts as an added decision point that itself needs evaluation.

Do not assume that adding a sparse vector model is identical to traditional inverted-index search. A product may define its own sparse representation and ranking behavior. Treat the lexical and vector pipelines as distinct inputs, and compare the configured methods in the chosen engine's current docs. Exact phrase, filters, language-specific analysis, synonyms and field boosts all influence the lexical arm; embedding model, chunking, vector metric and candidate depth influence the semantic arm.

## 02 A practical candidate and fusion design

Build lexical and vector candidate lists in parallel using the same authorized corpus snapshot and mandatory access filter. Retrieve a candidate depth sufficient for later fusion, but cap it to bound latency and cost. Deduplicate by stable chunk identity while preserving which retriever found the item and its original rank. Use a rank-based fusion method when raw scores have incompatible scales. Reciprocal rank fusion is one documented option in some search platforms; it uses ranks rather than assuming scores are calibrated. Other engines offer learned or custom fusion, which requires its own training and evaluation discipline.

Keep metadata filters and ACL checks within both retrieval paths, before any content is sent to the model. A lexical path that bypasses filtering defeats a correctly secured vector path. Apply a reranker only after the merged pool is authorized and deduplicated, and retain provenance fields needed for citation. Set a maximum context budget and diversify near-duplicate passages so both arms do not fill all slots with copies of the same section.

## 03 Tune with controlled evaluation

Construct paired questions for exact retrieval, paraphrase, mixed term-plus-intent, misspelling, acronym expansion and no-evidence behavior. Label acceptable evidence and any required source recency. Compare lexical-only, vector-only and hybrid on the same snapshot. Report recall at candidate depth, ranking metrics, citation coverage, answer quality, abstention, p95 latency, error rate and incremental indexing or query cost. Break down by corpus source and query intent. A higher top-k recall may still produce worse final answers if fusion returns more irrelevant material.

Tune candidate depths and fusion parameters on a development set, then preserve a held-out set for promotion. Inspect cases where rank fusion moves a relevant result down or elevates a noisy lexical match. Evaluate exact query terms that are security-sensitive or version-specific, and make sure synonym rules do not cause contradictory versions to merge. Keep a safe default route if one retrieval arm is unavailable: an explicitly degraded mode can answer with lower confidence or abstain, but must not silently widen the access boundary.

## 04 Failure modes and observability

Hybrid retrieval can fail when analyzers strip punctuation from IDs, embeddings ignore exact version markers, fusion favors a noisy channel, filter semantics differ, one index lags the other, or a reranker overfits a narrow pool. Shadow indexes can show apparent loss simply because their ingestion watermark differs. Capture query class, retriever generation, per-arm candidate counts, rank and latency, fusion version and authorized result count. Avoid storing raw query and document text in telemetry; use redacted or aggregated identifiers under the applicable retention policy.

On an incident, compare each arm separately, verify freshness and ACL consistency, and test an authorized known-answer query. Roll back fusion parameters or routing without changing the corpus when possible. Rebuild or reindex only if evidence points to index drift. Track whether fallback mode is active and alert on prolonged degraded retrieval; avoid treating a successful API response as proof of relevant evidence.

## 05 Review checklist

- Does the query mix demonstrate complementary lexical and semantic misses?
- Are candidate retrieval, filters, index watermarks and permissions equivalent across arms?
- Are candidates deduplicated by stable identity and original ranks preserved?
- Are fusion and candidate-depth parameters tuned on development data and checked on held-out cases?
- Does the evaluation cover exact identifiers, paraphrase, multilingual content, no-evidence and version conflicts?
- Are quality, latency, failure behavior and incremental cost measured together?
- Is degraded mode explicit, bounded, permission-safe and visible to operators?

For broader AI practice resources, see [the owner's AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Hybrid Search Overview](https://learn.microsoft.com/en-us/azure/search/hybrid-search-overview): Microsoft Learn's hybrid search explanation; the fetched page describes combining vector and full-text queries and reciprocal rank fusion. Service behavior may change.
- [Create a Vector Query](https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-query): Microsoft Learn guide to vector queries, helpful for distinguishing vector configuration from full-text query behavior.
- [Generative AI with RAG](https://docs.cloud.google.com/architecture/rag-reference-architectures): Google Cloud's RAG architecture index, last reviewed 2025-09-22; architecture examples do not prescribe a universal hybrid ranking policy.
