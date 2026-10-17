---
title: Tools
description: Comparisons and evaluations of the tools used on the platform.
tags:
  - tools
  - meta
created: 2026-10-10
modified: 2026-10-17
draft: false
---

Notes in this section compare tools and record why one was preferred. They are the supporting evidence for decisions that end up as [[adr/index|ADRs]].

## Comparisons

- [[argocd-vs-flux|Argo CD vs Flux]]: two GitOps engines for Kubernetes. Feeds [[0001-gitops-with-argocd]].
- [[gitlab-ci-vs-jenkins|GitLab CI vs Jenkins]]: a practical comparison of GitLab CI/CD and Jenkins for Kubernetes-based delivery, with security, cost and migration guidance.
- [[helm-vs-kustomize|Helm vs Kustomize]]: templating versus patching for Kubernetes manifests, how Argo CD handles both, and how to combine them safely.
- [[terraform-vs-opentofu|Terraform vs OpenTofu]]: comparing Terraform and OpenTofu after the 2023 licence change, with state, registry, migration and a recommendation for a GCP team.
- [[prometheus-vs-cloud-monitoring|Prometheus vs Cloud Monitoring]]: choosing between self-managed Prometheus, Google Cloud Managed Service for Prometheus and Cloud Monitoring for GKE metrics.
- [[argo-rollouts-vs-spinnaker|Argo Rollouts vs Spinnaker for progressive delivery]]: compare an in-cluster, Git-driven rollout controller with a pipeline-based CD platform for canary, approval and multi-target releases.
- [[gatekeeper-vs-kyverno|Gatekeeper vs Kyverno vs ValidatingAdmissionPolicy]]: choose an admission policy engine for GKE by comparing OPA Gatekeeper, Kyverno and the built-in ValidatingAdmissionPolicy on language, mutation, reporting and availability.
- [[service-mesh-on-gke|Service mesh on GKE, whether to adopt and which model]]: how to decide whether a service mesh is worth it on GKE, and how Istio sidecar, Istio ambient, Linkerd and Cloud Service Mesh compare, with Gateway API as the shared traffic API.

## Writing a comparison

A good comparison states the criteria first, uses the same criteria for every option, and ends with a recommendation that names the circumstances under which it would change. Name the tool versions a claim depends on where it is made. Record the date you checked them against the docs in `verified`, only when you actually did, and put a short `[!info]` with what was checked near the top. See [[writing-notes]].
