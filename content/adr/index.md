---
title: Architecture decisions
description: What an Architecture Decision Record is, the numbering convention, and the list of records.
tags:
  - adr
  - meta
created: 2026-10-10
modified: 2026-10-19
draft: false
---

An Architecture Decision Record (ADR) captures one significant decision: the context that forced it, the option chosen, and the consequences accepted. The format follows Michael Nygard's original proposal, "Documenting Architecture Decisions".

## Numbering and file names

- Files are named `NNNN-short-kebab-title.md`, for example `0001-gitops-with-argocd.md`.
- `NNNN` is a four-digit, zero-padded sequence number. Numbers are never reused or renumbered, even if a record is rejected or superseded.
- The note `title` is the decision in sentence case without the number, and the file stem (for example `0001-gitops-with-argocd`) is what wikilinks use. Optional `aliases` such as `ADR-0001` add short names.
- Start from [[template|the ADR template]].

## Lifecycle

An ADR has exactly one status at a time, written in lowercase in the `status` frontmatter field and shown as a chip above the title:

| Status       | Meaning                                                                |
| ------------ | ---------------------------------------------------------------------- |
| `proposed`   | Open for discussion; not yet binding.                                  |
| `accepted`   | Agreed and in force.                                                   |
| `rejected`   | Considered and declined. Kept for the record.                          |
| `deprecated` | No longer relevant, with no replacement.                               |
| `superseded` | Replaced by a newer ADR. Add `superseded_by` and link both directions. |

> [!warning] Records are immutable
> Once an ADR is `accepted`, only its status and links may change. If the decision changes, write a new ADR that supersedes the old one. Fixing typos is fine; rewriting history is not.

## Records

