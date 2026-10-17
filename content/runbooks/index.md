---
title: Runbooks
description: Step-by-step operational procedures for this site, and the structure every runbook follows.
tags:
  - runbooks
  - meta
created: 2026-10-11
modified: 2026-10-17
draft: false
---

A runbook is a procedure written for the moment you have to do the thing: release, roll back, recover. It assumes you know what the system is but not the exact commands, and it says how to tell that each step worked.

## Incidents

- [[incident-response|Incident response]]: a practical incident process: declare, severity levels, roles, Slack conventions, update cadence and templates, mitigation first, handover and follow-up.
- [[leaked-credential-rotation|Leaked credential rotation]]: contain, revoke and rotate a leaked credential (GCP service account key, GitLab or Artifactory token, Kubernetes secret), audit its use and prevent a repeat.
- [[tls-certificate-renewal|TLS certificate renewal]]: find certificate expiry, renew with cert-manager, debug Certificate, Order and Challenge objects, handle Google-managed certificates on GKE, and alert before expiry.
- [[compromised-cloud-cluster-containment|Compromised cloud project or cluster containment]]: contain a suspected compromise of a GCP project, GKE workload, node pool or CI credential while keeping the evidence, then decide between clean-up and rebuild.

## Kubernetes and GKE

- [[kubernetes-pod-troubleshooting|Kubernetes pod troubleshooting]]: triage Pending, CrashLoopBackOff, ImagePullBackOff, OOMKilled, CreateContainerConfigError, readiness failures and evictions with exact kubectl commands.
- [[helm-release-rollback|Helm release rollback]]: roll back a Helm release with history and rollback, recover failed or pending-upgrade states, use atomic and wait, and revert in Git when Argo CD manages it.
- [[gke-cluster-upgrade|GKE cluster upgrade]]: upgrade a GKE control plane and node pools safely: channels, maintenance windows, deprecated API checks, surge or blue-green, PDBs, validation and rollback limits.
- [[argocd-sync-failure-and-drift|Argo CD sync failure and drift]]: diagnose an Argo CD application that is OutOfSync, Degraded or failing to sync, tell drift from bad manifests, fix it in Git, and roll back safely.
- [[network-troubleshooting-dns-mtu-tls-load-balancers|Network troubleshooting, DNS, MTU, TLS and load balancer health checks]]: a symptom-first runbook for the four common network failure classes on GKE and GCP, with commands, expected output and a troubleshooting table.
- [[policy-rollout-audit-to-enforce|Rolling out a new policy from audit to enforce]]: step-by-step rollout of a new admission or CI policy on GKE with Argo CD, from audit and warn to per-namespace and cluster-wide enforcement, with rollback.
- [[node-resource-pressure-triage|Node resource pressure triage with USE and PSI]]: find out why a GKE or GCE node is slow, evicting pods or overloaded, using the USE method, Linux pressure stall information, cgroups and kubelet eviction signals.
- [[kubernetes-packet-capture|Packet capture in Kubernetes with ephemeral debug containers]]: capture traffic in a pod network namespace or on a node without restarting the workload, read the pcap with tshark, and handle the file safely.
- [[game-day-chaos-gke|Game day and chaos experiments on GKE]]: plan, run and review a scoped failure experiment on GKE with a hypothesis, abort rule, Chaos Mesh pod fault and a zonal drill, staging first.

## Infrastructure as code

- [[terraform-state-recovery|Terraform state recovery]]: recover from stuck locks, corrupted or lost state, refactors with state mv/rm/import, drift and provider upgrade breakage, with a backup before every destructive step.
- [[chef-to-immutable-images-migration|Migrating from Chef convergence to immutable images and Terraform]]: a staged, per-service migration of a Chef-managed VM estate to baked Packer images or containers, deployed with Terraform instance templates and managed instance groups.

## Networking

- [[hybrid-connectivity-bgp-troubleshooting|HA VPN, Interconnect and Cloud Router BGP troubleshooting]]: find where a hybrid link between on-prem and GCP is broken, layer by layer, from IKE and IPsec through the BGP session to routes and firewalls.

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
