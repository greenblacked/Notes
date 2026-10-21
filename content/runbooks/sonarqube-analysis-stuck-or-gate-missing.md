---
title: SonarQube analysis stuck or quality gate not reported on merge requests
description: Trace a SonarQube analysis from scanner to Compute Engine task to gate result, unstick the queue, fix missing MR status, and unblock merges safely.
type: runbook
tags:
  - runbooks
  - sonarqube
  - ci-cd
  - gitlab-ci
  - jenkins
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Under [[0016-sonarqube-new-code-gate-blocks-merge]], every merge request (MR) waits for the SonarQube quality gate, and the default is fail closed. That makes SonarQube part of the merge path: when analyses queue up, fail in the background, or finish without the gate status reaching the CI job or the MR, **every merge in the organisation stops**. This runbook follows one analysis through its stages and finds the stage where it stopped.

An analysis has three stages, and each fails differently:

1. **The scanner** runs in CI, analyses the code and uploads a report. It prints a task ID and exits (or keeps polling, with `sonar.qualitygate.wait`).
2. **The Compute Engine (CE)** on the server takes the report from a queue and processes it in the background. Only after that is the quality gate computed.
3. **The result is delivered**: the waiting scanner gets the gate status, a webhook tells Jenkins, or the server decorates the MR in GitLab.

For upgrade problems use [[sonarqube-upgrade-and-db-migration]]; for gate design, [[sonarqube-quality-gates]].

> [!info] Scope and verification
> The `api/ce/*` and `api/system/health` endpoints, their parameters, statuses and permissions were read in the SonarQube Community Build source on 2026-10-21; the product naming and the editions statement come from the SonarQube README. docs.sonarsource.com could not be opened, so the rest is from experience and is **not verified**:
>
> - the defaults of `sonar.qualitygate.wait` and `sonar.qualitygate.timeout` (commonly off and 300 seconds);
> - that Jenkins `waitForQualityGate` needs a SonarQube webhook to Jenkins, and the webhook delivery history UI;
> - the GitLab integration setup, project binding, the `sonar.pullrequest.*` parameters and token scopes for MR decoration;
> - which commercial editions include MR analysis, and how many CE workers each edition can run;
> - UI paths (Background Tasks, Webhooks), the `ce.log` file name, and `.scannerwork/report-task.txt`.
>
> Your server's own Web API documentation at `<SONARQUBE_URL>/web_api` is the authoritative reference for your version; check parameters there before scripting them.

## When to use

- CI jobs with `sonar.qualitygate.wait=true` time out, or Jenkins pipelines hang in `waitForQualityGate`.
- MRs show no SonarQube status, or a stale one, while the analysis ran.
- The project's Background Tasks show tasks stuck in Pending or In Progress, or Failed.
- Many teams report blocked merges at once, which points at the server rather than one project.

## Preconditions

- A SonarQube user token in `SONAR_TOKEN` with Administer System permission for the queue-wide checks, or project administration for one project. `api/ce/task` also accepts Execute Analysis, so a CI token can read its own task.
- The server URL in `SONARQUBE_URL`. Use your instance's `/web_api` page to confirm parameters for your version.
- Shell access to the server or `kubectl` access to its namespace for logs.

```bash
SONARQUBE_URL=https://sonarqube.example.com
PROJECT_KEY=my-service
# export SONAR_TOKEN=...      # from your secret store; never in a script or job log
sq() { curl --silent --fail --user "$SONAR_TOKEN:" "$SONARQUBE_URL$1"; }
```

The token is passed as the basic-auth user name with an empty password, which SonarQube has long accepted; newer versions also accept a bearer token, see your version's Web API page.

## Steps

### 1. Find the CE task for the analysis

The scanner log ends with a link to the task, of the form `$SONARQUBE_URL/api/ce/task?id=<task-id>`, and the scanner writes `ceTaskId` and `ceTaskUrl` into `report-task.txt` in its working directory (usually `.scannerwork/`; not verified for every scanner). Make CI keep that file as an artifact so the task ID survives the job.

