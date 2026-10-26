---
title: Network egress controls for AI agents
description: Restrict and observe agent network access so prompt-driven activity cannot freely reach internal services or external destinations.
type: guide
tags:
  - ai
  - security
  - networking
created: 2026-10-26
modified: 2026-10-26
draft: false
---

An agent that can use a shell, browser, package manager, HTTP client, or tool server can potentially send data or reach services over the network. A prompt-level rule to “use only approved sites” cannot enforce that boundary. Egress control must be applied by the network path, workload platform, or managed proxy, with identity and policy outside the model. This note addresses outbound connectivity specifically; base runtime isolation is covered in [[ai/sandboxing-coding-agents-on-workstations-and-runners]].

The owner’s [AI skills catalogue](https://ai.szolotov.com) provides reusable skills and workflows.

## Model the allowed destinations

List every required destination by purpose: model endpoint, identity provider, source-control host, artifact registry, package mirror, documentation site, telemetry collector, and internal API. Identify protocol, port, DNS name, expected caller, and whether the connection carries sensitive data or credentials. Avoid “internet access required” as a policy. If a workflow needs arbitrary user-provided URLs, treat it as a separate high-risk capability with explicit review and controls.

A destination list should be owned, versioned, and reviewed when a provider or dependency changes. Prefer stable service identities and approved egress gateways over broad IP ranges. IP allowlists can become stale or include shared hosting infrastructure; DNS names alone can also be abused through rebinding, alternate resolvers, proxies, or redirects. Define how the enforcement point resolves names, validates TLS, handles redirects, and observes encrypted connections. Do not rely on a model-maintained allowlist.

## Enforce at multiple layers

Place the agent in a network segment that has no implicit route to production control planes, metadata services, developer laptops, or internal admin interfaces. Apply workload-level egress policy and a central outbound proxy or firewall where feasible. Permit only required destinations, and make direct egress fail closed if the proxy is unavailable. Block access to cloud metadata endpoints unless the workload specifically needs them and uses a supported identity mechanism. Where required endpoints share infrastructure, use a provider-supported private connectivity or service perimeter, but verify the exact behavior and limitations for your environment.

Control DNS as part of the egress policy. Restrict resolvers, log queries at an appropriate privacy level, and test attempts to bypass the approved resolver. Prevent arbitrary tunneling through DNS, HTTP CONNECT, WebSockets, or alternate protocols unless explicitly required. Ensure credentials are only attached to approved hostnames and cannot be forwarded to a redirect destination. Egress policy does not replace authorization at the destination service: internal API calls still need caller authentication and object-level permission checks.

## Make policy observable

Log the workload identity, policy decision, destination name and resolved address where safe, protocol, timestamp, bytes, and connection result. Avoid capturing request bodies or full URLs with sensitive query parameters unless the incident or diagnostic requirement justifies it. Use secure, access-controlled telemetry and set retention. Alert on denied access to sensitive internal ranges, unexpected destinations, repeated denied attempts, unusual volume, and attempts from a workload that should not use a particular protocol.

Set explicit limits on connection counts, upload volume, timeouts, and concurrent requests. Egress controls can restrict where traffic goes but cannot prevent all leakage to an allowed provider endpoint; data classification, prompt redaction, provider configuration, and request minimization are separate controls. This is why [[ai/redacting-sensitive-data-before-llm-calls]] remains relevant even with strict network rules.

## Test real routing and failure modes

Test from the actual agent network namespace or job, not from an administrator workstation. Verify approved destinations work and unapproved destinations fail at the enforcement point. Include direct IP, unapproved DNS, redirect, proxy-bypass, IPv6, alternate port, metadata, and internal service cases as relevant to the platform. Use harmless test endpoints and synthetic data; do not probe third-party services. Confirm denial logs identify the workload and rule without exposing secrets.

Exercise policy updates, proxy outage, DNS outage, provider failover, and certificate renewal. A common failure is a “temporary” exception that remains broad and permanent. Another is that the agent container uses host networking or a privileged sidecar and bypasses the expected controls. Test the actual deployment configuration and ensure policy changes are reviewed. NIST SP 800-207 emphasizes resource- and session-centered policy rather than implicit trust based on network location; apply that principle to both egress and destination authorization.

## Incident handling and recovery

When unexpected traffic occurs, stop or isolate the specific workload, preserve egress decision logs, task identifiers, destination metadata, and related tool activity. Avoid immediately changing all network policy without understanding operational dependencies; broad edits can interrupt unrelated services and destroy useful evidence. If data may have been transmitted, identify the destination, timeframe, data class, and credentials exposed, then follow the organization’s incident process. Revoke or rotate affected credentials through the owner’s procedures and verify that subsequent traffic is blocked.

## Review checklist

- Are required destinations documented by workflow and data purpose?
- Is outbound traffic denied by default at the actual workload boundary?
- Are metadata, internal admin, and control-plane endpoints unreachable unless required?
- Are DNS, redirects, alternate protocols, and proxy bypass considered?
- Are credentials restricted to approved destinations and never forwarded broadly?
- Do logs capture policy decisions without routine payload collection?
- Do tests run inside the deployed network context and cover outages and bypass paths?
- Is emergency containment specific, evidence-preserving, and reversible?

## Sources

- [NIST SP 800-207, Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final): resource-focused access architecture and policy enforcement concepts.
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): security risks for agents with tools and external connectivity.
- [Docker seccomp security profiles](https://docs.docker.com/engine/security/seccomp/): syscall restrictions as one host-level defense; seccomp is not a network egress control.
- [NIST AI 600-1, Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): risk management for generative AI systems.
