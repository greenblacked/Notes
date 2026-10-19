---
title: GitLab runner jobs stuck pending
description: "Find why GitLab CI jobs wait forever: tags, runner health, concurrency limits or cluster capacity, and fix the cheapest layer first."
type: runbook
tags:
  - runbooks
  - gitlab-ci
  - kubernetes
  - gke
  - ci-cd
  - reliability
created: 2026-10-19
modified: 2026-10-19
draft: false
---

A GitLab job that stays "Pending" has not failed; nothing wants to run it. The cause sits in one of three layers: the job (its tags and the ref it runs on), the runner (registration, health, concurrency settings) or the cluster that executes jobs (Pods that cannot be scheduled). Check them in that order, because the first is the cheapest to fix and the last is the most expensive.

> [!info] Scope and verification
> The commands were not run against a live GitLab or runner when this note was written, and the note is not marked `verified`. UI wording, including the "stuck" banner on a job, varies by GitLab version, and runner configuration keys evolve. Check the current GitLab Runner documentation before changing production configuration.

## When to use

- Jobs sit in Pending for minutes or longer while pipelines for other projects run.
- A job page shows a banner saying the job is stuck or that no active runner is available.
- A newly added project or a newly protected branch never gets runners.
- The runner shows as online but jobs queue behind each other.

## Preconditions

- Maintainer access to the project (to read job and runner settings) and, for instance runners, an admin or the runner owner.
- `kubectl` access to the runner namespace if runners run on Kubernetes, see [[gitlab-runners-on-gke]].
- Awareness of how the pipeline is structured, see [[gitlab-ci-pipeline-structure]], so you know which jobs set `tags:` and which rely on defaults.

```bash
RUNNER_NS=gitlab-runner                 # namespace of the runner manager
JOBS_NS=gitlab-jobs                     # namespace where job Pods run; often the same as RUNNER_NS
GITLAB_URL=https://gitlab.example.com
```

## Steps

### 1. Read the job page

Open the pending job. Collect:

- The **tags** the job requires (`tags:` in `.gitlab-ci.yml`, including those inherited through `default:` or an included template).
- The ref it runs on: a protected branch or tag, a merge request pipeline, or a fork pipeline.
- The banner text. The wording changes by GitLab version, but it generally says that the job is stuck because no runner matches, or because the matching runners are offline. Treat it as a hint, not a verdict.

Rules that cause most "stuck" jobs:

- A job with tags needs a runner that has **all** of those tags. One missing tag means no match.
- A job with **no tags** needs a runner that is allowed to run untagged jobs. Many runners are configured to only take tagged jobs.
- A runner marked **protected** takes only jobs from protected branches and tags. A feature branch pipeline will sit pending forever.
- A runner locked to one project, or a group runner that is not shared with the project's group, will not pick the job up.
- Shared (instance) runners can be disabled for a project or group.

Check the pipeline file for tags:

```bash
git grep -n -A2 'tags:' .gitlab-ci.yml
```

And in the project: Settings, CI/CD, Runners shows which runners are available to this project, with their tags and status.

### 2. Check runner registration and health

On the runner host, or inside the runner manager Pod:

```bash
# Host install
sudo gitlab-runner verify
sudo gitlab-runner list

# Kubernetes install
kubectl -n "$RUNNER_NS" get pods
kubectl -n "$RUNNER_NS" exec deploy/gitlab-runner -- gitlab-runner verify
kubectl -n "$RUNNER_NS" exec deploy/gitlab-runner -- gitlab-runner list
```

`verify` checks that each registered runner can still authenticate to GitLab. With `--delete` it also removes invalid entries from `config.toml`, so do not add that flag in production until you have read the plain output. Compare with the runner admin page in GitLab: the "last contact" time should be recent. An old contact time with a healthy-looking process points at network, proxy, DNS or an expired or revoked authentication token. Check the runner documentation for how tokens are managed in your GitLab version.

### 3. Check concurrency limits

The runner manager has several limits, and any of them can create a queue without an error. Look at `config.toml` (or the Helm values that render it):

```toml title="config.toml (excerpt)"
concurrent = 10            # global cap on jobs this runner process runs at once

[[runners]]
  name = "k8s-ci"
  limit = 5                # cap for this runner entry; 0 means no per-runner cap
  request_concurrency = 1  # how many job requests it may have in flight to GitLab
```

Check the current documentation for the exact keys and defaults in your runner version. Then compare against reality:

- If running jobs equal `concurrent` or `limit`, the runner is simply full. That is not a fault; decide whether the capacity should be higher.
- If `request_concurrency` is low and jobs are short, the runner may fetch work slowly. Raise it carefully.

> [!warning] Raising `concurrent` without capacity moves the queue
> More allowed jobs than the cluster can place just turns "Pending in GitLab" into "Pending Pods in Kubernetes", often with node-pool autoscaling churn and out-of-memory kills on top. Raise limits only together with node capacity, requests that match real usage, and a cluster quota that allows the extra Pods.

### 4. Check the Kubernetes executor

When the runner uses the Kubernetes executor, every job is a Pod. If the runner is healthy but jobs stall, look at the Pods:

