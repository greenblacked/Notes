---
title: Runbooks
description: Step-by-step operational procedures for this site, and the structure every runbook follows.
tags:
  - runbooks
  - meta
created: 2026-10-11
modified: 2026-10-16
draft: false
---

A runbook is a procedure written for the moment you have to do the thing: release, roll back, recover. It assumes you know what the system is but not the exact commands, and it says how to tell that each step worked.

## Incidents

- [[incident-response|Incident response]]: a practical incident process: declare, severity levels, roles, Slack conventions, update cadence and templates, mitigation first, handover and follow-up.
- [[leaked-credential-rotation|Leaked credential rotation]]: contain, revoke and rotate a leaked credential (GCP service account key, GitLab or Artifactory token, Kubernetes secret), audit its use and prevent a repeat.
- [[tls-certificate-renewal|TLS certificate renewal]]: find certificate expiry, renew with cert-manager, debug Certificate, Order and Challenge objects, handle Google-managed certificates on GKE, and alert before expiry.

## Kubernetes and GKE

- [[kubernetes-pod-troubleshooting|Kubernetes pod troubleshooting]]: triage Pending, CrashLoopBackOff, ImagePullBackOff, OOMKilled, CreateContainerConfigError, readiness failures and evictions with exact kubectl commands.
- [[helm-release-rollback|Helm release rollback]]: roll back a Helm release with history and rollback, recover failed or pending-upgrade states, use atomic and wait, and revert in Git when Argo CD manages it.
- [[gke-cluster-upgrade|GKE cluster upgrade]]: upgrade a GKE control plane and node pools safely: channels, maintenance windows, deprecated API checks, surge or blue-green, PDBs, validation and rollback limits.

## Infrastructure as code

- [[terraform-state-recovery|Terraform state recovery]]: recover from stuck locks, corrupted or lost state, refactors with state mv/rm/import, drift and provider upgrade breakage, with a backup before every destructive step.

## This site

- [[cloudflare-workers-deploy-and-rollback|Deploy and roll back on Cloudflare Workers]]: release a version, verify it, check what is live, roll back or roll forward, and fix the failures seen in real runs.

## Structure every runbook follows

1. **When to use**: the trigger, and when to use something else instead.
2. **Preconditions**: access, state and tools that must be in place before step 1.
3. **Steps**: numbered, with exact copy-pasteable commands.
4. **Validation**: how to confirm the result, with the expected output.
5. **Rollback**: how to undo the change, or a statement that it cannot be undone.
6. **Troubleshooting**: symptoms and fixes for failures that actually happened.

> [!tip] Keep them true
> A runbook that disagrees with the repository is worse than none. Each one says which files it was checked against; when those change, update the runbook and its `modified` date in the same pull request.

Runbooks describe how to operate something; the reasoning behind the design lives in the [[adr/index|architecture decisions]] and the [[patterns/index|patterns]].
