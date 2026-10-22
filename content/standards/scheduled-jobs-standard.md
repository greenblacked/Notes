---
title: Scheduled jobs standard
description: "Rules for Kubernetes CronJobs, Cloud Scheduler, GitLab schedules and Jenkins cron: concurrency, deadlines, idempotency, time zones and missed-run alerts."
type: standard
tags:
  - standards
  - kubernetes
  - gcp
  - gitlab-ci
  - jenkins
  - observability
  - reliability
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Scheduled jobs fail without an error to look at: a schedule that never fires produces nothing to alert on, a nightly cleanup that overlaps with itself corrupts its own state, and a report job that retries forever keeps a database busy all morning. Nobody notices until the thing the job was supposed to produce is missing. This standard sets the rules every scheduled job must follow, whatever runs it: Kubernetes CronJobs, Cloud Scheduler, GitLab pipeline schedules, Jenkins cron triggers and, as a last resort, host cron with a lock.

It does not teach the schedulers. For how to build a reliable Kubernetes Job or CronJob (field behaviour, sidecars, the missed-schedule mechanics) see [[patterns/kubernetes-jobs-and-cronjobs]]; for Cloud Scheduler with Cloud Run jobs and other batch options on Google Cloud see [[architecture/batch-and-scheduled-workloads-gcp]]; for host cron and systemd timers see [[learn/linux-services-packages-and-scheduled-jobs]]; for the scripts the jobs run see [[bash-scripts]] and [[python-ops-scripts-standard]]; for the alerts see [[alert-and-runbook-standard]].

## Scope

Applies to every job that runs on a schedule and touches a shared environment: data exports, cleanups, certificate and secret checks, report generation, backups, scheduled scans and scheduled CI pipelines. A one-off job started by hand during an incident is out of scope, but the backfill rules below apply to it.

> [!info] Keywords and sources
> MUST means a reviewer or a CI check blocks the merge. SHOULD means the author explains a deviation in the merge request. Every number that is not quoted from vendor documentation (deadlines, alert windows, history counts) is a proposed team default and is labelled so. Facts were checked on 2026-10-21 against the documentation sources listed in Sources; scheduler behaviour changes between versions, so check the docs for the version you run.

## Principles

1. **Idempotent.** Running the job twice for the same period, or not at all and then once late, must give the same result. Kubernetes says plainly that CronJob creation is approximate: in rare cases two Jobs, or none, are created for one schedule time. Write every job for that.
2. **Parameterised by the period, not by "now".** A job processes "the day 2026-10-20", passed in or derived from its scheduled time, so it can be re-run or backfilled for any period.
3. **One owner.** A team alias owns the job, and the alert for it routes to that team.
4. **UTC unless the business needs a zone.** Schedules are written in UTC. A job tied to local business hours names its IANA zone explicitly and avoids the daylight saving transition hours (see Time zones).
5. **Bounded.** Every job has a run-time deadline and a retry limit. A job never retries forever and never runs forever.
6. **No overlap by default.** A new run does not start while the previous one is still running, unless the job is designed for it and says so.
7. **Observable.** The key metric of a batch job is the last time it succeeded (Prometheus instrumentation guidance). Every job exposes or is measured by it, and an alert fires when it is too old.

## Kubernetes CronJob

The fields below are MUST unless marked SHOULD. The reasons are one line each; the full behaviour of every field is in [[patterns/kubernetes-jobs-and-cronjobs]].

