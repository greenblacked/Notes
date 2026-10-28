---
title: AI-assisted Jenkins to GitLab pipeline conversion
description: Use a coding agent to convert Jenkinsfiles to GitLab CI with an inventory, a reviewed mapping table, lint gates, credential mapping and parity checks.
type: pattern
tags:
  - ai
  - ci-cd
  - gitlab-ci
  - jenkins
  - delivery
created: 2026-10-27
modified: 2026-10-27
draft: false
---

This note covers how to use a coding agent to convert Jenkinsfiles (declarative, scripted and library-driven) into GitLab CI configuration: inventory, a reviewed mapping table, lint gates on generated YAML, credential mapping, and a parallel run with parity checks. It is for platform engineers running the conversion hands-on. It does not cover programme planning and cutover ([[jenkins-to-gitlab-migration-programme]]), the target layout itself ([[gitlab-ci-pipeline-structure]]), or the generic validation of agent output ([[validating-ai-generated-infrastructure-code]]). Shared-library conversion is covered here only as a "do not do it blindly" rule; the library structure is in [[jenkins-shared-libraries]].

> [!note] Not verified
> The sources below were found through search, but the pages could not be fetched on 2026-10-27. Before relying on this note, check: the GitLab keyword behaviour (`rules`, `rules:changes`, `id_tokens`, `parallel:matrix`, `$CI_JOB_STATUS` in `after_script`) for the GitLab version your instance runs, which CI Lint endpoints and `glab ci lint` flags exist on that version, and the credential binding types of the plugins installed on your Jenkins controller.

## Principle: the agent drafts, the mapping table decides

An agent is good at the mechanical bulk of a Jenkinsfile and unreliable on the rest: dynamic Groovy, plugin-specific steps, and anything whose meaning lives in a shared library. So the workflow is inventory, then a mapping table agreed by humans, then generation constrained by that table, then machine gates, then a parallel run. The agent never decides what a construct means; it applies a row someone already approved, and flags what has no row.

Convert one pipeline per change request, starting with three to five representative pilots chosen from the inventory rather than the whole estate. Freeze each pilot Jenkinsfile for the duration of its conversion, or re-run the conversion and re-diff when it changes.

## Step 1: inventory

Give the agent read-only access to the Jenkins repositories and have it produce a table, not YAML. Verify the output against the real controller, since plugin names and step availability differ per installation.

| Column         | Example values                                               |
| -------------- | ------------------------------------------------------------ |
| Pipeline       | `payments-api`                                               |
| Style          | declarative, scripted, library-driven                        |
| Steps used     | `sh`, `withCredentials`, `input`, `parallel`, `when`, `post` |
| Agent labels   | `docker-large`, `windows-signing`                            |
| Library calls  | `buildImage()`, `deployHelm()` with their parameters         |
| Credentials    | IDs only, never values                                       |
| Triggers       | SCM poll, cron, upstream job                                 |
| Owner and risk | team, deploys to production yes or no                        |

Anything classed as scripted with loops, closures or dynamic stage generation, or any pipeline that calls a library function nobody has documented, is marked "needs design review" and is excluded from automated conversion.

## Step 2: the mapping table

Keep the table in the repository and give it to the agent as a constraint. Reviewers check each row once instead of rediscovering it in every diff. The rows below are a starting point; confirm each against the GitLab docs for your instance version and the side-by-side guide in the sources.

| Jenkins construct            | GitLab CI target                                                        | Review note                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `stages` and `stage`         | top-level `stages:` and jobs with `stage:`                              | Jenkins stages are sequential blocks; jobs in a stage run together                                 |
| `agent { label 'x' }`        | runner `tags: [x]`                                                      | Tags must exist on a runner with equivalent access                                                 |
| `agent { docker { image } }` | job `image:`                                                            | Check entrypoint and user                                                                          |
| `when { branch ... }`        | `rules:` with `if:` on `$CI_COMMIT_BRANCH`                              | Never mix `rules:` with `only:`/`except:`; `$CI_COMMIT_BRANCH` is unset in merge request pipelines |
| `when { changeset }`         | `rules:` with `changes:`                                                | Compared with the target branch in MR pipelines, the previous push otherwise                       |
| `parallel { }`               | jobs in the same stage, or `parallel:matrix`                            | Matrix for repeated variations only                                                                |
| `environment { }`            | `variables:`                                                            | Secrets are not variables in YAML, see below                                                       |
| `options { timeout }`        | `timeout:`                                                              | Job-level, not pipeline-level                                                                      |
| `input`                      | `when: manual`, optionally with `allow_failure: false`                  | Approval semantics differ; use protected environments                                              |
| `post { always }`            | `after_script:`                                                         | Runs in a separate shell; its failure does not fail the job                                        |
| `post { failure }`           | a job with `when: on_failure`                                           | Or branch on `$CI_JOB_STATUS` in `after_script`; check your version                                |
| `triggers { cron }`          | pipeline schedule plus `rules: - if: $CI_PIPELINE_SOURCE == "schedule"` | Schedules are configured outside the YAML                                                          |
| `stash` and `unstash`        | `artifacts:` and `dependencies:` or `needs:`                            | Set `expire_in`                                                                                    |
| Library call                 | component, `include:`/`extends:` template, or versioned script          | Human design required, see below                                                                   |

