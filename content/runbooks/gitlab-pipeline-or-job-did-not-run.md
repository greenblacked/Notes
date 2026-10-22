---
title: GitLab pipeline or job did not run, or a CI variable is empty
description: Debug a missing GitLab pipeline, a missing job, duplicate branch and MR pipelines or an empty CI/CD variable with CI Lint, workflow rules and variable scopes.
type: runbook
tags:
  - runbooks
  - gitlab-ci
  - ci-cd
created: 2026-10-21
modified: 2026-10-21
draft: false
---

A push lands and no pipeline appears. Or a pipeline runs but the deploy job is not in it. Or every push to a branch with an open merge request starts two pipelines. Or a job runs and the variable it needs is empty. All four are decided **before any runner is involved**: GitLab evaluates `workflow:rules`, then each job's `rules` (or `only/except`), then the variables each job is allowed to see. This runbook walks that evaluation in order.

If the jobs exist but sit in Pending, the problem is the runner, not the configuration: use [[gitlab-runner-jobs-stuck-pending]] instead.

> [!info] Scope and verification
> Behaviour and API fields below were checked on 2026-10-21 against the GitLab documentation source (the default branch of the docs, which can be newer than your instance); nothing was run against a live GitLab, and the note is not marked `verified`. Features differ between GitLab versions and tiers: check the history notes on each linked page for your version. **Not verified:**
>
> - the exact exposure behaviour of `CI_DEBUG_TRACE` (see step 6);
> - the error text when a user may not run a pipeline on a protected branch, and the project settings that turn CI/CD off;
> - the token scope or role the CI Lint API needs;
> - the exact outcome of mixing `only/except` and `rules` in one job (the docs say not to mix them in a pipeline).

## When to use

- A push or a new merge request (MR) produced no pipeline, with no error.
- A pipeline ran, but a job you expected is missing, or a job you did not expect is there.
- Each push to a branch with an open MR creates both a branch pipeline and an MR pipeline.
- The MR page is stuck on `Checking pipeline status` or says a pipeline must succeed before merge.
- A job runs but a CI/CD variable is empty or has an unexpected value.

## Preconditions

- Developer access to the project to see pipelines; Maintainer to read and change CI/CD variables and project settings.
- A personal or project access token in an environment variable for the API calls. Use the narrowest token that works and never paste its value into a job log or an issue.

```bash
GITLAB_URL=https://gitlab.example.com
PROJECT_ID=1234                       # the numeric project ID, or the URL-encoded path (my-group%2Fmy-project)
REF=feature/login-form                # the branch or tag that did not get the pipeline or job
# export GITLAB_TOKEN=...             # set in your shell from your secret store, not in this file
```

## Steps

### 1. Validate the configuration as GitLab sees it

Most "did not run" cases are the configuration doing exactly what it says. Look at the **merged** configuration (after `include:`, `extends:` and components), not the file you edited.

- In the UI, the pipeline editor validates the file, shows the full expanded configuration, and CI Lint can "simulate pipeline creation". The simulation runs as a **push on the default branch**, so it does not tell you what an MR pipeline or a tag pipeline would do.
- The CI Lint API can lint the committed configuration of any ref and simulate it on another ref:

```bash
# --show-error --fail: a 401, 403 or 404 prints an error instead of an empty jobs list
curl --silent --show-error --fail --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_URL/api/v4/projects/$PROJECT_ID/ci/lint?content_ref=$REF&dry_run=true&dry_run_ref=$REF&include_jobs=true" \
  | jq '{valid, errors, warnings, jobs: [.jobs[]?.name]}'
```

`content_ref` picks the commit, branch or tag whose `.gitlab-ci.yml` is read; `dry_run_ref` is the ref the simulated pipeline runs on; `include_jobs=true` returns the jobs that would be created. The older `sha` and `ref` parameters are deprecated aliases of `content_ref` and `dry_run_ref`. URL-encode the ref if it contains characters other than letters, digits, `-`, `_`, `.` and `/`.

To lint uncommitted content in the context of a ref and get the merged YAML back:

```bash
jq --null-input --rawfile content .gitlab-ci.yml --arg ref "$REF" \
  '{content: $content, dry_run: true, include_jobs: true, ref: $ref}' \
| curl --silent --show-error --fail --request POST --header "PRIVATE-TOKEN: $GITLAB_TOKEN" \
    --header "Content-Type: application/json" --data @- \
    "$GITLAB_URL/api/v4/projects/$PROJECT_ID/ci/lint?include_merged_yaml=true" \
| jq -r '.valid, .errors[], .merged_yaml' | head -100
```

The dry run uses the project's CI/CD variables and `include:local` files. Check these before going further:

