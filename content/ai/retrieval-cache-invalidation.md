---
title: "Retrieval cache invalidation"
description: "Cache retrieval work only with keys and invalidation signals that preserve authorization, freshness and index-generation correctness."
type: guide
tags:
  - ai
  - reliability
  - cost
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Caching can reduce repeated embedding, search and reranking work, but a retrieval result depends on more than the normalized query. It may depend on tenant, principal permissions, filters, source freshness, index generation, model versions and locale. An unsafe cache can return unauthorized or outdated context even when the underlying index is correct. Apply the source and access guarantees in [[rag-over-runbooks-for-on-call]] before deciding which stages can be cached.

## 01 Decide what to cache

Separate stages: query embeddings, candidate IDs and scores, reranked candidates, assembled context, and final generated answers. Each has different invalidation and privacy risks. Query embeddings are often less sensitive than source-bearing context but can still encode user intent; apply the relevant retention policy. Candidate lists and assembled context may include private content and require authorization on every hit. Final answer caches are the hardest to validate because responses can embed source excerpts, user-specific assumptions or outdated claims; avoid them unless the use case and correctness model are explicit.

For each stage, specify expected reuse, maximum age, sensitivity, invalidation events, ownership and a cacheability decision. If the stage cannot be revalidated cheaply, use a short lifetime or do not cache it. A time-to-live is only a bound on age, not proof of freshness or revocation. A cache hit should never bypass required permission checks or produce a citation to a source that no longer exists.

## 02 Construct safe keys and values

A key should include a canonical query representation, tenant scope, authorization or policy revision, applied filters, locale, corpus/index generation, embedding version, retrieval configuration and reranker version when those affect the result. Use a keyed digest for sensitive query components rather than storing raw prompts in key names. Include a schema version so key semantics can change deliberately. Avoid key dimensions that are user-controlled without normalization and bounds, which can create unbounded cardinality.

Store stable evidence IDs and source revisions when possible, then re-fetch and re-authorize before returning content. If content is stored in cache, protect it as source-equivalent sensitive data: encrypt, restrict access, limit retention and avoid diagnostic dumps. For distributed caches, define tenant namespace, eviction behavior, replication and failure mode. When cache availability is lost, bypass only if the backing service can sustain the load; otherwise apply bounded degradation or reject requests rather than stampeding the index.

## 03 Invalidation design

Invalidate when the source revision changes, access is revoked, a document is deleted, tenant membership changes, index generation switches, chunking or embedding version changes, or ranking configuration changes. Use event-driven eviction for prompt invalidation, with periodic reconciliation and TTL as a backstop. Carry document and policy dependencies with cached result entries so targeted invalidation is possible. If a cache entry includes many documents, evict it when any dependency changes or avoid caching that composite result.

Define ordering carefully: an invalidation event must not be lost because it arrives during a cache write. One approach is to version cache namespaces by corpus generation or policy epoch and advance the active epoch only after the corresponding index changes are visible. Per-document versions or tags can reduce broad eviction but add race conditions and metadata complexity. Verify provider cache behavior rather than assuming that deleting an index document also purges an external application cache.

## 04 Failure modes and operations

Typical failures include cache stampedes, stale-while-revalidate serving after revocation, cross-tenant key collisions, invalidations arriving before a delayed stale write, versioned indexes sharing keys, and caching a fallback result as if it were normal. Record hit ratio, age, invalidation lag, eviction failures, version mismatches and stale-hit blocks. Do not include raw prompts or document content in metrics. A low hit ratio is not automatically a reason to weaken the key or lengthen retention; first check workload locality and query normalization.

Test permission revocation and deletion while cached entries are hot, including concurrent writes and a cache outage. Verify that stale entries are rejected even if physical eviction is delayed. During incident handling, disable only the affected cache layer if safe, then monitor backing-system capacity and latency. Roll back a cache-schema change by switching version namespaces, not by reusing keys whose meaning changed.

## 05 Review checklist

- Is every cached stage identified with its data sensitivity and validity conditions?
- Do keys include tenant, policy, filters, index/model/ranking versions and schema version?
- Is authorization rechecked before content is returned, including cached citation resolution?
- Are updates, revocations and deletes linked to reliable invalidation plus reconciliation?
- Can delayed stale writes repopulate entries after invalidation?
- Are TTLs, cache outage behavior, stampede controls and backing capacity tested?
- Are cache values protected and logs free of sensitive content?
- Can an operator disable or roll back a cache generation without broad permission changes?

For broader AI practice resources, see [the owner's AI skills catalogue](https://ai.szolotov.com).

## Sources

- [HTTP Caching (RFC 9111)](https://www.rfc-editor.org/rfc/rfc9111): IETF Internet Standards Track specification for HTTP caching semantics; it does not define application-level RAG invalidation.
- [Vector Query Filters](https://learn.microsoft.com/en-us/azure/search/vector-search-filters): Microsoft Learn page on vector filters; cached query output must preserve the underlying policy semantics.
- [Generative AI with RAG](https://docs.cloud.google.com/architecture/rag-reference-architectures): Google Cloud RAG architecture index, last reviewed 2025-09-22; cache stages and eviction policy remain application design choices.
