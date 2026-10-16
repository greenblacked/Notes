---
title: Helm vs Kustomize
description: Templating versus patching for Kubernetes manifests, how Argo CD handles both, and how to combine them safely.
type: tool
tags:
  - tools
  - helm
  - kubernetes
  - gitops
created: 2026-10-16
modified: 2026-10-16
draft: false
---

Helm and Kustomize solve different problems and are often used together. Helm is a package manager with a template language; Kustomize is a patch engine over plain YAML. Kustomize is built into `kubectl` (`kubectl apply -k`), and Helm is a separate CLI.

> [!note] Not independently verified
> This note covers design differences. Confirm flags and fields against the current Helm, Kustomize and Argo CD documentation before copying them.

## At a glance

| Concern          | Helm                                                         | Kustomize                                            |
| ---------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| Model            | Go templates plus a `values.yaml` contract                   | Base resources plus overlays, patches and generators |
| Input to deploy  | Chart (directory, `.tgz` or OCI artefact) plus values        | Directory with a `kustomization.yaml`                |
| Packaging        | Versioned charts, repositories, OCI registries, dependencies | None; share by Git path or remote base               |
| Release tracking | Helm releases with history and rollback (`helm rollback`)    | None; Git is the history                             |
| Readability      | Templates mix YAML and logic; rendered output is not in Git  | Everything is valid YAML; diffs are what is applied  |
| Hooks and tests  | Chart hooks and `helm test`                                  | None                                                 |
| Third-party apps | Dominant distribution format                                 | Possible, but you patch someone else's manifests     |
| Best at          | Distributing reusable software with configurable options     | Per-environment variation of your own manifests      |

## Templating versus patching

Helm asks the chart author to predict every variation and expose it as a value. Anything not exposed needs a fork or a post-renderer. The result is flexible for consumers who stay within the values contract and awkward for those who do not.

Kustomize assumes nothing: take working manifests and change them. Strategic merge and JSON 6902 patches can alter any field. The cost is that overlays are coupled to the structure of the base, so a base refactor can silently break patches.

```yaml title="overlays/prod/kustomization.yaml"
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
patches:
  - target:
      kind: Deployment
      name: api
    patch: |-
      - op: replace
        path: /spec/replicas
        value: 4
images:
  - name: europe-docker.pkg.dev/example/app/api
    newTag: "1.4.2"
```

## Packaging and distribution

Helm wins here. Charts are versioned artefacts that can be pushed to an OCI registry (Artifact Registry, Artifactory) and pulled by version. Dependencies and a values schema (`values.schema.json`) are first-class. For conventions on writing charts, see [[helm-chart-conventions]].

Kustomize has no package format. You can reference a remote base by Git URL, but pinning to a commit and trusting a remote repository is a supply-chain decision. For your own applications, a Git directory is usually enough.

## Argo CD support

Argo CD supports both natively in the repo server. It detects a `Chart.yaml` or `kustomization.yaml` and renders accordingly.

- **Helm:** Argo CD runs `helm template` and applies the output. It does not create a Helm release, so `helm list` shows nothing and chart hooks are mapped to Argo CD hooks. Values come from the Application spec (`helm.valueFiles`, `helm.values`).
- **Kustomize:** Argo CD runs `kustomize build`. Image overrides and name prefixes can be set in the Application spec.
- **Helm via Kustomize:** requires `--enable-helm` to be set in the Argo CD `kustomize.buildOptions` configuration, since Kustomize disables Helm inflation by default.

See [[argocd-vs-flux]] for how Flux differs (it runs real Helm releases) and [[0001-gitops-with-argocd]] for our delivery decision.

## Combining them

Two common patterns.

**1. Kustomize `helmCharts`.** Kustomize inflates the chart, then patches the result.

```yaml title="kustomization.yaml"
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
helmCharts:
  - name: ingress-nginx
    repo: https://kubernetes.github.io/ingress-nginx
    version: 4.11.3
    releaseName: ingress-nginx
    namespace: ingress-nginx
    valuesFile: values.yaml
patches:
  - path: add-node-selector.yaml
```

Build it with `kustomize build --enable-helm .`. Pin the chart `version` explicitly. Check the version string exists before copying this example.

**2. Render, then patch.** Useful when you want the rendered manifests in the MR for review.

```bash
RELEASE=ingress-nginx
CHART=ingress-nginx/ingress-nginx
VERSION=4.11.3
helm template "$RELEASE" "$CHART" --version "$VERSION" -f values.yaml > base/all.yaml
kustomize build overlays/prod
```

Committing rendered output makes reviews honest (you see what is applied) at the cost of a generation step that must be enforced in CI.

> [!warning] Pin everything
> An unpinned chart version or remote base makes a Git commit stop being a complete description of what will be deployed.

## When to choose which

Choose **Helm** when you consume third-party software, distribute your own service to many teams, or need hooks, tests and release rollback ([[helm-release-rollback]]).

Choose **Kustomize** when you own the manifests and need a few per-environment differences with minimal abstraction.

Use **both** when you consume a third-party chart but need environment patches the chart does not expose.

## Recommendation

Use Helm charts for anything shared or third-party, with versions pinned and values kept in Git per environment. Use Kustomize for small in-house services with simple overlays, and for last-mile patching of charts. Do not build deep overlay trees; if an overlay needs more than a handful of patches, the base is probably the wrong abstraction.
