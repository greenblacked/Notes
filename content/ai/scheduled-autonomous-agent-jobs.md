---
title: Scheduled autonomous agent jobs
description: Run agents from cron, CI schedules or webhooks with scoped identities, idempotent proposals, run budgets, a tested kill switch and alerts on silence.
type: pattern
tags:
  - ai
  - security
  - ci-cd
  - reliability
created: 2026-10-27
modified: 2026-10-27
draft: false
---

This note covers coding or operations agents that start without a person present: a nightly CI schedule, a Kubernetes CronJob, or a webhook handler. It is for platform and delivery engineers who own such jobs. It sets out identity, output, idempotency, budget, kill-switch and alerting controls. It does not cover interactive agent sessions (see [[securing-ai-agents-in-ci-and-cloud]]), generic job hygiene (see [[scheduled-jobs-standard]] and [[patterns/kubernetes-jobs-and-cronjobs]]), or chat-triggered agents (see [[chatops-ai-assistants-in-slack]]).

> [!note] Not verified
> The sources below were found through search on 2026-10-27, but the pages could not be fetched. Before relying on this note, check: the CronJob field semantics (`concurrencyPolicy`, `startingDeadlineSeconds`, `timeZone`, `suspend`) against the Kubernetes version you run; hosted-CI scheduling behaviour (default-branch requirement, delays, automatic disabling of idle schedules) and concurrency semantics in your CI vendor's current docs; and any agent-vendor CI integration, which changes quickly. Nothing here was run.

## Principle: the job proposes, a human disposes

An unattended agent has no one to notice a bad judgement as it happens. Design so that the worst a run can do is open something reviewable. The job writes a draft merge request, an issue or a comment. It never pushes to a protected branch, applies infrastructure or merges its own output. Branch protection (required reviews, required status checks) is the enforcement; the job's token should not be able to bypass it. Keep the diff small enough to review, per [[agent-pull-request-size-and-reviewability]].

## Identity and credentials

