---
title: Parallel agent fan-out and result merging
description: Run independent agent subtasks in parallel with one worktree and branch each, merge sequentially behind gates, and cap concurrency, cost and attempts.
type: pattern
tags:
  - ai
  - delivery
  - cost
  - reliability
created: 2026-10-27
modified: 2026-10-30
draft: false
---

This note covers running several agents in parallel on independent subtasks and merging their results safely: when to fan out, how to isolate writers, how to merge, and how to bound cost and concurrency. It is for engineers who orchestrate coding agents by hand, from scripts or from CI. It does not cover the isolation mechanics of a single agent ([[coding-agent-branch-and-worktree-isolation]]), handoff contracts between agents ([[multi-agent-handoff-boundaries]]) or sizing of the resulting changes ([[agent-pull-request-size-and-reviewability]]).

> [!note] Not verified
> The sources below were found through search, but the pages could not be fetched on 2026-10-27. Before relying on this note, check: your harness's current default concurrency and the setting that changes it, worktree naming and cleanup behaviour for your version, what is shared between worktrees (settings, plugins, permission approvals), and your provider's rate-limit tiers.

## Fan out only over independent work

Parallel agents pay off when subtasks have disjoint file sets, no shared generated artifacts and no ordering dependency. Typical good splits: the same mechanical change applied to separate services, one test file per agent, independent documentation pages, read-only audits of different modules. Vendor guidance is that most coding tasks have fewer parallelisable pieces than research tasks, so default to serial work and fan out only when the split is obvious. If two subtasks both touch a lockfile, a route table, a generated client or an index file, they are not independent.

Write the split down before launching, as a manifest the orchestrator can check:

```yaml title="fanout.yaml"
base: main
integration_branch: fanout/integration
limits: { max_parallel: 4, max_minutes: 30, max_attempts: 2 }
tasks:
  - { id: svc-a, branch: fanout/svc-a, owns: ["services/a/**"] }
  - { id: svc-b, branch: fanout/svc-b, owns: ["services/b/**"] }
  - { id: svc-c, branch: fanout/svc-c, owns: ["services/c/**"] }
shared_files_owner: integrator # lockfiles, generated code, index files
```

A pre-merge check can enforce `owns` by failing any branch whose diff touches files outside its globs.

## Isolate writers; share readers

Parallel agents editing one working tree collide. Give every writing agent its own git worktree and its own branch. Read-only agents (explorers, reviewers) can share the main checkout. Git normally refuses to check out one branch in two worktrees, so branch names must be unique per agent.

```bash title="fanout-start.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

base=main
git fetch origin "$base"
while read -r id; do
  git worktree add -b "fanout/$id" "../wt-$id" "origin/$base"
done < <(yq -r '.tasks[].id' fanout.yaml)
git worktree list
```

Some harnesses create and name worktrees for you and lock them while an agent runs; a clean worktree may be removed automatically while one with changes is kept. Check how yours behaves and plan cleanup for failed runs: `git worktree remove "../wt-$id"` refuses a worktree with uncommitted changes (only `--force` discards them), `git worktree prune` clears entries whose directory is gone, and `git branch -D "fanout/$id"` deletes unmerged commits, so run it only after the result is merged or deliberately abandoned.

Worktrees isolate files, not the world around them. Agents still share local ports, databases, caches, credentials and any remote service. Shared repository state also leaks: the `.git` directory is common, and in some harnesses project-scope plugins and saved permission approvals are shared across worktrees, so a permission granted in one run can apply to the others. Run each agent under least privilege ([[sandboxing-coding-agents-on-workstations-and-runners]]) and give each a separate test database or namespace.

## Return structured results

Subagent output comes back to the parent as a summary; verbose logs stay in the subagent's context. Require a machine-readable summary so the merge step can be scripted:

```json title="result.json (shape)"
{
  "task": "svc-a",
  "branch": "fanout/svc-a",
  "files_changed": ["services/a/handler.go", "services/a/handler_test.go"],
  "tests_run": ["go test ./services/a/..."],
  "tests_passed": true,
  "open_questions": [],
  "touched_outside_owns": []
}
```

## Merge sequentially behind gates

Run deterministic gates (build, tests, lint, policy) on every branch before it is eligible. Then merge one branch at a time into an integration branch and re-run the full suite after each merge. Branches that pass individually can break when combined, so the integrated result is the thing you ship.

