---
title: CI pipeline standard for GitLab CI and Jenkins
description: Required stages, pinning, timeouts, retries, caches, protected deploys and required checks for GitLab CI and Jenkins pipelines.
type: standard
tags:
  - standards
  - ci-cd
  - gitlab-ci
  - jenkins
  - supply-chain
created: 2026-10-19
modified: 2026-10-19
draft: false
---

A pipeline is the only path to production, so its defaults decide how safe every release is. This standard sets the stages every pipeline has, what each stage must block, how pipelines pin what they run, how timeouts, retries and caches are configured, and how production deploys are gated. It applies to GitLab CI and Jenkins alike; the structure of a good GitLab pipeline is in [[gitlab-ci-pipeline-structure]] and Jenkins library practice is in [[jenkins-shared-libraries]]. New pipelines use GitLab CI (ADR [[adr/0012-gitlab-ci-for-new-pipelines]]); Jenkins pipelines that remain follow the same rules.

## Scope

Applies to pipelines in repositories that build, test or deploy software or infrastructure we operate. It covers the pipeline definition (`.gitlab-ci.yml`, `Jenkinsfile`), its shared templates and libraries, and the runner or agent settings that affect safety. Hardening of the Jenkins controller and agents is in [[jenkins-controller-and-agent-hardening]]. For a comparison of the two systems see [[gitlab-ci-vs-jenkins]].

> [!info] Check the current docs
> Keyword names and accepted values (for example `retry:when`) change between releases. Check the GitLab and Jenkins documentation for the versions you run before copying an example.

## Required stages

Every pipeline has these stages, in this order. A repository may add stages but not drop one without an exception.

| Stage             | Purpose                                                                                  | What it must block                                                              |
| ----------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `lint`            | Format, static checks, Dockerfile, YAML, shell, IaC validation                           | Merge on any failure                                                            |
| `test`            | Unit and integration tests                                                               | Merge on any failure; flaky tests are quarantined, not retried away (see below) |
| `scan`            | Secret scanning, dependency vulnerability scan, SAST (before build)                      | Merge when findings exceed the policy in [[vulnerability-management-slas]]      |
| `build`           | Build the artifact once, tag it, push it                                                 | Anything downstream if the artifact cannot be built reproducibly                |
| `sign-and-attest` | Image vulnerability scan of the built image, then sign it and attach SBOM and provenance | Deploy of an unscanned or unsigned artifact                                     |
| `deploy`          | Promote to environments, with approval for production                                    | Production without the approval and the protected-environment rules             |

Rules for the stage set:

- **Build once, promote.** Later environments deploy the artifact built earlier by digest; they do not rebuild. See ADR [[adr/0004-build-once-promote-between-repositories]].
- **Required checks are the merge gate.** The jobs from `lint`, `test` and `scan` are required status checks on the protected branch (see [[branching-and-merge-standard]]). A job that is not required is advice.
- **Secrets scanning runs on every merge request** and on the default branch; see [[secret-scanning-pre-commit-and-ci]].
- **Only the default branch and tags deploy.** Merge request pipelines never reach a shared environment.

```yaml title=".gitlab-ci.yml"
stages: [lint, test, scan, build, sign-and-attest, deploy]

default:
  image: registry.example.com/ci/base:1.8.0@sha256:0000000000000000000000000000000000000000000000000000000000000000
  timeout: 15 minutes
  interruptible: true

workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/

lint:
  stage: lint
  script: ["make lint"]

unit-tests:
  stage: test
  needs: [lint]
  timeout: 20 minutes
  retry:
    max: 2
    when: [runner_system_failure, stuck_or_timeout_failure]
  script: ["make test"]
  artifacts:
    when: always
    expire_in: 7 days
    reports:
      junit: reports/junit.xml

build-image:
  stage: build
  needs: [unit-tests]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script: ["./scripts/build-and-push.sh"]
  interruptible: false

# Needs the built image, so it runs after build, not in the scan stage.
image-scan:
  stage: sign-and-attest
  needs: [build-image]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script: ["./scripts/scan-image.sh"]

# Tag pipelines never rebuild. They resolve the digest built for the same
# commit on the default branch and retag that digest (build once, promote).
promote-image:
  stage: build
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
  script: ['./scripts/promote-image.sh "$CI_COMMIT_SHA" "$CI_COMMIT_TAG"']
  interruptible: false

deploy-prod:
  stage: deploy
  needs: [promote-image]
  environment:
    name: production
    deployment_tier: production
  resource_group: production
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
      when: manual
  script: ["./scripts/deploy.sh production"]
  interruptible: false
```

