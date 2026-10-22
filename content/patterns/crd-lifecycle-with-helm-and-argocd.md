---
title: CRD lifecycle with Helm and Argo CD
description: Install, upgrade, version and protect CustomResourceDefinitions with Helm and Argo CD, so operator upgrades never delete or strand custom resources.
type: pattern
tags:
  - patterns
  - kubernetes
  - helm
  - gitops
  - reliability
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Most platform add-ons are operators that ship CustomResourceDefinitions: cert-manager, External Secrets, Argo Rollouts, Kyverno, Prometheus Operator and many more. Their CRDs are the riskiest objects in the cluster. A CRD is cluster scoped and shared by every tenant, an operator upgrade often needs a newer CRD **before** the new controller starts, and deleting a CRD deletes every custom resource of that kind in every namespace. Helm deliberately does not upgrade or delete CRDs from a chart's `crds/` directory, and Argo CD adds its own ordering and apply-size rules. This note gives a lifecycle that works with both: how to ship CRDs, in which order to upgrade, how to move stored versions, and how to make accidental deletion hard.

> [!info] Scope and sources
> Helm, Kubernetes and Argo CD behaviour was checked against the upstream documentation sources of helm.sh, kubernetes.io and argo-cd.readthedocs.io on 2026-10-21, at their current (latest) versions. Nothing was run on a cluster. Where Helm 3 and Helm 4 differ, both are named.

> [!note] Not verified
> Whether Argo CD applies a Helm chart's `crds/` directory on every sync (and therefore upgrades CRDs where plain Helm would not) is not stated in the Argo CD pages that were checked; confirm it for your chart with `argocd app manifests`. Also not verified: the exact error text for an oversized `last-applied-configuration` annotation, the error a client gets while a conversion webhook is down, the release stage of the `StorageVersionMigrator` feature for your Kubernetes version, and what happens to stored fields when a CRD is re-applied with a narrower schema. Operator-specific upgrade steps and chart values are deliberately not given: read each chart's upgrade notes.

## Why CRDs need their own lifecycle

- **Cluster scoped and shared.** One CRD serves every namespace. Two teams installing the same operator at different versions fight over one object.
- **Deletion cascades.** Deleting a CRD removes its REST endpoint and deletes every object stored in it, across all namespaces. There is no undo short of a restore.
- **Order matters.** A controller built for schema version N+1 may crash or misbehave against a CRD at N, and custom resources using a new field are rejected (or silently pruned) by an older schema.
- **Versions are stateful.** A CRD can serve several API versions but stores each object in exactly one storage version. Dropping a version that still has stored objects is refused until they are migrated.

## Shipping CRDs with Helm: three options

| Option                                            | Install                 | Upgrade                 | Delete on uninstall                         | Use when                                                          |
| ------------------------------------------------- | ----------------------- | ----------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| `crds/` directory in the operator chart           | Yes, first install only | Never                   | Never                                       | Small, rarely changing CRDs; you upgrade them by hand             |
| CRDs as templates in `templates/`, behind a value | Yes                     | Yes, with the release   | Yes, unless `helm.sh/resource-policy: keep` | Chart vendors offer it; you want CRDs to follow the chart version |
| A separate CRD chart (or plain manifests)         | Yes                     | Yes, as its own release | Under your control                          | Recommended for shared operators in GitOps                        |

What Helm documents about the `crds/` directory:

- Files there are plain YAML and cannot be templated. On install, Helm creates the CRDs, waits until the API server makes them available, then renders the rest of the chart, so templates can create resources of the new kinds.
- CRDs are only created on install. If they already exist, regardless of version, Helm skips them with a warning. Helm never installs CRDs on upgrade or rollback, and never deletes them. This is an explicit decision to avoid unintended data loss; Helm's guidance is to upgrade or delete CRDs manually and with great care.
- `helm install --skip-crds` skips the directory; `helm template --include-crds` includes it in rendered output. `--dry-run` does not work well with new CRDs, because the discovery client does not know the new kinds yet.

CRDs in `templates/` behave like any other release object: upgraded on `helm upgrade`, removed on `helm uninstall` or when a later chart version drops them. That last part is the danger. Protect templated CRDs with the keep policy:

