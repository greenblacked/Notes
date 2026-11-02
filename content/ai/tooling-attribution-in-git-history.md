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
modified: 2026-11-02
draft: false
evidence: source-reviewed
reviewed: 2026-11-02
review-due: 2027-05-02
---

Coding agents can add footers, co-author trailers and tool-named branch prefixes to the history they produce. This note is for engineers and platform teams who need one explicit, enforced policy for that, and a place to record AI provenance that does not depend on commit text. It covers trailer mechanics, CI enforcement and fixing a slip. It does not cover whether AI-generated code is acceptable at all ([[ai-generated-code-policy-and-provenance]]) or how agents isolate their work ([[coding-agent-branch-and-worktree-isolation]]).

## Decide first, then enforce

History is permanent in practice. Choose one policy per repository before the first agent commit, write it in the repository baseline ([[repository-baseline-standard]]), and enforce it.

| Option | Commits                    | PR description                 | Provenance lives in               |
| ------ | -------------------------- | ------------------------------ | --------------------------------- |
| A      | No tool names              | No tool names                  | PR template field, release record |
| B      | Trailer on every AI commit | Optional                       | Commit trailers                   |
| C      | No tool names              | Required "AI assistance" field | PR description                    |

Option A fits teams that want history to read the same regardless of tooling. Option B suits regulated settings where reviewers must see assistance per commit. Any of them is fine; mixed history is the failure. This note's examples use option A, and the checks invert easily for B.

## Trailer mechanics

Trailers are key-value lines with a colon separator (the key is ASCII alphanumerics and hyphens) in a trailer block at the end of the commit message, preceded by a blank line. Add them with `git interpret-trailers` or `git commit --trailer`, which git documents for this purpose, rather than by hand, so the format stays parseable.

```bash
git commit -m "fix: handle empty config" \
  --trailer "Reviewed-by: Jane Doe <jane@example.com>"
```

`Co-authored-by:` is, in git's own contribution guide, a trailer for people who exchanged drafts; GitHub also uses it to credit multiple authors, with a name plus an email in angle brackets. A tool name with no real mailbox is not a co-author, and putting one there pollutes contributor lists and graphs. Check GitHub's current documentation for the exact recognition rules before using it for anything other than people; that was not checked here.

Footers such as "Generated with ..." are plain text in the message or PR body. Branch prefixes named after a tool end up in URLs, merge request lists and release notes. Use your repository's own convention (`feat/`, `fix/`, `chore/`), as set out in [[branching-and-merge-standard]].

## Configure the tools, but do not rely on it

Each agent tool has its own setting for commit and PR attribution, and the names and defaults have changed between versions. Third-party sources report cases where a setting was ignored or where an instruction in the tool's own prompt added attribution anyway. Treat this as reported, and verify on the installed version. Distribute the setting through managed configuration ([[ai-coding-assistant-admin-controls]]), then test it by making a commit in a scratch repository after each tool upgrade.

A client-side `commit-msg` hook that strips or rejects a pattern is a convenience. `git commit --no-verify` bypasses the `commit-msg` hook, and so does any tool that commits through a different path. It is not enforcement.

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

- `GIT_DEPTH` sets a shallow-clone depth, and GitLab warns that too small a value can leave commits missing from the cloned history. The job sets `"0"` so the merge base exists, and fetches the target branch explicitly in case it is not present.
- The session-link pattern matches URLs only, so identifiers such as `session_id` in a commit message do not trip it.
- GitLab stores only the first 2700 characters of `CI_MERGE_REQUEST_DESCRIPTION` and sets `CI_MERGE_REQUEST_DESCRIPTION_IS_TRUNCATED` to `true` when it cuts; fail the job or query the API if the full body matters.
- The patterns are examples. Keep the real list in one reviewed place and extend it when a new tool appears.
- Make the job a required check, otherwise it only advises. On GitLab, enable the "Pipelines must succeed" merge check; on GitHub, mark the check required in branch protection.
- Squash merge writes a new message. GitLab has merge and squash commit message templates in project settings; check them and the default message so a footer cannot enter at merge time.
- On GitHub the same logic fits a workflow triggered by `pull_request`; the idea does not change.

A monthly audit completes the loop: count default-branch commits matching the pattern. A non-zero count means a gap in the check, such as direct pushes or a bypassed rule.

## Record provenance outside the commit text

If you need to know where AI assistance was used, store it where it can be structured and queried:

- A PR template field ("AI assistance: none / partial / most; tool; scope") reviewed by the approver ([[code-review]]).
- A release record or changelog entry for notable changes.
- Build provenance attestations for artifacts. SLSA lists three places to publish provenance (with the source repository release, beside the artifact in the package registry, or elsewhere with a hash and pointer in a transparency log), and says producers should use more than one. Keep the mapping from commit to attestation in the release record, not in the message. Vendor support for these features varies and some is experimental, so check current docs.

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
- [ ] The job is a required check ("Pipelines must succeed" on GitLab, a required status check on GitHub).
- [ ] The squash-merge template was checked.
- [ ] Provenance is recorded in a PR field, release record or attestation, as the policy requires.
- [ ] Branch names follow the repository convention.
- [ ] A periodic audit counts matching commits on the default branch.
- [ ] The team knows how to fix a slip on a feature branch and what never to rewrite.

## Evidence

Source-reviewed on 2026-11-02. Nothing was run. Scope: git trailer and hook mechanics, the GitLab CI variables used in the example job, and the SLSA provenance distribution options; GitHub and agent-tool behaviour were not checkable.

