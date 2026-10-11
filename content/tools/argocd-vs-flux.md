---
title: Argo CD vs Flux
description: A practical comparison of Argo CD and Flux for GitOps delivery to Kubernetes, with guidance on when to choose each.
type: tool
tags:
  - tools
  - gitops
  - kubernetes
created: 2026-10-10
modified: 2026-10-10
draft: false
aliases:
  - argo-vs-flux
---

Both [Argo CD](https://argo-cd.readthedocs.io/) and [Flux](https://fluxcd.io/) are CNCF graduated projects that continuously reconcile a Kubernetes cluster against desired state in Git. They differ more in shape than in capability. This comparison fed [[0001-gitops-with-argocd]].

> [!note] Check the versions
> Feature sets move quickly. Treat the table as a map of design differences and confirm specifics against each project's current documentation before relying on them.

## At a glance

| Concern          | Argo CD                                                                        | Flux                                                                               |
| ---------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Architecture     | A small set of components: API server, repo server, application controller     | A toolkit of controllers (source, kustomize, helm, notification, image automation) |
| Core resources   | `Application`, `ApplicationSet`, `AppProject`                                  | `GitRepository`, `OCIRepository`, `HelmRepository`, `Kustomization`, `HelmRelease` |
| User interface   | First-party web UI and CLI with live resource tree, diff and sync              | No first-party UI; Flux CLI, plus community and commercial UIs                     |
| Multi-cluster    | One instance manages many registered clusters (hub and spoke)                  | Typically one Flux per cluster; remote clusters possible via kubeconfig            |
| Multi-tenancy    | `AppProject` limits repos, destinations and resource kinds; RBAC               | Namespaced tenants with `serviceAccountName` impersonation on reconciliation       |
| Helm             | Renders charts to manifests and applies them; Helm release not tracked by Helm | Runs real Helm releases through the Helm controller                                |
| Ordering         | Sync waves and hooks                                                           | `dependsOn` between `Kustomization` and `HelmRelease`                              |
| Secrets          | Via plugins or operators (e.g. External Secrets)                               | Native SOPS decryption in the kustomize controller, or operators                   |
| Image automation | Separate project (Argo CD Image Updater)                                       | Built-in image reflector and automation controllers                                |
| Drift handling   | Detects and shows diff; self-heal optional                                     | Reconciles on an interval; drift corrected on each run                             |
| SSO / RBAC       | Built in (OIDC, Dex), project-scoped RBAC                                      | Uses Kubernetes RBAC; no separate user model                                       |

## Where Argo CD is stronger

- **Visibility.** The application tree, health, sync status and live diff in the UI let application teams self-serve without cluster access.
- **Central control plane.** One place to see and manage every cluster, with `ApplicationSet` generators to stamp out applications per cluster, per environment or per directory.
- **Ordering primitives.** Sync waves and resource hooks make multi-step rollouts (migrations, CRDs before CRs) explicit.

## Where Flux is stronger

- **Composability and footprint.** Controllers can be installed individually and drive each other through ordinary Kubernetes APIs.
- **Kubernetes-native security model.** Reconciliation runs as a ServiceAccount you choose, so tenants cannot exceed their own RBAC.
- **Helm fidelity.** Real Helm releases mean `helm list`, hooks and tests behave as chart authors expect.
- **Built-in SOPS and image automation.** Fewer extra components for common needs.

## When to choose which

Choose **Argo CD** when:

- application teams need a UI and SSO-backed, project-scoped access;
- you want one hub that manages many clusters;
- ordering within a deployment is complex.

Choose **Flux** when:

- you prefer a toolkit that you assemble per cluster, with no central credential store;
- Kubernetes RBAC and impersonation are your multi-tenancy boundary;
- you want native SOPS and image update automation.

> [!tip] It is not a lifelong marriage
> Both read plain manifests, Kustomize overlays and Helm charts from Git. Keeping the repository layout engine-agnostic keeps the switching cost low.

## Our choice

We chose Argo CD, mainly for the multi-cluster hub model and the UI. The reasoning and the consequences we accepted are recorded in [[0001-gitops-with-argocd]].
