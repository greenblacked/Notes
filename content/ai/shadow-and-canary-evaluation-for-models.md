---
title: Shadow and canary evaluation for models
description: Validate candidate model behavior on live-like traffic while controlling exposure, privacy, cost and rollback risk.
type: guide
tags:
  - ai
  - reliability
  - observability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Stage exposure deliberately

Offline evaluation cannot fully reproduce live input distribution, latency, rate limits or downstream integrations. Shadow and canary evaluation add operational evidence while limiting user impact. A shadow candidate receives a copy of eligible input and produces an output that is not shown to users and cannot execute actions. A canary serves the candidate to a limited, selected cohort under monitoring and rollback controls. Neither replaces the controlled regression comparison in [[regression-testing-for-model-upgrades]].

Before a shadow, determine whether copying input to another model or provider is authorized under data classification, contract, retention and residency rules. Redact or minimize where possible. Prevent candidate output from triggering tools, writes, notifications or user-visible effects. Use separate credentials, quotas and trace identifiers. Define traffic filters and exclusions so the test does not capture restricted tenants or especially sensitive cases without approval.

For canaries, choose a cohort and exposure method that reflects the workload while respecting user impact. Randomized assignment can support cleaner comparisons where feasible, but users, regions or task categories may require stratification. Do not assume a percentage of traffic is inherently safe; select exposure based on risk, sample needs and service capacity. Provide a kill switch and a known baseline route before enabling candidate traffic.

## Capture comparable outcomes

Use consistent request eligibility and evaluation metrics for baseline and candidate. Track task success, human correction, complaint or escalation rates, safety incidents, refusal, latency, errors, rate limits, tokens and cost. For shadow outputs, direct correctness labels may require delayed human review or an independent oracle; do not treat generated text similarity to the baseline as correctness. Record when two models saw different context or tool results.

Use paired requests where safe and authorized, but account for nondeterminism and downstream state. Do not replay a state-changing request to production just to compare output. For conversational tasks, preserve enough context to reproduce the interaction, subject to privacy limits. Normalize the comparison plan and predefine which failures pause rollout. Report sample counts, exposure duration, eligible traffic and excluded slices.

Shadow traffic is especially useful for measuring technical behavior, but user reactions and task completion cannot be directly inferred when the candidate was hidden. Canary traffic can observe those outcomes, but introduces real user consequences and selection bias. Present the two stages as complementary, not interchangeable. Extend a canary only when the evidence supports it; do not prolong exposure merely to chase a desired result.

## Operational controls and rollback

Set up dashboards and alerts before exposure. Monitor model-specific error rate, latency distribution, quota behavior, cost, tool attempts, safety review findings and customer impact. Assign an owner who can halt the test. Ensure routing changes and model identifiers are observable in traces, and that the baseline can be restored without losing the incident record. Avoid logging full prompts or responses when metadata and sampled, approved review are sufficient.

Define stop conditions in advance: confirmed unsafe action, policy breach, material service degradation, cost anomaly, or a locally agreed quality regression. Exact thresholds depend on traffic, risk and existing SLOs; document the selected values as local, illustrative policy rather than universal constants. Specify whether to stop immediately, reduce exposure or investigate a suspected signal. Review candidate behavior across subgroups before expansion.

## Failure modes and tradeoffs

Shadow testing can double inference cost, alter provider quota behavior, expose data twice, or accidentally activate tools. A non-user-visible output may still have privacy or contractual implications. Canary results may be confounded by cohort choice, seasonality, changes in traffic, or user behavior. A low-volume canary may not reveal rare safety defects. Baseline and candidate requests can interfere if they share mutable state.

Mitigate with strict side-effect isolation, privacy review, eligible-traffic accounting, stable assignment and explicit sample limitations. Use synthetic or scrubbed shadow payloads when real traffic is not authorized. Do not label a safe shadow run as proof of user-facing success.

## Review checklist

- Is shadow input transfer authorized, minimized and retained appropriately?
- Can candidate outputs create any side effect during shadow mode?
- Is a baseline route, kill switch and named operator ready?
- Are cohorts, exclusions, denominators and exposure duration recorded?
- Are quality labels independent of baseline-model similarity?
- Are safety, cost, latency, errors and user outcomes monitored?
- Are local stop criteria defined before exposure?
- Are limitations of shadow and canary evidence clearly separated?

The owner's agent skills and workflows are listed in [the AI skills catalogue](https://ai.szolotov.com).

## Sources

- [NIST AI RMF Playbook (AI RMF 1.0 (January 2023); page notes it is being updated, accessed 2026-10-26)](https://airc.nist.gov/airmf-resources/playbook/): ongoing measurement, monitoring and governance; the linked page states AI RMF 1.0 is being updated (accessed 2026-10-26).
- [Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile (NIST AI 600-1; July 2024)](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): lifecycle monitoring and risk management for deployed GenAI.
- [Gen AI evaluation service overview (Gemini Enterprise Agent Platform; Google Cloud documentation accessed 2026-10-26)](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/evaluation-overview): evaluation strategies and metrics for generative models.
