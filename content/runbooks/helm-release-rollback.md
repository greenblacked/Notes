---
title: Helm release rollback
description: Roll back a Helm release with history and rollback, recover failed or pending-upgrade states, use atomic and wait, and revert in Git when Argo CD manages it.
type: runbook
tags:
  - runbooks
  - helm
  - kubernetes
  - gitops
  - reliability
created: 2026-10-16
modified: 2026-10-16
draft: false
---

How to undo a bad Helm release, and how to get a release out of a stuck state. Helm keeps each revision of a release as a Secret in the release namespace, which is what makes `helm rollback` possible. If Argo CD or Flux owns the release, the answer is different: see the GitOps section.

> [!info] Scope
> Flags were written from `helm <command> --help` for Helm 3 and the helm.sh documentation as known; the pages were not re-fetched, so the note is not marked `verified`. Check `helm rollback --help` on your version.

## When to use

- A `helm upgrade` released a bad version and you want the previous one back.
- A release is `failed`, or stuck in `pending-upgrade`, `pending-install` or `pending-rollback`, and further upgrades report "another operation is in progress".
- You need to choose between rollback and roll-forward.

If the pods are failing for a reason you do not yet know, diagnose with [[kubernetes-pod-troubleshooting]] before rolling back; a rollback changes nothing if the cause is outside the chart (a database, a secret, quota).

## Preconditions

- Access to the cluster and namespace, and the right context (`kubectl config current-context`).
- Helm 3 installed. Helm 3 stores release state in the cluster; there is no Tiller.
- You know whether the release is managed by GitOps. Check for Argo CD application labels or annotations:

```bash
RELEASE=my-app
NS=my-namespace
helm list -n "$NS" --all
kubectl get deploy -n "$NS" -l app.kubernetes.io/instance="$RELEASE" \
  -o jsonpath='{.items[*].metadata.labels}' ; echo
```

If `argocd.argoproj.io/instance` or a similar tracking label is present, go to the GitOps section.

## Steps

### 1. Look at the history

```bash
helm history "$RELEASE" -n "$NS" --max 20
helm status "$RELEASE" -n "$NS"
```

The columns that matter are `REVISION`, `STATUS` (`deployed`, `failed`, `superseded`, `pending-*`), `CHART`, `APP VERSION` and `DESCRIPTION`. Identify the last revision that was `deployed` and healthy. Compare it with the current one:

```bash
helm get values "$RELEASE" -n "$NS" --revision 7 > rev7-values.yaml
helm get values "$RELEASE" -n "$NS" --revision 8 > rev8-values.yaml
diff rev7-values.yaml rev8-values.yaml
helm get manifest "$RELEASE" -n "$NS" --revision 7 > rev7.yaml
helm get manifest "$RELEASE" -n "$NS" --revision 8 > rev8.yaml
diff rev7.yaml rev8.yaml
```

### 2. Roll back

```bash
REVISION=7
helm rollback "$RELEASE" "$REVISION" -n "$NS" --wait --timeout 5m
```

`helm rollback` creates a **new** revision (for example 9) with the content of revision 7; history is never rewritten. `--wait` blocks until the resources are ready, and the command fails if they are not within `--timeout`. Add `--cleanup-on-fail` to remove resources created during a failed rollback, and `--dry-run` to preview. Without a revision number, Helm rolls back to the previous one.

Rollback restores the manifests Helm rendered, with the values of that revision, not anything outside the release.

> [!warning] What a rollback does not undo
> Database migrations, data written by the new version, CRDs, objects created by hooks, changes made by hand with `kubectl`, ConfigMaps or Secrets managed outside the release, and PVC contents. If the new version migrated a schema, check backward compatibility before rolling back, which is why [[zero-downtime-deployments-kubernetes|zero-downtime deployments]] rely on expand-and-contract migrations.

### 3. Roll forward instead

Prefer rolling forward when rollback would re-introduce a worse problem, or the previous revision also had an issue. Fix the chart or values and run:

```bash
helm upgrade "$RELEASE" ./chart -n "$NS" -f values.yaml --atomic --timeout 5m
```

### 4. Use atomic and wait to avoid needing this

For future upgrades, let Helm do the rollback itself on failure:

```bash
helm upgrade --install "$RELEASE" ./chart -n "$NS" \
  -f values.yaml \
  --atomic --timeout 5m --cleanup-on-fail
```

`--atomic` waits for readiness and rolls back automatically if the upgrade fails or times out (it implies `--wait`). Set `--timeout` longer than your slowest readiness path (image pull plus startup probe). Atomic does not protect against a version that becomes ready but is functionally broken; that needs smoke tests and monitoring, and is what [[production-change-checklist]] covers. In CI, add `helm lint`, `helm template | kubeconform` and a diff step first; see [[helm-chart-conventions]].

