---
title: "Untrusted content in retrieval pipelines"
description: "Treat retrieved documents as data rather than instructions, and constrain how their text influences model behavior and tools."
type: guide
tags:
  - ai
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Documents returned by search can contain inaccurate statements, obsolete procedures, malicious instructions or content that should not be disclosed. Retrieval relevance does not make a passage trustworthy, and labeling text “untrusted” does not by itself prevent a model from following it. This note focuses on defensive handling in ingestion and generation, complementing the prompt and data protections in [[redacting-sensitive-data-before-llm-calls]] and the RAG serving controls in [[rag-over-runbooks-for-on-call]].

## 01 Separate evidence from authority

Classify sources by owner, provenance, intended audience, authority and lifecycle. A document may be useful evidence but not an instruction source for the assistant. Keep trusted system and developer policy outside retrieved text; delimit passages as quoted, untrusted data in the prompt format supported by the model. Tell the model to extract facts or summarize content without obeying instructions embedded in that content. Treat user-uploaded files, third-party pages, tickets, emails and tool results as untrusted unless an explicit governance process says otherwise.

Prompt separation is only one layer. The application should enforce allowed tools, data access, response schemas, confirmation gates and outbound destinations independently of the retrieved text. Prefer read-only retrieval tools with typed parameters and server-side validation. A document should never be able to authorize an action, grant a privilege, alter tenant scope or override policy. If the application supports actions, require a separate policy decision and, for consequential changes, a human confirmation based on trusted UI context.

## 02 Ingestion and presentation controls

Preserve original provenance and mark source origin, trust classification and review status. Do not strip context that helps identify quoted content or warnings. Normalize and escape markup for safe rendering, but avoid transforms that silently change the meaning of source evidence. Keep parsing and OCR outputs clearly identified as derived text and track uncertain extraction. Scan uploaded material with appropriate content handling controls, but do not claim that a scanner proves the absence of manipulative instructions.

At generation time, provide only the evidence needed for the query, with stable IDs and source titles from trusted metadata. Avoid concatenating arbitrary document text into instruction templates or allowing source content to populate tool arguments directly. If extracting structured values, validate them against an application-owned schema and business constraints. A schema-valid response can still be unsafe or factually wrong. Keep the assistant's response grounded in citations, and make its limitations visible when the retrieved material conflicts or lacks authority.

## 03 Test defense in depth

Build a benign test suite of documents that attempt to change the assistant's role, redirect a task, request secrets, or induce unexpected tool use; use harmless placeholders and assert only that the application maintains its intended policy. The goal is to verify the control boundary, not to optimize instructions for bypassing protections. Cover direct user content and indirect retrieved content separately because the trust assumptions differ. Include all retrieval types, including attachments, extracted tables, summaries, graph descriptions, citations and cached results.

Assert deterministic invariants outside the model: the user cannot invoke a tool beyond their server-side authorization; the model cannot select an arbitrary tenant; sensitive fields are not returned; citations come only from retrieved IDs; unsafe output is not rendered as active markup; and consequential operations wait for approval. Evaluate model refusal and grounding behavior as an additional layer, not the only control. Re-run tests after changing models, prompts, parsers, chunkers, connector scopes or tool schemas. Use [[prompt-injection-test-harness-for-ci-agents]] for related testing concepts, while adapting tests to retrieval rather than CI-agent execution.

## 04 Failure modes and response

Common failures include assuming a trusted source cannot change, relying on a prompt warning alone, allowing retrieved text to be concatenated with privileged instructions, treating a citation as proof of safety, or having an agent tool accept model-supplied arbitrary URLs or IDs. Summarization can also preserve an embedded instruction while dropping the fact that it came from untrusted content. Keep provenance and trust labels attached through reranking, summarization and caching.

If suspicious behavior occurs, stop or disable the affected action path, preserve limited sanitized evidence, and investigate source and pipeline versions without replaying sensitive text into broad logs. Check whether any tool was actually called, what data was returned, and whether cached or derived summaries were affected. Follow the established security incident process, such as [[ai-assisted-incident-response]], and prioritize containment and access review over repeated prompt experiments.

## 05 Review checklist

- Are source authority, ownership and trust class explicit and retained through transformations?
- Is retrieved material treated as data, never as policy or authorization?
- Are tools narrow, typed, server-authorized and independently bounded from model output?
- Are tenant, ACL, output and human-approval checks enforced outside the model?
- Are rendering, citations, summaries and caches safe for untrusted source content?
- Do defensive tests cover retrieved and user-provided material without real secrets or harmful payloads?
- Are model, prompt, parser, source and tool changes included in regression runs?
- Is there a response path for suspected manipulation that preserves evidence safely?

For broader AI practice resources, see [the owner's AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Mitigate jailbreaks and prompt injections](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks): Anthropic's canonical guide (title and URL live-fetched); discusses direct and indirect prompt injection and defenses. Provider-specific behavior can change.
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): OWASP 2026 framework page, canonical URL confirmed by live fetch; use as risk guidance rather than a guarantee or exhaustive control catalog.
- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs): OpenAI API guide, canonical page confirmed by live fetch; structured conformance constrains format, not trust or correctness.
