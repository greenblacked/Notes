---
title: Reliable Kubernetes Jobs and CronJobs
description: Configure Jobs and CronJobs so batch work retries sensibly, never runs twice by surprise, finishes with sidecars, and alerts on failed or missed runs.
type: pattern
tags:
  - patterns
  - kubernetes
  - gke
  - reliability
  - observability
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Batch workloads fail quietly. A Deployment that crashes shows up in every dashboard; a nightly CronJob that stopped being scheduled three weeks ago shows up when someone asks where last month's report went. The usual causes are a handful of fields left at their defaults (`backoffLimit`, `concurrencyPolicy`, `startingDeadlineSeconds`), a proxy sidecar that keeps the Pod alive after the work is done, and no alert on "the last successful run is too old". This note gives a working baseline for all of them.

> [!info] Not checked against a live cluster
> The Kubernetes fields, defaults and feature versions below were read from the upstream Kubernetes documentation on 2026-10-21; nothing was run on a cluster. The Cloud SQL Auth Proxy flags come from the proxy's README and source on the same date. GKE-specific behaviour (which GKE versions ship each feature, Spot node labels and taints, Autopilot rules, the GKE how-to for the Auth Proxy) is **not verified**: check the GKE docs for your release channel. The PromQL alerts are derived from the kube-state-metrics metric definitions, not taken from a documented example: test them in your Prometheus.

## Job, CronJob or a worker Deployment

| Workload shape                                                         | Use                                                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Runs to completion, triggered by a deploy or a human (migration, backfill) | A `Job`                                                                                   |
| Runs to completion on a schedule (report, cleanup, export)             | A `CronJob`                                                                               |
| Works through a fixed set of N shards                                  | An Indexed `Job` (`completionMode: Indexed`)                                              |
| Consumes a queue continuously, latency matters                         | A `Deployment` worker with autoscaling, see [[kubernetes-autoscaling]]                    |
| Runs every minute or more often, keeps state between runs               | Usually a `Deployment` with an internal loop: CronJob scheduling has seconds of jitter and per-run Pod start cost |

Two semantics drive every design decision below:

- **At least once, sometimes twice.** The Job docs state that even with `parallelism: 1`, `completions: 1` and `restartPolicy: Never`, the same program may sometimes be started twice. The CronJob docs say a schedule can create two Jobs, or none, for one occurrence. The work must be **idempotent**: upserts instead of inserts, a run key (date or window) recorded in the target, "write to temp then rename" for files.
- **Concurrency is your problem.** With `parallelism` above 1, or with `concurrencyPolicy: Allow`, Pods of the same logical task run at the same time. Lock on the run key (an advisory lock in Postgres, a conditional write in a bucket) if two copies must not overlap.

## Job fields that matter

```yaml title="job-baseline.yaml (fragment)"
apiVersion: batch/v1
kind: Job
spec:
  backoffLimit: 3 # default 6
  activeDeadlineSeconds: 3600 # whole-Job wall clock, wins over backoffLimit
  ttlSecondsAfterFinished: 86400 # delete the finished Job and its Pods after a day
  podFailurePolicy:
    rules:
      - action: FailJob # a known non-retriable failure: stop now
        onExitCodes:
          containerName: main
          operator: In
          values: [42]
      - action: Ignore # node drain or preemption: retry without counting it
        onPodConditions:
          - type: DisruptionTarget
  template:
    spec:
      restartPolicy: Never # required by podFailurePolicy
```

