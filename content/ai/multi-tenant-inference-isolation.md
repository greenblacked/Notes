---
title: Multi-tenant inference isolation
description: Design tenant boundaries across identity, queues, cache, model processes, telemetry, and accelerator placement for shared inference platforms.
type: reference
tags:
  - ai
  - architecture
  - security
  - kubernetes
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Define what isolation means

“Multi-tenant” can mean separate customers, teams, workloads, or trust domains. Decide what must be isolated: authorization, prompt and response data, model state, cache reuse, resource consumption, audit visibility, and failure impact. A shared API key or namespace is not a tenant boundary by itself. A design should map each requirement to an enforcement point and a test.

Isolation exists on a spectrum. Request-level authorization and fair queues share one process and hardware. Separate model processes or pods add a process boundary. Dedicated nodes or accelerator partitions reduce resource contention and blast radius, at higher cost and operational complexity. Stronger separation may be required by data handling or threat models; do not claim physical isolation from a logical queue policy.

For agent access controls rather than inference serving tenancy, use the narrower controls in [[kubernetes-rbac-for-ai-agents|Kubernetes RBAC for AI agents]].

## Identity and data boundaries

Authenticate the calling workload and bind each request to an authorized tenant on the server side. Do not trust a client-supplied tenant label as authorization. Enforce model, operation, region, and data-policy entitlements before dispatch. Keep provider credentials out of clients and scope them to the gateway or workload that needs them.

Avoid retaining raw prompts, completions, or embeddings in shared logs. If payload retention is required for a justified purpose, define access controls, retention, redaction, and audit. Ensure errors do not echo another tenant's input. Keep traces and metric labels free of prompt text and high-cardinality customer identifiers.

Understand cache behavior in the actual serving engine. Prefix caching or reuse may cross request boundaries depending on implementation, keying, and isolation configuration. Do not infer tenant safety from separate API keys alone. Disable cross-tenant sharing or provide a tested tenant-aware cache boundary when the threat model requires it. Validate that cache eviction and preemption do not reveal contents through output or timing channels beyond accepted risk.

## Resource fairness and blast radius

Shared accelerators can provide high utilization, but one tenant can occupy memory, queue slots, or long-running streams. Enforce per-tenant concurrency, request size, token or work budgets, and bounded queue age. Reserve capacity for critical tenants only where the policy is explicit and monitored. Fairness algorithms can reduce noisy-neighbor effects but may reduce aggregate throughput or add scheduler complexity.

Kubernetes resource requests and limits, QoS classes, node affinity, topology, and separate pools can influence placement and contention. They do not automatically partition GPU memory or compute. Accelerator-specific partitioning and isolation guarantees are hardware- and configuration-dependent; confirm with the vendor and cluster integration documentation. A namespace boundary controls Kubernetes API access, not necessarily data or runtime state inside a shared inference server.

Choose the deployment boundary from the requirement. A pod per tenant improves process and configuration separation but increases model memory and startup overhead. A shared model process is cheaper and can batch across tenants, but requires robust identity, queue fairness, and state isolation. A dedicated node pool costs more and can lower utilization, but may be appropriate for regulated or high-risk workloads.

## Test the boundary

Test both positive and negative authorization: tenant A cannot select tenant B's model route, inspect its traces, or read its cache state. Run noisy-neighbor tests with long prompts and sustained streams. Verify queue caps, cancellation, fairness, rollout behavior, and per-tenant accounting. Test restart and failover paths to ensure tenant identity survives routing and does not degrade into a default account.

Review telemetry access controls separately from inference access. An operator with broad dashboards may see data the application cannot access. Use least privilege and avoid collecting content unless explicitly required. Test that logs, traces, and support exports follow the same tenant boundaries.

### Checklist

- Write down the tenant model, required isolation level, and accepted shared-resource risks.
- Derive tenant identity from trusted authentication and authorize routes server-side.
- Bound per-tenant work and queues; measure fairness and noisy-neighbor impact.
- Verify engine cache, process, and device sharing behavior for the deployed version.
- Test tenant separation across APIs, logs, traces, caches, queues, and failover.
- Escalate to separate processes or hardware boundaries when logical controls do not meet the threat model.

The main tradeoff is cost and utilization versus stronger isolation and reduced blast radius. Choose the least costly boundary that meets documented requirements, then prove it with tests rather than relying on a product label or namespace alone.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Pod Quality of Service Classes | Kubernetes](https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/): Kubernetes QoS classification; it does not promise GPU partitioning or tenant data isolation.
- [Pod Topology Spread Constraints | Kubernetes](https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/): placement distribution controls and their Kubernetes semantics.
- [OWASP Top 10 for Agentic Applications for 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): current agentic-system risk guidance relevant to trust boundaries; not a technical isolation guarantee.