- **`include` failures.** `Project <group/project> not found or access denied` means the included project path is wrong (it must be `group/project`, not a folder in a repository) or the user who started the pipeline is not a member of the included project with permission to run CI/CD there. Central templates make this common, see [[0013-versioned-central-ci-templates]] and [[gitlab-ci-components-and-includes]].
- **A byte order mark.** The GitLab docs warn that a UTF-8 BOM in `.gitlab-ci.yml` or an included file can make GitLab ignore configuration, drop jobs or misread variables, and the pipeline editor cannot display it:

  ```bash
  head -c3 .gitlab-ci.yml | od -An -tx1    # "ef bb bf" means a BOM is present
  ```

- **Too many jobs or too much YAML.** A pipeline with more jobs than the instance limit fails to start, and very large or deeply nested configuration produces `The parsed YAML is too big`. Split it into parent-child pipelines.

### 2. No pipeline at all

GitLab evaluates every job against the event, and creates **no pipeline if no job is added**. There is no error in that case. Work through the causes:

1. **`workflow:rules` blocked the pipeline type.** `workflow:rules` is evaluated before any job. If no rule matches, or the matching rule says `when: never`, no pipeline of that type is created. A common example is a workflow that allows only `$CI_PIPELINE_SOURCE == "push"`, which silently drops MR and scheduled pipelines.
2. **Every job was filtered out by its own rules.** For example, all jobs carry `if: $CI_PIPELINE_SOURCE == "merge_request_event"` and you pushed to a branch without an MR.
3. **Only `.pre` and `.post` jobs remain.** A pipeline with jobs only in those stages does not run; it needs at least one job in another stage.
4. **The pipeline was skipped on purpose.** `[ci skip]` or `[skip ci]` in the commit message (any capitalisation), or `git push -o ci.skip`, create a pipeline in status `skipped`. The `ci.skip` push option does **not** skip MR pipelines. Pipeline or scan execution policies can override the skip.
5. **The project or user cannot run pipelines here.** CI/CD may be turned off for the project, or the user who pushed may not be allowed to run pipelines on a protected branch. Check the project's CI/CD settings and the protected branch settings (not verified here: the exact settings and messages vary by version).

Read the workflow and the `rules:` of a few key jobs side by side with the event that happened:

```bash
git show "$REF":.gitlab-ci.yml | sed -n '/^workflow:/,/^[^ ]/p'
```

### 3. A job is missing, or an extra job appeared

If the pipeline exists but a job does not, it is almost always its `rules` (or `only/except`). The GitLab docs say not to use `rules` and `only/except` in the same pipeline, because they behave differently and the result is hard to predict; prefer `rules`, since `only/except` is no longer developed. The patterns that cause most surprises:

- **`rules:if` on `CI_PIPELINE_SOURCE`.** Values include `push` (branches and tags), `merge_request_event`, `schedule`, `web`, `api`, `trigger`, `pipeline` and `parent_pipeline`. A job limited to `merge_request_event` never appears in a branch pipeline, and the reverse. Use [[gitlab-ci-rules-dag-matrix-and-includes]] for the common `if` clauses.
- **`rules:changes` with no base.** For a new branch, and for pipelines with no push event (tags, schedules, manual runs), `changes` is always true, so the job always runs. Restrict `changes` to branch or MR pipelines with an `if`, or give it an explicit base:

  ```yaml title=".gitlab-ci.yml (excerpt)"
  build-docs:
    script: ./scripts/build-docs.sh
    rules:
      - if: $CI_PIPELINE_SOURCE == "merge_request_event" || $CI_COMMIT_BRANCH
        changes:
          paths:
            - docs/**/*
          compare_to: refs/heads/main
  ```

  `compare_to` takes a branch, a tag or a commit SHA, and CI/CD variables are allowed. The docs warn that it can give unexpected results in merged results pipelines and in forks.

- **`needs` on a job that rules removed.** Pipeline creation then fails with `'job1' job needs 'job2' job, but it was not added to the pipeline`. Either make both jobs use the same rules, or mark the dependency optional:

  ```yaml title=".gitlab-ci.yml (excerpt)"
  deploy-review:
    needs:
      - job: build-docs
        optional: true
  ```

- **A job that runs unexpectedly** usually has a `changes` that is always true in that pipeline type (above), or a last rule with `when: always` or no condition.

Run the CI Lint dry run from step 1 with `dry_run_ref` set to the ref in question and compare its `jobs` list with what you expected. For MR pipelines, compare with an actual MR pipeline, since the simulation runs as a push.

### 4. Duplicate branch and MR pipelines

Pushing to a branch with an open MR can start a branch pipeline and an MR pipeline for the same commit, usually because job rules allow both. The documented fix is a `workflow:rules` block that runs MR pipelines when an MR exists and branch pipelines otherwise:

