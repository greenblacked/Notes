---
title: Multi-agent handoff boundaries
description: Define what one agent may delegate, what context crosses a handoff, and how identity, authority and accountability persist.
type: pattern
tags:
  - ai
  - security
  - team-process
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Delegating a task from one agent to another can divide work, but it also creates another trust boundary. The receiving agent may have different instructions, tools, data access, model behavior and retention settings. A parent agent's confidence is not an authorization token. Define the handoff as a typed, auditable request and ensure that every agent independently enforces its permissions. This note focuses on delegation between agents; shared capabilities and tools are covered in [[agent-skills-and-shared-workflows]].

## Specify a handoff contract

A handoff should contain only what the child needs: task identifier, narrow objective, expected response schema, allowed source IDs, deadline, sensitivity classification, required citations and stop condition. Include provenance and whether input content is untrusted. Do not forward the entire conversation by default; it may contain unrelated personal or confidential information.

The child should return a bounded result with its own status: complete, partial, unable, refused, or needs clarification. Include source references and any assumptions. The parent must validate the response as untrusted input and should not present it as independently verified unless verification occurred. Use a unique correlation identifier across the delegation while keeping user identifiers out of metric dimensions.

Set an explicit contract for disagreements. The child should report conflicting sources rather than choosing silently; the parent can request a narrowly scoped follow-up or surface the conflict to a human. Do not create an implicit consensus by asking several models for an answer and treating the majority as truth. If independent review is useful, vary the evidence or method and define how a human resolves material disagreement.

## Identity and authority

Decide whether the child acts as itself, as the user, or under a constrained service identity. Prefer a design in which the child's tool server evaluates the original caller's authorization or a scoped delegation grant. Avoid giving a child the parent's broad credentials. A copied transcript does not establish identity, consent or permission.

Keep write permissions out of analytical subagents by default. If a workflow genuinely delegates an action, bind that authority to the exact action, target, policy version and expiry; require a human approval when the impact warrants it. The handoff must not transform “draft a recommendation” into “execute the recommendation.” State-machine controls in [[safe-agent-state-machines]] should own the transition.

## Failure, retries and accountability

Set explicit child deadlines, tool budgets and maximum delegation depth. Prevent recursive spawning or fan-out that can multiply cost and side effects. A parent timeout should not leave an unknown child running indefinitely; provide cancellation and status reconciliation. If cancellation cannot stop an in-flight external operation, report that uncertainty.

Record parent and child IDs, task revision, receiving agent/version, authorization decision, data classification, state and outcome. Avoid logging whole handoff payloads unless justified and protected. On a child failure, do not silently substitute a broader agent or expose additional data. Return a controlled partial outcome or ask for operator review.

For asynchronous work, persist the handoff state and send only a scoped reference to the child rather than relying on shared mutable conversation history. Validate that a reply belongs to the expected task and current revision before consuming it. Late responses to cancelled or superseded tasks should be discarded or retained only as a clearly marked audit event, never applied to the active workflow.

## Failure modes and review checklist

Common failures are passing credentials through context, losing the original user identity, accidentally widening source scope, treating child output as trusted because it is “internal,” and retrying a write after a network timeout. A second agent can reduce single-model workload, but it does not create independent truth if both receive the same flawed evidence or share the same model failure mode.

- [ ] Delegation has one bounded purpose and a typed input/output contract.
- [ ] Only necessary, authorized context is sent, with source provenance.
- [ ] Child identity and permissions are explicit and server-enforced.
- [ ] Delegated authority is narrower and shorter-lived than parent authority.
- [ ] Depth, fan-out, wall time and budgets are capped.
- [ ] Child results are validated and attributed before use.
- [ ] Cancellation and uncertain side effects have defined handling.
- [ ] Audit data records versions and decisions without unnecessary payloads.

## Sources

- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) — agentic security risks relevant to delegated authority and multi-agent systems.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) — lifecycle risk governance; NIST says AI RMF 1.0 is under revision.
- [OpenTelemetry GenAI Semantic Conventions](https://github.com/open-telemetry/semantic-conventions-genai) — evolving repository covering GenAI and MCP telemetry; verify current conventions before implementation.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
