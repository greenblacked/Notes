---
title: Game day and chaos experiments on GKE
description: Plan, run and review a scoped failure experiment on GKE with a hypothesis, abort rule, Chaos Mesh pod fault and a zonal drill, staging first.
type: runbook
tags:
  - runbooks
  - gke
  - kubernetes
  - reliability
  - incident-management
created: 2026-10-17
modified: 2026-10-17
draft: false
---

A game day is a planned, bounded failure. You break one thing on purpose, with people watching, and learn whether your alerts, runbooks and rollbacks work. It is the calm counterpart to [[incident-response]]: the same skills, but you choose the time, the size and the stop condition. Run it before a real incident does it for you.

> [!info] Scope and what is not verified
> This note covers planning, running and reviewing one scoped experiment on GKE. The `kubectl` and `gcloud` commands are standard. The Chaos Mesh manifest was written from memory of the `chaos-mesh.org/v1alpha1` API and was not run. Check `kubectl explain podchaos.spec` against your installed CRDs for field names, actions, modes and which actions honour `duration`. Whether the Google SRE Workbook has a chapter on game days was not checked, so this note does not cite it. The note is not marked `verified`.

## When to use

- You have a new or changed runbook, failover path or rollback and want proof that it works.
- A service is about to pass a [[production-readiness-review]] and claims it survives a pod, node or zone loss.
- After an incident, to confirm that a fix and its alert really work.
- Not when the error budget is spent, during a change freeze, or when the on-call engineer is already busy. See [[error-budget-policy]].

Staging first, always. Production only when staging passed, the error budget has room, and the rollback below is written and tested.

## Hypothesis and steady state

Write the hypothesis before touching anything. A good one names the failure, the expected behaviour and the number that proves it.

Steady state is the set of signals that say "healthy" right now: request success rate, latency p95, ready replicas, queue depth. Record their normal values before the experiment, from the same dashboards the observer will watch.

Copy this template into the game day ticket.

```text title="Game day experiment template"
Name:              <short name, e.g. payments-api single pod loss>
Date and window:   <date, start-end in UTC, inside business hours>
Environment:       <staging | production>
Service and owner: <service, owning team, owner name>

Hypothesis:        When <failure> happens to <target>, <expected behaviour>
                   and <steady-state signal> stays <within threshold>.
Steady state:      success rate <value>, p95 latency <value>, ready replicas <n>
                   (read from <dashboard link> before the start)

Blast radius:      <namespace, label selector, max pods or nodes, duration>
Abort conditions:  error rate above 2% for 3 minutes; <other signal>; any
                   unplanned page; observer or IC calls abort
Rollback:          <exact command that undoes the injection>

Roles:             driver <name>, observer <name>, incident commander <name>
Pre-flight done:   <yes/no, link to checklist>
Evidence:          <where screenshots, logs and the timeline are saved>

Result:            <hypothesis held | partly | failed>
Actions:           <links to tickets>
```

## Blast radius and abort conditions

Keep the blast radius smaller than you think you need.

- **One namespace**, one label selector, one failure type at a time.
- **Smallest target that tests the hypothesis**: one pod before one node, one node before one zone.
- **A fixed duration** with a hard end, so a forgotten experiment cleans itself up.
- **Customers**: staging has none. In production, pick the quietest window with staff present and tell support first.

The abort rule must be a number, written down in advance, and watched by someone other than the driver. This note uses **HTTP 5xx error rate above 2% for 3 minutes**. Encode it as an alert so nobody has to compare numbers by eye.

```yaml title="game-day-abort-rule.yaml"
# CHANGE: the metric name and labels to your service's request counter.
# CHANGE: the namespace to the one under test.
groups:
  - name: game-day
    rules:
      - alert: GameDayAbortErrorRate
        expr: |
          sum(rate(http_requests_total{namespace="payments-staging", code=~"5.."}[1m]))
            /
          sum(rate(http_requests_total{namespace="payments-staging"}[1m]))
            > 0.02
        for: 3m
        labels:
          severity: page
          game_day: "true"
        annotations:
          summary: Game day abort rule fired, stop the experiment and roll back.
```

> [!warning] Abort means abort
> When the rule fires, the driver rolls back at once and does not wait to see if it recovers. Debate afterwards. If the abort rule never fires but real users are hurt, the observer calls abort anyway.

## Roles

| Role                    | Does                                                                                           | Does not                   |
| ----------------------- | ---------------------------------------------------------------------------------------------- | -------------------------- |
| Driver                  | Runs the injection and the rollback, narrates each command in the channel.                     | Judge whether to continue. |
| Observer                | Watches dashboards and alerts, keeps the timeline, calls abort when a condition is met.        | Touch the cluster.         |
| Incident commander (IC) | Owns the go and no-go decision, owns communication, takes over if the experiment becomes real. | Run commands.              |