```yaml title="templates/crds/widgets.example.com.yaml (fragment)"
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: widgets.example.com
  annotations:
    helm.sh/resource-policy: keep
```

With `helm.sh/resource-policy: keep`, Helm skips deleting the object when an uninstall, upgrade or rollback would delete it. The object is then orphaned: Helm no longer manages it at all, and `helm install --replace` on a release name whose resources were kept can conflict with it. Treat a kept CRD as something you now own by hand or through the separate CRD release.

The recommended layout for shared operators is the third option: a small chart (or a directory of manifests) that contains only the CRDs, versioned with the operator, installed as its own release or Argo CD Application before the operator. Helm's best-practices page describes the same split. Many vendor charts expose a value to render CRDs from templates instead of `crds/`; read the chart's documentation for the name and behaviour, because they differ per chart. Chart structure rules are in [[helm-chart-conventions]] and [[helm-chart-standard]]; umbrella charts that pull in an operator as a dependency inherit all of this ([[helm-library-and-umbrella-charts]]).

### Helm 3 and Helm 4

Helm 4 uses server-side apply by default for new installs. On upgrade and rollback it keeps whatever apply method the release used before, so releases created by Helm 3 stay client-side after you move the client to Helm 4; `--server-side` overrides. Helm 4 also renames `--atomic` to `--rollback-on-failure` (the old flag still works with a deprecation warning). None of this changes the `crds/` rules above. Check `helm version` in CI and on laptops so the two do not mix silently on one release.

## Argo CD

Argo CD does not run `helm install`. It renders the chart (with `helm template`) and applies the resulting manifests itself, with its own ordering, pruning and health rules. So the Helm limitations above do not carry over one to one:

- `spec.source.helm.skipCrds: true` (or `argocd app set <app> --helm-skip-crds`) tells Argo CD to leave out the chart's `crds/` directory. Use it on the operator Application when a separate Application owns the CRDs.
- Whether the `crds/` directory is applied on every sync, and therefore upgraded on a chart bump, is not stated in the docs checked (see the callout above). Look at what Argo CD actually renders: `argocd app manifests <app> | grep -A2 'kind: CustomResourceDefinition'`.
- Argo CD maps Helm's old `crd-install` hook to its normal CRD handling, and other Helm hooks to its own phases (pre-install and pre-upgrade to PreSync, and so on).

### A separate Application for CRDs

```yaml title="apps/cert-manager-crds.yaml"
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: cert-manager-crds
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "-10"
spec:
  project: platform
  source:
    repoURL: https://git.example.com/platform/gitops.git # change: your GitOps repository
    targetRevision: main
    path: platform/cert-manager/crds/v1.0.0 # change: one directory per CRD version
  destination:
    server: https://kubernetes.default.svc
  syncPolicy:
    automated:
      prune: false # never delete a CRD because a file moved
      selfHeal: true
    syncOptions:
      - ServerSideApply=true
      - Prune=false
      - Delete=false
```

```yaml title="apps/cert-manager.yaml"
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: cert-manager
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "0"
spec:
  project: platform
  source:
    repoURL: https://charts.example.com/platform # change: your chart repository or OCI registry
    chart: cert-manager
    targetRevision: 1.0.0 # change: the chart version that matches the CRDs above
    helm:
      skipCrds: true
  destination:
    server: https://kubernetes.default.svc
    namespace: cert-manager
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
```

What the sync options do, as documented:

- `ServerSideApply=true` runs `kubectl apply --server-side --force-conflicts`. Large CRDs need it: client-side apply stores the whole object in the `kubectl.kubernetes.io/last-applied-configuration` annotation, and the total annotation size is limited to 262144 bytes, which big CRD schemas exceed.
- `Replace=true` uses `kubectl replace` or `create`. It also avoids the annotation, but the docs warn it can be destructive because resources may be recreated. Do not use it on CRDs; if both are set, `Replace=true` wins over `ServerSideApply=true`.
- `Prune=false` keeps a resource when it disappears from Git. `Delete=false` keeps it when the Application itself is deleted. `Prune=confirm` and `Delete=confirm` require a manual approval instead. Set them on the CRD Application, or per resource with the `argocd.argoproj.io/sync-options` annotation.
- `SkipDryRunOnMissingResource=true` lets a sync proceed when a custom resource's CRD is not in the same sync and not installed yet. When the CRD is part of the same sync, Argo CD skips the dry run for its custom resources on its own. When neither holds, the sync fails with `the server could not find the requested resource`.