Instruct the agent to emit `# TODO(unmapped): <construct>` in the YAML and a line in the PR description for every construct without a row, rather than guessing.

## Step 3: generate, then lint in the pipeline

Constrain the agent to produce only the new `.gitlab-ci.yml` (and any referenced script files) on a branch. It must not edit the Jenkinsfile, run deploys or touch variables. Then gate with GitLab's CI Lint. The lint is a syntax and structure check, not a semantic check, so it passes pipelines that do the wrong thing.

```bash title="scripts/lint-ci.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

# Token needs the API scope and project role your instance requires for CI Lint.
: "${GITLAB_URL:?set GITLAB_URL}"
: "${PROJECT_ID:?set PROJECT_ID}"
: "${GITLAB_LINT_TOKEN:?set GITLAB_LINT_TOKEN}"
CI_FILE=".gitlab-ci.yml"

payload=$(jq -Rs '{content: ., dry_run: true}' "${CI_FILE}")

result=$(curl --silent --show-error --fail \
  --header "PRIVATE-TOKEN: ${GITLAB_LINT_TOKEN}" \
  --header "Content-Type: application/json" \
  --data "${payload}" \
  "${GITLAB_URL}/api/v4/projects/${PROJECT_ID}/ci/lint")

if ! printf '%s' "${result}" | jq -e '.valid == true' >/dev/null; then
  printf '%s' "${result}" | jq -r '.errors[]?' >&2
  exit 1
fi
printf '%s' "${result}" | jq -r '.merged_yaml' > merged.yml
```

Check the request fields, required token scope and the endpoint's version history against your instance's API docs. Use the project-scoped endpoint so `include:` and project context resolve, and read `merged.yml` in review, since that is what actually runs. After lint, run `shellcheck` on extracted scripts and have a second agent or human review the YAML ([[independent-review-agents]]).

A compact generated job should look like this, with rules explicit, images pinned (by digest where your registry allows) and no secret values. If a job diffs against the target branch, fetch it explicitly (`git fetch origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"`), since the clone is usually shallow (`GIT_DEPTH`):

```yaml title=".gitlab-ci.yml"
stages: [build, test, deploy]

build:
  stage: build
  image: registry.example.com/ci/builder:1.4.0
  tags: [docker-large]
  timeout: 20m
  script:
    - ./ci/build.sh
  artifacts:
    paths: [dist/]
    expire_in: 1 week
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

deploy_prod:
  stage: deploy
  needs: [build]
  image: registry.example.com/ci/deployer:2.1.0
  environment: production
  script:
    - ./ci/deploy.sh
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual
```

## Credentials mapping

Inventory records credential IDs and binding types, never values. For each, the agent proposes a row and a human creates the target.

| Field          | Content                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------ |
| Jenkins ID     | `prod-deploy-token`                                                                        |
| Binding type   | string, file, username/password, SSH key                                                   |
| Target         | CI/CD variable (masked, protected, environment-scoped) or secrets manager read at job time |
| Scope          | environment and protected branches only                                                    |
| Rotation owner | team and date                                                                              |

Prefer short-lived credentials fetched at job time through the platform's OIDC `id_tokens` against Vault or a cloud secret manager over long-lived variables ([[vault-vs-gcp-secret-manager]], [[just-in-time-agent-credentials]]). Check the `id_tokens` syntax for your GitLab version. The agent must never read a secret value, paste one into YAML, or create variables itself; its tool allowlist should make that impossible rather than discouraged ([[coding-agent-permission-allowlists]]). If a secret has ever appeared in a transcript or diff, treat it as leaked ([[leaked-credential-rotation]]).

