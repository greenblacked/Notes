---
title: Authorization boundaries for agent tools
description: Enforce user-aware authorization at every agent tool call rather than treating model intent or tool metadata as permission.
type: standard
tags:
  - ai
  - security
created: 2026-10-26
modified: 2026-11-01
draft: false
evidence: source-reviewed
reviewed: 2026-11-01
review-due: 2027-05-01
---

An agent tool exposes a capability through a model-mediated interface: search, message, query, or change a resource. Model-selected tools and arguments do not prove user authorization. The trusted service must evaluate the authenticated principal, object, action, and current policy. This is narrower than broad agent identity management in [[ai/securing-ai-agents-in-ci-and-cloud]].

The owner’s [AI skills catalogue](https://ai.szolotov.com) provides reusable skills and workflows.

## Separate capability description from enforcement

A tool schema helps constrain the shape of a request; it does not grant or deny access. A description saying “read-only” is metadata, not a control; the Model Context Protocol specification likewise requires clients to treat tool annotations as untrusted unless they come from trusted servers. Enforce permission in the tool implementation and downstream service, and require the caller identity to be established through a trusted channel that the model cannot rewrite. Avoid placing bearer tokens, service credentials, internal endpoints, or raw authorization decisions in model context. A tool server that fronts another API should accept only tokens issued for itself (audience check) and should not forward the caller’s token unchanged to downstream services, which is the token passthrough pattern the Model Context Protocol authorization specification warns leads to confused-deputy problems.

Prefer small tools with one clear purpose and one action class. A search tool should not quietly accept a mode that switches it into deletion. Separate read from write operations, and split high-impact operations further when their targets or approval requirements differ. Narrow schemas can reject extra fields, but authorization must still validate the meaning of allowed fields. Bind a request to the authenticated principal and an approved resource identifier; do not trust a model-supplied account ID or role claim.

## Apply the user and resource policy

For each call, check whether the caller may perform that action on that object now, including tenant, ownership, resource state, and policy. Preserve user delegation end to end; a shared service account creates a confused-deputy risk, and the OWASP LLM Top 10 lists acting for one user through a generic high-privileged identity as an example of excessive permissions. If delegation cannot be checked, constrain the tool to explicitly safe data and actions.

Authorization checks should be close to the system that owns the data or side effect. A front-end permission check is useful for usability but cannot replace a server-side decision. Avoid broad “agent admin” roles, wildcard grants, and tools that accept arbitrary query languages or URLs when a fixed operation suffices. Use a deny-by-default decision for missing identity, stale policy, malformed target, or authorization-service timeout. Surface a safe error without leaking whether a protected resource exists.

## Make consequential actions explicit

Classify tool calls by impact: retrieval, reversible draft, externally visible communication, record mutation, financial action, security configuration, or destructive change. Require approval based on risk and context, not merely on whether a tool is named “write.” A human approval screen should show the exact object, scope, and effect, and should bind approval to the specific request so that later model changes cannot silently alter it. Use idempotency keys, concurrency checks, and transaction boundaries for operations that can be retried.

Approval is not a substitute for least privilege. A reviewer cannot approve what they cannot see, and a confirmation click should not grant an unlimited capability to the model. Prefer a short-lived, single-purpose authorization for one action, and revoke or expire it promptly. Log the principal, delegation source, policy result, tool version, request identifier, approval result, and downstream outcome. Redact secrets and unnecessary payloads from the event.

## Test the enforcement point

Test missing identity, another tenant’s object, altered identifiers, expired delegation, unknown tools, extra fields, duplicate retries, and policy-service failure. Expect deterministic denial, not a model apology. Verify downstream rejection and that approvals bind to the exact content and target shown.

Use the OWASP Top 10 for LLM Applications 2025 (LLM06 Excessive Agency: excessive functionality, excessive permissions, and excessive autonomy) to organize risks, and use MITRE ATLAS, which organizes techniques under tactics, to classify relevant observed behaviour. They are catalogs for review, not evidence that a control is effective. Exercise prompt-injection test harnesses with benign fixtures to ensure untrusted input cannot expand the tool set; see [[ai/prompt-injection-test-harness-for-ci-agents]]. Verify audit events can reconstruct who acted and why without retaining excessive sensitive content.

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

## Evidence

Source-reviewed on 2026-11-01. Nothing was run. Scope: the OWASP, Model Context Protocol, and MITRE ATLAS statements in this note were compared with local copies of those sources.

### Sources checked

- [OWASP Top 10 for LLM Applications 2025: LLM06 Excessive Agency](https://genai.owasp.org/llm-top-10/): root causes (excessive functionality, permissions, autonomy); advice to minimize extensions and permissions, avoid open-ended extensions, run extensions in the user's context, require user approval for high-impact actions, and enforce authorization in downstream systems (complete mediation); a generic high-privileged identity acting for one user as an example of excessive permissions; logging and rate limiting as damage limiters. Checked 2026-11-01 against OWASP LLM Top 10 repository commit 99f4395.
- [Model Context Protocol specification, tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools): clients must consider tool annotations untrusted unless they come from trusted servers; a human should be able to deny tool invocations. Checked 2026-11-01 against modelcontextprotocol commit d0e246e.
- [Model Context Protocol specification, authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization): servers must accept only tokens issued for them as audience; token passthrough is forbidden and tied to confused-deputy risk. Checked 2026-11-01 against modelcontextprotocol commit d0e246e.
- [MITRE ATLAS](https://atlas.mitre.org/): the data repository README describes tactics and techniques, with techniques appearing under tactics. Checked 2026-11-01 against atlas-data commit f56c146 (README only; the data folder was not present locally).

### Not verified

- The OWASP Top 10 for Agentic Applications 2026, NIST AI Risk Management Framework, and IETF RFC 9700 were removed from Sources because they were not available locally; the note makes no claim that depends on them.
- The individual ATLAS tactic and technique entries were not read.
- The OWASP source supports generic rather than exact wording for approval binding, short-lived single-purpose grants, idempotency, and deny-by-default on authorization-service failure; these, the testing list, and the audit-log field list are engineering guidance, not documented claims.
- Nothing was run.

## Sources

- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/): excessive agency risks and mitigations.
- [Model Context Protocol specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization): tool annotation trust, token audience, and token passthrough.
- [MITRE ATLAS](https://atlas.mitre.org/): adversary tactics and techniques for AI-enabled systems.