### Sync waves across Applications do not wait by default

Within one Application, Argo CD applies resources wave by wave (lowest first, default wave 0), and waits for each wave to be synced and healthy before the next; pruning runs in reverse wave order. Across an app-of-apps, the waves above are on child **Application** objects, and Argo CD removed the health assessment of `Application` resources in version 1.8. Without it, the parent considers the CRD Application done as soon as it is created, not when its CRDs are established, so wave 0 can start before wave -10 has finished. The 2-second delay between waves is not a guarantee either.

Restore the Application health check in `argocd-cm`, as the Argo CD health documentation shows. Copy the Lua from the docs for your Argo CD version; the shape is:

```yaml title="argocd-cm (fragment)"
data:
  resource.customizations.health.argoproj.io_Application: |
    hs = {}
    hs.status = "Progressing"
    hs.message = ""
    if obj.status ~= nil then
      if obj.status.health ~= nil then
        hs.status = obj.status.health.status
        if obj.status.health.message ~= nil then
          hs.message = obj.status.health.message
        end
      end
    end
    return hs
```

The alternative is to keep CRDs and their first users in one Application and order them with waves there, which the per-resource wave logic handles. Repository layout and promotion between environments are in [[gitops-repo-topology-and-promotion]]; the platform's Argo CD decision is [[adr/0001-gitops-with-argocd]].

## Versioned CRDs

A CRD lists its versions in `spec.versions`. Each version has `served` (clients can use it) and `storage` (objects are written in it). Exactly one version is the storage version. `status.storedVersions` records every version that objects have ever been stored in, and the API server will not let you remove a version from `spec.versions` while it is still listed there.

Conversion between versions:

- `spec.conversion.strategy: None` (the default) only rewrites `apiVersion`. It is only safe when the schemas are identical.
- `strategy: Webhook` calls a conversion webhook (`webhook.clientConfig` with a Service or URL and a `caBundle`, plus `conversionReviewVersions`). The API server calls it for reads and writes that need a different version than the stored one, so **a down conversion webhook breaks access to that kind**. Its serving certificate expiring is the same failure as in [[admission-webhook-certificate-expiry]].

### Removing an old version safely

The documented order:

1. Add the new version with `served: true`, keep the old one served.
2. Make the new version the storage version (`storage: true`, old `storage: false`).
3. Move every client and manifest to the new version. API server audit or request logs show who still uses the old one.
4. Migrate stored objects so nothing is stored in the old version (below).
5. Set `served: false` on the old version and watch for errors.
6. Confirm `status.storedVersions` lists only the new version.
7. Remove the old version from `spec.versions` and drop its conversion handling.

Migrating stored objects, option 1, the built-in migrator (`StorageVersionMigration`). The current Kubernetes docs show `storagemigration.k8s.io/v1` with the `StorageVersionMigrator` feature gate enabled by default; the API was introduced in 1.30 as `v1alpha1` behind that gate, disabled by default, so older clusters may not serve `v1` (the per-release history was not verified here). Run `kubectl api-versions | grep storagemigration` first and use the version it lists:

```yaml title="migrate-widgets.yaml"
apiVersion: storagemigration.k8s.io/v1
kind: StorageVersionMigration
metadata:
  name: widgets-to-v1
spec:
  resource:
    group: example.com
    resource: widgets
```

When it succeeds, the old version is removed from `status.storedVersions`.

Option 2, by hand: with the new version already the storage version, read and write back every object unchanged so it is re-stored, then patch the status:

```bash
set -euo pipefail

CRD="widgets.example.com"     # change
KIND="widgets.example.com"    # resource.group, as kubectl accepts it
NEW_VERSION="v1"              # change: the storage version

# Re-store every object in the current storage version.
kubectl get "$KIND" -A -o json \
  | jq -c '.items[] | del(.metadata.resourceVersion, .metadata.managedFields)' \
  | while read -r obj; do
      printf '%s' "$obj" | kubectl replace -f -
    done

# Then tell the API server that only the new version holds data.
kubectl patch customresourcedefinitions "$CRD" --subresource=status --type=merge \
  -p "{\"status\":{\"storedVersions\":[\"$NEW_VERSION\"]}}"
```

Patch `storedVersions` only after every object has been rewritten. If you patch first, the API server believes data is migrated when it is not, and removing the old version then makes those objects unreadable.

## Upgrade order for an operator

1. **Read the operator's upgrade notes** for the target version: CRD changes, removed versions, required intermediate versions.
2. **Back up the custom resources**: `kubectl get <kind> -A -o yaml > <kind>-backup.yaml` for each kind the operator owns, and keep the old CRD manifests.
3. **Diff and apply the CRDs first** (the CRD Application, or `kubectl apply --server-side -f crds/`). The new CRD must still serve every version the running controller and existing manifests use.
4. **Upgrade the controller** (the operator Application or release).
5. **Move custom resources** in Git to the new API version.
6. **Later, as its own change**, remove old versions using the procedure above.

Never combine "new CRD version", "new controller" and "drop old version" in one sync. Each step must be reversible on its own, and only the last one is not. Put CRD upgrades through the [[production-change-checklist]].

## Guarding against deletion

Layer several controls; each covers a different mistake:

| Control                                                            | Stops                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| CRDs in `crds/` or in a separate release                           | `helm uninstall` of the operator deleting CRDs                                |
| `helm.sh/resource-policy: keep` on templated CRDs                  | Upgrade, rollback or uninstall deleting them                                  |
| Argo CD `Prune=false` and `Delete=false` (or `confirm`)            | A moved file or a deleted Application pruning CRDs                            |
| RBAC: no `delete` on `customresourcedefinitions` for humans and CI | A hand-typed `kubectl delete crd`, and a compromised pipeline (design advice) |
| Backups of custom resources before each operator upgrade           | Everything else; the only real recovery                                       |

A ClusterRole that grants CRD management without delete, bound to the GitOps controller or the platform pipeline, is plain RBAC; keep `delete` for a break-glass role. Cluster-wide backup tooling choices are in [[velero-vs-backup-for-gke]].

## Verify

```bash
set -euo pipefail

CRD="certificates.cert-manager.io"   # change: the CRD to check

# Versions: which are served, which is the storage version, which hold data.
kubectl get crd "$CRD" -o jsonpath='{range .spec.versions[*]}{.name}{" served="}{.served}{" storage="}{.storage}{"\n"}{end}'
kubectl get crd "$CRD" -o jsonpath='{.status.storedVersions}{"\n"}'

# Established and accepted names.
kubectl get crd "$CRD" -o jsonpath='{range .status.conditions[*]}{.type}={.status}{"\n"}{end}'

# What would change before applying a new CRD manifest.
kubectl diff --server-side -f crds/

# Argo CD: what it renders and what differs.
argocd app manifests cert-manager | grep -c 'kind: CustomResourceDefinition' || true
argocd app diff cert-manager-crds || true
```

Expected: one version with `storage=true`; `storedVersions` lists only versions still in `spec.versions`; conditions show `Established=True` and `NamesAccepted=True`; the operator Application renders zero CRDs when `skipCrds` is set; the diff shows only the changes you meant. `argocd app diff` exits non-zero when there is a diff, hence the `|| true`.

## Troubleshooting

**Sync fails with an error about the annotation size limit.** Client-side apply tried to store a large CRD in `last-applied-configuration`, which is limited to 262144 bytes in total. Set `ServerSideApply=true` on the Application or the resource, or apply with `kubectl apply --server-side`.

**Updating the CRD is rejected because a version in `status.storedVersions` is missing from `spec.versions`.** You removed a version that still holds data. Put it back (served or not), migrate stored objects, confirm `storedVersions`, then remove it again.