| Field                     | Default and behaviour (Kubernetes docs, 2026-10-21)                                                                                                                                                       | Recommendation                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `backoffLimit`            | 6. Failed Pods are recreated with exponential back-off (10s, 20s, 40s and so on), capped at ten minutes. Defaults to MaxInt32 when `backoffLimitPerIndex` is set.                                         | 2 to 4 for most work. Six retries with back-off can hide a broken run for well over half an hour.                          |
| `activeDeadlineSeconds`   | Unset. When reached, running Pods are terminated and the Job fails with reason `DeadlineExceeded`. Takes precedence over `backoffLimit`. The field also exists on the Pod spec: set it on the Job spec. | Always set it, to about two to three times the normal run time. It is the guard against a hung run blocking the next one. |
| `podFailurePolicy`        | Unset. Needs `restartPolicy: Never`. Rules are evaluated in order, first match wins. Actions: `FailJob`, `Ignore`, `Count`, `FailIndex`. Stable since Kubernetes v1.31.                                    | Fail fast on exit codes that mean "bad input, retrying will not help"; `Ignore` the `DisruptionTarget` condition.         |
| `ttlSecondsAfterFinished` | Unset means the TTL controller never deletes the Job. `0` deletes it right after it finishes. Deletion cascades to the Pods. Stable since v1.23.                                                          | Set it on standalone Jobs. On CronJobs the history limits already clean up; a TTL shorter than your debugging window destroys the evidence. |
| `restartPolicy`           | `Never` or `OnFailure` for Jobs. With `OnFailure` the Pod is terminated once the back-off limit is reached, which can hide the logs of the last attempt.                                                | `Never`: every attempt is its own Pod with its own logs, and `podFailurePolicy` works.                                   |
| `completions`, `parallelism` | One completion, one Pod by default.                                                                                                                                                                   | Raise `parallelism` only when the work is safe to run concurrently.                                                      |
| `completionMode: Indexed` | Each Pod gets `JOB_COMPLETION_INDEX` (0 to completions minus 1) as an environment variable and an annotation. Stable since v1.24.                                                                         | Static sharding: index N processes shard N. Combine with `backoffLimitPerIndex` (stable since v1.33) so one bad shard does not fail the rest. |

