---
title: Argo CD sync failure and drift
description: Diagnose an Argo CD application that is OutOfSync, Degraded or failing to sync, tell drift from bad manifests, fix it in Git, and roll back safely.
type: runbook
tags:
  - runbooks
  - gitops
  - kubernetes
  - incident-management
created: 2026-10-16
modified: 2026-10-16
draft: false
---

How to find out why an Argo CD application will not sync, or why a change keeps being undone, and how to fix it in Git rather than in the cluster. Argo CD is our delivery engine, see [[0001-gitops-with-argocd]] for the decision and [[argocd-vs-flux]] for how it differs from Flux.

> [!info] Check the flags
> Commands were written from the Argo CD CLI as commonly documented and not re-checked against a running instance, so the note is not marked `verified`. Run `argocd app <command> --help` on your installed Argo CD version before relying on a flag.

## When to use

- An application shows `OutOfSync` or `Degraded`, or a sync fails or hangs.
- A manual change in the cluster keeps being reverted.
- A rollback of another note, such as a network policy in [[kubernetes-network-policies]], is silently undone by the controller.

If the application is healthy and you only need to undo a Helm release revision outside GitOps, use [[helm-release-rollback]]. If the pods are failing for a reason you do not yet know, start with [[kubernetes-pod-troubleshooting]].

## Preconditions

- `argocd` CLI logged in (`argocd login` or SSO) with RBAC to get, sync and, for break-glass, update the application.
- Write access to the Git repository that holds the manifests, and a reviewer for the fix.
- `kubectl` access to the target cluster for read-only checks.

## Steps

Set the variables once:

```bash
APP=my-app
NS=my-namespace
```

### 1. Read the status and conditions

```bash
argocd app get "$APP"
```

Note the sync status (`Synced`, `OutOfSync`), the health status (`Healthy`, `Progressing`, `Degraded`, `Missing`), the last operation result and any conditions at the bottom. The first failing resource and its message are usually enough to classify the problem.

### 2. See the drift

```bash
argocd app diff "$APP"
```

The diff compares live state with what Git renders. An empty diff with a failing sync points at the sync operation (hooks, ordering, validation) rather than drift.

### 3. Classify the cause

| Cause                    | Signal                                                          | Fix                                                                                 |
| ------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Bad manifests            | Sync fails with a validation or render error                    | Fix the manifest or chart values in Git                                             |
| Hook or Job failure      | Sync stuck on a PreSync or PostSync hook, a failed Job          | Read the Job logs with `kubectl logs`, fix the cause in Git                         |
| Immutable field change   | Error that a field is immutable (Job, Service, StatefulSet)     | Replace the resource: use the Replace sync option for it, or delete it deliberately |
| CRD ordering             | Custom resource rejected because its CRD is not yet established | Use sync waves so the CRD applies first, or install CRDs separately                 |
| Resource changed by hand | `argocd app diff` shows a live change that Git does not have    | If it should stay, put it in Git; otherwise let self-heal revert it                 |

> [!warning] Self-heal reverts manual changes
> With automated sync and self-heal, Argo CD overwrites a `kubectl edit` or `kubectl delete` within moments. That is the intended behaviour, and the reason a quick manual fix appears to "not work".

### 4. Fix in Git, then sync

Commit the fix through the normal merge request. With automated sync the controller picks it up; otherwise sync explicitly:

```bash
argocd app sync "$APP"
argocd app wait "$APP" --health --timeout 300
```

### 5. Break-glass: act in the cluster

Only when the incident cannot wait for a merge. Pause reconciliation, act, then restore it:

```bash
argocd app set "$APP" --sync-policy none
# make the emergency change with kubectl here, and record it in the incident doc
```

If the Application is itself managed by a parent app (app-of-apps) or an ApplicationSet, disable auto-sync on the parent too (or follow your ApplicationSet's override procedure), otherwise the parent restores the child's sync policy from Git. Confirm with `argocd app get "$APP"` that `Sync Policy:` shows `Manual` and no longer `Automated` before changing anything.

Afterwards put the same change in Git, then restore the policy. Check the policy the application had before pausing (`argocd app get "$APP" -o yaml`) and set it back, for example by re-enabling automated sync with `argocd app set "$APP" --sync-policy automated`. If you skip the Git change, the next sync reverts your fix.

### 6. History and rollback

```bash
argocd app history "$APP"
argocd app rollback "$APP" <ID>
```

`argocd app rollback` only works with automated sync disabled, because otherwise the controller syncs back to Git straight away. Treat it as a short-term measure and make Git match, as in [Rollback](#rollback).

## Validation

- `argocd app get "$APP"` shows `Synced` and `Healthy`.
- `argocd app diff "$APP"` is empty.
- The workload is rolled out:

```bash
kubectl rollout status deployment/my-app -n "$NS"
```

## Rollback

Revert the Git commit that introduced the problem and let Argo CD sync it. This is the durable rollback. Use `argocd app rollback` only as a bridge with auto-sync disabled, and restore the sync policy afterwards. For Helm-managed workloads see the GitOps section of [[helm-release-rollback]].

## Troubleshooting

| Symptom                              | Likely cause and fix                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `OutOfSync` again right after a sync | Another controller or a mutating webhook changes the field; add an ignore-differences rule for that field   |
| `Progressing` forever                | A resource never becomes ready (image pull, probe, quota); diagnose with [[kubernetes-pod-troubleshooting]] |
| My `kubectl` change disappeared      | Self-heal reverted it; make the change in Git, or pause the policy as in step 5                             |
| Sync fails on a custom resource      | CRD not yet applied; order it with sync waves                                                               |
| `argocd app rollback` refuses to run | Automated sync is on; disable it first, see step 5                                                          |
| Permission denied from the CLI       | Missing project or application RBAC; ask the Argo CD admin, do not share an admin token                     |
