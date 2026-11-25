---
title: Architecture decisions
description: What an Architecture Decision Record is, the numbering convention, and the list of records.
tags:
  - adr
  - meta
created: 2026-10-10
modified: 2026-11-24
draft: false
---

An Architecture Decision Record (ADR) captures one significant decision: the context that forced it, the option chosen, and the consequences accepted. The format follows Michael Nygard's original proposal, "Documenting Architecture Decisions".

## Numbering and file names

- Files are named `NNNN-short-kebab-title.md`, for example `0001-gitops-with-argocd.md`.
- `NNNN` is a four-digit, zero-padded sequence number. Numbers are never reused or renumbered, even if a record is rejected or superseded.
- The note `title` is the decision in sentence case without the number, and the file stem (for example `0001-gitops-with-argocd`) is what wikilinks use. Optional `aliases` such as `ADR-0001` add short names.
- Start from [[adr/template|the ADR template]].

## Lifecycle

An ADR has exactly one status at a time, written in lowercase in the `status` frontmatter field:

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

A `proposed` record is not binding. A note or another ADR that builds on a proposed record states that dependency as conditional ("if [[0018-gke-autopilot-for-new-clusters|ADR-0018]] is accepted").

| ADR                                                                 | Title                                                                               | Status   |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------- |
| [[0001-gitops-with-argocd\|0001]]                                   | GitOps with Argo CD                                                                 | accepted |
| [[0002-artifactory-as-single-artifact-store\|0002]]                 | Artifactory is the single artifact store                                            | accepted |
| [[0003-artifactory-repository-layout\|0003]]                        | Artifactory repositories use a local, remote and virtual layout                     | accepted |
| [[0004-build-once-promote-between-repositories\|0004]]              | Build once and promote the same artifact between stage repositories                 | accepted |
| [[0005-xray-scanning-gates-promotion\|0005]]                        | Xray scanning gates promotion between repositories                                  | accepted |
| [[0006-artifact-retention-by-cleanup-policies\|0006]]               | Artifact retention is enforced by repository cleanup policies                       | accepted |
| [[0007-language-packages-resolve-through-artifactory\|0007]]        | Language package managers resolve only through Artifactory                          | accepted |
| [[0008-helm-charts-as-oci-artifacts\|0008]]                         | Helm charts are stored and pulled as OCI artifacts                                  | accepted |
| [[0009-container-images-artifactory-or-artifact-registry\|0009]]    | Where container images live: Artifactory or Artifact Registry                       | proposed |
| [[0010-deploy-images-by-digest\|0010]]                              | Deploy container images by digest, never by a mutable tag                           | accepted |
| [[0011-artifactory-hosting-saas-or-self-managed\|0011]]             | Where Artifactory runs: JFrog-hosted SaaS or self-managed on GKE                    | proposed |
| [[0012-gitlab-ci-for-new-pipelines\|0012]]                          | New pipelines use GitLab CI, and Jenkins stays only where it already runs           | accepted |
| [[0013-versioned-central-ci-templates\|0013]]                       | Shared CI templates come from a versioned central project                           | accepted |
| [[0014-gitlab-runners-kubernetes-executor-on-gke\|0014]]            | GitLab runners use the Kubernetes executor on GKE                                   | accepted |
| [[0015-no-privileged-image-builds-in-ci\|0015]]                     | Container images are built in CI without privileged Docker-in-Docker                | accepted |
| [[0016-sonarqube-new-code-gate-blocks-merge\|0016]]                 | The SonarQube new-code quality gate blocks merges                                   | accepted |
| [[0017-argo-cd-and-rollouts-not-spinnaker\|0017]]                   | Kubernetes delivery uses Argo CD and Argo Rollouts; Spinnaker is not adopted        | accepted |
| [[0018-gke-autopilot-for-new-clusters\|0018]]                       | GKE Autopilot for new workload clusters                                             | proposed |
| [[0019-namespace-per-team-tenancy\|0019]]                           | One namespace per team service boundary, with quotas and group RBAC                 | accepted |
| [[0020-default-deny-network-policies\|0020]]                        | Default-deny NetworkPolicy in every application namespace                           | accepted |
| [[0021-mandatory-resource-requests\|0021]]                          | Every container sets requests, memory limit equals request, CPU limits are optional | accepted |
| [[0022-admission-policy-pod-security-vap-and-kyverno\|0022]]        | Admission control with Pod Security, VAP and Kyverno                                | accepted |
| [[0023-gateway-api-for-north-south-traffic\|0023]]                  | Gateway API for north-south traffic on GKE                                          | proposed |
| [[0024-gcp-folders-by-policy-boundary\|0024]]                       | GCP folders follow policy boundaries                                                | accepted |
| [[0025-shared-vpc-host-project-no-default-networks\|0025]]          | Shared VPC host project and no default networks                                     | accepted |
| [[0026-keyless-ci-auth-with-workload-identity-federation\|0026]]    | Keyless CI authentication with Workload Identity Federation                         | accepted |
| [[0027-cloud-sql-for-production-postgres\|0027]]                    | Cloud SQL for production PostgreSQL                                                 | proposed |
| [[0028-primary-and-dr-regions-per-environment\|0028]]               | One primary and one DR region per environment                                       | proposed |
| [[0029-cloud-dns-zones-in-a-platform-project\|0029]]                | Cloud DNS zones in a platform project                                               | accepted |
| [[0030-terraform-manages-gcp-infrastructure\|0030]]                 | Terraform manages Google Cloud infrastructure                                       | accepted |
| [[0031-terraform-or-opentofu\|0031]]                                | Terraform or OpenTofu                                                               | proposed |
| [[0032-terraform-state-in-gcs-per-environment\|0032]]               | Terraform state in GCS per environment                                              | accepted |
| [[0033-plain-root-modules-no-terragrunt\|0033]]                     | Plain root modules, no Terragrunt                                                   | accepted |
| [[0034-terraform-modules-versioned-by-git-tag\|0034]]               | Terraform modules released by Git tag, all versions pinned                          | accepted |
| [[0035-terraform-plan-policy-gate-and-ci-only-apply\|0035]]         | Terraform plan policy gate and CI-only apply                                        | accepted |
| [[0036-secret-manager-as-secrets-system-of-record\|0036]]           | Secret Manager as the secrets system of record                                      | accepted |
| [[0037-keyless-cosign-image-signing\|0037]]                         | Keyless cosign image signing by digest                                              | accepted |
| [[0038-kyverno-verifies-image-signatures-at-admission\|0038]]       | Kyverno verifies image signatures at admission                                      | accepted |
| [[0039-cyclonedx-as-canonical-sbom-format\|0039]]                   | CycloneDX as the canonical SBOM format                                              | accepted |
| [[0040-golden-base-images-owned-by-platform\|0040]]                 | Golden base images owned by the platform team                                       | accepted |
| [[0041-retire-chef-for-immutable-images\|0041]]                     | Retire Chef for new hosts in favour of immutable images                             | accepted |
| [[0042-managed-prometheus-for-application-metrics\|0042]]           | Managed Service for Prometheus for application metrics on GKE                       | accepted |
| [[0043-opentelemetry-collector-gateway\|0043]]                      | Telemetry goes through an OpenTelemetry Collector gateway with tail sampling        | accepted |
| [[0044-central-log-sinks-and-retention-tiers\|0044]]                | Audit logs go to a central locked bucket; application logs use retention tiers      | accepted |
| [[0045-page-only-on-slo-burn-rate\|0045]]                           | On-call is paged only by SLO burn-rate alerts                                       | accepted |
| [[0046-dashboards-and-alert-rules-as-code\|0046]]                   | Dashboards and alert rules are managed as code in Git                               | accepted |
| [[0047-semver-release-tags-and-protected-production-deploys\|0047]] | Production ships from protected SemVer tags behind a manual gate                    | accepted |
| [[0048-rollback-by-redeploying-previous-digest\|0048]]              | Roll back by reverting to the previous digest; schemas only roll forward            | accepted |
| [[0049-feature-flags-with-openfeature\|0049]]                       | OpenFeature is the feature-flag API, and the provider is still open                 | proposed |
| [[0050-incident-severity-levels-and-roles\|0050]]                   | Incidents use SEV1 to SEV4 with fixed commander, comms and scribe roles             | accepted |
| [[0051-backups-proven-by-quarterly-restore-drills\|0051]]           | A backup counts only after a timed quarterly restore drill                          | accepted |
| [[0052-workload-identity-for-gke-pods\|0052]]                       | Pods reach Google APIs only through Workload Identity Federation for GKE            | accepted |
| [[0053-production-and-non-production-never-share-a-cluster\|0053]]  | Production and non-production never share a cluster or a project                    | accepted |
| [[0054-gke-release-channels-and-maintenance-policy\|0054]]          | GKE release channel per environment, with maintenance windows and exclusions        | accepted |
| [[0055-private-gke-control-plane-and-egress\|0055]]                 | Private GKE nodes, a restricted control-plane endpoint and controlled egress        | accepted |
| [[0056-vm-access-through-os-login-and-iap\|0056]]                   | VM shell access through OS Login and IAP, no metadata SSH keys or external IPs      | accepted |
| [[0057-just-in-time-production-access\|0057]]                       | No standing human write access to production; elevation is just in time             | accepted |
| [[0058-vpc-service-controls-for-production-data\|0058]]             | VPC Service Controls perimeter around production data projects                      | proposed |
| [[0059-cmek-where-data-classification-requires-it\|0059]]           | Customer-managed encryption keys only where the data class requires them            | accepted |
| [[0060-renovate-for-automated-dependency-updates\|0060]]            | Renovate opens dependency, image digest and Terraform provider updates              | accepted |
| [[0061-jenkins-controllers-as-code-with-ephemeral-agents\|0061]]    | Jenkins controllers run from configuration as code with ephemeral pod agents        | accepted |
| [[0062-helm-charts-rendered-by-argo-cd\|0062]]                      | Applications are Helm charts rendered by Argo CD; Kustomize only patches            | accepted |
| [[0063-notes-are-grounded-in-real-experience\|0063]]                | Notes are grounded in real experience, and an operational claim must name its case  | accepted |
