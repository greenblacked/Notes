---
title: SonarQube quality gates
description: Gate merges on new-code quality with SonarQube in GitLab CI and Jenkins, and roll it out to an existing codebase without blocking everyone.
type: pattern
tags:
  - patterns
  - sonarqube
  - ci-cd
  - gitlab-ci
  - jenkins
  - delivery
created: 2026-10-16
modified: 2026-10-16
draft: false
---

A quality gate is a pass/fail rule evaluated after each analysis. Used well, it stops new problems at merge time without forcing a team to fix years of old ones first. Used badly, it becomes a red badge people learn to ignore. The CI side follows [[gitlab-ci-pipeline-structure]] and [[jenkins-shared-libraries]].

> [!info] Not checked against live docs
> docs.sonarsource.com was unreachable when this was written. Parameter names (`sonar.token`, `sonar.qualitygate.wait`, `sonar.pullrequest.*`) are the ones I know from SonarQube Server 10.x and later. Confirm them for your server version, and note that pull request analysis requires an edition that supports it (Developer or above in the commercial editions; Community Build has limited branch support).

## Gate on new code

The key idea is the **new code period**: the gate looks only at code added or changed since a reference point (previous version, a number of days, or a reference branch), so a legacy project can pass immediately and stay clean from now on. This is often called "Clean as You Code".

The built-in "Sonar way" gate (check what your version ships) typically conditions on new code only: no new issues rated worse than A for reliability and security, maintainability rating A, security hotspots reviewed, coverage on new code at or above a threshold, and duplication on new code at or below a threshold. Copy the built-in gate rather than editing it, since built-in gates are read-only, and assign your copy per project or as the default.

Recommended conditions to start with:

| Condition                        | Typical threshold     | Why                                               |
| -------------------------------- | --------------------- | ------------------------------------------------- |
| New bugs / new vulnerabilities   | 0                     | Cheap to fix at the point of writing.             |
| Security hotspots reviewed (new) | 100%                  | Forces a decision, not necessarily a code change. |
| Coverage on new code             | 70-80%, tune per team | Anything higher invites gaming.                   |
| Duplicated lines on new code     | at most 3-5%          | Blocks copy-paste growth.                         |
| Maintainability rating (new)     | A                     | Controls new code smells.                         |

Do not gate on overall (whole-project) metrics until the project is genuinely healthy.

## Merge request decoration

For GitLab, analysis of a merge request posts a summary and inline comments on the MR, and sets the quality gate status as a check. You configure a GitLab integration in the SonarQube project's DevOps platform settings (a personal access token with API scope for decoration, bound to a bot user), then pass the MR details to the scanner.

In GitLab CI, tell the scanner which MR it is analysing:

```text
sonar.pullrequest.key=$CI_MERGE_REQUEST_IID
sonar.pullrequest.branch=$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME
sonar.pullrequest.base=$CI_MERGE_REQUEST_TARGET_BRANCH_NAME
```

Make the Sonar job a required status via the project's "pipelines must succeed" merge setting, and let the job fail when the gate fails (next section). Without that, decoration is advisory only.

## GitLab CI with sonar-scanner

