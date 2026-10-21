---
title: Applications are packaged as Helm charts and rendered by Argo CD; Kustomize only patches
description: In-house services ship as Helm charts on a shared library chart, Argo CD renders them, nobody runs helm install, and Kustomize only patches third-party charts.
type: adr
tags:
  - adr
  - helm
  - gitops
  - kubernetes
  - delivery
status: accepted
created: 2026-10-21
modified: 2026-10-21
decided: 2026-10-21
draft: false
aliases:
  - ADR-0062
---

## Context

[[0001-gitops-with-argocd]] makes Git the source of truth and Argo CD the deployer, and allows "plain manifests, Kustomize or Helm". [[0008-helm-charts-as-oci-artifacts]] decides where charts are stored. Neither decides how an application is packaged, and the freedom shows:

- **Three packaging styles.** Some services are plain YAML, some are Kustomize overlays, some are Helm charts. Reviewers have to know all three, and platform-wide changes (a new label, a security context default, a probe convention) have to be made three ways.
- **Inconsistent labels and defaults.** Each style copies its own `app.kubernetes.io/*` labels, resource requests and security settings, so policies ([[0022-admission-policy-pod-security-vap-and-kyverno]]) and dashboards find gaps service by service.
- **Helm releases drifting from Git.** A few teams still run `helm upgrade` from laptops or CI against clusters. Those releases change outside Git, Argo CD then reports drift or fights them, and `helm rollback` restores a state nobody reviewed ([[argocd-sync-failure-and-drift]]).
- **Hooks that behave differently than expected.** Charts written for the Helm CLI rely on Helm hooks, which Argo CD maps onto its own sync phases with gaps.

We want one packaging standard, one deployer and one render path that CI can check before anything reaches a cluster.

## Decision

**Every in-house service is packaged as a Helm chart built on the shared library chart. Argo CD renders and applies the charts; nobody runs `helm install`, `helm upgrade` or `helm rollback` against a cluster. Kustomize is allowed only to patch third-party charts.**

### Packaging

- **One chart per service**, in the service's repository, built on the platform's library chart ([[helm-library-and-umbrella-charts]]). The library chart provides the Deployment, Service, probes, labels, security context, resource requests and NetworkPolicy templates that satisfy [[helm-chart-standard]] and [[helm-chart-conventions]]. A library chart is declared with `type: library`, cannot be installed on its own and is consumed as a dependency.[^library]
- **Charts carry a `values.schema.json`** and defaults that are safe for every environment ([[helm-chart-authoring-schema-dependencies-and-tests]]).
- **Charts are published as OCI artifacts** per [[0008-helm-charts-as-oci-artifacts]], with an immutable version, and images inside them are referenced by digest ([[0010-deploy-images-by-digest]]). Library chart and third-party chart version bumps arrive as Renovate merge requests ([[0060-renovate-for-automated-dependency-updates]]).
- **Per-environment values live in the GitOps repository**, one file per service and environment, under the layout of [[gitops-repo-topology-and-promotion]]. A service repository holds only chart defaults and CI test values.

### Rendering and deployment

- **Argo CD is the only thing that renders charts for clusters.** Argo CD uses Helm only to render manifests with `helm template`; it applies and tracks them itself, and `helm ls` does not show applications it deploys.[^argo-helm]
- **No Helm CLI against clusters.** Humans and CI have no cluster permissions that would allow `helm install` or `upgrade` in application namespaces; CI writes to Git, Argo CD syncs ([[0001-gitops-with-argocd]]). Cluster add-ons follow the same rule.
- **Applications use multiple sources:** the chart from the OCI registry, and the GitOps repository as a `ref` source that supplies the values file through `$values`. `$values` is valid only at the start of a value file path, relative to the root of the referenced repository, and a source with `ref` cannot also set `chart`.[^multi]
- **Release name equals the Application name**, so the `app.kubernetes.io/instance` label that Argo CD uses for tracking does not collide with chart selectors. Argo CD's Helm guide documents this collision; changing the tracking label or method in `argocd-cm` is a platform-wide change with its own record, not a per-team fix.

### Hooks

