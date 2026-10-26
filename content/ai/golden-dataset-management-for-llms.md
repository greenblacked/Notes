---
title: Managing golden datasets for LLM evaluation
description: Version, curate and govern reference examples so model evaluations remain reproducible and useful.
type: guide
tags:
  - ai
  - audit
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Why golden data needs management

A golden dataset is a controlled collection of inputs, expected outcomes, scoring rules and provenance used to compare model or application behavior. It is not a pile of prompts that happened to work once. Changes in prompts, retrieval indexes, model versions, safety policies and tool schemas can all change results, so the evaluation is only reproducible if the data and its interpretation are versioned together. This complements the pinned model and upgrade-gate approach in [[model-version-pinning-and-upgrade-evals]].

Keep the dataset's purpose narrow and explicit. A support-answer set, a tool-use set and an adversarial set should not be mixed into one opaque score. Define the task, target population, output contract, allowed evidence and risk of a wrong answer before collecting examples. Record dataset owner, creation date, source/provenance, license or authorization, sensitivity classification, labeling policy version, split, and any transformations. Redact or synthesize sensitive material where possible; keep access to raw source data separate from evaluation access.

## Version the complete evaluation contract

Use immutable dataset releases rather than changing rows in place. A release manifest should identify:

- Stable example ID, task category, language, difficulty and risk tier.
- Input and context references, expected answer or acceptable answer set, and scoring rubric.
- Labeler or adjudication status without exposing unnecessary personal details.
- Dataset, schema, rubric, evaluator and model/prompt versions.
- Inclusion/exclusion history and a reason for each change.
- Data license, retention rule, access policy and known limitations.

Store content and metadata in a version-controlled or content-addressed artifact system. Hash the canonical serialized records and manifest, and attach the hash to every evaluation report. Do not rely on a mutable spreadsheet URL or a model name such as “latest.” If an example needs correction, preserve the prior release and issue a new version with a change note. This permits before/after comparisons and makes accidental edits detectable. Keep secrets and personal data out of ordinary Git history; immutable versioning is not a reason to preserve data that should be removed.

Separate development examples from the holdout used for release decisions. Control who can view holdout labels and answers, and avoid showing them in prompt examples, developer logs or model feedback. Where data is sensitive, keep the dataset in a permissioned service and export only aggregate scores. Set a retention schedule and a removal process that records the affected release and downstream reports without needlessly retaining the removed content.

## Measure coverage and dataset health

Track counts by task, risk, language, source, time period and outcome class. Compare the distribution with the production population, not merely with the dataset's own history. Useful diagnostics include duplicate rate, missing or invalid labels, label disagreement, ambiguous references, stale examples, class imbalance, and proportion of examples whose expected answer depends on changing external facts. Report each metric with numerator, denominator and dataset version; a single “quality score” conceals the reason a set is weak.

Treat metrics as measurements, not universal pass thresholds. Teams can set context-specific acceptance criteria after observing reviewer capacity and the cost of errors. For instance, a local pilot might illustrate a target of keeping unresolved labels below a chosen percentage; that number is not a generally valid threshold. Do not claim statistical representativeness from convenience samples. Record the sampling frame and known missing groups.

Retire examples when policy or underlying facts change, but retain the historical release for reproducibility unless privacy or legal requirements demand deletion. Mark an example as obsolete rather than silently changing its answer. A separate current-facts set can test time-sensitive behavior; a stable set tests invariant task skill.

## Tradeoffs and failure modes

Large datasets increase coverage but also increase labeling cost, review time and the likelihood that weak examples dilute signal. A small expert-curated set is easier to audit but can overfit to authors' preferred phrasing. Synthetic cases scale quickly but may repeat model-specific blind spots or encode fictional assumptions. Human-written examples carry realistic ambiguity but can have inconsistent expectations. Combine these sources and label each origin.

Common failures include leakage of holdout answers into prompts; revision of rubric and examples at once, making score movement uninterpretable; selecting only easy successes; stale ground truth; duplicated near-identical cases that inflate confidence; and storing sensitive data in logs or source control. Counter these with access separation, immutable releases, duplicate checks, adversarial review, and explicit change-impact reports.

## Review checklist

- Is the task, population, rubric and risk tier explicit?
- Can every example be traced to an authorized source and label policy?
- Are development and holdout splits separated and access-controlled?
- Are dataset, schema, rubric and evaluator versions recorded in results?
- Are missingness, duplicates, coverage and label uncertainty measured?
- Are sensitive-data retention and removal controls documented?
- Does a change note explain additions, corrections and retirements?
- Can a reviewer reproduce the release without exposing private raw data?

The owner's agent skills and workflows are listed in [the AI skills catalogue](https://ai.szolotov.com).

## Sources

- [NIST AI RMF Playbook (AI RMF 1.0 (January 2023); page notes it is being updated, accessed 2026-10-26)](https://airc.nist.gov/airmf-resources/playbook/): governance, measurement and documentation practices; the linked page states AI RMF 1.0 is being updated and the Playbook will follow revision (accessed 2026-10-26).
- [Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile (NIST AI 600-1; July 2024)](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): risks and lifecycle considerations for generative AI evaluation and data.
- [Working with evals (OpenAI API; documentation accessed 2026-10-26)](https://developers.openai.com/api/docs/guides/evals): evaluation datasets, graders and iterative evaluation workflows.
