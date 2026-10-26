---
title: Model calibration and abstention
description: Evaluate whether confidence signals match observed correctness and whether the system abstains appropriately.
type: guide
tags:
  - ai
  - reliability
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Confidence is a signal, not a guarantee

Calibration asks whether a confidence estimate corresponds to empirical correctness across comparable cases. Many generative models do not expose a calibrated probability that their answer is correct; a verbal claim such as “I am 90% sure” is not automatically a meaningful probability. Define the confidence source—model token probabilities, an external classifier, retrieval coverage, tool verification, or a structured uncertainty prediction—and validate that signal against labeled outcomes.

Abstention is the deliberate choice to refuse, defer, ask a clarifying question or route to a human when available evidence or capability is insufficient. Measure both sides: unnecessary abstention on answerable tasks and unsafe commitment on unanswerable or high-risk tasks. These choices should be part of the task rubric and risk controls in [[human-annotation-guidelines-for-ai-evals]].

## Build a calibration evaluation

Use a held-out dataset with a clear correctness criterion and enough variation across task types, difficulty, language and risk. For each response, record confidence before the correctness label is revealed. If using confidence buckets, define them consistently and require a rationale for the signal's operational meaning. Ensure no answer key or reviewer feedback leaks into the confidence estimate.

For probability estimates on binary outcomes, examine reliability diagrams and calibration error measures such as expected calibration error, while documenting binning choices and sample size. Also report Brier score or log loss when the probability semantics support them. These metrics can hide subgroup miscalibration, and expected calibration error depends on binning. Show calibration by important task slice and include uncertainty intervals. For selective prediction, plot coverage against error or risk: how performance changes as the system answers only cases above a chosen confidence level.

Evaluate abstention policy at decision thresholds selected for the use case. Report answered fraction, accuracy among answered items, errors among answered items, correct abstention rate, unnecessary deferral rate and downstream resolution time or human workload. An apparent accuracy gain from abstaining on nearly everything is not a useful system result. Conversely, a high answer rate may be unacceptable where a wrong answer has severe impact. Choose the tradeoff explicitly with stakeholders and make locally selected limits visible.

Test calibration drift over time, after model upgrades, prompt changes, retrieval changes and population shifts. Confidence may be well behaved on a benchmark but unreliable for out-of-distribution inputs, new languages or rare classes. Preserve calibration data separately from model-tuning data and avoid repeatedly choosing thresholds on the final test set.

## Design safe abstention behavior

Abstention should produce an actionable next step: identify missing evidence, ask a focused clarification, cite the limitation, or route to an appropriate reviewer. It should not fabricate a confident answer merely to avoid a refusal, nor use a generic refusal when a simple clarification would resolve uncertainty. In agent tasks, abstention also means not calling a tool when the target or authorization is ambiguous.

Use deterministic evidence checks where possible: retrieval coverage, source freshness, tool result verification and policy checks. These are not probabilities of truth, but they can contribute defensible signals. Keep high-impact actions behind external authorization and confirmation rather than relying on confidence language.

## Failure modes and tradeoffs

A model may sound certain when wrong, while a correct answer may use cautious language. Self-reported confidence is vulnerable to prompt effects and should be tested across paraphrases. Calibration metrics can improve while critical minority groups worsen. Selective accuracy can rise simply by declining difficult but important users. Human fallback can create queues and unequal service, so measure fallback capacity and wait time.

Avoid overfitting thresholds to a small validation set, interpreting token likelihood as factual confidence, or comparing calibration numbers from different definitions. Document when confidence is unavailable or not meaningful, and use direct verification instead.

## Review checklist

- Is confidence defined by a reproducible signal, not stylistic language?
- Are correctness labels independent and held out from tuning?
- Are calibration, subgroup behavior and uncertainty reported?
- Are answered coverage and abstention costs reported together?
- Do abstentions clarify, defer or route with useful next steps?
- Are distribution shifts and model/configuration changes retested?
- Are high-impact actions controlled independently of confidence?
- Is the threshold a documented local decision with an owner?

The owner's agent skills and workflows are listed in [the AI skills catalogue](https://ai.szolotov.com).

## Sources

- [NIST AI RMF Playbook (AI RMF 1.0 (January 2023); page notes it is being updated, accessed 2026-10-26)](https://airc.nist.gov/airmf-resources/playbook/): uncertainty, measurement and risk management; the linked page states AI RMF 1.0 is being updated (accessed 2026-10-26).
- [Gen AI evaluation service overview (Gemini Enterprise Agent Platform; Google Cloud documentation accessed 2026-10-26)](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/evaluation-overview): evaluation metrics and assessment design.
- [Working with evals (OpenAI API; documentation accessed 2026-10-26)](https://developers.openai.com/api/docs/guides/evals): graders, datasets and iterative evaluation.
