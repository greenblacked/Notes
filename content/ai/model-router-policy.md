---
title: Model router policy
description: Route requests among approved models using explicit capability, privacy, residency, reliability and cost rules with a safe fallback policy.
type: pattern
tags:
  - ai
  - security
  - reliability
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

A model router chooses which approved model or endpoint receives a request. This can improve cost, latency, regional availability or task quality, but dynamic routing can also silently change data handling, safety behavior, output format and operational dependency. Route using explicit policy and tested capabilities, not a model's self-assessment or an unbounded “cheapest available” rule. Keep model inventory and upgrade evaluations in [[model-version-pinning-and-upgrade-evals]].

## Define eligible routes

For every route, maintain an approved model ID or endpoint, provider/account, region, data classification allowed, supported modalities, structured-output compatibility, tool-use behavior, retention settings, rate limits, cost model, owner and retirement status. The router should select only from this policy registry. Never accept a model identifier, provider URL or region directly from user content or model output.

Define routing criteria by task. A short classification may use a lower-cost model if its quality and refusal behavior meet the application's acceptance bar. A sensitive internal document may require a specific region or provider contract. A task that requires a strict schema should go only to routes whose current implementation is evaluated for that schema. Model names and aliases can change; use pinned identifiers and review deprecations.

Make routing explainable: emit a reason code such as `route=classification_low_latency`, policy revision, and model revision, without logging the prompt. Do not include user ID or free-form task description in metric labels. If model choice is a regulated or contractual boundary, have the responsible owner approve the eligibility policy.

Keep policy evaluation deterministic and testable. A request should be classified from trusted metadata—such as an application route, data label, or required output contract—not a model-generated routing recommendation. If classification is missing or contradictory, route to the stricter eligible path or reject explicitly. Maintain a decision table so reviewers can see why a model is eligible, and add tests proving that each data class cannot select prohibited providers or regions.

## Fallbacks are separate decisions

A fallback must satisfy the same data classification and capability requirements as the primary route. A regional outage is not authorization to send data to an unapproved region. A cheaper fallback must not silently bypass schema or safety requirements. If no eligible route remains, fail closed or return an explicit degraded service outcome.

Use circuit breakers and bounded retry budgets. Do not retry the same request across several providers without tracking duplicated exposure, cost and potential side effects. For tool-capable agents, ensure the fallback has compatible tool schemas and authority; do not broaden tools to recover from a capability mismatch.

## Evaluate and monitor

Run the same versioned evaluation set against every candidate route, including normal tasks, ambiguous inputs, refusals, structured output, tool selection and failure behavior. Compare quality, latency, cost, schema failures and policy compliance. A route that passes average-quality evaluation may still fail on a high-risk slice; keep risk-specific minimum criteria.

Monitor route distribution, fallback rate, provider errors, latency, cost and outcome quality proxies. Alert on unexpected route changes, not merely overall availability. Preserve a rollback path to the last approved router policy, and do not change model routing independently from version inventory and evaluations.

Use a canary when a route policy changes: limit the new distribution, compare against a stable cohort on the same task mix, and set rollback thresholds before deployment. Do not infer quality from user engagement alone; measure task-specific outcomes and review high-risk regressions. Ensure operators can force a route to `unavailable` during an incident without replacing it with an unreviewed endpoint.

## Failure modes and review checklist

Common mistakes include aliases resolving to new model versions without review; fallback to a different provider with different retention; selection by prompt-derived labels; a route chosen for low cost despite unsupported schema constraints; retries multiplying spending; and an undocumented emergency route persisting after an incident.

- [ ] Eligible models and regions are in a reviewed policy registry.
- [ ] Data handling, capability, version, cost and owner are recorded per route.
- [ ] User/model inputs cannot supply a destination or bypass eligibility.
- [ ] Fallbacks preserve privacy, authority and output requirements.
- [ ] No route available produces an explicit safe failure.
- [ ] Candidate models pass task- and risk-specific evaluations.
- [ ] Telemetry records route and policy revisions without prompt content.
- [ ] Emergency exceptions expire and have an accountable owner.

## Sources

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) — governance and risk management; NIST reports that AI RMF 1.0 is being revised.
- [OpenAI: Models](https://developers.openai.com/api/docs/models) — current provider model catalog; availability and model capabilities change.
- [Google AI: Models](https://ai.google.dev/gemini-api/docs/models) — current Gemini model documentation; verify capabilities and regional availability at deployment time.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
