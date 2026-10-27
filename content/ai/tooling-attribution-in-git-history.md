---
title: Tooling attribution in git history
description: Decide whether commits, pull requests and branch names may name the AI tool used, enforce it in CI, and record provenance somewhere that is not the commit text.
type: pattern
tags:
  - ai
  - ci-cd
  - audit
  - supply-chain
created: 2026-10-27
modified: 2026-10-27
draft: false
---

Coding agents can add footers, co-author trailers and tool-named branch prefixes to the history they produce. This note is for engineers and platform teams who need one explicit, enforced policy for that, and a place to record AI provenance that does not depend on commit text. It covers trailer mechanics, CI enforcement and fixing a slip. It does not cover whether AI-generated code is acceptable at all ([[ai-generated-code-policy-and-provenance]]) or how agents isolate their work ([[coding-agent-branch-and-worktree-isolation]]).

> [!note] Not verified
> The sources were found through search on 2026-10-27, but the pages could not be fetched. Check before relying on this note: the canonical git documentation for trailers, GitHub's current rules for recognising `Co-authored-by`, how squash merge builds the final message, and the attribution setting name and schema of each agent tool you allow. Defaults changed between tool versions, and third-party reports disagree on whether some settings are honoured.

## Decide first, then enforce

History is permanent in practice. Choose one policy per repository before the first agent commit, write it in the repository baseline ([[repository-baseline-standard]]), and enforce it.

| Option | Commits                    | PR description                 | Provenance lives in               |
| ------ | -------------------------- | ------------------------------ | --------------------------------- |
| A      | No tool names              | No tool names                  | PR template field, release record |
| B      | Trailer on every AI commit | Optional                       | Commit trailers                   |
| C      | No tool names              | Required "AI assistance" field | PR description                    |

Option A fits teams that want history to read the same regardless of tooling. Option B suits regulated settings where reviewers must see assistance per commit. Any of them is fine; mixed history is the failure. This note's examples use option A, and the checks invert easily for B.

## Trailer mechanics

Trailers are `Token: value` lines in the last block of the commit message, separated from the body by a blank line. Add them with `git interpret-trailers` or `git commit --trailer`, not by hand, so the format stays parseable.

```bash
git commit -m "fix: handle empty config" \
  --trailer "Reviewed-by: Jane Doe <jane@example.com>"
```

`Co-authored-by:` is recognised by GitHub for crediting multiple authors and needs a name plus an email in angle brackets. A tool name with no real mailbox is not a co-author, and putting one there pollutes contributor lists and graphs. Check GitHub's current documentation for the exact recognition rules before using it for anything other than people.

Footers such as "Generated with ..." are plain text in the message or PR body. Branch prefixes named after a tool end up in URLs, merge request lists and release notes. Use your repository's own convention (`feat/`, `fix/`, `chore/`), as set out in [[branching-and-merge-standard]].

## Configure the tools, but do not rely on it

Each agent tool has its own setting for commit and PR attribution, and the names and defaults have changed between versions. Third-party sources report cases where a setting was ignored or where an instruction in the tool's own prompt added attribution anyway. Treat this as reported, and verify on the installed version. Distribute the setting through managed configuration ([[ai-coding-assistant-admin-controls]]), then test it by making a commit in a scratch repository after each tool upgrade.

A client-side `commit-msg` hook that strips or rejects a pattern is a convenience. `git commit --no-verify` skips it, and so does any tool that commits through a different path. It is not enforcement.

## Enforce in CI

A CI job that scans every commit in the merge request cannot be skipped by the author and can be made a required check ([[ci-pipeline-standard]]). Scan the whole range, not only the tip, and cover the PR title and body when the policy does.

