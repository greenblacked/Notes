---
title: AI gateway architecture and policy
description: Place a policy-enforcing gateway between applications and model endpoints while keeping routing, identity, data handling, and failure behavior explicit.
type: reference
tags:
  - ai
  - architecture
  - security
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## A gateway is a policy point, not a magic shield

An AI gateway centralizes the controls that should be consistent across applications: caller authentication, route authorization, model allowlists, request-size limits, data handling, quotas, audit metadata, and provider-specific adaptation. It can also expose a stable internal API while backend providers change. It cannot make an unsafe application safe by itself; prompt construction, tool permissions, output handling, and human approval remain application responsibilities.

Separate the control plane from the request path. The control plane manages policy, provider configuration, credentials, model inventory, and rollout. The data plane validates each request, authorizes the caller and model, applies relevant policy, routes to an approved endpoint, and streams the response. If policy cannot be loaded or an identity cannot be verified, define whether the request fails closed. Do not silently route to a permissive fallback.

For direct cloud endpoints, network privacy and service identity are separate concerns; see [[vertex-ai-private-access-from-gke|private Vertex AI access from GKE]] for that provider-specific path.

## Define the request contract

Normalize only what the gateway can preserve safely. Record a canonical internal request with an explicit model alias, tenant identity, deadline, response mode, and bounded metadata. Maintain a mapping from internal model aliases to approved provider IDs, regions, and versions. Keep provider-specific parameters explicit; do not pretend that identically named sampling or safety settings have identical behavior across vendors.

Validate input shape, content size, and supported modalities before sending. Handle streaming and non-streaming as first-class modes. If a policy requires inspecting content, account for the fact that whole-request inspection can add latency and may be incompatible with low-latency streaming. A gateway must not buffer or log full prompt and response bodies by default. Redact or omit sensitive values and define short, documented retention for any exception.

Authenticate the application workload separately from the end user when both identities matter. Use service identity for caller authorization and pass user context only when policy and provider semantics require it. Avoid sharing a single unrestricted provider key across all services. Keep credentials in a managed secret mechanism and restrict the gateway's outbound network to approved destinations.

## Policy and failure domains

Make policy versioned, reviewed, and testable. A policy should express which workload may call which model class, region, and operation; request and token ceilings; data-handling rules; and allowed fallback routes. Evaluate policy before dispatch and emit a structured decision record without copying sensitive payloads.

Use explicit circuit breakers or health state to stop routing to a failing backend, but avoid “fail open” behavior that bypasses content controls or identity checks. Distinguish retryable transport failures, provider overload, policy rejection, and a timeout after a request may have been accepted. Retries should be bounded and idempotency-aware. If the response has begun streaming, switching providers mid-stream generally changes semantics and may duplicate output; treat that as a separate design decision, not a transparent retry.

Keep the gateway highly available without making its control state a single point of failure. Decide how policy changes propagate and how data-plane instances behave if the control plane is unreachable. An explicit last-known-good policy may be appropriate, provided its age is bounded and auditable; unbounded stale policy is not a safe default.

## Test and operate the boundary

Test authorization across tenant and model combinations, including deny cases. Test malformed requests, invalid content type, oversized inputs, streaming disconnects, rate limiting, provider timeouts, and downstream 429/5xx behavior. Test that secrets and prompt content do not appear in logs, traces, metrics, or error responses. Apply independent output validation when downstream systems require a schema; provider structured-output modes are not necessarily equivalent and should be tested separately.

Monitor gateway availability, policy denials, dispatch latency, provider response classes, retries, queueing, stream duration, and cost attribution. Keep labels bounded and payload-free. Set alerts for missing policy updates, credential rotation failures, route drift, and unexpected model aliases. Provide a safe operational kill switch that blocks selected routes rather than bypassing policy.

### Design checklist

- Document data-plane, control-plane, identity, routing, and audit boundaries.
- Version policy and provider mappings; require review and tested rollout.
- Fail closed for authentication and mandatory controls; define bounded stale-policy behavior.
- Keep provider-specific semantics visible; test translation and loss of features.
- Bound retries and queues, preserve deadlines, and treat mid-stream failure distinctly.
- Test redaction, least privilege, tenant isolation, and incident disablement.

The primary tradeoff is central consistency versus a new critical dependency and latency hop. Keep the gateway small, observable, highly available, and limited to decisions that truly need central enforcement.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [OWASP Top 10 for Agentic Applications for 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): current OWASP agentic risk guidance; a gateway is only one layer in the control system.
- [Structured model outputs | OpenAI API](https://developers.openai.com/api/docs/guides/structured-outputs): OpenAI-specific structured-output controls; do not assume identical provider behavior.
- [AI Risk Management Framework | NIST](https://www.nist.gov/itl/ai-risk-management-framework): NIST AI RMF 1.0 (January 2023); the page states revision is underway, so it is cited as a dated framework, not an unrevised current standard.
