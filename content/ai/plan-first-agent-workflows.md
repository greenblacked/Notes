---
title: Plan-first agent workflows
description: Require a reviewed, versioned plan before a coding agent edits files, with approval gates, a plan file in the repo and checks that catch drift from the plan.
type: pattern
tags:
  - ai
  - team-process
  - delivery
  - reliability
created: 2026-10-27
modified: 2026-10-27
draft: false
---

This note describes how to make a coding agent propose a plan, get it approved, and then implement it, so that reviewers compare the diff against something explicit. It is for engineers and team leads who run agents on feature or refactoring work. It does not cover how to size the resulting pull request ([[agent-pull-request-size-and-reviewability]]), how to package repository context ([[repository-context-packaging-for-coding-agents]]), or how to prove the work is finished ([[agent-done-criteria-and-verification]]).

> [!note] Not verified
> The sources below were found via search and the pages could not be re-fetched when this note was written on 2026-10-27, and the plan-drift heuristics are team practice, not vendor guidance. Before relying on this note, check the current docs for: how your agent's plan mode behaves in interactive and non-interactive sessions, the names of its approval options, and the configuration keys that change them. Treat any named mode or shortcut as an example.

## Why a plan step earns its cost

An agent that starts editing immediately commits to an interpretation of the task before anyone has seen it. A plan step moves the first disagreement to a cheap place: a short document, not a 40-file diff. It also gives the reviewer an expected-change list to compare against. No vendor publishes evidence that plan-first beats direct implementation for every task class, so use it where the task is ambiguous, touches several modules, or is hard to revert, and skip it for one-line fixes. General agent-design guidance is to start with the simplest design and add structure only when it demonstrably helps.

## Separate planning from editing

Use the agent's read-only planning mode if it has one: the agent reads files and proposes a plan, and edits are blocked until a human approves. Check the current docs for how to enter it and what the approval options are. Two cautions:

- Plan mode is a workflow aid, not a security boundary. Behaviour can differ by session type and permission settings, so destructive operations and secret access still need deterministic gates ([[deterministic-hooks-for-coding-agents]], [[agent-tool-authorization-boundaries]]).
- Make the approval mode a deliberate team decision. If approval can mean "continue with manual edit approval" or "continue with broad auto-approval", record which one is allowed for which kind of repository, instead of leaving it to each person's habit.

Where the tool lets you edit the plan before approving, do so. Deleting a step and tightening scope is the cheapest review you will ever do.

## Put the plan in the repo

Chat plans disappear with the session. For anything that spans more than one sitting, or more than one person, commit a plan file on the feature branch, for example `docs/plans/<slug>.md`, so the reviewer sees plan and diff together.

```markdown
# Plan: replace the billing-sync service-account key with workload identity

## Goal

Replace JSON key files with workload identity in the `billing-sync` job.

## Non-goals

No change to other jobs. No Terraform state moves.

## Expected changes

- `ci/billing-sync.yml`
- `terraform/billing/iam.tf`
- `docs/runbooks/billing-sync.md`

## Steps and checks

1. Add the IAM binding. Check: `terraform validate` exits 0 and the plan shows 1 add, 0 destroy.
2. Switch the job to the identity token. Check: pipeline job `billing-sync` is green on the branch.
3. Remove the key variable. Check: `git grep BILLING_SA_KEY` returns nothing.

## Rollback

Revert the merge commit; the old key is still valid until step 3 is released.

## Deviations

(The agent appends here if it departs from the plan.)
```

A good plan is checkable: every step names a file or module, a command that proves it, and a stop condition. "Improve error handling" is not reviewable. If the plan cannot fit one reviewable diff, split it into phases with their own approval gate each.

When you delegate to a sub-agent, remember it typically starts from the delegation message, not your conversation. Write the plan out in that message or point to the plan file.

## Detect plan drift

Drift is the implementation diverging from the approved plan. These checks are team practice and cheap to automate; run them before review, in the agent's final step and again in CI.

