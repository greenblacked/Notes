---
title: Validating model-generated JSON
description: Parse and validate model JSON locally, handle refusal and truncation explicitly, and prevent malformed or untrusted data from reaching side effects.
type: guide
tags:
  - ai
  - security
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Model output that looks like JSON is still untrusted input. It may be truncated, valid JSON with the wrong shape, schema-conforming but semantically impossible, or a valid refusal response carried through a provider-specific envelope. A safe consumer distinguishes these states before using the data. This note concerns local validation after generation; response design belongs in [[structured-output-contracts]].

## Validation layers

Use a staged pipeline with explicit outcomes:

1. **Provider envelope:** check that the response completed normally. Detect refusal, tool handoff, timeout and token-limit termination using the provider's documented response fields. Do not assume that any HTTP success means the model completed.
2. **Extraction:** select the expected content block or structured response field. Reject multiple ambiguous candidate blocks; do not scrape arbitrary prose for the first `{...}` substring.
3. **Syntax:** decode with a standards-compliant JSON parser. Reject invalid syntax, duplicate keys if the parser allows them silently, non-finite numbers, and trailing content unless the contract explicitly permits it.
4. **Schema:** validate required keys, types, enum values, ranges, string lengths, array counts, nesting and unknown keys. Set resource limits in the parser to prevent oversized input or pathological nesting from consuming unbounded memory.
5. **Semantics:** check domain invariants that JSON Schema may not express adequately: timestamp ordering, known identifiers, mutually consistent fields, allowed units and whether evidence references resolve.
6. **Authorization:** re-check the caller and requested operation independently. Valid JSON saying `operation: "deploy"` does not authorize deployment.

Prefer a mature JSON Schema implementation in the application language over handwritten recursive validation. Pin its version and select a supported schema draft intentionally. Do not accept a schema copied from a user or model as the validator for that same response.

## Error handling and retry

Give each failure a typed result, such as `refused`, `incomplete`, `invalid_json`, `schema_invalid`, `semantic_rejected`, or `provider_error`. Log the category, schema revision, model revision, and a request correlation ID. Avoid logging the entire output by default; it may contain sensitive information. Return a short safe message to the caller and keep detailed diagnostics in a restricted channel.

Retry only when a failure is plausibly transient and a retry is within the task's budget. A network timeout may merit a bounded retry with backoff. A deterministic schema violation should generally fail closed or request a deliberate repair attempt with the original constraints; if repair is used, treat its result as a new untrusted response and run every validation layer again. Never automatically translate a failed response into a permissive default.

For streaming output, buffer only within a strict byte/token ceiling and parse only after a completed response. A partial prefix can parse after the model has emitted some fields, but it is not a committed result. If downstream work must start early, use an explicit protocol with independently validated, idempotent chunks and safe cancellation; do not improvise by parsing partial JSON.

## Do not confuse syntax with truth

A schema proves a response has a particular shape, not that facts are correct. Resolve record IDs from an authorized source; compare numeric values with domain limits; require evidence links for assertions that matter. Keep model-generated executable expressions, SQL, shell commands and URLs inert unless a separately reviewed component validates and authorizes them. The output contract in [[structured-output-contracts]] should make uncertainty expressible rather than forcing fabricated non-null values.

## Failure modes and review checklist

Watch for duplicate JSON keys interpreted differently across components, coercion of `"false"` into a truthy value, number precision loss, Unicode normalization differences, unbounded nested objects, stale IDs that still pass schema, and a repair path that bypasses the original validator. An upstream SDK's typed helper may improve developer ergonomics but does not replace domain checks or authorization.

- [ ] Provider completion, refusal and truncation are distinguished.
- [ ] Content is extracted from the expected response field only.
- [ ] Parser, schema and payload-size limits are explicit.
- [ ] Unknown fields, duplicate keys and numeric edge cases have defined behavior.
- [ ] Semantic and referential checks use authoritative data.
- [ ] All retry or repair outputs pass the full pipeline again.
- [ ] No effect occurs before validation and separate authorization.
- [ ] Logs capture outcome and revisions without unnecessary response text.
- [ ] Tests include malformed, oversized, valid-but-wrong and refused responses.

## Sources

- [OpenAI: Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs) — documents constrained output and explicit refusals; local checks remain necessary for application-specific meaning.
- [JSON Schema reference documentation](https://json-schema.org/understanding-json-schema/reference) — documentation for JSON Schema keywords; select a dialect supported by your validator.
- [Anthropic: Tool use with Claude](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) — explains structured tool calls and the division between model requests and application execution.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
