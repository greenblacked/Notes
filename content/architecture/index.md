---
title: Architecture
description: "Reference designs for the platform: cloud foundations, networking, cluster topology, reliability and cost."
tags:
  - architecture
  - meta
created: 2026-10-17
modified: 2026-10-17
draft: false
---

These notes are reference designs for a GCP and GKE platform. Each one describes a target design, the trade-offs behind it and how to check that a real setup matches. They are for senior DevOps engineers and engineering managers who need a starting point for a design review, not a finished blueprint.

## Cloud foundations

- [[gcp-resource-hierarchy-and-landing-zone|GCP resource hierarchy and landing zone]]: a target design for the GCP organization, folders and projects, with a bootstrap project and a Terraform project factory.
- [[environment-separation-on-gcp|Environment separation on GCP: projects, clusters and what is shared]]: compare project, cluster and namespace isolation for dev, stage and prod on GCP, and decide what may cross environment boundaries.
- [[iam-groups-and-ci-workload-identity-federation|IAM design: group-based access and keyless CI with Workload Identity Federation]]: grant GCP access through groups at folder level, and let GitLab CI and Jenkins authenticate without service account keys.

## Networking

- [[shared-vpc-hub-and-spoke|Shared VPC and hub-and-spoke networking on GCP]]: a reference design for Shared VPC host and service projects, a hub for shared services and hybrid links, per-environment spokes, an IP plan and firewall policies.
- [[private-gke-and-controlled-egress|Private GKE clusters and controlled egress]]: a reference design for GKE clusters with private nodes, a restricted control-plane endpoint, Cloud NAT, Google API access without public egress and an egress allowlist.
- [[cloud-dns-hybrid-and-multi-project|Cloud DNS design for hybrid and multi-project setups]]: a reference design for Cloud DNS with a central DNS hub, peering zones to spokes, forwarding to on-prem resolvers and split-horizon names per environment.
- [[zero-trust-access-iap-and-vpc-service-controls|Zero-trust access with IAP and VPC Service Controls]]: a reference design that replaces bastions and broad VPN access with Identity-Aware Proxy, access levels and VPC Service Controls perimeters.

## Platform and delivery

- [[gke-platform-topology-and-tenancy|GKE platform topology, clusters, node pools, fleets and tenancy]]: how many GKE clusters to run, how to lay out node pools, and how to isolate tenants with namespaces, quotas and policy.
- [[gitops-repo-topology-and-promotion|GitOps repository topology and environment promotion]]: how to lay out the Argo CD config repository, generate Applications per environment, promote image digests by merge request, and roll back by revert.

## Reliability and cost

- [[disaster-recovery-tiers-rpo-rto|Disaster recovery tiers with RPO and RTO on GCP]]: a reference design for choosing a disaster recovery tier on GCP and GKE, with RPO and RTO targets, an active-passive layout, data choices and a rehearsal plan.
- [[backup-architecture-gke-cloud-sql-gcs|Backup architecture for GKE, Cloud SQL and Cloud Storage]]: a reference design that separates what GitOps and IaC rebuild from what needs backups, with Backup for GKE, Cloud SQL PITR, bucket retention and restore drills.
- [[observability-pipeline-opentelemetry|Observability pipeline with OpenTelemetry, collectors, sampling and retention]]: a reference design for metrics, logs and traces through OpenTelemetry Collector agent and gateway tiers, with tail sampling, cardinality controls and retention tiers.
- [[finops-cost-allocation-and-guardrails|FinOps on GCP: cost allocation, budgets and guardrails]]: a reference design for allocating GCP and GKE cost with labels, billing export and budgets, plus guardrails in code and a monthly review for engineering managers.

Decisions that follow from these designs are recorded in the [[adr/index|architecture decisions]].

> [!note] Designs, not decisions
> A reference design shows a sensible option and its costs. The decision to adopt it, and the reasons, are recorded as ADRs.
