---
title: Standards
description: How notes are written, and how production changes, code reviews and postmortems are done.
tags:
  - standards
  - meta
created: 2026-10-10
modified: 2026-10-21
draft: false
---

Standards say how the team works: how notes are written, how production changes are made and reviewed, and how incidents are written up.

- [[writing-notes|Writing notes]]: file naming, required frontmatter, tagging taxonomy, wikilinks, callouts and the ADR lifecycle.

## Engineering standards

- [[production-change-checklist|Production change checklist]]: standard for planning, executing, verifying and communicating production changes, with a risk classification table and a copy-paste checklist.
- [[code-review|Code review for infrastructure code]]: review standard for Terraform, Helm, CI YAML and Dockerfiles covering checks, MR size, turnaround, approvals, tone and automation.
- [[blameless-postmortems|Blameless postmortems]]: when a postmortem is required, how to run it without blame, and a full template with timeline, contributing factors and tracked action items.

> [!warning] Commands are examples
> Commands in these notes use example project and cluster names. Read them before you run them.

- [[structured-logging-conventions|Structured logging conventions]]: one JSON log schema for services on GKE, with required fields, severity mapping, trace correlation, data that must never be logged, and a CI check.
- [[change-freezes-and-maintenance-windows|Change freezes and maintenance windows]]: standard for when to freeze changes and how to enforce freezes in GKE, Argo CD and GitLab, with an override path and a security fast path.
- [[production-readiness-review|Production readiness review]]: a once-per-service launch gate with a checklist, evidence links, a go, conditional-go or no-go record, and a re-review schedule for critical services.
- [[error-budget-policy|Error budget policy and release gating]]: a written policy that turns SLO error budgets into tiers, approvals, an exception flow, a CI release gate and a quarterly review.
- [[toil-budget|Toil measurement and the toil budget]]: define toil strictly, track it, cap it, rank automation by payback and report it with SLO and on-call data, with a worked certificate renewal example.
- [[vulnerability-management-slas|Vulnerability management lifecycle and remediation SLAs]]: intake, triage order, a proposed SLA matrix, expiring exceptions, a Trivy CI gate with an allowlist, and weekly reporting for container and cloud findings.
- [[platform-threat-modelling|Threat modelling for GKE, GCP and CI/CD platforms]]: a repeatable STRIDE-per-boundary process for platform changes, with a data flow diagram, a threat register template and a worked metadata server example.
- [[artifact-retention-policy|Artifact retention and cleanup policy]]: retention rules for CI artifacts, images, packages and caches across GitLab, GCS, Artifact Registry and Artifactory, with automated cleanup that protects anything deployed.
- [[bash-scripts|Bash script standard]]: structure, safety rules and ShellCheck CI gating for Bash in ops repositories, with copy-ready templates and a rule for when to switch to Python.
- [[python-ops-scripts-standard|Python ops script standard]]: layout, version policy, hashed dependencies, CLI, logging, exit codes, subprocess and cloud SDK safety, and the CI gate for Python in ops repositories.
- [[service-tiering-standard|Service tiering standard]]: one criticality scale for services, tier 0 to tier 3, and what each tier requires in SLOs, on-call, DR, restore drills, readiness review, change approval and patch deadlines.
- [[data-classification-and-handling-standard|Data classification and handling standard]]: four data classes and what each requires on GCP, GKE and in CI for storage, encryption, access, logging, retention, non-production copies and AI tools.
- [[slo-definition-standard|SLO and SLI definition standard]]: what makes a valid SLO, with user-centred SLIs per service type, the SLO document, targets by tier, windows, SLO as code, exclusions and review.
- [[metrics-naming-and-cardinality-standard|Metrics naming and cardinality standard]]: metric and label naming, units, required metrics per service type, histogram buckets, recording rule names and a cardinality budget.

## Platform and delivery standards

