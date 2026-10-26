---
title: Evaluation data leakage and contamination
description: Prevent accidental access to test answers and detect overlap that makes evaluation results look better than they are.
type: guide
tags:
  - ai
  - audit
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Identify the leakage paths

Evaluation leakage occurs when information about a test set or its expected outcomes influences model development, prompting, retrieval, judge design or human decisions before the final measurement. Contamination may also arise when examples or answers were already present in pretraining or fine-tuning data. These problems weaken claims about generalization; they do not necessarily mean a benchmark is useless, but they change what it measures.

Map the full data path: source collection, annotation, development split, prompt examples, retrieval corpus, fine-tuning, model-provider processing, evaluation runner, reports and later reuse. Record who can access inputs and answer keys, where copies are stored, and whether provider retention or training settings affect test confidentiality. Dataset versioning, split controls and access rules should follow [[golden-dataset-management-for-llms]].

## Prevent operational leakage

Separate development, validation and final holdout sets by source document, user, conversation or time period where relevant, not merely by random row. Near-duplicates, templated variations and neighboring turns can leak across splits. Deduplicate exact and near-exact items before partitioning; preserve the method and split assignment in the manifest. Avoid exposing hidden references in logs, dashboards, issue descriptions or prompt-tuning transcripts.

Restrict holdout access to a small evaluation owner group. Give model developers aggregate results and categorized failures when possible, not all hidden answers. Use a controlled evaluation service or permissioned artifact rather than shared flat files. Limit retries and repeated peeking at the final set; each tuning cycle consumes some of its value. Maintain a fresh, time-based holdout for periodic checks and a stable anchor set for historical comparisons.

Do not place test answers in retrieval indexes, few-shot examples, system prompts, tool descriptions or evaluator context unless the test explicitly measures that behavior. Check application logs and tracing pipelines for inadvertent prompt/answer capture. Avoid storing sensitive answers in source control because version history persists. Where privacy deletion is required, follow the data governance process even if reproducibility is affected.

## Detect and qualify contamination

For public or broadly circulated benchmark questions, exact-match search and n-gram overlap can find obvious duplication, but cannot prove no contamination. Search approved internal corpora and development artifacts for overlap, check dates and provenance, and review suspicious high scores on oddly specific or memorized examples. Test paraphrased or newly authored variants that preserve the task rather than surface wording. Use private or freshly sampled evaluation items for consequential decisions, while documenting that no method conclusively proves a foundation model never saw similar material during training.

Look for distributional signs: sudden score jumps on a narrow benchmark without corresponding improvement on live-like tasks, unusually exact reproduction of reference phrasing, or performance collapse under harmless paraphrase. These are investigation leads, not proof. Report benchmark origin, public availability, release date and known exposure. Separate contamination risk from ordinary overfitting to a visible validation set.

When leakage is discovered, identify affected model versions, reports and decisions. Re-evaluate on an uncontaminated holdout if available; otherwise qualify historical results and create a new evaluation set. Do not silently delete a failed test or present a replacement as the same measurement.

## Tradeoffs and failure modes

Strict secrecy improves holdout integrity but limits debugging and can reduce reviewer confidence. Open test sets support reproducibility but invite optimization to the benchmark. Frequent refreshes improve novelty but make trend comparisons harder. Keep both a stable, access-controlled anchor and a rotating sample. Avoid false assurance from hashes alone: hashes prove file identity, not that the content was not exposed.

Common failures include random splitting of correlated examples, use of the test set for prompt iteration, answer-bearing filenames, logging full outputs, test cases generated from the model under evaluation, and assuming public model training cutoff eliminates contamination. Provider policies and data handling vary, so check current contract and configuration.

## Review checklist

- Are sources, splits, access roles and data paths documented?
- Are related users, threads, documents and templates grouped?
- Are hidden references excluded from retrieval and development artifacts?
- Are logs and reports reviewed for accidental answer disclosure?
- Are public benchmark exposure and date limitations recorded?
- Is contamination detection described as incomplete, not definitive?
- Is there a fresh holdout and policy for repeated peeking?
- Can affected results be qualified and rerun after a leak?

The owner's agent skills and workflows are listed in [the AI skills catalogue](https://ai.szolotov.com).

## Sources

- [NIST AI RMF Playbook (AI RMF 1.0 (January 2023); page notes it is being updated, accessed 2026-10-26)](https://airc.nist.gov/airmf-resources/playbook/): data governance, documentation and ongoing risk management; the linked page states AI RMF 1.0 is being updated (accessed 2026-10-26).
- [Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile (NIST AI 600-1; July 2024)](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): risks involving training data, evaluation and information integrity.
- [Working with evals (OpenAI API; documentation accessed 2026-10-26)](https://developers.openai.com/api/docs/guides/evals): dataset creation and evaluation workflow design.
