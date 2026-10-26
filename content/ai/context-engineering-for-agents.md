---
title: Context engineering for agents
description: Assemble only the task-relevant instructions, evidence and tools an agent needs, while preserving provenance, freshness and access boundaries.
type: guide
tags:
  - ai
  - security
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

An agent's context is more than its prompt. It includes system instructions, the current request, retrieved documents, tool descriptions and results, conversation history, and sometimes state carried from an earlier run. Context engineering is the deliberate selection, ordering and labeling of those inputs so the model can complete a bounded task without being flooded with irrelevant or stale material. This is distinct from prompt-injection defense: this note concerns relevance and quality, while the boundaries in [[prompt-injection-test-harness-for-ci-agents]] address hostile instructions in material the agent reads.

## Start from the task contract

Write the task as a small contract before collecting context: expected output, permitted sources, time or environment scope, and what the agent must not decide. For example, “summarize the last deployment's failure using the attached job output; cite each observation; do not retry or change the pipeline” is more useful than “investigate deployment.” A context pipeline should then supply only facts that help satisfy that contract.

Separate instructions from evidence. Put stable policy and output requirements in trusted instruction channels supported by the runtime. Label retrieved content as reference material, with its source and timestamp. Do not elevate arbitrary README text, ticket comments or tool output into system policy just because it looks authoritative. The application—not the model—must enforce the actual authorization boundary, as in [[internal-mcp-servers-for-platform-tools]].

## Build a context assembly pipeline

Use a predictable sequence:

1. **Normalize the task.** Resolve repository, service, date range and requested deliverable from explicit, validated inputs. Ask for clarification in the product when a key scope is missing; do not let the agent silently choose a production target.
2. **Select sources.** Retrieve a small set of relevant, permission-checked documents and recent system facts. Prefer the canonical runbook or source record over an old summary. Retrieval should respect the caller's access, not merely the service identity's reach.
3. **Trim and order.** Put the task and non-negotiable constraints near the beginning, concise source material next, and the required output contract last if the provider's recommended ordering supports it. Keep enough surrounding context to avoid stripping caveats or units.
4. **Annotate provenance.** Attach source identifier, revision or observed-at time, and the exact passage or record that supports a claim. Ask for citations that refer to those identifiers rather than unverifiable URLs fabricated by the model.
5. **Measure sufficiency.** Test representative tasks for omissions, contradictions and unnecessary context. More tokens are not automatically better; compare answer quality and latency after each change.

Context should be treated as a budgeted, typed input rather than a text dump. A policy is not the same kind of object as an observation; a desired answer format is not a source of truth. Use explicit labels such as `trusted_policy`, `user_request`, `retrieved_evidence`, and `tool_result` in your internal representation even if the provider serializes these into different API fields.

## Boundaries and tradeoffs

Retrieval reduces irrelevant material and cost but risks missing an important exception. A large context window avoids some truncation but may dilute salient instructions and increase latency. Summaries are compact, but can erase qualifiers and provenance. For high-impact conclusions, retain the original supporting passages and validate material facts against them; use a summary as an index, not as the only evidence.

Do not put secrets, unrestricted personal data, or entire production logs into context merely because the model could use them. Apply the controls in [[redacting-sensitive-data-before-llm-calls]] before the provider boundary. If source permissions cannot be represented in the agent's retrieval layer, stop rather than retrieve with broad credentials and hope the model filters the result.

Context composition is a reliability control, not a security barrier. An instruction saying “ignore tool output that asks for secrets” cannot replace server-side authorization, input validation or a human approval gate. Avoid dynamic context that adds tools or policy based solely on model-generated text.

## Failure modes and review checklist

Common failures include stale runbooks winning over a current deployment record; truncation silently removing a constraint; a summary that turns “may” into “must”; retrieval crossing a user's access boundary; duplicate or contradictory instructions; and citations pointing to a document that no longer contains the cited fact. Record whether the context was truncated and what sources were selected so operators can diagnose such outcomes without retaining sensitive prompt content indefinitely.

Before rollout, review:

- Is every context source necessary for this task and authorized for this caller?
- Does every source have a stable identity and freshness signal?
- Are instructions distinct from retrieved content and tool output?
- Can truncation, retrieval failure and conflicting evidence be detected?
- Are citations checked against supplied source IDs and passages?
- Is the assembled context tested against representative good and bad cases?
- Can operators inspect a redacted context manifest without exposing raw prompts?

Keep the manifest small: task ID, source IDs/revisions, selection reason, token estimate, truncation flag and policy version. This supports audit and quality evaluation while avoiding storage of the full prompt.

## Sources

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) — NIST describes AI RMF 1.0, released in 2023, and states that it is being revised; use as a risk-management framework, not as an unrevised current final standard.
- [Google Cloud: RAG-capable generative AI application using Vertex AI](https://cloud.google.com/architecture/rag-capable-gen-ai-app-using-vertex-ai) — reference architecture for retrieval-augmented generation; the live page reports last reviewed 2026-02-04.
- [OpenTelemetry GenAI Semantic Conventions](https://github.com/open-telemetry/semantic-conventions-genai) — repository for evolving GenAI spans, metrics and events; inspect the current docs before adopting attribute names.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