```yaml title=".gitlab-ci.yml"
attribution-policy:
  stage: test
  image:
    name: alpine/git@sha256:REPLACE_WITH_DIGEST # pin the reviewed tag by digest
    entrypoint: [""] # the image's entrypoint is git; clear it so script: runs
  variables:
    GIT_DEPTH: "0"
    # Extended regex; keep the tool names your policy forbids here.
    FORBIDDEN_PATTERN: "Generated (with|by)|Co-authored-by:.*(bot|assistant|agent)|https?://[^ ]*/session_[A-Za-z0-9]+"
    FORBIDDEN_BRANCH: "^(ai|agent|bot)/"
  script:
    - |
      set -eu
      git fetch --quiet origin "${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}"
      base="$(git merge-base FETCH_HEAD HEAD)"
      if git log --format=%B "${base}..HEAD" | grep -Eiq "$FORBIDDEN_PATTERN"; then
        echo "Commit messages contain tool attribution. See the repository baseline." >&2
        git log --format='%h %s' "${base}..HEAD" >&2
        exit 1
      fi
      if printf '%s\n%s\n' "$CI_MERGE_REQUEST_TITLE" "$CI_MERGE_REQUEST_DESCRIPTION" \
           | grep -Eiq "$FORBIDDEN_PATTERN"; then
        echo "Merge request title or description contains tool attribution." >&2
        exit 1
      fi
      if printf '%s' "$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME" | grep -Eq "$FORBIDDEN_BRANCH"; then
        echo "Branch name uses a tool-named prefix; use feat/, fix/ or chore/." >&2
        exit 1
      fi
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

Notes on the job:

- `GIT_DEPTH: "0"` is needed so the merge base exists, and the job fetches the target branch explicitly because a merge request pipeline does not always have it.
- The session-link pattern matches URLs only, so identifiers such as `session_id` in a commit message do not trip it.
- GitLab may truncate long values of `CI_MERGE_REQUEST_DESCRIPTION`; check the current predefined-variable docs, and query the API if the full body matters.
- The patterns are examples. Keep the real list in one reviewed place and extend it when a new tool appears.
- Make the job a required status check in the protected-branch settings, otherwise it only advises.
- Squash merge writes a new message. Check the squash template and the default message so a footer cannot enter at merge time.
- On GitHub the same logic fits a workflow triggered by `pull_request`; the idea does not change.

A monthly audit completes the loop: count default-branch commits matching the pattern. A non-zero count means a gap in the check, such as direct pushes or a bypassed rule.

## Record provenance outside the commit text

If you need to know where AI assistance was used, store it where it can be structured and queried:

- A PR template field ("AI assistance: none / partial / most; tool; scope") reviewed by the approver ([[code-review]]).
- A release record or changelog entry for notable changes.
- Build provenance attestations for artifacts. SLSA describes provenance that travels with the artifact and may be recorded in a transparency log. Keep the mapping from commit to attestation in the release record, not in the message. Vendor support for these features varies and some is experimental, so check current docs.

This keeps history clean and still answers an auditor's question.

## Fixing a slip

Before merge, rewrite only your own feature branch: `git rebase -i` or `git commit --amend`, then `git push --force-with-lease`. Never rewrite protected or shared branches; after merge, accept the history and fix the check. If the leaked text is sensitive, such as a session link, treat it as an exposure and follow your incident process ([[ai-agent-security-incident-evidence]]).

## Failure modes

- Two tools on one team, one adds a trailer by default, so history is mixed.
- The policy is enforced only by a local hook and `--no-verify` or another client bypasses it.
- The CI job checks the tip commit only, so earlier commits carry the footer.
- Squash merge reintroduces a trailer from the MR description.
- A tool name is added as `Co-authored-by` without a real email, producing a bogus contributor entry.
- The check is not a required status, so merging is possible when it fails.
- A tool upgrade changes the default and nobody retests.

## Review checklist

- [ ] One attribution policy is written down per repository and linked from the baseline.
- [ ] Each allowed agent tool has its attribution setting configured centrally and retested after upgrades.
- [ ] A CI job scans all commits in the range, the PR title and body, and the branch name.
- [ ] The job is a required status check on protected branches.
- [ ] The squash-merge template was checked.
- [ ] Provenance is recorded in a PR field, release record or attestation, as the policy requires.
- [ ] Branch names follow the repository convention.
- [ ] A periodic audit counts matching commits on the default branch.
- [ ] The team knows how to fix a slip on a feature branch and what never to rewrite.

## Sources

- [git-interpret-trailers documentation](https://git-scm.com/docs/git-interpret-trailers) - trailer format and adding trailers to a commit message; not fetched, check the canonical page.
- [SLSA v1.2: distributing provenance](https://slsa.dev/spec/v1.2/distributing-provenance) - provenance attestations distributed with an artifact, supporting provenance kept outside the commit message.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
