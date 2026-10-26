---
title: "Vector index capacity and lifecycle"
description: "Plan vector-index growth, rebuilds, retention and retirement using measured workload and recoverability requirements."
type: guide
tags:
  - ai
  - reliability
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

A vector index has both a query-serving role and a derived-data lifecycle. Capacity planning that counts vectors alone misses metadata, replicas, graph structures, lexical fields, temporary rebuild space and recovery headroom. This note extends the architecture and monitoring concerns in [[rag-over-runbooks-for-on-call]] into explicit growth, refresh and retirement controls; service-specific limits must be checked in the selected platform's current documentation.

## 01 Model the workload before estimating

Inventory corpus size, average and tail chunk counts per document, vector dimensions and numeric representation, metadata and filter cardinality, expected replicas, query rate, concurrency and ingestion burst shape. Measure the real encoded representation in a staging index rather than multiplying raw dimensions by bytes and treating that as final capacity. ANN structures and service-managed replication introduce overhead that varies with engine, configuration, implementation and data distribution. Account for index segments, deleted-but-not-yet-reclaimed records, lexical indexes, caches and temporary copy space needed for safe rebuilds.

Forecast separately for active searchable data and retained source versions. Set growth assumptions for new documents, updates, chunking changes and embeddings migration. Document freshness SLOs can drive burst throughput: a daily batch and a near-real-time feed have different peak requirements even for the same annual volume. Include a recovery budget for a full rebuild or regional recovery where applicable. Avoid extrapolating vendor benchmark throughput directly to your filter distribution, dimension, query mix or latency target.

## 02 Capacity controls and guardrails

Establish a baseline with a representative corpus and real query classes. Measure ingestion throughput, indexing lag, query p50/p95/p99, recall against an exact or trusted baseline where practical, error rates, utilization and cost. Run capacity tests at expected peak plus a justified margin; do not test only empty or uniformly random vectors. Include selective and broad metadata filters, burst ingestion and concurrent updates. Record configuration, service tier, region and date because provider limits and performance characteristics evolve.

Set alerts on leading indicators: capacity utilization, queue age, replica or shard health, rejected writes, throttling, indexing lag, disk pressure, segment or compaction backlog, and cost slope. Prefer a warning threshold that leaves time to scale, compact, partition or pause nonessential ingestion before query availability is threatened. Define an explicit admission policy for low-priority backfills when the serving index approaches its safe envelope. A quota is not a target; keeping headroom protects rebuilds and traffic bursts.

## 03 Index generations and rebuilds

Treat index mappings, embedding contract, chunking version, analyzers, distance metric, filter fields and service configuration as a versioned schema. A mapping or model change may require re-embedding or reindexing, depending on product capabilities; do not assume in-place mutation is lossless. Build a new generation beside the active one when you need a rollback window. Validate corpus coverage, vector integrity, filters, citations, deletion propagation and representative query quality before switching readers.

The overlap between generations is itself a capacity requirement. If a full second index is unaffordable, define the risk of a staged in-place rebuild and the available backup/reconstruction path rather than hiding the constraint. Reconstructability depends on retaining source records, stable parser code, model availability, metadata and the manifests that connect versions. Budget the time to re-embed, provider quotas and recovery-point gap. Confirm whether snapshots contain vectors, metadata, configuration, or only some of these before relying on them.

## 04 Retention and deletion lifecycle

Keep source-of-truth retention separate from index retention. A vector is derived data but can still disclose sensitive semantic information and remains subject to access, retention and deletion controls. Define retention for active chunks, superseded versions, tombstones, backups, staging outputs and evaluation fixtures. Ensure an update does not create an unbounded trail of old vectors. Deletion requests should update every serving and shadow generation and record acknowledgments before associated tombstones expire.

When a generation is retired, drain readers, remove aliases or routes, confirm no jobs can write into it, and follow platform-specific disposal and backup retention semantics. Preserve schema and aggregate operational records if needed, not stale content vectors by default. Validate the exact provider's behavior for soft deletion, compaction and snapshot expiry; do not claim that a delete is physically erased from every backup at the instant the query path stops returning it.

## 05 Failure modes and operational review

Capacity failures often look like relevance incidents: partial writes, rising lag, throttling or filters timing out can silently narrow candidate coverage. Other failures include using raw-vector arithmetic as a complete estimate, forgetting dual-generation costs, rebuilding from non-authoritative stale exports, and scaling replicas without checking that ingestion or query bottlenecks are actually addressed. Correlate retrieval quality with index generation, write lag and service health through low-cardinality telemetry, following [[llm-observability-tracing-and-slos]].

- Does the estimate use measured index size and representative data distribution?
- Are peak query and ingest workloads tested together, with headroom and rollback space?
- Are vector, metadata, lexical, replicas, backups, temporary generations and tombstones included?
- Is the recovery method proven from retained sources and manifests, with a time and quota estimate?
- Are growth and lag alerts tied to concrete scale, pause and recovery actions?
- Are deletion, retention, backup and final retirement semantics documented and owner-approved?
- Have current region, quota and service-tier constraints been checked immediately before a change?

For broader AI practice resources, see [the owner's AI skills catalogue](https://ai.szolotov.com).

## Sources

- [RAG infrastructure for generative AI using Agent Platform and Vector Search](https://docs.cloud.google.com/architecture/gen-ai-rag-vertex-ai-vector-search): Google's managed-vector-search reference architecture; the page reports last reviewed 2026-10-16. Its sizing is not a generic capacity formula.
- [Vector Search Overview](https://learn.microsoft.com/en-us/azure/search/vector-search-overview): Microsoft Learn overview of vector search and index considerations; provider configuration and limits are subject to change.
- [Generative AI with RAG](https://docs.cloud.google.com/architecture/rag-reference-architectures): Google Cloud architecture index (last reviewed 2025-09-22), useful for comparing managed and database-backed architecture options.