| Field                                      | Rule                                                                                   | Why                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `metadata.name`                            | At most 52 characters, a DNS label                                                     | Job names (CronJob name plus 11 characters) are limited to 63                     |
| `spec.timeZone`                            | Set, for example `Etc/UTC`                                                             | Otherwise the control plane's zone applies, which you do not control              |
| `spec.schedule`                            | Five-field cron, no `CRON_TZ=` or `TZ=` prefix; spread minutes (not everything at `0`) | A zone inside the schedule fails validation; use `timeZone`                       |
| `spec.concurrencyPolicy`                   | `Forbid` by default; `Replace` or `Allow` only with a written reason                   | The default `Allow` lets runs overlap                                             |
| `spec.startingDeadlineSeconds`             | Set; proposed default 300 for jobs that run hourly or less often, never below 10       | Bounds missed runs; below 10 the CronJob may never be scheduled                   |
| `spec.successfulJobsHistoryLimit`          | Proposed default 3 (the Kubernetes default)                                            | Enough to debug                                                                   |
| `spec.failedJobsHistoryLimit`              | Proposed default 3 (the Kubernetes default is 1)                                       | Keeps the last few failures for debugging                                         |
| `jobTemplate.spec.backoffLimit`            | Set explicitly; proposed default 2                                                     | The default of 6 retries keeps a failing job busy for a long time                 |
| `jobTemplate.spec.activeDeadlineSeconds`   | Set on the **Job** spec, below the schedule interval                                   | Bounds the whole Job, retries included; a Pod-level deadline does not             |
| `jobTemplate.spec.ttlSecondsAfterFinished` | SHOULD be set when history limits are not enough, for example on Jobs created by hand  | History limits clean up only Jobs the CronJob created                             |
| Pod `restartPolicy`                        | `Never` unless a reason is recorded; `OnFailure` is the only other valid value         | `OnFailure` terminates the Pod at the back-off limit, removing the debug evidence |

`concurrencyPolicy` applies only to Jobs created by the same CronJob. Two CronJobs that touch the same data still need a lock in the data store (a lease row, an object generation precondition).

`startingDeadlineSeconds` MUST be set before a CronJob is ever suspended, because unsuspending without it starts the missed runs at once, and because a CronJob without it can stop scheduling for good after more than 100 missed schedules (both explained in [[patterns/kubernetes-jobs-and-cronjobs]]).

### Complete example

```yaml title="k8s/reports/cronjob-nightly-export.yaml"
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-export # at most 52 characters
  namespace: reports-prod
  labels:
    app.kubernetes.io/name: nightly-export
    app.kubernetes.io/instance: nightly-export-prod
    app.kubernetes.io/version: "2.3.0"
    app.kubernetes.io/component: batch
    app.kubernetes.io/part-of: reports
    app.kubernetes.io/managed-by: Helm
    team: team-reports
    cost-center: cc-2040
    environment: prod
  annotations:
    example.com/runbook: "https://runbooks.example.com/reports/nightly-export"
spec:
  schedule: "17 2 * * *" # 02:17 UTC, off the hour on purpose
  timeZone: "Etc/UTC"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 300 # proposed team default
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    metadata:
      labels:
        app.kubernetes.io/name: nightly-export
        app.kubernetes.io/instance: nightly-export-prod
        team: team-reports
        environment: prod
    spec:
      backoffLimit: 2 # proposed team default
      activeDeadlineSeconds: 3600 # whole Job, all retries; well below the 24 h interval
      template:
        metadata:
          labels:
            app.kubernetes.io/name: nightly-export
            app.kubernetes.io/instance: nightly-export-prod
            team: team-reports
            environment: prod
        spec:
          restartPolicy: Never
          serviceAccountName: nightly-export
          automountServiceAccountToken: false
          securityContext:
            runAsNonRoot: true
            runAsUser: 10001
            seccompProfile:
              type: RuntimeDefault
          containers:
            - name: export
              image: registry.example.com/reports/nightly-export@sha256:0000000000000000000000000000000000000000000000000000000000000000
              args: ["--period=yesterday", "--apply"]
              resources:
                requests:
                  cpu: 250m
                  memory: 256Mi
                limits:
                  memory: 256Mi
              securityContext:
                allowPrivilegeEscalation: false
                readOnlyRootFilesystem: true
                capabilities:
                  drop: ["ALL"]
```

The image digest is a placeholder. Change the namespace, labels, runbook URL and registry to your own. If the job needs cloud access, give its ServiceAccount Workload Identity rather than a key, and set `automountServiceAccountToken` to what that setup requires. The rest of the Pod rules come from [[kubernetes-workload-baseline-standard]] and the labels from [[kubernetes-labels-and-annotations-standard]].

Validate before merging:

```bash title="Validate a CronJob manifest"
kubectl apply --dry-run=server -f k8s/reports/cronjob-nightly-export.yaml
kubectl -n reports-prod get cronjob nightly-export \
  -o jsonpath='{.spec.timeZone} {.spec.concurrencyPolicy} {.spec.startingDeadlineSeconds}{"\n"}'
```

## Cloud Scheduler

