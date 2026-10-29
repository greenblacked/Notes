---
title: Patterns
description: Reusable, tested ways of building things on the platform.
tags:
  - patterns
  - meta
created: 2026-10-10
modified: 2026-10-29
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
- [[test-sharding-flaky-tests|Test sharding and flaky-test management in CI]]: split test suites by timing history on GitLab CI and Jenkins, retry only infrastructure failures, and run a quarantine process with owners and deadlines.
- [[artifactory-remote-repo-caching-for-ci|Caching public registries through Artifactory remote repositories for CI]]: put Artifactory remote and virtual repositories in front of Docker Hub, npm, PyPI, Maven and Helm so CI survives upstream rate limits and outages.
- [[artifactory-access-tokens-and-oidc-for-ci|Scoped Artifactory access for CI with access tokens and OIDC]]: replace shared Artifactory passwords in CI with short-lived scoped access tokens or OIDC federation from GitLab CI and Jenkins, with permission targets per repository.
- [[buildkit-registry-cache-in-ci|BuildKit registry cache in CI]]: export and import BuildKit layer cache through a registry in GitLab CI and Jenkins for fast image builds, without letting untrusted branches poison the cache.
- [[gitlab-ci-components-and-includes|Reusable GitLab CI components and includes with versioned inputs]]: share pipeline logic across projects with include, CI/CD components and the catalog, using typed inputs and pinned semver versions.
- [[multi-arch-image-builds|Multi-architecture container images in GitLab CI and Jenkins]]: build amd64 and arm64 images on native rootless runners, merge them into one image index, sign it, and deploy it by digest to mixed GKE pools.
- [[gitlab-merge-trains-and-merged-results|Merged results pipelines and merge trains in GitLab]]: keep the default branch green under many concurrent merge requests by testing merged results and queueing merges on a train, with rules and costs.
- [[gitlab-review-environments-on-gke|Review environments per merge request on GKE]]: give every merge request its own isolated, quota-bound namespace on GKE with a URL, automatic stop, a scheduled janitor and Spot capacity.
- [[private-ca-and-egress-proxy-trust|Private CA trust and egress proxies for containers, CI jobs and runtimes]]: make OS stores, Java, Python, Node, Go and CI runners trust an internal CA and use an egress proxy correctly, without turning off TLS verification.

## Kubernetes and GKE

