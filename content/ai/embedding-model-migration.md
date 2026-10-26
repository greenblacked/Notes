---
title: "Embedding model migration"
description: "Migrate vector representations with explicit compatibility checks, parallel evaluation and a reversible index cutover."
type: guide
tags:
  - ai
  - reliability
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

An embedding model is part of the index schema, not an interchangeable endpoint. A new model may change dimensions, normalization, language behavior, token limits and semantic geometry. Query vectors must be compatible with the indexed document vectors, so a model update generally requires a new embedding generation rather than an in-place endpoint swap. Coordinate with [[model-version-pinning-and-upgrade-evals]] for model inventory and retirement gates; this note covers corpus-vector migration mechanics.

## 01 Define the compatibility boundary

Record model/provider identifier, revision where offered, dimensions, input limits, task or modality, preprocessing, normalization, distance metric and provider-specific prefixes. Treat these as a versioned contract; verify current constraints rather than assuming an alias is fixed. Validate vector dimensions, finite values and normalization before indexing; reject malformed output rather than truncating or padding it.

Compatibility is not established just because two models emit arrays of equal length. Similarity scores from different models need not share meaning or scale. Do not query a legacy vector collection with new-model query vectors, or combine scores without explicit calibration. If both document and query encoders are changed, compare pairings supported by the provider and test the exact production preprocessing path. Text that was redacted, normalized or split differently is also a different input; preserve a separate content-processing version.

## 02 Build parallel generations

Create a new logical index generation and populate it from the authoritative current corpus using the proposed embedding contract. Keep the old generation serving while backfill proceeds. Use a manifest keyed by source ID, source revision, chunk ID and processing version so retries are idempotent and progress is measurable. Prefer reading the current source snapshot or a versioned export; if source content changes during backfill, enqueue the latest version and prevent an older worker from overwriting it.

Use bounded concurrency and provider-aware retry handling. Track completed, skipped, rejected and pending documents, not just total vector count. A partial backfill may still appear healthy for recently updated files while missing older important material. Validate mapping between chunks and parent documents, ACL metadata, citations and deletion tombstones before any traffic. Avoid retaining raw content in job logs. Index publication should be atomic at the logical alias or routing layer if supported; otherwise use an application-level generation pointer and explicit rollback path.

## 03 Evaluate comparable behavior

Run both generations against the same frozen set of queries and corpus version. Measure retrieval evidence recall, ranking quality, answer correctness, citation alignment, abstention, latency, throughput, and cost. Segment by language, document class, query length, rare terminology, acronyms and hard negative examples. Evaluate both query embeddings and stored-document embeddings from the new model. Keep generation settings and reranker constant during initial comparison so the migration signal is attributable.

Compare score distributions but do not use a global threshold copied from the old model. If downstream ranking combines vector and lexical scores, recalibrate fusion and reranking after the new vectors are introduced. Human-review samples where the new model changes top results, particularly high-impact policy or operational content. Define minimum acceptance and rollback criteria in advance; examples include a material recall drop on critical questions, permission-filter regression, elevated error rate, or unacceptable p95 latency. Thresholds should be based on service risk and baseline variance, not an arbitrary universal number.

## 04 Cutover, rollback and retirement

Use a canary by low-risk query cohort or controlled percentage after offline checks pass. Keep the generation identifier in traces and dashboards. Verify filter behavior, source versions and citation links using real service requests before expanding. Avoid dual retrieval to the model if context limits or privacy rules do not allow both result sets. Cutover changes the selected generation, not the source of truth.

Maintain the old index until the rollback window passes and the new generation has demonstrated healthy ingestion, query behavior and deletion propagation. Rollback is routing back to old vectors, not restoring stale source content; continue applying source updates and ACL/deletion events to both generations during the window or have a safe catch-up process. Retire the old generation only after owners approve, outstanding readers are drained, and cost/retention consequences are understood. Keep migration manifests and aggregate evaluation evidence, but apply the normal retention policy to source text and vectors.

## 05 Failure modes and review checklist

Frequent failures are dimension mismatch, silent model alias movement, preprocessing divergence, race conditions between backfill and live updates, vector counts that conceal missing coverage, stale permissions copied into the new generation, and score thresholds that no longer mean the same thing. Watch provider errors, quota throttling, missing-vector ratio, version lag, query latency, retrieval metrics and generation-specific answer feedback.

- Is the target model version and full vector contract recorded and checked against official current docs?
- Are all source changes during backfill reconciled without stale overwrites?
- Do validators cover dimensions, finite values, counts, ACLs, citations and deletion state?
- Were old and new vectors evaluated on the same corpus and query set with risk-stratified review?
- Are fusion weights, thresholds, cache keys and telemetry labeled by generation?
- Can traffic be returned to a maintained old index while preserving current source updates?
- Has retirement been delayed until a named owner accepts the quality and retention evidence?

For broader AI practice resources, see [the owner's AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Text embeddings](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings): Google Cloud API documentation reached by live fetch from the former Vertex AI URL; it describes current text embedding behavior. Model identifiers and dimensions can change; re-check before use.
- [Vector Search overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/vector-search/overview): linked from Google's currently served RAG architecture as its Vector Search overview; verify current product naming and capabilities before implementation.
- [Generative AI with RAG](https://docs.cloud.google.com/architecture/rag-reference-architectures): Google's architecture index, last reviewed 2025-09-22 as stated on the fetched page; use as a design example only.