```yaml title=".gitlab-ci.yml"
sonarqube:
  stage: test
  image:
    name: sonarsource/sonar-scanner-cli:latest # pin a specific tag in real use
    entrypoint: [""]
  variables:
    SONAR_USER_HOME: "${CI_PROJECT_DIR}/.sonar"
    GIT_DEPTH: "0" # full history for blame and new-code detection
  cache:
    key: "${CI_JOB_NAME}"
    paths: [.sonar/cache]
  script:
    - |
      if [ -n "$CI_MERGE_REQUEST_IID" ]; then
        EXTRA="-Dsonar.pullrequest.key=$CI_MERGE_REQUEST_IID -Dsonar.pullrequest.branch=$CI_MERGE_REQUEST_SOURCE_BRANCH_NAME -Dsonar.pullrequest.base=$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
      else
        EXTRA="-Dsonar.branch.name=$CI_COMMIT_REF_NAME"
      fi
      sonar-scanner $EXTRA -Dsonar.qualitygate.wait=true -Dsonar.qualitygate.timeout=300
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

`SONAR_TOKEN` and `SONAR_HOST_URL` are set as masked CI/CD variables, which the scanner reads from the environment. The project properties live in the repository:

```properties title="sonar-project.properties"
sonar.projectKey=payments-api
sonar.sources=src
sonar.tests=src
sonar.test.inclusions=**/*_test.go
sonar.exclusions=**/vendor/**,**/generated/**,**/*.pb.go
sonar.coverage.exclusions=**/cmd/**,**/mocks/**
sonar.go.coverage.reportPaths=coverage.out
```

`sonar.qualitygate.wait=true` makes the scanner poll the server and exit non-zero when the gate fails, so the job fails. It needs a long enough timeout for the server's background processing; check the default for your version.

## Maven

Maven projects use the plugin, which discovers modules, sources and tests itself:

```bash
export SONAR_HOST_URL="https://sonar.example.com"
# SONAR_TOKEN is provided by CI as a masked variable

mvn -B verify org.sonarsource.scanner.maven:sonar-maven-plugin:sonar \
  -Dsonar.host.url="${SONAR_HOST_URL}" \
  -Dsonar.qualitygate.wait=true
```

Run `verify` first in the same invocation so JaCoCo has produced its report. Pin the plugin version in `pom.xml` `pluginManagement`.

## Jenkins

With the SonarQube Scanner plugin, configure the server under Manage Jenkins, then wrap the analysis in `withSonarQubeEnv`. `waitForQualityGate` relies on a webhook from SonarQube to Jenkins (`<jenkins>/sonarqube-webhook/`), so create that webhook or the stage will hang until it times out.

```groovy title="Jenkinsfile"
pipeline {
  agent any
  stages {
    stage('Test') {
      steps { sh 'mvn -B verify' }
    }
    stage('Sonar') {
      steps {
        withSonarQubeEnv('sonarqube') {
          sh 'mvn -B org.sonarsource.scanner.maven:sonar-maven-plugin:sonar'
        }
      }
    }
    stage('Quality gate') {
      steps {
        timeout(time: 10, unit: 'MINUTES') {
          waitForQualityGate abortPipeline: true
        }
      }
    }
  }
}
```

For multibranch pipelines on a server edition with PR support, the plugin supplies the pull request parameters automatically for the supported SCM integrations; with a GitLab source verify what your plugin version provides before adding them by hand. Put this stage into a shared library step so every repository uses the same gate.

## Coverage import

SonarQube does not run tests; it imports reports. Generate the report first, then point the analysis at it, and make the paths relative to the working directory.

| Language | Property (check your language plugin version)       |
| -------- | --------------------------------------------------- |
| Java     | `sonar.coverage.jacoco.xmlReportPaths`              |
| JS/TS    | `sonar.javascript.lcov.reportPaths`                 |
| Python   | `sonar.python.coverage.reportPaths` (Cobertura XML) |
| Go       | `sonar.go.coverage.reportPaths`                     |

Common cause of "0% coverage": the report is produced in a different job and the artefact was not passed in, or paths in the report do not match the sources (Docker paths like `/app/src`). Run analysis in the same job as the tests, or pass the report as an artefact.

## Exclusions

Exclude what you do not own or cannot sensibly test: generated code, vendored dependencies, migrations, mocks. Use `sonar.exclusions` for files that should not be analysed and `sonar.coverage.exclusions` for files that are analysed but not expected to have tests. Keep the list short and reviewed in merge requests; a growing exclusion list is a smell.

## Avoiding gaming the metrics

- Do not set an extreme coverage target; teams then write assertion-free tests. Review test quality in code review ([[code-review]]).
- Do not allow "won't fix" and "false positive" bulk resolution. Restrict issue administration permissions and review the resolved list monthly.
- Watch for exclusions added in the same MR that fails the gate.
- Use trends and the new code gate, not a leaderboard of teams by coverage.
- The gate is a floor, not the goal. Pair it with the practices in [[tech-debt-management]].

## Rolling out to an existing codebase

1. Run the first analysis on the default branch with the gate in report-only mode (the job `allow_failure: true`).
2. Set the new code period to a reference branch or a recent date, so the backlog does not count.
3. Fix or triage blockers in security first (vulnerabilities and hotspots), then bugs. Leave smells alone.
4. After two to four weeks of green on new code, make the job required for merge requests.
5. Introduce coverage and duplication conditions last, with thresholds just below current levels, and ratchet up as the team improves.
6. Publish the gate definition and the escape hatch (who may override and how it is recorded).
7. Revisit after a quarter: look at override frequency and time spent resolving gate failures.
