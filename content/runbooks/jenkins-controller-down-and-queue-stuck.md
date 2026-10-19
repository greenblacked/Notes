---
title: Jenkins controller down or build queue stuck
description: "Triage an unresponsive Jenkins controller or a queue that never drains, tell controller faults from agent faults, and restart without losing builds."
type: runbook
tags:
  - runbooks
  - jenkins
  - ci-cd
  - reliability
  - incident-management
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Two symptoms, often confused: the controller itself does not respond (or responds slowly), or the controller is fine but builds sit in the queue and nothing runs. The fix paths differ. This runbook separates controller faults (disk, heap, plugins) from agent faults (labels, Pod limits, connection drops), and ends with a restart that does not throw away running builds.

> [!info] Scope and verification
> The commands below were not run against a live Jenkins when this note was written, and the note is not marked `verified`. Endpoint behaviour, such as how `/quietDown` and `/safeRestart` authenticate, can differ between LTS releases and plugin sets. Check the Jenkins documentation for your LTS line before use.

## When to use

- `jenkins.example.com` times out, returns 502/503, or the UI loads but pages hang.
- The build queue grows and builds show "Waiting for next available executor" or "There are no nodes with the label ...".
- Agents show offline, or Kubernetes agent Pods stay Pending.
- Jobs started to fail right after a plugin or core update.

## Preconditions

- An admin API token for a user with read access to the queue and nodes (and admin for restarts), kept in a secret store and exported into the shell environment, never typed into a command line.
- Shell or `kubectl` access to the controller host or Pod.
- A recent backup of `JENKINS_HOME` (at least `config.xml`, `jobs/`, `plugins/`, `credentials.xml`, `secrets/`) and a note of the installed plugin versions.
- The incident is declared if production deployments are blocked, see [[incident-response]].

```bash
JENKINS_URL=https://jenkins.example.com
: "${JENKINS_USER:?export JENKINS_USER}" "${JENKINS_TOKEN:?export JENKINS_TOKEN from the secret store}"
NS=jenkins                                   # namespace if the controller runs on Kubernetes
CONTROLLER=jenkins-0                         # controller Pod name
```

## Steps

> [!note] Credentials on the command line
> Passing a token with `-u` puts it in the process arguments, where other users on a shared host can read it. On a shared host use a `~/.netrc` file with mode 600 and `curl -n`, or a header file passed with `-H @file`.

### 1. Confirm controller health

```bash
curl -sS -o /dev/null -w "login: %{http_code} in %{time_total}s\n" "$JENKINS_URL/login"
curl -sS -o /dev/null -w "api: %{http_code} in %{time_total}s\n" \
  -u "$JENKINS_USER:$JENKINS_TOKEN" "$JENKINS_URL/api/json?tree=mode"

# Kubernetes install
kubectl -n "$NS" get pod "$CONTROLLER" -o wide
kubectl -n "$NS" describe pod "$CONTROLLER" | sed -n '/Events:/,$p'
kubectl -n "$NS" logs "$CONTROLLER" --tail=200
```

Interpretation:

- The login page answers but `api/json` is slow: the controller is alive but starved (heap, disk or a stuck plugin).
- 502/503 from the proxy: the controller process is down or restarting. Check the Pod state and the previous container's logs.
- The Pod is `CrashLoopBackOff` or `OOMKilled`: go to step 3 for the heap, and [[kubernetes-pod-troubleshooting]] for the Pod mechanics.

### 2. Read the queue and the agents through the API

```bash
# Why is each item waiting?
curl -sS -u "$JENKINS_USER:$JENKINS_TOKEN" "$JENKINS_URL/queue/api/json" \
  | jq '.items[] | {id, task: .task.name, why, stuck, blocked, inQueueSince}'

# Agent state
curl -sS -u "$JENKINS_USER:$JENKINS_TOKEN" "$JENKINS_URL/computer/api/json?tree=computer[displayName,offline,offlineCauseReason,numExecutors]" \
  | jq '.computer[]'
```

The `why` field names the reason. Group the queue by it: many items "waiting for next available executor" means a capacity problem; "There are no nodes with the label" means a label no agent provides; items blocked by an upstream build point at a long-running job holding a lock or a throttle.