```bash title="fanout-merge.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

: "${1:?usage: fanout-merge.sh <task-id>...}"
git fetch origin main
git switch -c fanout/integration origin/main   # fails if the branch already exists
for id in "$@"; do
  if ! git merge --no-ff "fanout/$id" -m "merge fanout/$id"; then
    git merge --abort
    echo "conflict in $id: split was wrong, route to a human" >&2
    exit 2
  fi
  make test lint            # full gates after each merge
done
```

Treat any non-trivial conflict as evidence the split was wrong, not as a task for an agent to resolve. Never let an agent auto-resolve conflicts in files it does not own. Shared files such as lockfiles and generated clients should be regenerated by one owner after merging, not hand-merged. Keep the integrated change reviewable ([[agent-pull-request-size-and-reviewability]]) and put an independent reviewer on it ([[independent-review-agents]]). When one agent run is cheaper at a lower model tier, see [[tiered-model-agent-workflows]].

## Bound cost and concurrency

Each parallel agent consumes its own context and tokens, so run cost is the sum. Multi-agent runs can use many times the tokens of a single session; measure your own runs rather than relying on published figures, which come from different workloads. Set a per-run token or spend budget before launch, and stop the run when it is hit.

Concurrency also hits provider rate limits. A burst of many agents can throttle the whole team's quota, including unrelated CI jobs. Cap parallelism at a small number, stagger launches, and use backoff ([[rate-limits-backpressure-and-queue-design]], [[llm-retry-timeout-and-circuit-breaker-policy]]). Harnesses have their own default concurrency limits and settings to change them; look them up rather than assuming a number.

Set stop conditions per agent: a maximum wall-clock time and a maximum number of attempts ([[bounded-agent-loops-and-stop-conditions]]). A stuck agent holds a worktree, a branch and a rate-limit slot.

## Fan out in CI

For CI-based fan-out, use parallel jobs with explicit `needs` and a single integration job that collects artifacts. Each agent job must push its `fanout/<id>` branch, because the integration job runs in a fresh clone and has no local branches from the other jobs; fetch them before merging. Cap concurrency through the matrix size and runner limits, not `resource_group`, which would run the matrix jobs one at a time.

```yaml title=".gitlab-ci.yml"
default:
  image: registry.example.com/ci/agent-runner@sha256:REPLACE_WITH_DIGEST # change: your image, pinned by digest

agent-task:
  stage: build
  parallel:
    matrix:
      - TASK: [svc-a, svc-b, svc-c]
  timeout: 30 minutes
  script: [./agent/run.sh "$TASK"]
  artifacts:
    paths: [results/$TASK.json]
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

integrate:
  stage: test
  needs: [agent-task]
  script:
    - git fetch origin 'refs/heads/fanout/*:refs/heads/fanout/*'
    - ./fanout-merge.sh svc-a svc-b svc-c
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

## Failure modes

- **Hidden coupling:** two branches change the same generated file or an implicit contract; both pass alone and fail merged.
- **Agent-resolved conflicts:** an agent edits files it does not own to make a merge go through.
- **Shared environment collisions:** same port, database or cache key across worktrees.
- **Permission bleed:** an approval granted for one run silently applies to all.
- **Quota exhaustion:** a burst of agents starves other teams or pipelines.
- **Stale worktrees and branches:** abandoned runs leave disk and branch clutter.
- **Unbounded cost:** many agents each retry without a shared budget.
- **Gates only per branch:** nothing re-checks the integrated result.

## Review checklist

- [ ] Subtasks are independent; the split and file ownership are written down.
- [ ] Each writing agent has its own worktree and uniquely named branch.
- [ ] Environments (ports, databases, caches) are separated per agent.
- [ ] Permissions are least-privilege and not widened by shared approvals.
- [ ] Results are structured and include files touched and tests run.
- [ ] Branches are merged one at a time with the full suite after each merge.
- [ ] Conflicts abort the merge and go to a human; shared files have one owner.
- [ ] Parallelism, wall-clock, attempts and spend are capped per run.
- [ ] Cleanup of worktrees and branches is scripted for failed and abandoned runs.
- [ ] The integrated diff gets independent review before merge.

## Sources

- Your coding agent's own documentation for parallel subagents, worktree naming, concurrency limits and cleanup. The tool-specific behaviour this note gives as an example varies by tool and version; check it there before copying any configuration.
- [git-worktree documentation](https://git-scm.com/docs/git-worktree) — linked worktrees share history; add, list, lock, prune and remove; a branch is not normally checked out in two worktrees.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
