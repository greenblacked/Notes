---
title: Retrieval evaluation metrics and thresholds
description: Measure retrieval quality by stage and choose locally justified thresholds for a RAG application.
type: guide
tags:
  - ai
  - reliability
  - observability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Evaluate retrieval separately from generation

In retrieval-augmented generation, a plausible answer can hide a retrieval failure, and a correct retrieval can still be used badly by the generator. Measure retrieval on its own using a set of questions with relevant source passages or documents labeled under a defined relevance policy. Then evaluate whether the answer used those sources faithfully. The end-to-end runbook assistant pattern in [[rag-over-runbooks-for-on-call]] provides a production context where stale, unauthorized or incomplete retrieval can be consequential.

Define the retrieval unit—chunk, page, record or source—and what “relevant” means. A title match may be inadequate when the answer depends on a specific procedure or exception. Record multiple relevant items where appropriate and distinguish required evidence from merely related material. Keep source versions and permission context in the test record so results remain interpretable as indexes change.

## Choose metrics for the question

Recall at k measures the fraction of known relevant items retrieved among the top k; it is useful when missing evidence is costly. Precision at k measures how much of the retrieved set is relevant; it matters when irrelevant context distracts the generator or increases cost. Mean reciprocal rank focuses on the position of the first relevant result, while normalized discounted cumulative gain can represent graded relevance and reward earlier ranking. These metrics answer different questions; report more than one when tradeoffs matter.

Measure retrieval latency, index freshness, empty-result rate, duplicate rate and access-control filtering alongside relevance. If a retrieval system filters documents after ranking, evaluate the actual user-visible authorized result set, not an offline index with broader access. For hybrid retrieval, compare lexical, vector and combined stages if that helps identify failure causes. Preserve query, corpus, embedding, chunking, ranker and top-k versions.

Thresholds should follow the operating decision. A minimum recall requirement for an on-call procedure may differ from a low-risk discovery search, and neither can be inferred from a benchmark alone. Select candidate thresholds using a development set, examine the false-negative and false-positive costs, then lock the acceptance test on held-out queries. Label exploratory values as illustrative and avoid promising a universal k or score. Show threshold curves and actual error examples rather than a single rounded metric.

## Dataset and statistical design

Construct queries from real approved usage, expert-authored cases and deliberate edge cases. Include synonyms, abbreviations, misspellings, multi-hop questions, no-answer questions, stale-document conflicts and access-denied material. Split by source document or topic where possible to reduce near-duplicate leakage. Avoid generating queries from the same text used to tune embeddings and then calling the result an independent test.

Report metrics overall and by task type, source type, language, access state and freshness. Include denominator and confidence intervals. Repeated questions against the same document are correlated, so do not overstate statistical certainty by treating them as independent. Capture judged relevance uncertainty and adjudicate material disagreements. Refresh a portion of the query set over time while retaining a stable anchor set for regression comparisons.

## Failure modes and tradeoffs

High recall can overwhelm the context window with irrelevant chunks; high precision can omit the one necessary exception. A top-k metric may look good while the relevant evidence is ranked just beyond the generator's truncation boundary. Duplicate chunks inflate retrieval counts. A static corpus misses ingestion and freshness issues. Offline recall can be excellent while production permission filters eliminate the relevant answer.

Reference labels can be incomplete, so a retrieved but unlabeled relevant source may be incorrectly marked irrelevant. Review false negatives with domain owners before changing ranking. Index or chunking updates can move rankings without changing source quality; compare by root cause, not only score.

## Review checklist

- Is relevance defined at the right document or passage granularity?
- Are required and merely related sources distinguished?
- Do metrics match the retrieval decision and its error costs?
- Are freshness, latency, duplicates and permission filtering measured?
- Is the held-out set separated by source/topic where needed?
- Are subgroup results, uncertainty and real error examples included?
- Was the production authorization and truncation path evaluated?
- Are threshold choices locally justified and revisitable?

The owner's agent skills and workflows are listed in [the AI skills catalogue](https://ai.szolotov.com).

## Sources

- [NIST AI RMF Playbook (AI RMF 1.0 (January 2023); page notes it is being updated, accessed 2026-10-26)](https://airc.nist.gov/airmf-resources/playbook/): measurement plans, context and limitations; the linked page states AI RMF 1.0 is being updated and the Playbook will follow revision (accessed 2026-10-26).
- [Gen AI evaluation service overview (Gemini Enterprise Agent Platform; Google Cloud documentation accessed 2026-10-26)](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/evaluation-overview): model evaluation concepts and metrics for generative applications.
- [Working with evals (OpenAI API; documentation accessed 2026-10-26)](https://developers.openai.com/api/docs/guides/evals): evaluation dataset and grader design.