| ADR                                                                 | Title                                                                               | Status   |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------- |
| [[0001-gitops-with-argocd\|0001]]                                   | GitOps with Argo CD                                                                 | Accepted |
| [[0002-artifactory-as-single-artifact-store\|0002]]                 | Artifactory is the single artifact store                                            | Accepted |
| [[0003-artifactory-repository-layout\|0003]]                        | Artifactory repositories use a local, remote and virtual layout                     | Accepted |
| [[0004-build-once-promote-between-repositories\|0004]]              | Build once and promote the same artifact between stage repositories                 | Accepted |
| [[0005-xray-scanning-gates-promotion\|0005]]                        | Xray scanning gates promotion between repositories                                  | Accepted |
| [[0006-artifact-retention-by-cleanup-policies\|0006]]               | Artifact retention is enforced by repository cleanup policies                       | Accepted |
| [[0007-language-packages-resolve-through-artifactory\|0007]]        | Language package managers resolve only through Artifactory                          | Accepted |
| [[0008-helm-charts-as-oci-artifacts\|0008]]                         | Helm charts are stored and pulled as OCI artifacts                                  | Accepted |
| [[0009-container-images-artifactory-or-artifact-registry\|0009]]    | Where container images live: Artifactory or Artifact Registry                       | Proposed |
| [[0010-deploy-images-by-digest\|0010]]                              | Deploy container images by digest, never by a mutable tag                           | Accepted |
| [[0011-artifactory-hosting-saas-or-self-managed\|0011]]             | Where Artifactory runs: JFrog-hosted SaaS or self-managed on GKE                    | Proposed |
| [[0012-gitlab-ci-for-new-pipelines\|0012]]                          | New pipelines use GitLab CI, and Jenkins stays only where it already runs           | Accepted |
| [[0013-versioned-central-ci-templates\|0013]]                       | Shared CI templates come from a versioned central project                           | Accepted |
| [[0014-gitlab-runners-kubernetes-executor-on-gke\|0014]]            | GitLab runners use the Kubernetes executor on GKE                                   | Accepted |
| [[0015-no-privileged-image-builds-in-ci\|0015]]                     | Container images are built in CI without privileged Docker-in-Docker                | Accepted |
| [[0016-sonarqube-new-code-gate-blocks-merge\|0016]]                 | The SonarQube new-code quality gate blocks merges                                   | Accepted |
| [[0017-argo-cd-and-rollouts-not-spinnaker\|0017]]                   | Kubernetes delivery uses Argo CD and Argo Rollouts; Spinnaker is not adopted        | Accepted |
| [[0018-gke-autopilot-for-new-clusters\|0018]]                       | GKE Autopilot for new workload clusters                                             | Proposed |
| [[0019-namespace-per-team-tenancy\|0019]]                           | One namespace per team service boundary, with quotas and group RBAC                 | Accepted |
| [[0020-default-deny-network-policies\|0020]]                        | Default-deny NetworkPolicy in every application namespace                           | Accepted |
| [[0021-mandatory-resource-requests\|0021]]                          | Every container sets requests, memory limit equals request, CPU limits are optional | Accepted |
| [[0022-admission-policy-pod-security-vap-and-kyverno\|0022]]        | Admission control with Pod Security, VAP and Kyverno                                | Accepted |
| [[0023-gateway-api-for-north-south-traffic\|0023]]                  | Gateway API for north-south traffic on GKE                                          | Proposed |
| [[0024-gcp-folders-by-policy-boundary\|0024]]                       | GCP folders follow policy boundaries                                                | Accepted |
| [[0025-shared-vpc-host-project-no-default-networks\|0025]]          | Shared VPC host project and no default networks                                     | Accepted |
| [[0026-keyless-ci-auth-with-workload-identity-federation\|0026]]    | Keyless CI authentication with Workload Identity Federation                         | Accepted |
| [[0027-cloud-sql-for-production-postgres\|0027]]                    | Cloud SQL for production PostgreSQL                                                 | Proposed |
| [[0028-primary-and-dr-regions-per-environment\|0028]]               | One primary and one DR region per environment                                       | Proposed |
| [[0029-cloud-dns-zones-in-a-platform-project\|0029]]                | Cloud DNS zones in a platform project                                               | Accepted |
| [[0030-terraform-manages-gcp-infrastructure\|0030]]                 | Terraform manages Google Cloud infrastructure                                       | Accepted |
| [[0031-terraform-or-opentofu\|0031]]                                | Terraform or OpenTofu                                                               | Proposed |
| [[0032-terraform-state-in-gcs-per-environment\|0032]]               | Terraform state in GCS per environment                                              | Accepted |
| [[0033-plain-root-modules-no-terragrunt\|0033]]                     | Plain root modules, no Terragrunt                                                   | Accepted |
| [[0034-terraform-modules-versioned-by-git-tag\|0034]]               | Terraform modules released by Git tag, all versions pinned                          | Accepted |
| [[0035-terraform-plan-policy-gate-and-ci-only-apply\|0035]]         | Terraform plan policy gate and CI-only apply                                        | Accepted |
| [[0036-secret-manager-as-secrets-system-of-record\|0036]]           | Secret Manager as the secrets system of record                                      | Accepted |
| [[0037-keyless-cosign-image-signing\|0037]]                         | Keyless cosign image signing by digest                                              | Accepted |
| [[0038-kyverno-verifies-image-signatures-at-admission\|0038]]       | Kyverno verifies image signatures at admission                                      | Accepted |
| [[0039-cyclonedx-as-canonical-sbom-format\|0039]]                   | CycloneDX as the canonical SBOM format                                              | Accepted |
| [[0040-golden-base-images-owned-by-platform\|0040]]                 | Golden base images owned by the platform team                                       | Accepted |
| [[0041-retire-chef-for-immutable-images\|0041]]                     | Retire Chef for new hosts in favour of immutable images                             | Accepted |
| [[0042-managed-prometheus-for-application-metrics\|0042]]           | Managed Service for Prometheus for application metrics on GKE                       | Accepted |
| [[0043-opentelemetry-collector-gateway\|0043]]                      | Telemetry goes through an OpenTelemetry Collector gateway with tail sampling        | Accepted |
| [[0044-central-log-sinks-and-retention-tiers\|0044]]                | Audit logs go to a central locked bucket; application logs use retention tiers      | Accepted |
| [[0045-page-only-on-slo-burn-rate\|0045]]                           | On-call is paged only by SLO burn-rate alerts                                       | Accepted |
| [[0046-dashboards-and-alert-rules-as-code\|0046]]                   | Dashboards and alert rules are managed as code in Git                               | Accepted |
| [[0047-semver-release-tags-and-protected-production-deploys\|0047]] | Production ships from protected SemVer tags behind a manual gate                    | Accepted |
| [[0048-rollback-by-redeploying-previous-digest\|0048]]              | Roll back by reverting to the previous digest; schemas only roll forward            | Accepted |
| [[0049-feature-flags-with-openfeature\|0049]]                       | OpenFeature is the feature-flag API, and the provider is still open                 | Proposed |
| [[0050-incident-severity-levels-and-roles\|0050]]                   | Incidents use SEV1 to SEV4 with fixed commander, comms and scribe roles             | Accepted |
| [[0051-backups-proven-by-quarterly-restore-drills\|0051]]           | A backup counts only after a timed quarterly restore drill                          | Accepted |