### 3. Controller-side causes

Work through the usual three.

**Disk.** A full `JENKINS_HOME` makes the controller stall or fail on writes.

```bash
kubectl -n "$NS" exec "$CONTROLLER" -- df -h /var/jenkins_home
kubectl -n "$NS" exec "$CONTROLLER" -- sh -c 'du -xh --max-depth=2 /var/jenkins_home | sort -h | tail -15'
```

Typical weight: old build records and artifacts kept without a limit, workspaces on the controller, and logs. Fix with build discarders and moving workspaces to agents; free space first, and never delete job directories blindly. If the volume must be grown, that is a planned change.

**Heap and garbage collection.** A controller near its heap limit spends its time in garbage collection and everything slows down.

```bash
kubectl -n "$NS" exec "$CONTROLLER" -- jcmd 1 GC.heap_info          # process id may differ; check with jcmd -l
kubectl -n "$NS" exec "$CONTROLLER" -- jcmd 1 Thread.print > /tmp/jenkins-threads.txt
```

Take two or three thread dumps a few seconds apart before restarting. Threads blocked on one lock, or many in a single plugin's classes, show the culprit. Keep the dumps; a restart destroys that evidence. Check the Jenkins system administration documentation for the supported way to set JVM options and for memory sizing guidance.

**Plugin errors after an update.** Look in the controller log and in the UI's "Manage Jenkins" administrative monitors for failed plugins, dependency errors and "loading" loops. A broken plugin can stop the controller loading jobs. Compare the installed set with the backup you noted.

### 4. Agent-side causes

If the controller is healthy but the queue is stuck, look at who is supposed to run the work.

- **Label mismatch.** The job asks for a label that no online agent provides. Check the `why` text and the label expression on the job or in the shared library; see [[jenkins-shared-libraries]] for where labels are often set.
- **Offline agents.** `offlineCauseReason` in the node API says why. Reconnect or replace them. Agent connection drops often come from a proxy or load balancer idle timeout, or from the controller being briefly unresponsive.
- **Kubernetes plugin limits.** Check the cloud configuration for the container cap and the Pod retention settings. Hitting the cap makes builds queue by design.
- **Agent Pods Pending.** The scheduler cannot place them:

```bash
kubectl -n "$NS" get pods -l jenkins=slave -o wide      # the label depends on your plugin configuration
kubectl -n "$NS" describe pod <pending-pod> | sed -n '/Events:/,$p'
kubectl -n "$NS" get resourcequota
```

`Insufficient cpu` or `Insufficient memory` points at node capacity or resource requests: see [[kubernetes-pod-troubleshooting]] and [[node-resource-pressure-triage]]. An exceeded quota means raising the quota or lowering agent requests. For hardening of the controller and agent model that prevents some of these issues, see [[jenkins-controller-and-agent-hardening]].

### 5. Restart safely

Prefer a graceful path over killing the process, so running builds finish or are restored.

> [!warning] Do not hard-kill the controller during a write
> Killing the Jenkins process or deleting its Pod while it writes to `JENKINS_HOME` can corrupt build records or XML job configuration. Use quiet down first, wait for running builds, then a safe restart. Only force a restart when the controller no longer responds at all, and take the backup beforehand.

The quiet-down and safe-restart endpoints require a POST, and authentication with a crumb or an API token. Check the behaviour for your LTS line in the Jenkins remote access API documentation.

```bash
# Stop starting new builds
curl -sS -X POST -u "$JENKINS_USER:$JENKINS_TOKEN" "$JENKINS_URL/quietDown"

# Wait until no builds are running
curl -sS -u "$JENKINS_USER:$JENKINS_TOKEN" "$JENKINS_URL/computer/api/json?tree=computer[executors[currentExecutable[url]],oneOffExecutors[currentExecutable[url]]]" \
  | jq '[.computer[] | ((.executors // []) + (.oneOffExecutors // []))[] | .currentExecutable] | map(select(. != null)) | length'

# Restart once idle, or when the maximum wait you chose has passed
curl -sS -X POST -u "$JENKINS_USER:$JENKINS_TOKEN" "$JENKINS_URL/safeRestart"

# If you need to cancel quiet down
curl -sS -X POST -u "$JENKINS_USER:$JENKINS_TOKEN" "$JENKINS_URL/cancelQuietDown"
```

