---
title: Evaluating task success for agents
description: Measure whether an agent reaches a valid outcome safely across complete multi-step tasks.
type: guide
tags:
  - ai
  - reliability
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Score the outcome, not the conversation

Agent evaluation must cover the whole task lifecycle: request interpretation, planning, tool use, state changes, final result and handoff. A fluent final message is not evidence that the requested work was completed, and an agent that reaches the right result through unauthorized or unsafe actions has not succeeded. This outcome-centered evaluation complements operational safeguards in [[securing-ai-agents-in-ci-and-cloud]].

Define a task contract with initial state, allowed resources and actions, desired end state, prohibited side effects, verification procedure, and conditions for escalation or abstention. Use independent state inspection where possible rather than trusting the agent's self-report. Examples include checking a created ticket by ID, comparing a repository diff to a specification, or verifying that a simulated deployment state meets declared invariants. Each task should have an oracle that can determine success without relying on the same model's reasoning.

## Build realistic, controlled scenarios

Sample task templates from the intended workflow and create variations in user phrasing, state, missing information, tool errors, permissions and timeouts. Include no-op requests, requests that require clarification, denied operations, stale state and partial completion. Use a simulator or sandbox for state-changing tasks until the evaluation environment has been reviewed and isolated. Never use production credentials or data merely to make a benchmark feel realistic.

Keep the initial environment resettable. Record task, scenario seed, tool versions, starting state, policy, prompt, model and evaluator versions. Randomize variable values without changing the underlying objective. Use held-out scenarios or parameterized variations to reduce memorization and leakage. Distinguish tasks that test planning from those that test execution, and label risk and consequence.

## Metrics and meaningful denominators

Measure end-to-end task completion rate using an explicit success rubric; partial completion rate; unsafe-action rate; policy-violation rate; escalation appropriateness; unnecessary action rate; and recovery from tool error. Track number of steps, retries, tool calls, latency and cost as efficiency measures, not substitutes for success. A more efficient agent that misses critical requirements is worse, not better.

Count tasks as the independent evaluation unit where possible, and report confidence intervals and per-task category counts. When tasks share environments or templates, note dependence. Report critical failures separately instead of allowing many easy successes to dilute them. For stochastic agents, run repeated trials on a subset and report variability, but avoid treating repeated runs of the same task as independent tasks.

For long workflows, define checkpoints and score both intermediate state and final state. This reveals whether a failure was a misunderstanding, a tool error, a broken recovery strategy or a state-verification defect. Distinguish agent failure from environment instability using a repeatable harness and logs that capture tool requests and results. Avoid storing secrets or unnecessary content in those logs.

## Tradeoffs and failure modes

Real environments improve ecological validity but introduce safety risk, nondeterminism and irreproducibility. Simulators are controllable but may omit real permission and integration behavior. Human ratings capture nuanced interaction quality but do not reliably prove state changes. Deterministic oracles are reproducible but can reward shallow goal hacking if they check too few invariants. Combine controlled scenarios, independent state assertions and human review for ambiguous user experience.

Failure modes include measuring only completion, allowing prohibited side effects, weak oracles, hidden evaluator access to private state, training contamination, flaky fixtures, retry budgets that conceal poor initial performance, and task selection that excludes difficult requests. An agent may satisfy the success predicate while leaving cleanup or audit requirements unmet. Include invariants for those conditions and inspect traces for suspicious shortcuts.

## Review checklist

- Is success defined as a verifiable end state with safety constraints?
- Is the oracle independent of the agent's final explanation?
- Are environments isolated, resettable and least-privileged?
- Do cases cover clarification, failure, denial and partial completion?
- Are safety failures reported separately from completion rates?
- Are efficiency, latency, cost and retries secondary measures?
- Are tool traces and environment versions sufficient for diagnosis?
- Has the harness been checked for goal-hacking loopholes?

The owner's agent skills and workflows are listed in [the AI skills catalogue](https://ai.szolotov.com).

## Sources

- [NIST AI RMF Playbook (AI RMF 1.0 (January 2023); page notes it is being updated, accessed 2026-10-26)](https://airc.nist.gov/airmf-resources/playbook/): evaluating systems in operational context and managing lifecycle risk; the linked page states AI RMF 1.0 is being updated (accessed 2026-10-26).
- [Working with evals (OpenAI API; documentation accessed 2026-10-26)](https://developers.openai.com/api/docs/guides/evals): task datasets and graders for evaluating model behavior.
- [Gen AI evaluation service overview (Gemini Enterprise Agent Platform; Google Cloud documentation accessed 2026-10-26)](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/evaluation-overview): evaluation design and metrics for generative applications.
