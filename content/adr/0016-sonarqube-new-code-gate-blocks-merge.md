---
title: The SonarQube new-code quality gate blocks merges
description: The merge request pipeline waits for the quality gate, and only new code must pass it; legacy debt is tracked separately.
type: adr
tags:
  - adr
  - sonarqube
  - ci-cd
  - delivery
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0016
---

## Context

SonarQube analysis ran in our pipelines, but the result did not stop anything. Reports were generated, dashboards were green or red, and a failing gate had no consequence for a merge. Two opposite problems followed:

- **Advisory gates get ignored.** When a failed gate does not block, findings pile up and the dashboard stops being read.
- **Gating on the whole codebase does not work for old code.** A long-lived service has years of existing findings. A gate on overall code fails from the first day, so teams either disable it or add exclusions until it means nothing.

SonarQube separates the two cases with the "new code" concept: the gate can judge only the code added or changed since a reference point, while the overall code is reported but not gating. We need to decide what blocks a merge, where the gate is defined, and how existing debt is handled without letting it block delivery.

## Decision

We will make the **SonarQube quality gate on new code a required check for merging**, in both GitLab CI and Jenkins, and track legacy findings separately.

- **The pipeline waits for the result.** Analysis runs with `sonar.qualitygate.wait=true` so the job fails when the gate fails, rather than finishing before the verdict is known. Set an explicit timeout (`sonar.qualitygate.timeout`, check the current docs for the name and unit) so a stuck server fails the job in a bounded time instead of hanging.
- **Only new code gates.** The new code definition for each project is the **reference branch** (the default branch), so a merge request is judged on what it changes relative to the target. Projects do not use a fixed number of days as their definition, because a quiet repository would then have almost no "new" code to judge.
- **One shared gate.** The organisation uses a single quality gate assigned to every project by default. A change to the gate goes through a merge request in the repository that manages SonarQube configuration (as code, through the API or Terraform provider where available), with a reviewer from the platform team. Teams do not create private gates.
- **Typical gate conditions** are on new code: no new bugs or vulnerabilities, security hotspots reviewed, coverage and duplication above a threshold, and maintainability rating at an agreed level. The thresholds live in the gate configuration and are not copied here, because they change; check the gate in SonarQube for the current values.
- **Legacy debt is not gated, it is planned.** Overall-code findings feed the quarterly technical debt review in [[tech-debt-management]]. A team may not suppress findings just to pass a gate; marking an issue accepted or false positive requires a reason in SonarQube, and the use of that status is sampled in review.
- **Failure of the scanner infrastructure** (SonarQube unreachable) is handled by the timeout policy below, not by silently skipping the check.

```yaml title=".gitlab-ci.yml (excerpt)"
sonarqube-check:
  stage: test
  image: sonarsource/sonar-scanner-cli:<pin-a-version-by-digest>
  variables:
    SONAR_HOST_URL: https://sonarqube.example.com
    GIT_DEPTH: "0" # full history so new-code detection and blame work
  script:
    - sonar-scanner
      -Dsonar.projectKey=${CI_PROJECT_PATH_SLUG}
      -Dsonar.qualitygate.wait=true
      -Dsonar.qualitygate.timeout=300
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

`SONAR_TOKEN` is a masked CI/CD variable and is never written in the file. Pin the scanner image to a digest you have reviewed. For merge request decoration and branch analysis features, check which SonarQube edition you run, because some are edition-dependent.

**Timeout policy.** If the scanner cannot reach SonarQube or the gate does not return within the timeout, the job fails and the merge is blocked. A person with the maintainer role may rerun the job, and for a proven SonarQube outage the platform on-call can authorise a documented, time-boxed bypass for a specific merge request, recorded in the incident or change log. The default is fail closed.

## Consequences

Easier:

- A merge request that adds a new vulnerability or untested code is stopped before merge, when fixing it is cheapest.
- Existing debt does not hold current work hostage, so teams are willing to keep the gate on.
- One shared gate means the same bar across teams and one place to tune it.
- Findings in review comments and merge request widgets put the feedback where developers already look.

Harder or newly required:

- SonarQube becomes a merge dependency. Its availability, capacity and upgrades need owning, with monitoring and a documented outage path.
- Pipelines get slower by the analysis time plus the wait. Large monorepos may need module-scoped analysis.
- Developers will hit false positives. We need a clear triage path and an owner; otherwise people learn to work around the gate.
- "New code" can be gamed by moving code or by large generated files. Exclusions are reviewed and limited to generated and vendored paths.
- Tightening the gate later will block work that used to pass. Announce threshold changes and run the new thresholds in report-only mode first.

## Alternatives considered

- **Advisory-only gate.** No delivery friction, but findings are ignored in practice, which is the situation we are leaving. Rejected.
- **Gate on overall code.** Fails immediately on legacy repositories, so it gets disabled or excluded away. Rejected; overall code is tracked as debt instead.
- **Per-team gates.** Autonomy, but inconsistent standards and constant drift. Rejected in favour of one shared gate with documented exceptions.
- **Scanners in CI only (no server).** Useful for quick local feedback, but no history, no gate evaluation against a baseline, and no central reporting. Kept as a complement, not a replacement.

See [[sonarqube-quality-gates]] for how to configure the gate and the conditions.

> [!info] Claims not checked against current docs
> The names and units of `sonar.qualitygate.wait` and `sonar.qualitygate.timeout`, new code definition options by edition, merge request decoration availability, and the current scanner image tags were not verified for this record. Check the current SonarQube documentation.

## Validation

```bash
set -o pipefail
SONAR_URL="https://sonarqube.example.com"
SONAR_TOKEN="${SONAR_TOKEN:?set a read-only token}"
PROJECT_KEY="payments-api"

# Which gate is assigned to the project? (expect the shared gate name)
curl -fsS -u "${SONAR_TOKEN}:" \
  "${SONAR_URL}/api/qualitygates/get_by_project?project=${PROJECT_KEY}" | jq -r '.qualityGate.name'

# Current gate status of the project (OK or ERROR)
curl -fsS -u "${SONAR_TOKEN}:" \
  "${SONAR_URL}/api/qualitygates/project_status?projectKey=${PROJECT_KEY}" | jq -r '.projectStatus.status'

# Repositories whose pipeline does not wait for the gate (review the output)
grep -L 'qualitygate.wait=true' ./*/.gitlab-ci.yml 2>/dev/null
```

## References

- SonarQube Server documentation: https://docs.sonarsource.com/sonarqube-server/
- Related notes: [[sonarqube-quality-gates]], [[jenkins-shared-libraries]], [[tech-debt-management]]
- Related ADRs: [[0012-gitlab-ci-for-new-pipelines]]
