---
title: Argo CD vs Flux
description: How the two CNCF GitOps controllers compare for a multi-cluster platform.
tags: [tools, gitops, kubernetes, argocd, flux]
---

Both are graduated CNCF projects and both reconcile cluster state from Git.
The difference is mostly in **operating model**, not capability.
The decision that came out of this comparison is [[0001-gitops-with-argocd]].

> [!info] Verify versions
> Feature sets move quickly. Check the current release notes of both projects
> before relying on any single row below.

## Comparison

| Criterion | Argo CD | Flux |
| --- | --- | --- |
| Model | Application-centric, `Application` / `ApplicationSet` CRDs | Toolkit of controllers: `GitRepository`, `Kustomization`, `HelmRelease` |
| UI | Built-in web UI with diff, history, sync | No built-in UI; third-party or CLI |
| Multi-tenancy | Projects + RBAC + SSO in Argo CD | Kubernetes RBAC and namespaces |
| Helm | Renders templates, applies manifests (no Helm release objects) | Real Helm releases via helm-controller |
| Multi-cluster | One instance can target many clusters, or one per cluster | One installation per cluster is the norm |
| Image automation | Separate Argo CD Image Updater | Built-in image-reflector and image-automation controllers |
| Footprint | Heavier (API server, repo server, Redis, UI) | Lighter set of controllers |

## When to pick which

- **Argo CD** when application teams need to *see* what is deployed, and you
  want SSO-backed self-service with a UI.
- **Flux** when the platform is fully code-driven, operators are comfortable in
  the CLI, and you want native Helm release semantics.

## What decided it for us

1. Developers needed a UI to see sync and health without `kubectl` access.
2. SSO + project-scoped RBAC mapped cleanly onto team boundaries.
3. Helm release history was not a requirement; Git history is the record.

See also: [[gke-workload-identity]] for how workloads deployed this way reach GCP.
