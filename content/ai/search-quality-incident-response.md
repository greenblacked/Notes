---
title: "Search quality incident response"
description: "Triage retrieval regressions with evidence-preserving diagnostics, bounded mitigations and measured recovery criteria."
type: guide
tags:
  - ai
  - reliability
  - incident-management
  - observability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

A search-quality incident is a user-visible failure to retrieve timely, relevant and authorized evidence, even if all APIs return success. Examples include stale guidance ranking above current policy, a newly deployed chunker losing a table header, a filter returning too few results, or a reranker elevating irrelevant candidates. This operational runbook complements the safe assistant behaviors in [[ai-assisted-incident-response]] and the RAG quality controls in [[rag-over-runbooks-for-on-call]].

## 01 Detect and scope

Use user reports, sampled review, retrieval-quality tests and operational signals together. Signals include a drop in evidence recall or citation support, increased no-result rate, retrieval latency, index lag, candidate count shifts, ACL filter errors and unusual fallback share. Route severity by potential harm, affected source criticality, tenant scope, duration and whether incorrect or unauthorized evidence was exposed. Separate an accuracy incident from a data exposure incident; the latter also requires the security/privacy incident process.

Capture a bounded incident record: time range, affected index/configuration generation, source watermark, retrieval arm, ranker/model versions, query class, impact estimate and representative opaque request IDs. Avoid copying raw prompts, passages or personal data into a broad incident channel. If restricted evidence must be reviewed, use approved access-controlled tooling and record who accessed it. Preserve enough metadata to reproduce the failure while honoring retention and privacy requirements.

## 02 Diagnose systematically

Start with a known authorized query and walk the pipeline: authentication/tenant context; source freshness and ACL revision; query normalization/embedding; lexical and vector candidates; filter application; fusion/deduplication; reranker; final context; citation resolution. Compare the failing request with a known-good baseline using the same corpus snapshot where possible. Distinguish missing evidence from poor ranking, stale source content, parsing loss, query/model behavior or downstream generation. A fluent answer does not show that retrieval was healthy.

Check recent changes and watermarks before changing multiple components. Look for index generation mismatch, incomplete ingestion, provider throttling, schema changes, stale caches, ACL synchronization lag and source outages. If quality tests reproduce it, identify the smallest failing stratum and preserve the exact configuration. Use a read-only replay on controlled data rather than repeatedly querying restricted user content. Record hypotheses and evidence so responders do not mistake correlation for cause.

## 03 Mitigate and recover

Choose the narrowest reversible mitigation. Options may include routing to a last-known-good index generation, disabling a changed reranker, pausing incomplete ingestion promotion, invalidating a demonstrably stale cache namespace, or showing a freshness warning and abstaining for the affected source. Do not relax ACL filters, broaden tenant scope, or silently serve stale content to improve result count. If a safe fallback is unavailable, degrade explicitly rather than fabricate confidence.

Before rollout, test the mitigation on the affected evaluation cases and a permission-negative test. Monitor quality, latency, indexing lag, error rate and customer impact during canary expansion. Define recovery as restored evidence and citation quality plus healthy freshness and access enforcement, not merely green infrastructure metrics. Keep the incident open through a period sufficient to confirm delayed changes and caches have converged. Communicate uncertainty and scope accurately; do not state a root cause until evidence supports it.

## 04 Post-incident learning

After stabilization, document impact, timeline, detection gap, contributing factors, containment, recovery validation and follow-up owner/date. Add a sanitized regression case to the right evaluation set with source-owner approval. Prefer systemic fixes such as versioned index promotion, missing freshness alerts or access tests over blame. Review whether observability captured retrieval configuration and index generation without over-collecting sensitive content; see [[llm-observability-tracing-and-slos]]. Revisit severity thresholds and responder access if needed.

## 05 Responder checklist

- Is this relevance/freshness, availability, authorization leakage, or a combination?
- Which tenants, sources, query classes, index generation and time window are affected?
- Are access filters and tenant boundaries still fail-closed?
- Can a known authorized query reproduce the failure with safe, bounded evidence?
- Have source watermark, ingestion status, cache generation and recent config changes been checked?
- Is the proposed mitigation reversible and narrower than disabling authorization or serving stale data?
- Are quality, citations, permissions, latency and freshness all part of recovery criteria?
- Is a sanitized regression test and accountable corrective action recorded?

For broader AI practice resources, see [the owner's AI skills catalogue](https://ai.szolotov.com).

## Sources

- [OpenTelemetry GenAI Semantic Conventions](https://github.com/open-telemetry/semantic-conventions-genai): canonical repository for evolving GenAI spans, metrics and events. The older conventions page points contributors here; treat the conventions as evolving, and avoid assuming a stable version without pinning it.
- [Generative AI with RAG](https://docs.cloud.google.com/architecture/rag-reference-architectures): Google Cloud architecture index, last reviewed 2025-09-22; offers reference dataflow context, not an incident-response standard.
- [AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework): NIST live page confirms AI RMF 1.0 is being revised; cite it as voluntary 2023 framework material and verify revision status, not as an unrevised current standard.