### Sources checked

- [git-interpret-trailers](https://git-scm.com/docs/git-interpret-trailers): a trailer is a key-value pair with a colon separator, the key is ASCII alphanumerics and hyphens, and the trailer block must be preceded by a blank line and sits at the end of the message (Documentation/git-interpret-trailers.adoc lines 15-25, 90). Checked 2026-11-02 against git commit 50fe5cc.
- [git-commit](https://git-scm.com/docs/git-commit): `--trailer <token>[(=|:)<value>]` adds trailers (Documentation/git-commit.adoc line 207); `--no-verify` bypasses the `pre-commit` and `commit-msg` hooks (line 220); the `--amend` option exists (line 274). Checked 2026-11-02 against git commit 50fe5cc.
- [Submitting patches (git)](https://git-scm.com/docs/SubmittingPatches): `Co-authored-by:` indicates people who exchanged drafts (Documentation/SubmittingPatches line 517). Checked 2026-11-02 against git commit 50fe5cc.
- [git-push](https://git-scm.com/docs/git-push): the `--force-with-lease` option exists (Documentation/git-push.adoc line 231). Checked 2026-11-02 against git commit 50fe5cc.
- [git-rebase](https://git-scm.com/docs/git-rebase): `-i` / `--interactive` exists (Documentation/git-rebase.adoc lines 11-13). Checked 2026-11-02 against git commit 50fe5cc.
- [GitLab predefined CI/CD variables](https://docs.gitlab.com/ci/variables/predefined_variables/): `CI_MERGE_REQUEST_TITLE`, `CI_MERGE_REQUEST_DESCRIPTION`, `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`, `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` exist; the description is cut to its first 2700 characters, flagged by `CI_MERGE_REQUEST_DESCRIPTION_IS_TRUNCATED` (doc/ci/variables/predefined_variables.md lines 203-204, 213, 220, 223). Checked 2026-11-02 against gitlabhq/gitlabhq commit d7b9a61.
- [GitLab runners configuration](https://docs.gitlab.com/ci/runners/configure_runners/): `GIT_DEPTH` sets shallow clone depth and too small a value can make old commits unavailable (doc/ci/runners/configure_runners.md lines 880-895). Checked 2026-11-02 against gitlabhq/gitlabhq commit d7b9a61.
- [GitLab job rules](https://docs.gitlab.com/ci/jobs/job_rules/): `if: $CI_PIPELINE_SOURCE == "merge_request_event"` `merge_request_event` is defined as the source for pipelines created when a merge request is created or updated, required to enable merge request pipelines (doc/ci/jobs/job_rules.md line 235). Checked 2026-11-02 against gitlabhq/gitlabhq commit d7b9a61.
- [GitLab job control](https://docs.gitlab.com/ci/jobs/job_control/): merge requests in projects with the "Pipelines must succeed" merge check enabled cannot be merged with a blocked pipeline (doc/ci/jobs/job_control.md lines 52-53). Checked 2026-11-02 against gitlabhq/gitlabhq commit d7b9a61.
- [GitLab project settings](https://docs.gitlab.com/user/project/settings/): the merge request settings list includes merge and squash commit message templates (doc/user/project/settings/_index.md line 153). Checked 2026-11-02 against gitlabhq/gitlabhq commit d7b9a61.
- [SLSA: distributing provenance (spec/distributing-provenance.md)](https://github.com/slsa-framework/slsa/blob/4d3f9d4/spec/distributing-provenance.md): producers MUST publish attestations in at least one place and SHOULD publish in more than one; the listed places are the source repository release, beside the artifact in the package registry, and elsewhere with a hash and pointer recorded in a transparency log (lines 84-115). Checked 2026-11-02 against slsa-framework/slsa commit 4d3f9d4. The checkout holds the spec only in git (the `docs/spec` path does not exist; read with `git show`), and this is the repository working copy, so whether it matches the published v1.2 page is not confirmed.

### Not verified

- GitHub documentation on `Co-authored-by` recognition and on required status checks; not reachable.
- How squash merge builds the final message on GitLab or GitHub; the GitLab commit-templates page is not in the local docs (only the settings list entry naming the templates was checked).
- The `alpine/git` image's entrypoint being `git`; vendor image docs are not reachable.
- GitHub Actions `pull_request` trigger behaviour; GitHub docs are not reachable.
- The `image:` `name` and `entrypoint` keywords, `GIT_DEPTH: "0"` meaning a full clone, and whether the target branch is present in a merge request pipeline; the CI YAML reference is not in the local docs. The job is an example and was not executed.
- The attribution setting name, schema and defaults of each agent tool, and reports that some settings are ignored; no vendor documentation was reachable.
- Engineering guidance (choosing one policy, monthly audits, scratch-repository retests, rewriting only your own feature branch) is not claimed by any source.
- Nothing was run.

## Sources

- [git-interpret-trailers documentation](https://git-scm.com/docs/git-interpret-trailers): trailer format and adding trailers to a commit message.
- [SLSA v1.2: distributing provenance](https://slsa.dev/spec/v1.2/distributing-provenance): provenance attestations distributed with an artifact, supporting provenance kept outside the commit message.
- [git-commit documentation](https://git-scm.com/docs/git-commit): `--trailer` and `--no-verify`.
- [GitLab predefined CI/CD variables](https://docs.gitlab.com/ci/variables/predefined_variables/): the merge request variables used in the job.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