```bash
kubectl -n "$JOBS_NS" get pods --sort-by=.metadata.creationTimestamp | tail -20
kubectl -n "$JOBS_NS" get pods --field-selector=status.phase=Pending
kubectl -n "$JOBS_NS" describe pod <pending-job-pod> | sed -n '/Events:/,$p'
kubectl -n "$JOBS_NS" get resourcequota
kubectl get events -A --field-selector reason=FailedScheduling --sort-by=.lastTimestamp | tail
```

What the events say:

| Event or state                                     | Meaning                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `FailedScheduling: Insufficient cpu/memory`        | No node has room for the job's requests. Autoscaler or a bigger pool is needed.             |
| `exceeded quota`                                   | A ResourceQuota in the job namespace caps Pods or requests. Raise it or lower job requests. |
| `pod has unbound immediate PersistentVolumeClaims` | A cache or volume claim cannot bind. See the storage class and zone.                        |
| `ImagePullBackOff`                                 | The job image cannot be pulled. See [[kubernetes-pod-troubleshooting]].                     |
| Pod created, then waits before starting            | Waiting for a new node. Check the autoscaler, see [[kubernetes-autoscaling]].               |

If the node pool should scale but does not, look at the cluster autoscaler status and its events for reasons such as quota, a maximum node count or a pod that could never fit. On GKE, compare the machine type with the largest job's requests.

### 5. Read the runner manager logs

```bash
kubectl -n "$RUNNER_NS" logs deploy/gitlab-runner --tail=200
# Host install
sudo journalctl -u gitlab-runner -n 200 --no-pager
```

Typical lines: authentication errors (token revoked), connection or TLS errors to GitLab, "Checking for jobs... nothing" (the runner is healthy and the job does not match it, so go back to step 1), Pod creation errors from the API server (RBAC or admission webhooks), and repeated retries with backoff.

### 6. Make the smallest change that fixes it

In cost order:

1. Fix the job: correct `tags:`, run on a protected ref, or allow the project to use the runner.
2. Fix the runner entry: allow untagged jobs, correct tags, unprotect, or re-register a runner whose token was lost (follow the documented registration flow for your GitLab version).
3. Raise runner limits in line with capacity (step 3).
4. Add cluster capacity or relax quotas (step 4).

Make configuration changes through version control or the Helm values and not by editing files in a running Pod. For Helm see [[helm-release-rollback]] if the upgrade needs to go back.

## Validation

```bash
kubectl -n "$RUNNER_NS" get pods
kubectl -n "$JOBS_NS" get pods --field-selector=status.phase=Pending | wc -l
```

- Retry the stuck job: it starts within the time you expect, and the job Pod reaches Running.
- Run a trivial pipeline with one untagged and one tagged job on a protected and on an unprotected branch, matching how teams really use the runners.
- The runner shows recent contact in GitLab, and the number of pending jobs falls.
- Watch the pending-job age metric or the time-to-start in your dashboards for a full working day after a limit change.

## Rollback

- Revert the `config.toml` or Helm values change in version control and apply the previous revision. Runners usually reload `config.toml` automatically, but check the documentation for your version; with Helm a rollout of the manager Pod applies it.
- If you re-registered a runner, keep the old runner entry disabled (not deleted) until jobs run on the new one.
- If you raised quotas or node pool limits, lower them again once the backlog is gone, and keep a note of the real peak.
- If capacity changes caused cost to jump, review it with the owners rather than silently reverting during a peak.

## Troubleshooting

| Symptom                                     | Likely cause and fix                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Banner: stuck, no runner matches            | Missing tag or runner not available to the project. Fix tags or runner sharing (step 1). |
| Untagged jobs pending, tagged ones run      | Runner does not accept untagged jobs. Change the runner setting or tag the jobs.         |
| Feature branch pending, main branch runs    | Runner is protected. Use a runner for unprotected refs, or protect the ref.              |
| Runner online, jobs queue behind each other | `concurrent` or `limit` reached. Decide on capacity (step 3).                            |
| Runner offline in the UI                    | Network, token or process problem. Read the manager logs (step 5).                       |
| Job Pods Pending with `Insufficient memory` | Requests larger than free node capacity. Right-size requests or scale the pool.          |
| Pods Pending, autoscaler does nothing       | Max nodes or quota reached, or the Pod never fits. Check autoscaler events.              |
| Jobs start then fail with image pull errors | Registry access or tag issue. See [[kubernetes-pod-troubleshooting]].                    |

## Related

- [[gitlab-runners-on-gke]] for the runner architecture this runbook assumes.
- [[gitlab-ci-pipeline-structure]] for tags, includes and default settings.
- [[kubernetes-pod-troubleshooting]] and [[kubernetes-autoscaling]] for the Pod and node side.
- [[incident-response]] if CI is blocked for many teams.

## Sources

- [GitLab Runner advanced configuration](https://docs.gitlab.com/runner/configuration/advanced-configuration/)
- [GitLab Runner Kubernetes executor](https://docs.gitlab.com/runner/executors/kubernetes/)
- [GitLab Runner FAQ](https://docs.gitlab.com/runner/faq/)
- [GitLab CI/CD runners](https://docs.gitlab.com/ci/runners/)
