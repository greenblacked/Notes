---
title: LLM tracing with sensitive-data controls
description: Trace model workflows end to end while limiting prompt, completion, and tool data exposure.
type: pattern
tags:
  - ai
  - observability
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Trace structure, not conversation content

Useful traces show the causal path from a user operation through retrieval, policy checks, model calls, tools, and final delivery. Most operational questions can be answered with event timing, status, bounded attributes, and correlation identifiers rather than raw prompts or completions. Begin with one trace per logical request and child spans for significant dependencies. Preserve parent-child relationships across asynchronous jobs with trace context, but do not place user identifiers or request bodies in trace IDs, span names, or metric labels.

For each model span, consider recording a provider name, model/deployment identifier, operation type, attempt number, finish status, duration, input/output token counts when available, and a stable prompt or policy revision. Use the current OpenTelemetry GenAI semantic-convention repository as a reference, and confirm its maturity and field names before adopting them; the older documentation page has moved. Provider response metadata can vary, so keep instrumentation tolerant of missing fields and version the collector mapping.

Treat prompts, completions, retrieved passages, tool arguments, and exception text as potentially sensitive. A structured attribute is still data at rest and can leak through trace export, vendor dashboards, sampling, support bundles, or broad internal access. Default to no content capture. If a product need justifies content-level debugging, require a narrowly scoped data-flow review, explicit retention, access, and redaction controls, and an approved environment. See [[redacting-sensitive-data-before-llm-calls]] for the separate boundary that filters information before it leaves the application.

## Apply data minimization in instrumentation

Create an allowlist of fields collected by each span. Prefer coarse classifications over content: input size bucket instead of text, tool name instead of arguments, retrieval count instead of documents, and error category instead of raw provider response. Use pseudonymous correlation IDs only when they are necessary to join records, and rotate or scope them to reduce linkability. Do not assume hashing makes personal data anonymous; stable hashes can still be correlated.

Run redaction before telemetry leaves the process, not solely in the backend. Redact secrets, credentials, direct identifiers, and sensitive values from exception messages and library-generated attributes. Redaction failures should remove or block the field, not silently pass it through. Keep separate schemas for production diagnostics and approved evaluation data; an observability pipeline should not become a shadow prompt archive. Limit access by role and environment, and log administrative access to sensitive traces where supported.

Sampling is a volume control, not a privacy control. A one-percent sample can still capture a highly sensitive request. Apply field minimization before sampling and export. Tail sampling can retain error traces, but error paths often contain the richest exception data, so scrub them first. Set a bounded retention period for trace data and review the provider's own storage and access model before enabling hosted telemetry.

## Validate end-to-end behavior

Test instrumentation with synthetic examples containing fake secrets and personal-data markers. Assert that neither raw text nor unredacted exception values appear in exported spans, logs, baggage, or resource attributes. Include nested tool calls, failed model calls, retries, streamed responses, and cancellation paths. Inspect the actual backend export, not merely the in-process span object; processors and exporters can add fields.

Make trace quality observable too. Track missing model identifiers, malformed spans, dropped spans, export failures, and unexpected attribute cardinality. A trace that drops its root span or omits attempt relationships is misleading during a partial failure. Preserve an explicit “content omitted” marker so responders do not mistake missing content for a collection bug. Correlate metrics and traces with a non-sensitive operation ID rather than copying request text into logs.

## Operational checklist

- Trace one logical workflow and its dependency spans, including retries.
- Define an attribute allowlist and capture no content by default.
- Minimize and redact locally before sampling or exporting.
- Validate the real exporter and backend using synthetic canary data.
- Restrict access and set retention for traces, exemplars, and support exports.
- Track instrumentation gaps and provider-specific metadata separately.
- Review data-flow changes when adding a new tool, exporter, or hosted backend.

If an incident indicates sensitive content reached telemetry, preserve enough metadata to investigate while following the organization's incident and privacy process. Do not independently alter retention or erase records during an investigation without the evidence owner and approved procedure. For privacy or jurisdictional obligations, engineering guidance is not legal advice; involve the organization's privacy and legal owners.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [GitHub: OpenTelemetry GenAI Semantic Conventions](https://github.com/open-telemetry/semantic-conventions-genai): current repository for evolving GenAI span attributes.
- [OpenTelemetry Trace API](https://opentelemetry.io/docs/specs/otel/trace/api/): trace, span, and context model.
- [Data controls in the OpenAI platform](https://platform.openai.com/docs/guides/your-data): provider-specific data handling controls; verify current account and endpoint terms.
