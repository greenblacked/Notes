---
title: "Kubernetes 12: Jobs and CronJobs: batch work, retries, concurrency and cleanup"
description: Run one-off and scheduled work with Jobs and CronJobs, set retries, deadlines, concurrency and cleanup on purpose, and alert when a run fails or never happens.
type: guide
tags:
  - learning
  - kubernetes
  - reliability
created: 2026-10-21
modified: 2026-10-21
draft: false
---

> [!info] Level: junior-middle | Time: about 2.5 h | You need: [[learn/kubernetes-probes-resources-and-debugging|Kubernetes 05: Probes, resources and a pod debugging playbook]] | Lab: the kind cluster `lab`; the optional alert exercise uses `promtool` from [[learn/first-prometheus-alert|Observability 03]]

Not everything runs forever. Database migrations, nightly backups, report generation, certificate checks and cleanup tasks run, finish and should **stay finished**. A Deployment is the wrong tool for them: it restarts a container that exits, forever. Kubernetes has two objects for batch work: a **Job** runs Pods until a number of them succeed, and a **CronJob** creates Jobs on a schedule.

The YAML is short. The judgment is in the defaults you override: how many retries, how long a run may take, what happens when the previous run is still going, how long finished Jobs stay around, and how you find out that the 02:00 backup did not run. Get those wrong and a backup job silently stops for weeks, or two copies of a migration run at once.

> [!note] Nothing here was run for this page
> The manifests, commands and sample output follow the Kubernetes and kube-state-metrics documentation and are not verified on a running cluster. Output is illustrative. Feature states are given as "stable since 1.xx"; check yours with `kubectl version`.

## What you will learn

- When to use a Job instead of a Deployment, and how `completions`, `parallelism`, `restartPolicy` and `backoffLimit` decide how it runs and retries.
- How `activeDeadlineSeconds`, `ttlSecondsAfterFinished` and a pod failure policy bound and clean up a Job.
- How a CronJob schedules Jobs: `schedule`, `timeZone`, `concurrencyPolicy`, `startingDeadlineSeconds`, history limits and `suspend`.
- Why every batch job must be idempotent, and how to run a CronJob by hand.
- How to alert on failed runs and on runs that never happened, with kube-state-metrics.

## Job versus Deployment

| Question                 | Deployment                        | Job                                                   |
| ------------------------ | --------------------------------- | ----------------------------------------------------- |
| What is "done"?          | Never: keep N replicas running.   | When enough Pods have **succeeded** (exit code 0).    |
| Container exits with 0   | Restarted (it should not exit).   | Counted as a success; not restarted.                  |
| Container exits non-zero | Restarted with back-off, forever. | Retried up to `backoffLimit`, then the Job **fails**. |
| `restartPolicy`          | `Always` only.                    | `Never` or `OnFailure` only.                          |
| After the work           | Keeps running.                    | Job and Pods stay (for logs) until cleaned up.        |

A minimal Job:

```yaml title="job-minimal.yaml"
apiVersion: batch/v1
kind: Job
metadata:
  name: report
spec:
  backoffLimit: 3 # retries before the Job fails (default 6)
  activeDeadlineSeconds: 900 # the whole Job, all attempts, at most 15 minutes
  ttlSecondsAfterFinished: 86400 # delete the Job and its Pods a day after it finishes
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: report
          image: registry.example.com/report:pinned-tag # illustrative only
          args: ["--date", "yesterday"]
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              memory: 256Mi
```

Jobs live in the `batch` API group: `kubectl get jobs`, `kubectl describe job report`, `kubectl logs job/report` (logs of one of its Pods).

## Retries: `restartPolicy` and `backoffLimit`

The two allowed restart policies retry in different places:

- **`Never`**: a failed container fails the Pod; the Job controller creates a **new Pod**. Each attempt is a separate Pod with its own logs, which is why the Kubernetes docs recommend `Never` while you debug.
- **`OnFailure`**: the kubelet restarts the container **inside the same Pod**. Fewer objects, but once the back-off limit is reached the Pod is terminated, and the logs of earlier attempts can go with it.