**Reads or writes of a kind fail after an upgrade, and the error mentions conversion or a webhook.** The conversion webhook is down, unreachable or its certificate is invalid. Check the webhook Service endpoints and the `caBundle`; [[admission-webhook-certificate-expiry]] covers the certificate case. Until it is fixed, every client of that kind is affected, including the operator.

**`no matches for kind` or `the server could not find the requested resource`.** The CRD is not installed yet, or the sync ordered things wrongly. Check the CRD Application synced first, and that the Application health check is restored when you rely on waves across Applications. The runbook view is in [[argocd-sync-failure-and-drift]].

**A CRD stays in `Terminating`.** Deletion waits until every custom resource is gone; custom resources with finalizers whose controller is already removed never go away. Stop: if the deletion was a mistake, you cannot cancel it, so start the restore planning now. If it was intended, restore the controller long enough to process finalizers, or follow [[namespace-stuck-terminating]] for the finalizer analysis.

**A new field in a custom resource is silently dropped.** The installed CRD schema is older than the one the manifest expects, and structural schemas prune unknown fields. Upgrade the CRD first.

**Helm says the CRD already exists and skips it, and the controller fails.** That is Helm's documented behaviour for `crds/`. Apply the new CRDs yourself before the upgrade ([[helm-release-rollback]] has the same caveat for rollbacks).

## Rollback

CRDs roll forward. `helm rollback` does not touch CRDs from `crds/`, and rolling back a templated CRD to an older schema can fail or strand objects that are stored in a newer version.

- **Controller upgrade went wrong, CRD change was additive:** roll back the controller only. The newer CRD keeps serving the old version.
- **A version was removed too early:** add it back to `spec.versions` (served), which restores access if objects were not lost.
- **A CRD was deleted:** its custom resources are gone. Re-create the CRD from Git, then restore the custom resources from the backup taken before the change (or re-sync them from Git if every custom resource is declared there). Expect controllers to re-create downstream objects, such as certificates being re-issued.

The general release rollback procedure, including its CRD caveats, is [[helm-release-rollback]].

## Related

- [[helm-release-rollback]]: rollback steps and why CRDs do not follow.
- [[argocd-sync-failure-and-drift]]: diagnosing failed syncs, including CRD ordering.
- [[gitops-repo-topology-and-promotion]]: where the CRD and operator Applications live.
- [[admission-webhook-certificate-expiry]]: the same failure mode for webhooks.
- [[helm-chart-standard]]: approval rules for cluster-scoped charts.
- [[cert-manager-dns01-cloud-dns]]: an operator whose CRDs hold every certificate.
- [[helm-vs-kustomize]]: the tooling choice behind this.
- [[0062-helm-charts-rendered-by-argo-cd]]: the decision that Argo CD renders Helm charts, which is why the Helm `crds/` rules above do not carry over one to one.

## Sources

- [Helm: Custom resource definitions (best practices)](https://helm.sh/docs/chart_best_practices/custom_resource_definitions/): `crds/` behaviour, no upgrade or delete, separate chart method.
- [Helm: Charts, custom resource definitions](https://helm.sh/docs/topics/charts/#custom-resource-definitions-crds): install-time behaviour and limitations.
- [Helm: Chart tips and tricks](https://helm.sh/docs/howto/charts_tips_and_tricks/): `helm.sh/resource-policy: keep`.
- [Helm: overview of Helm 4 changes](https://helm.sh/docs/overview/): server-side apply default, flag renames.
- [Kubernetes: Versions in CustomResourceDefinitions](https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definition-versioning/): storage versions, conversion webhooks, removing old versions, `storedVersions`.
- [Kubernetes: Extend the API with CustomResourceDefinitions](https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/): deletion behaviour, structural schemas.
- [Argo CD: Sync options](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/): `ServerSideApply`, `Replace`, `Prune`, `Delete`, `SkipDryRunOnMissingResource`.
- [Argo CD: Sync phases and waves](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/)
- [Argo CD: Helm](https://argo-cd.readthedocs.io/en/stable/user-guide/helm/): `skipCrds`, hook mapping.
- [Argo CD: Resource health](https://argo-cd.readthedocs.io/en/stable/operator-manual/health/): Application health check removed in 1.8 and how to restore it.