- [[helm-chart-conventions|Helm chart conventions]]: conventions for in-house Helm charts covering layout, values schema, labels, probes, optional PDB and HPA, secrets, versioning, testing and publishing.
- [[kubernetes-resource-requests-and-limits|Kubernetes resource requests and limits]]: how requests and limits drive scheduling, QoS and throttling, how to size them from real usage, and the traps with GKE Autopilot, the JVM and Go.
- [[kubernetes-namespace-quotas-and-limitranges|Namespace resource quotas and LimitRanges]]: bound aggregate allocations and object counts, budget rollout headroom, and separate admission failures from scheduling failures.
- [[zero-downtime-deployments-kubernetes|Zero-downtime deployments on Kubernetes]]: rolling update settings, probes, graceful shutdown, PodDisruptionBudgets, GCP load balancer draining and expand/contract migrations, with a verification checklist.
- [[kubernetes-network-policies|Kubernetes network policies]]: default-deny NetworkPolicies with DNS, namespace and Google API egress on GKE, plus testing, common mistakes and a safe rollout.
- [[gke-workload-identity|Workload Identity Federation for GKE]]: give Pods access to Google Cloud APIs without service account keys, using a direct IAM principal or GSA impersonation.
- [[external-secrets-with-secret-manager|External Secrets Operator with Google Secret Manager]]: sync Google Secret Manager secrets into Kubernetes Secrets on GKE with External Secrets Operator and Workload Identity, including refresh, RBAC and failure modes.
- [[pod-security-admission|Pod Security admission and policy enforcement]]: enforce Pod Security Standards per namespace with warn, audit and enforce labels, and add Kyverno or Gatekeeper policy for what PSS cannot express.
- [[kubernetes-autoscaling|Kubernetes autoscaling on GKE: HPA, VPA and the cluster autoscaler]]: how the Horizontal Pod Autoscaler, Vertical Pod Autoscaler and GKE cluster autoscaler work together, with manifests, Terraform, pitfalls and checks.
- [[progressive-delivery-argo-rollouts|Progressive delivery with Argo Rollouts and metric analysis]]: run canary releases with Argo Rollouts under Argo CD, gate each step on Prometheus metrics, and abort or promote safely.
- [[stateful-workloads-gke|Stateful workloads on GKE: StatefulSets, PDBs and node upgrades]]: shape StatefulSets, PodDisruptionBudgets, zone spread and regional disks so a quorum-based workload survives GKE node upgrades and drains.
- [[kubernetes-node-sysctls|Kernel and sysctl tuning for Kubernetes nodes]]: the Linux kernel limits that cause intermittent failures on Kubernetes nodes, how to measure each, and where to change it on GKE, self-managed nodes and in a pod.
- [[gke-blue-green-releases|Blue-green releases on GKE with Service selectors and Gateway API weights]]: run two full stacks side by side on GKE, smoke-test the idle one, switch traffic by Service selector or HTTPRoute weights, and roll back in seconds.
- [[spinnaker-canary-analysis|Canary analysis with Spinnaker and Kayenta]]: gate Spinnaker deployments to GKE on Kayenta canary judgement against Prometheus or Cloud Monitoring metrics, with abort and rollback paths.
- [[gke-node-pool-upgrade-strategies|GKE node pool upgrade strategies: surge and blue-green]]: choose surge or blue-green upgrades per GKE node pool, set them in Terraform, and plan for PDBs, quota, soak time and rollback.
- [[helm-library-and-umbrella-charts|Helm library charts and umbrella charts]]: share Helm templates through a library chart, decide when an umbrella chart is justified, and version and test both without value collisions.
- [[pod-disruption-budgets-for-stateless-services|PodDisruptionBudgets for stateless services]]: choose minAvailable or maxUnavailable, set the unhealthy pod eviction policy, and avoid PDBs that deadlock GKE upgrades and node drains.
- [[priority-classes-and-preemption|Pod priority classes and preemption]]: protect critical workloads with tiered PriorityClasses, keep batch jobs non-preempting, and avoid preemption storms on GKE Standard and Autopilot.
- [[topology-spread-constraints-gke|Spreading stateless replicas across zones and nodes on GKE]]: use topologySpreadConstraints to spread replicas across zones and nodes, pick whenUnsatisfiable, and combine spread with PDBs, HPA and regional node pools.
- [[patterns/kubernetes-jobs-and-cronjobs|Reliable Kubernetes Jobs and CronJobs]]: configure Jobs and CronJobs so batch work retries sensibly, never runs twice by surprise, finishes with sidecars, and alerts on failed or missed runs.
- [[gke-spot-vms-for-workloads|Running stateless and batch workloads on GKE Spot VMs]]: which workloads fit Spot VMs on GKE, how to build tainted Spot pools with an on-demand fallback, and how preemption, PDBs and the autoscaler behave.
- [[crd-lifecycle-with-helm-and-argocd|CRD lifecycle with Helm and Argo CD]]: install, upgrade, version and protect CustomResourceDefinitions with Helm and Argo CD, so operator upgrades never delete or strand custom resources.

## Infrastructure as code

- [[terraform-module-and-state-layout|Terraform module and state layout]]: a repository layout, remote state in GCS, version pinning and GitLab plan/apply flow that keep Terraform changes small, reviewable and recoverable.
- [[terraform-testing|Testing Terraform modules, static checks, terraform test and Terratest]]: three levels of Terraform module tests, from fmt and tflint to mocked terraform test runs and Terratest in a sandbox project, and when each one pays off.
- [[terraform-plan-policy-checks|Policy checks on Terraform plans]]: evaluate Terraform plan JSON with Conftest and static scanners in GitLab CI, and treat plan files as secrets, so risky GCP changes are stopped before apply.
- [[terraform-module-versioning|Terraform module versioning and upgrades]]: version shared Terraform modules with semver tags, pin consumers and providers, and roll module upgrades through environments without surprise plans.
- [[terraform-gcp-iam-member-binding-policy|GCP IAM in Terraform without lockouts: member, binding and policy resources]]: when to use the google_*_iam_member, _binding and _policy resources, how to stop them fighting, and how to keep the Terraform identity from locking itself out.
- [[terraform-importing-existing-gcp-resources|Adopting existing GCP resources with Terraform import blocks]]: bring existing Cloud resources under Terraform management with a reviewed import-only plan and a clean follow-up plan.
- [[secrets-out-of-terraform-state|Keeping secrets out of Terraform state]]: design Terraform on GCP so passwords and keys never land in state or plan files, protect the state bucket anyway, and clean up secrets that are already there.

## Data

- [[postgres-expand-contract-migrations|Zero-downtime Postgres schema migrations (expand and contract)]]: change a large live Postgres or Cloud SQL schema without outages using expand, migrate and contract phases, lock timeouts, concurrent indexes, NOT VALID constraints and batched backfills.
- [[postgres-connection-pooling-gke|Postgres connection pooling for GKE workloads]]: size a connection budget for autoscaled pods against Cloud SQL, and run PgBouncer as a sidecar or shared Deployment behind the Auth Proxy.
- [[postgres-autovacuum-health-and-tuning|PostgreSQL autovacuum health and tuning]]: inspect cleanup backlog and retained transaction horizons, tune busy tables, and recognise freeze-safety escalation.

