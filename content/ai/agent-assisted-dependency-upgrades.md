---
title: Agent-assisted dependency upgrades
description: Pair Renovate or Dependabot with a coding agent that fixes breaking upgrades on the bot branch, with CI, supply-chain checks and no auto-merged majors.
type: pattern
tags:
  - ai
  - supply-chain
  - ci-cd
  - delivery
created: 2026-10-27
modified: 2026-10-27
draft: false
---

This note describes how to combine a dependency bot with a coding agent so that breaking upgrades get a proposed code fix without weakening review or supply-chain controls. It is for teams already running Renovate or Dependabot. It does not cover choosing a bot ([[renovate-vs-dependabot]]), the baseline update process ([[automated-dependency-updates]], [[dependency-update-policy]]), or agents that install packages on their own ([[ai-agent-package-installation-risks]]).

> [!note] Not verified
> The sources were found through search on 2026-10-27, but the pages could not be fetched. Check against current docs before use: the Renovate option names and defaults (`minimumReleaseAge`, `dependencyDashboardApproval`, `separateMajorMinor`) for the version you pin; Dependabot ignore syntax and `dependabot.yml` keys, including any cooldown option; how your platform limits auto-merge by update type; and how an agent product is triggered on a bot PR and what token it receives. Nothing here was run.

## Division of labour

The bot decides what to upgrade and when. The agent only repairs code broken by that upgrade, and only on the PR branch. Keep these separate:

1. The bot opens the upgrade MR with the manifest and lockfile change.
2. CI runs. If it fails with a breaking change, a trigger starts the agent.
3. The agent pushes a separate commit (or a fix MR targeting the bot branch) containing only code changes.
4. CI runs again, with the same required checks as a human change.
5. A human reviews and merges.

The bump stays an isolated, reviewable change, and the agent's commit can be reverted alone.

## Gate the expensive and risky cases

Do not start an agent on every release. Use bot policy to hold majors until someone chooses to spend effort on them:

```json title="renovate.json"
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "separateMajorMinor": true,
  "minimumReleaseAge": "3 days",
  "packageRules": [
    {
      "matchUpdateTypes": ["major"],
      "dependencyDashboardApproval": true,
      "automerge": false,
      "labels": ["dependency-major", "agent-eligible"]
    },
    {
      "matchUpdateTypes": ["minor", "patch"],
      "automerge": false
    }
  ]
}
```

The three-day delay is an example policy, not a recommendation. A release-age delay gives time for a malicious or yanked version to be caught; depending on `internalChecksFilter`, Renovate either waits to create the branch or creates it with a pending status check (check the current docs for the default). Where the package manager has an equivalent setting, set it there too. If you auto-merge anything, limit it to patch and minor updates that pass full CI; never majors. Team-wide Dependabot ignores (for example ignoring `version-update:semver-major`) belong in `dependabot.yml`, because comment-command ignores are per-PR state.

A label such as `agent-eligible` is a convenient trigger condition. In GitLab CI:

```yaml title=".gitlab-ci.yml"
agent-fix-upgrade:
  stage: remediate
  image: registry.example.com/ci/agent-runner@sha256:REPLACE_WITH_DIGEST
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_LABELS =~ /agent-eligible/ && $CI_MERGE_REQUEST_SOURCE_BRANCH_NAME =~ /^renovate\//'
      when: manual
      allow_failure: true
  # needs: [] keeps the job runnable after the test job has failed;
  # a needs on the failed job would skip it. The script fetches the failing job log.
  needs: []
  script:
    - ./ci/agent-fix.sh
```

`when: manual` keeps a human choosing to spend agent time. Check the current docs for your CI's variable names and fork-MR behaviour, and do not expose write tokens to fork-controlled pipelines.

## What the agent gets

- The exact old and new versions, the changelog and migration guide for that range, and the failing CI output.
- An instruction to list each breaking change it found with a citation to the changelog entry or failing test. Reject any fix it cannot trace to one.
- A narrow remit: call sites of the changed API only. Cap files and lines touched, and split anything bigger ([[agent-pull-request-size-and-reviewability]], [[ai-code-refactoring-scope-and-rollback]]).