- [[alert-and-runbook-standard|Alert and runbook standard]]: actionable-only paging, required alert labels and annotations, severity routing, rule tests, and the required sections, testing and retirement of the runbooks alerts link to.
- [[api-deprecation-policy|API deprecation policy for platform and Kubernetes APIs]]: announce, warn, sunset and remove stages for internal APIs, Deprecation and Sunset headers, consumer tracking, and the removed-API gate before GKE upgrades.
- [[artifactory-artifact-naming-and-versioning|Artifactory repository and artifact naming standard]]: repository keys, virtual resolution order, write permissions, artifact names, immutable versions and build-info rules for Docker, Helm, Maven, npm and generic artifacts.
- [[branching-and-merge-standard|Branching and merge standard]]: branch model and naming, protected branches, merge methods, required checks, release tags and the hotfix path for infrastructure and site repositories.
- [[ci-pipeline-standard|CI pipeline standard for GitLab CI and Jenkins]]: required stages, pinning, timeouts, retries, caches, protected deploys and required checks for GitLab CI and Jenkins pipelines.
- [[dependency-update-policy|Dependency update and end-of-life policy]]: update classes, deadlines, auto-merge limits, ownership of majors and end-of-life tracking for base images, CI tools, charts, providers, runtimes and GKE.
- [[dockerfile-standard|Dockerfile standard]]: required and forbidden Dockerfile rules, a hadolint CI gate, a base-image allowlist, OCI labels and tag rules, with a reviewer checklist.
- [[gcp-firewall-rule-standard|GCP firewall rule standard]]: where GCP firewall policies and rules live, how they target, prioritise, name, log and expire, with Terraform, CI checks and audit commands.
- [[gcp-resource-naming-and-labels-standard|GCP resource naming and labels standard]]: naming patterns for projects, service accounts, buckets, networks, keys and clusters, and the required Google Cloud labels for ownership and cost.
- [[helm-chart-standard|Helm chart standard: required rules, versioning and exceptions]]: enforceable MUST and SHOULD rules for in-house Helm charts, chart version bump rules, values deprecation, CI enforcement and the exception path.
- [[kubernetes-labels-and-annotations-standard|Kubernetes labels, annotations and naming standard]]: required labels and annotations, object naming rules, selector immutability, and how cost, ownership and policy tooling rely on them, with CI and admission enforcement.
- [[kubernetes-workload-baseline-standard|Kubernetes workload baseline standard]]: required security context, image, resource, probe, disruption, spread, shutdown and service account fields for every workload, with admission enforcement.
- [[repository-baseline-standard|Repository baseline standard]]: files, ownership metadata, protections and security settings every repository needs from its first commit, with read-only audit scripts.
- [[scheduled-jobs-standard|Scheduled jobs standard]]: rules for Kubernetes CronJobs, Cloud Scheduler, GitLab schedules and Jenkins cron covering concurrency, deadlines, idempotency, time zones and missed-run alerts.
- [[terraform-module-standard|Terraform module standard]]: required files, input and output contracts, version constraints, lock file rules, testing and breaking-change rules for Terraform modules we publish or consume.
- [[tls-and-certificate-standard|TLS and certificate standard]]: protocol floor, key types, certificate lifetimes, automated issuance, private CAs, mTLS and expiry alerting for every TLS endpoint we run.

## Changing this site

- Use Conventional Commits (for example `feat:`, `fix:`, `docs:`, `ci:`, `build:`, `chore:`, optionally scoped as `fix(ci):`) and keep the subject line to 72 characters or fewer.
- Every change goes through a pull request into `main`, and the `CI OK` check must pass. Merge with a merge commit.
- Merging to `main` deploys the stage site (public, noindex) automatically. Production is never touched by a merge.
- Production releases are `vX.Y.Z` tags created by the Cut release workflow (it dispatches Deploy production on the tag), and need approval in the `production` environment.
- Notable changes go into `CHANGELOG.md` under _Unreleased_.

Changes to a standard follow the same rule as any other decision: if it is significant, record it as an [[adr/index|ADR]].
