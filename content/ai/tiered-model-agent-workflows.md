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
modified: 2026-11-02
draft: false
evidence: source-reviewed
reviewed: 2026-11-02
review-due: 2027-05-02
---

This note covers how to split one coding-agent workflow across model tiers: a cheap, fast tier for read-only exploration, a mid tier for bounded implementation, and the strongest tier for ambiguous design and final review of risky diffs. It is for engineers and platform teams who run agent workflows by hand or in CI and want predictable cost and quality. It does not cover request-level routing for production applications ([[model-router-policy]]), provider failover ([[fallback-model-selection-and-quality-degradation]]) or per-call cost maths ([[per-request-cost-estimation]]).

> [!note] Tool-specific details
> Subagent configuration fields, model aliases, tier pricing and multi-agent token multipliers vary by tool and provider. Check them in your own harness and provider docs before copying any configuration (see Evidence).

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
reviewed: 2026-11-02
tiers:
  cheap: { model: "<pinned-id-a>", use: [explore, summarise, triage] }
  mid: { model: "<pinned-id-b>", use: [implement, test-fix] }
  strongest: { model: "<pinned-id-c>", use: [design, security-review, final-review] }
escalation:
  max_attempts_per_tier: 2
  escalate_on: [failed_check, explicit_uncertain]
```

## Configure tiers through subagents

Many harnesses let a subagent definition name its own model, often with a per-invocation override that takes precedence over the definition. Check the current docs for the alias list and resolution order before copying any config. A read-only explorer might look like this:

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

Start at the lowest tier that has a verifiable success check (a test, a type check, a linter, a schema validation). Escalate on a failed check or when the agent flags uncertainty, and cap attempts per tier. Escalate through each tier up to its cap, then stop and hand the task to a human after the strongest tier's cap is spent. The sample script implements only the failed-check trigger; the `explicit_uncertain` trigger in the YAML is not implemented there. Without a cap you get the worst case: repeated cheap attempts plus an expensive one. See [[bounded-agent-loops-and-stop-conditions]].

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

Price per token is only one input. A cheap model that reads the wrong files and sends a lossy summary costs more in retries and re-reading than one strong pass. Measure tokens and wall-clock per resolved task, split by tier, and compare against a single-tier baseline on a fixed task set. Multi-agent runs can use several times the tokens of a single chat session; published figures come from research workloads, not coding, so measure your own.

Two further levers are separate from tiering: batch interfaces (discounted, asynchronous, unsuitable for interactive loops) and prompt caching (a stable system prompt and tool list make repeated calls on one tier cheaper, while very short one-off calls can lose). Verify current terms in provider docs. Budget limits belong in [[llm-api-cost-control]] and [[context-window-budgeting]].

## Log tier provenance

Record, per artifact, which tier and pinned model ID produced it, the prompt or skill version, and the gate result. Without that you cannot tell whether a regression came from the model, the prompt or the routing table. Re-run a small fixed eval set whenever a model version or tier mapping changes ([[model-version-pinning-and-upgrade-evals]]); a mapping that was right for one release can be wrong for the next.

## Failure modes

- **Lossy handoff:** the cheap tier's summary omits a constraint and the mid tier implements against the wrong picture. Require summaries with an explicit "not determined" section ([[multi-agent-handoff-boundaries]]).
- **Weak or same-tier reviewer:** the reviewer shares the author's blind spots. Review needs fresh context and, for risky changes, a stronger tier; treat "weaker reviewers miss more" as an inference to test, not a measured result.
- **Hidden complexity:** a task that looked simple needs cross-module reasoning, so it escalates repeatedly and costs more than starting strong. Route by cross-file context, not line count.
- **Coupled work split across tiers:** tightly coupled coding changes usually parallelise and delegate poorly; keep them in one context.
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

## Evidence

Source-reviewed on 2026-11-02. Nothing was run. Scope: the OWASP LLM Top 10 and the OpenTelemetry GenAI semantic conventions were checked locally; the rest of the note is tool- and provider-specific or engineering guidance.

### Sources checked

- [OWASP Top 10 for LLM Applications 2025: LLM06 Excessive Agency](https://genai.owasp.org/llm-top-10/): recommends minimising extensions, functionality and permissions, and requiring human approval before high-impact actions, which supports requiring a human, or a deterministic downstream authorization check (mediation in the downstream system rather than the model), for high-impact actions. It says nothing about model tiers or about specific paths such as auth, IAM, migrations or pipelines. Checked 2026-11-02 against owasp-llm commit 99f4395 (2_0_vulns/LLM06_ExcessiveAgency.md lines 52-78).
- [OWASP Top 10 for LLM Applications 2025: LLM10 Unbounded Consumption](https://genai.owasp.org/llm-top-10/): recommends rate limiting and user quotas, timeouts and throttling as controls against unbounded cost, and describes cost-per-use exploitation (Denial of Wallet) by attackers or users. Applying such limits to per-tier attempt caps is this note's own inference. Checked 2026-11-02 against owasp-llm commit 99f4395 (2_0_vulns/LLM10_UnboundedConsumption.md lines 17, 49-57).
- [OpenTelemetry GenAI semantic conventions, attribute registry](https://github.com/open-telemetry/semantic-conventions-genai/blob/244465e/docs/registry/attributes/gen-ai.md): defines `gen_ai.request.model` (the model a request is made to), `gen_ai.response.model` (the model that generated the response), `gen_ai.usage.input_tokens` and `gen_ai.usage.cache_read.input_tokens`, which back logging the requested and answering model plus token usage per call. Checked 2026-11-02 against semantic-conventions-genai commit 244465e (docs/registry/attributes/gen-ai.md lines 44, 57, 83, 88).

### Not verified

- Subagent definition fields, per-invocation model override precedence, model aliases, and the claim that each subagent has its own context window and tool allowlist: harness documentation was not available locally.
- Batch interface discounts, prompt caching behaviour and pricing, and published token-multiplier figures for multi-agent runs: provider documentation was not available locally. The locally available inference-server docs were searched; they describe self-hosted prefix caching but not provider pricing terms.
- The NIST AI Risk Management Framework framing: NIST publications were not reachable.
- Tier mapping, escalation caps (two attempts per tier), the example scripts and the failure modes (lossy handoff, weaker reviewers, hidden complexity, and that tightly coupled coding changes parallelise and delegate poorly) are engineering guidance, not documented claims. So are the routing of high-risk paths (auth, IAM, migrations, pipelines) to the strongest tier, and the claim that model names change every few months, which is opinion.
- Nothing was run, including the example `escalate.sh` and the YAML and subagent samples.

## Sources

- Your coding agent's and model provider's own documentation for per-subagent model settings, alias resolution, and batch and caching price modifiers. The tool-specific behaviour this note gives as an example varies by tool and version; check it there before copying any configuration.
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/): LLM06 Excessive Agency (human approval for high-impact actions, minimised permissions) and LLM10 Unbounded Consumption (rate limits, timeouts, cost-driven abuse).
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework): governance framing for deciding where model output needs independent checks and human sign-off. Not read for this review.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
