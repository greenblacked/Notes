---
title: Delegated OAuth for agent tools
description: Design user-delegated access for AI tools with explicit consent, narrow scopes, audience checks, and short-lived tokens.
type: guide
tags:
  - ai
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Delegated OAuth lets a tool act with a user’s authority instead of a shared identity. It can reduce confused-deputy risk, but the model may still request an unintended action and tokens may be over-scoped. Treat OAuth as an identity boundary, not a way to outsource consent to a conversational model. See [[ai/agent-tool-authorization-boundaries]] for capability checks.

The general agent credential and runtime controls in [[ai/securing-ai-agents-in-ci-and-cloud]] still apply when a tool uses user delegation.

The owner’s [AI skills catalogue](https://ai.szolotov.com) provides reusable skills and workflows.

## Choose the delegation model deliberately

Decide whether the product needs to act as the user. If approved read-only data or a narrow application identity suffices, delegation may add needless complexity. When needed, explain the purpose, resources, and operations to the user. Avoid vague consent such as “connect your account” when later write access may exceed the initial task.

Use the provider’s supported OAuth flow for the client type and deployment, following the current platform guidance. RFC 9700 is the IETF Best Current Practice for OAuth 2.0 security and updates earlier threat guidance; check its current recommendations rather than relying on old tutorials. Do not invent a flow by placing a client secret in a desktop agent, model prompt, browser JavaScript, or repository. Public clients cannot keep embedded secrets confidential. Protect redirect handling and state/nonce values as appropriate to the selected protocol profile.

## Keep tokens out of the model

The model should select a business operation, not receive or construct access tokens. The application should obtain and store tokens in a dedicated credential component, then attach the needed token only when calling the authorized resource server. Do not expose refresh tokens, authorization codes, client secrets, cookies, or token introspection output to model context, logs, tool descriptions, or user-visible error messages. Prevent token values from appearing in traces, crash reports, shell history, or debugging output.

Request the minimum scopes and resource audience required for the task. Verify issuer, signature or introspection outcome, audience, expiry, and relevant scopes at the appropriate service boundary. A token that is valid for one API should not be accepted by a different tool or resource server. If the provider supports resource indicators, audience restriction, sender-constrained tokens, or incremental authorization, assess them against the actual threat model and deployed support; do not assume every provider or SDK implements every option.

## Bind user intent to a narrow action

Do not interpret a model’s conversational confidence as user consent. For high-impact operations, show the actual target and effect and obtain user confirmation through a trusted interface before invoking the tool. The approval must be tied to the exact operation and expire quickly. Keep authorization checks in the resource service: the token establishes a principal and delegated scope, while application policy still decides whether the specific operation is valid.

Where a token is used in a multi-step workflow, use the narrowest possible service and scope for each step. Avoid passing a broad token to arbitrary plugins or MCP servers. A gateway can mediate calls, but it must not become a token-forwarding proxy that accepts any URL or tool request. Restrict destinations and ensure tokens are sent only to the intended resource server. Tool descriptions and annotations are not authorization enforcement.

## Lifecycle, revocation, and failures

Document consent, token storage, renewal, expiry, revocation, account disconnect, and incident response. On disconnect, stop future use and remove stored credentials according to the provider’s revocation semantics and organizational retention requirements. Do not claim that revocation instantly invalidates every already-issued access token unless the resource provider guarantees it. Keep access-token lifetimes short where the provider allows it, but avoid repeated silent reauthorization that masks user intent.

Handle authorization server outage, refresh failure, invalid audience, missing scope, clock skew, and user revocation as explicit states. Fail closed rather than falling back to a more privileged service credential. Give users a safe explanation and a way to reconnect or complete the task manually. Record non-secret metadata such as principal identifier, grant/scope set, resource audience, decision, and outcome; never store token contents as an audit trail.

## Test and review

Test that tokens are absent from prompts and telemetry; wrong audiences, missing scopes, expired grants, and tenant violations deny access; and approval binds to the displayed action. Ensure tools cannot expand scopes or choose arbitrary destinations from model output.

Review the actual OAuth configuration in each environment, including redirect URIs, client type, allowed scopes, token storage, service audience, and provider settings. OAuth deployments vary and change; validate claims against the provider’s current documentation and your organization’s account configuration. [[ai/just-in-time-agent-credentials]] discusses ephemeral credentials that are not necessarily user-delegated.

## Review checklist

- Is user delegation necessary, and is its purpose understandable to the user?
- Are scopes, audience, destinations, and token lifetime as narrow as supported?
- Are secrets and tokens kept entirely outside model context and ordinary logs?
- Is every action re-authorized for the principal and resource at call time?
- Are consequential actions confirmed through a trusted, exact-action UI?
- Does revocation or refresh failure stop action without a privileged fallback?
- Have wrong-audience, missing-scope, expired-token, and tenant tests passed?
- Are provider-specific assumptions checked against the exact deployed service?

## Sources

- [IETF RFC 9700: Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html): OAuth threat model and security recommendations; published January 2025.
- [IETF RFC 8693: OAuth 2.0 Token Exchange](https://www.rfc-editor.org/rfc/rfc8693.html): token-exchange framework for delegation and impersonation scenarios; published January 2020.
- [Google Cloud service account impersonation](https://docs.cloud.google.com/iam/docs/service-account-impersonation): provider-specific example of principal-to-service-account impersonation; verify current permissions and token behavior in the target environment.
- [AWS temporary security credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html): provider-specific overview of temporary credentials and expiry.