Treat changelog text as untrusted input: it comes from a third party and can carry injected instructions. Give the agent no secrets and only the egress it needs ([[agent-network-egress-controls]]).

## What the agent must not do

- Edit lockfiles or write checksums by hand. CI regenerates them with the package manager and verifies they match the manifest.
- Add, remove or swap dependencies to make a build pass, or loosen version ranges.
- Delete or weaken tests, lint rules, type checks or scanner configuration. Enforce this with a path-based check that fails if the agent's commit touches protected files; see [[deterministic-hooks-for-coding-agents]].
- Merge. Its token should not allow it.

A guard in CI can enforce the lockfile and scope rules:

```bash title="ci/guard-agent-commit.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

base="${1:?base ref}"
head="${2:?head ref}"
max_files="${MAX_AGENT_FILES:-15}"

changed="$(git diff --name-only "$base...$head")"

if grep -Eq '(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|go\.sum)$' <<<"$changed"; then
  echo "agent commit touches a lockfile; regenerate in CI instead" >&2
  exit 1
fi

if grep -Eq '^(\.gitlab-ci\.yml|ci/|\.github/|renovate\.json)' <<<"$changed"; then
  echo "agent commit touches CI or bot configuration" >&2
  exit 1
fi

count="$(grep -c . <<<"$changed" || true)"
if (( count > max_files )); then
  echo "agent commit touches $count files (limit $max_files)" >&2
  exit 1
fi
```

Run this on the agent's commits only, for example by comparing against the bot's last commit. It does not catch weakened tests: add your lint and scanner configuration paths to the protected list, and flag any change to test files for explicit reviewer attention, since a legitimate fix may need to update a test's call sites.

## Supply-chain checks before merge

The agent's tests passing is not enough. Run the same checks as for any dependency change, on the new version:

- Publisher or maintainer change, new install scripts and new transitive dependencies.
- Provenance attestations where the ecosystem publishes them. Support differs by ecosystem; describe the policy per ecosystem.
- Known advisories, through your scanner ([[vulnerability-management-slas]]).
- Package existence and name checks if the agent proposed any new import ([[dependency-hallucination-controls]]).

Pin CI actions or images to digests and let the bot update the pins, so pinning does not leave stale, unpatched references.

## Measure whether the agent earns its place

Track time from release to merged upgrade, share of agent fixes accepted without edits, share rejected in review, post-merge rollbacks, and agent cost per merged upgrade ([[measuring-ai-impact-on-delivery]]). If rejections or rollbacks dominate, narrow the eligible set or remove the step.

## Failure modes

- The agent makes tests pass by weakening them or pinning back to the old version.
- A large agent diff hides unrelated changes inside a "dependency" MR.
- Hand-edited lockfile with a mismatched integrity hash, or a quietly swapped transitive package.
- Majors auto-merged through a broad `automerge` rule.
- Release-age delay disabled "just this once" for an urgent security patch, bypassing review of the new publisher.
- Changelog or README content steers the agent into unrelated edits.
- Bot and agent fight: each pushes to the same branch and CI loops.

## Review checklist

- [ ] The bot owns the bump; the agent commits only code changes on the bot branch.
- [ ] Majors need explicit approval and are never auto-merged.
- [ ] A release-age delay is configured in the bot and, where available, the package manager.
- [ ] The agent receives version-specific release notes and must cite them.
- [ ] Diff scope, file count and protected paths are enforced in CI.
- [ ] Lockfiles are regenerated by tooling, never hand-edited.
- [ ] Full CI plus supply-chain checks run on the new version.
- [ ] Agent token cannot merge; a human reviews every upgrade MR.
- [ ] Acceptance, rejection, rollback and cost are tracked.

## Sources

- [Renovate docs: minimum release age](https://docs.renovatebot.com/key-concepts/minimum-release-age/) - release-age hold with a pending check.
- [Renovate docs: FAQ](https://docs.renovatebot.com/faq) - default separation of major and minor branches.
- [GitHub Docs: Dependabot pull request comment commands](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-pull-request-comment-commands) - ignoring major, minor and patch versions via comments.
- [NIST SP 800-218: Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - risk-based practices behind the supply-chain framing.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
