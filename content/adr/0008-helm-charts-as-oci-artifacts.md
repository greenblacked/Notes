---
title: Helm charts are stored and pulled as OCI artifacts
description: Charts move from an HTTP index repo to OCI references in the same registry as images, with immutable versions.
type: adr
tags:
  - adr
  - helm
  - artifactory
  - ci-cd
  - gitops
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0008
---

## Context

Our shared charts are published to a classic Helm repository: a directory of `.tgz` files plus an `index.yaml`. That model has caused real problems:

- The `index.yaml` must be regenerated on every publish. Concurrent publishes race, and a corrupted index hides every chart in the repository.
- Charts can be overwritten at the same version, so two clusters rendering "1.2.3" can get different manifests.
- Charts use a different authentication and retention path from images, doubling the work for scanning and cleanup.
- Argo CD sources point at an index URL plus a chart name, which is one more thing to keep in step.

Helm supports OCI registries as a first-class storage for charts, and Artifactory serves them from the same infrastructure as images ([[0002-artifactory-as-single-artifact-store]]).

## Decision

We will **store and pull Helm charts as OCI artifacts** in Artifactory, with immutable chart versions, and retire the HTTP index repository.

- Charts are published to a dedicated OCI repository following [[0003-artifactory-repository-layout]], for example `helm-oci-local`, and promoted between stages like any other artifact ([[0004-build-once-promote-between-repositories]]).
- A chart version is **never overwritten**. The repository has overwrite disabled for released versions, and CI refuses to publish a version that already exists.
- Chart versions follow SemVer and are produced by the release process in [[release-versioning-and-changelog-automation]].
- Argo CD reads charts directly from the OCI registry ([[0001-gitops-with-argocd]]).
- Charts pass the quality gates in [[helm-chart-ci-quality-gates]] before they are pushed, and follow [[helm-chart-conventions]].

```bash title="publish-chart.sh"
set -euo pipefail
REGISTRY="artifactory.example.com"
REPO="helm-oci-local"
CHART_DIR="charts/payments-api"

helm registry login "${REGISTRY}" --username "${ARTIFACTORY_USER}" --password-stdin <<<"${ARTIFACTORY_TOKEN}"
helm lint "${CHART_DIR}"
helm package "${CHART_DIR}" --destination dist/

CHART_FILE=$(ls dist/payments-api-*.tgz)
helm push "${CHART_FILE}" "oci://${REGISTRY}/${REPO}"
```

```yaml title="argocd/applications/payments-api.yaml"
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: payments-api
  namespace: argocd
spec:
  project: payments
  source:
    repoURL: artifactory.example.com/helm-oci-local
    chart: payments-api
    targetRevision: 1.2.3
    helm:
      valueFiles:
        - values.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: payments
```

For an OCI source, Argo CD takes the registry host and path in `repoURL` without the `oci://` prefix and needs the registry registered as a repository of type Helm with OCI enabled (check the current Argo CD docs for the exact fields).

> [!info] Not checked against current docs
> Not verified for this record: the Argo CD version from which OCI Helm sources are supported and their exact `repoURL` syntax, how Artifactory exposes OCI paths for Helm in our version, and OCI behaviour of `helm dependency` with registries. Helm's OCI support is generally available in Helm 3, but check both Helm and Argo CD for the versions in use.

## Consequences

Easier:

- No `index.yaml` to regenerate or corrupt; publishing is a plain push.
- Immutable versions give reproducible rendering across clusters.
- Charts reuse image authentication, scanning, retention and replication.

Harder or newly required:

- `helm search repo` does not work against OCI registries. Discovery moves to the Artifactory UI, the catalogue in the platform documentation, or the registry API.
- Every consumer needs Helm and Argo CD versions that support OCI, and credentials for the registry.
- Migration work: existing charts must be republished, and Argo CD sources updated one application at a time.
- Chart dependencies declared with `repository: "https://..."` must be converted to `oci://` references where the dependency is also moved.

## Alternatives considered

- **Keep the classic `index.yaml` repository.** Familiar and searchable, but the index race, overwritable versions and separate retention are the problems we want to remove. Rejected.
- **Charts stored in Git and referenced by path.** Excellent for charts used by one repository, and still used for app-local charts. For shared charts it couples every consumer to a Git ref and loses SemVer-addressed releases. See [[helm-vs-kustomize]] for the rendering choice, which this record does not change.
- **A chart museum service.** Another service to run and secure for something the registry already does. Rejected.

## Validation

Check that the chart is readable by version and that the Argo CD application renders. Set the variables first.

```bash title="validate-0008.sh"
set -o pipefail
REGISTRY="artifactory.example.com"
CHART="oci://${REGISTRY}/helm-oci-local/payments-api"
VERSION="1.2.3"

# Chart metadata comes back and the version matches
helm show chart "${CHART}" --version "${VERSION}" | grep -E '^(name|version):'

# It renders without errors
helm template payments "${CHART}" --version "${VERSION}" >/dev/null && echo "render OK"

# Argo CD sees the app as Synced and Healthy
argocd app get payments-api -o json | jq -r '.status.sync.status, .status.health.status'

# Overwrite protection: pushing the same version again must be refused
helm push dist/payments-api-${VERSION}.tgz "oci://${REGISTRY}/helm-oci-local" \
  && echo "FAIL: overwrite was allowed" || echo "OK: overwrite refused"
```

## References

- Helm registries: https://helm.sh/docs/topics/registries/
- Argo CD Helm user guide: https://argo-cd.readthedocs.io/en/stable/user-guide/helm/

Related notes:

- [[helm-chart-conventions]]
- [[helm-chart-ci-quality-gates]]
- [[helm-vs-kustomize]]
- [[0001-gitops-with-argocd]]
- [[0009-container-images-artifactory-or-artifact-registry]]
