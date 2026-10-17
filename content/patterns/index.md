---
title: Patterns
description: Reusable, tested ways of building things on the platform.
tags:
  - patterns
  - meta
created: 2026-10-10
modified: 2026-10-17
draft: false
---

A pattern is a repeatable solution to a recurring problem, with enough detail to apply it and enough context to know when not to.

## CI/CD

- [[gitlab-ci-pipeline-structure|GitLab CI pipeline structure]]: a production GitLab CI layout using rules, needs, shared includes, caching, protected environments and a manual production gate, with a full working example.
- [[jenkins-shared-libraries|Jenkins shared libraries]]: how to structure, version, test and consume a Jenkins shared library, with Kubernetes pod agents, credential handling and a full Jenkinsfile example.
- [[sonarqube-quality-gates|SonarQube quality gates]]: gate merges on new-code quality with SonarQube in GitLab CI and Jenkins, and roll it out to an existing codebase without blocking everyone.
- [[artifact-promotion-artifactory|Artifact promotion with Artifactory]]: build once, then promote the same artefact from dev to staging to prod in Artifactory using build info and the JFrog CLI in GitLab CI.
- [[dockerfile-hardening|Dockerfile hardening]]: build small, reproducible, non-root container images with multi-stage builds, digest pinning, BuildKit secrets, scanning and signing.
- [[automated-dependency-updates|Automated dependency and image updates]]: keep base images, CI tool images, Helm charts and Terraform providers pinned by digest and current with Renovate merge requests in GitLab.
- [[gitlab-runners-on-gke|GitLab runners on GKE with the Kubernetes executor]]: run GitLab CI jobs as short-lived Pods on GKE with isolated namespaces, spot and on-demand node pools, a Cloud Storage cache and no privileged containers.
- [[jenkins-controller-and-agent-hardening|Jenkins controller and agent hardening]]: harden a Jenkins controller and its Kubernetes pod agents with zero executors, configuration as code, scoped credentials, reviewed script approvals and auditable production approvals.
- [[secret-scanning-pre-commit-and-ci|Secret scanning in pre-commit hooks and CI]]: layer gitleaks in a pre-commit hook, a GitLab merge request job and a scheduled history scan, with baselines, reasoned allowlists and a clear hand-off to rotation.
- [[release-versioning-and-changelog-automation|Release versioning and changelog automation]]: derive versions and changelogs from Conventional Commits, and choose between a release merge request model and release on push, with configuration, linting and token handling.
- [[helm-chart-ci-quality-gates|Helm chart CI quality gates]]: layered CI checks for Helm charts, from lint and a values matrix to unit tests, schema validation, kubeconform and chart-testing on changed charts only.

## Kubernetes and GKE

- [[helm-chart-conventions|Helm chart conventions]]: conventions for in-house Helm charts covering layout, values schema, labels, probes, optional PDB and HPA, secrets, versioning, testing and publishing.
- [[kubernetes-resource-requests-and-limits|Kubernetes resource requests and limits]]: how requests and limits drive scheduling, QoS and throttling, how to size them from real usage, and the traps with GKE Autopilot, the JVM and Go.
- [[zero-downtime-deployments-kubernetes|Zero-downtime deployments on Kubernetes]]: rolling update settings, probes, graceful shutdown, PodDisruptionBudgets, GCP load balancer draining and expand/contract migrations, with a verification checklist.
- [[kubernetes-network-policies|Kubernetes network policies]]: default-deny NetworkPolicies with DNS, namespace and Google API egress on GKE, plus testing, common mistakes and a safe rollout.
- [[gke-workload-identity|Workload Identity Federation for GKE]]: give Pods access to Google Cloud APIs without service account keys, using a direct IAM principal or GSA impersonation.
- [[external-secrets-with-secret-manager|External Secrets Operator with Google Secret Manager]]: sync Google Secret Manager secrets into Kubernetes Secrets on GKE with External Secrets Operator and Workload Identity, including refresh, RBAC and failure modes.
- [[pod-security-admission|Pod Security admission and policy enforcement]]: enforce Pod Security Standards per namespace with warn, audit and enforce labels, and add Kyverno or Gatekeeper policy for what PSS cannot express.
- [[kubernetes-autoscaling|Kubernetes autoscaling on GKE: HPA, VPA and the cluster autoscaler]]: how the Horizontal Pod Autoscaler, Vertical Pod Autoscaler and GKE cluster autoscaler work together, with manifests, Terraform, pitfalls and checks.
- [[progressive-delivery-argo-rollouts|Progressive delivery with Argo Rollouts and metric analysis]]: run canary releases with Argo Rollouts under Argo CD, gate each step on Prometheus metrics, and abort or promote safely.

## Infrastructure as code

- [[terraform-module-and-state-layout|Terraform module and state layout]]: a repository layout, remote state in GCS, version pinning and GitLab plan/apply flow that keep Terraform changes small, reviewable and recoverable.
- [[terraform-testing|Testing Terraform modules, static checks, terraform test and Terratest]]: three levels of Terraform module tests, from fmt and tflint to mocked terraform test runs and Terratest in a sandbox project, and when each one pays off.
- [[terraform-plan-policy-checks|Policy checks on Terraform plans]]: evaluate Terraform plan JSON with Conftest and static scanners in GitLab CI, and treat plan files as secrets, so risky GCP changes are stopped before apply.

## Policy and supply chain

- [[conftest-policy-gate-for-manifests|Conftest policy gate for rendered Kubernetes manifests]]: run OPA Conftest in GitLab CI and Jenkins on helm template output so policy violations stop the merge request before Argo CD sees them.
- [[image-signing-and-admission-verification|Image signing with cosign and verification at admission]]: sign image digests in GitLab CI or Jenkins, define an identity policy per repository, and enforce it at admission with Kyverno or Binary Authorization.

## Hosts

- [[linux-host-hardening-with-chef-and-inspec|Linux host hardening with Chef and InSpec]]: apply a CIS-style Level 1 baseline to Linux VMs and build agents with Chef, and verify it continuously with InSpec.

## Observability

- [[slo-burn-rate-alerting|SLO burn rate alerting]]: define SLIs and SLOs for HTTP services and alert on error budget burn with multi-window, multi-burn-rate rules in Prometheus and Cloud Monitoring.

## Shape of a pattern note

A pattern note covers the following, in roughly this order; items 3 to 5 can be short or a link when another note already holds them:

1. The problem and when the pattern applies.
2. The steps, with commands that can be copied.
3. A way to verify it worked.
4. Troubleshooting for the failures you actually hit.
5. Rollback, when the change is not trivially reversible.

Patterns that embody a significant choice link to the [[adr/index|ADR]] that made it.
