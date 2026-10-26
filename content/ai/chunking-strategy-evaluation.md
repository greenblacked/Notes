---
title: "Chunking strategy evaluation"
description: "Select chunk boundaries by measuring answer evidence, retrieval recall, context cost and source fidelity on real documents."
type: guide
tags:
  - ai
  - reliability
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Chunking determines which evidence can be retrieved together, how much source context is lost at a boundary, and how many vectors and tokens an application must manage. There is no universal best chunk size: file structure, question type, embedding model, search method and generation budget all matter. This note pairs with [[rag-over-runbooks-for-on-call]], which treats evaluation as a gate for an on-call RAG system; here the concern is a controlled comparison of segmentation strategies.

## 01 Define the unit of success

Start with a representative document set and a question set that includes exact fact lookup, multi-section synthesis, tables, procedural steps, exceptions, version comparisons and unanswerable questions. For each question, annotate the minimum supporting source span and any context required to interpret it. Mark where the span begins and ends, its document revision, and whether nearby content is necessary. The objective is not to maximize chunks returned or vector similarity; it is to place sufficient, correct evidence in a bounded context while retaining traceable citations.

Select metrics before running experiments. Retrieval measures can include recall of supporting spans at candidate depth k, reciprocal rank, and the proportion of retrieved text containing the required evidence. End-to-end measures should include answer correctness, citation support, abstention when evidence is absent, context tokens, latency and cost. Compare by document class and question category; an aggregate score can hide failures in scanned policies or tabular instructions. Judge outputs with reviewers who do not know which strategy produced them where feasible.

## 02 Compare segmentation approaches

Establish a baseline that respects structural boundaries: document, heading, paragraph, list, table and code block. Compare it with fixed token windows, structure-first chunks with a maximum size, and parent-child retrieval where a small child span selects a larger parent section for final context. Tune overlap only as an explicit parameter; overlap can protect boundary context but duplicates evidence, inflates the index and causes near-identical results to crowd out distinct passages. Use a tokenizer aligned with the chosen embedding model when counting tokens, and re-check after model changes.

Keep heading paths, page or section anchors, table captions and source IDs as metadata. Do not split a table into isolated rows without retaining headers and units; do not join unrelated headings just to fill a target size. For procedures, keep prerequisites and warnings adjacent to the steps they constrain. Long sections can be recursively split at paragraph or sentence boundaries and linked to their parent. Store exact source offsets or stable anchors when available, rather than relying on a generated chunk number that shifts after edits.

## 03 Experiment design and trade-offs

Use a fixed corpus snapshot, deterministic parser and embedding version for all variants. Change one factor at a time first, then test interactions such as chunk size with overlap or parent expansion. Ensure candidate indexes use equivalent metadata and filtering; otherwise retrieval differences may reflect configuration rather than boundaries. Keep a fixed query set and random seed where the implementation supports it. Run repeated evaluations where ranking has nondeterminism and report uncertainty, not only the best run.

A smaller chunk can improve pinpoint lookup and reduce irrelevant context, but can lose definitions, exceptions or referents. A larger chunk can preserve coherence and lower per-document vector count, but dilute retrieval, exceed context limits, and make citations less precise. Semantic segmentation can respect document structure but may yield highly variable chunk lengths and depend on parser quality. Parent-child retrieval may improve context coherence but complicates deduplication, permissions and citation mapping. Overlap is a recall hedge, not a substitute for preserving structure. Make operational cost visible: embedding tokens, index storage, ingest duration, query latency and refresh cost.

## 04 Failure modes and promotion

Common errors include optimizing against synthetic questions only, tuning against one document category, using a judge model as the sole correctness oracle, changing chunking and embedding model together, and counting a near-duplicate as independent evidence. Citation metrics may look healthy when the cited parent document is correct but the selected passage is irrelevant. Include adversarially difficult but benign cases such as references to “the previous section,” definitions introduced earlier, and a table whose key is on another page.

Promote a strategy only if it meets predefined thresholds on retrieval and answer quality without an unacceptable regression in latency, token spend, citations, or critical strata. Keep a rollback-capable index generation and record parser, chunker, tokenizer and embedding identifiers with the evaluation artifact. Re-run a small acceptance suite after parser, source-format or model changes; rerun the broader set for a changed segmentation policy. A before/after corpus diff helps reveal shifts caused by changed boundaries rather than source edits.

## 05 Review checklist

- Does the dataset represent source types, query types, hard boundary cases and unanswerable questions?
- Is the evidence span annotated at passage granularity, with document revision and citation anchor?
- Are segmentation, overlap, tokenizer, parser and embedding settings recorded and controlled?
- Are the compared strategies structurally fair and evaluated on the same corpus and query set?
- Are quality and cost measured together, with results segmented by risk-relevant category?
- Have humans checked false positives, lost context, table coherence and citation precision?
- Is promotion gated and rollback possible without losing newer source updates?

For broader AI practice resources, see [the owner's AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Generative AI with RAG](https://docs.cloud.google.com/architecture/rag-reference-architectures): Google Cloud's RAG architecture index (page says last reviewed 2025-09-22); a reference architecture, not a chunk-size recommendation.
- [Create a Vector Query](https://learn.microsoft.com/en-us/azure/search/vector-search-how-to-query): Microsoft Learn documentation on vector query configuration; use to understand provider-specific query parameters and recheck them as the service evolves.
- [Vector Search Overview](https://learn.microsoft.com/en-us/azure/search/vector-search-overview): Microsoft Learn overview of vector search and vector indexes, not evidence that one segmentation strategy is universally optimal.