`backoffLimit` (default 6) counts failed Pods, plus container restarts under `OnFailure`. Failed Pods are recreated with an exponential back-off of 10 s, 20 s, 40 s and so on, capped at ten minutes. When the limit is reached, the Job gets the condition `Failed` with reason `BackoffLimitExceeded`, and it **stays failed**: a Job does not restart itself. Someone (or the next CronJob run) must start a new one.

### Idempotency is not optional

The Job documentation is explicit that even with `parallelism: 1`, `completions: 1` and `restartPolicy: Never`, **the same program may sometimes be started twice**, and the CronJob documentation says a schedule can occasionally create two Jobs or none. Add retries after a half-finished attempt, and every batch program must be safe to run again:

- Write output to a temporary name and rename it at the end, or upsert, instead of appending.
- Use a lock or a "claimed by" marker in the database for work that must not run twice concurrently.
- Make migrations check what is already applied (migration tools keep a version table for exactly this).
- Clean up partial output from a previous failed attempt at the start.

## Bounding and cleaning up

- **`activeDeadlineSeconds`** limits the whole Job, across all retries. When it is reached, running Pods are terminated and the Job fails with reason `DeadlineExceeded`. It **takes precedence over `backoffLimit`**. There is also an `activeDeadlineSeconds` in the Pod spec, which limits one Pod; set the one you mean.
- **`ttlSecondsAfterFinished`** (stable since 1.23) deletes the Job, and its Pods with it, that many seconds after it becomes `Complete` or `Failed`. `0` means right away; unset means never by TTL. Without it, finished Jobs and their Pods stay so that you can read the logs, and they pile up. CronJobs have their own history limits instead (below).
- **Pod failure policy** (`spec.podFailurePolicy`, stable since 1.31, needs `restartPolicy: Never`) decides per exit code or Pod condition whether a failure should fail the Job at once (`FailJob`), not count (`Ignore`), count as usual (`Count`) or fail one index (`FailIndex`). Typical use: exit code 42 means "bad input, retrying will not help", so `FailJob`; a Pod evicted by a node drain (`DisruptionTarget` condition) should not use up a retry, so `Ignore`.

```yaml
spec:
  podFailurePolicy:
    rules:
      - action: FailJob
        onExitCodes:
          containerName: report
          operator: In
          values: [42]
      - action: Ignore
        onPodConditions:
          - type: DisruptionTarget
```

## Parallel Jobs, briefly

- `completions` (default 1) is how many successful Pods finish the Job; `parallelism` (default 1) is how many run at once. `completions: 10`, `parallelism: 3` runs ten work items three at a time.
- `completionMode: Indexed` (stable since 1.24) gives each Pod an index from 0 to `completions - 1`, in the environment variable `JOB_COMPLETION_INDEX`, so Pod 3 knows to process shard 3.
- Newer fields such as `backoffLimitPerIndex`, `successPolicy` and `podReplacementPolicy` refine indexed and parallel Jobs. Read the "Jobs" page for your version before using them.

## CronJobs: Jobs on a schedule

```yaml title="cronjob.yaml"
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-backup # at most 52 characters
spec:
  schedule: "15 2 * * *" # minute hour day-of-month month day-of-week
  timeZone: "Etc/UTC" # stable since 1.27; an IANA name
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 600
  successfulJobsHistoryLimit: 3 # the default
  failedJobsHistoryLimit: 3 # default 1; keep more failures to debug
  jobTemplate:
    spec:
      backoffLimit: 2
      activeDeadlineSeconds: 3600
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: backup
              image: registry.example.com/backup:pinned-tag # illustrative only
```

