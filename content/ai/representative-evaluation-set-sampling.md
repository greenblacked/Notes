---
title: Sampling representative evaluation sets
description: Build evaluation samples that reflect real tasks while preserving coverage of rare, high-impact failures.
type: guide
tags:
  - ai
  - reliability
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Define what “representative” means

An evaluation sample is representative only relative to a named population, time window and task. “Representative of users” is too vague. State whether the target is incoming requests, completed workflows, a particular product surface, or a future release period, and which traffic is excluded. Sampling should reflect the intended deployment, not whichever examples are easiest to label. For a governed, versioned dataset workflow, see [[golden-dataset-management-for-llms]].

Before sampling, create a lightweight frame from privacy-approved telemetry: task type, language, channel, workflow stage, risk, outcome and time period. Avoid including prompts, identifiers or sensitive attributes unless necessary and approved. Record frame coverage and any known blind spots such as excluded channels, unlogged failures or user groups that do not consent to collection. The frame itself can bias the sample, so compare it with independent operational counts where available.

## Use stratification and deliberate oversampling

Simple random sampling is useful when the population is stable and labels are inexpensive. It can miss rare but important conditions, especially in a small sample. Stratified sampling divides the frame into relevant categories—such as task class, risk tier, language or tool pathway—and samples within each. Preserve the population prevalence metadata so an intentionally balanced test set is not mistaken for a production-weighted estimate.

Oversample high-consequence or rare failures for diagnostic power, but report those slices separately. If the evaluation needs one population estimate, use weights tied to the known selection probabilities and explain the assumptions. Do not average subgroup scores without showing subgroup results: a strong common task can mask poor performance in a smaller or higher-risk cohort. A targeted challenge set answers “can this failure happen?”; a prevalence sample answers “how often does this happen in this population?” They are distinct questions.

For time-varying applications, use a temporal holdout: draw later examples after development and prompt iteration, and keep them hidden from the tuning loop. For repeated users or related conversation threads, group by user or thread before splitting so near-duplicate examples do not leak across training, tuning and test sets. Deduplicate exact and near-exact records before sampling, then preserve the deduplication method in the dataset manifest.

## Choose sample size from the decision

Do not invent a universal sample-size threshold. Determine the decision the evaluation must support, the expected error rate or effect size of interest, confidence requirements, subgroup comparisons and label budget. Low-frequency events require more observations to estimate prevalence precisely; a small sample with zero observed failures does not establish zero risk. Use an appropriate statistical plan and consult a statistician for consequential or complex comparisons.

When comparing two model versions on the same tasks, paired evaluation often reduces noise because both versions see identical examples. Keep task, context, prompt, tool definitions and scoring rules fixed except for the intended change. If examples are sampled from an ongoing stream, retain a stable anchor set as well as a refreshed sample: the anchor reveals regressions against known cases, while refreshed samples expose distribution drift. Neither should substitute for the other.

Report point estimates with uncertainty intervals and denominators, plus raw counts for critical failures. State whether examples are independent; repeated users and correlated tasks invalidate simplistic confidence calculations. For judge-based or human ratings, report label uncertainty as well as model outcome uncertainty.

## Failure modes and tradeoffs

Convenience sampling is fast but overrepresents well-instrumented, easy or successful cases. Uniform sampling across categories can exaggerate rare categories unless weighted for the population question. Pure random sampling can leave safety-critical edge cases unseen. Historical data may encode stale policies or user behavior that no longer reflects deployment. A hand-curated challenge set can be effective for regression testing but is not an unbiased estimate of production performance.

Sampling on model confidence alone selects unusual cases but creates selection bias; use it as an additional diagnostic queue, not the sole sample. Also watch for survivor bias from only evaluating completed sessions, leakage from repeated prompts, missing non-English cases, and selection after seeing which model wins.

## Review checklist

- Is the target population, time window and unit of sampling explicit?
- Does the sample frame cover the intended channels and workflows?
- Are risk and rare-case tests distinct from prevalence estimation?
- Are inclusion probabilities and any weights recorded?
- Are related users or threads grouped to prevent leakage?
- Are denominators, uncertainty and subgroup outcomes reported?
- Is sample size justified by the decision and the expected error cost?
- Does the report identify frame gaps and non-independence?

The owner's agent skills and workflows are listed in [the AI skills catalogue](https://ai.szolotov.com).

## Sources

- [NIST AI RMF Playbook (AI RMF 1.0 (January 2023); page notes it is being updated, accessed 2026-10-26)](https://airc.nist.gov/airmf-resources/playbook/): measurement planning and documenting limitations in AI risk assessments.
- [Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile (NIST AI 600-1; July 2024)](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): representative data and measurement considerations across GenAI risks.
- [Define success criteria and build evaluations (Claude Platform Docs; accessed 2026-10-26)](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests): constructing task-specific tests and evaluation sets.
