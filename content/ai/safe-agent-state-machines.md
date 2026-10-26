---
title: Safe agent state machines
description: Model an agent workflow as explicit states and guarded transitions so retries, failures and approvals cannot skip safety checks.
type: pattern
tags:
  - ai
  - security
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

An agent workflow that moves from plan to tool calls to result can appear simple until a request times out, a worker restarts, a user cancels, or a retry replays an action. Implicit state hidden in chat history makes it difficult to know whether the agent is waiting for approval, already performed an action, or merely proposed it. Model the workflow explicitly as a finite state machine and keep transitions in application code, not in model-generated prose.

## Define states and transitions

A useful generic lifecycle is `received → validated → planning → awaiting_approval → executing → verifying → completed`, with side exits to `rejected`, `cancelled`, `failed` and `expired`. Not every task needs every state; a read-only summarizer may go directly from `validated` to `executing`. States should describe durable business facts, not model moods.

For each transition, define: who or what may request it; preconditions; persisted data; the side effect, if any; an idempotency key; timeout or expiry; and the next state on success or failure. For example, `awaiting_approval → executing` requires an authenticated approver to accept the exact action summary and target. An approval for one plan revision must not authorize a later plan that changed.

Persist authoritative workflow state in a transactional store with a monotonic revision. Treat model messages as proposals. The model may suggest `ready_to_execute`, but the trusted controller verifies all preconditions and changes state. On recovery, reload state and validate revision rather than inferring state from the last transcript sentence.

## Keep state and conversational context separate

Conversation history supports the model's reasoning; it is not a reliable database. Store task ID, status, owner, source references, permitted action set, approval record and completion result in structured application state. Give the model only the minimum state projection needed for the next decision. This also makes cancellation, audit and retention more dependable.

Never store credentials or raw approval tokens in the transcript. Record an approval as a server-side event tied to the user identity, exact action digest, target, timestamp and expiry. Human approval requirements are described in [[human-approval-state-machine]].

## Recovery, retries and cancellation

Use idempotency keys for external writes and record the operation result before acknowledging a transition. If an upstream timeout leaves the outcome uncertain, enter a state such as `reconciliation_required`; do not blindly replay a non-idempotent action. A retry should be a controlled transition with a maximum count and a reason, not an endless model loop.

Cancellation should be explicit and durable. It can prevent future effects, but it cannot undo an operation already committed upstream. Where cancellation arrives during execution, stop scheduling new work, determine whether an in-flight operation completed, and surface that distinction. Define which terminal states can be reopened and by whom. Avoid an ambiguous “resume” action that silently reuses an old approval or stale plan.

## Failure modes and review checklist

State-machine defects include an approval race against a changed action, duplicate execution after worker restart, a timeout incorrectly labeled failed when the action actually succeeded, invalid jumps between states, a canceled task still scheduling work, and model history treated as authoritative state. Another subtle failure is making `completed` mean “model returned text” instead of “all required validation and verification passed.”

- [ ] States represent durable facts and terminal conditions are explicit.
- [ ] Every transition has a single authority and tested preconditions.
- [ ] Approval binds to exact revision, target, actor and expiry.
- [ ] Side effects use idempotency or reconciliation before retry.
- [ ] State changes and audit events are persisted consistently.
- [ ] Resume and cancellation behavior are documented and tested.
- [ ] Model output can propose but cannot directly mutate workflow state.
- [ ] Logs and telemetry identify state and transition without exposing prompt data.

Test crash recovery at every transition boundary, including after an upstream side effect but before local acknowledgement. Test stale approval, duplicate delivery, expiry, cancellation and retry exhaustion. State transitions should be reviewed like API behavior because they define what the agent can cause over time.

## Sources

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) — supports lifecycle governance and monitoring; NIST says AI RMF 1.0 is being revised.
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) — current agentic risk taxonomy, including risks around autonomy and delegated authority.
- [Google Cloud Workflows documentation](https://cloud.google.com/workflows/docs) — official workflow orchestration documentation for durable, explicit execution patterns; implementation semantics depend on the selected runtime.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
