---
title: Long-context retrieval strategy
description: Combine permission-aware retrieval, source ranking and bounded evidence packing instead of treating a large context window as a search strategy.
type: guide
tags:
  - ai
  - security
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

A larger context window enables new use cases, but does not ensure that the model notices the right fact, that retrieved information is fresh, or that the user is authorized to see it. Retrieval must answer three separate questions: what is relevant, what is permitted, and what is still authoritative? This note covers long-document and corpus retrieval strategy, not the general assembly discipline in [[context-engineering-for-agents]].

## Retrieve with authorization and provenance

Filter by tenant, project and user access before ranking. Do not retrieve broadly with a service account and rely on a prompt instruction to hide unauthorized passages. When permissions change, retrieval must reflect the change immediately enough for the product's risk tolerance. If the index cannot represent fine-grained access controls, partition it or query the authorized source of truth first.

Represent each passage with source identity, revision, location, effective date and ingestion time. Preserve section headings and enough surrounding text to retain qualifiers. A chunk detached from a heading like “Deprecated procedure” can invert meaning. Keep the original source retrievable for verification; do not treat an embedding or generated summary as authoritative.

Use an incremental retrieval pipeline: normalize the question; identify required entities and time scope; retrieve candidate passages; apply authorization and freshness checks; rank and deduplicate; then pack the selected evidence within a token budget. For tasks with explicit dates or resource IDs, prefer exact filters and canonical identifiers alongside semantic similarity. Semantic search alone often returns a similar-but-wrong service, product version or incident.

## Choose chunking and ranking deliberately

Chunk boundaries should preserve logical units such as a runbook step, policy section or record, not arbitrary character windows alone. Chunk overlap can preserve context but creates duplicate evidence. Include stable IDs so duplicates can be collapsed and citations can point back to exact source locations. Revisit chunking when the corpus format changes.

Ranking may combine lexical match, vector similarity, recency, source authority and task-specific metadata. Document the ranking signals and keep a small evaluation set of questions with expected source passages. Measure recall of required evidence, ranking position, stale-source rate and unauthorized retrieval attempts. Evaluate no-answer cases too; a system that always returns something will confidently surface weak matches.

Long-context ingestion can support global comparison and synthesis, while retrieval is better when the corpus is large, frequently updated or access-controlled. A hybrid may retrieve a focused subset and then ask the model to compare it. Avoid sending the entire corpus simply because a model advertises a large window; cost, latency, attention and privacy all matter. The Google Cloud RAG reference architecture is useful for system components, but it is not a substitute for evaluating your corpus and authorization model.

## Citation and abstention

Ask the model to cite supplied passage IDs, then resolve those IDs in application code and render source links from trusted metadata. Reject nonexistent IDs and citations that point to a source the caller cannot access. A citation is a traceability aid, not proof that the cited passage supports the statement; high-impact conclusions need an evidence review or deterministic check.

Define a threshold for “insufficient evidence” using evaluation rather than an arbitrary similarity score. If evidence is conflicting or stale, return that fact. Do not fill gaps from general model knowledge when the task specifically asks about internal policy or current operations.

## Failure modes and review checklist

Common issues are stale index snapshots, access checks applied after the model sees content, chunks without headings, semantic similarity mistaken for factual match, ranking that favors old but popular documents, citations generated without source IDs, and silent truncation during context packing. Retrieval outages should produce an explicit degraded or unavailable state rather than falling back to a broader data source.

- [ ] Authorization filters apply before content enters model context.
- [ ] Each chunk carries source, version, time and location metadata.
- [ ] Chunking preserves semantic boundaries and relevant headings.
- [ ] Ranking combines semantic and exact structured signals as appropriate.
- [ ] Evaluation includes recall, freshness, permissions and no-answer cases.
- [ ] Context packing reports truncation and respects budget.
- [ ] Generated citations resolve to supplied, accessible source IDs.
- [ ] Retrieval failure and stale evidence produce explicit outcomes.

## Sources

- [Google Cloud: RAG-capable generative AI application using Vertex AI](https://cloud.google.com/architecture/rag-capable-gen-ai-app-using-vertex-ai) — reference architecture; live page says last reviewed 2026-02-04.
- [Google AI: Long context](https://ai.google.dev/gemini-api/docs/long-context) — provider guidance on long-context use; model limits and behavior vary.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) — risk management framing; AI RMF 1.0 was released in 2023 and is being revised.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
