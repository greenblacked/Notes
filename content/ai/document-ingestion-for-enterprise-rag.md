---
title: "Document ingestion for enterprise RAG"
description: "Build a governed ingestion path that turns changing enterprise documents into searchable, traceable retrieval units."
type: guide
tags:
  - ai
  - security
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Enterprise retrieval begins with an accountable source and a repeatable transformation, not with an embedding call. Ingestion must retain enough identity and lineage to answer which source version produced a passage, whether the caller may see it, and how to remove it when its authority ends. The reference architecture in [[rag-over-runbooks-for-on-call]] focuses on answer-time access, citations, staleness and evaluation; this note concentrates on the upstream lifecycle that supplies its retrieval corpus.

## 01 Source contract and boundaries

Inventory each repository, drive, ticket system or database as a governed source. Record its owner, authority, export/API, update and deletion signals, sensitivity, tenant boundary and freshness expectation. Do not assume a successful sync proves completeness: document omissions such as attachments, comments, inherited permissions or archived versions. The source contract names a stable identifier, revision token and canonical human-readable link.

Obtain source-owner approval before indexing, and use a dedicated identity with read-only access to the minimum collection. Separate collection discovery from content reads. Exclude records by an explicit rule where indexing is not permitted; retain an auditable count and reason rather than silently filtering. Apply the data-minimization and redaction policy before content reaches an embedding or generation provider; see [[redacting-sensitive-data-before-llm-calls]]. Keep original content in its authoritative system, not in an ungoverned staging bucket.

## 02 A replayable ingestion design

Use a staged pipeline: discover changed source records; fetch a consistent version; normalize format and encoding; extract text and structure; classify sensitivity and access metadata; redact or reject; split into retrieval units; embed; then publish an index generation. Persist an ingestion manifest keyed by source ID and source version, with parser and policy versions, content checksum, timestamps, outcome, and stable chunk IDs. Make every step idempotent so a retry either safely resumes or replaces exactly the same derived records.

Stage outputs in restricted, short-lived storage and validate before publishing. Dead letters should retain a bounded error and source reference, never secret text. Bound batch size, retries and backoff to respect source/model quotas. Quarantine malformed or unsupported files with an owner-visible reason. Publish only after validation, so readers see the prior complete generation or the next one.

## 03 Parse quality and access metadata

Choose parsers by source type and preserve headings, tables, page numbers, anchors and document boundaries. Record parser identity and extraction warnings. Test scanned, tabular, long and multilingual files. OCR is lossy: retain page references and confidence or review flags where available, and route low-quality output for remediation rather than presenting it as exact text.

Capture ACLs from the authoritative system as structured principal references, not as text injected into the passage. Store source identity, version, effective time, classification, tenant, ACL snapshot/version and canonical citation target on each retrieval unit or a securely joined parent record. ACL semantics differ across source systems; model group nesting, inheritance, deny rules and revocation behavior explicitly. If an ACL cannot be fetched or interpreted, fail closed for that record. Avoid embedding private permissions or sensitive metadata in vector fields sent to services that do not need them.

## 04 Versioning, updates and deletes

Treat reprocessing as a new derived version. Compare stable source version and normalized-content checksum to avoid costly no-op embeddings, while still refreshing ACLs independently because permissions can change without content changes. For replacement, stage new chunks and vectors, validate count and metadata, then atomically switch a document-level pointer or index generation. Do not expose partial chunks while the remainder is still processing.

Propagate deletion or withdrawal through vector and lexical indexes, graph edges, caches and staging copies. Retain a tombstone until consumers acknowledge it; a connector outage is not evidence of deletion. Include failed and superseded versions in retention rules and preserve only the provenance needed to show what was removed and when.

## 05 Failure modes and operating checks

Common failures include silent connector truncation, parser changes that alter tokenization, duplicate ingestion from unstable IDs, indexing an old snapshot after a newer one, stale ACLs, partial vector publication, and logs that copy document text. Monitor source lag, discovered-versus-processed counts, parse rejection rate, duplicate rate, ACL age, version skew, deletion lag, embedding errors and index publication failures. Segment metrics by source and pipeline version, not by customer-identifying content.

A successful job is not proof of a correct corpus. Sample against the source, compare counts and watermarks, and test citations, permission changes and removals. On quality loss, stop promotion, retain the last good generation, and replay only after diagnosing the source or parser. Coordinate triage with [[llm-observability-tracing-and-slos]] without logging raw content.

## 06 Review checklist

- Is each source approved, owned, read-only and covered by a documented contract?
- Can every chunk be traced to a stable source ID, source version and parser/policy version?
- Are ACLs refreshed independently of content, and does uncertainty deny retrieval?
- Are retries idempotent, failures quarantined, and generations published atomically?
- Do deletion tests cover every index and cache, with measurable completion lag?
- Do extraction tests cover tables, scans, long documents, multilingual text and parser upgrades?
- Are staging, logs, dead letters and backups subject to the same retention and access controls?
- Can operators pause a bad run and restore the prior generation without discarding newer valid changes?

For broader AI practice resources, see [the owner's AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Generative AI with RAG](https://docs.cloud.google.com/architecture/rag-reference-architectures): Google Cloud architecture overview; reviewed in the live page, which states last reviewed 2025-09-22. Treat its provider-specific architecture as an example, not a universal connector contract.
- [RAG infrastructure for generative AI using Agent Platform and Vector Search](https://docs.cloud.google.com/architecture/gen-ai-rag-vertex-ai-vector-search): Google Cloud's ingestion and serving reference architecture, last reviewed 2026-10-16 on the fetched page; service names and interfaces can change.
- [PROV-O: The PROV Ontology](https://www.w3.org/TR/prov-o/): W3C Recommendation (2013) for representing entities, activities and agents in provenance records.
