---
title: Independent review agents
description: Use a separate reviewer agent with fresh context, narrow scope and adversarial framing, backed by deterministic gates and a capped fix loop.
type: pattern
tags:
  - ai
  - team-process
  - reliability
  - ci-cd
created: 2026-10-27
modified: 2026-10-27
draft: false
---

This note covers using a separate reviewer agent to check another agent's output: fresh context, a different prompt or model, adversarial framing, verified findings and a capped fix loop. It is for engineers and platform teams who already let agents write code and want a review stage that adds signal rather than agreement. It does not cover the review bot product choices in [[ai-code-review-bots]], validating a judge model ([[llm-as-judge-validation]]) or the human review baseline in [[code-review]].

> [!note] Not verified
> The sources below were found through search, but the pages could not be fetched on 2026-10-27. Before relying on this note, check: how your harness handles subagent context and tool allowlists, and whether self-preference bias in evaluator models, reported in some papers and not others, shows up on your own outputs. Reviewer catch rates are not published for these setups; measure them yourself.

## Why independence matters

A reviewer that shares the author's context inherits its assumptions: the same misreading of the spec, the same unexamined shortcut. Three levers reduce that, in rough order of value:

1. **Fresh context.** Give the reviewer the spec, the diff and the test output. Do not give it the author's reasoning, chat history or self-assessment.
2. **Different framing.** A prompt whose job is to falsify the change finds different things than one asked to "check this looks good".
3. **Different model where practical.** Some studies report that model evaluators favour their own generations; others find no effect in some settings. Treat it as a reason to test, not a settled fact. A cross-vendor reviewer also changes data handling, so check provider terms first ([[ai-generated-code-policy-and-provenance]]).

Many harnesses run subagents in their own context window without the parent conversation, which gives a fresh-context reviewer by default. Some also offer "forked" subagents that inherit the whole conversation; never use those for review. Confirm the behaviour in your tool's docs, and restrict the reviewer to read-only tools.

## Deterministic gates first

The model reviewer is never the only gate for something a tool can check. Run, in order, and only invoke the reviewer on a diff that passes:

```yaml title=".gitlab-ci.yml"
stages: [build, test, scan, agent-review]

default:
  image: registry.example.com/ci/agent-runner@sha256:REPLACE_WITH_DIGEST # change: your image, pinned by digest

unit-tests:
  stage: test
  script: [make test]
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

lint-and-types:
  stage: test
  script: [make lint typecheck]
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

secret-and-sast:
  stage: scan
  script: [make scan]
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

agent-review:
  stage: agent-review
  needs: [unit-tests, lint-and-types, secret-and-sast]
  script:
    - ./review/run.sh "$CI_MERGE_REQUEST_DIFF_BASE_SHA" "$CI_COMMIT_SHA"
  artifacts:
    paths: [review-findings.json]
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes: ["src/**/*", "infra/**/*"]
```

Infrastructure changes also deserve policy checks before any model sees them ([[validating-ai-generated-infrastructure-code]]).

## Scope each reviewer narrowly

One reviewer per concern gives more actionable output and a clear owner for each finding: correctness against the spec, security, and test adequacy are three separate prompts. A broad "review this" pass produces style nits and vague worries. Give each reviewer a written rubric and a closed output schema:

```json title="review-findings.schema.json (shape)"
{
  "reviewer": "security",
  "model": "<pinned-id>",
  "prompt_version": "2026-10-27.1",
  "findings": [
    {
      "id": "F1",
      "severity": "high",
      "location": "src/auth/session.ts:88",
      "claim": "Token compared with == instead of constant-time compare",
      "reproduction": "Unit test or command that demonstrates it",
      "confidence": "medium"
    }
  ]
}
```

Drop any finding without a location and a concrete reproduction or argument. In practice this filters out many hallucinated defects; measure how many on your own reviews.

## Verify findings before acting

Treat every review comment as a hypothesis. A second pass, ideally a different agent told to refute the claim, or better a deterministic check (a failing test written from the reproduction), turns it into evidence. Track precision per reviewer configuration: of the findings raised, how many were real after verification. If precision is low, change the prompt or scope before adding more reviewers. Keep a small set of known-bad diffs and check that the reviewer still catches them after each prompt or model change ([[ai-assisted-test-generation-quality-gates]]).

## Cap the loop

Author, review, fix, re-review needs a maximum round count, commonly two or three. After that, stop and hand over to a human with the open findings. Otherwise reviewers keep surfacing marginal items and the loop never converges. Re-reviews should see the new diff plus the list of previous findings, so resolved items are not re-raised.

```bash title="review-loop.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

: "${BASE:?set BASE to the target branch SHA}"
max_rounds=3
for ((round = 1; round <= max_rounds; round++)); do
  head=$(git rev-parse HEAD)   # re-read: the fix step adds commits
  ./review/run.sh "$BASE" "$head" > review-findings.json
  jq -e '[.findings[] | select(.severity == "high")] | length == 0' \
    review-findings.json >/dev/null && exit 0
  ./author/fix.sh review-findings.json
  make test lint typecheck
done
echo "round cap reached: needs human review" >&2
exit 1
```

## Approval is evidence, not sign-off

For changes that affect production, a reviewer agent's approval is one input. A human still approves, and the approval gate stays outside the agent's control ([[human-approval-state-machine]]). Record, per verdict, the reviewer model ID, prompt version, diff hash and findings, so a later miss can be traced ([[ai-generated-code-policy-and-provenance]]).

## Failure modes

- **Shared context:** the reviewer sees the author's notes and agrees with them.
- **Same prompt, same model, second run:** produces correlated blind spots and a false sense of two-key control.
- **Ungrounded findings:** plausible but unverified claims cause churn and erode trust.
- **Reviewer with write tools:** it "fixes" things during review and the author-reviewer boundary disappears.
- **Style loop:** unbounded rounds spent on nits.
- **Model as the only gate:** a check a linter or test could do is left to a probabilistic reviewer.
- **Prompt injection through the diff:** content in code, comments or docs steers the reviewer; keep it tool-restricted and treat its output as untrusted data ([[prompt-injection-test-harness-for-ci-agents]]).

## Review checklist

- [ ] Reviewer runs in a fresh context with only spec, diff and test output.
- [ ] Reviewer tools are read-only; it cannot push, merge or approve.
- [ ] Build, tests, types, lint, secret scan and policy checks pass before the reviewer runs.
- [ ] Each reviewer has one concern, a rubric and a closed output schema.
- [ ] Findings without a location and a reproduction or argument are discarded.
- [ ] Findings are verified by a deterministic check or an independent refutation pass.
- [ ] Round cap is enforced and escalation goes to a named human.
- [ ] Reviewer model, prompt version and verdict are logged per change.
- [ ] Precision is measured against known-bad diffs after any prompt or model change.
- [ ] Human approval remains required for production-impacting changes.

## Sources

- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) — the evaluator-optimizer pattern and the conditions under which it helps (clear criteria, measurable value of iteration).
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) — example of subagents with their own context window and per-subagent tool allowlists (check current docs for your version).
- [How we built our multi-agent research system](https://www.anthropic.com/engineering/built-multi-agent-research-system) — separate-context subagents keep the lead's context clean; multi-agent suits breadth-first work more than tightly coupled work.
- [LLM Evaluators Recognize and Favor Their Own Generations](https://arxiv.org/abs/2404.13076) — reported self-preference in model evaluators; results vary by task, so verify on your own outputs.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
