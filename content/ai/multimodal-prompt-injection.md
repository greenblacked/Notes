---
title: Multimodal prompt injection boundaries
description: Defend vision, audio, and document workflows when untrusted media can influence model behavior or downstream tools.
type: guide
tags:
  - ai
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Multimodal systems process images, scans, audio, video, subtitles, and OCR alongside typed prompts. Media may carry instructions, context, speaker cues, or metadata that a reviewer does not see. This note focuses on untrusted media boundaries, extends [[ai/indirect-prompt-injection-in-documents]], and does not claim that every model is vulnerable to every technique.

The owner’s [AI skills catalogue](https://ai.szolotov.com) provides reusable skills and workflows.

## Map the media pipeline

Record the complete path: upload, file validation, decoding, transformation, OCR or transcription, model request, external storage, retrieval, and downstream action. Identify which component sees the original bytes and which sees derived text. Preserve a link between each derived segment and its source asset, page, frame, or time range so reviewers can inspect context. If content is transformed, retain a hash of the received object and record the transformation version without assuming that a hash validates the content itself.

Treat camera input, user uploads, third-party attachments, and web media as untrusted regardless of who forwarded them. A trusted employee can unknowingly pass along an adversarial or malformed artifact. Content management labels, alt text, EXIF fields, subtitles, or a transcription service’s output should not be accepted as authority. They may be useful data but can be inaccurate or attacker-controlled. Do not infer authorization from a face, voice, logo, screenshot, or document appearance.

## Constrain what media can cause

Do not connect a media-understanding model directly to high-impact tools. Put a typed, policy-enforced action layer between model output and external effects. Validate that an action is allowed for the authenticated user and the target resource, require human confirmation where consequences warrant it, and make a clear preview available before sending or publishing. The confirmation should describe the actual target and effect, not merely ask “continue?” after the model has already chosen an opaque operation.

For extraction tasks, request narrow fields and reject unexpected output rather than passing free-form response text to another system. OpenAI’s Structured Outputs documentation describes a schema-constrained response feature for its API, but schema conformance is not truth, authorization, or safety; validate business meaning and permission separately. Provider capabilities and feature behavior may change, so confirm current documentation and your selected model’s support before relying on them.

## Validate and minimize media

Accept only necessary formats and enforce limits on file size, duration, dimensions, page count, decompression, and processing time. Validate content signatures as well as filenames, but do not treat MIME sniffing as a complete defense. Keep decoders and converters patched, isolate them from credentials and sensitive networks, and fail closed on parser errors. Strip metadata not needed for the task, while preserving original evidence securely when policy requires it. Avoid logging raw media by default; logs should record identifiers, sizes, hashes, processing outcomes, and access decisions.

Reduce media to the minimum needed for the requested task. Crop or redact unrelated areas, sample only necessary frames, and exclude background speech or unrelated documents where feasible. This helps privacy and reduces irrelevant influence, but do not claim preprocessing prevents instruction-like content from affecting the model. Human review should have access to the source segment and transformation record when model output can affect a person or a consequential decision.

## Evaluate boundaries, not attack cleverness

Test with safe synthetic fixtures containing benign instruction-like overlays, spoken text, captions, or embedded document content. Keep examples non-operational and designed to verify that a forbidden side effect remains blocked. Vary the pipeline stage: original upload, OCR output, transcript, resized image, video frame, retrieved media, and model summary. Check whether the system preserves provenance and whether the policy layer denies an out-of-scope action regardless of the generated rationale.

Include failures that are not adversarial: low-confidence OCR, overlapping speakers, missing frames, corrupted files, a transcription timeout, an unsupported codec, a provider outage, and conflicting extracted fields. A safe system should distinguish “not detected” from “not present.” It should abstain or ask for a human review when critical values are uncertain. NIST AI RMF’s Map and Measure functions are useful for tracking intended context, impacts, and evaluation evidence; the GenAI Profile adds AI-specific considerations. The frameworks provide risk-management guidance, not a certification of model behavior.

## Failure handling and evidence

A multimodal workflow can leak sensitive media through request logs, generated descriptions, tool arguments, cached thumbnails, or support tickets. It can also create an unsafe decision through transcription errors or a prompt-like instruction hidden in plain sight. Define retention and deletion behavior for originals, derived text, embeddings, and provider-side data separately. Confirm account-level service terms and configuration; do not infer retention from an API’s general marketing page.

When a suspected manipulation or unsafe action occurs, preserve the original asset under controlled access, its hash, derived outputs, model and preprocessing versions, relevant prompt template, tool decisions, and the human confirmation record. Record time offsets for audio/video evidence. Avoid copying media into broad incident channels; use a restricted case store and retain only what is necessary. [[ai/ai-agent-security-incident-evidence]] covers evidence minimization and custody, while [[ai/redacting-sensitive-data-before-llm-calls]] covers data minimization before requests.

## Review checklist

- Are accepted media types, processing limits, and component boundaries explicit?
- Does derived text retain a link to its original page, frame, or time range?
- Are identity and authority never inferred from visual or audio appearance?
- Are tool actions validated outside the model and confirmed proportionately?
- Are schema-valid outputs still checked for truth, authorization, and business rules?
- Are uncertain extraction, parser failures, and provider outages handled safely?
- Are raw media and derived artifacts excluded from routine logs?
- Can responders preserve minimal evidence without spreading sensitive media?

## Sources

- [NIST AI 600-1, Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): risks and governance across generative AI systems.
- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/): LLM application risk taxonomy and mitigations.
- [OpenAI: Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs): current API documentation for schema-constrained outputs; feature support varies and must be checked.
- [MITRE ATLAS](https://atlas.mitre.org/): catalog for organizing AI-system threats and defensive testing.