| Field                                                  | What it does                                                                                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schedule`                                             | Standard five-field cron syntax, as in [[learn/linux-services-packages-and-scheduled-jobs\|Linux 05]], plus macros like `@hourly` and `@daily`.                        |
| `timeZone`                                             | The time zone of the schedule. Without it, the kube-controller-manager's time zone is used, which you may not know. `CRON_TZ=` or `TZ=` inside `schedule` is rejected. |
| `concurrencyPolicy`                                    | `Allow` (default): runs may overlap. `Forbid`: skip a run while the previous one is still running. `Replace`: stop the running one and start the new one.              |
| `startingDeadlineSeconds`                              | How late a run may still start (for example after a controller outage). Unset means no limit. Under 10 may never run, because the controller checks every 10 seconds.  |
| `successfulJobsHistoryLimit`, `failedJobsHistoryLimit` | How many finished Jobs to keep: 3 and 1 by default.                                                                                                                    |
| `suspend`                                              | `true` stops new runs; running Jobs continue. Suspended runs count as missed.                                                                                          |

Some behaviour to know before it surprises you:

- **Choose `concurrencyPolicy` on purpose.** The default `Allow` lets a slow backup overlap with the next one. For backups, migrations and anything that takes a lock, use `Forbid`. A skipped run under `Forbid` counts as missed.
- **The 100 missed schedules rule.** If the controller finds more than 100 missed schedules since the last run (or within `startingDeadlineSeconds`, if set), it does not start the Job and logs an error asking you to set or decrease `startingDeadlineSeconds` or check clock skew. A per-minute CronJob that was suspended for two hours hits this. Setting `startingDeadlineSeconds` avoids it.
- **Unsuspending can start a backlog.** Without a starting deadline, missed runs may start immediately when you set `suspend: false`.
- **Editing a CronJob does not change Jobs already started.**
- **Jobs created by a CronJob are named** `<cronjob>-<suffix>`, which is why the CronJob name is limited to 52 characters. From 1.32 they also carry the annotation `batch.kubernetes.io/cronjob-scheduled-timestamp` with the scheduled time.

### Running a CronJob now

To test a CronJob, or rerun last night's failed backup, create a Job from its template:

```bash
CRONJOB=nightly-backup
kubectl create job "${CRONJOB}-manual-$(date +%Y%m%d%H%M)" --from=cronjob/"$CRONJOB"
```

The Job is created immediately, from the CronJob's current `jobTemplate`, whatever the schedule and `concurrencyPolicy` say. So check first that no run is active (`kubectl get jobs`), especially for anything that must not run twice at once.

## Typical uses in operations

- **Database migrations before a rollout.** A Job (often a Helm hook or an Argo CD PreSync hook) that runs the migration tool. It must be idempotent and forward-only; the pattern is [[patterns/postgres-expand-contract-migrations]].
- **Backups.** A CronJob with `Forbid`, a deadline and alerts. A backup only counts once a restore has been tested ([[adr/0051-backups-proven-by-quarterly-restore-drills|ADR 0051]]).
- **Reports, exports, cleanups, certificate checks.** CronJobs with `timeZone` set, so "02:00" means what the business thinks it means.

## Alerting on batch work

A failed Job is easy to see if someone looks. The dangerous failures are the quiet ones: the Job that failed at 02:00 and was cleaned up by 08:00, and the CronJob that **never ran** (suspended and forgotten, a broken schedule, a missed-schedule backlog). You need two alerts: one for **failure**, one for **absence of success**.

[kube-state-metrics](https://github.com/kubernetes/kube-state-metrics) exposes Job and CronJob state as metrics. Its documentation lists, among others, as stable: `kube_job_failed{condition}`, `kube_job_complete{condition}`, `kube_job_owner{owner_kind,owner_name}`, `kube_job_status_start_time`, `kube_cronjob_status_last_schedule_time`, `kube_cronjob_status_last_successful_time`, `kube_cronjob_next_schedule_time` and `kube_cronjob_spec_suspend`. Job metrics use the label `job_name`, CronJob metrics the label `cronjob`. Metrics marked experimental there (such as `kube_job_status_failure_reason`) can change.

```yaml title="batch-alerts.yaml"
groups:
  - name: batch
    rules:
      - alert: CronJobRunFailed
        # A Job owned by a CronJob has the Failed condition.
        expr: |
          max by (namespace, owner_name) (
            (kube_job_failed{condition="true"} == 1)
            * on (namespace, job_name) group_left (owner_name)
            kube_job_owner{owner_kind="CronJob"}
          )
        labels:
          severity: ticket
          team: team-platform
          service: nightly-backup
        annotations:
          summary: "CronJob {{ $labels.namespace }}/{{ $labels.owner_name }} has a failed run"
          description: "A Job created by this CronJob failed. Read its Pods' logs before the history limit deletes them."
          runbook_url: https://runbooks.example.com/batch/cronjob-run-failed
      - alert: CronJobNoRecentSuccess
        # A daily CronJob that has not succeeded for 26 hours, and is not suspended.
        expr: |
          (time() - kube_cronjob_status_last_successful_time{cronjob="nightly-backup"}) > 26 * 3600
          and on (namespace, cronjob)
          kube_cronjob_spec_suspend == 0
        labels:
          severity: page
          team: team-platform
          service: nightly-backup
        annotations:
          summary: "nightly-backup has not succeeded for over 26 hours"
          description: "The last successful run of {{ $labels.namespace }}/nightly-backup was {{ $value | humanizeDuration }} ago; the threshold is 26 hours."
          runbook_url: https://runbooks.example.com/batch/cronjob-no-recent-success
