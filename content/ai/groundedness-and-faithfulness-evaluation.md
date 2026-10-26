---
title: Evaluating groundedness and faithfulness
description: Check whether generated claims are supported by supplied evidence and whether citations actually substantiate them.
type: guide
tags:
  - ai
  - reliability
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Separate evidence from correctness

Groundedness asks whether an answer's claims follow from the provided context. Faithfulness often describes whether the generated answer stays aligned to that context and user request. Neither alone proves that the context is true, current or complete. A system can faithfully repeat an outdated runbook or confidently cite a document that does not answer the question. Keep source quality and retrieval coverage as separate dimensions, as in [[rag-over-runbooks-for-on-call]] and [[retrieval-evaluation-metrics-and-thresholds]].

Define the claim unit before scoring. For an answer with several factual assertions, split it into material claims and judge each claim against the supplied evidence. Record whether the claim is entailed, contradicted, unsupported, or not verifiable from the available context. Decide how to treat common knowledge, arithmetic, reasonable inference, and instructions that are recommendations rather than factual claims. A rubric that changes these definitions between examples produces unreliable comparisons.

## Test support at the claim level

For each test case, preserve the question, retrieved context, source identifiers and versions, generated answer, citations and an independent support label. Annotators should identify the exact source span for a supported claim and the exact unsupported assertion for a failure. A citation's presence is not proof: check whether the linked source entails the associated claim and whether the citation target is accessible to the intended user.

Report claim-level supported fraction with a denominator, unsupported-claim rate, contradiction rate, citation precision and citation coverage. Define each metric precisely. For example, citation precision can be the proportion of cited sources that support their associated claims; citation coverage can be the proportion of material claims that have a supporting citation. Provide answer-level failure rates too, since one unsupported high-impact statement can matter more than several supported minor details. Avoid collapsing these into a single “groundedness score.”

Include adversarial and normal cases: answerable questions with direct evidence, conflicting sources, no relevant passage, stale context, ambiguous wording, incomplete retrieval, irrelevant distractors, and questions that request unsupported specifics. Test whether the system says it cannot determine an answer, asks for clarification, or qualifies its conclusion when evidence is missing. A correct abstention is not a retrieval or answer failure when the evidence truly is inadequate.

## Evaluator design and thresholds

Use human judgments as a reference on a stratified sample. An LLM judge can triage additional examples, but validate it against those judgments, including citation entailment and subtle contradictions; see [[llm-as-judge-validation]]. Use deterministic checks for citation format, source availability, permission scope and required metadata. These cannot establish semantic support, but they remove mechanical errors from the human review queue.

Evaluate with a fixed corpus and prompt to compare versions, and add refreshed cases for changing source material. Report by task, risk, source type, answer length and language. Use uncertainty intervals and preserve examples behind metric movement. No generic threshold is suitable for every use: a high-risk operational answer may require strict claim support and a human signoff, whereas brainstorming may tolerate clearly labeled speculation. Derive local criteria from error impact, human review ability and observed validation data.

## Failure modes and tradeoffs

Common false positives include treating topical similarity as entailment, accepting citations that support only one clause, assuming a claim is true because the source says so, or rewarding a refusal when evidence was present but missed. False negatives arise when valid paraphrase or multi-document inference is scored as unsupported. Source conflicts require a policy for recency and authority rather than a blind majority. Annotator disagreements should be surfaced rather than hidden in averages.

Token-level attribution is expensive and can imply more precision than the evidence supports. Answer-level scores are cheap but obscure mixed-quality answers. The claim-level approach costs more but makes remediation actionable: improve retrieval, source curation, prompt constraints or citation generation based on the observed defect.

## Review checklist

- Are grounding, source truth, freshness and completeness measured separately?
- Is the claim unit and treatment of inference explicit?
- Do citations entail the specific claims they accompany?
- Are missing evidence, conflicting sources and stale context tested?
- Are both claim-level and answer-level outcomes reported?
- Are judge metrics validated on independent human labels?
- Are threshold decisions tied to risk and operational review?
- Can reviewers trace a failure to source, retrieval or generation?

The owner's agent skills and workflows are listed in [the AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile (NIST AI 600-1; July 2024)](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): confabulation and information integrity considerations in GenAI.
- [Gen AI evaluation service overview (Gemini Enterprise Agent Platform; Google Cloud documentation accessed 2026-10-26)](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/evaluation-overview): evaluation approaches and metrics for generative responses.
- [Define success criteria and build evaluations (Claude Platform Docs; accessed 2026-10-26)](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests): success criteria and test-set construction.
