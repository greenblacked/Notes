---
title: Human approval state machine
description: Make human approval an authenticated, expiring decision over an exact action and evidence revision, not a generic prompt confirmation.
type: pattern
tags:
  - ai
  - security
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

“Ask a human before acting” is incomplete until the system defines what the human sees, how identity is checked, what exact action the approval covers, how long it lasts, and what happens if the proposed action changes. A safe approval is a durable state transition over a specific action, not a conversational “yes.” This applies to agentic systems alongside the human gate for infrastructure plans in [[llm-assisted-terraform-plan-review]].

## Define the approval object

Construct an approval record from trusted application state. It should bind to a unique request ID, action type, canonical target, exact parameter digest or immutable plan revision, relevant evidence summary and links, risk classification, requester, approver identity, timestamp, expiry, and policy version. The model may draft a human-readable summary, but the application must generate the canonical target and action details that the approval actually authorizes.

Render the high-impact facts prominently: environment, target, expected effect, reversibility, evidence age, and anything the action does not cover. Avoid asking a reviewer to approve a vague plan such as “fix the issue.” If the plan changes after approval—even by a parameter that affects scope—invalidate the approval and require a new decision.

## State and transitions

A minimal lifecycle is `proposed → awaiting_approval → approved → executing → verified`, with terminal or side states `rejected`, `expired`, `cancelled` and `failed`. Only the authenticated approval service can transition from awaiting to approved. Enforce separation of duties if policy requires the requester and approver to differ. A chat message, model response or checkbox supplied by the agent is not a trusted approval event.

Approvals expire after a defined period and should be single-use unless there is a documented reason otherwise. Consume the approval atomically with the start of execution so two workers cannot use it concurrently. If execution fails after consumption, reconcile the external state before allowing another attempt; do not silently reuse the approval.

For emergency paths, define a distinct policy, eligible roles, required justification, alerting and retrospective review. An emergency process should be narrowly scoped and audited, not a hidden bypass in the agent workflow.

## Verify and communicate

After execution, verify the resulting state against the approved intent. Record whether the change succeeded, partially completed, failed or remains uncertain. A human approval means permission to attempt the specified operation; it does not prove that the operation succeeded or that the proposed outcome was safe.

Give the reviewer an opportunity to reject or request edits without losing context. Rejection should stop the pending action and prevent retries from re-asking until policy permits. Capture the reason if the reviewer chooses to provide one, but do not require sensitive narrative that is unrelated to the decision.

## Failure modes and review checklist

Weak patterns include approval of a mutable plan pointer; broad approval reusable for a later action; an approval token exposed to model context; a stale screen that hides a changed target; approving a request while another worker executes it; and confusing “approved” with “completed.” Another problem is a system that pressures reviewers with repeated prompts until they consent.

- [ ] The approval is authenticated, attributable and tied to an exact action revision.
- [ ] Reviewer sees target, scope, effect, evidence and expiry clearly.
- [ ] Approval cannot be reused or raced into multiple executions.
- [ ] Any material action change invalidates the approval.
- [ ] Expiry, rejection, cancellation and emergency handling are explicit.
- [ ] Execution and outcome are audited separately from the approval event.
- [ ] Model output cannot mint or alter approval state.
- [ ] Tests cover stale, duplicate, unauthorized and concurrent approval cases.

## Sources

- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) — agentic risk guidance for authority and human oversight.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) — governance, accountability and risk management; AI RMF 1.0 is being revised.
- [Google Cloud Workflows documentation](https://cloud.google.com/workflows/docs) — official orchestration reference for explicit workflow transitions; map semantics to the runtime you operate.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
