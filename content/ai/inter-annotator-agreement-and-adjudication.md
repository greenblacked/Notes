---
title: Inter-annotator agreement and adjudication
description: Interpret disagreement as a measurement signal and resolve evaluation labels with a documented process.
type: guide
tags:
  - ai
  - audit
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Agreement is diagnostic, not truth

Multiple independent human judgments expose ambiguity in both the model output and the evaluation rubric. Inter-annotator agreement (IAA) describes how consistently annotators apply a scheme; it does not establish that their consensus is factually correct, fair or aligned to policy. Pair IAA with expert review and explicit correctness evidence. The annotation protocol and task definitions in [[human-annotation-guidelines-for-ai-evals]] should be fixed before interpreting agreement.

Assign a subset of evaluation items to multiple annotators independently, without discussion or access to one another's labels. Preserve annotator, item, rubric version and label provenance. Randomize assignment when possible, while ensuring the overlap spans task categories, risk levels, languages and edge cases. If only the easiest cases are double-labeled, the agreement estimate will overstate reliability on the full set.

## Select and report the statistic carefully

For categorical outcomes, report raw percent agreement and a chance-corrected measure such as Cohen's kappa for two raters or an appropriate multi-rater statistic for the design. For ordinal scores, use an ordinal agreement method; for continuous ratings, use an intraclass correlation approach whose assumptions match the rating design. State which items were multiply rated, how missing ratings were handled, and how prevalence affects interpretation.

No coefficient is universally appropriate. Kappa-like measures can behave unexpectedly when one label is very common or very rare, even when raw agreement appears high. A single pooled value can hide disagreement in a rare but consequential category. Report the label counts, confusion matrix, category-level agreement and representative disagreement examples, with uncertainty estimates where sample size supports them. Do not set generic acceptance thresholds without considering the task, consequences and observed ambiguity; label any locally selected threshold as a project decision.

For pairwise preference tasks, report ties and side/order effects in addition to win rates. For numeric scales, inspect whether annotators differ by a consistent offset or use the scale range differently. A disagreement over “3 versus 4” is not equivalent to “safe versus unsafe.” If label severity matters, examine weighted agreement and preserve the underlying labels rather than converting everything into a binary pass.

## Adjudicate in a way that preserves information

Predefine which disagreements require adjudication: safety-critical labels, conflicting factual judgments, rubric-invalid cases, and a sampled fraction of apparent agreements. A designated adjudicator should review the original item, evidence and independent rationales, then record the decision and rationale. Avoid a simple majority vote when expertise or evidence quality differs. Where the evidence cannot resolve the question, retain an indeterminate outcome or revise the case for future use.

Track pre-adjudication labels separately from the adjudicated label. Otherwise a polished final dataset masks where instructions failed. Classify disagreement causes: ambiguous policy, missing context, factual source conflict, annotator misunderstanding, subject-matter dispute, or genuine boundary case. Use these causes to improve the rubric, task design or source material. If a rule changes, issue a new rubric version and identify whether past labels remain comparable.

Adjudication has a cost: it delays results and can introduce a senior reviewer’s idiosyncratic interpretation. Rotate or calibrate adjudicators for large programs, audit a sample of resolved cases, and make the escalation path explicit. A disagreement is sometimes an important product decision rather than an annotation defect; route policy questions to their owner.

## Failure modes and tradeoffs

Common mistakes include computing agreement after discussion, silently dropping hard examples, treating the adjudicated label as an independent rater, reporting only one score, and applying majority vote to asymmetric risks. Agreement can appear low because the rubric genuinely admits several valid answers, or high because all annotators share the same blind spot. Blindly chasing a high coefficient may force artificial labels and hide uncertainty.

Double-labeling every item raises cost; sampling a portion controls cost but requires a deliberate design. High-risk categories merit denser review than routine items. Expert adjudication improves validity but is not an excuse to skip independent labeling or preserve a weak rubric.

## Review checklist

- Were initial judgments independent and tied to a rubric version?
- Does overlap cover difficult and high-risk cases?
- Is the agreement measure suited to label type and rater design?
- Are counts, confusion and subgroup patterns included with the score?
- Are pre-adjudication and final labels both retained?
- Is adjudication evidence-based, documented and appealable?
- Are unresolved ambiguities represented rather than forced into labels?
- Are policy questions escalated to the right owner?

The owner's agent skills and workflows are listed in [the AI skills catalogue](https://ai.szolotov.com).

## Sources

- [NIST AI RMF Playbook (AI RMF 1.0 (January 2023); page notes it is being updated, accessed 2026-10-26)](https://airc.nist.gov/airmf-resources/playbook/): measurement uncertainty, documentation and ongoing monitoring; the linked page states AI RMF 1.0 is being updated (accessed 2026-10-26).
- [Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile (NIST AI 600-1; July 2024)](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): evaluating and documenting generative AI system risks.
- [Define success criteria and build evaluations (Claude Platform Docs; accessed 2026-10-26)](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests): evaluation criteria, test cases and grader design.
