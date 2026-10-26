---
title: Tool-calling contracts and schemas
description: Design typed tool interfaces whose server-side validation, authorization and bounded results remain safe even when model arguments are wrong.
type: pattern
tags:
  - ai
  - security
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

A tool schema is a communication contract between the application and model, not a security perimeter. It helps a model produce arguments in an expected shape, while the tool server must independently validate them, enforce caller permissions and bound effects. This note focuses on contract design at the model-tool boundary; deployment and identity for internal MCP servers are covered in [[internal-mcp-servers-for-platform-tools]].

## Design task-shaped tools

Expose a named operation that answers a specific question or performs one narrow task. Prefer `deployment_status(service, environment)` over a generic `query_api(method, url, body)`, and `request_restart(deployment, reason)` over an arbitrary shell. A narrow interface reduces both accidental ambiguity and the authority a compromised or mistaken model can exercise.

For each tool, define:

- A stable name and plain-language description, including what the tool does not do.
- A typed input schema with required fields, explicit enums, length and numeric limits, and rejection of unknown keys where supported.
- A bounded output shape with documented truncation behavior and source timestamps.
- A timeout, maximum result count/size, and rate or concurrency limits.
- The authorization rule, caller identity, audit fields and side-effect classification.
- Error categories that reveal enough to recover without exposing secrets or internals.

Use identifiers instead of free-form paths or hostnames where possible. Resolve an identifier against a server-owned allowlist and the caller's authorization. If accepting a time range, validate ordering and maximum duration server-side. If accepting text, cap length and normalize only according to the relevant domain rules; do not assume schema regexes are a complete parser.

## Enforce at execution

Tool arguments are model-controlled values. Validate again at the execution boundary, even if a provider claims constrained tool arguments. Confirm the request's authenticated principal, tenant, resource scope and current permission. Construct upstream requests from fixed endpoints and safe parameterized APIs; never concatenate arguments into shell commands, SQL or URL paths without strict encoding and validation.

Keep read and write tools distinct. A read tool should not secretly mutate state as a convenience. A write tool should have its own authorization, idempotency strategy, audit event, human confirmation where impact warrants it, and bounded retry semantics. The model can propose an action, but the application should decide whether it is allowed. Related human-gate design is in [[human-approval-state-machine]].

The tool result is also untrusted context. Bound output size, redact sensitive fields, label timestamps and source, and represent truncation explicitly. Avoid returning a successful-looking empty object when the upstream call failed. Do not put credentials, private internal endpoints or stack traces into error text visible to the model.

## Schema evolution and testing

Version tools independently from prompts and models. An additive optional field may be compatible, but renaming a tool or changing a field's meaning can break model behavior and callers. Roll out changes with backward compatibility or a staged migration, and record the schema revision in telemetry. Do not leave obsolete high-authority tools registered “just in case.”

Test both the schema and the server implementation. Include missing and extra fields, wrong types, out-of-range values, unknown resource IDs, unauthorized callers, oversized responses, timeouts and upstream errors. Verify the tool refuses rather than silently broadening scope. Simulate duplicate calls to confirm a write is idempotent or safely rejected. For safety tests, assert the authorization and audit result, not just that the model selected a particular tool.

## Failure modes and review checklist

Danger signs include generic passthrough tools; schema-only enforcement; descriptions that promise side-effect constraints not enforced by code; implicit defaults to production; output that omits truncation; retries that repeat a non-idempotent operation; and tool results treated as trusted policy. A valid enum is not enough if a caller can choose another tenant's resource ID.

- [ ] Tool represents a single bounded operation and states its scope.
- [ ] Application validates arguments and identity at execution time.
- [ ] Resource access is checked against caller permissions, not model claims.
- [ ] Read and write capabilities are distinct.
- [ ] Outputs, errors, time, rate and retries are bounded.
- [ ] Side effects have idempotency and appropriate human authorization.
- [ ] Schema changes are versioned, reviewed and regression-tested.
- [ ] Audit records capture actor, tool, decision and outcome without secrets.

## Sources

- [OpenAI: Function calling](https://developers.openai.com/api/docs/guides/function-calling) — describes tool definitions using JSON Schema and application-side execution; provider support varies.
- [Anthropic: Tool use with Claude](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) — explains client tools and server tools and that client applications execute client-side calls.
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) — peer-reviewed agentic application risk framework; use as a starting point, not a substitute for authorization design.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