- **The library chart emits no Helm hooks.** Ordering uses Argo CD sync waves (`argocd.argoproj.io/sync-wave`), and one-off work such as schema migrations ([[postgres-expand-contract-migrations]]) runs as a Job with an Argo CD `PreSync` hook annotation and a `BeforeHookCreation` delete policy, so it re-runs on each sync.
- **Third-party charts with Helm hooks are accepted as they are,** after checking how the running Argo CD version maps them. Argo CD maps `pre-install` and `pre-upgrade` to PreSync, `post-install` and `post-upgrade` to PostSync, and the hook weight to a sync wave; it cannot tell an install from an upgrade, so both kinds run on every sync. Some Helm hooks (`pre-rollback`, `post-rollback`, `test-success`) are not supported and are ignored, and the mapping of others has changed between Argo CD versions.[^hooks]

> [!warning] One Argo CD hook disables every Helm hook in the app
> If any resource in an Application carries an Argo CD hook annotation, Argo CD ignores **all** Helm hooks in that Application, without an error. Never add an Argo CD hook to an app built from a third-party chart that relies on its Helm hooks; wrap the extra Job in its own Application instead.

### Kustomize for third-party charts only

Some vendor charts do not expose a value for a change we need (an extra annotation, a toleration, a security context). For those, and only those, a Kustomize overlay inflates the chart with `helmCharts` and patches the result.

- Kustomize can render Helm charts only with `kustomize build --enable-helm`, which is off by default. In Argo CD it is enabled through `kustomize.buildOptions` in `argocd-cm`, and that setting applies to **every** Kustomize application, not just this one.[^kustomize]
- The chart version in the overlay is always pinned, as [[helm-vs-kustomize]] requires.
- In-house services never use Kustomize; if a value is missing, the library chart or the service chart gains it.

### CI render, policy and diff

Every merge request that changes a chart, a values file or an Application renders each affected chart with **each environment's values**, then validates the output against Kubernetes schemas and our Conftest policies ([[conftest-policy-gate-for-manifests]]), and posts the rendered diff against the target branch for reviewers. Chart-level gates (lint, schema, unit tests) stay in the chart's own pipeline ([[helm-chart-ci-quality-gates]]).

### Snippets

An Application for one service in production:

```yaml title="apps/prod/payments-api.yaml"
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: payments-api-prod
  namespace: argocd
spec:
  project: payments
  destination:
    server: https://kubernetes.default.svc
    namespace: payments
  sources:
    # The chart, pulled from the OCI registry (ADR-0008).
    # Check the Argo CD docs for the OCI repoURL form your version expects.
    - repoURL: registry.example.com/charts
      chart: payments-api
      targetRevision: 1.8.2
      helm:
        releaseName: payments-api-prod
        valueFiles:
          - $values/envs/prod/payments-api/values.yaml
    # The GitOps repository, used only as a source of values files.
    - repoURL: https://gitlab.example.com/platform/gitops.git
      targetRevision: main
      ref: values
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

`1.8.2` is an example version of our own chart. Promotion between environments is a change to `targetRevision` and the values file in Git, made by the release flow ([[0047-semver-release-tags-and-protected-production-deploys]]).

A third-party chart patched with Kustomize (in the GitOps repository, under the third-party directory only):

```yaml title="third-party/example-operator/kustomization.yaml"
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
helmCharts:
  - name: example-operator
    repo: https://charts.example.com
    version: 2.4.1 # always pinned
    releaseName: example-operator
    namespace: example-operator
    valuesFile: values.yaml
patches:
  - target:
      kind: Deployment
      name: example-operator
    patch: |-
      - op: add
        path: /spec/template/spec/tolerations
        value:
          - key: dedicated
            operator: Equal
            value: platform
            effect: NoSchedule
```

```yaml title="argocd-cm (excerpt)"
data:
  # Applies to ALL Kustomize applications in this Argo CD instance.
  kustomize.buildOptions: --enable-helm
```

The CI render job in the GitOps repository, for one service:

```bash title="ci/render-service.sh"
set -euo pipefail
SERVICE="payments-api"
CHART_REF="oci://registry.example.com/charts/${SERVICE}"
NAMESPACE="payments"
OUT_DIR="rendered"
mkdir -p "${OUT_DIR}"

