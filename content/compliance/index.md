---
title: Compliance
description: Controls, audit evidence, access reviews and the software supply chain, and how the platform produces proof of them.
tags:
  - compliance
  - meta
created: 2026-10-17
modified: 2026-10-21
draft: false
---

These notes cover how a DevOps platform produces evidence for the controls it is asked to meet. The aim is that Git, CI, Argo CD, GKE and Cloud Audit Logs already hold the records, so an audit reads system output instead of hand-written tickets.

## Change control and evidence

- [[change-management-controls-and-pipeline-evidence|Change management controls mapped to pipeline evidence]]: map change-control objectives to evidence that Git, GitLab CI, Argo CD and GKE already produce, so audits read system records instead of hand-written tickets.
- [[audit-evidence-collection-and-retention|Audit evidence collection and retention for CI/CD and cloud]]: what evidence to keep from Git, CI, Argo CD, GKE and Cloud Audit Logs, how long, how to make it tamper-evident and how to retrieve it for an audit period.
- [[separation-of-duties-in-deployments|Separation of duties in deployments]]: standard for who may author, review, approve and deploy, and how to enforce it in GitLab, Jenkins and Argo CD, with break-glass and a small-team compensating control.
- [[change-advisory-in-continuous-delivery|Change advisory in a continuous delivery world]]: replace a weekly change advisory board with risk tiers, pre-approved standard changes and merge-request approvals that produce the same evidence.
- [[out-of-band-change-detection-gcp-gke|Detecting changes made outside the pipeline on GCP and GKE]]: find production changes on GCP and GKE made by anyone other than the approved CI and GitOps identities, classify them, and keep the evidence.
- [[gitlab-compliance-frameworks-and-security-policies|Enforcing required CI jobs with GitLab compliance frameworks and security policies]]: stop project maintainers from removing required scan and evidence jobs, using GitLab pipeline execution, scan execution and merge request approval policies.
- [[jenkins-audit-trail-and-configuration-evidence|Jenkins audit trail and configuration evidence]]: make Jenkins auditable with configuration in Git, Audit Trail and Job Configuration History, logs shipped off the controller and evidence kept outside it.

## Access and hardening

- [[access-reviews-gcp-and-gke|Access reviews and least privilege on GCP and GKE]]: run a quarterly access review for GCP IAM, GKE RBAC, CI service accounts and break-glass accounts, and keep evidence of it.
- [[cis-benchmarks-with-kube-bench|CIS Kubernetes benchmarks with kube-bench]]: run CIS Kubernetes benchmark checks with kube-bench on GKE nodes, read the results, record exceptions and keep versioned evidence.
- [[gcp-organization-policy-guardrails|GCP organization policy guardrails as code]]: manage a baseline of GCP organization policy constraints in Terraform, with inheritance, custom constraints, dry-run rollout and a recorded exception path.
- [[privileged-access-just-in-time-gcp-gke|Privileged access with just-in-time elevation on GCP and GKE]]: replace standing Owner and cluster-admin with time-boxed, approved elevation on GCP and GKE, keep break-glass as a logged exception.
- [[leaver-credential-revocation-devops-tools|Leaver offboarding for credentials the identity provider does not control]]: find, revoke and verify a leaver's tokens and keys in GitLab, Jenkins, Artifactory, SonarQube, GCP, GKE and Chef, and record a timestamp per system.
- [[data-classification-tags-gcp-and-kubernetes|Data classification with GCP resource tags and Kubernetes labels]]: make data classes machine-readable with GCP Resource Manager tags and Kubernetes namespace labels, and drive org policy, IAM and admission rules from them.

## Policy and exceptions

- [[policy-exception-and-waiver-process|Policy exception and waiver process]]: request, approve, time-box, record and enforce policy exceptions in code, so a waiver expires by default instead of becoming permanent.
- [[vulnerability-exception-register|Vulnerability exception register and reconciliation]]: keep accepted vulnerabilities in one register in Git, reconcile it with scanner findings on a schedule, and fail builds on expired entries.

## Continuous monitoring and assurance

- [[continuous-control-monitoring-gcp-and-gke|Continuous control monitoring on GCP and GKE with Cloud Asset Inventory and Security Command Center]]: check GCP and GKE configuration controls every day with Cloud Asset Inventory exports, BigQuery and Security Command Center, and keep dated results as evidence.
- [[penetration-testing-gcp-and-gke|Penetration tests on GCP and GKE: scope, rules of engagement and retest evidence]]: scope, authorise, prepare, run and close a penetration test of a GCP and GKE platform, with time-bound tester access and a retest evidence package.
- [[vendor-soc2-report-review-for-devops-saas|Reviewing a vendor SOC 2 report for DevOps SaaS tools]]: how to read a SaaS vendor's SOC 2 report as a platform engineer, covering scope, opinion, exceptions, CUECs and carve-outs, and how to record the review.

## Supply chain

