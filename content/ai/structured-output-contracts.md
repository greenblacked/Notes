---
title: Structured output contracts
description: Specify machine-consumable model responses as versioned contracts with explicit semantics, refusal handling and downstream validation.
type: pattern
tags:
  - ai
  - reliability
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

When an application needs a model response as data, “return valid JSON” is not a contract. A dependable contract defines fields, types, allowed values, meaning, missing-data behavior, provenance and failure handling. Provider constrained-output features can reduce syntax and shape errors, but they cannot establish that a value is true, current, authorized or safe to act on. This note sets out the application contract; parsing and semantic checks are covered in [[validating-model-generated-json]].

## Define behavior, not just shape

Start with the consumer's actual decision. If a service needs an incident category and evidence references, do not ask for a broad narrative plus many decorative fields. Specify required and optional fields, null semantics, units, cardinality, maximum string lengths and enumerations. Define how the model should represent “unknown,” “not present in sources,” “conflicting evidence,” and “not applicable.” Avoid encoding all these meanings as an empty string.

Keep the contract conservative. `additionalProperties: false` can reveal unexpected fields; enums prevent a free-text category from silently creating new behavior; numeric bounds catch impossible values. Yet schema strictness has tradeoffs: very elaborate schemas may be unsupported by a provider's constrained-generation subset, and strict requirements can encourage invented values when source evidence is missing. Make uncertainty a valid, explicit state.

For fields that influence a consequential workflow, include evidence references and make the application resolve them against the original source. A model-generated citation string is not proof. Do not accept a generated `approved: true` as authorization: approval is an authenticated state transition owned by a person or policy engine.

## Schema and revision discipline

Maintain the canonical schema in source control, with a human-readable explanation of each field and a machine-readable validator. Give it a version and compatibility rules. Additive optional fields may be backward-compatible only if consumers ignore unknown fields; removed fields, changed meanings, narrower enums or altered null semantics are breaking changes. The exact compatibility policy depends on the consumer fleet; test actual old and new consumers.

If the provider supports a structured response format, use its documented API and supported JSON Schema subset. OpenAI calls this feature Structured Outputs; Google documents structured outputs for Gemini. Do not infer identical feature behavior from similar names. Provider constraints, refusal representation, streaming behavior and supported schema keywords can change, so confirm in current documentation and pin SDK/API versions where practical.

Record the selected schema revision and model revision with validation outcomes. This enables comparison when an upgrade changes completion behavior, without retaining raw confidential outputs longer than needed. The signal model in [[llm-observability-tracing-and-slos]] can capture schema revision, parse outcome and refusal status as low-cardinality attributes.

## Response state model

Do not collapse every response into “success” or “parse error.” Distinguish at least: transport/provider error, model refusal, incomplete or interrupted generation, valid structured response, syntactically invalid output, schema-invalid output, and semantically rejected output. Each state has its own retry policy. Retrying a refusal as if it were a transient error may undermine policy; retrying deterministic validation failure without changing anything wastes time and can produce a different unsafe answer.

Preserve the distinction between an empty valid result and no valid result. A model that cannot find evidence should return the contract's explicit abstention form; the application should not convert this to a default category or empty object that downstream services interpret as approval.

## Failure modes and implementation checklist

Frequent failures include a valid schema whose field descriptions are ambiguous; output fields that have no downstream owner; trusting provider enforcement without local validation; exposing parser error details to users; treating refusal objects as malformed data; and schema changes deployed before all consumers can accept them. In streaming interfaces, partial JSON is not a completed contract—do not dispatch side effects until the full response has passed validation.

Review each contract against these questions:

- Does each field support a real consumer decision?
- Are unknown, conflicting, missing and refused states representable?
- Are ranges, sizes, enums and nested cardinalities bounded?
- Are references resolvable against authorized source material?
- Does the application validate every response locally?
- Are schema and model revisions recorded, and consumer compatibility tested?
- Are effects gated on a valid terminal response and separate authorization?
- Is telemetry limited to outcome codes and safe metadata?

## Sources

- [OpenAI: Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs) — provider documentation for JSON Schema-constrained responses; the page describes explicit refusals and parsing support. Check current API compatibility details before deployment.
- [Google AI: Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output) — Gemini API structured-output documentation; supported schema features are provider-specific.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) — risk and measurement framing; NIST states AI RMF 1.0 is being revised.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