## Policy and supply chain

- [[conftest-policy-gate-for-manifests|Conftest policy gate for rendered Kubernetes manifests]]: run OPA Conftest in GitLab CI and Jenkins on helm template output so policy violations stop the merge request before Argo CD sees them.
- [[image-signing-and-admission-verification|Image signing with cosign and verification at admission]]: sign image digests in GitLab CI or Jenkins, define an identity policy per repository, and enforce it at admission with Kyverno or Binary Authorization.
- [[cloud-kms-key-management|Cloud KMS key management and rotation]]: key rings and keys per environment on Google Cloud KMS, rotation, safe disable and destroy, IAM separation, org policy guardrails, CMEK for GKE and Cloud SQL.
- [[gcp-audit-logs-siem|GCP audit logs and SIEM feeds]]: route Cloud Audit Logs, GKE audit logs and Security Command Center findings to a central project and a SIEM, with locked retention, cost control and detection filters.
- [[secret-rotation-without-downtime|Rotating application secrets without downtime]]: rotate credentials with overlapping validity: add the new version, roll consumers, then revoke the old one, across Secret Manager and External Secrets.

## Edge

- [[cloudflare-cache-strategy|Cloudflare cache strategy with Cache Rules, Cache-Control and purge]]: decide between origin headers and Cache Rules, set cache keys and stale directives, purge by tag or URL, and avoid caching personalised responses on Cloudflare.
- [[edge-waf-rate-limiting|Edge WAF and rate limiting with Cloudflare and Cloud Armor]]: layer Cloudflare and Cloud Armor WAF and rate limits as code, with a log-first rollout, skip rules for probes, false-positive handling and rollback.
- [[cloudflare-access-service-tokens|Cloudflare Access for internal apps with Terraform and service tokens]]: manage Cloudflare Access applications and policies as code, give CI and probes machine access with service tokens, rotate them, and validate the JWT at the origin.
- [[cert-manager-dns01-cloud-dns|cert-manager issuance with DNS-01 on Cloud DNS]]: design cert-manager ClusterIssuers on GKE with a Cloud DNS DNS-01 solver and Workload Identity, staged on the ACME staging endpoint before production.
- [[external-dns-on-gke|ExternalDNS on GKE with Cloud DNS]]: let ExternalDNS manage Cloud DNS records from Ingress, Service and Gateway resources with Workload Identity, ownership TXT records and a safe sync policy.

## Hosts

- [[linux-host-hardening-with-chef-and-inspec|Linux host hardening with Chef and InSpec]]: apply a CIS-style Level 1 baseline to Linux VMs and build agents with Chef, and verify it continuously with InSpec.

## Observability

- [[slo-burn-rate-alerting|SLO burn rate alerting]]: define SLIs and SLOs for HTTP services and alert on error budget burn with multi-window, multi-burn-rate rules in Prometheus and Cloud Monitoring.
- [[synthetic-monitoring-blackbox-and-uptime-checks|Synthetic monitoring with blackbox exporter and Cloud Monitoring uptime checks]]: probe services from the user's side with blackbox exporter and Cloud Monitoring uptime checks, and alert on failures and certificate expiry without noise.
- [[opentelemetry-tail-sampling-operations|Operating OpenTelemetry tail sampling]]: route by trace ID, size buffered state, test late spans and restarts, and make sampling loss and output budgets explicit.

## Reliability and performance

- [[timeouts-retries-load-shedding|Timeouts, retry budgets and load shedding]]: client and server mechanics that stop a partial failure from cascading, with Go examples, retry budgets, load shedding, alerts and a k6 overload test.
- [[load-and-performance-testing|Load and performance testing for services]]: plan and run smoke, load, stress, soak and spike tests with k6 or Locust, set SLO-based pass criteria and turn the results into a documented capacity limit.
- [[grpc-load-balancing-on-kubernetes|gRPC load balancing on Kubernetes and GKE]]: why gRPC over a ClusterIP Service pins traffic to a few Pods, and how to fix it with client-side balancing, connection age limits or an L7 proxy.

## Shape of a pattern note

A pattern note covers the following, in roughly this order; items 3 to 5 can be short or a link when another note already holds them:

1. The problem and when the pattern applies.
2. The steps, with commands that can be copied.
3. A way to verify it worked.
4. Troubleshooting for the failures you actually hit.
5. Rollback, when the change is not trivially reversible.

Patterns that embody a significant choice link to the [[adr/index|ADR]] that made it.
