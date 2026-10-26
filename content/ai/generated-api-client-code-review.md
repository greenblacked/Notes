---
title: Reviewing generated API client code
description: Validate generated clients against their source contract and runtime behavior instead of treating generation as a correctness guarantee.
type: guide
tags:
  - ai
  - reliability
  - security
  - ci-cd
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Keep the contract authoritative

Generated API clients can originate from an OpenAPI description, an SDK generator, or a model's interpretation of an endpoint. Those sources have different reliability. A generator can reproduce its input contract consistently while the contract is outdated or incorrect; a model can invent fields, paths, authentication behavior, and retry semantics. Review the contract first, then the generated implementation.

Identify whether a file is generated and which source artifact, generator version, configuration, and command produced it. Do not hand-edit generated output when the change belongs in the schema or generator configuration. If an agent wrote client code directly, treat it as ordinary application code and verify every endpoint against the provider's authoritative contract.

This topic is distinct from [[dependency-hallucination-controls]]: a real client library can still have a flawed generated contract, while an invented package is a dependency identity problem. The accountability expectations in [[ai-generated-code-policy-and-provenance]] still apply. Use [[ai-assisted-test-generation-quality-gates]] to set expectations for contract tests.

## Review workflow

1. **Pin the input.** Record the API specification revision or source commit, generator and plugin versions, language target, and configuration. Verify these are the intended versions rather than a model-provided download or mutable branch.
2. **Validate the schema.** Check syntax and schema semantics, including required fields, nullability, enum evolution, formats, discriminators, authentication, error responses, pagination, and deprecation. Compare important endpoints with the server implementation or provider documentation.
3. **Generate reproducibly.** Run the repository's pinned generation command in a clean worktree. Compare output with the proposed diff. Unexpected churn can indicate generator drift, unstable ordering, or a different configuration; it should not be dismissed as formatting.
4. **Review security-sensitive behavior.** Inspect URL construction, redirect handling, TLS verification, credential attachment, logging of request/response bodies, input escaping, timeout, retry, and proxy behavior. Ensure bearer tokens cannot be sent to an untrusted host through an endpoint override.
5. **Test compatibility.** Run compilation, type checks, client unit tests, and contract or integration tests using non-sensitive fixtures. Cover success, authentication failure, rate limiting, malformed responses, pagination, and retryable versus non-retryable errors where relevant.
6. **Inspect public API changes.** Review renamed methods, changed default values, required constructor parameters, error types, and serialization behavior. A generated client can compile while breaking callers or changing wire semantics.
7. **Gate regeneration.** CI may check that generation produces no diff from the committed output. Keep generator upgrades as separately reviewable changes and require owner review for public API changes or security-sensitive templates.

For a model-created client, ask it to identify the exact contract fields supporting each method and type. Verify those references yourself. Structured output from a model can constrain the shape of a response, but it does not establish that the external API exists or behaves as described.

## Failure modes and controls

Typical errors include stale schema, incorrect `required` or nullable behavior, treating a missing field as `null`, conflating server and client defaults, retrying a non-idempotent operation, dropping unknown response fields, mishandling pagination tokens, and sending credentials to a caller-controlled base URL. Generator templates can also emit unsafe deserialization, overbroad exception handling, or logs containing secrets.

Do not accept generated code because it is large, looks idiomatic, or passes a smoke test against a mock that was generated from the same incorrect schema. Use independent server examples or consumer-driven tests for critical flows. If the service contract is not available, record the uncertainty and avoid shipping unsupported assumptions. Keep generated code out of the diff if the authoritative input and generator do not require it.

When output differs unexpectedly, compare the exact generator version/configuration and input checksum before regeneration. Do not overwrite a working client to clear a generation diff without understanding the cause. A manual patch to generated output should be exceptional, documented, and protected from disappearing on the next generation run.

## Decision checklist

- Is the source contract authoritative, versioned, and validated?
- Are generator, plugins, templates, and configuration pinned?
- Is output reproducible from a clean checkout?
- Have auth, URL, logging, retry, timeout, and deserialization behaviors been reviewed?
- Do tests cover both wire contract and important failure cases?
- Are public API changes and breaking changes explicitly assessed?
- Does CI detect stale output without automatically accepting it?

If the contract's provenance or behavior cannot be established, block release of the affected client behavior until the owner resolves it.

## Related

- [Owner’s AI skills catalogue](https://ai.szolotov.com).

## Sources

- [OpenAPI Specification v3.2.1](https://spec.openapis.org/oas/latest.html): API description vocabulary and schema semantics; confirm the specific version used by the project.
- [OpenAPI Generator: Usage](https://openapi-generator.tech/docs/usage/): generator command options and generation workflow.
- [OpenAI API: Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs): constrained response format capabilities, not verification of external API behavior.