```bash
TASK_ID=AYz0exampleTaskId
sq "/api/ce/task?id=$TASK_ID&additionalFields=warnings" | jq '.task | {status, type, componentKey, branch, pullRequest, submittedAt, executedAt, executionTimeMs, errorMessage}'
```

Status values are `PENDING` and `IN_PROGRESS` while queued or running, and `SUCCESS`, `FAILED` or `CANCELED` once finished. Then go to the matching step:

| Task status            | Meaning                                                    | Go to  |
| ---------------------- | ---------------------------------------------------------- | ------ |
| No task, no ID in log  | The scanner failed before or during upload.                | Step 4 |
| `PENDING` for long     | The queue is backed up.                                    | Step 2 |
| `IN_PROGRESS` for long | One task is slow or stuck; the server may be unhealthy.    | Step 2 |
| `FAILED`               | Background processing failed; read `errorMessage`.         | Step 3 |
| `SUCCESS`              | The analysis is done; the result was not delivered.        | Step 4 |

For a project view of the same thing, `api/ce/component` returns the pending and in-progress tasks and the last executed task of one project (it needs Browse on the project):

```bash
sq "/api/ce/component?component=$PROJECT_KEY" | jq .
```

The response separates the queued tasks from the last finished one; check the response example on your `/web_api` page for the field names before you script against them.

### 2. A backed-up or stuck queue

Check server health and the whole queue first:

```bash
sq "/api/system/health" | jq        # GREEN, YELLOW or RED; needs Administer System or the system passcode
sq "/api/ce/activity?status=PENDING,IN_PROGRESS&ps=100" \
  | jq -r '.tasks[] | [.status, .submittedAt, (.startedAt // "-"), .componentKey, .type] | @tsv' | sort | head -50
SINCE=$(date -u -d '-2 hours' +%Y-%m-%dT%H:%M:%S%z | sed 's/+/%2B/')   # macOS: date -u -v-2H +...
sq "/api/ce/activity?status=FAILED&minSubmittedAt=$SINCE&ps=100" | jq '.tasks | length'
```

`api/ce/activity` returns only finished tasks unless you pass `status` with the queue values, as above. The date needs the `+` of the time zone URL-encoded, which the `sed` does.

Read the result:

