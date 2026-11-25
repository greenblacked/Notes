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
modified: 2026-11-25
draft: false
evidence: source-reviewed
reviewed: 2026-11-02
review-due: 2027-05-02
---

This note describes how to combine a dependency bot with a coding agent so that breaking upgrades get a proposed code fix without weakening review or supply-chain controls. It is for teams already running Renovate or Dependabot. It does not cover choosing a bot ([[renovate-vs-dependabot]]), the baseline update process ([[automated-dependency-updates]], [[dependency-update-policy]]), or agents that install packages on their own ([[ai-agent-package-installation-risks]]).

## Division of labour

The bot decides what to upgrade and when. The agent only repairs code broken by that upgrade, and only on the PR branch. Keep these separate:

1. The bot opens the upgrade MR with the manifest and lockfile change.
2. CI runs. If it fails with a breaking change, a trigger starts the agent.
3. A push job on the default branch checks the agent's patch and pushes it as a separate commit containing only code changes.
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

The three-day delay is an example policy, not a recommendation. A release-age delay gives time for a malicious or yanked version to be caught; the bot holds the update, or flags it as pending, until the age has passed (check the bot's current docs for exact behaviour). Where the package manager has an equivalent setting, set it there too. If you auto-merge anything, limit it to patch and minor updates that pass full CI; never majors. Team-wide Dependabot ignores (for example ignoring `version-update:semver-major`) belong in `dependabot.yml`, because comment-command ignores are per-PR state.

A label such as `agent-eligible` is a convenient trigger condition. Use two jobs for the repair, because the job that runs the agent also runs untrusted code (the upgraded dependency and the agent's own edits) and must hold no write credential. In GitLab CI, the first job runs in the merge request pipeline. It has no `environment` and no push token, and it only produces a patch:

```yaml title=".gitlab-ci.yml"
agent-fix-upgrade:
  stage: remediate
  image: registry.example.com/ci/agent-runner@sha256:<digest>
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_LABELS =~ /agent-eligible/ && $CI_MERGE_REQUEST_SOURCE_BRANCH_NAME =~ /^renovate\//'
      when: manual
      # explicit: manual jobs inside rules default to allow_failure: false (blocking)
      allow_failure: true
  # needs: [] keeps the job runnable after the test job has failed;
  # a needs on the failed job would skip it. The script reads the failing log
  # from the test job's artifact (see below).
  needs: []
  variables:
    GIT_DEPTH: "0"
  # No environment: and no push token in this job. Its definition comes from the
  # merge request branch, so a commit there can change anything in it.
  script:
    # Only this script body is taken from the default branch; the job definition is not.
    - |
      set -Eeuo pipefail
      git fetch --no-tags origin "refs/heads/${CI_DEFAULT_BRANCH}"
      trusted="$(mktemp)"
      git show "FETCH_HEAD:ci/agent-fix.sh" > "$trusted"
      if [[ ! -s "$trusted" ]]; then
        echo "ci/agent-fix.sh is missing or empty on ${CI_DEFAULT_BRANCH}" >&2
        exit 1
      fi
      bash "$trusted"
  artifacts:
    paths:
      - agent.patch
    expire_in: 1 day
```

The second job holds the token. It is defined in `.gitlab-ci.yml` on the protected default branch and runs only in a pipeline on that branch, started by a person who enters three variables: the agent job's ID, the `renovate/` branch and the branch head the patch was made on. It checks the patch with the default-branch guard and pushes it:

```yaml title=".gitlab-ci.yml"
apply-agent-patch:
  stage: remediate
  image: registry.example.com/ci/base@sha256:REPLACE_WITH_DIGEST
  rules:
    - if: '$CI_PIPELINE_SOURCE == "web" && $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $PATCH_BRANCH'
  environment:
    name: dependency-agent # protected environment; AGENT_PUSH_TOKEN is scoped to it
  variables:
    GIT_DEPTH: "0"
    AGENT_GIT_NAME: "dependency-agent" # change: the committer name for the patch commits
    AGENT_GIT_EMAIL: "dependency-agent@example.com" # change: the committer email (the token bot user's address if "Reject unverified users" is on)
  script:
    - |
      set -Eeuo pipefail
      : "${AGENT_JOB_ID:?pipeline variable: ID of the agent-fix-upgrade job, taken on trust}"
      : "${PATCH_BRANCH:?pipeline variable: the renovate/ branch}"
      : "${PATCH_BASE_SHA:?pipeline variable: head of that branch when the patch was made}"
      if [[ ! "$AGENT_JOB_ID" =~ ^[0-9]+$ || ! "$PATCH_BRANCH" =~ ^renovate/[A-Za-z0-9._/-]+$ || ! "$PATCH_BASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
        echo "unexpected job id, branch name or SHA" >&2
        exit 1
      fi
      # This pipeline runs on the default branch, so the working tree holds the trusted guard.
      guard="$(mktemp)"
      cp ci/guard-agent-commit.sh "$guard"
      if [[ ! -s "$guard" ]]; then
        echo "ci/guard-agent-commit.sh is missing or empty" >&2
        exit 1
      fi
      # The job token goes in through stdin, not the command line.
      printf 'header = "JOB-TOKEN: %s"\n' "$CI_JOB_TOKEN" | curl --fail --silent --show-error --location --config - \
        --output artifacts.zip "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/jobs/${AGENT_JOB_ID}/artifacts"
      unzip -p artifacts.zip agent.patch > agent.patch
      git fetch --no-tags origin "refs/heads/${PATCH_BRANCH}"
      if [[ "$(git rev-parse FETCH_HEAD)" != "$PATCH_BASE_SHA" ]]; then
        echo "${PATCH_BRANCH} moved since the patch was made" >&2
        exit 1
      fi
      git checkout --detach "$PATCH_BASE_SHA"
      git -c core.hooksPath=/dev/null -c user.name="$AGENT_GIT_NAME" -c user.email="$AGENT_GIT_EMAIL" am agent.patch
      bash "$guard" "$PATCH_BASE_SHA" HEAD agent </dev/null
      askpass="$(mktemp)"
      printf '#!/bin/sh\necho "$AGENT_PUSH_TOKEN"\n' > "$askpass"
      chmod 700 "$askpass"
      GIT_ASKPASS="$askpass" git push "https://oauth2@${CI_SERVER_FQDN}/${CI_PROJECT_PATH}.git" "HEAD:refs/heads/${PATCH_BRANCH}"

agent-commit-guard:
  stage: test
  image: registry.example.com/ci/base@sha256:REPLACE_WITH_DIGEST
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event" && $CI_MERGE_REQUEST_SOURCE_BRANCH_NAME =~ /^renovate\//'
  needs: []
  variables:
    GIT_DEPTH: "0" # full history, so the merge request range is complete
    DEP_BOT_EMAIL: "renovate-bot@example.com" # change: the committer email of the dependency bot
  script:
    - |
      set -Eeuo pipefail
      git fetch --no-tags origin "refs/heads/${CI_DEFAULT_BRANCH}"
      guard="$(mktemp)"
      git show "FETCH_HEAD:ci/guard-agent-commit.sh" > "$guard"
      if [[ ! -s "$guard" ]]; then
        echo "ci/guard-agent-commit.sh is missing or empty on ${CI_DEFAULT_BRANCH}" >&2
        exit 1
      fi
      base="${CI_MERGE_REQUEST_DIFF_BASE_SHA:?not a merge request pipeline}"
      # Merged results and merge train pipelines run on a temporary merge commit
      # (CI_COMMIT_SHA); check the source branch head instead. The variable is
      # empty in plain merge request pipelines, where CI_COMMIT_SHA is that head.
      head="${CI_MERGE_REQUEST_SOURCE_BRANCH_SHA:-${CI_COMMIT_SHA}}"
      if ! git merge-base --is-ancestor "${base}" "${head}"; then
        echo "diff base ${base} is missing or not an ancestor of ${head}" >&2
        exit 1
      fi
      merges="$(git rev-list --merges "${base}..${head}")"
      if [[ -n "$merges" ]]; then
        echo "merge commits on the bot branch are not allowed: ${merges}" >&2
        exit 1
      fi
      git rev-list --reverse "${base}..${head}" > "${CI_PROJECT_DIR}/commits.txt"
      : > "${CI_PROJECT_DIR}/agent-files.txt"
      while read -r commit; do
        committer="$(git log -1 --format=%ce "$commit")"
        mode="agent"
        if [[ "$committer" == "$DEP_BOT_EMAIL" ]]; then
          mode="bot"
        fi
        echo "checking ${commit} (${mode}) committed by ${committer}"
        bash "$guard" "${commit}^" "$commit" "$mode" </dev/null
        if [[ "$mode" == "agent" ]]; then
          git diff --no-renames --name-only "${commit}^" "$commit" >> "${CI_PROJECT_DIR}/agent-files.txt"
        fi
      done < "${CI_PROJECT_DIR}/commits.txt"
      total="$(sort -u "${CI_PROJECT_DIR}/agent-files.txt" | grep -c . || true)"
      if (( total > ${MAX_AGENT_FILES:-15} )); then
        echo "non-bot commits touch ${total} files in total (limit ${MAX_AGENT_FILES:-15})" >&2
        exit 1
      fi
```

`AGENT_JOB_ID` is taken on the word of the person who starts the push job: the job does not look the job up, so it does not prove that the artifact came from a real agent run. `AGENT_GIT_NAME` and `AGENT_GIT_EMAIL` set only the committer under `git am`; the author comes from the patch's `From` header, which the untrusted agent job wrote, so the author field is not trusted, and with "Reject unverified users" on the committer email must be the token bot user's address. The controls on the patch are these: `PATCH_BASE_SHA` must equal the fetched branch head, `git am` must apply the patch on it, the guard (including the default-branch check) must pass, a human starts the job, and a human reviews the upgrade MR. The image needs `curl` and `unzip`.

The push job starts as a web pipeline on the default branch, so it also runs every other default-branch job whose rules match. Give deploy and release jobs a rule that excludes pipelines where `PATCH_BRANCH` is set (or where `CI_PIPELINE_SOURCE` is `web`), so applying a patch does not deploy. Allow pipeline variables only for the role that starts the push job: GitLab 17.7 and later default new projects to letting nobody set them, and `AGENT_JOB_ID`, `PATCH_BRANCH` and `PATCH_BASE_SHA` are pipeline variables.

`when: manual` keeps a human choosing to spend agent time. Pipelines from forked projects cannot access the parent project's CI/CD variables by default, but running a merge request pipeline in the parent project for a fork makes all variables available to it, so do not expose write tokens to fork-controlled pipelines. `CI_MERGE_REQUEST_LABELS` is a comma-separated list and exists only when the merge request has at least one label.

### Why two jobs

A merge request pipeline uses the pipeline configuration of the source branch. A commit on `renovate/*`, from a Developer or from the agent's own patch, can therefore change `agent-fix-upgrade` completely: its `script:`, `image:`, variables and artifacts. Fetching `ci/agent-fix.sh` from the default branch pins only the script body, not the job. That is why this job has no `environment` and no push token, and why no unprotected project variable should hold a secret. It does not make the job harmless. A changed definition, or a `postinstall` script in the upgraded dependency, can still do three things:

- Add `id_tokens:` and get a GitLab OIDC token for this project. Any cloud federation binding that accepts any ref of the project accepts it; the plan binding in [[iam-groups-and-ci-workload-identity-federation]] is one, and it reads every secret in state. No binding may trust every ref of this project.
- Use `CI_JOB_TOKEN` with the permissions of the person who started the manual job, which can include reading artifacts and writing to the package or container registry. Limit the job token's permissions and protect the registries.
- Read the agent's own model credential, which the job needs to run the agent. Give that key a narrow scope and a spending limit, or route it through a proxy that holds the real key.

The checkout holds an upgraded third-party dependency and agent-written code, and a `postinstall` script there runs as the job's user, so assume everything in that job can read everything in that job. The worst a changed definition can do is not just a different patch; it can use whatever reach the job has.

The patch is data until the push job accepts it. The push job comes from the default branch, runs the default-branch copy of `ci/guard-agent-commit.sh` on the patch and refuses to push one that changes `.gitlab-ci.yml` or `ci/`. This holds because the agent job never had the token. It checks paths, not content: a patch can still change `scripts` in a manifest or add harmful code, so a human reviews every upgrade MR.

- **Where the script starts.** In a merged results or merge train pipeline the agent job starts on the temporary merge commit, not on the branch. `ci/agent-fix.sh` therefore checks out the source branch head (`CI_MERGE_REQUEST_SOURCE_BRANCH_SHA`, or `CI_COMMIT_SHA` in a plain merge request pipeline) before the agent works, and builds `agent.patch` with `git format-patch` from that head. Set `PATCH_BASE_SHA` to that head, not to the pipeline's own `sha`. Otherwise the patch carries target-branch changes and the guard rejects it. The script is not shown here.
- **The failing log.** Have the test job upload its log with `artifacts: when: always` and download it in the agent job with `CI_JOB_TOKEN`. That keeps `read_api` off the push token. With `read_api` the token can read every job log and artifact in the project, not only one failed log; if you add it, treat that as its reach. The agent job also needs the failed test job's ID to download that log: the person starting the manual job enters it as a manual-job variable, which the script validates as digits, or a fine-grained `READ_JOBS` permission lets the script list the pipeline's jobs and find it.
- **The push token.** A project access token with the Developer role and only the `write_repository` scope, with an expiry, stored as a masked CI/CD variable named `AGENT_PUSH_TOKEN`. Mark it protected (it reaches only pipelines on protected branches and tags) and scope it to the `dependency-agent` environment. The agent job and every pipeline on a `renovate/*` branch must not receive it.
- **Who can start the push job.** Protected environments need GitLab Premium or Ultimate. Where you have them, protect `dependency-agent` so only the owning group can run the job. Without them, the protected variable still keeps the token away from branch pipelines, but anyone who can run a pipeline on any protected branch or tag can name the `dependency-agent` environment in a job and receive the token, not only people who can run default-branch pipelines. That is another reason to keep the protected refs few; check who can run pipelines on them. A separate trusted project does the same job and keeps the token out of this project entirely, at the cost of a job token allowlist entry and a second repository to maintain.
- **What the token can still do.** GitLab cannot limit a token to `renovate/*` branches. A Developer can push to any unprotected branch, create tags and start branch pipelines as the bot user, so those pipelines must not receive sensitive variables (protected variables only reach protected refs). Protect the default branch and every long-lived branch so that only Maintainers can push or merge, and protect release tag patterns (for example `v*`) so that only Maintainers can create them. Leave the token's bot user out of every approval rule and CODEOWNERS entry, and turn on "Prevent approvals by users who add commits" so its commits cannot count as approval.
- **Do not merge the jobs.** A protected environment limits who starts a job, not what it runs. If the agent and the token share a job, a same-user process such as a `postinstall` script can read the token from `/proc/<pid>/environ`; `env -u TOKEN` only stops inheritance.

## What the agent gets

- The exact old and new versions, the changelog and migration guide for that range, and the failing CI output.
- An instruction to list each breaking change it found with a citation to the changelog entry or failing test. Reject any fix it cannot trace to one.
- A narrow remit: call sites of the changed API only. Cap files and lines touched, and split anything bigger ([[agent-pull-request-size-and-reviewability]], [[ai-code-refactoring-scope-and-rollback]]).

Treat changelog text as untrusted input: it comes from a third party and can carry injected instructions. Give the agent no secrets and only the egress it needs ([[agent-network-egress-controls]]).

## What the agent must not do

- Edit lockfiles or write checksums by hand. CI regenerates them with the package manager and verifies they match the manifest.
- Add, remove or swap dependencies to make a build pass, or loosen version ranges.
- Delete or weaken tests, lint rules, type checks or scanner configuration. Enforce this with a path-based check that fails if the agent's commit touches protected files; see [[deterministic-hooks-for-coding-agents]].
- Merge or approve. Its token cannot merge into protected branches, and approval rules exclude it (see the "What the token can still do" bullet under "Why two jobs").

A guard in CI can enforce the lockfile and scope rules:

```bash title="ci/guard-agent-commit.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

base="${1:?base ref}"
head="${2:?head ref}"
mode="${3:-agent}" # agent: code changes only; bot: manifests and lockfiles only
max_files="${MAX_AGENT_FILES:-15}"

# --no-renames lists both the old and the new path, so moving a protected file is caught
changed="$(git -c core.quotePath=false diff --no-renames --name-only "$base...$head")"

# Git still quotes names with a double quote, backslash or control character, and the
# patterns below would miss them, so refuse such names instead of matching them.
if grep -q '^"' <<<"$changed"; then
  echo "file name needs quoting; refusing" >&2
  exit 1
fi

case "$mode" in
  bot)
    # Fail closed: a commit that claims the bot's identity may touch manifests and lockfiles only.
    outside="$(grep -Ev '(^|/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|pyproject\.toml|poetry\.lock|go\.mod|go\.sum)$' <<<"$changed" || true)"
    if [[ -n "$outside" ]]; then
      echo "bot-attributed commit touches files outside the allowlist: ${outside}" >&2
      exit 1
    fi
    exit 0
    ;;
  agent) ;;
  *)
    echo "unknown mode: ${mode}" >&2
    exit 1
    ;;
esac

if grep -Eq '(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|go\.sum)$' <<<"$changed"; then
  echo "agent commit touches a lockfile; regenerate in CI instead" >&2
  exit 1
fi

if grep -Eq '^(\.gitlab-ci\.yml|\.gitlab/|ci/|\.github/|renovate\.json)|(^|/)(CODEOWNERS|\.npmrc|\.yarnrc\.yml|pip\.conf)$' <<<"$changed"; then
  echo "agent commit touches CI, bot, ownership or registry configuration" >&2
  exit 1
fi

count="$(grep -c . <<<"$changed" || true)"
if (( count > max_files )); then
  echo "agent commit touches $count files (limit $max_files)" >&2
  exit 1
fi
```

The `agent-commit-guard` job above runs the default-branch copy of the script on every pipeline of a bot branch, once per commit. The push job runs it once on the whole patch before pushing. It is a normal blocking job, so with "Pipelines must succeed" a failing check stops the merge. With merged results or merge train pipelines on, `CI_COMMIT_SHA` is a temporary merge commit, so the job checks the source branch head (`CI_MERGE_REQUEST_SOURCE_BRANCH_SHA`) instead, and does not see target-branch commits or the merge commit itself.

Bot commits are recognised by committer email, which any pusher can set, so they are not skipped. A commit with the bot's email runs in `bot` mode and may touch manifests and lockfiles only; adjust the allowlist to what your bot is configured to update, and never add the protected paths to it. This means the guard rejects bot updates to CI image and action digest pins in `.gitlab-ci.yml`, `.github/` or Dockerfiles by design: merge those through CI-owner review (CODEOWNERS), or have the bot open them on a branch prefix that `agent-commit-guard` does not match, still with CI-owner review. A bot-attributed commit can still change `scripts` in a manifest, so the human review of the diff stays the control. The push rule "Reject unverified users" narrows who can use that email, but the guard does not depend on it. Unusual file names (a double quote, a backslash or a control character, which Git prints quoted) are rejected outright, because the path patterns cannot match them. The file cap applies to each commit and to the union of files changed by all non-bot commits, so splitting a change into many commits does not avoid it. The protected list covers CI files (including `.gitlab/`), bot configuration, `CODEOWNERS` and registry configuration (`.npmrc`, `.yarnrc.yml`, `pip.conf`). The pipeline configuration itself comes from the bot branch, so require a CODEOWNERS approval from the CI owners for `.gitlab-ci.yml` and `ci/`; otherwise a commit that deletes the guard job removes the check. The guard does not catch weakened tests: add your lint and scanner configuration paths to the protected list, and flag any change to test files for explicit reviewer attention, since a legitimate fix may need to update a test's call sites.

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
- [ ] Diff scope, file count and protected paths are enforced by a blocking CI job that runs the guard from the default branch, and again by the push job before anything is pushed.
- [ ] Lockfiles are regenerated by tooling, never hand-edited.
- [ ] Full CI plus supply-chain checks run on the new version.
- [ ] The agent job holds no token. The push token is a Developer project access token with only `write_repository`, a protected variable used by a default-branch job; it cannot merge or approve, and a human reviews every upgrade MR.
- [ ] Acceptance, rejection, rollback and cost are tracked.

## Evidence

Source-reviewed on 2026-11-02. Nothing was run. Scope: the GitLab CI trigger example, the diff-range command in the guard script, and the prompt-injection, privilege and component-risk framing; the bot and package-manager behaviour could not be checked.

### Sources checked

- [GitLab CI/CD job control](https://docs.gitlab.com/ci/jobs/job_control/): `when: manual` makes a job run only when a user starts it; manual jobs default to `allow_failure: true` outside `rules` and `false` inside `rules`, so the explicit `allow_failure: true` in the example is needed. Checked 2026-11-02 against gitlabhq/gitlabhq commit d7b9a61.
- [GitLab CI/CD job rules](https://docs.gitlab.com/ci/jobs/job_rules/): `rules` accepts `when: manual` to make a manual job. Checked 2026-11-02 against gitlabhq/gitlabhq commit d7b9a61.
- [GitLab CI/CD predefined variables](https://docs.gitlab.com/ci/variables/predefined_variables/): `CI_MERGE_REQUEST_LABELS` (comma-separated, set only when the merge request has labels), `CI_MERGE_REQUEST_SOURCE_BRANCH_NAME`, and `CI_PIPELINE_SOURCE`. Checked 2026-11-02 against gitlabhq/gitlabhq commit d7b9a61.
- [GitLab CI/CD variables](https://docs.gitlab.com/ci/variables/): fork pipelines cannot access parent-project variables by default; a parent-project merge request pipeline for a fork exposes all variables. Checked 2026-11-02 against gitlabhq/gitlabhq commit d7b9a61.
- [git-diff](https://git-scm.com/docs/git-diff): `git diff A...B` equals `git diff $(git merge-base A B) B`; `--name-only` lists changed file names. Checked 2026-11-02 against git commit 50fe5cc.
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/): LLM01 indirect injection from external content and the advice to segregate untrusted content and require human approval for high-risk actions; LLM06 minimum extension permissions; LLM03 outdated third-party components. Checked 2026-11-02 against owasp-llm commit 99f4395.

### Not verified

- Renovate option names, defaults and behaviour (`minimumReleaseAge`, `dependencyDashboardApproval`, `separateMajorMinor`, `config:recommended`, how a pending release-age check works): the Renovate docs were not available locally.
- Dependabot ignore syntax, `dependabot.yml` keys and comment commands: not available locally.
- The GitLab `needs: []` behaviour after a failed job: the CI keyword reference was not in the local docs, and no `needs: []` example appears in the local ci/ docs.
- Provenance attestation support per ecosystem, and the SLSA framing: the SLSA spec was not available locally.
- The NIST SSDF reference: NIST publications were not available.
- Pinning CI images or actions to digests, and how an agent product is triggered on a bot branch and which token it receives: no local source.
- Hand-edited lockfile, package-manager checksum and registry behaviour: not checked.
- General engineering guidance (division of labour, scope caps, metrics, failure modes, checklist) is not a documented claim.
- `CI_MERGE_REQUEST_DIFF_BASE_SHA`, `GIT_DEPTH: "0"`, and fetching the default branch inside a merge request pipeline: not checked against the current GitLab docs.
- That a merge request pipeline takes the job definition from the source branch, that `/proc/<pid>/environ` of a parent process is readable by a same-user child in a CI container, and that the pipeline-on-default-branch and two-job designs avoid both: not checked against current GitLab docs or a runner. The `ci/agent-fix.sh` script and the guard calls are described or shown, not run.
- Project access token roles and the `write_repository` scope, protected and environment-scoped variables, and which GitLab tier protected environments need (stated above as Premium or Ultimate): not checked. Who can run a pipeline on the default branch, and whether a protected environment stops a user outside the owning group from starting the push job: not checked.
- Protected tag patterns and the role needed to create tags, and the reach of a `read_api` token (every job log and artifact in the project): not checked.
- The push job steps (downloading a job's artifacts with `CI_JOB_TOKEN`, `git format-patch` and `git am` on the agent patch, pushing through a `GIT_ASKPASS` helper with a project access token, a job token allowlist for a separate trusted project) and the test job's log artifact: described, not run or checked.
- `git diff --no-renames --name-only` listing both paths of a rename, and the `bot` allowlist file names: not checked against the git docs.
- `CI_MERGE_REQUEST_SOURCE_BRANCH_SHA` (set only in merged results and merge train pipelines) and that the merge ref's history contains the source head with `GIT_DEPTH: "0"`: not checked against the current GitLab docs.
- How the agent job learns the failed test job's ID (a manual-job variable validated as digits, or listing the pipeline's jobs with a fine-grained `READ_JOBS` permission) and that permission's name and reach: not checked.
- The push rule "Reject unverified users", "Prevent approvals by users who add commits", CODEOWNERS approval and the GitLab tier each needs: not checked.
- The job token's allowed Jobs API endpoints (the push job uses only the artifact download and does not look up job metadata, so `AGENT_JOB_ID` is trusted as given), and `curl` and `unzip` in the image: not checked against the current GitLab docs.
- Git's quoting of unusual file names in `git diff --name-only` (and that `core.quotePath=false` leaves quotes, backslashes and control characters quoted), which the guard rejects: tried in a scratch repo, not checked against the git docs.
- That a GitLab OIDC token from `id_tokens:` can be requested by a job whose definition comes from a `renovate/*` branch, that `CI_JOB_TOKEN` carries the starting user's permissions and registry write access in that job, and the job token permission settings: not checked against current GitLab docs. Limiting the model credential's scope and spend, or proxying it, is general guidance and not checked.
- That protected variables reach every protected branch and tag, and that a job on any protected ref can name a protected-environment-scoped variable's environment without protected environments: not checked.
- The project setting that stops anyone setting pipeline variables by default (GitLab 17.7 and later), and that the `web` pipeline source and `PATCH_BRANCH` rule behave as described: not checked.
- Nothing was run.

## Sources

- [GitLab CI/CD job control](https://docs.gitlab.com/ci/jobs/job_control/) - manual jobs and `allow_failure` defaults.
- [GitLab CI/CD variables](https://docs.gitlab.com/ci/variables/) - fork pipeline access to variables.
- [git-diff](https://git-scm.com/docs/git-diff) - three-dot range semantics.
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/) - injection, excessive agency and supply-chain risks.
- [Renovate docs: minimum release age](https://docs.renovatebot.com/key-concepts/minimum-release-age/) - release-age hold; not read, see Not verified.
- [Renovate docs: FAQ](https://docs.renovatebot.com/faq) - separation of major and minor branches; not read, see Not verified.
- [GitHub Docs: Dependabot pull request comment commands](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-pull-request-comment-commands) - ignoring versions via comments; not read, see Not verified.
- [NIST SP 800-218: Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - risk-based practices behind the supply-chain framing; not read, see Not verified.
