---
title: Architecture
description: "Reference designs for the platform: cloud foundations, networking, cluster topology, reliability and cost."
tags:
  - architecture
  - meta
created: 2026-10-17
modified: 2026-10-21
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
- [[edge-and-ingress-cloudflare-gclb-gateway-api|Edge and ingress: Cloudflare, Google Cloud Load Balancing and the GKE Gateway API]]: reference design for the path from Cloudflare through a Google Cloud load balancer to GKE Gateway API routes, with origin lock-down and clear layer ownership.
- [[hybrid-connectivity-ha-vpn-and-interconnect|Hybrid connectivity on GCP: HA VPN, Cloud Interconnect and Cloud Router]]: reference design for redundant links between on-prem and a GCP hub VPC with HA VPN, Interconnect, Cloud Router BGP, route control and failover drills.
- [[east-west-service-security-gke|East-west service security on GKE: workload identity, mTLS and authorization]]: reference design for service-to-service security in GKE with network policy, workload identity, mTLS with or without a mesh, and authorization.

## Platform and delivery

- [[gke-platform-topology-and-tenancy|GKE platform topology, clusters, node pools, fleets and tenancy]]: how many GKE clusters to run, how to lay out node pools, and how to isolate tenants with namespaces, quotas and policy.
- [[gitops-repo-topology-and-promotion|GitOps repository topology and environment promotion]]: how to lay out the Argo CD config repository, generate Applications per environment, promote image digests by merge request, and roll back by revert.
- [[artifact-management-architecture-artifactory-ha|Artifact management architecture: Artifactory HA and replication]]: reference design for highly available Artifactory with a shared database and filestore, local, remote and virtual repositories, and replication between regions.
- [[ci-platform-gitlab-runners-and-jenkins-agents-on-gke|CI platform architecture: GitLab runners and Jenkins agents on GKE]]: reference design for a shared CI platform on GKE with runner and agent pools, trust zones, caching, capacity, keyless cloud access and failure modes.
- [[software-supply-chain-end-to-end|Software supply chain end to end: from commit to running pod]]: reference design linking source controls, builds, SBOMs, signing, provenance, registry promotion by digest and admission checks into one verifiable chain.
- [[golden-path-templates-architecture|Golden path templates: versioned service scaffolds that stay current]]: reference design for versioned golden path templates that create services with CI, Helm and policy already wired, and keep existing services up to date.
- [[internal-developer-platform-architecture|Internal developer platform architecture: portal, catalog and self-service]]: reference design for an internal developer platform with a service catalog, ownership, self-service scaffolding and infrastructure, and GitOps delivery behind a paved road.
- [[infrastructure-delivery-terraform-pipelines-and-drift|Infrastructure delivery architecture: Terraform pipelines, stack identities and drift detection]]: reference design for delivering Terraform across many GCP projects with one identity per stack, a saved-plan apply flow, drift detection and break-glass.
- [[ephemeral-preview-environments-on-gke|Ephemeral preview environments per merge request on GKE]]: reference design for short-lived review environments per merge request on GKE, with namespaces, DNS and TLS, access, cost limits and cleanup.
- [[sonarqube-platform-architecture|SonarQube platform architecture: server, database, scanners in CI and scale]]: reference design for SonarQube as a shared platform service, covering editions, PostgreSQL, GKE or VMs, scanners in CI, throughput and DR.

## Reliability and cost

- [[disaster-recovery-tiers-rpo-rto|Disaster recovery tiers with RPO and RTO on GCP]]: a reference design for choosing a disaster recovery tier on GCP and GKE, with RPO and RTO targets, an active-passive layout, data choices and a rehearsal plan.
- [[backup-architecture-gke-cloud-sql-gcs|Backup architecture for GKE, Cloud SQL and Cloud Storage]]: a reference design that separates what GitOps and IaC rebuild from what needs backups, with Backup for GKE, Cloud SQL PITR, bucket retention and restore drills.
- [[observability-pipeline-opentelemetry|Observability pipeline with OpenTelemetry, collectors, sampling and retention]]: a reference design for metrics, logs and traces through OpenTelemetry Collector agent and gateway tiers, with tail sampling, cardinality controls and retention tiers.
- [[finops-cost-allocation-and-guardrails|FinOps on GCP: cost allocation, budgets and guardrails]]: a reference design for allocating GCP and GKE cost with labels, billing export and budgets, plus guardrails in code and a monthly review for engineering managers.
- [[multi-region-gke-active-active|Multi-region GKE in active-active: traffic, state and deploys]]: reference design for two or more GKE regions serving live traffic, with a global load balancer, health-based failover, per-region state and region-aware GitOps.
- [[cloud-sql-postgres-platform-architecture|Cloud SQL for PostgreSQL as a platform service: connectivity, HA, replicas and access]]: reference design for Cloud SQL for PostgreSQL behind GKE workloads, covering private connectivity, the Auth Proxy, IAM database auth, HA, and read and DR replicas.
- [[pubsub-event-driven-messaging|Event-driven messaging with Pub/Sub: topics, subscriptions, retries and dead letters]]: reference design for Pub/Sub with GKE consumers, covering ownership, delivery semantics, idempotency, ordering, dead letters, replay and backlog autoscaling.
- [[batch-and-scheduled-workloads-gcp|Batch and scheduled workloads on GCP: Kubernetes CronJobs, Cloud Run jobs and Batch]]: reference design for scheduled and batch work on GCP with GKE CronJobs, Cloud Run jobs or Batch, retries, idempotency and freshness alerts.

## Observability and secrets

- [[logging-architecture-gke-and-cloud-logging|Logging architecture for GKE: collection, routing and retention]]: reference design for collecting GKE logs, routing them with Cloud Logging sinks and log buckets across projects, and controlling retention, access and cost.
- [[multi-tenant-prometheus-architecture|Multi-tenant Prometheus: per-team scraping, central storage and tenant isolation]]: reference design for multi-tenant metrics on GKE with Prometheus, Thanos, Mimir or Managed Service for Prometheus, covering tenant identity, query isolation and limits.
- [[secrets-architecture-gcp-and-gke|Secrets architecture on GCP and GKE: source of truth, delivery and rotation]]: reference design for where secrets live, how workloads and CI receive them, how they rotate and how access is audited across GCP and GKE.
- [[alerting-and-paging-pipeline|Alerting and paging pipeline: rule evaluation, routing by ownership and meta-monitoring]]: reference design for delivering alerts to the owning on-call team with HA Alertmanager, ownership routing, inhibition and a dead man's switch.

## Security and guardrails

- [[threat-detection-and-response-gcp-gke|Threat detection and response on GCP and GKE: findings, routing and first response]]: reference design for detecting threats on GCP and GKE, from signal sources and finding routing to starter detections, safe automation and evidence.
- [[policy-guardrail-layers-org-to-admission|Guardrail layers: where each policy lives from the organization to the running pod]]: reference map of guardrail layers on GCP and GKE, from org policy and IAM deny to plan checks, CI gates, admission and detection, and where each rule belongs.

Decisions that follow from these designs are recorded in the [[adr/index|architecture decisions]].

> [!note] Designs, not decisions
> A reference design shows a sensible option and its costs. The decision to adopt it, and the reasons, are recorded as ADRs.
