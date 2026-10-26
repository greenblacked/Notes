---
title: Authorization boundaries for agent tools
description: Enforce user-aware authorization at every agent tool call rather than treating model intent or tool metadata as permission.
type: standard
tags:
  - ai
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

An agent tool exposes a capability through a model-mediated interface: search, message, query, or change a resource. Model-selected tools and arguments do not prove user authorization. The trusted service must evaluate the authenticated principal, object, action, and current policy. This is narrower than broad agent identity management in [[ai/securing-ai-agents-in-ci-and-cloud]].

The owner’s [AI skills catalogue](https://ai.szolotov.com) provides reusable skills and workflows.

## Separate capability description from enforcement

A tool schema helps constrain the shape of a request; it does not grant or deny access. A description saying “read-only” is metadata, not a control. Enforce permission in the tool implementation and downstream service, and require the caller identity to be established through a trusted channel that the model cannot rewrite. Avoid placing bearer tokens, service credentials, internal endpoints, or raw authorization decisions in model context.

Prefer small tools with one clear purpose and one action class. A search tool should not quietly accept a mode that switches it into deletion. Separate read from write operations, and split high-impact operations further when their targets or approval requirements differ. Narrow schemas can reject extra fields, but authorization must still validate the meaning of allowed fields. Bind a request to the authenticated principal and an approved resource identifier; do not trust a model-supplied account ID or role claim.

## Apply the user and resource policy

For each call, check whether the caller may perform that action on that object now, including tenant, ownership, resource state, and policy. Preserve user delegation end to end; a shared service account creates a confused-deputy risk. If delegation cannot be checked, constrain the tool to explicitly safe data and actions.

Authorization checks should be close to the system that owns the data or side effect. A front-end permission check is useful for usability but cannot replace a server-side decision. Avoid broad “agent admin” roles, wildcard grants, and tools that accept arbitrary query languages or URLs when a fixed operation suffices. Use a deny-by-default decision for missing identity, stale policy, malformed target, or authorization-service timeout. Surface a safe error without leaking whether a protected resource exists.

## Make consequential actions explicit

Classify tool calls by impact: retrieval, reversible draft, externally visible communication, record mutation, financial action, security configuration, or destructive change. Require approval based on risk and context, not merely on whether a tool is named “write.” A human approval screen should show the exact object, scope, and effect, and should bind approval to the specific request so that later model changes cannot silently alter it. Use idempotency keys, concurrency checks, and transaction boundaries for operations that can be retried.

Approval is not a substitute for least privilege. A reviewer cannot approve what they cannot see, and a confirmation click should not grant an unlimited capability to the model. Prefer a short-lived, single-purpose authorization for one action, and revoke or expire it promptly. Log the principal, delegation source, policy result, tool version, request identifier, approval result, and downstream outcome. Redact secrets and unnecessary payloads from the event.

## Test the enforcement point

Test missing identity, another tenant’s object, altered identifiers, expired delegation, unknown tools, extra fields, duplicate retries, and policy-service failure. Expect deterministic denial, not a model apology. Verify downstream rejection and that approvals bind to the exact content and target shown.

Use the OWASP Agentic Applications Top 10 to organize risks such as excessive agency and identity abuse, and use MITRE ATLAS to classify relevant observed tactics. They are catalogs for review, not evidence that a control is effective. Exercise prompt-injection test harnesses with benign fixtures to ensure untrusted input cannot expand the tool set; see [[ai/prompt-injection-test-harness-for-ci-agents]]. Verify audit events can reconstruct who acted and why without retaining excessive sensitive content.

## Failure cases and recovery

Common defects include checking permission only when a conversation starts, authorizing a broad class of resources rather than the selected object, accepting a caller identity from model output, returning data before ACL filtering, or checking access in a UI but not the tool API. Another subtle issue is a retry after partial success: the tool reports timeout, the agent repeats an action, and two side effects occur. Design for idempotency and reconcile ambiguous outcomes before retrying.

When authorization is uncertain, do not fall back to an administrator identity or cached allow decision. Fail closed for write actions and offer a constrained manual path. Monitor denied calls, approval patterns, policy errors, and unexpected changes in tool usage, while avoiding a noisy alert for every normal denial. Incident handling should preserve the relevant policy and authorization decision with the tool event; details are in [[ai/ai-agent-security-incident-evidence]].

## Review checklist

- Does the server authenticate the principal independently from model arguments?
- Is authorization checked per action and per object at the owning service boundary?
- Are tools narrow, separated by effect, and deny-by-default on failures?
- Are human approvals bound to the exact target and operation?
- Are retries safe through idempotency and reconciliation?
- Do tests prove denial at the service boundary and in downstream systems?
- Can audit records reconstruct identity, policy, approval, and result safely?
- Is there a safe fallback for authorization outages or ambiguous completion?

## Sources

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework): AI RMF 1.0 governance and risk-management structure; NIST says it is under revision as of 2026-10-26.
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): agent identity, agency, and action risks.
- [MITRE ATLAS](https://atlas.mitre.org/): adversary tactics for AI-enabled systems.
- [IETF RFC 9700: Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html): OAuth security practices relevant to delegated tool access.