for ENV in dev stage prod; do
  APP_FILE="apps/${ENV}/${SERVICE}.yaml"
  # Chart version comes from the Application, so CI renders what Argo CD will render.
  CHART_VERSION="$(yq '.spec.sources[0].targetRevision' "${APP_FILE}")"

  helm template "${SERVICE}-${ENV}" "${CHART_REF}" \
    --version "${CHART_VERSION}" \
    --namespace "${NAMESPACE}" \
    --values "envs/${ENV}/${SERVICE}/values.yaml" \
    > "${OUT_DIR}/${SERVICE}-${ENV}.yaml"

  # Schema validation against the cluster's Kubernetes version (set by the tool's flags).
  kubeconform -strict -summary "${OUT_DIR}/${SERVICE}-${ENV}.yaml"

  # Organisation policies (labels, digests, security context, requests).
  conftest test "${OUT_DIR}/${SERVICE}-${ENV}.yaml" --policy policy/
done
```

The diff step runs the same script on the merge request's target branch into a second directory and posts `diff -u` of the two directories to the merge request. The release name in CI matches the Application name so the rendered labels match what Argo CD applies.

## Consequences

Easier:

- One packaging model: platform-wide changes go into the library chart once, and every service picks them up with its next chart release.
- Every manifest that reaches a cluster was rendered from versioned inputs in Git and validated in CI first.
- Drift has one cause fewer: no Helm releases change outside Git.
- Reviewers see rendered output per environment, not only template and values changes.

Harder or newly required:

- **`helm list`, `helm history` and `helm rollback` no longer describe reality.** Argo CD owns the lifecycle, so Helm keeps no release record for these apps. Rollback is a Git revert that redeploys the previous chart version and image digest, per [[0048-rollback-by-redeploying-previous-digest]]. [[helm-release-rollback]] applies only to the remaining CLI-installed releases until they are migrated.
- **Library chart skills become necessary.** Service teams must understand named templates and how to extend the library chart, and the platform team must version the library chart carefully, because a change there reaches every service.
- **Hook behaviour is a trap.** A single Argo CD hook annotation silently disables every Helm hook in that Application, and the Helm-to-Argo CD hook mapping changes between Argo CD versions. Third-party chart upgrades must be checked against the Helm guide for the running Argo CD version.
- **`--enable-helm` is global.** Enabling it for third-party patching changes how every Kustomize application in the instance is built. Keep Kustomize applications few and reviewed.
- **CI needs registry access and tools** (Helm, yq, kubeconform, Conftest) pinned by digest in a tools image, and a render per service and environment, which costs pipeline time as the estate grows.

### Migration of existing releases

Services still deployed by the Helm CLI move one at a time:

1. Create the Argo CD Application with the same chart, version, values and release name, with automated sync **off**.
2. Run `argocd app diff` and resolve every difference until the only changes are tracking metadata.
3. Sync the Application, so Argo CD adopts the existing resources.
4. Back up and then delete the Helm release Secrets for that release (labelled `owner=helm`); deleting the release record does not delete the resources Argo CD now manages. Never run `helm uninstall`, which deletes the resources.
5. Turn on automated sync, and remove the CI job or credentials that used to run `helm upgrade`.

> [!warning] helm uninstall deletes the workload
> During migration the release record and the running resources are separate. Remove the record (the release Secrets) after Argo CD has adopted the resources; never uninstall the release.

## Alternatives considered

- **Kustomize for in-house services.** No templating language and easy patching, but defaults and platform-wide changes are copied into each base, and there is no packaged, versioned artifact to promote. Kept only for third-party patches. See [[helm-vs-kustomize]].
- **Plain manifests.** Simplest to read, but every service copies every convention, and environments differ by copied files. Rejected for services; still fine for a handful of cluster-level objects.
- **Helm CLI from CI (`helm upgrade --install`).** Familiar and gives Helm's own release history, but it deploys outside Git, needs cluster write credentials in CI, and conflicts with Argo CD as the single deployer ([[0017-argo-cd-and-rollouts-not-spinnaker]]). Rejected.
- **Config Management Plugin with Helm post-rendering.** Would allow patching any chart without Kustomize, but it adds a sidecar to the repo server that we must build, secure and upgrade. Not adopted; reconsider if Kustomize patching grows.

> [!info] Claims not checked against current docs
> The Argo CD and Helm documentation was read through search summaries, not directly. Not verified, check before relying on them: the Helm hook mapping for the Argo CD version we run (it differs between versions, for example for `pre-delete` and CRD handling); the OCI `repoURL` form for Helm sources; whether `argocd app diff --local` works with multi-source Applications; the `helmCharts` field names in Kustomize; the Helm release Secret labels other than `owner=helm`; the `helm template` validation flags; and whether Argo CD's application history rollback is usable with automated sync. That a cluster managed only by Argo CD has no Helm release Secrets is an inference from Argo CD running only `helm template`, not a documented statement. No Argo CD or Helm version is stated on purpose.

## Validation

```bash title="validate-helm-argocd.sh"
set -o pipefail
APP="payments-api-prod"
APP_NAMESPACES="payments orders"   # application namespaces to check (space-separated)

