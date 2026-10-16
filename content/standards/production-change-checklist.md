---
title: Production change checklist
description: Standard for planning, executing, verifying and communicating production changes, with a risk classification table and a copy-paste checklist.
type: standard
tags:
  - standards
  - reliability
  - delivery
created: 2026-10-16
modified: 2026-10-16
draft: false
---

Most outages follow a change. This standard sets the minimum bar for changing production so that changes are reviewable, reversible and visible. It applies to application deployments, infrastructure changes, configuration and data migrations. Reviewers use it together with [[code-review]].

## Risk classification

Classify every change before it starts. If unsure, pick the higher class.

| Class  | Examples                                                                                                                                         | Requirements                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Low    | Standard deploy via pipeline, feature flag toggle, config with fast revert                                                                       | Peer review of the MR, automated checks green, rollback is a redeploy or flag flip                                                      |
| Medium | New dependency, schema additive migration, scaling or resource changes, IAM change within a project                                              | Low plus a written rollback plan, a named second person aware, post-checks recorded                                                     |
| High   | Cluster or node pool upgrade, network or DNS changes, destructive or non-reversible migrations, shared infrastructure, changes to authentication | Medium plus change ticket, approval by a service owner or manager, change window, communication to stakeholders, an engineer on standby |

A change is automatically High if it cannot be undone, touches data that cannot be recreated, or affects more than one service's availability. See [[gke-cluster-upgrade]] for an example of a High change.

## Pre-checks

- The change is described: what, why, expected effect and who is affected.
- The MR or plan is reviewed. For Terraform, the plan output is attached and read, not skimmed.
- Tests and linters pass; the same artefact has run in a lower environment.
- Dependencies are healthy: dashboards and alerts are green before you start. Do not change a system that is already degraded unless the change is the fix.
- Backups or snapshots exist for stateful changes, and restore has been tested at least once.
- Rollback plan is written and, for Medium and High, rehearsed or reasoned through.
- On-call is aware and no active incident is in progress.
- Capacity checked: quotas, node headroom and rate limits.

## Implementation

- Change one thing at a time. Do not bundle unrelated changes.
- Use the pipeline. Manual changes need a reason, a second pair of eyes and a record of every command.
- Roll out progressively: canary, one environment or one region first, then widen (see [[zero-downtime-deployments-kubernetes]]).
- Keep a running log with timestamps in the change ticket or channel.
- Define a stop condition before starting, for example error rate above X for Y minutes, and stick to it.

## Post-checks

Verify with data, not feelings. Wait long enough to see steady state.

- Health endpoints, rollout status and pod readiness.
- Golden signals against the pre-change baseline: error rate, latency, saturation, traffic.
- Alerts quiet; no new error patterns in logs.
- Business check where relevant: a real transaction succeeds.
- Record the result in the ticket and close the change.

```bash
NAMESPACE=shop
DEPLOYMENT=api
kubectl -n "$NAMESPACE" rollout status deployment/"$DEPLOYMENT" --timeout=300s
kubectl -n "$NAMESPACE" get pods -l app="$DEPLOYMENT"
kubectl -n "$NAMESPACE" get events --sort-by=.lastTimestamp | tail -n 20
```

## Rollback plan

Every Medium and High change has a rollback plan that says:

- the trigger: which signal or threshold causes rollback, and who decides;
- the steps, with exact commands or MR to revert (for Helm see [[helm-release-rollback]]);
- the time budget: how long rollback takes and the point of no return;
- data implications: can the data be restored, are migrations backward compatible;
- who is on standby.

Prefer forward-compatible changes (expand, migrate, contract) so rollback of code does not need rollback of data. If rollback is impossible, say so and treat the change as High with extra approval.

## Communication

- Before: announce High changes in the agreed channel with the window, impact and contact person. Tell support if customers could notice.
- During: post start, milestones and finish. If you stop or roll back, say so immediately.
- After: confirm completion and any follow-ups. If the change caused an incident, follow [[incident-response]] and [[blameless-postmortems]].

## Change windows and freezes

- High changes run in the agreed window, in business hours with the team present, not on Friday afternoons or before holidays.
- Low changes may run at any time the pipeline allows, provided on-call is not handling an incident.
- Change freezes (peak trading periods, major launches, year end) are announced in advance. During a freeze only emergency changes proceed, approved by a manager and recorded as such.
- Emergency changes (to stop an active incident) skip the window but not the log, and get a retrospective review within a week.

## Copy-paste checklist

Paste this into the MR description or change ticket.

```markdown title="change-checklist.md"
### Change summary

- What / why:
- Risk class: Low / Medium / High
- Affected services:
- Window: <date, time, timezone>
- Owner / on standby:

### Pre-checks

- [ ] MR reviewed; plan or diff attached and read
- [ ] Tests and linters green; verified in lower environment
- [ ] Dashboards and alerts healthy before start
- [ ] Backup or snapshot exists (stateful changes)
- [ ] Quotas and capacity checked
- [ ] On-call informed; no active incident
- [ ] Rollback plan written (Medium/High)
- [ ] Approval obtained (High)

### Implementation

- [ ] Stop condition defined: <signal and threshold>
- [ ] Progressive rollout: <canary / env / region order>
- [ ] Actions logged with timestamps

### Post-checks

- [ ] Rollout complete, pods ready
- [ ] Error rate, latency, saturation at baseline
- [ ] No new alerts or log errors
- [ ] Functional smoke test passed

### Rollback

- Trigger:
- Steps:
- Time to roll back:

### Communication

- [ ] Announced before (High)
- [ ] Completion posted
- [ ] Follow-up tickets created
```