### 5. Release stuck in pending or failed

**`failed`:** a failed upgrade leaves the last good revision as `superseded` and the failed one as `failed`. A new `helm upgrade` works. If it is a failed first install, use `helm uninstall` (after checking what it created) or `helm upgrade --install`.

**`pending-install`, `pending-upgrade`, `pending-rollback`:** a previous Helm process was killed (CI cancelled, a lost connection) and the release is locked. `helm upgrade` fails with `another operation (install/upgrade/rollback) is in progress`. First check nothing is running, then:

```bash
helm history "$RELEASE" -n "$NS"
helm rollback "$RELEASE" <last-deployed-revision> -n "$NS"
```

If rollback is also refused, back up the stuck release Secret, then delete only the stuck revision's Secret:

```bash
kubectl get secret -n "$NS" -l owner=helm,name="$RELEASE" --show-labels
kubectl get secret sh.helm.release.v1."$RELEASE".v9 -n "$NS" -o yaml > helm-secret-v9-backup.yaml
kubectl delete secret sh.helm.release.v1."$RELEASE".v9 -n "$NS"
```

This edits Helm's bookkeeping, not the workload, and is a last resort. Re-run `helm history`, and then upgrade.

### 6. GitOps: Argo CD manages the release

When Argo CD (or Flux) renders and applies the chart, the Git repository is the source of truth. Do not use `helm rollback` or `argocd app rollback` as the real fix: auto-sync will reapply Git state, or the rollback will show as drift. The correct rollback is a revert commit.

```bash
git revert <bad-commit-sha>
git push origin main        # via merge request if main is protected
```

Argo CD syncs the revert. To act faster while the merge request is reviewed, pause auto-sync and sync from the reverted revision, then restore the setting:

```bash
APP=my-app
argocd app set "$APP" --sync-policy none
argocd app sync "$APP" --revision <good-commit-sha>
# after the revert is merged:
argocd app set "$APP" --sync-policy automated
```

`argocd app rollback` exists but requires auto-sync to be disabled, and is a temporary measure only. The reasoning for GitOps is in [[0001-gitops-with-argocd]] and the tool trade-offs in [[argocd-vs-flux]].

### 7. CRD caveats

Helm installs CRDs from a chart's `crds/` directory only on first install. It does **not** upgrade or delete them on `helm upgrade`, `rollback` or `uninstall`. So:

- Rolling back a chart does not roll back its CRDs. A new CRD version stays in the cluster, and custom resources written in a new schema may not match the old controller.
- Upgrade CRDs separately (`kubectl apply --server-side -f crds/`), and make changes backward compatible, before the controller upgrade.
- Never delete a CRD to "fix" a release: it deletes every custom resource of that kind. Take a backup first (`kubectl get <kind> -A -o yaml > backup.yaml`).
- Charts that template CRDs under `templates/` behave differently (they are upgraded, and deleted on uninstall); read the chart before relying on either.

## Validation

```bash
helm history "$RELEASE" -n "$NS" --max 5          # new top revision: deployed, description "Rollback to 7"
helm status "$RELEASE" -n "$NS"                   # STATUS: deployed
kubectl rollout status deployment/"$RELEASE" -n "$NS" --timeout=300s
kubectl get pods -n "$NS" -l app.kubernetes.io/instance="$RELEASE"
helm get manifest "$RELEASE" -n "$NS" | diff - rev7.yaml && echo "manifest matches rev 7"
```

Then check the application signals: error rate, latency, and the version endpoint, and run the same smoke test the pipeline uses. For a GitOps release, also check the app is `Synced` and `Healthy` in Argo CD.

## Rollback

Rolling back a rollback is another `helm rollback` to the revision you left (for example 8), because each rollback is a new revision. For a GitOps release, revert the revert. Backups taken above (values, manifests, Secret YAML) let you reconstruct a release by hand.

## Troubleshooting

| Symptom                                                   | Cause and fix                                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Error: UPGRADE FAILED: another operation is in progress` | Stuck `pending-*` state. Follow step 5.                                                                           |
| `Error: release has no deployed releases`                 | Only failed revisions exist. Fix the chart and run `helm upgrade --install`, or uninstall a failed first install. |
| `rollback` times out with `--wait`                        | The old revision is not ready either (missing config, quota, bad image). Diagnose with the pod runbook.           |
| After rollback, pods run old code but the database is new | A migration was not backward compatible. Roll forward with a fix, or restore data if safe.                        |
| `resource mapping not found` / `no matches for kind`      | A CRD is missing or was removed. Install the CRD first (step 7).                                                  |
| Argo CD shows OutOfSync after a manual rollback           | Expected. Revert in Git instead (step 6).                                                                         |
| `helm history` shows only 10 revisions                    | The default history limit prunes old ones. Set `--history-max` on upgrades if you need more.                      |
