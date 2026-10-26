---
title: "Knowledge freshness and invalidation"
description: "Define freshness by source authority, update signals and risk-specific staleness limits, then propagate changes to every derived layer."
type: guide
tags:
  - ai
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Freshness is not simply the age of an embedding or the timestamp of the most recent successful sync. A record may be newly indexed from a stale export, or old but still authoritative. Define what “current” means for each source and use source revision signals, effective dates and ownership to manage updates. The freshness and staleness behavior described in [[rag-over-runbooks-for-on-call]] is a useful serving baseline; this note makes source-to-index invalidation an explicit lifecycle contract.

## 01 Define freshness semantics

For each source, identify its authoritative system, change token or event feed, expected polling or delivery delay, deletion signal, outage behavior and freshness objective. Separate content freshness from permission freshness: ACL changes may need faster propagation than ordinary text edits. Distinguish source publication date, source modification time, ingestion observation time, index commit time and last successful verification. These timestamps answer different questions and should not be collapsed into one “updated” field.

Assign staleness categories based on consequence. Operational instructions, incident contacts, access policy, regulations and fast-changing product docs may need short refresh intervals or live-source checks; historical reference content may tolerate longer intervals. A freshness target is not a claim that the data is correct, and a connector watermark does not prove all records were discovered. Publish a user-visible “as of” timestamp only when its meaning and scope are clear.

## 02 Change detection and propagation

Use authoritative change events where reliable, supplemented by periodic reconciliation to detect missed events. Store source ID, source revision, content checksum, ACL revision, processing versions and index generation. On a source update, re-fetch a consistent version, process idempotently, and publish the new document-level set only after validation. Prevent an older worker or delayed event from overwriting a later revision by comparing source versions at commit time. If source version ordering is unavailable, serialize per record or re-read before publish.

Propagate changes to all derived systems: vector and lexical indexes, graph nodes and edges, answer summaries, caches, replicas and evaluation snapshots where policy requires. Deletion and access revocation need explicit tombstones and acknowledgments. Keep tombstones long enough to prevent delayed retries from resurrecting withdrawn content. A re-indexing failure should retain the last known-good version only under an approved stale-serving policy; for high-risk sources, fail closed or show a clear stale state rather than silently serving old content.

## 03 Reconciliation and user-visible staleness

Measure event lag from source change to searchable commit, separately from scheduler delay and provider queue time. Reconcile counts and revision samples against source systems at a cadence appropriate to the source risk. Alert on missing heartbeats, stalled watermarks, unexplained document count changes and deletion lag. Make connector outages visible; absence of a sync is not proof of no change. Store a per-source freshness state such as current, delayed, unknown or quarantined, with a reason and last confirmed watermark.

When a query depends on stale material, choose a controlled response: exclude the source, retrieve but label it, fetch the live source if allowed, or abstain. Do not let a model convert a stale passage into current tense. If a source has an explicit effective or expiry date, evaluate it as data with timezone and status handling, not by approximate age. Check access again on live fetch and keep the latency and outage consequences visible.

## 04 Failure modes and review checklist

Typical failures are dropped webhook events, token pagination limits, clock skew, update storms, inconsistent ordering, cache entries that survive an index refresh, and retries that revive deleted records. A freshness metric based only on latest job success can conceal one permanently skipped source. A strict freshness deadline can also create outages if upstream systems are unreliable; choose a safe fallback with owners rather than letting application code improvise.

- Is each source's authority, change signal, deletion behavior and acceptable staleness documented?
- Are content and ACL freshness independently measured and refreshed?
- Are event processing, retries and full reconciliation idempotent and ordered safely?
- Do all derived indexes, graphs and caches receive updates and tombstones?
- Can operators see per-source current/delayed/unknown/quarantined status and lag?
- Does stale serving require explicit approval and a user-visible indication?
- Are tests included for missed events, out-of-order updates, deleted records and source outages?
- Can a source owner confirm that the chosen freshness objective is appropriate to impact?

For broader AI practice resources, see [the owner's AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Generative AI with RAG](https://docs.cloud.google.com/architecture/rag-reference-architectures): Google Cloud architecture index; its fetched page says last reviewed 2025-09-22. Treat architecture guidance as an example rather than a freshness SLA.
- [RAG infrastructure for generative AI using Agent Platform and Vector Search](https://docs.cloud.google.com/architecture/gen-ai-rag-vertex-ai-vector-search): Google Cloud reference architecture page, last reviewed 2026-10-16 on the fetched page; illustrates ingestion and serving flow, not source authority semantics.
- [HTTP Caching (RFC 9111)](https://www.rfc-editor.org/rfc/rfc9111): IETF Internet Standards Track specification for HTTP cache behavior; useful for protocol cache semantics, not a complete RAG invalidation design.
