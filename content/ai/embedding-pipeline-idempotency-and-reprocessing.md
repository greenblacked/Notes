---
title: Embedding pipeline idempotency and reprocessing
description: Make embedding generation and index updates restartable with stable identities, versioned transformations, and safe reprocessing boundaries.
type: guide
tags:
  - ai
  - reliability
  - supply-chain
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Why reruns need a design

Embedding pipelines are often retried after partial failure, source correction, model change, or chunking update. A naive rerun can duplicate records, mix vectors from incompatible model versions, or delete a valid index before replacement is ready. Idempotency means that processing the same logical input repeatedly has a controlled, equivalent effect; it does not mean that every provider call is free, deterministic, or side-effect-free.

Separate source document identity, source revision, chunk identity, embedding configuration, and index destination. A stable key might be derived from canonical source ID plus revision and chunk ordinal or content hash; the exact scheme depends on whether source edits should replace or append versions. Include the embedding model identifier and transformation version in the output manifest. Do not rely on a provider's mutable alias as the sole identity.

Embedding generation mechanics and vector API behavior are provider-specific. See [[model-version-pinning-and-upgrade-evals|model version pinning and upgrade evaluations]] for a related release-control pattern; this note focuses on the repeatability and recovery of the data pipeline.

## Make each stage replayable

Use explicit pipeline stages: source snapshot, normalization, chunking, embedding request, result validation, and index publication. Persist progress using stable keys and record state transitions so a restart can determine which items are complete. A successful generation call should not imply that index publication succeeded; retries should resume at the failed boundary where possible.

Validate every response against expected dimensions, finite numeric values, and the model/configuration recorded for the batch. Provider responses can change shape or fail partially; check current API docs for response contracts and limits rather than embedding assumptions. Store embeddings in a staging area with provenance before changing the serving index. This allows consistency checks and rollback without a period where the old index has been destroyed and the new one is incomplete.

At publication, prefer an atomic alias or version switch if the chosen vector store supports it; confirm its semantics in that system's documentation. Otherwise, use a controlled dual-index cutover and maintain a clear reader version. Avoid writing to a live index using a new embedding model while old vectors remain, unless the retrieval design explicitly supports mixed dimensions and spaces. Similarity scores across different embedding spaces should not be treated as directly comparable by default.

## Reprocessing and cost control

Define what triggers a full rebuild: embedding model change, chunking policy change, source schema change, or a quality correction. For source-only edits, update only affected document revisions when the index's consistency model allows it. Keep the deletion or tombstone policy explicit so removed content does not remain retrievable indefinitely. If a rebuild must remove old records, do so only after the replacement passes validation and readers can switch safely.

Reprocessing can create a large burst of API calls and index writes. Use bounded concurrency, queue limits, and checkpointing. Respect provider-specific rate limits and capture retry responses; do not retry all errors identically. Make operation cost and completion progress visible. For embedding generation, caching by a stable content-and-configuration key may reduce duplicate work, but avoid exposing sensitive content through shared caches or logs.

Test partial completion, duplicate messages, worker crash after provider success, timeout after index write, source deletion, and model change mid-run. These are the conditions that reveal whether the process is actually replay-safe. Keep an immutable manifest of input snapshot, transformation version, model ID, output count, error count, index target, and cutover result.

## Failure modes and checklist

- **Duplicate vectors:** retry writes append instead of upsert. Use stable record keys and verify sink semantics.
- **Mixed embedding versions:** a partial run writes to the active index. Stage by configuration and cut over only after validation.
- **Lost successful response:** provider completed but worker timed out. Reconcile by stable job or item identity where possible.
- **Stale deleted content:** source removal is not propagated. Define tombstones, retention, and verification queries.
- **Unsafe rebuild:** replacement index is incomplete when readers switch. Validate counts and sampled retrieval before cutover.
- **Retry storm or cost spike:** concurrent replay saturates provider or budget. Bound workers and use provider-aware backoff.

### Checklist

- Define stable source, revision, chunk, model, and transformation identities.
- Persist stage state and make writes idempotent or reconcilable.
- Validate vector dimensions and response completeness before publication.
- Build in staging; verify index consistency and sampled retrieval before cutover.
- Bound retries and concurrency; record provider response classes and job cost.
- Test replay after failure at every side-effect boundary and rehearse rollback.

The tradeoff is between immediate visibility and safe publication. Incremental updates reduce freshness delay, but full rebuilds can simplify consistency when embedding spaces change. Choose based on vector-store capabilities and make the active index version explicit.

Google Cloud's RAG infrastructure reference can provide one implementation example, but its page reports last reviewed 2025-09-22; treat it as dated architecture context rather than current service guidance.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Vector embeddings | OpenAI API](https://developers.openai.com/api/docs/guides/embeddings): OpenAI-specific embedding request and response behavior; confirm model and API details before implementation.
- [Get text embeddings | Gemini Enterprise Agent Platform](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings): Google Cloud embedding API behavior; provider-specific.
- [Exactly-once in Dataflow | Google Cloud Documentation](https://docs.cloud.google.com/dataflow/docs/concepts/exactly-once): Dataflow processing guarantees and limitations; external side effects still need idempotent handling.
- [RAG infrastructure for generative AI using Agent Platform and AlloyDB for PostgreSQL](https://docs.cloud.google.com/architecture/rag-capable-gen-ai-app-using-vertex-ai): Google Cloud architecture example, last reviewed 2025-09-22; use as dated reference, not a guarantee of current product behavior.
