---
title: Compliance
description: Controls, audit evidence, access reviews and the software supply chain, and how the platform produces proof of them.
tags:
  - compliance
  - meta
created: 2026-10-17
modified: 2026-10-17
draft: false
---

These notes cover how a DevOps platform produces evidence for the controls it is asked to meet. The aim is that Git, CI, Argo CD, GKE and Cloud Audit Logs already hold the records, so an audit reads system output instead of hand-written tickets.

## Change control and evidence

- [[change-management-controls-and-pipeline-evidence|Change management controls mapped to pipeline evidence]]: map change-control objectives to evidence that Git, GitLab CI, Argo CD and GKE already produce, so audits read system records instead of hand-written tickets.
- [[audit-evidence-collection-and-retention|Audit evidence collection and retention for CI/CD and cloud]]: what evidence to keep from Git, CI, Argo CD, GKE and Cloud Audit Logs, how long, how to make it tamper-evident and how to retrieve it for an audit period.
- [[separation-of-duties-in-deployments|Separation of duties in deployments]]: standard for who may author, review, approve and deploy, and how to enforce it in GitLab, Jenkins and Argo CD, with break-glass and a small-team compensating control.

## Access and hardening

- [[access-reviews-gcp-and-gke|Access reviews and least privilege on GCP and GKE]]: run a quarterly access review for GCP IAM, GKE RBAC, CI service accounts and break-glass accounts, and keep evidence of it.
- [[cis-benchmarks-with-kube-bench|CIS Kubernetes benchmarks with kube-bench]]: run CIS Kubernetes benchmark checks with kube-bench on GKE nodes, read the results, record exceptions and keep versioned evidence.
- [[gcp-organization-policy-guardrails|GCP organization policy guardrails as code]]: manage a baseline of GCP organization policy constraints in Terraform, with inheritance, custom constraints, dry-run rollout and a recorded exception path.

## Policy and exceptions

- [[policy-exception-and-waiver-process|Policy exception and waiver process]]: request, approve, time-box, record and enforce policy exceptions in code, so a waiver expires by default instead of becoming permanent.

## Supply chain

- [[sbom-generation-and-storage|SBOM generation and storage]]: generate one SBOM per image digest in CI, attest it to the image, store it next to the artifact and query it when a new CVE lands.
- [[slsa-build-provenance|SLSA build levels and provenance for GitLab CI and Jenkins]]: what SLSA Build levels ask for, what is realistic on GitLab CI and self-hosted Jenkins, and how consumers verify signed provenance.
- [[open-source-license-compliance|Open-source licence compliance in the pipeline]]: build a licence inventory from SBOMs, classify licences into allow, review and deny lists, gate merges in CI and handle exceptions.

## Data protection

- [[pci-dss-and-gdpr-for-devops-logs-and-data|PCI DSS and GDPR touch points for DevOps, logs, personal data and retention]]: where DevOps tooling touches cardholder or personal data, and how to keep it out, redact it before storage, scope environments and set retention.

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