The scripts (`build-and-push.sh`, `scan-image.sh`, `promote-image.sh`), image tag, digest and timeouts are examples. `promote-image.sh` must fail if no image was built for the tagged commit, rather than building one. `retry: when` values are listed in the [GitLab CI YAML reference](https://docs.gitlab.com/ci/yaml/); check the current `retry:when` values there before relying on a name.

## Pinning

Anything a pipeline pulls in at run time can change under us. Pin it.

- **Job images** use a digest, or at minimum a fixed version tag, never `latest` and never a moving tag such as `3`. Prefer a digest with the tag in a comment; an update bot moves it (see [[dependency-update-policy]]). The same applies to service containers.
- **`include:` and shared libraries** point to a **tag or a commit SHA**, never a branch. A pipeline that includes `ref: main` runs whatever was merged this morning in another team's repository.
- **Third-party templates and actions** are pinned to a SHA, and reviewed on update like any dependency.
- **Tool installs** inside jobs (`pip install`, `npm install`, `curl | sh`) use lock files or checksums. Prefer a prebuilt, pinned tools image over installing at run time.

```yaml title=".gitlab-ci.yml"
include:
  - project: platform/ci-templates
    ref: v3.4.0
    file: /templates/security.yml
```

```groovy title="Jenkinsfile"
@Library('platform-lib@v1.4.0') _

pipeline {
  agent { label 'linux-pinned' }
  options {
    timeout(time: 30, unit: 'MINUTES')
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10'))
  }
  stages {
    stage('Build') {
      steps { sh 'make build' }
    }
  }
}
```

The library version, label and retention numbers are examples. Library versioning practice is in [[jenkins-shared-libraries]]; the central template model for GitLab is in ADR [[adr/0013-versioned-central-ci-templates]].

## Naming and variables

- **Job names** are `verb-object` in lower-kebab-case: `lint-yaml`, `unit-tests`, `build-image`, `deploy-prod`. Names are stable, because required checks, dashboards and `needs:` refer to them.
- **Secrets are protected and masked variables** (GitLab) or credentials bound with `withCredentials` (Jenkins), scoped to the environment that needs them. Protected variables are exposed only to protected branches and tags.
- **No secrets in YAML or the Jenkinsfile**, including "temporary" ones, and none in job logs. Mask what must be a variable, and never `echo` it or pass it as a command-line argument that a log prints.
- **OIDC over static keys.** Jobs that talk to a cloud use short-lived tokens from workload identity federation, not a long-lived key stored in a variable. See [[iam-groups-and-ci-workload-identity-federation]] and ADR [[adr/0026-keyless-ci-auth-with-workload-identity-federation]].
- **Variables have owners and expiry.** A variable with no owner is removed in the next review; tokens that must exist have an expiry.

## Timeouts, retries and caches

### Timeouts

Every job has an explicit timeout sized to its class, so a hung job stops holding a runner and a lock. The values below are proposed team defaults; tune them from the 95th percentile duration of the job plus margin.

| Job class                 | Timeout (proposed default) |
| ------------------------- | -------------------------- |
| Lint and static checks    | 5 to 10 minutes            |
| Unit tests                | 15 to 20 minutes           |
| Build and image push      | 30 minutes                 |
| Integration or end-to-end | 45 minutes                 |
| Deploy                    | 15 to 30 minutes           |

GitLab: `timeout:` per job, with the project default as a ceiling. Jenkins: `options { timeout(...) }` on the pipeline and inside long stages.

### Retries

`retry:` exists for **infrastructure failures**, not for test failures. A retry that re-runs failed tests hides flakiness, doubles the cost and teaches the team to ignore red.

- Retry only on infrastructure failure types, such as `runner_system_failure` and `stuck_or_timeout_failure`, with a maximum of two retries.
- Never use a bare `retry: 2` on a test job, which retries on script failure too.
- A deploy job is not retried automatically unless it is proven idempotent.
- A test that fails intermittently is **quarantined** with a ticket and a deadline, and fixed; see [[test-sharding-flaky-tests]] for how to find and shard them.

### Caches and artifacts

- **Key the cache on the lock file hash**, so it invalidates when dependencies change: `cache:key:files` listing the lock file.
- **Do not share caches between protected and unprotected refs.** GitLab separates them when you use distinct cache keys per ref type or the runner's protected-cache setting; confirm the behaviour for your version. A cache written by a merge request pipeline must not feed a release build, because it is a path for poisoning the artifact.
- **Cache is an optimisation, artifacts are data.** A cache can be missing and the job must still pass. Anything a later job needs goes through `artifacts:` (with `expire_in`) or `needs:` artifacts, not the cache.

```yaml title=".gitlab-ci.yml"
unit-tests:
  cache:
    key:
      files:
        - package-lock.json
    paths:
      - .npm/
    policy: pull-push
  script:
    - npm ci --cache .npm --prefer-offline
    - npm test
```

The caching rules are in the [GitLab caching docs](https://docs.gitlab.com/ci/caching/).

## Deploy gates

- **Protected environments.** `production` is a protected environment: only named approver groups may deploy, and only from protected tags. Set `deployment_tier` so tooling can tell environments apart. See [protected environments](https://docs.gitlab.com/ci/environments/protected_environments/).
- **A manual production gate.** The production job is `when: manual`, run by someone other than the author where the control requires it (see [[separation-of-duties-in-deployments]]). The approval is recorded by the platform, not in chat.
- **No concurrent deploys.** `resource_group: production` makes GitLab run one job at a time for that group; in Jenkins, `disableConcurrentBuilds()` on the deploy pipeline and the Lockable Resources plugin for shared targets. Two overlapping deploys to one environment are a source of half-applied states. See [resource groups](https://docs.gitlab.com/ci/resource_groups/).
- **Deploy jobs are not interruptible.** Set `interruptible: false` so a newer commit does not cancel a deploy in progress.
- **Rollback is a pipeline.** Redeploying the previous digest uses the same job; see ADR [[adr/0048-rollback-by-redeploying-previous-digest]].

## GitLab and Jenkins parity

| Requirement             | GitLab CI                                         | Jenkins (declarative)                                            |
| ----------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| Job timeout             | `timeout:`                                        | `options { timeout(time: 30, unit: 'MINUTES') }`                 |
| Retry on infrastructure | `retry: {max: 2, when: [...]}`                    | `retry(2)` inside a step wrapper, scoped to infrastructure steps |
| No concurrent deploys   | `resource_group:`                                 | `disableConcurrentBuilds()`                                      |
| Pinned shared code      | `include: ref: v3.4.0`                            | `@Library('lib@v1.4.0')`                                         |
| Cache                   | `cache:key:files`                                 | Agent workspace or an external cache; no built-in lock-file key  |
| Protected deploy        | Protected environment and protected tags          | `input` step with `submitter`, folder-level permissions          |
| Build retention         | `artifacts:expire_in`, project retention          | `buildDiscarder(logRotator(...))`                                |
| Secrets                 | Masked and protected variables, OIDC `id_tokens`  | `withCredentials`, folder-scoped credentials                     |
| Concurrency cancel      | `interruptible:`, auto-cancel redundant pipelines | `milestone` and `lock` steps                                     |

The Jenkins `retry` step retries any failure inside it, so wrap only the steps that touch infrastructure and leave test steps outside. See the [declarative pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/).

## Exceptions

A pipeline that cannot meet a rule records the rule, the reason, an owner and an expiry (default 90 days, a proposed team default) in the repository and the exception register. A moving `include:` reference, a missing scan stage and an unprotected production deploy are never accepted as exceptions.

## Reviewer checklist

- [ ] The six stages exist; lint, test and scan jobs are required checks.
- [ ] Job images pinned; `include:` and `@Library` pinned to a tag or SHA, not a branch.
- [ ] No secret in YAML or the Jenkinsfile; cloud auth uses OIDC.
- [ ] Every job class has an explicit timeout.
- [ ] `retry:` is limited to infrastructure failure types, max two; no retry on test jobs.
- [ ] Cache keyed on the lock file; no shared cache between protected and unprotected refs.
- [ ] `production` is a protected environment, manual, in a `resource_group`, from a protected tag.
- [ ] Deploy jobs are not interruptible and deploy by digest.
- [ ] Jenkins: `timeout`, `disableConcurrentBuilds()` and `buildDiscarder` set.

## Sources

- [GitLab CI/CD YAML reference](https://docs.gitlab.com/ci/yaml/)
- [GitLab: Caching in CI/CD](https://docs.gitlab.com/ci/caching/)
- [GitLab: Protected environments](https://docs.gitlab.com/ci/environments/protected_environments/)
- [GitLab: Resource groups](https://docs.gitlab.com/ci/resource_groups/)
- [Jenkins: Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/)
- [Jenkins: Shared libraries](https://www.jenkins.io/doc/book/pipeline/shared-libraries/)

## Related

- [[gitlab-ci-pipeline-structure]]: how to lay out a GitLab pipeline.
- [[jenkins-shared-libraries]]: writing and versioning libraries.
- [[gitlab-ci-vs-jenkins]]: choosing between the two.
- [[secret-scanning-pre-commit-and-ci]]: the secrets scan.
- [[test-sharding-flaky-tests]]: handling flaky tests.
- [[iam-groups-and-ci-workload-identity-federation]]: keyless cloud auth.
- [[jenkins-controller-and-agent-hardening]]: securing Jenkins itself.
- [[dockerfile-standard]]: the Dockerfile rules the build stage enforces.
- [[branching-and-merge-standard]]: protected branches and required checks.