```

These expressions are a design, not a recipe from the kube-state-metrics docs. Size the window to the schedule plus the longest normal run plus a margin, decide severity per job (a missed backup can be a page; a missed report is a ticket), and give each alert the labels and runbook your [[standards/alert-and-runbook-standard|alert standard]] requires. One gap to close yourself: a CronJob that has **never** succeeded has no `last_successful_time` to compare, so the second rule does not fire for it; cover new CronJobs with an `absent()`-style check or a review step. Unit-test the rules with `promtool test rules` as in [[learn/first-prometheus-alert|Observability 03]], and see [[learn/promql-for-alert-rules-and-recording-rules|Observability 04]] for the vector matching used in the first rule. The production rule set, with a suspended-CronJob alert and `for` clauses, is in [[patterns/kubernetes-jobs-and-cronjobs#Alerting on failed and missed runs|Reliable Kubernetes Jobs and CronJobs]].

## Hands-on exercises

Do these in the kind cluster `lab`. Names start with `k12-`. Check `kubectl config current-context` prints `kind-lab` first.

> [!warning] Exercises are not verified
> The commands and outputs were written from the Kubernetes documentation and were not run for this page. Output is illustrative; ages and suffixes differ. Event wording differs between versions. Read the "If you see something else" lines first.

1. **A Job that fails twice, then succeeds.** The container counts its attempts in an `emptyDir`, which survives container restarts inside the same Pod (`restartPolicy: OnFailure`).

   ```yaml title="k12-flaky.yaml"
   apiVersion: batch/v1
   kind: Job
   metadata:
     name: k12-flaky
   spec:
     backoffLimit: 4
     template:
       spec:
         restartPolicy: OnFailure
         containers:
           - name: work
             image: busybox:1.36 # example tag; pin the one you use
             command:
               - sh
               - -c
               - 'n=$(cat /work/n 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > /work/n; echo "attempt $n"; [ "$n" -ge 3 ]'
             volumeMounts:
               - name: work
                 mountPath: /work
         volumes:
           - name: work
             emptyDir: {}
   ```

   ```bash
   kubectl apply -f k12-flaky.yaml
   kubectl wait --for=condition=Complete job/k12-flaky --timeout=180s
   kubectl get job k12-flaky
   kubectl get pods -l job-name=k12-flaky
   kubectl logs job/k12-flaky
   kubectl describe pod -l job-name=k12-flaky | sed -n '/Events/,$p'
   ```

   Expected: the Job completes after roughly half a minute (back-off between attempts). One Pod with `RESTARTS 2`, status `Completed`; the logs say `attempt 3`; the events show the container back-off (`Back-off restarting failed container`) twice.

   ```text
   NAME        STATUS     COMPLETIONS   DURATION   AGE
   k12-flaky   Complete   1/1           38s        40s
   NAME              READY   STATUS      RESTARTS      AGE
   k12-flaky-7xq2m   0/1     Completed   2 (15s ago)   40s
   ```

   If you see something else: if there are three Pods instead of one with restarts, the restart policy is `Never` and each Pod starts with an empty `emptyDir`, so the counter never reaches 3. If the `job-name` label does not select the Pods, use `kubectl get pods | grep k12-flaky`; newer versions also add `batch.kubernetes.io/job-name`.

2. **A Job that runs out of retries.** With `Never`, each attempt is a new Pod.

   ```bash
   kubectl create -f - <<'EOF'
   apiVersion: batch/v1
   kind: Job
   metadata:
     name: k12-fail
   spec:
     backoffLimit: 2
     template:
       spec:
         restartPolicy: Never
         containers:
           - name: work
             image: busybox:1.36
             command: ["sh", "-c", "echo failing on purpose; exit 1"]
   EOF
   kubectl wait --for=condition=Failed job/k12-fail --timeout=180s
   kubectl get pods -l job-name=k12-fail
   kubectl get job k12-fail -o jsonpath='{.status.conditions[?(@.type=="Failed")].reason}{"\n"}'
   ```

   Expected: three Pods in `Error` (the first attempt plus two retries) and the reason `BackoffLimitExceeded`. Each Pod's log is still readable with `kubectl logs <pod>`.
   If you see something else: if `kubectl wait` does not support `--for=condition=Failed` on your version, poll `kubectl get job k12-fail` until `STATUS` shows `Failed`.

3. **A deadline that ends the Job.**

   ```bash
   kubectl create -f - <<'EOF'
   apiVersion: batch/v1
   kind: Job
   metadata:
     name: k12-slow
   spec:
     activeDeadlineSeconds: 15
     backoffLimit: 6
     template:
       spec:
         restartPolicy: Never
         containers:
           - name: work
             image: busybox:1.36
             command: ["sleep", "120"]
   EOF
   sleep 30
   kubectl get job k12-slow
   kubectl get job k12-slow -o jsonpath='{.status.conditions[?(@.type=="Failed")].reason}{"\n"}'
   ```

   Expected: `Failed` with reason `DeadlineExceeded` after about 15 seconds, although no retry was used: the deadline wins over `backoffLimit`.
   If you see something else: if the Job is still running, check the field sits under the Job's `spec`, not the Pod's.

4. **A CronJob with `Forbid` and a slow run.** Every minute, but each run takes two and a half minutes.

   ```yaml title="k12-report.yaml"
   apiVersion: batch/v1
   kind: CronJob
   metadata:
     name: k12-report
   spec:
     schedule: "* * * * *"
     timeZone: "Etc/UTC"
     concurrencyPolicy: Forbid
     startingDeadlineSeconds: 30
     successfulJobsHistoryLimit: 3
     failedJobsHistoryLimit: 1
     jobTemplate:
       spec:
         backoffLimit: 0
         template:
           spec:
             restartPolicy: Never
             containers:
               - name: report
                 image: busybox:1.36
                 command: ["sh", "-c", "echo start $(date -u +%H:%M:%S); sleep 150; echo done"]
   ```

   ```bash
   kubectl apply -f k12-report.yaml
   sleep 300
   kubectl get cronjob k12-report
   kubectl get jobs | grep k12-report
   kubectl describe cronjob k12-report | sed -n '/Events/,$p'
   ```

   Expected: after five minutes only two Jobs exist (one finished, one running), not five: the runs scheduled while one was active were skipped. `kubectl get cronjob` shows `ACTIVE 1`, and the events show `SuccessfulCreate` for the runs that started and a message for the skipped ones (illustrative wording: `Not starting job because prior execution is running and concurrency policy is Forbid`).
   If you see something else: five Jobs mean `concurrencyPolicy` is `Allow`; check `kubectl get cronjob k12-report -o jsonpath='{.spec.concurrencyPolicy}'`. If `timeZone` is rejected, your cluster is older than the version where the field became available; remove it and note that the schedule then follows the controller's time zone.

5. **Run the CronJob by hand, then suspend it.**

   ```bash
   kubectl create job k12-report-manual --from=cronjob/k12-report
   kubectl get jobs | grep k12-report
   kubectl patch cronjob k12-report -p '{"spec":{"suspend":true}}'
   kubectl get cronjob k12-report
   ```

   Expected: `job.batch/k12-report-manual created` right away, even if a scheduled run is active (manual creation ignores `concurrencyPolicy`), and then `SUSPEND True`.
   If you see something else: a not-found error for `cronjobs.batch` means a typo in the name; leaving out the `cronjob/` prefix gives a different error.

6. **Automatic cleanup with a TTL.**

   ```bash
   kubectl create -f - <<'EOF'
   apiVersion: batch/v1
   kind: Job
   metadata:
     name: k12-ttl
   spec:
     ttlSecondsAfterFinished: 20
     template:
       spec:
         restartPolicy: Never
         containers:
           - name: work
             image: busybox:1.36
             command: ["sh", "-c", "echo done"]
   EOF
   kubectl wait --for=condition=Complete job/k12-ttl --timeout=60s
   kubectl get job k12-ttl
   sleep 40
   kubectl get job k12-ttl
   kubectl get pods -l job-name=k12-ttl
   ```

   Expected: first `Complete`, then `Error from server (NotFound): jobs.batch "k12-ttl" not found` and no Pods: the TTL controller deleted both.
   If you see something else: if it is still there after a minute, check the field is set (`kubectl get job k12-ttl -o yaml | grep ttl`) and remember the timer starts at completion.

7. **Optional: check the alert rules.** With `promtool` from Observability 03, save `batch-alerts.yaml` from the section above and run:

   ```bash
   promtool check rules batch-alerts.yaml
   ```

   Expected: `SUCCESS: 2 rules found`. This checks syntax only; write a `promtool test rules` file with series for `kube_job_failed`, `kube_job_owner` and `kube_cronjob_status_last_successful_time` to test the logic, as Observability 03 shows.
   If you see something else: a parse error usually points to indentation in the `expr: |` blocks.

8. **Clean up.**

   ```bash
   kubectl delete cronjob k12-report --ignore-not-found
   kubectl delete job k12-flaky k12-fail k12-slow k12-ttl k12-report-manual --ignore-not-found
   kubectl get jobs,cronjobs,pods | grep k12- || echo "clean"
   ```

   Expected: `clean`. Deleting a CronJob deletes the Jobs it owns.

## Common mistakes

- **Using a Deployment for a one-off task.** Why it bites: the container exits, is restarted forever and shows `CrashLoopBackOff` even when the work succeeded. Fix: a Job.
- **Non-idempotent jobs.** Why it bites: a retry or a duplicate run appends twice, double-charges or half-applies a migration. Fix: design every job to be safe to run again.
- **The default `concurrencyPolicy: Allow` on backups and migrations.** Why it bites: a slow run overlaps the next one, and both fight over locks or bandwidth. Fix: `Forbid` (or `Replace` where only the newest run matters).
- **No `timeZone`.** Why it bites: the schedule follows the controller's time zone, and a managed control plane's may not be yours. Fix: set `timeZone` explicitly.
- **No `activeDeadlineSeconds`.** Why it bites: a hung job holds resources and, under `Forbid`, blocks every later run. Fix: a deadline longer than the slowest normal run.
- **Finished Jobs piling up.** Why it bites: thousands of Job and Pod objects slow the API and `kubectl get pods`. Fix: `ttlSecondsAfterFinished` on Jobs, history limits on CronJobs.
- **`failedJobsHistoryLimit: 1` and alerts that come later.** Why it bites: by the time someone looks, the failed Pod and its logs are gone. Fix: ship logs centrally and keep a few failed Jobs.
- **Alerting only on failure.** Why it bites: a CronJob that never runs never fails. Fix: also alert on "no success within the expected window".

## Check your understanding

1. What is the difference between `restartPolicy: Never` and `OnFailure` for a Job, and which one helps more when you debug?
2. A Job has `backoffLimit: 6` and `activeDeadlineSeconds: 60`, and its Pod hangs. What happens and with which reason?
3. Why must a Job be idempotent even with `parallelism: 1` and `completions: 1`?
4. A CronJob runs every 5 minutes; one run takes 12 minutes. What happens with `Allow`, `Forbid` and `Replace`?
5. You need to rerun last night's failed backup now. Which command do you use, and what do you check first?
6. Which two alerts do you want for a nightly CronJob, and why is one of them not enough?

> [!question]- Answers
>
> 1. With `Never`, each failed attempt is a new Pod, so every attempt's logs and status stay visible. With `OnFailure`, the container is restarted in the same Pod, which is lighter but loses earlier attempts' logs more easily and the Pod is terminated when the limit is reached. `Never` is better for debugging.
> 2. After 60 seconds the Job controller terminates the Pod and marks the Job `Failed` with reason `DeadlineExceeded`. The deadline covers the whole Job and takes precedence over `backoffLimit`, so remaining retries are not used.
> 3. Kubernetes may start the same Job's Pod more than once (a node failure, a retry after a partial run, a rare duplicate), and the CronJob controller can create two Jobs for one schedule in some circumstances. A second run must not corrupt or duplicate the result.
> 4. `Allow`: runs overlap, up to three at once. `Forbid`: runs that come due while one is active are skipped (and counted as missed). `Replace`: each new run stops the running one, so a 12-minute job never finishes.
> 5. `kubectl create job <name> --from=cronjob/<cronjob>`. First check that no run is active (`kubectl get jobs`) and that the job is safe to run now, because a manual Job ignores `concurrencyPolicy`.
> 6. One for a failed run (a Job owned by the CronJob has the `Failed` condition) and one for no successful run within the expected window. The failure alert misses the cases where no Job is created at all: a suspended CronJob, a broken schedule, the missed-schedule limit.

## Next steps

This is the last lesson in the Kubernetes track for now. Next lesson: [[learn/gcp-keyless-ci-with-workload-identity-federation|GCP 05: Keyless CI to Google Cloud with Workload Identity Federation]]. Previous lesson: [[learn/kubernetes-network-policies-from-zero|Kubernetes 11: NetworkPolicy from zero]]. A good next stop is [[learn/gitops-with-argo-cd|Delivery 11: GitOps with Argo CD]], where migration Jobs run as sync hooks.

To go deeper:

- [[patterns/kubernetes-jobs-and-cronjobs]] for the production baseline: sidecars that let a Job finish, priority and Spot, and the full alert set.
- [[standards/scheduled-jobs-standard]] for the rules every scheduled job must meet.
- [[architecture/batch-and-scheduled-workloads-gcp]] for when a CronJob is the right platform and when Cloud Run jobs or Batch fit better.
- [[patterns/postgres-expand-contract-migrations]] for migrations that run as Jobs without downtime.
- [[architecture/backup-architecture-gke-cloud-sql-gcs]] and [[adr/0051-backups-proven-by-quarterly-restore-drills]] for backup jobs that count.
- [[standards/alert-and-runbook-standard]] for the labels, annotations and runbook every batch alert needs.
- [[learn/linux-services-packages-and-scheduled-jobs|Linux 05]] for cron and systemd timers on a single host.
- [[runbooks/kubernetes-pod-troubleshooting]] when a Job's Pod does not start at all.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- Kubernetes documentation, "Jobs" (https://kubernetes.io/docs/concepts/workloads/controllers/job/), for `restartPolicy`, `backoffLimit` and its default and back-off timing, `activeDeadlineSeconds` and its precedence, the "started twice" warning, completion modes (Indexed stable since 1.24) and pod failure policy (stable since 1.31).
- Kubernetes documentation, "CronJob" (https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/), for the schedule syntax, `timeZone` (stable since 1.27), `concurrencyPolicy`, `startingDeadlineSeconds` and the 100 missed schedules rule, history limits, `suspend` and the 52-character name limit.
- Kubernetes documentation, "Automatic Cleanup for Finished Jobs" (https://kubernetes.io/docs/concepts/workloads/controllers/ttlafterfinished/), for `ttlSecondsAfterFinished` (stable since 1.23).
- `kubectl create job` reference (https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_job/), for `--from=cronjob/NAME`.
- kube-state-metrics documentation, Job metrics and CronJob metrics (https://github.com/kubernetes/kube-state-metrics/tree/main/docs/metrics/workload), for the metric names, labels and stability.
- Not checked against a running cluster for this page. Not verified: all output and event wording; the alert expressions and thresholds (an example design, to be unit-tested); whether kube-state-metrics runs in your cluster (on GKE it depends on your monitoring setup). Check the current docs.
