---
title: Tiered model agent workflows
description: Route coding-agent subtasks to cheap, mid or strongest model tiers by risk and verifiability, with escalation caps, handoff discipline and logging.
type: pattern
tags:
  - ai
  - cost
  - reliability
  - team-process
created: 2026-10-27
modified: 2026-10-27
draft: false
---

This note covers how to split one coding-agent workflow across model tiers: a cheap, fast tier for read-only exploration, a mid tier for bounded implementation, and the strongest tier for ambiguous design and final review of risky diffs. It is for engineers and platform teams who run agent workflows by hand or in CI and want predictable cost and quality. It does not cover request-level routing for production applications ([[model-router-policy]]), provider failover ([[fallback-model-selection-and-quality-degradation]]) or per-call cost maths ([[per-request-cost-estimation]]).

> [!note] Not verified
> The sources below were found through search, but the pages could not be fetched on 2026-10-27. Before relying on this note, check: the current subagent configuration fields and model aliases in your harness docs, the current tier mapping and pricing for your provider, and whether the token-multiplier figures from the vendor's research post apply to coding work (they come from research tasks, not coding).

## Tier by subtask, not by project

A tier is a per-subtask routing decision. Classify each subtask by three properties, then pick the lowest tier that has a verifiable success check.

| Property                  | Low                           | High                                 |
| ------------------------- | ----------------------------- | ------------------------------------ |
| Reversibility             | Read-only, output discardable | Writes to shared state, hard to undo |
| Blast radius              | One file, one function        | Auth, migrations, pipelines, IAM     |
| Cross-file context needed | Local                         | Many modules, implicit contracts     |

A workable default mapping, written in tier terms because model names change every few months:

- **Cheap tier:** file search, log and test-output summarisation, "where is X defined", first-pass triage. Wrong output is cheap to throw away and is verified downstream.
- **Mid tier:** implementation against a clear spec with existing tests, kept small enough for one reviewable diff ([[agent-pull-request-size-and-reviewability]]).
- **Strongest tier:** architecture choices, ambiguous specs, security-sensitive changes, and the final review of high-risk diffs ([[independent-review-agents]]). Do not spend it on bulk exploration.

Keep the model names out of prose and policy. Put them in one dated table that is reviewed on every model change:

```yaml title="agent-tiers.yaml"
# Reviewed on every model change. Tier names are stable; model IDs are not.
reviewed: 2026-10-27
tiers:
  cheap: { model: "<pinned-id-a>", use: [explore, summarise, triage] }
  mid: { model: "<pinned-id-b>", use: [implement, test-fix] }
  strongest: { model: "<pinned-id-c>", use: [design, security-review, final-review] }
escalation:
  max_attempts_per_tier: 2
  escalate_on: [failed_check, explicit_uncertain]
```

## Configure tiers through subagents

Many harnesses let a subagent definition name its own model. In Claude Code, for example, subagent definitions accept a `model` field, with a per-invocation override taking precedence over frontmatter. Check the current docs for the alias list and resolution order before copying any config. A read-only explorer might look like this:

```markdown title="explorer.md (location depends on your harness)"
---
name: explorer
description: Read-only codebase exploration. Returns a structured summary.
model: <cheap-tier>
tools: Read, Grep, Glob
---

Report: files read, relevant symbols, constraints you found,
and anything you could not determine. Never edit files.
```

Each subagent has its own context window and tool allowlist, so exploration noise stays out of the main session. This is also what makes cheap-tier delegation worthwhile: the volume of tokens read is absorbed by the tier that is cheap, and only a short summary reaches the expensive one.

## Escalation rule

Start at the lowest tier that has a verifiable success check (a test, a type check, a linter, a schema validation). Escalate on a failed check or when the agent flags uncertainty, and cap attempts per tier. After the cap, escalate once and then stop and hand the task to a human. Without a cap you get the worst case: repeated cheap attempts plus an expensive one. See [[bounded-agent-loops-and-stop-conditions]].