- [[sbom-generation-and-storage|SBOM generation and storage]]: generate one SBOM per image digest in CI, attest it to the image, store it next to the artifact and query it when a new CVE lands.
- [[slsa-build-provenance|SLSA build levels and provenance for GitLab CI and Jenkins]]: what SLSA Build levels ask for, what is realistic on GitLab CI and self-hosted Jenkins, and how consumers verify signed provenance.
- [[open-source-license-compliance|Open-source licence compliance in the pipeline]]: build a licence inventory from SBOMs, classify licences into allow, review and deny lists, gate merges in CI and handle exceptions.
- [[artifactory-provenance-evidence|Provenance evidence from Artifactory: build info, checksums and promotion records]]: use digests, build info, properties and promotion records in Artifactory as an audit trail from source commit to deployed artifact.

## Data protection

- [[pci-dss-and-gdpr-for-devops-logs-and-data|PCI DSS and GDPR touch points for DevOps, logs, personal data and retention]]: where DevOps tooling touches cardholder or personal data, and how to keep it out, redact it before storage, scope environments and set retention.
- [[encryption-at-rest-and-in-transit-evidence-gcp|Encryption at rest and in transit on GCP: what to prove]]: turn encryption claims on GCP into repeatable evidence: default and CMEK coverage per service, TLS enforcement and org policy, by gcloud.
- [[legal-hold-for-logs-and-artifacts|Legal hold for logs and artifacts without breaking retention]]: place, track and release legal holds on Cloud Storage, log buckets and Artifactory without breaking normal retention and cleanup.
- [[data-deletion-and-crypto-shredding-gcp|Proving data deletion on GCP across backups, logs and artifacts, with crypto-shredding]]: trace where deleted data still lives on GCP, delete it or crypto-shred it with per-tenant Cloud KMS keys, and keep evidence that it is gone.
- [[gcp-provider-access-controls-and-data-residency|Provider access and data residency on GCP: Access Transparency, Access Approval and Assured Workloads]]: show whether Google staff can reach your data and where it lives, with Access Transparency, Access Approval, Assured Workloads and location evidence.

## Frameworks for engineering teams

- [[common-control-framework-for-platform-teams|One control set for many frameworks: a common control framework for platform teams]]: keep one platform control set with stable IDs in Git, map it to SOC 2, ISO 27001, NIS2, DORA and PCI DSS, and collect each piece of evidence once.
- [[soc2-for-ci-cd-controls|SOC 2 controls for CI/CD pipelines]]: map SOC 2 Trust Services Criteria for change, access and monitoring to CI/CD evidence, and keep Type II evidence for the whole audit period.
- [[iso-27001-annex-a-for-platform-teams|ISO 27001 Annex A controls for platform teams]]: which ISO/IEC 27001:2022 Annex A controls a platform team owns, who owns each, and the Git, CI, GKE and Terraform evidence behind them.
- [[nis2-basics-for-engineering-teams|NIS2 basics for engineering teams]]: what the NIS2 Directive asks of engineering teams: Article 21 risk measures and Article 23 reporting, mapped to evidence a platform already has.
- [[dora-eu-operational-resilience-for-engineers|DORA (EU regulation) for engineering teams: ICT operational resilience]]: what the EU DORA regulation asks of ICT engineering at financial entities and their ICT providers, kept separate from DORA delivery metrics.

## Related elsewhere

- [[patterns/linux-host-hardening-with-chef-and-inspec|Linux host hardening with Chef and InSpec]]: apply a CIS-style Level 1 baseline to Linux VMs and build agents with Chef, and verify it continuously with InSpec.
- [[patterns/image-signing-and-admission-verification|Image signing with cosign and verification at admission]]: sign image digests in GitLab CI or Jenkins, define an identity policy per repository, and enforce it at admission with Kyverno or Binary Authorization.
- [[tools/gatekeeper-vs-kyverno|Gatekeeper vs Kyverno vs ValidatingAdmissionPolicy]]: choose an admission policy engine for GKE by comparing OPA Gatekeeper, Kyverno and the built-in ValidatingAdmissionPolicy on language, mutation, reporting and availability.
- [[patterns/conftest-policy-gate-for-manifests|Conftest policy gate for rendered Kubernetes manifests]]: run OPA Conftest in GitLab CI and Jenkins on helm template output so policy violations stop the merge request before Argo CD sees them.
- [[patterns/terraform-plan-policy-checks|Policy checks on Terraform plans]]: evaluate Terraform plan JSON with Conftest and static scanners in GitLab CI, and treat plan files as secrets, so risky GCP changes are stopped before apply.
- [[runbooks/policy-rollout-audit-to-enforce|Rolling out a new policy from audit to enforce]]: step-by-step rollout of a new admission or CI policy on GKE with Argo CD, from audit and warn to per-namespace and cluster-wide enforcement, with rollback.
- [[standards/change-freezes-and-maintenance-windows|Change freezes and maintenance windows]]: standard for when to freeze changes and how to enforce freezes in GKE, Argo CD and GitLab, with an override path and a security fast path.

> [!warning] Not legal or audit advice
> These notes are general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation.