Exit codes are a contract between the job code and the Job spec. Pick one code (42 in the docs' example) that means "permanent failure, do not retry", document it next to the job, and keep everything else retriable.

## CronJob fields that matter

| Field                        | Default and behaviour (Kubernetes docs, 2026-10-21)                                                                                                                                                                                  | Recommendation                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `schedule`                   | Five-field cron, step values, `?` equals `*`, and macros such as `@daily`.                                                                                                                                                            | Avoid the top of the hour if many jobs share a cluster or a database; spread them.                                 |
| `timeZone`                   | An IANA name such as `Etc/UTC` or `Europe/Kyiv`. Without it the schedule follows the kube-controller-manager's local time zone. `CRON_TZ=` or `TZ=` inside `schedule` fails validation. Stable since v1.27.                            | Always set it. Never depend on the control plane's time zone, which you do not control on a managed cluster.       |
| `concurrencyPolicy`          | `Allow` (default), `Forbid` or `Replace`. With `Forbid` a run that is skipped because the previous one is still running counts as missed. Applies only between Jobs of the same CronJob.                                               | `Forbid` for almost everything. `Replace` only when the newest run makes the older one useless.                   |
| `startingDeadlineSeconds`    | Unset. A Job that cannot start within this many seconds of its scheduled time is skipped. Values under 10 may stop the CronJob from scheduling at all, because the controller checks every 10 seconds.                                | Set it, for example to 10 to 30 percent of the interval. Without it, a long outage counts missed runs from the last schedule time (see below). |
| `successfulJobsHistoryLimit` | 3                                                                                                                                                                                                                                      | Keep the default or lower.                                                                                         |
| `failedJobsHistoryLimit`     | 1                                                                                                                                                                                                                                      | Raise to 3 to 5, so a failing streak keeps its Pods and logs for comparison.                                       |
| `suspend`                    | `false`. Suspending does not affect Jobs that are already running. Runs skipped while suspended count as missed; unsuspending a CronJob **without** a starting deadline starts the missed runs immediately.                              | Set `startingDeadlineSeconds` before you ever suspend in production.                                               |

Two more rules from the CronJob docs:

- **Name length.** A CronJob name can be at most 52 characters, because the controller appends 11 characters to form Job names, which are limited to 63.
- **The 100 missed schedules rule.** If the controller counts more than 100 missed schedules, it does not start the Job and logs `too many missed start times. Set or decrease .spec.startingDeadlineSeconds or check clock skew`. Without `startingDeadlineSeconds` it counts from the last schedule time, so an every-minute CronJob that was blocked for two hours never starts again on its own. With the deadline set, only misses inside the deadline window count, and scheduling resumes. This is the single most common "the CronJob silently stopped" cause.

Editing a CronJob affects only Jobs created after the edit; running Jobs keep the old template.

## Sidecars that let the Job finish

A Job completes when its Pods succeed, and a Pod succeeds when all of its regular containers exit. A classic sidecar (Cloud SQL Auth Proxy, a service mesh proxy, a log shipper) never exits, so the Job hangs in `Running` until `activeDeadlineSeconds` kills it and marks it failed.

**Native sidecars** fix this. Declare the sidecar as an `initContainers` entry with `restartPolicy: Always`. Kubernetes starts it before the main container, keeps it running, and terminates it after the main containers exit; the docs state explicitly that such a sidecar does not prevent a Job from completing. Native sidecars are stable since Kubernetes v1.33 (beta and on by default from v1.29). Check that your GKE version has them before relying on this.

Notes on native sidecars:

- Sidecars start in init order and can have startup, readiness and liveness probes. A startup probe on the proxy makes the main container wait until the proxy listens.
- A non-zero exit code from a sidecar during Pod termination is normal and does not fail the Pod.
- The Pod's effective resource request includes the sidecar. Size it: see [[kubernetes-resource-requests-and-limits]].
- The Pod-level `restartPolicy: Never` stays; `restartPolicy: Always` is set on the sidecar container only.

On a cluster without native sidecars, the old workaround is to start the Auth Proxy with `--quitquitquit` (an admin server on localhost, port 9091 by default, changed with `--admin-port`) and have the main container call `curl -X POST localhost:9091/quitquitquit` in a `trap` on exit. It works, but every job image now needs curl and the trap, and a killed main container skips it. Prefer native sidecars.

For heavy parallel Jobs against Postgres, put a pooler in front of the database rather than giving each Pod its own pool; see [[postgres-connection-pooling-gke]].

## Scheduling: priority and Spot

- **Priority.** Give batch a non-preempting class (`preemptionPolicy: Never`): it queues ahead of lower priority Pods but never evicts running services. The tier set is in [[priority-classes-and-preemption]].
- **Disruptions.** Batch Pods are evicted by node upgrades, scale-down and preemption. The `Ignore` rule on `DisruptionTarget` above keeps those evictions out of the `backoffLimit` count, so a node drain does not fail a Job that did nothing wrong.
- **Spot capacity.** Interruptible Jobs on Spot nodes are a good cost fit when they checkpoint progress and are idempotent. The GKE Spot node label, taint and the Autopilot equivalent are **not verified** here; take them from the GKE Spot VMs page and check them with `kubectl get nodes --show-labels` and `kubectl describe node`. Never put a long, non-checkpointing run on Spot with `backoffLimit: 0`.

## A complete nightly CronJob

A nightly export that reads Cloud SQL through the Auth Proxy as a native sidecar, uses Workload Identity (no key file, see [[gke-workload-identity]]), is non-preempting, refuses overlapping runs, and cleans up after itself.

```yaml title="nightly-export.yaml"
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-export
  namespace: reports
  labels:
    app.kubernetes.io/name: nightly-export
spec:
  schedule: "17 2 * * *" # 02:17, off the top of the hour
  timeZone: "Etc/UTC"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 1800 # skip the run if it cannot start within 30 minutes
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  suspend: false
  jobTemplate:
    metadata:
      labels:
        app.kubernetes.io/name: nightly-export
    spec:
      backoffLimit: 2
      activeDeadlineSeconds: 7200
      podFailurePolicy:
        rules:
          - action: FailJob
            onExitCodes:
              containerName: export
              operator: In
              values: [42]
          - action: Ignore
            onPodConditions:
              - type: DisruptionTarget
      template:
        metadata:
          labels:
            app.kubernetes.io/name: nightly-export
        spec:
          restartPolicy: Never
          serviceAccountName: nightly-export # bound to a Google service account through Workload Identity
          priorityClassName: batch # preemptionPolicy: Never, see the priority classes note
          terminationGracePeriodSeconds: 60
          securityContext:
            runAsNonRoot: true
            seccompProfile:
              type: RuntimeDefault
          initContainers:
            - name: cloud-sql-proxy
              # Mirror the image into your own registry and pin it by digest.
              # Upstream: gcr.io/cloud-sql-connectors/cloud-sql-proxy (see the proxy README for the current tag).
              image: registry.example.com/mirror/cloud-sql-proxy@sha256:REPLACE_WITH_MIRRORED_DIGEST
              restartPolicy: Always # native sidecar: does not block Job completion
              args:
                - "--private-ip"
                - "--port=5432"
                - "--auto-iam-authn" # IAM database login, no password in the Pod
                - "example-project:europe-west1:reports-db"
              startupProbe:
                tcpSocket:
                  port: 5432
                periodSeconds: 2
                failureThreshold: 30
              resources:
                requests:
                  cpu: 50m
                  memory: 64Mi
                limits:
                  memory: 128Mi
              securityContext:
                allowPrivilegeEscalation: false
                readOnlyRootFilesystem: true
                capabilities:
                  drop: ["ALL"]
          containers:
            - name: export
              image: registry.example.com/reports/nightly-export@sha256:REPLACE_WITH_BUILD_DIGEST
              env:
                - name: DB_HOST
                  value: "127.0.0.1"
                - name: DB_PORT
                  value: "5432"
                - name: DB_USER
                  value: "nightly-export@example-project.iam" # IAM database user for the Google service account
              resources:
                requests:
                  cpu: 500m
                  memory: 512Mi
                limits:
                  memory: 1Gi
              securityContext:
                allowPrivilegeEscalation: false
                readOnlyRootFilesystem: true
                capabilities:
                  drop: ["ALL"]
```

What to change, and why:

- `example-project:europe-west1:reports-db` is the instance connection name (`project:region:instance`); take it from `gcloud sql instances describe`.
- The two `REPLACE_WITH_...` digests must be real digests from your registry; deploying by digest is the site rule ([[0010-deploy-images-by-digest]]).
- `--private-ip` assumes the cluster reaches the instance's private IP; drop it for public IP with the proxy's IAM authorisation. `--auto-iam-authn` needs an IAM database user for the Google service account and the Cloud SQL roles that allow it to connect and log in; the role names and the IAM user name format for Postgres are in the Cloud SQL IAM database authentication docs (**not verified** here).
- The job code derives its run key (for example the UTC date of the window it exports), never "now" alone, so a retry or a duplicate start writes to the same key. Starting with Kubernetes v1.32, Jobs created by a CronJob carry the `batch.kubernetes.io/cronjob-scheduled-timestamp` annotation with the scheduled time, which a job with API access can read.

## Alerting on failed and missed runs

kube-state-metrics exposes what you need. Metric names below are from its documentation on 2026-10-21 and are marked stable there; the names can change between releases, so check them against the version you run.

| Metric                                       | Labels                              | Use                                                         |
| -------------------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| `kube_cronjob_status_last_successful_time`   | `namespace`, `cronjob`              | Staleness: the last run that succeeded.                     |
| `kube_cronjob_status_last_schedule_time`     | `namespace`, `cronjob`              | The controller is still scheduling.                         |
| `kube_cronjob_spec_suspend`                  | `namespace`, `cronjob`              | Someone suspended it and forgot.                            |
| `kube_cronjob_next_schedule_time`            | `namespace`, `cronjob`              | Expected next run.                                          |
| `kube_job_failed`                            | `namespace`, `job_name`, `condition` | A Job reached the Failed condition (`condition="true"`).    |
| `kube_job_status_active`                     | `namespace`, `job_name`             | Pods still running, for "running too long" alerts.          |
| `kube_job_owner`                             | `job_name`, `owner_kind`, `owner_name` | Maps a Job back to its CronJob.                          |

```yaml title="prometheus-rules-batch.yaml (derived, test before use)"
groups:
  - name: batch-jobs
    rules:
      - alert: CronJobNoRecentSuccess
        # Daily job: page if there was no success in 26 hours.
        expr: |
          time() - kube_cronjob_status_last_successful_time{namespace="reports", cronjob="nightly-export"} > 26 * 3600
        for: 15m
        labels:
          severity: page
        annotations:
          summary: "{{ $labels.namespace }}/{{ $labels.cronjob }} has not succeeded in 26 hours"
          runbook: "https://notes.example.com/runbooks/kubernetes-pod-troubleshooting"
      - alert: CronJobSuspended
        expr: kube_cronjob_spec_suspend == 1
        for: 24h
        labels:
          severity: ticket
      - alert: JobFailed
        expr: |
          (kube_job_failed{condition="true"} == 1)
          * on (namespace, job_name) group_left(owner_name)
          kube_job_owner{owner_kind="CronJob"}
        for: 5m
        labels:
          severity: ticket
```

Design notes:

- **Staleness beats failure counting.** A CronJob that never starts produces no failed Job, so `JobFailed` stays silent. The "no recent success" alert catches failed runs, missed runs, a suspended CronJob, a broken schedule and a dead controller with one rule. Set the window per job from its interval plus its normal run time.
- A CronJob that has never succeeded has no `last_successful_time` series. Pair the staleness rule with a check that the series exists for every CronJob you care about, or alert on `kube_cronjob_info` without a matching success series.
- `JobFailed` stays true until the history limit deletes the Job. Route it as a ticket, not a page, or it will re-fire for as long as the failed Job is kept.
- Alert rule structure, severities and runbook links follow [[alert-and-runbook-standard]]; for PromQL details see [[promql-for-alert-rules-and-recording-rules]]. For batch work with an SLO (for example "the export lands by 06:00 on 99 percent of days"), the burn-rate approach in [[slo-burn-rate-alerting]] applies to the success ratio.

## Verify

```bash title="verify a CronJob"
NS=reports
CJ=nightly-export

# Spec as the API server stored it, including defaults.
kubectl -n "$NS" get cronjob "$CJ" -o yaml

# Last schedule and last success times.
kubectl -n "$NS" get cronjob "$CJ" \
  -o jsonpath='{.status.lastScheduleTime}{"  "}{.status.lastSuccessfulTime}{"\n"}'

# Trigger one run now from the CronJob's template (cannot be combined with a custom command).
kubectl -n "$NS" create job "${CJ}-manual-$(date +%Y%m%d%H%M)" --from=cronjob/"$CJ"

# Watch it and read the logs of both containers.
kubectl -n "$NS" get jobs --watch
kubectl -n "$NS" logs job/"${CJ}-manual-<suffix>" -c export
kubectl -n "$NS" logs job/"${CJ}-manual-<suffix>" -c cloud-sql-proxy

# Final state and failure reason.
kubectl -n "$NS" get job "${CJ}-manual-<suffix>" -o jsonpath='{.status.conditions}{"\n"}'
```

Replace `<suffix>` with the timestamp printed by `create job`. A manual Job created with `--from` is not managed by the CronJob controller, so it is not counted against `concurrencyPolicy` or the history limits (not verified in the Kubernetes docs; check your kubectl version). kubectl gives it a non-controller `ownerReferences` entry pointing at the CronJob and the annotation `cronjob.kubernetes.io/instantiate: manual`: inspect both with `kubectl get job <name> -o yaml`. The owner reference means deleting the CronJob also garbage-collects its manual Jobs. Delete the manual Job yourself when you are done.

Expected: the Job reaches `Complete`, the Pod shows the `export` container `Completed`, and the proxy sidecar terminated after it. On a test run, also check idempotency: run the manual Job twice for the same date and confirm the target holds one copy of the result.

## Troubleshooting

| Symptom                                                         | Likely cause                                                                                    | Check and fix                                                                                                                                                   |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Job stays `Running` after the work finished                     | A classic sidecar that never exits                                                              | `kubectl get pod -o jsonpath='{.status.containerStatuses}'`: main terminated, proxy running. Move the proxy to a native sidecar.                               |
| Job fails with `DeadlineExceeded`                               | Hung run, slow dependency, or the deadline is too tight                                         | Read the logs of the last attempt; compare with normal run time; check database locks.                                                                         |
| Job fails with `BackoffLimitExceeded` after a node upgrade       | Evictions counted as failures                                                                   | Add the `DisruptionTarget` `Ignore` rule; check `kubectl get events --field-selector reason=Preempted`.                                                         |
| CronJob stopped creating Jobs, no failures                       | More than 100 missed schedules without `startingDeadlineSeconds`, or `suspend: true`           | Search the kube-controller-manager logs (on GKE, Cloud Logging for the control plane, if enabled) for `too many missed start times`; set the deadline. Check `.spec.suspend`. |
| Two runs for one schedule, or overlapping runs                  | `concurrencyPolicy: Allow` with a run longer than the interval, or the documented at-least-once behaviour | `Forbid`, a run-key lock, and idempotent writes.                                                                                                       |
| Runs at the wrong hour                                          | No `timeZone`; control plane time zone or daylight saving                                       | Set `timeZone`. A zone with daylight saving changes may skip or repeat a run at the switch (behaviour not verified here); use `Etc/UTC` when that matters.                        |
| Pods stuck `Pending`                                            | No capacity for a non-preempting class, quota, or the Spot pool is empty                        | `kubectl describe pod` events; see [[kubernetes-pod-troubleshooting]].                                                                                          |
| Job deleted before anyone could read the logs                   | `ttlSecondsAfterFinished` too short, or history limit 0                                         | Raise them, and ship logs to central logging so retention does not depend on Pod objects.                                                                      |

## Rollback

Stopping a misbehaving CronJob safely:

1. **Stop new runs:** `kubectl -n "$NS" patch cronjob "$CJ" -p '{"spec":{"suspend":true}}'`. Running Jobs continue.
2. **Decide about the running Job.** Deleting it terminates its Pods mid-run (`kubectl -n "$NS" delete job <job>`); only do that when the work is idempotent or you have a plan for the half-written result. Otherwise let it finish or wait for `activeDeadlineSeconds`.
3. **Roll back the template** with the previous manifest from Git (or `helm rollback`). Only new Jobs use it.
4. **Resume with care.** Make sure `startingDeadlineSeconds` is set before setting `suspend: false`; without it, every run missed while suspended starts at once.
5. If a run wrote bad data, use the run key to find and reverse exactly that run's output.

## Related

- [[priority-classes-and-preemption]]
- [[kubernetes-resource-requests-and-limits]]
- [[postgres-connection-pooling-gke]]
- [[gke-workload-identity]]
- [[kubernetes-pod-troubleshooting]]
- [[slo-burn-rate-alerting]]
- [[pod-disruption-budgets-for-stateless-services]]
- [[timeouts-retries-load-shedding]]
- [[linux-services-packages-and-scheduled-jobs]] for host cron and systemd timers

## Sources

- [Kubernetes: Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/job/)
- [Kubernetes: CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)
- [Kubernetes: Sidecar containers](https://kubernetes.io/docs/concepts/workloads/pods/sidecar-containers/)
- [Kubernetes: Automatic cleanup for finished Jobs](https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/)
- [Kubernetes: Pod priority and preemption](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/)
- [kube-state-metrics: CronJob metrics](https://github.com/kubernetes/kube-state-metrics/blob/main/docs/metrics/workload/cronjob-metrics.md) and [Job metrics](https://github.com/kubernetes/kube-state-metrics/blob/main/docs/metrics/workload/job-metrics.md)
- [Cloud SQL Auth Proxy README](https://github.com/GoogleCloudPlatform/cloud-sql-proxy)