```yaml title=".gitlab-ci.yml (excerpt)"
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS && $CI_PIPELINE_SOURCE == "push"
      when: never
    - if: $CI_COMMIT_BRANCH
```

`CI_OPEN_MERGE_REQUESTS` lists up to four open MRs that use the current branch as source, and exists only in branch and MR pipelines when the branch has an MR. The `$CI_PIPELINE_SOURCE == "push"` condition keeps triggered and API pipelines on the branch working; the simpler documented variant without it blocks every branch pipeline while an MR is open. GitLab also shows a `Job may allow multiple pipelines to run for a single action` warning for job rules that allow both types.

Two side effects to know:

- With "Pipelines must succeed" turned on, a workflow that blocks the MR pipeline leaves the MR at `Checking pipeline status` indefinitely. The same message appears when the MR's source branch is on a private fork.
- When both pipeline types exist, the MR widget checks the MR pipeline, and the docs record a known race between the two. Removing the duplicates also removes that race.

This shape belongs in the shared template, not in each project: see [[gitlab-ci-pipeline-structure]] and [[ci-pipeline-standard]].

### 5. The variable is empty or wrong

Check, in this order, whether the job is **allowed** to see the variable before you check its value:

| Cause                                    | How it shows                                                      | What to check                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Protected variable on an unprotected ref | Empty on feature branches, present on `main` or tags.             | Protected variables reach only pipelines on protected branches and tags. An MR pipeline gets them only when the source and target branches are both protected, in the same project, the user can push or merge to the target, and the project allows MR pipelines to access protected variables and runners. |
| Environment scope                        | Empty in one job, present in another.                             | A scoped variable reaches only jobs whose `environment:` matches the scope (`*`, an exact name or a wildcard). A job without `environment:` does not match a scoped variable.                                                                                                                                |
| Fork MR                                  | Empty in pipelines for MRs from forks.                            | Pipelines in a fork get none of the parent project's variables by default. See the warning below.                                                                                                                                                                                                            |
| Precedence                               | The value is set, but to something else.                          | A project variable overrides the same name in `.gitlab-ci.yml`; pipeline variables (run page, schedule, API, trigger, upstream) override project variables. Check the full precedence list on the variables page.                                                                                            |
| Masking rules                            | The value cannot be saved as masked, or is printed as `[MASKED]`. | Masked values must be a single line of at least 8 characters with no spaces, and with variable expansion on only a limited set of special characters. Keep values that cannot be masked in a secret manager instead.                                                                                         |
| Group or instance variable not inherited | Present in one project, empty in another.                         | The variable is defined in a different group, or the closer subgroup defines the same name.                                                                                                                                                                                                                  |

> [!warning] Fork MR pipelines and secrets
> When a project member runs an MR pipeline **in the parent project** for an MR from a fork, that pipeline uses the fork's CI configuration with the parent project's variables, runners and settings, so all variables become available to code the fork author wrote. Read the diff, including `.gitlab-ci.yml` and scripts, before you start such a pipeline. See [[secret-scanning-pre-commit-and-ci]] for keeping secrets out of logs.

To see which variables a job actually received, print **names only**, never values:

```yaml title=".gitlab-ci.yml (temporary debug job)"
debug-variable-names:
  stage: test
  script:
    - env | cut -d= -f1 | sort
  rules:
    - if: $CI_COMMIT_BRANCH == "feature/login-form"
```

This is this note's own advice rather than a GitLab feature; remove the job when you are done.

### 6. Debug safely

> [!warning] Do not turn on `CI_DEBUG_TRACE` in jobs that handle secrets
> `CI_DEBUG_TRACE: "true"` enables debug logging (tracing) of the job's shell. Shell tracing prints commands with their expanded values, which can include secrets, and masking is not a guarantee once a value is transformed. The exact behaviour was not verified here: read "Enable debug logging" on the GitLab variables troubleshooting page before using it, restrict who can read the job log, and rotate any credential that appeared in a trace ([[leaked-credential-rotation]]).

Safer techniques, in order:

1. The CI Lint dry run with `include_jobs=true` (step 1).
2. The names-only variable listing above.
3. A temporary branch with a copy of the job that has no secrets, `CI_DEBUG_TRACE` set on that job only, and its logs deleted after use.

## Validation

- The CI Lint API returns `"valid": true` with no warnings you did not expect, and the `jobs` list for the target ref matches the design.
- A push to a branch without an MR creates one branch pipeline; opening an MR and pushing again creates exactly one MR pipeline.
- A tag push and a scheduled pipeline create the jobs intended for them, and no `changes`-gated job runs when its paths did not change.
- The job that needed the variable succeeds, and the debug job and any `CI_DEBUG_TRACE` setting are removed.

## Rollback