Pipelines that use durable steps may resume after a restart, while freestyle builds in progress may not. Tell the teams which builds will need a re-run, and pause deployments to production until the controller is verified.

### 6. Roll back a plugin

If the problem began with a plugin update:

1. In the plugin manager, use the option to roll back to the previously installed version, if offered. Check the docs for your version.
2. Otherwise, restore the previous `.jpi` file for that plugin from the `JENKINS_HOME` backup into the `plugins/` directory with the controller stopped, and start it.
3. Pin the plugin version in your image or configuration-as-code so the next restart does not re-upgrade it, and record the plugin and version in the incident notes.

## Validation

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "$JENKINS_URL/login"
curl -sS -u "$JENKINS_USER:$JENKINS_TOKEN" "$JENKINS_URL/queue/api/json" | jq '.items | length'
curl -sS -u "$JENKINS_USER:$JENKINS_TOKEN" "$JENKINS_URL/computer/api/json?tree=computer[displayName,offline]" \
  | jq '[.computer[] | select(.offline)] | length'
```

- The queue length trends down and a trivial test job runs to completion on each agent label that matters.
- No agents are offline without a known reason, and new Kubernetes agent Pods start and finish.
- Heap and disk are below your alert thresholds, and the controller log shows no repeating exceptions.
- A real pipeline from each major team finished, including one that deploys to a non-production environment.

## Rollback

- **Restart made things worse:** restore the `JENKINS_HOME` backup for the affected paths, with the controller stopped. If you cannot tell which files are affected, restore the full backup and accept losing recent builds.
- **Plugin rolled back or pinned:** to undo, re-enable the previous pinned set from version control, not by hand in the UI.
- **Quiet down left active:** run `cancelQuietDown` or the equivalent in the UI. A forgotten quiet-down looks like a stuck queue.
- **Disk grown:** keep the old volume until the new one is validated.

## Troubleshooting

| Symptom                                    | Cause and fix                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| "Waiting for next available executor"      | No free executor on matching agents. Add capacity, or check the cloud limits and Pending Pods.     |
| "There are no nodes with the label '...'"  | Label typo or no agent offers it. Fix the label or provision the agent.                            |
| Controller `OOMKilled` or heap exhausted   | Heap too small or a leaking plugin. Take thread dumps, resize with a plan, remove the offender.    |
| UI works, builds never start after restart | Quiet down still on, or agents have not reconnected. Cancel quiet down and check node states.      |
| Disk full on `JENKINS_HOME`                | Old builds and artifacts. Add discarders, move artifacts out, grow the volume as a planned change. |
| 403 on `/safeRestart` with a token         | Missing POST or crumb, or the user lacks admin. Check the remote access API docs for your LTS.     |
| Agents drop every few minutes              | Proxy idle timeout or network flap. Check load balancer timeouts and agent logs.                   |
| Everything slow after a plugin update      | Roll back the plugin (step 6) and read the thread dumps before and after.                          |

## Related

- [[jenkins-controller-and-agent-hardening]] for the controller and agent model that reduces these failures.
- [[jenkins-shared-libraries]] for where labels and agent selection are usually defined.
- [[gitlab-ci-vs-jenkins]] for how queueing and executors compare with GitLab runners.
- [[kubernetes-pod-troubleshooting]] and [[node-resource-pressure-triage]] when agent Pods are Pending or evicted.
- [[incident-response]] for roles and updates.

## Sources

- [Jenkins remote access API](https://www.jenkins.io/doc/book/using/remote-access-api/)
- [Managing Jenkins](https://www.jenkins.io/doc/book/managing/)
- [Jenkins system administration](https://www.jenkins.io/doc/book/system-administration/)
- [Kubernetes plugin for Jenkins](https://plugins.jenkins.io/kubernetes/)
