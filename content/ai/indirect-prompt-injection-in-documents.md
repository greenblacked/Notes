---
title: Indirect prompt injection in documents
description: Keep instructions embedded in files, records, and retrieved text from gaining authority over an AI application.
type: guide
tags:
  - ai
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Indirect prompt injection occurs when an application processes content an attacker or unrelated contributor can influence: a PDF, email, issue, source file, transcript, retrieved chunk, or ordinary record. It need not look like an “attack”; the key is lower-trust text entering a workflow where it may influence actions. This note addresses document ingestion, not the broader CI-agent controls in [[ai/prompt-injection-test-harness-for-ci-agents]].

The owner’s [AI skills catalogue](https://ai.szolotov.com) provides reusable skills and workflows.

## Define authority before ingestion

Separate policy from data in the application architecture. Policy is controlled by the service owner and defines permissions, allowed tools, data handling, and output rules. Documents are evidence or context, never a source of new authority. A document can recommend an action, but only the application’s authorization layer can decide whether the authenticated user may perform that action. This distinction remains important when a source is internal: internal content may be stale, misclassified, user-editable, or imported from an external party.

At ingestion, attach source, document ID, owner, access labels, time, version or checksum, and permitted principals. Enforce access before context assembly, not by asking the model to omit protected content. Retain security metadata on every chunk. Propagate deletion, permission changes, and expiry to indexes and caches under a documented service expectation.

## Keep retrieved content in a data lane

Represent retrieved passages as quoted or otherwise structurally distinct untrusted evidence. Make source boundaries explicit and provide the model only the minimum relevant material. Avoid concatenating retrieved prose into a privileged instruction string or allowing document metadata to populate a tool name, endpoint, or authorization parameter. Delimiters and labels can improve model behavior, but are not security boundaries by themselves; a robust design assumes a model may still follow an embedded instruction.

When a model proposes an action based on a document, convert the proposal into a typed request and validate it independently. Resolve the target object from trusted application state, check current user authority, apply business rules, and ask for explicit approval when the operation is consequential. Keep read-only retrieval separate from write-capable tools. Never grant a tool broad credentials because a document claims that its author is an administrator or that the action is urgent. For more on the action boundary, see [[ai/agent-tool-authorization-boundaries]].

## Reduce exposure and limit blast radius

Use allowlisted repositories and collections rather than indexing every accessible drive by default. Exclude secrets, personal data, credentials, and regulated content unless the use case has an approved purpose and appropriate controls. Apply least privilege both to the retrieval service identity and to users. Consider whether the model provider may retain or process the content under the selected service configuration; verify the applicable contract and settings for the specific account rather than assuming that product-wide defaults apply.

Limit the model’s context size and tool surface. Give each workflow a fixed set of read-only operations where possible, and make side effects require a separate policy decision. Rate-limit retrieval and model calls, cap document size and archive expansion, and reject malformed or unsupported file types safely. Treat parsers, OCR services, converters, and embedding services as dependencies that can fail or be attacked independently. Do not execute macros, scripts, or embedded active content during extraction.

## Test control behavior safely

Build benign fixtures with marked instruction-like text requesting a forbidden, harmless action. Verify enforcement, not model resistance. Cover uploads, search results, email threads, split chunks, tool results, permission changes, and deletion after indexing.

Measure more than answer quality. Assert that inaccessible documents are not retrieved, the system does not invoke disallowed tools, output is labeled as derived from sources, and all denied attempts produce useful audit records. Test fail-closed behavior when provenance metadata is missing, a policy service is unavailable, or a source permission cannot be resolved. A graceful response should say it cannot safely continue rather than silently widening access. OWASP and provider safety documentation emphasize layered defenses; no classifier or prompt instruction should be treated as a complete detector.

## Failure cases and response

Common failures include missing ACL metadata, stale vector-cache permissions, snippets revealing data, and a shared service account retrieving for an unauthorized caller. Another is routing generated text directly into an email or database mutation. Downstream consumers should know that model summaries are not trusted facts and retain their source references.

On a suspected incident, stop the affected automated action path, preserve the source file and its version, retrieval metadata, prompts, model identifier, tool requests and results, authorization decision, and timestamps. Restrict evidence access because these records may contain personal or confidential data. Do not purge the source or index before preserving the minimum evidence needed for investigation unless a separate legal or privacy requirement requires immediate action. See [[ai/ai-agent-security-incident-evidence]] for a collection and retention plan.

## Review checklist

- Does every retrieved item retain source, owner, version, and access metadata?
- Are permissions checked against the current caller before context assembly?
- Can a document influence data but never grant authority or alter tool policy?
- Are model-proposed actions validated and authorized outside the model?
- Are parser, index, cache, and provider data-handling boundaries documented?
- Are missing metadata and policy-service failures safely denied?
- Do tests cover stale ACLs, chunking, deletion, and downstream side effects?
- Can responders preserve provenance and decisions without over-retaining content?

## Sources

- [NIST AI 600-1, Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): lifecycle risk management and information integrity context.
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): agent trust boundaries and action risks.
- [Anthropic: Mitigate jailbreaks and prompt injections](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks): provider guidance distinguishes direct and indirect injection and recommends layered guardrails; product details can change.
- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/): LLM application risk taxonomy.
