---
title: LLM data pipeline quality controls
description: Add observable, fail-safe validation from source ingestion through preprocessing and evaluation data publication for AI workloads.
type: guide
tags:
  - ai
  - reliability
  - supply-chain
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Treat model input data as a product

AI data pipelines can fail silently: schema drift, encoding changes, duplicate records, malformed documents, unexpected empty fields, label leakage, stale source snapshots, or transformation bugs may still produce a technically successful job. Quality controls should make those conditions visible before data reaches training, fine-tuning, retrieval indexing, evaluation, or production inference.

Define the data contract at each boundary. Record required fields, types, allowed nulls, valid ranges, provenance, timestamps, and intended use. Keep source-specific parsing separate from canonical transformation. Version the schema and transformation code so that a dataset can be traced to the input snapshot and process that created it. Do not imply that a syntactically valid file is an accurate or representative dataset.

This is distinct from moving and promoting model weights, covered by [[model-artifacts-in-artifactory|model artifacts as supply-chain artifacts]]. Here the focus is quality of the data used to build, evaluate, or feed AI systems.

## Use layered controls

At ingestion, validate transport and file integrity, expected format, schema, encoding, and source identity. At transformation, validate invariants such as row counts, deduplication rules, timestamp ordering, and allowed normalization. At publication, run quality checks on the resulting dataset and produce a manifest with source references, transformation version, checks, and outcome.

Use both deterministic checks and sampled review. Deterministic tests can check schema, null ratios, bounds, exact duplicate keys, and distribution changes. They cannot prove semantic correctness or absence of harmful bias. Human review and domain-specific evaluation are needed for examples where the interpretation matters. Protect sensitive data during sampling and review; minimization and access control apply to test data as well as production.

Define handling for failures. A failed critical invariant should block publication or quarantine the batch rather than quietly pass partial output. Non-critical anomalies can produce a warning if an owner, threshold, and follow-up path are clear. Record counts before and after each filter to identify accidental drops. Avoid a single “quality score” that hides a severe defect in one dimension.

For streaming data processing, delivery guarantees are not the same as data correctness. Google Cloud Dataflow documents its own exactly-once processing behavior and limitations; custom sinks and side effects still require careful semantics. For bounded transformations or transactional publication, use the platform's documented primitives and test replays.

## Monitor drift and lineage

Track data freshness, volume, schema version, rejected records, duplicate rate, and selected feature or text-length distributions. Set alert thresholds with domain owners and seasonality in mind. A shift can be legitimate, but a silent shift can invalidate an evaluation set or retrieval index. Preserve representative snapshots so a regression can be reproduced without relying on a moving source.

Capture lineage from source to derived dataset, and from the dataset to model/evaluation artifact. Store enough metadata for reproducibility without storing unnecessary personal or confidential content. Make dataset access and retention consistent with the purpose and applicable policies. Keep immutable manifests or content hashes, while remembering that hashes can still be sensitive identifiers in some contexts.

## Failure modes and checklist

- **Schema drift:** producer changes field meaning or type. Version contracts and reject or route unknown schema to quarantine.
- **Silent data loss:** parser drops malformed rows without surfacing counts. Record stage-level counts and thresholds.
- **Duplicate/replayed input:** rerun creates duplicated examples. Define stable identity and deduplication semantics.
- **Misleading quality metric:** aggregate score masks broken segments. Track slices and critical invariants independently.
- **Stale evaluation data:** release gate does not reflect current use. Record date, source, and intended population.
- **Sensitive test exposure:** review samples leak private data. Minimize, redact, restrict, and expire samples.

### Checklist

- Document contracts, owners, source provenance, intended use, and retention.
- Validate schema and invariants at ingestion, transformation, and publication boundaries.
- Track rejected records and before/after counts; quarantine critical failures.
- Add sampled domain review and segment analysis for semantic quality.
- Version data snapshots, code, checks, and manifests for reproducibility.
- Alert on freshness, volume, schema, and meaningful distribution changes.

The tradeoff is between strict gates that can delay a release and permissive processing that may publish a defective dataset. Make critical checks blocking, give warning thresholds an owner and expiry, and rehearse recovery from a bad published batch.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Exactly-once in Dataflow | Google Cloud Documentation](https://docs.cloud.google.com/dataflow/docs/concepts/exactly-once): Dataflow delivery and processing behavior; it does not establish semantic correctness of records.
- [Multi-statement transactions | BigQuery](https://docs.cloud.google.com/bigquery/docs/transactions): BigQuery transaction semantics for atomic data operations; verify supported operations and current service behavior.
- [AI Risk Management Framework | NIST](https://www.nist.gov/itl/ai-risk-management-framework): NIST AI RMF 1.0, published January 2023; NIST says revision is underway, so it is cited as a dated framework rather than an unrevised current standard.