- One identity per job, named for the job, with the narrowest scope that works. A job that triages issues needs issue write access, not repository write access.
- Prefer short-lived credentials from OIDC or workload identity over stored personal tokens. See [[just-in-time-agent-credentials]] and [[gcp-iam-guardrails-for-agent-service-accounts]].
- Keep secrets out of the agent's context and out of the environment of any tool that processes untrusted text. Issue bodies, comments, PR descriptions and fetched pages can carry prompt injection.
- Restrict triggers. Do not run an agent with write-scoped tokens on events that carry fork-controlled input (for example, GitHub's `pull_request_target`, or GitLab pipelines for fork merge requests with protected variables exposed).
- Limit network egress to what the job needs ([[agent-network-egress-controls]]).

## Idempotency and overlap

Schedulers can fire late, twice or not at all. Make outputs keyed on a stable identifier, for example `agent/dep-triage/2026-10-27`, and look for an existing branch, MR or issue with that key before creating one. A re-run should update, not duplicate.

Prevent overlapping runs. For Kubernetes, set `concurrencyPolicy: Forbid` (the default is `Allow`), set `startingDeadlineSeconds` so a missed window is skipped instead of run late against stale context, and set `timeZone` explicitly:

```yaml title="cronjob.yaml"
apiVersion: batch/v1
kind: CronJob
metadata:
  name: agent-dep-triage
spec:
  schedule: "17 3 * * 1-5"
  timeZone: "Etc/UTC"
  concurrencyPolicy: Forbid
  startingDeadlineSeconds: 600
  suspend: false # the kill switch; flip with kubectl patch
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      activeDeadlineSeconds: 1800
      backoffLimit: 0
      template:
        spec:
          restartPolicy: Never
          serviceAccountName: agent-dep-triage
          securityContext:
            runAsNonRoot: true
            runAsUser: 10001
            seccompProfile:
              type: RuntimeDefault
          containers:
            - name: run
              image: registry.example.com/agent-jobs/dep-triage@sha256:REPLACE_WITH_DIGEST
              command: ["/usr/local/bin/run-job.sh"]
              env:
                - name: JOB_NAME
                  value: dep-triage
                # Kill switch: one edit to this ConfigMap disables every agent job at its next run.
                # optional: true means a missing ConfigMap or key leaves it unset, which the
                # wrapper treats as disabled.
                - name: AGENT_JOBS_ENABLED
                  valueFrom:
                    configMapKeyRef:
                      name: agent-jobs
                      key: enabled
                      optional: true
              securityContext:
                allowPrivilegeEscalation: false
                readOnlyRootFilesystem: true
                capabilities:
                  drop: ["ALL"]
              resources:
                requests:
                  cpu: 250m
                  memory: 512Mi
                limits:
                  memory: 1Gi
              volumeMounts:
                - name: work
                  mountPath: /work
          volumes:
            - name: work
              emptyDir: {}
```

The resource figures are placeholders; size them from observed runs ([[kubernetes-resource-requests-and-limits]]). `backoffLimit: 0` avoids silent retries that multiply spend; retry on the next schedule instead, or retry deliberately with a budget.

For GitLab CI, a pipeline schedule plus `rules:` and a `resource_group` gives the same shape:

```yaml title=".gitlab-ci.yml"
agent-dep-triage:
  stage: agents
  image: registry.example.com/agent-jobs/dep-triage@sha256:REPLACE_WITH_DIGEST
  rules:
    - if: '$CI_PIPELINE_SOURCE == "schedule" && $AGENT_JOBS_ENABLED == "true" && $SCHEDULE_NAME == "dep-triage"'
  resource_group: agent-dep-triage
  timeout: 30m
  variables:
    JOB_NAME: dep-triage # the wrapper requires it; AGENT_JOBS_ENABLED comes from the project or group
  id_tokens:
    AGENT_OIDC:
      aud: https://vault.example.com
  script:
    - ./run-job.sh
```

`AGENT_JOBS_ENABLED` is a project or group CI variable, so disabling all agent jobs is one edit. `SCHEDULE_NAME` is a variable you set on the pipeline schedule itself, so one schedule cannot start another job's agent. Check the current docs for how your GitLab version orders `resource_group` jobs.

## Run budgets

Set every budget as a hard stop with a distinct exit status:

- Wall clock: `activeDeadlineSeconds`, `timeout:`, or `timeout-minutes`.
- Turns and tool calls per run (see [[bounded-agent-loops-and-stop-conditions]]).
- Tokens or spend per run, and runs per day across the fleet ([[llm-api-cost-control]]).
- Files and lines changed, so one run cannot produce an unreviewable diff.

A wrapper script keeps this honest and testable:

```bash title="run-job.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

: "${AGENT_JOBS_ENABLED:=false}"
: "${MAX_TURNS:=40}"
: "${RUN_KEY:=$(date -u +%F)-${JOB_NAME:?JOB_NAME required}}"

if [[ "$AGENT_JOBS_ENABLED" != "true" ]]; then
  echo "kill switch off; exiting 0" >&2
  ./bin/heartbeat --job "$JOB_NAME" --key "$RUN_KEY" --status disabled
  exit 0
fi

# Idempotency: skip if this run key already has an open proposal.
if ./bin/proposal-exists --key "$RUN_KEY"; then
  echo "proposal for $RUN_KEY exists; nothing to do" >&2
  ./bin/heartbeat --job "$JOB_NAME" --key "$RUN_KEY" --status noop
  exit 0
fi

timeout --signal=TERM --kill-after=60s 25m ./bin/agent-run \
  --max-turns "$MAX_TURNS" \
  --output-mode draft-proposal \
  --run-key "$RUN_KEY"

./bin/heartbeat --job "$JOB_NAME" --key "$RUN_KEY" --status done
```

`bin/agent-run`, `bin/proposal-exists`, `bin/heartbeat` and their flags are placeholders for whatever runner you use; check its current docs. Every exit path that is not a failure sends a heartbeat with its status, so the silence alert below fires only when the job truly did not run, and a `disabled` status that lasts longer than planned is visible.

## Kill switch

Build one that works without a deploy and test it on a schedule. Options, from fastest to most granular: `suspend: true` on the CronJob, disabling the pipeline schedule, a repository or group variable read at the start of every run, and revoking the job's identity. `suspend: true` stops new runs only; a Job that is already running keeps going until it finishes or hits `activeDeadlineSeconds`, so delete the running Job as well when you need it stopped now. Record who may flip it and where, and link it from [[runaway-or-compromised-ai-agent-response]].

## Alert on failure and on silence

A non-zero exit should notify the owning team. More important is the dead-man's switch: emit a heartbeat or expected artifact (a proposal, or an explicit "nothing to do" record) at the end of each run and alert when it is missing past the expected window. A job that exits 0 after doing nothing is a common failure. Track outcomes, not exit codes: proposals opened, proposals merged, proposals rejected, and cost per run ([[task-success-evaluation-for-agents]]).

## Logging for rollback

Log per run: trigger, scheduler run ID, commit SHA, prompt or template version ([[prompt-templates-and-versioning]]), model identifier, tool calls, outputs and cost. Keep prompt and output content under the retention and redaction rules in [[agent-session-transcript-handling]]. When a run goes wrong you need to know what it changed and which prompt version produced it.

## Failure modes

- Stored personal token with write access, so a prompt-injected issue can push code.
- `concurrencyPolicy` left at `Allow`; a slow run overlaps the next and both open proposals.
- Late run against a stale checkout after a scheduler outage, because no deadline was set.
- The schedule is silently disabled or paused by the platform, and nobody notices for weeks.
- Retries multiply token spend; no daily cap.
- Job reads untrusted text and a secret in the same context.
- Kill switch exists but was never exercised and no longer works.
- The CronJob is suspended but the Job already running is left to finish its changes.
- Agent output merged by an auto-merge rule nobody tied to human review.

## Review checklist

- [ ] The job has its own identity with the narrowest scope, preferably short-lived.
- [ ] Output is a draft MR, issue or comment; the default branch needs review the job cannot bypass.
- [ ] Triggers exclude fork-controlled events with write tokens.
- [ ] Outputs are keyed on a stable run key and re-runs update instead of duplicating.
- [ ] Overlap is prevented and missed windows are skipped, not run late.
- [ ] Wall-clock, turn, spend, diff-size and runs-per-day budgets are set and tested.
- [ ] A kill switch works without a deploy and has been exercised.
- [ ] Failure and missing-heartbeat alerts reach a named owner.
- [ ] Run logs record trigger, SHA, prompt version, tool calls and cost.
- [ ] Untrusted input is handled apart from secrets.

## Sources

- [Kubernetes: CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/) - `concurrencyPolicy`, `startingDeadlineSeconds`, `timeZone` and `suspend` semantics (confirm the exact wording and version matrix).
- [GitLab Docs: Scheduled pipelines](https://docs.gitlab.com/ci/pipelines/schedules/) - pipeline schedules and schedule variables.
- [GitLab Docs: Resource group](https://docs.gitlab.com/ci/resource_groups/) - limiting concurrency of jobs that share a resource group, and process modes.
- [NIST SP 800-218: Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - risk-based secure development practices behind the control framing.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
