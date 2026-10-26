---
title: Evaluating tool-call accuracy and arguments
description: Test agent tool selection, argument correctness, sequencing and safety independently from final response quality.
type: guide
tags:
  - ai
  - reliability
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Treat calls as structured decisions

A tool call is an action with a schema, authority and side effects, not simply a line of generated text. Evaluate whether an agent selected the right tool, supplied valid arguments, respected authorization, sequenced calls correctly and stopped when the task was complete. A correct final answer can conceal a harmful intermediate call; a malformed call may be safely rejected but still signal a reliability defect. For the wider end-to-end outcome, pair this with [[task-success-evaluation-for-agents]].

Define an expected behavior contract for each scenario: calls allowed, calls required, argument invariants, ordering constraints, forbidden actions, and acceptable no-call or clarification outcomes. Compare semantics rather than byte-for-byte JSON where equivalent arguments are valid. For example, normalize harmless key order and optional defaults, but do not normalize away an incorrect project, resource identifier, amount or permission scope.

## Test individual dimensions

Measure tool selection accuracy, argument-field correctness, complete-call exactness, schema-validity rate, unnecessary-call rate, omitted-required-call rate, sequencing success and policy-violation rate. Calculate at call and task levels, clearly defining the denominator. For argument quality, score critical fields separately from descriptive fields: a wrong target ID is not comparable to an inconsequential title typo. Report exact-match results alongside field-level results to keep the operational risk visible.

Build cases for valid requests, ambiguous identifiers, missing required values, conflicting constraints, invalid enum values, boundary inputs, permission-denied tools, transient errors and tool results that contradict assumptions. Test injection in tool output as untrusted data and confirm it cannot modify system policy or authorize actions. Maintain deterministic fixtures and inspect the raw structured request produced by the model before any wrapper repairs it.

Use schema validators and policy checks as deterministic graders. Semantic suitability—whether a chosen query or argument actually answers the user's request—may need expert labels or a validated judge. Keep pre-validation output, post-validation request and tool result distinct in traces. If middleware fills a default or repairs a malformed argument, count and report that separately; otherwise the measured agent can appear more capable than it is.

## Safe harness and decision criteria

Run state-changing tests against mocks, simulators or isolated disposable accounts. Give each tool only the authority necessary for its scenario, and include a denial test proving that disallowed actions remain blocked. A test that checks only whether the model refrains from a destructive call is incomplete if the mock tool would accept it in production. Tool contracts and server-side enforcement should be evaluated together, consistent with [[internal-mcp-servers-for-platform-tools]].

Use paired evaluation across model versions with identical tool schemas, prompts and fixtures. Report confidence intervals and critical error examples. Thresholds depend on action impact; a locally selected threshold is a release decision, not a property of the metric. For high-impact actions, deterministic allowlists, confirmation gates or human approval may be required even when measured accuracy is high. Monitor schema changes as dependencies and retest when tool descriptions, defaults, authorization or backend behavior changes.

## Failure modes and tradeoffs

Common issues include checking tool names but not arguments; accepting a syntactically valid call with semantically wrong targets; recording only successful calls; counting wrapper retries as original model behavior; and allowing mock tools to have unrealistic permissiveness. Tool call accuracy can be inflated by exposing test answers in tool descriptions. Conversely, strict string matching can penalize valid equivalent arguments. Freeze expected outputs, define normalization, and audit borderline cases.

A narrow mock makes runs cheap and reproducible but can miss latency, authorization or side-effect issues. Live integration testing adds realism and operational risk. Use layered validation: unit-level schema tests, sandbox workflow tests, then carefully scoped integration checks where authorized.

## Review checklist

- Are selection, arguments, sequence and policy measured separately?
- Are critical argument fields weighted by consequence?
- Are raw model calls distinguished from middleware repairs?
- Do fixtures cover ambiguity, invalid values, denial and error recovery?
- Are test tools isolated, resettable and least-privileged?
- Are semantic labels and deterministic validation both used appropriately?
- Does every tool/schema/permission change trigger relevant regression tests?
- Are human confirmation gates retained where risk warrants them?

The owner's agent skills and workflows are listed in [the AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Working with evals (OpenAI API; documentation accessed 2026-10-26)](https://developers.openai.com/api/docs/guides/evals): constructing graders and task-specific model evaluations.
- [Structured model outputs (OpenAI API; documentation accessed 2026-10-26)](https://developers.openai.com/api/docs/guides/structured-outputs): current provider guidance for constrained structured output; confirm the supported modes and limits in the live documentation before relying on them.
- [Tool use with Claude (Claude Platform Docs; accessed 2026-10-26)](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview): tool definitions and structured tool-use behavior.
- [Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile (NIST AI 600-1; July 2024)](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): risks associated with autonomous actions and model outputs.