```bash title="scripts/plan-drift.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

plan="docs/plans/${1:?plan slug}.md"
base="${2:-origin/main}"

# Files promised in the plan: bullet lines inside "## Expected changes"
expected=$(awk '/^## Expected changes/{f=1;next} /^## /{f=0} f && /^- /{gsub(/^- `|`$/,"");print}' "$plan" | sort -u)
actual=$(git diff --name-only "$base"...HEAD | { grep -vxF -- "$plan" || true; } | sort -u)

unplanned=$(comm -13 <(printf '%s\n' "$expected") <(printf '%s\n' "$actual"))
if [[ -n "$unplanned" ]]; then
  echo "Plan drift: files changed but not in the plan:" >&2
  printf '%s\n' "$unplanned" | sed 's/^/  /' >&2
  exit 1
fi

# New dependencies are always drift unless the plan names them.
if git diff "$base"...HEAD -- package.json go.mod requirements.txt | grep -E '^\+[^+]' >/dev/null; then
  grep -qi 'dependenc' "$plan" || { echo "Dependency change without a plan entry" >&2; exit 1; }
fi
```

Also look for: a new directory, a changed public interface or API schema, and acceptance commands that were not run after the last edit. A failing drift check means stop and re-approve, not quietly accept.

## Re-plan on new information

If a step fails or the agent finds a constraint the plan missed, it should stop, record the deviation in the plan file, and ask for re-approval. Improvising mid-run is how a scoped change becomes an unreviewable one. Pair this with a retry limit ([[bounded-agent-loops-and-stop-conditions]]) so a failing step ends in a report rather than an escalating series of edits.

## Gate the pipeline too

For work that reaches a shared branch, make the plan a merge input. A simple GitLab CI job can require the plan file on agent branches and run the drift script.

```yaml title=".gitlab-ci.yml"
plan-drift:
  stage: test
  image: registry.example.com/ci/toolbox@sha256:REPLACE_WITH_DIGEST # change: an image with git, bash and awk, pinned by digest
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_SOURCE_BRANCH_NAME =~ /^agent\//'
  script:
    - slug="${CI_MERGE_REQUEST_SOURCE_BRANCH_NAME#agent/}"
    - test -f "docs/plans/${slug}.md"
    - git fetch origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    - bash scripts/plan-drift.sh "$slug" "origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}"
```

With shallow clones the three-dot diff also needs the merge base, so raise `GIT_DEPTH` or deepen the fetch if it fails with "no merge base". For production-affecting work, the plan approval does not replace the change process: use [[human-approval-state-machine]] and [[production-change-checklist]].

## Measure whether it helps

Track two numbers: how often an approved plan needed a mid-run amendment, and how often drift was caught before review. High amendment rates mean plans are written too early or without enough context; zero drift catches for months may mean the gate is not being exercised. Reassess whether planning is worth its cost per task class.

## Failure modes

- The plan is approved by the same session that wrote it, with no human reading it.
- Approval defaults to the broadest auto-approval mode because it is the fastest.
- The plan lives only in chat, so reviewers cannot find it.
- The expected-file list is so generous (`src/**`) that drift can never fail.
- The agent edits the plan to match the diff, instead of recording a deviation. Require plan changes to be a separate, visible commit.
- Plan mode is treated as a safety control and shell or network access is left open.
- A huge plan is approved as one unit and the diff is too large to review.

## Review checklist

- [ ] The task class has a rule for when a plan is required.
- [ ] The plan names goal, non-goals, expected files, checks per step and rollback.
- [ ] A human read and approved the plan before edits began.
- [ ] The approval mode used is the one the team allows for this repository.
- [ ] The plan file is committed on the branch, not only in chat.
- [ ] Changed files, new dependencies and interface changes match the plan.
- [ ] Every acceptance check ran after the last edit.
- [ ] Deviations are recorded in the plan and were re-approved.
- [ ] Destructive or production steps have gates outside the agent loop.

## Sources

- [Claude Code permission modes](https://code.claude.com/docs/en/permission-modes) - plan mode blocks edits until approval, the approval options, editing the plan before approving, and the caveat that behaviour varies by session type.
- [Claude Code common workflows](https://code.claude.com/docs/en/common-workflows) - the "plan before editing" recipe and reviewing changes before they touch disk.
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) - start with the simplest design and add complexity only when it improves outcomes.
- [Claude Code sub-agents](https://code.claude.com/docs/en/sub-agents) - a sub-agent starts from its delegation message, so the plan must be written out when delegating.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