Configuration changes are code: revert the MR that changed `.gitlab-ci.yml`, the included template version or the component version, and let the next pipeline run with the previous configuration. Project-level changes (protected branches, variable protection or scope, the setting that lets MR pipelines use protected variables) may be recorded in audit events, depending on your GitLab tier; change them back explicitly and note it in the change record. If a template change broke many projects, roll the template's version tag back rather than editing every project ([[0013-versioned-central-ci-templates]]).

## Troubleshooting

| Symptom                                                             | Likely cause and fix                                                                                                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| No pipeline, no error                                               | `workflow:rules` blocked the event, or every job was filtered out. Dry-run the ref (step 1) and read the workflow (step 2).             |
| Pipeline shows as skipped                                           | `[ci skip]`, `[skip ci]` or `-o ci.skip`. Push again without it.                                                                        |
| Only `.pre` or `.post` jobs, no pipeline                            | Add a real job in another stage, or fix the rules that removed it.                                                                      |
| `'job1' job needs 'job2' job, but it was not added to the pipeline` | Align the rules of both jobs, or use `needs:optional: true`.                                                                            |
| Job with `changes` runs on every tag or new branch                  | `changes` is always true without a push base. Add an `if` or `compare_to`.                                                              |
| Two pipelines per push                                              | Branch and MR pipelines both allowed. Use the workflow rules in step 4.                                                                 |
| MR stuck on `Checking pipeline status`                              | No pipeline for the latest commit: blocked MR pipeline, a private fork source branch, or a deleted pipeline. Run a pipeline for the MR. |
| `Project ... not found or access denied`                            | Wrong `include:project` path or the pipeline user lacks access to the included project.                                                 |
| Jobs or variables silently ignored                                  | A UTF-8 BOM in the file or an included file. Remove it.                                                                                 |
| Variable empty on feature branches only                             | Protected variable. Use an unprotected variable for non-production values, or run on a protected ref.                                   |
| Variable empty in one job only                                      | Environment scope does not match the job's `environment:`.                                                                              |
| Variable has the wrong value                                        | Precedence: a pipeline, project or group variable overrides the YAML value.                                                             |
| Jobs exist but stay Pending                                         | Not a configuration problem. Use [[gitlab-runner-jobs-stuck-pending]].                                                                  |

## Related

- [[gitlab-ci-pipeline-structure]] and [[ci-pipeline-standard]] for the pipeline shape every project should start from.
- [[gitlab-ci-rules-dag-matrix-and-includes]] for `rules`, `needs` and `include` syntax.
- [[gitlab-ci-components-and-includes]] for shared templates and their versions.
- [[0012-gitlab-ci-for-new-pipelines]] for why new pipelines are on GitLab CI.
- [[gitlab-runner-jobs-stuck-pending]] when the jobs exist but do not start.
- [[gitlab-merge-trains-and-merged-results]] for merged results pipelines and merge trains, which change which pipeline runs.
- [[secret-scanning-pre-commit-and-ci]] for keeping secrets out of code and logs.

## Sources

Checked 2026-10-21 against the GitLab documentation source:

- [Pipeline efficiency and debugging: Troubleshooting CI/CD](https://docs.gitlab.com/ci/debugging/): no pipeline when no job is added, `.pre`/`.post`, BOM, `changes`, duplicate pipelines, job limit, include and MR status messages.
- [`workflow` keyword](https://docs.gitlab.com/ci/yaml/workflow/): evaluation order, the duplicate-pipeline rules, the `Checking pipeline status` interaction.
- [Specify when jobs run with `rules`](https://docs.gitlab.com/ci/jobs/job_rules/): `CI_PIPELINE_SOURCE` values, avoiding duplicate pipelines.
- [CI/CD YAML syntax reference](https://docs.gitlab.com/ci/yaml/): `rules:changes`, `compare_to`, `needs:optional`.
- [Validate GitLab CI/CD configuration](https://docs.gitlab.com/ci/yaml/lint/) and [CI Lint API](https://docs.gitlab.com/api/lint/): the simulation, `content_ref`, `dry_run_ref`, `include_jobs`, `include_merged_yaml`.
- [Skip a pipeline](https://docs.gitlab.com/ci/pipelines/#skip-a-pipeline): `[skip ci]` and `ci.skip`.
- [Merge request pipelines](https://docs.gitlab.com/ci/pipelines/merge_request_pipelines/) and [troubleshooting](https://docs.gitlab.com/ci/pipelines/mr_pipeline_troubleshooting/): fork pipelines and protected variable access.
- [GitLab CI/CD variables](https://docs.gitlab.com/ci/variables/) and [predefined variables](https://docs.gitlab.com/ci/variables/predefined_variables/): protection, masking, environment scope, precedence, `CI_OPEN_MERGE_REQUESTS`, `CI_DEBUG_TRACE`.
