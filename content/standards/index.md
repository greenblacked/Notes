---
title: Standards
description: How notes are written, and how production changes, code reviews and postmortems are done.
tags:
  - standards
  - meta
created: 2026-10-10
modified: 2026-10-17
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

## Changing this site

- Every change goes through a pull request into `main`, and the `CI OK` check must pass. Merge with a merge commit.
- Merging to `main` deploys the stage site (behind Cloudflare Access) automatically. Production is never touched by a merge.
- Merging to `main` deploys nothing by itself. Merging to `dev` or `main` deploys nothing. The owner updates the stage site (behind Cloudflare Access) by running Deploy stage on `dev`.
- Production releases are `vX.Y.Z` tags created by the Release workflow, and need approval in the `production` environment.
- Notable changes go into `CHANGELOG.md` under _Unreleased_.

Changes to a standard follow the same rule as any other decision: if it is significant, record it as an [[adr/index|ADR]].