## Shared libraries are not converted blindly

A mechanical translation of `vars/` and `src/` Groovy into YAML anchors hides logic, drops side effects and breaks every caller. Treat the library as a product with its own migration:

1. Have the agent list each global function, its callers, parameters, defaults and side effects (tags pushed, notifications sent, files written).
2. Decide per function: replace with a shell script in a versioned image, a [[gitlab-ci-components-and-includes|component or include template]], a native GitLab feature, or retire it.
3. Write a test for the replacement against recorded inputs before any pipeline depends on it.
4. Only then let the agent rewrite call sites, one function at a time.

Dynamic scripted pipelines usually need a rewrite, sometimes as a generated child pipeline, not a line-by-line port. Use [[gitlab-ci-vs-jenkins]] when a construct has no direct equivalent.

## Runners and access boundaries

Jenkins agents often have broad host access that shared GitLab runners should not. Before the first parallel run, list jobs that need privileged mode, Docker socket access or host paths, and place them on dedicated, narrowly scoped runners ([[gitlab-runners-on-gke]], [[jenkins-controller-and-agent-hardening]]).

## Parallel run and parity checks

Run the GitLab pipeline on the same commits as Jenkins for an agreed window, with deploy and publish jobs disabled or pointed at a non-production target in the shadow system. Compare mechanically and attach the diff to the PR.

```bash title="scripts/parity.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

# Usage: parity.sh <jenkins-artifact-dir> <gitlab-artifact-dir>
# Exits 1 and prints the differing files when the checksums differ.
if [[ $# -ne 2 || ! -d "$1" || ! -d "$2" ]]; then
  echo "usage: $0 <jenkins-artifact-dir> <gitlab-artifact-dir>" >&2
  exit 2
fi

diff <(cd "$1" && find . -type f -exec sha256sum {} + | sort -k2) \
        <(cd "$2" && find . -type f -exec sha256sum {} + | sort -k2)
```

Compare exit status, test counts and names, artifact checksums (expect differences for embedded timestamps; normalise or explain them), image digests where builds are reproducible, rendered manifests, and notifications. Keep the Jenkins job disabled but present until parity holds for the agreed number of consecutive runs, then switch the trigger; the programme-level comparison criteria are in [[jenkins-to-gitlab-migration-programme#Parallel run and comparison criteria]]. Define "done" for each pipeline as lint green, parity green and owner accepted ([[agent-done-criteria-and-verification]]).

## Failure modes

- Lint passes, behaviour differs: `rules:` that never match, or `after_script` used where a failure-only job was needed.
- Silent loss of Jenkins defaults such as workspace cleanup, retries and implicit checkout depth.
- Secret copied into YAML, or a value that cannot meet masking requirements saved unmasked, so it prints in logs.
- Library logic flattened into anchors and callers broken.
- Source drift: the Jenkinsfile changed after conversion began.
- Production deploys running from the shadow pipeline during the parallel window.
- Privileged jobs landing on shared runners.
- One large PR converting many pipelines so nobody reviews the mapping.

## Review checklist

- [ ] Inventory exists and each pipeline is classed as automatable or needs design review.
- [ ] A mapping table is approved and every unmapped construct is flagged, not guessed.
- [ ] Generated YAML passes project-scoped CI Lint and the merged YAML was reviewed.
- [ ] Credential mapping lists source, scope and rotation owner; no value is in the repository or transcript.
- [ ] Each shared-library function has an owner decision, a replacement and a test.
- [ ] Privileged jobs run on dedicated runners.
- [ ] Shadow pipeline cannot deploy to production.
- [ ] Parity diff is attached to the PR for the agreed number of runs.
- [ ] One pipeline per PR, with the pipeline owner's sign-off.

## Sources

- [GitLab: Migrating from Jenkins](https://docs.gitlab.com/ci/migration/jenkins/) — mapping of stages, agents, rules and templates.
- [GitLab: CI Lint API](https://docs.gitlab.com/api/lint/) — lint endpoints, `dry_run` and merged YAML output.
- [Jenkins: Extending with Shared Libraries](https://www.jenkins.io/doc/book/pipeline/shared-libraries/) — library layout (`vars/`, `src/`, `resources/`) and global variables.
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) — scoped, short-lived credentials and no secrets in configuration.
- [OWASP CI/CD Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/CI_CD_Security_Cheat_Sheet.html) — CI/CD hardening baseline for the new pipelines.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
