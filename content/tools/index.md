---
title: Tools
description: Comparisons and evaluations of the tools used on the platform.
tags:
  - tools
  - meta
created: 2026-10-10
modified: 2026-10-19
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
- [[artifactory-vs-nexus-vs-artifact-registry|Artifactory vs Nexus vs Artifact Registry]]: comparing JFrog Artifactory, Sonatype Nexus Repository and Google Artifact Registry for images, Helm charts and language packages on GKE.
- [[jfrog-xray-vs-trivy-vs-grype|JFrog Xray vs Trivy vs Grype for image and artefact scanning]]: where repository scanning, CI image scanning and open-source scanners fit, with gating, SBOM, database caching and false-positive trade-offs.
- [[sonarqube-vs-semgrep-vs-codeql|SonarQube vs Semgrep vs CodeQL for static analysis]]: comparing SonarQube, Semgrep and CodeQL on what they analyse, custom rules, CI fit, licensing and triage cost for a GitLab and Jenkins team.
- [[github-actions-vs-gitlab-ci-vs-jenkins|GitHub Actions vs GitLab CI vs Jenkins]]: adding GitHub Actions to the GitLab CI and Jenkins comparison: OIDC to GCP, runners, reuse, security defaults and lock-in for GKE delivery.
- [[vault-vs-gcp-secret-manager|Vault vs GCP Secret Manager vs External Secrets]]: choosing a secret store (Vault or Secret Manager) and a delivery path into GKE (External Secrets Operator or the Secrets Store CSI driver).
- [[packer-vs-chef-for-images|Packer vs Chef for machine images]]: baking golden images with Packer versus converging VMs with Chef, and the hybrid where Chef runs inside the Packer build, for GCE fleets.
- [[ansible-vs-chef-vs-salt|Ansible vs Chef vs Salt for configuration management]]: comparing Ansible, Chef and Salt for Linux fleets on push vs pull, state model, testing and secrets, and when to stop managing hosts at all.
- [[terragrunt-vs-terraform-workspaces|Terragrunt vs Terraform workspaces for multi-environment GCP]]: when CLI workspaces stop scaling for dev, stage and prod on GCP, what plain directories give you, and when Terragrunt's extra layer is worth it.
- [[atlantis-vs-spacelift-vs-hcp-terraform|Atlantis vs Spacelift vs HCP Terraform]]: comparing Atlantis, Spacelift and HCP Terraform for plan-on-pull-request and gated apply on GCP: state, policy, drift, auth, trust boundary and cost model.
- [[thanos-vs-mimir-vs-victoriametrics|Thanos vs Mimir vs VictoriaMetrics for long-term Prometheus metrics]]: choosing a long-term, highly available Prometheus backend on GKE: Thanos, Grafana Mimir or VictoriaMetrics, compared on architecture, GCS storage, tenancy and operations.
- [[loki-vs-elasticsearch-vs-cloud-logging|Loki vs Elasticsearch vs Cloud Logging]]: comparing label-indexed Loki, full-text Elasticsearch and Google Cloud Logging for GKE logs: query model, retention, cost drivers and operations.
- [[grafana-vs-cloud-monitoring-dashboards|Grafana vs Cloud Monitoring dashboards]]: where to build dashboards for GKE: Grafana or Cloud Monitoring dashboards, how both read Managed Prometheus data, and how to keep them as code.
- [[cert-manager-vs-google-managed-certificates|cert-manager vs Google-managed certificates on GKE]]: choosing between cert-manager with ACME, GKE ManagedCertificate and Certificate Manager with DNS authorization for GKE ingress and load balancers.
- [[velero-vs-backup-for-gke|Velero vs Backup for GKE]]: comparing Velero and Backup for GKE on scope, volume snapshots, restore granularity, cross-region restore and operating cost for production GKE.
- [[kaniko-vs-buildkit-vs-cloud-build|Kaniko vs BuildKit vs Cloud Build for image builds]]: choosing a rootless or managed image builder for GitLab CI, Jenkins and GCP: privilege model, cache, provenance, SBOM and maintenance status.
- [[cosign-vs-notation|cosign vs Notation for container image signing]]: comparing Sigstore cosign and Notary Project Notation on signing models, attestations, trust policy, KMS support and admission enforcement on GKE.
- [[renovate-vs-dependabot|Renovate vs Dependabot]]: choosing a dependency update bot for GitHub and GitLab repos with Terraform, Helm, Dockerfiles and CI images: coverage, grouping, automerge and hosting.

## Deep dives and toolkits

- [[artifactory-repository-design|Artifactory repository design: local, remote and virtual]]: how to lay out Artifactory local, remote and virtual repositories, names, permissions and resolution order so every client resolves the right artefact.
- [[k9s-kubectx-stern-toolbox|k9s, kubectx and stern toolbox]]: A terminal kit for daily Kubernetes work, with k9s for cluster views, kubectx and kubens for context switching and stern for multi-pod logs, plus safety habits.
- [[opentofu-migration-notes|OpenTofu migration notes for GCS-backed Terraform]]: A gated per-workspace move from Terraform to OpenTofu with a GCS backend: compatibility checks, state backup, CI image changes, validation and rollback.

## Writing a comparison

A good comparison states the criteria first, uses the same criteria for every option, and ends with a recommendation that names the circumstances under which it would change. Name the tool versions a claim depends on where it is made. Record the date you checked them against the docs in `verified`, only when you actually did, and put a short `[!info]` with what was checked near the top. See [[writing-notes]].
