---
title: "RAG evaluation dataset design"
description: "Build a versioned, representative evaluation set that measures evidence retrieval, answer support, abstention and operational trade-offs."
type: guide
tags:
  - ai
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

A RAG evaluation set encodes what the system is expected to retrieve, what counts as sufficient evidence, when it should abstain, and whose documents are in scope. A small set of easy questions can make a weak system look ready; a continuously reused set can leak into tuning and lose its independent value. This note extends the evaluation gate in [[rag-over-runbooks-for-on-call]] with dataset governance and test design.

## 01 Define purpose and scope

Create separate data for development, regression and final acceptance. Development examples can tune chunking, retrieval depth and ranking. Regression examples detect changes to known behavior. Acceptance examples should remain held out from routine tuning and represent intended production use. State the system boundary being evaluated: source snapshot, parser and chunker versions, index generation, retrieval configuration, model and prompt version, user identity context, and answer renderer. Results are meaningful only when the tested pipeline is recorded.

Sample questions from actual user intents with consent and data minimization, then sanitize or synthesize sensitive content. Avoid copying secrets, personal data or restricted documents into an evaluation vendor or general-purpose repository. Use synthetic documents when the objective is a structural edge case. Record source owner and use permission. Retain a mechanism to remove a test item if the underlying source is withdrawn or its licensing changes.

## 02 Label evidence and expected behavior

For each case, capture the question class, tenant/role context, source snapshot, acceptable answer facts, supporting source IDs and spans, required citation anchors, expected abstention or clarification behavior, and risk weight. Multiple evidence spans may be acceptable; mark whether all are required or alternatives. Include freshness constraints and any superseded conflicting source that should not be preferred. Make labels specific enough to distinguish a correct source from a plausible but outdated passage.

Cover direct lookup, paraphrase, multi-hop synthesis, exact identifier, policy exception, table retrieval, ambiguous query, inaccessible document, conflicting versions, missing evidence, malformed or partial source, multilingual content and out-of-domain input. Add realistic hard negatives that resemble the correct passage but differ in environment, date, product version or scope. Include permission tests with explicit allowed and forbidden evidence IDs. Unanswerable cases are essential to measure whether the model invents unsupported answers instead of declining.

## 03 Metrics and adjudication

Measure retrieval separately from generation: evidence recall at candidate depth, rank quality, source-version accuracy and authorized-only result rate. Measure response behavior with answer correctness, completeness, citation support, unsupported claims, abstention precision/recall, and appropriate uncertainty. Measure operational cost and latency, including embedding, search, reranking and generation. Scores should be stratified by risk and query type; a single mean can hide a severe regression in policy questions or permission enforcement.

Automated judges can help scale review but can prefer fluent answers, miss subtle qualifiers and share model biases with the system under test. Human adjudication should be used on high-impact cases, disagreements, novel failure classes and a periodic sample. Define a rubric and reviewer calibration process. Keep both raw labels and adjudication rationale, without unnecessary source text. Track inter-reviewer disagreement; ambiguity in the expected answer may indicate a content governance problem rather than a model issue.

## 04 Dataset lifecycle and leakage control

Version the corpus snapshot, question set, labels, rubric, evaluation code and model configuration. Record when and why a case was added or changed. Separate accessible development data from held-out acceptance examples. Repeatedly tuning to a public or fixed golden set can overfit; rotate some cases, add post-incident examples after sanitization, and reserve unseen questions for periodic reviews. Do not let model-generated answers become ground truth without source-owner or domain-expert validation.

For a new retrieval or model version, evaluate against the same snapshot first to isolate pipeline effects, then test a newer source snapshot to reveal freshness behavior. Use paired comparisons and report uncertainty or sample size where a result is noisy. Set promotion thresholds before seeing scores and define which regressions block launch. Preserve old results to compare over time. Remove data that should no longer be retained and ensure evaluation exports follow the same access controls as source corpora.

## 05 Failure modes and review checklist

Common problems are questions written to match the system's current chunk boundaries, labels that accept a document but not the relevant passage, no negative permission cases, benchmark contamination, and thresholds selected after the test. Watch for an evaluation that rewards verbosity, counts retrieval of stale documents as success, or excludes expensive slow paths from latency. A one-time benchmark is not ongoing monitoring; pair offline evaluation with production feedback and incident analysis using [[llm-observability-tracing-and-slos]].

- Are development, regression and held-out acceptance sets distinct and versioned?
- Do cases represent production intents, risk strata, difficult negatives and no-evidence behavior?
- Are evidence spans, versions, permissions, citations and expected abstentions labeled?
- Are retrieval, answer quality, citation support, security and operations measured separately?
- Are sensitive examples minimized, authorized, redacted and retained only as needed?
- Are human reviewers calibrated and automated judges treated as fallible?
- Are thresholds predefined, changes reproducible and benchmark leakage considered?
- Can source owners update or withdraw labels when authoritative content changes?

For broader AI practice resources, see [the owner's AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Generative AI with RAG](https://docs.cloud.google.com/architecture/rag-reference-architectures): Google Cloud's architecture index, last reviewed 2025-09-22; use as system design context, not as an evaluation standard.
- [AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework): NIST page for AI RMF 1.0, released 2023-01-26; the live page currently says the framework is being revised, so it is a dated voluntary framework reference, not an unrevised current final standard.
- [AI RMF 1.0, NIST AI 100-1](https://doi.org/10.6028/NIST.AI.100-1): original 2023 framework document; check NIST's revision status and date before citing as current.
