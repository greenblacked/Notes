---
title: "Multi-tenant RAG isolation"
description: "Design tenant boundaries across ingestion, indexes, authorization, caches, logs and recovery rather than relying on one query filter."
type: guide
tags:
  - ai
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

A multi-tenant retrieval service must prevent one customer’s documents, metadata, embeddings, citations, cache entries and operational traces from appearing in another customer’s request. A tenant filter in the vector query is necessary in many designs but is not a complete isolation strategy. Start with the source authorization controls in [[rag-over-runbooks-for-on-call]] and test the entire request and data lifecycle as one security boundary.

## 01 Choose an isolation model

Choose among shared indexes with mandatory tenant filters, per-tenant logical partitions, and separate physical indexes or deployments. Shared resources can reduce cost and operational burden but raise blast radius if routing or filtering fails. Dedicated resources improve boundary clarity and may support customer-specific retention or residency, but increase capacity, upgrade, backup and monitoring complexity. Hybrid models can use dedicated physical separation for high-risk tenants and shared resources for lower-risk cases. Document the threat model, contractual needs, scale and recovery trade-offs.

Do not treat a client-provided tenant identifier as trusted. Derive tenant identity from authenticated claims resolved by server-side policy. Verify the resource being accessed belongs to that tenant before reading any content. Administrative tools, support access, cross-tenant analytics and maintenance jobs need separate identities and explicit approvals. Validate that service-to-service messages carry an authenticated tenant context, not merely a string label.

## 02 Propagate isolation through data flow

Include tenant identity in source manifests, ACL joins, document IDs, chunk IDs, index routing and cache namespaces. Prevent collisions by using stable composite identity or a cryptographically random identifier that does not expose customer names. Enforce tenant filters before returning candidate metadata or content, and apply the same rule to vector, lexical, graph, reranker, citation, export and fallback paths. An index-level partition is not authorization if application routing can point to the wrong partition.

Separate secrets, encryption keys, object storage prefixes, backup policies and access logs according to the chosen model. If using shared resources, ensure storage-layer IAM and service identity restrictions prevent arbitrary reads beyond the query API. Avoid placing one tenant's content into shared prompt caches or model fine-tuning data. Where provider features are used for tenant isolation, confirm their exact guarantees and failure modes in current documentation; product terminology alone does not establish a boundary.

## 03 Cache, telemetry and operations

Cache keys must include tenant, authorization context or a policy version, index generation, query normalization and any locale or filter dimensions that affect results. Never use a globally shared key based only on the query string. Cache values containing content require authorization checks before return, and revocation must invalidate entries. Aggregate telemetry should avoid document text and customer identifiers when possible; use tenant-safe pseudonyms only where operationally necessary, with access restrictions and retention limits.

Use per-tenant quotas and fairness controls to prevent noisy-neighbor workloads from degrading all tenants. Monitor indexing lag, rejection rates, errors, capacity, query latency and retrieval quality by bounded tenant cohorts without exposing one tenant's metrics to another. Backups and restores must preserve boundaries: restoring one tenant should not require exposing a shared snapshot to an unauthorized operator. Test migration, failover, deletion and disaster recovery using synthetic tenants.

## 04 Failure modes and assurance

Common isolation failures include missing filter clauses on one retrieval arm, identifiers reused across tenants, cache keys lacking tenant context, logging snippets in shared observability tools, support queries with ambient administrator credentials, and background backfills that write a document to the wrong partition. Search for these as data-flow paths, not only in a single query-builder function. Fail closed when authenticated tenant context is missing, inconsistent or unresolvable. Do not return cross-tenant “no results” diagnostics that disclose whether a record exists.

Run automated negative tests at API, retrieval, citation, cache, export and support-tool boundaries. Seed same-named documents with distinct synthetic content in two tenants; assert each user receives only its own content and metadata. Revoke access, switch tenant context, replay stale cache keys and exercise partial failures. Review identities and logs periodically. On suspected leakage, stop the affected retrieval path, preserve narrowly scoped evidence, follow the incident process in [[ai-assisted-incident-response]], and involve privacy/security owners.

## 05 Review checklist

- Is tenant identity derived from authenticated server-side claims at every entry point?
- Is the selected isolation model proportionate and documented with blast radius and cost?
- Are tenant boundaries enforced before content reaches rerankers, models, caches or citations?
- Are ACL filters equivalent across all retrieval arms and background jobs?
- Do cache keys, traces, metrics, backups and support access preserve tenant separation?
- Are missing context and policy-service failures deny-by-default?
- Do negative tests cover same-name records, revocation, retries, exports and disaster recovery?
- Are tenant-specific deletion and restoration procedures measurable and reviewed?

For broader AI practice resources, see [the owner's AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Zero Trust Architecture, NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final): NIST publication page dated August 2020; principles apply to resource access decisions but do not prescribe a particular RAG tenancy topology.
- [Vector Query Filters](https://learn.microsoft.com/en-us/azure/search/vector-search-filters): Microsoft Learn reference for filter behavior and modes in its search service; verify current semantics and API version.
- [Generative AI with RAG](https://docs.cloud.google.com/architecture/rag-reference-architectures): Google Cloud RAG architecture index, last reviewed 2025-09-22; architecture choices are provider-specific examples, not tenant isolation assurances.