Cloud Scheduler calls an HTTP endpoint or publishes to Pub/Sub on a schedule. It differs from a CronJob in one important way: the [Cloud Scheduler API definition](https://github.com/googleapis/googleapis/blob/master/google/cloud/scheduler/v1/job.proto) (the `schedule` field, read 2026-10-21) says it never allows two simultaneously outstanding executions of a job, and a run that falls due while the previous one is still outstanding is delayed until it finishes. Overlap protection is therefore built in, but the target must still be idempotent, because retries resend the same request.

| Setting                          | Rule                                                                                                     | What the API says                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `--time-zone`                    | Set explicitly (`Etc/UTC` or a business zone)                                                            | Default is UTC; daylight saving follows the zone's rules                                                                        |
| `--attempt-deadline` (HTTP)      | Set to the handler's real worst case plus margin                                                         | Default 3 minutes, allowed 15 seconds to 30 minutes; an attempt that has not answered by then is cancelled and counts as failed |
| `--max-retry-attempts`           | Proposed default 3 for idempotent targets, 0 for targets that are not                                    | Default 0 (no retry, the next scheduled run still happens); more than 5 is not allowed by the API                               |
| `--min-backoff`, `--max-backoff` | Set so retries finish well before the next scheduled run                                                 | Defaults 5 s and 3600 s; retries stop at the retry count or at the next scheduled start, whichever comes first                  |
| Auth                             | OIDC with a dedicated service account for anything not on `*.googleapis.com`; OAuth only for Google APIs | At most one of OIDC or OAuth; the OIDC audience defaults to the target URI; the service account must be in the job's project    |

The person or pipeline that creates the job needs `iam.serviceAccounts.actAs` on the invoker service account. Long jobs do not belong behind a 30-minute HTTP deadline: have the handler start the work (a Cloud Run job, a Kubernetes Job, a Workflows execution) and answer quickly, as described in [[architecture/batch-and-scheduled-workloads-gcp]].

```bash title="Create a Cloud Scheduler HTTP job with OIDC"
PROJECT_ID="example-reports-prod"   # change: your project
LOCATION="europe-west1"             # change: a region where Cloud Scheduler is available to you
JOB="nightly-export"
TARGET_URL="https://reports.example.com/tasks/nightly-export"   # change: your handler
INVOKER_SA="scheduler-invoker@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud scheduler jobs create http "${JOB}" \
  --project="${PROJECT_ID}" \
  --location="${LOCATION}" \
  --schedule="17 2 * * *" \
  --time-zone="Etc/UTC" \
  --uri="${TARGET_URL}" \
  --http-method=post \
  --headers="Content-Type=application/json" \
  --message-body='{"period":"yesterday"}' \
  --oidc-service-account-email="${INVOKER_SA}" \
  --oidc-token-audience="${TARGET_URL}" \
  --attempt-deadline=300s \
  --max-retry-attempts=3 \
  --min-backoff=30s \
  --max-backoff=600s \
  --description="Nightly export, owner team-reports, runbook https://runbooks.example.com/reports/nightly-export"

gcloud scheduler jobs describe "${JOB}" --project="${PROJECT_ID}" --location="${LOCATION}"
```

Manage Cloud Scheduler jobs with Terraform in production; the command above shows the settings that matter.

> [!warning] Not verified
> Which IAM role the target needs (for example an invoker role on a Cloud Run service), whether the Cloud Scheduler service agent needs an extra token-creator role in your setup, Cloud Scheduler quotas and pricing, which HTTP status codes count as success, and the exact log and metric names for job attempts were not checked for this note. Read the Cloud Scheduler authentication and monitoring pages before relying on them.

## GitLab pipeline schedules

A pipeline schedule runs a pipeline for a branch or tag at set times. Two properties shape the rules:

- **A schedule runs as its owner.** The person who creates it becomes the owner, and the pipeline runs with the owner's permissions, including access to protected environments and the CI job token at that access level. If the owner is blocked or removed, the schedule becomes inactive. A Maintainer can take ownership.
- **Schedules are not punctual.** A background worker queues them. On self-managed GitLab the default worker runs every ten minutes, and many schedules due at the same time can start several minutes to over an hour late. The GitLab docs advise staggering schedules and avoiding `0 * * * *`.

Rules:

- The schedule owner MUST be a long-lived account the team controls, with a documented handover when the person leaves (a proposed team policy). A schedule that silently goes inactive when someone changes jobs is the most common failure.
- Schedules that deploy or touch production MUST run on a protected branch, so protected variables and environments apply. Protected CI/CD variables are available only to pipelines on protected branches or tags.
- Jobs MUST select themselves with `rules` on the pipeline source, and a schedule variable (or input) names the task, so one project can carry several schedules without every scheduled pipeline running every job.
- Scheduled jobs MUST set `timeout` and, when two runs must not overlap, `resource_group`.
- Prefer inputs over schedule variables for configuration where your GitLab version supports them (the docs recommend inputs; they were introduced in 17.11, check your version).

```yaml title=".gitlab-ci.yml"
nightly-cleanup:
  stage: maintenance
  image: registry.example.com/ci/ops-tools@sha256:0000000000000000000000000000000000000000000000000000000000000000
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule" && $SCHEDULED_TASK == "nightly-cleanup"
  resource_group: nightly-cleanup # one run at a time
  timeout: 30m
  interruptible: false
  script:
    - ./scripts/cleanup.sh --period yesterday
```

Audit schedules from code, read-only:

```bash title="List inactive pipeline schedules and their owners"
GITLAB_URL="https://gitlab.example.com"
PROJECT_ID="1234"   # change: numeric project ID or URL-encoded path
# $GITLAB_TOKEN is a read-only token; the header is passed through a file
# descriptor so the token does not appear in the process list.
curl -sS -K <(printf 'header = "PRIVATE-TOKEN: %s"\n' "$GITLAB_TOKEN") \
  "${GITLAB_URL}/api/v4/projects/${PROJECT_ID}/pipeline_schedules?scope=inactive" \
  | jq -r '.[] | [.id, .description, .cron, .cron_timezone, .owner.username] | @tsv'
```

> [!note] Not verified
> GitLab.com values for the schedule worker frequency and the number of schedules per project (the self-managed default limit is 10) were not checked. The extended cron syntax GitLab accepts may not be accepted by other cron testers; keep to plain five-field cron.

## Jenkins cron triggers

- Use the `H` (hash) token, never fixed minutes. `H` takes a value hashed from the job name, so the time is stable per job but spread across jobs. `0 0 * * *` on a dozen jobs makes a spike at midnight; `H H * * *` does not. Use a range when the job must run in a window: `H H(1-4) * * *`.
- Avoid `*/N` or `H/N` in the day-of-month field: the Jenkins docs warn that it is inconsistent near the end of a month.
- `@midnight` and the other aliases also use the hash, so `@midnight` means some time between 00:00 and 02:59.
- Set `disableConcurrentBuilds()` (queues the new build) or `disableConcurrentBuilds(abortPrevious: true)` (aborts the running one) and a pipeline `timeout`.

```groovy title="Jenkinsfile"
pipeline {
  agent { label 'ops' }
  triggers { cron('H H(1-4) * * *') }
  options {
    disableConcurrentBuilds()
    timeout(time: 1, unit: 'HOURS')
    buildDiscarder(logRotator(numToKeepStr: '30')) // proposed team default
  }
  stages {
    stage('Cleanup') {
      steps {
        sh './scripts/cleanup.sh --period yesterday'
      }
    }
  }
}
```

The time zone the controller uses for cron triggers and per-job time zone syntax were not checked for this note; read the cron help on the job configuration page of your Jenkins version.

## Host jobs and locks

Host cron and systemd timers are the last choice, for work that must run on a specific machine. They MUST take a lock so a slow run cannot overlap the next one, and they follow [[bash-scripts]] for everything else.

```text title="/etc/cron.d/nightly-backup"
# m  h dom mon dow user   command
17   2  *   *   *  backup /usr/bin/flock -n -E 3 /run/lock/nightly-backup.lock /usr/local/bin/nightly-backup.sh
```

`flock -n` fails at once instead of waiting when another run holds the lock, and `-E 3` makes that case exit with code 3 so monitoring can tell "skipped because still running" from a real failure (code 1). Document the code in the script header, as [[bash-scripts]] requires. The lock is held until the file descriptor closes, so it is released when the command exits. A `flock` lock protects one host only; two hosts running the same job need a lock in the shared store.

## Time zones

- Store and display schedules in UTC by default. Write the zone in the job description so a reader does not have to guess.
- A business-zone schedule names an IANA zone (`Europe/Kyiv`, `America/New_York`), never an abbreviation or an offset.
- In zones with daylight saving time, local times in the transition hour are skipped once and repeated once a year. How each scheduler treats those times was not verified for this note, so do not schedule business-zone jobs between 01:00 and 03:00 local time, and make jobs idempotent in case they run twice.

## Monitoring and alerts

Every scheduled job has two alerts: **it failed**, and **it has not succeeded for too long**. The second one catches what the first cannot: a job that was never started (suspended, owner removed, controller problem, too many missed starts).

For CronJobs, kube-state-metrics exposes the data. Metrics marked stable in its documentation (read 2026-10-21) include `kube_cronjob_status_last_successful_time`, `kube_cronjob_status_last_schedule_time`, `kube_cronjob_next_schedule_time`, `kube_cronjob_status_active` and `kube_cronjob_spec_suspend`; Job metrics include `kube_job_failed` and `kube_job_status_active`. The community kubernetes-mixin alerts cover failed and long-running Jobs but have **no missed-run alert**, so add one.

```yaml title="prometheus/rules/scheduled-jobs.yaml"
groups:
  - name: scheduled-jobs
    rules:
      # Daily job: no success for 26 hours (a proposed team default: interval plus a 2 h margin).
      - alert: CronJobNoRecentSuccess
        expr: |
          time() - kube_cronjob_status_last_successful_time{namespace="reports-prod", cronjob="nightly-export"}
            > 26 * 3600
        for: 10m
        labels:
          severity: ticket
          team: team-reports
        annotations:
          summary: "{{ $labels.namespace }}/{{ $labels.cronjob }} has not succeeded for over 26 hours"
          runbook_url: "https://runbooks.example.com/reports/nightly-export"
      # Suspended for more than a day: a pause someone forgot to undo.
      - alert: CronJobSuspendedTooLong
        expr: kube_cronjob_spec_suspend{namespace="reports-prod"} == 1
        for: 24h
        labels:
          severity: ticket
          team: team-reports
        annotations:
          summary: "{{ $labels.namespace }}/{{ $labels.cronjob }} has been suspended for 24 hours"
          runbook_url: "https://runbooks.example.com/reports/nightly-export"
      # A failed Job of this namespace (same idea as the mixin's KubeJobFailed).
      - alert: ScheduledJobFailed
        expr: kube_job_failed{namespace="reports-prod"} > 0
        for: 15m
        labels:
          severity: ticket
          team: team-reports
        annotations:
          summary: "Job {{ $labels.namespace }}/{{ $labels.job_name }} failed"
          runbook_url: "https://runbooks.example.com/reports/nightly-export"
```

> [!warning] Team example, not run
> These rules are team examples, not vendor text, and were not run against a live Prometheus. A CronJob that has never succeeded has no `last_successful_time` value, so `CronJobNoRecentSuccess` stays silent for it; pair it with an `absent()` rule or a check at deploy time. The failed-Job alert stays firing until the failed Job is deleted or ages out of the history. Confirm metric and label names against the kube-state-metrics version you run; some CronJob metrics are marked experimental.

**Heartbeat for everything else.** Cloud Scheduler targets, GitLab and Jenkins jobs and host jobs record their own last success. The job pushes a `last_success_timestamp_seconds` gauge at the very end, only on success, to a Pushgateway (built for batch jobs) or writes the equivalent custom metric, and the alert compares it with `time()`:

```bash title="End of a successful run: push a heartbeat"
PUSHGATEWAY_URL="https://pushgateway.example.com"   # change: your Pushgateway
JOB_NAME="nightly_backup"
cat <<EOF | curl -sS --fail --data-binary @- "${PUSHGATEWAY_URL}/metrics/job/${JOB_NAME}"
# TYPE last_success_timestamp_seconds gauge
last_success_timestamp_seconds $(date +%s)
EOF
```

Severity follows [[alert-and-runbook-standard]] and [[adr/0045-page-only-on-slo-burn-rate]]: a missed run is usually a ticket. It pages only when the job is on the critical path of an SLO (a backup whose absence breaks a recovery point, a certificate renewal close to expiry). Use the metric names from [[metrics-naming-and-cardinality-standard]] for anything the job exports itself, and never put the run date or run ID in a label.

## Pause, manual run and backfill

Keep these commands in the job's runbook, with the real names filled in.

```bash title="Kubernetes CronJob operations"
NS="reports-prod"
CJ="nightly-export"

# Pause. Set startingDeadlineSeconds first, or unsuspending starts every missed run at once.
kubectl -n "$NS" patch cronjob "$CJ" -p '{"spec":{"suspend":true}}'

# Resume.
kubectl -n "$NS" patch cronjob "$CJ" -p '{"spec":{"suspend":false}}'

# Run now with the CronJob's own template. The Job name must fit in 63 characters.
kubectl -n "$NS" create job "${CJ}-manual-$(date -u +%Y%m%d%H%M)" --from=cronjob/"$CJ"
kubectl -n "$NS" get jobs --watch

# Backfill a specific period: --from cannot be combined with a command, so render the
# Job, change the period argument, review it and apply it.
kubectl -n "$NS" create job "${CJ}-backfill-20261019" --from=cronjob/"$CJ" \
  --dry-run=client -o yaml > backfill.yaml
"${EDITOR:-vi}" backfill.yaml   # set args to --period=2026-10-19
kubectl apply --dry-run=server -f backfill.yaml && kubectl apply -f backfill.yaml
```

```bash title="Cloud Scheduler, GitLab and Jenkins equivalents"
# Cloud Scheduler
gcloud scheduler jobs pause  "$JOB" --project="$PROJECT_ID" --location="$LOCATION"
gcloud scheduler jobs resume "$JOB" --project="$PROJECT_ID" --location="$LOCATION"
gcloud scheduler jobs run    "$JOB" --project="$PROJECT_ID" --location="$LOCATION"

# GitLab: deactivate a schedule, run it now (needs a token with write access, used by a maintainer)
# --fail-with-body: a 401, 403 or 404 exits non-zero instead of looking like success
curl -sS --fail-with-body -X PUT -K <(printf 'header = "PRIVATE-TOKEN: %s"\n' "$GITLAB_TOKEN") \
  --form "active=false" "${GITLAB_URL}/api/v4/projects/${PROJECT_ID}/pipeline_schedules/${SCHEDULE_ID}"
curl -sS --fail-with-body -X POST -K <(printf 'header = "PRIVATE-TOKEN: %s"\n' "$GITLAB_TOKEN") \
  "${GITLAB_URL}/api/v4/projects/${PROJECT_ID}/pipeline_schedules/${SCHEDULE_ID}/play"

# Jenkins: disable the job or start it with parameters from the job page, or through
# your configuration-as-code repository.
```

A manual GitLab run (**Run** in the UI or the `play` endpoint) uses the permissions of the person who starts it, not the owner's, and is limited to once per minute.

Backfill rules:

- A backfill is a change. A backfill that writes to production follows [[production-change-checklist]] and, during a freeze, [[change-freezes-and-maintenance-windows]].
- Run backfills one period at a time, oldest first, with the job's normal concurrency rule. Do not start fifty Jobs at once against one database.
- Record what was backfilled, by whom and why, in the job's ticket.

A scheduled job that changes production on its own (cleanups, scaling, rotations) is a standing change: it is reviewed once when it is created or changed, and the freeze calendar states whether it keeps running during a freeze.

## Troubleshooting

| Symptom                                        | Check                                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| CronJob never creates Jobs                     | `kubectl -n "$NS" describe cronjob "$CJ"` for events such as `too many missed start times`; check `suspend` and `startingDeadlineSeconds` |
| CronJob runs at the wrong hour                 | `timeZone` missing, so the controller's zone is used; or a business zone across a daylight saving change                                  |
| Job created but Pods never start               | Pod events: quota, image pull, admission policy; see [[kubernetes-pod-troubleshooting]]                                                   |
| Job marked failed with no failed Pod           | `activeDeadlineSeconds` reached; `kubectl -n "$NS" get job <job> -o jsonpath='{.status.conditions}'` shows the reason                     |
| Two runs at once                               | `concurrencyPolicy` is `Allow`, or two schedulers (a CronJob and a GitLab schedule) run the same task                                     |
| Cloud Scheduler attempts fail at the same time | The handler is slower than `attempt-deadline`; move the work to an asynchronous job                                                       |
| GitLab schedule stopped running                | The schedule is inactive because its owner was blocked or removed; take ownership and fix the owner account                               |

## Exceptions

A job that cannot meet a rule (a vendor job without a deadline setting, a host job without a lock) records the rule, the reason, a compensating control, an owner and an expiry date (proposed default 90 days) through [[policy-exception-and-waiver-process]]. Missing alerts and an owner who is a single person are not accepted as exceptions.

## Reviewer checklist

- [ ] The job is idempotent and takes the period as a parameter; a re-run for the same period is safe.
- [ ] Owner is a team alias; the alert routes to it; the runbook has pause, run and backfill commands.
- [ ] CronJob: name at most 52 characters, `timeZone`, `concurrencyPolicy: Forbid` (or a reason), `startingDeadlineSeconds` of at least 10, history limits, `backoffLimit`, Job-level `activeDeadlineSeconds`, `restartPolicy: Never`.
- [ ] Cloud Scheduler: explicit time zone, attempt deadline, retry count of 0 for non-idempotent targets, OIDC with a dedicated service account.
- [ ] GitLab: owner is a long-lived team-controlled account, protected branch for production, `rules` on the pipeline source, `timeout` and `resource_group`.
- [ ] Jenkins: `H` in the cron spec, `disableConcurrentBuilds()`, `timeout`.
- [ ] Host jobs: `flock -n` with a documented exit code.
- [ ] Schedules avoid the top of the hour and, in business zones, the daylight saving transition hours.
- [ ] A failure alert and a no-recent-success alert exist and were tested by pausing the job in a non-production environment.

## Sources

Checked 2026-10-21 against the documentation sources (the upstream repositories of these pages and, for Cloud Scheduler, the API definitions and `gcloud` help):

- [Kubernetes: CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/): name limit, `timeZone`, unsupported `CRON_TZ`, `concurrencyPolicy`, `startingDeadlineSeconds`, 100 missed schedules, suspend, history limits, idempotency.
- [Kubernetes: Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/): `backoffLimit`, `activeDeadlineSeconds`, `restartPolicy`, suspend.
- [Kubernetes: Automatic cleanup for finished Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/)
- [Kubernetes: Running automated tasks with a CronJob](https://kubernetes.io/docs/tasks/job/automated-tasks-with-cron-jobs/)
- [kube-state-metrics: CronJob metrics](https://github.com/kubernetes/kube-state-metrics/blob/main/docs/metrics/workload/cronjob-metrics.md)
- [kubernetes-mixin: apps alerts](https://github.com/kubernetes-monitoring/kubernetes-mixin/blob/master/alerts/apps_alerts.libsonnet)
- [Prometheus: Instrumentation, batch jobs](https://prometheus.io/docs/practices/instrumentation/#batch-jobs)
- [Prometheus Pushgateway](https://github.com/prometheus/pushgateway)
- [Cloud Scheduler: Retry jobs](https://cloud.google.com/scheduler/docs/configuring/retry-jobs), [authentication with HTTP targets](https://cloud.google.com/scheduler/docs/http-target-auth), [cron job schedules](https://cloud.google.com/scheduler/docs/configuring/cron-job-schedules) and the [Cloud Scheduler API definition](https://github.com/googleapis/googleapis/blob/master/google/cloud/scheduler/v1/job.proto)
- [GitLab: Scheduled pipelines](https://docs.gitlab.com/ci/pipelines/schedules/) and [Pipeline schedules API](https://docs.gitlab.com/api/pipeline_schedules/)
- [Jenkins: Pipeline syntax, cron syntax](https://www.jenkins.io/doc/book/pipeline/syntax/#cron-syntax)
- [flock(1)](https://man7.org/linux/man-pages/man1/flock.1.html)

## Related

- [[patterns/kubernetes-jobs-and-cronjobs]]: how to build reliable Jobs and CronJobs, field by field.
- [[architecture/batch-and-scheduled-workloads-gcp]]: Cloud Scheduler, Cloud Run jobs and other batch options on Google Cloud.
- [[python-ops-scripts-standard]] and [[bash-scripts]]: what the job's code must look like.
- [[kubernetes-workload-baseline-standard]]: Pod rules the CronJob template inherits.
- [[ci-pipeline-standard]] and [[gitlab-ci-pipeline-structure]]: where scheduled CI jobs live.
- [[timeouts-retries-load-shedding]]: retry and deadline principles.
