---
title: "Metadata filtering and ACL-aware retrieval"
description: "Apply authoritative, current permissions before retrieved content reaches a model, including through hybrid and cached paths."
type: guide
tags:
  - ai
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Metadata can narrow retrieval by tenant, source, date, classification or document type, but only authoritative access-control metadata determines whether a caller may see protected content. A filter applied after results are returned can already expose snippets to logs, rerankers or models. This note describes a defensive design that complements the runtime access controls in [[rag-over-runbooks-for-on-call]]; it is not a replacement for source-system authorization or a full security review.

## 01 Model the authorization decision

Identify the principal from a trusted authentication layer, then resolve its tenant, group membership and relevant claims through an authoritative identity service. Never accept tenant or role claims from query text, a client-supplied filter, or an unvalidated header. Map source-specific permissions into a documented retrieval policy that handles direct grants, group inheritance, deny rules, public or shared content, and revocation. Preserve enough source ACL version and evaluation time to reason about freshness.

Apply mandatory tenant and authorization predicates within the retrieval service before returning content. Where the provider supports prefiltering, understand its semantics and index-field requirements; where it does not, use a controlled authorization service to filter before content leaves the trusted boundary. Postfiltering can cause fewer than k results and can leak unauthorized candidate metadata into intermediaries. It must not be assumed equivalent to prefiltering. Ensure lexical, vector, graph, reranker, fallback and citation lookup paths all enforce the same policy.

## 02 Ingestion and query-time enforcement

Ingest ACL metadata separately from passage text. Normalize principals into stable internal identifiers, preserve source ACL version, and avoid embedding ACL strings into vectors. Refresh permissions when they change even if text is unchanged. If a source denies access, its ACL endpoint is unavailable, or group resolution is ambiguous, exclude the record until a trustworthy decision is available. A stale allow is more dangerous than temporary unavailability; define any grace period explicitly with the data owner and risk owner.

At query time, compute server-side filter clauses from the authenticated context, combine them with user-selectable narrowing filters, then prevent the client from weakening mandatory clauses. Validate that the result set contains only authorized IDs before sending it to a reranker or language model. Citation rendering must re-check authorization when users open a source link because permissions can change after retrieval. If access is denied at citation time, show a generic unavailable indication rather than cached excerpts.

## 03 Scale, semantics and trade-offs

Embedding every user/group combination into index partitions may be efficient for a small fixed tenant set but can multiply indexes, make membership updates expensive and complicate cross-tenant operations. A shared index with tenant and ACL filters may reduce duplication but increases the impact of a filter bug and requires careful query construction and testing. Separate physical indexes can create stronger operational boundaries but raise cost and management overhead; they still require correct identity and routing. Choose based on threat model, tenancy contract, scale, latency and restore requirements, not convenience alone.

Filter cardinality, nested ACLs and group expansion affect index design and query performance. Test representative large memberships and documents with deep inherited ACLs. Avoid a permissive default such as “no filter means all records.” Missing or malformed policy metadata must fail closed, and admin/break-glass access should be explicit, time-bounded and audited separately. Use synthetic identifiers in tests, not production personal data.

## 04 Failure modes and assurance

Typical failures include indexing only direct grants, dropping inherited permissions, stale group membership, parsing a client filter as trusted policy, using inconsistent pre/postfilter modes across lexical and vector search, and checking access only when citations render. Cache keys must include tenant and a permission-policy version or a safe authorization decision; cached content must not outlive revocation. For caching details see [[retrieval-cache-invalidation]]. Test negative cases by asserting forbidden IDs are absent at every interface, not merely hidden in the UI.

Monitor ACL synchronization lag, failed identity lookups, missing policy metadata, denied result counts, tenant filter application, and access-check errors. Do not log principals or document titles unless required and protected. Periodically reconcile sampled index ACLs against source-system decisions and test revocation propagation end to end. Review the trust boundary with security, data owners and the identity team whenever provider filtering semantics or tenancy changes.

## 05 Review checklist

- Is the principal derived from verified authentication, with tenant and roles resolved server-side?
- Do filters represent source ACL semantics, including inheritance, groups and explicit denies?
- Does authorization happen before reranking, model context, logging, citations and cache returns?
- Do all retrieval arms and fallback paths enforce identical mandatory predicates?
- Does missing or stale ACL information fail closed, and is lag measurable?
- Are negative cross-tenant and revocation tests run against the production query path?
- Are provider-specific prefilter/postfilter semantics checked in current docs and service versions?
- Does the source link perform a fresh access decision when opened?

For broader AI practice resources, see [the owner's AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Vector Query Filters](https://learn.microsoft.com/en-us/azure/search/vector-search-filters): Microsoft Learn page describing filter expressions and prefilter/postfilter modes (including preview behavior as indicated by the fetched page); use current docs for service-specific semantics.
- [Zero Trust Architecture, NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final): NIST publication page dated August 2020; supports per-request resource access decisions, not a RAG-specific implementation.
- [Generative AI with RAG](https://docs.cloud.google.com/architecture/rag-reference-architectures): Google Cloud architecture index, last reviewed 2025-09-22; reference flows should not be mistaken for authorization guarantees.
