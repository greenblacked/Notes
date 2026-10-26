---
title: Selecting fallback models and managing quality degradation
description: Route around model failures only through evaluated alternatives with explicit quality, privacy, capacity, and cost limits.
type: pattern
tags:
  - ai
  - reliability
  - runbooks
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Fallback is a product decision

A fallback model is not automatically equivalent to the primary model. It may differ in reasoning ability, output structure, latency, context capacity, safety behavior, language coverage, data handling, price, or regional availability. Treat routing to a fallback as a controlled degradation of the product contract, not as a transparent infrastructure retry. Product and service owners should approve the workflows where the alternate is acceptable and define the behavior when it is not.

For each candidate pair, evaluate representative prompts and outcomes using the task's existing acceptance rubric. Compare required fields, factual grounding, refusal behavior, tool selection, latency, and cost. Include hard cases and inputs that should result in abstention. Record known weaknesses by request class rather than giving the fallback a single “quality score.” Pin the selected model or deployment identifier and evaluate updates through [[model-version-pinning-and-upgrade-evals]].

## Define eligibility and triggers

Specify which failures qualify for fallback: a provider timeout or outage, a bounded rate-limit response, or an explicit health signal. Do not route every application error to another provider; malformed inputs, authorization failures, policy rejections, and deterministic bugs will not be repaired by changing models. Avoid fallback for a response whose completion status is ambiguous until idempotency and duplicate-cost behavior are understood.

Set a failure threshold that protects against flapping. Require a sustained signal or bounded retry pattern before switching, and add a cooldown or controlled return-to-primary phase. The threshold should be based on measured workload and the service's SLO, not a hard-coded provider assumption. If failure scope is limited to one model, region, or tenant class, isolate that cohort rather than moving all traffic.

Check capacity before routing. A backup that is already near quota can turn a partial outage into a broader one. Estimate the additional tokens and concurrency, reserve bounded headroom, and cap fallback share. Route in measured increments when time permits, with a clear abort condition. For each increment, compare error rate, output validity, latency, token usage, and quality-specific indicators.

## Preserve privacy and safety properties

The fallback path must meet the same input-minimization, authorization, and safety requirements as the primary path. A provider outage does not authorize sending data to a different provider or region. Verify data-processing terms, endpoint behavior, retention settings, and allowed data categories before a model is approved for fallback. Keep the fallback region explicit; do not let “automatic” routing expand residency boundaries.

Use the same policy and output validation around both models. Different refusal patterns or structured-output support may require model-specific adapters, but adapters must not weaken required checks. If validation fails, return a clear controlled error or ask for human review rather than retrying indefinitely with successively different models. Store the route reason and model ID in bounded telemetry, without logging prompts or completions. See [[llm-tracing-with-sensitive-data-controls]].

## Degraded behavior and reversal

Decide what the user sees when the fallback is active. A status indicator, reduced capability notice, delayed job, or explicit “unable to complete safely” response is better than silently implying full service. For high-impact or irreversible decisions, the right fallback may be a human queue rather than another model. Keep the primary response contract stable where possible, but make material limitations visible.

When the primary appears healthy, verify stable success across representative traffic and confirm there is no delayed provider throttling before changing the route back. Return traffic gradually, watch the same quality and capacity signals, and keep the tested fallback path available during the observation period. Record who approved routing, start and end times, cohort, trigger, impact, and any unexpected billing or data-flow consequence.

## Approval checklist

- Candidate is evaluated for the actual task, including hard and refusal cases.
- Model, region, terms, capacity, cost, and output contract are documented.
- Triggers exclude application and policy errors that fallback cannot fix.
- Attempt counts, share limits, cooldown, and return conditions are defined.
- Quality and privacy guardrails remain active on the alternate route.
- User-facing degraded behavior and human escalation are agreed.
- Owners approve each route; changes are auditable and reversible.

Fallbacks must be reevaluated after a model, prompt, policy, or provider contract change. See [[model-provider-outage-runbook]] for incident execution and [[llm-api-cost-control]] for spending controls.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Google SRE: Release Engineering](https://sre.google/sre-book/release-engineering/): staged release and rollback principles.
- [Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html): provider-specific quota constraints; check current model and region values.
- [Data, privacy, and security for Foundry Models sold by Azure in Microsoft Foundry](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy): provider-specific data handling; scope and terms may vary.
