---
title: Detecting model degradation in production
description: Combine service telemetry, output checks, and sampled review to catch model regressions without logging sensitive content.
type: pattern
tags:
  - ai
  - observability
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Define degradation before measuring it

Model degradation is a worsening user outcome, not necessarily a provider outage. It may appear as lower task completion, more invalid structured output, increased refusal rates in benign workflows, slower generation, more tool handoffs, or growing user retries. Define the failure modes for each product task before selecting metrics. A summarizer might need factual coverage and format validity; a retrieval assistant might need evidence-supported answers and abstention when evidence is absent. Generic “quality” scores are not actionable unless the rubric names observable behavior.

Separate the service envelope from semantic quality. Track request acceptance, completion, timeout, latency, token use, and provider errors as operational metrics. Measure task quality against a versioned evaluation set and a reviewed sample of production outcomes. Do not collapse those into a single health score: a model can be fast and available while returning worse answers, or produce strong answers while latency becomes unacceptable. [[llm-observability-tracing-and-slos]] explains telemetry boundaries; [[model-version-pinning-and-upgrade-evals]] covers controlled comparison before rollout.

## Build a layered signal set

Start with deterministic checks that are cheap and repeatable: schema validation, required-field presence, allowed-tool selection, citation structure, output length, refusal classification where product policy defines it, and basic language or encoding checks. These catch obvious regressions but do not establish correctness. Keep each check's pass rate distinct, so a rising parse failure is not hidden by a stable average score.

Use task-specific evaluation for semantic quality. Maintain a fixed set that represents common and difficult cases, with expected properties and known limitations. Include normal traffic classes, boundary cases, multilingual inputs when supported, and requests that should be declined or routed to a human. Avoid optimizing a model against a tiny public benchmark that does not represent your users. For production, sample by request class and outcome, then have trained reviewers assess a rubric. Preserve only the minimum data needed for assessment and apply the same privacy and access controls used for service logs.

Compare distributions, not only averages. A mean score can hide severe regressions in a minority workflow. Monitor per-task pass rates, latency quantiles, refusal and retry rates, and fallback shares. Alert on sustained movement beyond a baseline that accounts for normal seasonality and traffic mix. Segment on model revision, prompt version, region, and feature flag where volumes are adequate; report sample counts next to percentages.

## Detect change and find causes

Attach stable release identifiers to requests: model/provider deployment identifier, prompt-template revision, tool schema revision, policy revision, and evaluator version. Use bounded-cardinality labels and avoid raw prompts as labels. If the provider exposes a mutable alias, record both the alias requested and the returned version or deployment metadata where available. Treat absent version metadata as an observability limitation, not as evidence that the model stayed unchanged.

When a signal crosses a threshold, compare affected cohorts with a control cohort or recent baseline. Check for input distribution shifts, retrieval corpus changes, changed context length, tool schema drift, quota pressure, and evaluator changes before attributing the effect to the model. An evaluation pipeline itself can regress; retain a known-good reference set and reviewer calibration. If a quality estimator is another model, treat it as a noisy sensor and periodically compare it with human judgments.

## Triage and decision rules

Use severity based on user harm and breadth, not a score alone. A structural parse failure with safe fallback may justify a rollout pause; unsafe output or unsupported factual claims in a consequential workflow require immediate escalation through the product's established incident path. Follow [[ai-assisted-incident-response]] for incident coordination. Define in advance the quality floor that blocks promotion and the minimum production signals that justify expanding a canary.

During investigation, prefer reversible containment: stop increasing exposure, route a measured cohort to a known-good version, disable an optional feature through an approved change process, or present a clear degraded experience. Record the evidence and owner for each choice. Do not silently suppress an alert because a benchmark looks healthy, and do not “fix” quality by removing difficult cases from the evaluation set without documented review.

## Checklist

- Task-specific failure modes and quality rubric are written down.
- Deterministic output checks are separated from semantic evaluation.
- Every sample and score has a model, prompt, tool, and evaluator revision.
- Dashboards show distributions, counts, cohorts, latency, and fallback share.
- Production samples are minimized, access-controlled, and reviewed under retention rules.
- Alert thresholds and rollout stop conditions have named owners.
- A suspected regression is compared against input, retrieval, quota, and evaluator changes.

Recalibrate after a product workflow changes, not just after a model upgrade. Engineering guidance is not legal advice for products that make regulated or high-impact decisions.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [GitHub: OpenTelemetry GenAI Semantic Conventions](https://github.com/open-telemetry/semantic-conventions-genai): current community convention repository; conventions evolve and should be checked at adoption.
- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs): provider-specific structured-output behavior; API details may change.
- [Google SRE: Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/): monitoring signals and alert interpretation.