- **Health RED or YELLOW.** The server, its search index or its database is in trouble. When the server is in safe mode waiting for or running a database upgrade, only the system passcode authenticates, which usually means an upgrade is half done: go to [[sonarqube-upgrade-and-db-migration]].
- **One task `IN_PROGRESS` for much longer than its usual duration, many `PENDING` behind it.** The CE processes tasks in a fixed number of workers (how many depends on the edition and settings; check your edition's documentation). One huge or stuck analysis blocks the others. Read the CE log (in the server's `logs/` directory, usually `ce.log`) for that task ID, and check database load: CE work is database-heavy.
- **Many `PENDING`, none `IN_PROGRESS`.** The CE is not taking work. Look for CE process errors, out-of-memory errors (the CE heap is set separately from the web server's, with `sonar.ce.javaOpts`), or a database that refuses connections. A controlled restart of SonarQube after reading the logs is the usual fix.
- **A burst of `PENDING` from one source.** A pipeline loop or a monorepo matrix submitting dozens of analyses at once. Throttle at the source: run analysis once per pipeline and only on MR and default-branch pipelines.

Pending tasks can be cancelled by an administrator (the UI offers it in Background Tasks; check the `api/ce/cancel` and `api/ce/cancel_all` endpoints on your `/web_api` page before scripting it). Cancel only tasks that are duplicates or for abandoned branches, and tell the owners: a cancelled task means that analysis never produces a gate result.

### 3. Failed background tasks

```bash
sq "/api/ce/task?id=$TASK_ID&additionalFields=stacktrace,scannerContext" | jq -r '.task.errorMessage, .task.errorStacktrace' | head -40
```

The `stacktrace` and `scannerContext` fields are returned only when requested. Common causes:

- **A feature the edition does not support.** Branch or MR analysis parameters sent to a server without branch support fail or are rejected. The SonarQube README says branch and pull request analysis is part of the commercial offerings, not the free Community Build. Fix the pipeline so the Community Build only analyses the main branch, or move to an edition that supports it.
- **Permissions.** The token's user lacks Execute Analysis on the project, or the project does not exist and the user cannot create it.
- **Database or disk errors** during processing: treat as a server problem, step 2.
- **A plugin error** after a server or plugin upgrade: check the stack trace for the plugin and see [[sonarqube-upgrade-and-db-migration]].

Re-run the CI job after fixing the cause; a failed task is not retried on its own.

### 4. The analysis succeeded, but the gate status did not arrive

The analysis is `SUCCESS`, so the result exists on the server. What failed is delivery. Which delivery depends on the CI side:

**a. The scanner waits (`sonar.qualitygate.wait=true`).** The scanner polls the server until the task finishes or `sonar.qualitygate.timeout` (in seconds) expires, then fails the job if the gate failed. A timeout means the task did not finish in time, so this is really step 2. Set the timeout above the 95th percentile of your CE task duration, as ADR 0016 requires an explicit one. Defaults are not verified here; set both properties explicitly as in [[sonarqube-quality-gates]].

**b. Jenkins `waitForQualityGate`.** Per the SonarQube Scanner for Jenkins documentation (not read for this note), this step does not poll: it waits for a SonarQube **webhook** call to `<JENKINS_URL>/sonarqube-webhook/` and must run after `withSonarQubeEnv` in the same pipeline. If the stage hangs until its `timeout` block:

- Check that a webhook to Jenkins exists, at the project or global level, in the SonarQube administration settings, and look at its last delivery result there.
- Check that SonarQube can reach Jenkins over the network (egress rules, proxy, TLS trust of the Jenkins certificate), and that the Jenkins controller is up ([[jenkins-controller-down-and-queue-stuck]]).
- If the webhook uses a secret, check that both sides have the same value after a rotation.
- Always wrap the step in a `timeout`, so a lost webhook fails the build instead of holding an executor:

```groovy title="Jenkinsfile (excerpt)"
stage('Quality gate') {
  steps {
    timeout(time: 15, unit: 'MINUTES') {
      waitForQualityGate abortPipeline: true
    }
  }
}
```

**c. GitLab MR decoration.** The MR widget or comment comes from SonarQube calling the GitLab API, separate from the CI job result. It needs (none of this verified here; read the SonarQube GitLab integration page for your edition):

- an edition with MR analysis;
- a GitLab DevOps platform integration configured on the server, with a GitLab token that can comment on MRs in that project, and the SonarQube project bound to the GitLab project;
- the analysis run as an MR analysis, with the MR key, source and target branch (the scanner usually detects them from GitLab CI's predefined variables in MR pipelines; a branch pipeline produces a branch analysis, not an MR analysis).

So a missing decoration usually means one of: the job ran in a branch pipeline instead of an MR pipeline ([[gitlab-pipeline-or-job-did-not-run]], step 4), the project is not bound, or the integration token expired or lost access. The CI job's own pass or fail, from `sonar.qualitygate.wait`, is what ADR 0016 relies on to block the merge; decoration is information for the reviewer.

### 5. Unblock merges during a SonarQube outage

When the server is down or the queue will take hours to clear, do not switch the gate off. ADR 0016 sets the policy: the job fails closed; a maintainer may re-run it; for a proven outage the platform on-call can authorise a documented, time-boxed bypass **for a specific MR**, recorded in the incident or change log. Use [[policy-exception-and-waiver-process]] for the record: which MRs, who approved, until when.

> [!warning] Never disable the gate globally to get through an outage
> Removing `sonar.qualitygate.wait`, setting `allow_failure: true` in the shared template, or making the SonarQube status optional in branch protection unblocks every MR, including the ones that would fail, and is easy to forget to undo. Bypass named MRs only, and re-run their analysis once the server is back so each one gets a real gate result.

Handle the backlog after recovery: re-run the analyses for bypassed MRs first, then let the rest drain; avoid re-running hundreds of pipelines at once, which recreates the queue from step 2.

## Validation

```bash
sq "/api/system/health" | jq -r .health                                        # GREEN
sq "/api/ce/activity?status=PENDING,IN_PROGRESS&ps=100" | jq '.tasks | length' # back to the usual level, near 0
sq "/api/ce/activity?status=FAILED&component=$PROJECT_KEY&ps=5" | jq -r '.tasks[] | [.submittedAt, .errorMessage] | @tsv'
```

- A fresh MR pipeline runs the analysis, the task reaches `SUCCESS` within its usual duration, and the CI job reports the gate result.
- Jenkins pipelines pass `waitForQualityGate` within seconds of the task finishing.
- MR decoration (where used) appears on a test MR.
- Every bypassed MR has been re-analysed, and the waiver records are closed.

## Rollback

This runbook changes little that needs undoing: cancelled tasks are re-created by re-running their pipelines, and a restart has no rollback. Revert any pipeline or template change made during the incident (a raised timeout, a temporary `allow_failure`) through a reviewed MR, and close the time-boxed waivers when they expire. If the incident came from a server or plugin upgrade, its rollback is in [[sonarqube-upgrade-and-db-migration]].

## Troubleshooting

| Symptom                                                   | Likely cause and fix                                                                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| CI job times out waiting for the gate                     | Task still queued or running. Step 2; raise the timeout only if tasks are healthy but slow.                                            |
| Many tasks `PENDING`, none `IN_PROGRESS`                  | CE not processing: CE out of memory, database errors. Read the CE log, fix, restart.                                                   |
| One task `IN_PROGRESS` for hours                          | A huge or stuck analysis. Read its log lines; cancel it if it is a duplicate, and fix the project's scope (exclusions, generated code). |
| `api/system/health` returns RED                           | Server, search index or database down. Treat as an outage; step 5 for merges.                                                          |
| Only the passcode works for health; other calls refused    | Safe mode during a database upgrade. Finish it with [[sonarqube-upgrade-and-db-migration]].                                           |
| Task `FAILED` on branch or MR analysis                    | The edition has no branch or MR analysis. Analyse only the main branch, or change edition.                                             |
| Jenkins hangs in `waitForQualityGate`                     | No webhook to Jenkins, webhook cannot reach Jenkins, or a secret mismatch. Step 4b.                                                    |
| CI job passes, but no MR decoration                       | Branch pipeline instead of MR pipeline, project not bound, or integration token expired. Step 4c.                                      |
| Gate result is for the wrong code                         | Shallow clone or wrong new code reference. Use full history (`GIT_DEPTH: "0"`), see [[sonarqube-quality-gates]].                       |
| 401 or 403 from the API                                   | Token expired or lacks the permission each endpoint needs (see Preconditions).                                                         |

## Related

- [[0016-sonarqube-new-code-gate-blocks-merge]] for the decision and its timeout and bypass policy.
- [[sonarqube-quality-gates]] for gate design and the CI configuration.
- [[sonarqube-basics-first-scan-and-triage]] for how an analysis works from first principles.
- [[sonarqube-upgrade-and-db-migration]] for upgrade problems and safe mode.
- [[gitlab-pipeline-or-job-did-not-run]] when the MR pipeline itself did not run.
- [[jenkins-controller-down-and-queue-stuck]] when Jenkins, not SonarQube, is the problem.
- [[policy-exception-and-waiver-process]] for time-boxed bypasses.

## Sources

- [SonarQube README](https://github.com/SonarSource/sonarqube): product names (Community Build, Server, Cloud) and branch and pull request analysis in the commercial offerings; checked 2026-10-21.
- SonarQube Community Build source, [server web services](https://github.com/SonarSource/sonarqube/tree/master/server): `api/ce/activity`, `api/ce/task`, `api/ce/component` and `api/system/health`, their parameters, statuses and permissions, and the `sonar.ce.javaOpts` and `sonar.web.systemPasscode` properties; read in source on 2026-10-21.
- [SonarQube Scanner for Jenkins](https://github.com/jenkinsci/sonarqube-plugin): plugin README; the `waitForQualityGate` and webhook behaviour were not in it.
- [SonarQube Server documentation](https://docs.sonarsource.com/sonarqube-server/latest/): analysis parameters, background tasks, webhooks and the GitLab integration; not read, check them for your version.
- Your instance's Web API documentation at `<SONARQUBE_URL>/web_api`.
