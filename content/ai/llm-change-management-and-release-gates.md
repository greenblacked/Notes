---
title: Change management and release gates for LLM systems
description: Control changes to models, prompts, tools, data, and providers with staged evaluation and observable rollback criteria.
type: pattern
tags:
  - ai
  - reliability
  - audit
  - ci-cd
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Treat all behavior inputs as releases

An LLM-backed service changes when any of its behavior inputs change: provider or model revision, deployment parameters, prompt templates, system instructions, retrieval corpus, chunking, tool schema, safety policy, evaluator, middleware, or routing. A provider-managed model alias can change without a code deploy, so record the alias and any returned revision metadata. Make version and ownership visible in the release record. [[model-version-pinning-and-upgrade-evals]] addresses model-specific pinning; this pattern covers the end-to-end change boundary.

Classify changes by blast radius and reversibility. A copy edit to a low-risk prompt may use an ordinary review path; a new provider, region, tool permission, user-data flow, or high-impact decision workflow needs additional privacy, security, and product approval. Explicitly identify changes that affect safety or retention claims. Risk classification should not let a prompt-only change bypass review simply because no application code changed.

## Define a release record

Each release should link the proposed change, owner, affected tasks and tenants, model/provider, prompt and tool versions, evaluation report, data-flow impact, rollout cohort, and rollback plan. Preserve the evaluation version and sample counts. Include failed cases and known limitations rather than only a summary score. If an evaluator changed, compare its behavior on a fixed reference set before interpreting quality differences. Structured output schemas and tool protocols should have compatibility checks for old and new versions.

Keep production identifiers bounded and privacy-safe. A release ID can be attached to request metrics and traces so an incident can compare cohorts without putting the prompt in logs. When provider response metadata does not expose an exact revision, record that limitation and use the strongest available deployment identifier; do not claim reproducibility that the API cannot support.

## Gate promotion on evidence

Use layered gates: configuration and policy validation, deterministic schema and safety checks, offline task evaluation, integration tests with representative tools, and an operational readiness review. Promotion criteria should include hard failures (for example, a required output contract violation) and bounded quality/latency deltas on a maintained evaluation set. Averages alone are insufficient; set thresholds for important task classes and refusal cases. Have a human review the samples where automated evaluation is ambiguous.

For external model changes, verify provider limits, current pricing assumptions, data handling, region, and fallback compatibility. A successful benchmark does not prove the model is available under the production account's quotas or that the endpoint has the expected data controls. Add a canary phase with a defined sample size or observation window, monitored success, latency, quality proxies, cost, and safety events. Increase exposure in steps only while criteria remain met.

## Rollout, pause, and rollback

Before rollout, specify a stop condition and who can invoke it. Candidate signals include elevated output validation failures, a class-specific quality drop, unusual refusals, latency or cost regression, or sensitive-data handling failure. Define the prior known-good configuration, the reversion mechanism, and what remains compatible after rollback. Rollback must not assume old caches, indexes, or prompt versions remain safe; test interactions before release.

If the canary degrades, pause expansion and investigate the cohort and change set. Avoid changing prompt, model, retrieval, and tools simultaneously; separate variables to preserve diagnostic evidence. Keep a timeline and preserve sanitized evaluation results. A rollback is a controlled release action with an owner and verification, not an undocumented emergency edit. Follow [[ai-assisted-incident-response]] if users are affected and [[model-provider-outage-runbook]] when the change reveals a dependency incident.

## Checklist

- Model, prompt, tools, retrieval, policy, and provider config are versioned.
- Change risk determines review depth and approval roles.
- Evaluation datasets, rubrics, sample counts, and limitations are recorded.
- Deterministic, quality, privacy, cost, and capacity gates are explicit.
- Canary has bounded exposure, observation, stop criteria, and owner.
- Rollback target and compatibility are tested and auditable.
- Post-release metrics are compared with a stable baseline.

Review the gates periodically; a process can become ceremonial if it does not reflect real failure modes. The release record should support both repeatability and a clear explanation of what users experienced.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Google SRE: Role of Release Engineer and Best Practices](https://sre.google/sre-book/release-engineering/): staged releases and repeatable release practices.
- [Implementing SLOs](https://sre.google/workbook/implementing-slos/): using reliability objectives and budgets in operational decisions.
- [NIST AI Risk Management Framework Playbook](https://airc.nist.gov/airmf-resources/playbook/): risk-management activities mapped to AI RMF 1.0; the NIST page states that RMF 1.0 is under revision, so do not treat it as a newly finalized unrevised standard.