```bash title="escalate.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

task="${1:?usage: escalate.sh <task>}"
tiers=(cheap mid strongest)
max_attempts=2

for tier in "${tiers[@]}"; do
  for ((i = 1; i <= max_attempts; i++)); do
    echo "tier=$tier attempt=$i" >> run.log   # record who produced what
    ./run-agent.sh --tier "$tier" --task "$task" || continue
    if make check; then exit 0; fi            # deterministic gate decides
  done
done
echo "escalate to human" >&2
exit 1
```

The gate (`make check`) decides success, not the agent's own report. The loop always starts at the cheap tier; for subtasks the table above classes as high risk, start the list at `mid` or `strongest` instead of paying for doomed cheap attempts. Run it in a disposable worktree, because a failed attempt can leave edits behind for the next one ([[coding-agent-branch-and-worktree-isolation]]).

## Cost is tokens per resolved task

Price per token is only one input. A cheap model that reads the wrong files and sends a lossy summary costs more in retries and re-reading than one strong pass. Measure tokens and wall-clock per resolved task, split by tier, and compare against a single-tier baseline on a fixed task set. Multi-agent runs can use several times the tokens of a single chat session; the vendor research post reports large multiples for research workloads, but that is one internal evaluation, so measure your own. Tiering saves money only if the cheap tier really absorbs the volume.

Two further levers are separate from tiering: batch interfaces (discounted, asynchronous, unsuitable for interactive loops) and prompt caching (a stable system prompt and tool list make repeated calls on one tier cheaper, while very short one-off calls can lose). Verify current terms in provider docs. Budget limits belong in [[llm-api-cost-control]] and [[context-window-budgeting]].

## Log tier provenance

Record, per artifact, which tier and pinned model ID produced it, the prompt or skill version, and the gate result. Without that you cannot tell whether a regression came from the model, the prompt or the routing table. Re-run a small fixed eval set whenever a model version or tier mapping changes ([[model-version-pinning-and-upgrade-evals]]); a mapping that was right for one release can be wrong for the next.

## Failure modes

- **Lossy handoff:** the cheap tier's summary omits a constraint and the mid tier implements against the wrong picture. Require summaries with an explicit "not determined" section ([[multi-agent-handoff-boundaries]]).
- **Weak or same-tier reviewer:** the reviewer shares the author's blind spots. Review needs fresh context and, for risky changes, a stronger tier; treat "weaker reviewers miss more" as an inference to test, not a measured result.
- **Hidden complexity:** a task that looked simple needs cross-module reasoning, so it escalates repeatedly and costs more than starting strong. Route by cross-file context, not line count.
- **Coupled work split across tiers:** tightly coupled coding changes parallelise and delegate poorly; keep them in one context.
- **Unpinned aliases:** a tier alias moves to a new model and behaviour changes without review.
- **No cap:** escalation loops until the budget is gone.

## Review checklist

- [ ] Each tier has a documented set of allowed task types and a pinned model ID.
- [ ] Every cheap-tier task has a deterministic success check downstream.
- [ ] Escalation triggers and attempt caps are written down and enforced in code.
- [ ] Exploration returns structured summaries that list what was not found.
- [ ] High-risk paths (auth, IAM, migrations, pipelines) always reach the strongest tier or a human.
- [ ] Reviewer context and tier are independent of the author's.
- [ ] Tier, model ID and gate result are logged per artifact.
- [ ] Cost is tracked as tokens per resolved task against a single-tier baseline.
- [ ] Routing is re-evaluated on a fixed eval set when a model changes.

## Sources

- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) — orchestrator-worker and evaluator-optimizer patterns; start simple and add complexity only when it measurably helps; agentic systems trade latency and cost for performance.
- [How we built our multi-agent research system](https://www.anthropic.com/engineering/built-multi-agent-research-system) — token multiples for multi-agent runs on research tasks; caveat that tightly coupled work such as most coding suits multi-agent designs poorly.
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) — example of a per-subagent model field, resolution order, separate context windows and tool allowlists (check current docs).
- [Claude Code common workflows](https://code.claude.com/docs/en/common-workflows) — delegating research to subagents to keep the main context clean.
- [Claude API pricing](https://platform.claude.com/docs/en/about-claude/pricing) — example of how batch and caching modifiers are published; values change, check the current page.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
