---
title: Bounded agent loops and stop conditions
description: Limit agent iterations, tool calls, time and retries with explicit stopping rules that fail visibly rather than running indefinitely.
type: pattern
tags:
  - ai
  - reliability
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

An agent loop commonly asks a model for a next action, executes a tool, appends the result and asks again. Without a hard budget and clear termination contract, a harmless task can repeat calls, consume a budget, flood an upstream service or keep running after the user has lost interest. The correct loop limit is an application control, not a request that the model “stop after a few steps.” This note focuses on runtime bounds, complementing the incident response in [[runaway-or-compromised-ai-agent-response]].

## Set independent limits

Bound more than the number of model turns. Use independent ceilings for:

- Total wall-clock duration, including queue wait and provider retries.
- Model attempts and total input/output token budget.
- Tool calls per run and per tool, with stricter limits for expensive or write-capable tools.
- Tool concurrency, response bytes and accumulated context size.
- Retry count and backoff duration for each transient error class.
- Monetary or quota budget where the application has a reliable estimate.

Keep the limits in trusted runtime configuration. Establish a conservative default and permit a task-specific lower limit. Any higher exception should have a named owner, rationale, expiry and monitoring. A limit in a model prompt is guidance only.

## Define stop conditions

The loop should stop on a validated completion, a refusal, an unrecoverable error, a user cancellation, budget exhaustion, deadline, repeated no-progress result, or a policy decision requiring a human. Define “no progress” using observable state, such as repeating an identical tool request or failing a required validation repeatedly. Avoid relying only on textual similarity because paraphrases can conceal repeated work and legitimate equivalent calls can differ in wording.

On stop, return a structured outcome: completed, partial, awaiting human, cancelled, budget exhausted, failed or timed out. Provide a concise explanation and what evidence was gathered. Never present a partial result as a fully verified one. If another attempt might help, make it an explicit user or operator decision rather than an invisible extension of the loop.

## Retries and circuit breakers

Retry only errors classified as transient, with jittered backoff and a strict total deadline. Respect provider retry guidance where documented, but keep local ceilings because retries multiply across layers. Do not retry validation failures or policy refusals unchanged. For a tool call that may have committed a change before timing out, reconcile by querying the operation status or use an idempotency key before any retry.

Use a circuit breaker for repeated dependency failure: temporarily stop sending calls, report the dependency as unavailable, and resume through controlled probes or a cooldown. A circuit breaker is not a reason to redirect to an unreviewed provider or a broader tool. Fallbacks need their own privacy, model and output-contract review.

## Observe and operate

Track low-cardinality counters for runs completed by outcome, iterations, tool calls, retry counts, budget exhaustion and cancellations. Keep run IDs in traces, not metric labels. Alert on sudden changes in average calls per successful run, budget exhaustion rate, or runs that hit deadlines. The control-plane response for a runaway execution should be documented with [[runaway-or-compromised-ai-agent-response]].

## Failure modes and review checklist

A per-turn timeout without a total deadline allows infinite retries. A model token cap does not cap tool calls. A max-turn counter that resets on a retry defeats the bound. A tool response with a huge payload can exhaust memory before the next turn. A stop condition that is checked only after an external write is too late. Another common bug is returning success after hitting a budget because the model produced a polished summary of incomplete work.

- [ ] Runtime enforces wall-time, model, tool, context and retry budgets.
- [ ] Limits cannot be increased by model-generated arguments.
- [ ] Stop outcomes distinguish complete from partial and uncertain.
- [ ] Retry policy is per error class and safe for side effects.
- [ ] No-progress and duplicate-call detection are deterministic enough to test.
- [ ] Cancellation stops scheduling new work and records in-flight uncertainty.
- [ ] Telemetry supports capacity and runaway detection without prompt content.
- [ ] Tests cover each limit and confirm no call occurs after termination.

## Sources

- [OpenAI: Function calling](https://developers.openai.com/api/docs/guides/function-calling) — describes the application handling tool calls; design execution bounds in that application layer.
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) — risk context for autonomous systems and excessive agency.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) — monitoring and governance framing; AI RMF 1.0 is being revised according to NIST.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
