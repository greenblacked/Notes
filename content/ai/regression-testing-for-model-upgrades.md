---
title: Regression testing for model upgrades
description: Compare a candidate model with the pinned baseline using controlled tests, risk slices and rollback criteria.
type: guide
tags:
  - ai
  - reliability
  - ci-cd
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Make the comparison attributable

A model upgrade is a dependency change that can alter quality, safety, latency, cost and tool behavior. Preserve the current production model as an explicit baseline and identify the candidate by exact provider model/version identifier where available. Pin prompt, system policy, retrieval corpus, tools, decoding parameters and evaluator unless the upgrade itself requires a change. The broader release controls in [[model-version-pinning-and-upgrade-evals]] establish why “latest” is not a reproducible baseline.

Use the same evaluation examples for baseline and candidate, preferably paired by task. Include a stable regression set and a refreshed sample from current use. Stable examples detect known regressions; fresh examples reveal distribution and source drift. Keep a separate challenge set for rare high-consequence failures, and do not combine it with production prevalence estimates without appropriate weights.

## Measure quality and operational behavior

Evaluate task success, factuality or groundedness, tool-call correctness, safety, refusal and abstention, retrieval use, latency, token consumption and estimated cost. Select metrics that map to product requirements and show both aggregate and slice-level outcomes. Keep raw failure counts and denominators alongside rates. A candidate may improve average quality while regressing in one language, task type or sensitive workflow.

Use deterministic checks wherever possible for schemas, policy invariants, exact requirements, citations and state changes. Human annotation or validated model graders may assess nuanced outputs; keep judge configuration fixed and validated. For stochastic generation, choose repeat counts based on variance, cost and decision needs; disclose sampling parameters and variability. Do not run repeated samples and then publish only the best result.

Report paired differences and uncertainty rather than comparing two unrelated averages. For critical outcomes, review individual regressions and their severity. Define acceptance and rollback criteria before seeing candidate results, but make them local to application risk and service objectives. Avoid inventing universal numerical gates. A criteria sheet should state what degradation is tolerable, which regressions are release blockers, who can approve exceptions and what evidence is needed.

## Roll out and preserve a rollback path

After offline evaluation, use a shadow phase where candidate responses are generated but not shown or allowed to act. This measures real input distribution and operational characteristics, subject to data approval and privacy controls. Then use a limited canary or cohort rollout with a stable baseline, guarded exposure and human monitoring. Compare behavior on the same time window and account for cohort differences. See [[shadow-and-canary-evaluation-for-models]] for exposure design.

Keep model IDs, prompt and data manifests, evaluator versions, scorecards, and approval decisions together. Monitor latency, errors, rate limits, cost, user outcomes, refusal rates and incident reports. Predefine rollback trigger and responsible operator. Do not rely on an automatic switch to a floating model version. If rollback occurs, capture evidence and investigate before retrying.

## Failure modes and tradeoffs

Treat provider release notes and API documentation as time-sensitive; check exact model support and deprecation behavior before each rollout. A benchmark can overfit to the candidate or fail to represent changing use. Provider behavior may change even with a nominally stable name; verify the provider's versioning semantics. Evaluator drift can masquerade as model change. Concurrent prompt, index and model changes destroy attribution. Shadow traffic can expose sensitive input to a second provider or create unexpected cost. Canary users may not represent high-risk workloads.

A strict regression gate protects stable behavior but can block beneficial upgrades due to noisy small samples. A permissive gate ships hidden regressions. Address this with uncertainty reporting, targeted human review and staged exposure, not by hiding inconvenient slices. Maintain a documented exception process and limit its scope.

## Review checklist

- Is the baseline pinned and candidate identity explicit?
- Are prompt, tools, corpus and graders held fixed or declared changed?
- Are stable, refreshed and high-risk sets kept distinct?
- Are quality, safety and operational measures reported by slice?
- Are differences paired and uncertainty documented?
- Were acceptance and rollback criteria defined in advance?
- Is shadow/canary handling privacy-approved and representative?
- Can the service return to the prior known configuration promptly?

The owner's agent skills and workflows are listed in [the AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Working with evals (OpenAI API; documentation accessed 2026-10-26)](https://developers.openai.com/api/docs/guides/evals): structured evaluations and iterative model comparison.
- [NIST AI RMF Playbook (AI RMF 1.0 (January 2023); page notes it is being updated, accessed 2026-10-26)](https://airc.nist.gov/airmf-resources/playbook/): measuring, monitoring and governing AI system changes; the linked page states AI RMF 1.0 is being updated (accessed 2026-10-26).
- [Gen AI evaluation service overview (Gemini Enterprise Agent Platform; Google Cloud documentation accessed 2026-10-26)](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/evaluation-overview): evaluation metrics and model assessment approaches.