Three people at minimum, and the IC should not be the driver. If a real incident starts during the window, the game day stops and the normal [[incident-response]] process takes over.

## Pre-flight checklist

Run this the day before and again 15 minutes before the start. Do not start with any unchecked box.

- [ ] Hypothesis, blast radius, abort rule and rollback written in the ticket and agreed by the service owner.
- [ ] Error budget checked for production, with room for the planned impact ([[error-budget-policy]]).
- [ ] No change freeze, release, migration or other game day in the window ([[change-freezes-and-maintenance-windows]]).
- [ ] Steady state recorded; dashboards and the abort alert tested by watching them in staging.
- [ ] Target has more than one replica and a PodDisruptionBudget; readiness probes exist ([[zero-downtime-deployments-kubernetes]]).
- [ ] Rollback command tested in staging; the driver has cluster access and the observer does not need it.
- [ ] Support, on-call and neighbouring teams told (production only).
- [ ] Recording channel open; everybody can see the same dashboards.

Check the starting state and keep these two commands open for the whole run.

```bash
NS=payments-staging
APP=payments-api

kubectl get pods -n "$NS" -l app.kubernetes.io/name="$APP" -o wide
kubectl get pods -n "$NS" -l app.kubernetes.io/name="$APP" -w
```

## Injection

### Pod fault with Chaos Mesh

Chaos Mesh is a CNCF project that injects faults through custom resources. Install it with Helm into its own namespace, pin the chart version in your GitOps repo, and restrict it to the namespaces you allow. Check the project's installation and security documentation for the current options; they were not re-read for this note.

This `PodChaos` makes one pod unavailable for two minutes, only in one namespace, only for one app.

```yaml title="podchaos-payments-api.yaml"
# CHANGE: namespace and labels to the target. Keep it to ONE namespace.
apiVersion: chaos-mesh.org/v1alpha1
kind: PodChaos
metadata:
  name: game-day-payments-api-pod-failure
  namespace: payments-staging
  labels:
    game-day: "2026-10"
spec:
  action: pod-failure
  mode: one
  duration: 2m
  selector:
    namespaces:
      - payments-staging
    labelSelectors:
      app.kubernetes.io/name: payments-api
```

`mode: one` selects a single pod at random from those matching. `duration: 2m` ends the fault by itself. Not verified: the field names, the available modes, and whether your Chaos Mesh version supports `duration` for the action you choose (for example `pod-kill` is a one-off action, `pod-failure` lasts for the duration). Run `kubectl explain podchaos.spec` and a dry run in staging before the real one.

Apply it, then watch the pods and the rollout.

```bash
kubectl apply -f podchaos-payments-api.yaml

kubectl get pods -n "$NS" -l app.kubernetes.io/name="$APP" -w
kubectl rollout status deployment/"$APP" -n "$NS" --timeout=300s
kubectl get podchaos -n "$NS"
```

`kubectl rollout status` returns when the Deployment has all replicas updated and available, so it is a quick way to see recovery. If the Deployment had no rollout, it reports success as soon as the replicas are ready.

> [!tip] Restrict who can create chaos
> A `PodChaos` that can select any namespace is a production outage waiting for a typo. Limit Chaos Mesh to allowed namespaces, give creation rights to the driver group only, and have admission policy reject chaos objects in production namespaces outside a game day window ([[conftest-policy-gate-for-manifests]] shows the policy pattern).

### Zonal failure drill

This drill tests the question every regional GKE cluster asks: what happens when one zone is gone? You cannot switch off a Google zone, so you simulate it. Cordon every node in one zone so nothing new lands there, then drain them so their pods move.

```bash
NS=payments-staging
APP=payments-api
ZONE=europe-west1-b   # CHANGE: the zone to "lose"

# 1. List the nodes in that zone
kubectl get nodes -l topology.kubernetes.io/zone="$ZONE" -o name

# 2. Cordon: no new pods are scheduled there
kubectl cordon -l topology.kubernetes.io/zone="$ZONE"

# 3. Drain: evict pods, respecting PodDisruptionBudgets
for n in $(kubectl get nodes -l topology.kubernetes.io/zone="$ZONE" -o name); do
  kubectl drain "$n" --ignore-daemonsets --delete-emptydir-data --timeout=300s
done

# 4. Watch the workload recover in the remaining zones
kubectl get pods -n "$NS" -l app.kubernetes.io/name="$APP" -o wide -w
kubectl rollout status deployment/"$APP" -n "$NS" --timeout=300s
```

`kubectl drain` honours PodDisruptionBudgets and waits, so a drain that hangs is already a finding: the budget or the spread is wrong. Pods using `emptyDir` lose that data, so run this only against workloads where that is acceptable.

