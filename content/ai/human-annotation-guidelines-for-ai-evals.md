---
title: Human annotation guidelines for AI evaluations
description: Write task-specific annotation instructions that make human judgments consistent, auditable and actionable.
type: guide
tags:
  - ai
  - audit
  - team-process
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Make the judgment observable

Human annotation turns open-ended output into a documented judgment. It is useful only when annotators share a clear definition of the task and can distinguish acceptable variation from material error. Start with the decision the score supports: factual correctness, citation support, helpfulness, policy compliance, tool choice, or completion of a workflow. Avoid a generic “good answer” label that combines different failure types. This rubric is one component of the controlled releases described in [[golden-dataset-management-for-llms]].

Write a short rubric with mutually distinguishable labels, positive and negative examples, and an explicit “not enough information / cannot judge” option. Define the unit: a full response, claim, citation, tool call, or complete interaction. Explain how to treat partial success, irrelevant details, valid alternate answers, missing context, formatting differences and safety boundaries. If an output can be right for the wrong reason, require annotators to inspect the evidence path, not just the final wording.

For each label, give operational criteria. For example, a factual-support task can define “supported” as each material claim being entailed by supplied evidence, “partially supported” as at least one material claim unsupported, and “unsupported” as the answer relying on evidence absent or contradicted by the context. State what counts as material and how to score uncertainty. Do not hide difficult cases inside an “other” bucket; define subcategories where the distinction changes remediation.

## Prepare annotators and the workflow

Provide annotators with the same input, context and rubric version. Remove model identity where feasible to reduce brand or ordering bias, randomize output order in pairwise comparisons, and do not expose model-generated self-scores. If the task requires domain expertise, qualify annotators against an independently reviewed exercise and record the qualification criteria. Calibration should use cases outside the final holdout or be clearly identified as training data.

Give annotators a structured form: chosen label, evidence location, concise rationale, uncertainty flag and optional defect category. Ask for evidence references rather than free-form impressions. Avoid requesting personal data in rationales. Record rubric version and annotation provenance with each judgment; keep annotator identity access restricted and use pseudonymous IDs in analysis.

Define a workload that supports careful review. Fatigue can shift judgment over a long queue, so randomize batches, insert a few repeated items as a consistency diagnostic where appropriate, and track completion time distributions. A very short annotation time may indicate skimming, while long times may reveal ambiguous instructions or difficult examples. These are investigation signals, not automatic grounds to discard a label.

## Measure quality without false certainty

Measure agreement on a shared subset, inspect disagreement by label and task slice, and review the confusion matrix. Overall agreement can be misleading when one class dominates. For categorical labels, report raw agreement and a chance-corrected statistic chosen for the label design; for ordinal ratings, use a measure that respects ordering. Explain the statistic and its assumptions. Agreement does not prove correctness: annotators can consistently apply a flawed rubric.

Track annotator-level label distribution and reversal rate, while avoiding simplistic ranking that punishes specialists assigned harder examples. Review disagreements with domain experts and update the rubric only through a versioned change. If a rubric changes mid-study, preserve which judgments used which definition and re-annotate affected cases where comparison is needed.

Pay annotators fairly and give them a way to flag harmful, disturbing, sensitive or impossible-to-judge content. Minimize exposure, provide appropriate support and restrict reuse of content according to policy. Respect privacy, labor and licensing requirements for internal and external annotation.

## Tradeoffs and failure modes

Expert labels improve domain validity but can be costly and scarce. Generalist annotators scale more easily but may miss subtle technical or policy errors. Binary labels simplify analysis but discard severity and partial completion. Rich scales describe behavior but increase training and disagreement. Pairwise preference is intuitive but cannot tell whether both answers are wrong; include an absolute quality or correctness check where that matters.

Common defects are vague criteria, hidden assumptions about tone, examples that do not cover edge cases, priming by model names, insufficient context, labels that overlap, and treating consensus as ground truth. Rushed adjudication can erase meaningful ambiguity. Keep an “uncertain” option and document unresolved cases instead of forcing false precision.

## Review checklist

- Does every label have a decision rule and counterexample?
- Is the annotation unit and provided context identical across annotators?
- Are uncertainty, partial success and not-applicable cases representable?
- Are calibration and holdout examples separated?
- Are disagreements and subgroup confusion inspected, not just averaged?
- Are rationale fields evidence-based and privacy-minimized?
- Is a rubric revision versioned with an impact plan?
- Are annotator wellbeing, access and fair workload considered?

The owner's agent skills and workflows are listed in [the AI skills catalogue](https://ai.szolotov.com).

## Sources

- [NIST AI RMF Playbook (AI RMF 1.0 (January 2023); page notes it is being updated, accessed 2026-10-26)](https://airc.nist.gov/airmf-resources/playbook/): documenting evaluation methods, uncertainty, roles and governance; the linked page states AI RMF 1.0 is being updated (accessed 2026-10-26).
- [Working with evals (OpenAI API; documentation accessed 2026-10-26)](https://developers.openai.com/api/docs/guides/evals): graders and evaluation design for model outputs.
- [Define success criteria and build evaluations (Claude Platform Docs; accessed 2026-10-26)](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests): task-specific criteria and representative examples.