# 1. Render check for each environment: see ci/render-service.sh above.
#    Expected: helm template exits 0, kubeconform reports no invalid resources,
#    conftest reports no failures.

# 2. Live state matches Git. argocd app diff exits 0 when there is no diff,
#    1 when a diff is found, and 2 on error.
argocd app diff "${APP}"
case $? in
  0) echo "${APP}: in sync with Git" ;;
  1) echo "${APP}: DIFF found, investigate" ;;
  *) echo "${APP}: diff failed" ;;
esac

# 3. No Helm release records in application namespaces.
#    Expected: no output once migration is complete. This also flags anything
#    installed with the Helm CLI, which is the point.
for ns in ${APP_NAMESPACES}; do
  kubectl get secrets -n "${ns}" -l owner=helm \
    -o custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name --no-headers
done

# 4. Kustomize Helm inflation is used only under third-party/ in the GitOps repo.
#    Expected: no output.
grep -rl --include='kustomization.yaml' 'helmCharts:' . | grep -v '^./third-party/'
```

## References

- Argo CD Helm guide (rendering and hook mapping): https://argo-cd.readthedocs.io/en/stable/user-guide/helm/
- Argo CD multiple sources and `$values`: https://argo-cd.readthedocs.io/en/stable/user-guide/multiple_sources
- Argo CD Kustomize and build options: https://argo-cd.readthedocs.io/en/stable/user-guide/kustomize/
- Argo CD sync phases and waves: https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/
- `argocd app diff`: https://argo-cd.readthedocs.io/en/stable/user-guide/commands/argocd_app_diff/
- Helm library charts: https://helm.sh/docs/topics/library_charts
- Helm chart hooks: https://helm.sh/docs/topics/charts_hooks/
- `helm template`: https://helm.sh/docs/helm/helm_template/

Related notes:

- [[helm-vs-kustomize]]
- [[helm-chart-conventions]]
- [[helm-library-and-umbrella-charts]]
- [[helm-chart-standard]]
- [[helm-chart-ci-quality-gates]]
- [[gitops-repo-topology-and-promotion]]
- [[argocd-sync-failure-and-drift]]
- [[helm-release-rollback]]
- [[conftest-policy-gate-for-manifests]]

Related ADRs:

- [[0001-gitops-with-argocd]]
- [[0008-helm-charts-as-oci-artifacts]]
- [[0010-deploy-images-by-digest]]
- [[0017-argo-cd-and-rollouts-not-spinnaker]]
- [[0022-admission-policy-pod-security-vap-and-kyverno]]
- [[0048-rollback-by-redeploying-previous-digest]]
- [[0060-renovate-for-automated-dependency-updates]]

[^library]: Per the Helm library charts page; a library chart's templates are named templates in files that start with an underscore.

[^argo-helm]: Per the Argo CD Helm user guide, which states that the application lifecycle is handled by Argo CD instead of Helm.

[^multi]: Per the Argo CD multiple sources page; a ref-only source needs no path and only supplies files.

[^hooks]: Per the Argo CD Helm user guide for the version you run; use that version's page, not the latest one.

[^kustomize]: Per the Argo CD Kustomize page; build options can also be set per Kustomize version.