The drill is not a real zone outage. It does not remove load balancer backends in the zone, does not cut network paths, and does not take down zonal disks or Cloud SQL replicas. Say so in the report so nobody over-trusts the result. Autoscaled node pools may also add new nodes in the other zones, which a real zone loss would also cause. Check capacity and quota beforehand ([[kubernetes-autoscaling]]).

Expect the hypothesis to look like this, and write down the real numbers next to each row.

| Time (illustrative) | Event                                         | Expected                                       | Observed (fill in) |
| ------------------- | --------------------------------------------- | ---------------------------------------------- | ------------------ |
| T+0                 | Steady state recorded                         | Success rate and replicas at baseline          |                    |
| T+1 min             | Cordon of all nodes in the zone               | No new pods in the zone; no user impact        |                    |
| T+2 min             | Drain starts                                  | Pods evicted one PDB-respecting step at a time |                    |
| T+5 min             | Replacement pods scheduled in the other zones | Ready replicas back to target                  |                    |
| T+8 min             | Error rate and latency checked                | Below the 2% abort threshold throughout        |                    |
| T+10 min            | Hypothesis judged held, partly or failed      | IC decides                                     |                    |
| T+12 min            | Uncordon, pods may rebalance later            | Nodes `Ready,SchedulingEnabled`                |                    |

## Evidence capture

Write while it happens, not after. The observer keeps a running timeline with a UTC time for each event.

- Screenshots of the dashboards at steady state, at the peak of impact and after recovery, with the time range visible.
- The alerts that fired and the time each one fired, and the ones that should have fired and did not.
- Command output, saved as text: `kubectl get pods -w`, `kubectl rollout status`, `kubectl get events -n "$NS" --sort-by=.lastTimestamp`.
- Logs from the affected pods and the ingress during the window.
- The decisions made, who made them and why.

```bash
kubectl get events -n "$NS" --sort-by=.lastTimestamp > game-day-events.txt
kubectl logs -n "$NS" -l app.kubernetes.io/name="$APP" --since=30m --all-containers > game-day-logs.txt
```

Store files with the ticket, not on a laptop. Redact customer data before saving anything from production.

## Abort and rollback

Abort when any condition in the ticket is met, or when the IC says so. The driver then removes the fault, and does not investigate first.

```bash
# Pod fault: delete the chaos object, which stops the fault
kubectl delete podchaos game-day-payments-api-pod-failure -n "$NS"

# Zonal drill: let nodes take pods again
kubectl uncordon -l topology.kubernetes.io/zone="$ZONE"

# Confirm recovery
kubectl rollout status deployment/"$APP" -n "$NS" --timeout=300s
kubectl get pods -n "$NS" -l app.kubernetes.io/name="$APP" -o wide
```

If the experiment came with a Helm or Argo CD change, undo that with [[helm-release-rollback]]. If the abort does not restore the service, stop calling it a game day: the IC declares an incident and the on-call follows [[incident-response]]. After the abort, the experiment is only finished when steady-state values are back to the recorded baseline and the abort alert has resolved.

> [!warning] Rollback must be tested
> An untested rollback is a hypothesis too. Run it once in staging, with the same person who will run it in production, before the production run.

## Review and actions

Hold the review the same day or the next, while memory is fresh. Use the blameless format from [[blameless-postmortems]]: the system and the process are the subject, not the people.

1. Was the hypothesis right? Compare the timeline with the expected behaviour.
2. Which alerts fired, late, or not at all?
3. Which runbook steps were missing, wrong or unclear?
4. Was the abort rule enough? Did anyone want to abort earlier?
5. What would make the next run smaller, cheaper or safer?

Record every follow-up in an action log, each with an owner and a date, and link it to the postmortem record.

| ID  | Action                                        | Owner  | Due    | Ticket link | Status |
| --- | --------------------------------------------- | ------ | ------ | ----------- | ------ |
| A1  | Add a PodDisruptionBudget to `payments-api`   | <name> | <date> | <link>      | open   |
| A2  | Alert on ready replicas below 2 for 5 minutes | <name> | <date> | <link>      | open   |
| A3  | Fix step 4 of the pod troubleshooting runbook | <name> | <date> | <link>      | open   |

Rows are examples; replace them with your own findings. Re-run the same experiment after the high-priority actions land, and note that the result changed. Findings that need a service to change before production belong in the [[production-readiness-review]].

## Related

- [[incident-response]]
- [[blameless-postmortems]]
- [[error-budget-policy]]
- [[production-readiness-review]]
- [[zero-downtime-deployments-kubernetes]]
- [[kubernetes-pod-troubleshooting]]
- [[helm-release-rollback]]
