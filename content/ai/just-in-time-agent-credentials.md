---
title: Just-in-time credentials for AI agents
description: Issue temporary, task-scoped credentials to agents and prevent renewal or privilege expansion from becoming a standing capability.
type: guide
tags:
  - ai
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Just-in-time (JIT) credentials replace standing secrets with credentials issued for a defined task, principal, resource, and time window. They reduce the period in which a leaked token can be reused, but expiry alone does not make a credential least-privileged. An agent that can repeatedly mint broad credentials still has durable authority. This note focuses on credential lifecycle and issuance rather than general runner isolation, which is covered in [[ai/sandboxing-coding-agents-on-workstations-and-runners]].

The owner’s [AI skills catalogue](https://ai.szolotov.com) provides reusable skills and workflows.

## Define issuance policy

Before issuing a credential, bind the request to an authenticated human or workload identity, the approved task, the target resource, the allowed operation set, and an expiration. The agent should not choose its own role, lifetime, audience, or policy. These values belong to a trusted broker or identity service with a policy configured by the resource owner. The request path should not accept a role name or privilege level directly from model-generated text.

Prefer credentials created dynamically by a cloud or identity provider over static keys stored in environment variables, repositories, home directories, or prompts. Google Cloud documents service-account impersonation as an authenticated principal acquiring a service account’s permissions; AWS documents STS temporary credentials with expiration. These are provider-specific mechanisms, not interchangeable recipes. Confirm supported lifetimes, permissions, audit events, and revocation behavior for the exact provider and account configuration. Never claim that the word “temporary” means the grant is appropriately scoped.

## Make the grant small and hard to renew

Issue the narrowest resource audience and permission set that supports one task. Separate read-only investigation from write or deployment steps. For a task requiring a sensitive mutation, consider an approval-gated second credential rather than issuing write permission at startup. Bind credentials to a unique job or session identity when the platform supports it. Avoid broad roles that happen to expire quickly; a short-lived administrator token can still cause severe harm during its lifetime.

The component that can mint a token is itself privileged. Restrict access to the issuer, limit the set of roles and resources it can grant, and monitor every issuance and renewal. The agent should not be able to silently extend its own lease. Require fresh policy evaluation for a new grant, and require an external approval for privilege elevation. Use rate limits and maximum cumulative duration so repeated requests cannot recreate a standing credential through a sequence of short leases.

## Keep credentials out of model and observability paths

Keep tokens in a dedicated credential broker or runtime integration. The model should receive the result of an authorized operation, not the credential used to perform it. Redact secret values in logs, exception traces, shell output, crash reports, and telemetry. Avoid copying a token into a tool argument if the tool can obtain it through a protected workload identity. If a tool must receive a credential, use an authenticated channel, narrow recipient, and strict memory lifetime.

Record metadata useful for audit: issuer, principal, resource audience, scope or role, issuance and expiration time, requesting workload, approval reference, and use outcome. Do not record raw token strings. Correlate the grant event with the agent’s task and downstream API events so investigation can identify where the credential was used. Treat audit logs as sensitive because they reveal identities and access patterns.

## Expiry is not revocation

Plan explicitly for compromise before expiry. Identify how to revoke or disable a grant, block the workload, prevent re-issuance, and contain downstream sessions. Token revocation may be provider-specific, and some resource servers accept a token until it expires. Confirm the real behavior rather than assuming immediate invalidation. Use short expiration as one layer, not the response plan.

Handle issuer outage, policy unavailability, clock problems, failed refresh, user cancellation, and task completion as explicit states. Fail closed on write access when the broker cannot evaluate policy. Stop renewal after the task exits. Ensure a background process cannot keep credentials alive after the user-facing session ends. Keep a bounded grace period only where the platform requires it and document its reason.

## Verify behavior in a controlled environment

Test that the agent cannot mint a broader role, extend expiry without a new policy decision, use a token for a different audience, or obtain credentials after task cancellation. Confirm access is denied after expiry and determine whether provider-side revocation takes effect immediately or only after a cache/TTL window. Verify that token values do not appear in prompts, agent traces, command output, or ordinary application logs. Use synthetic identities and non-production resources for these checks.

Review the configured trust chain from workload identity to broker to cloud role to resource. A short-lived token acquired through a long-lived key merely relocates the standing secret. Ensure no fallback path silently reintroduces a static credential. The broader OAuth delegation model is described in [[ai/delegated-oauth-for-agent-tools]]; human authorization should remain separate from workload identity.

## Review checklist

- Is every credential tied to a known principal, task, audience, scope, and expiry?
- Can the model select or enlarge the role, resource, audience, or lifetime?
- Is the issuer itself narrowly authorized and protected against repeated minting?
- Do new grants require policy re-evaluation and elevation approval where needed?
- Are credentials absent from model context, traces, command output, and logs?
- Has actual provider expiry and revocation behavior been verified?
- Does cancellation stop renewal and prevent post-task reuse?
- Is there a documented containment path for issuer or workload compromise?

## Sources

- [Google Cloud service account impersonation](https://docs.cloud.google.com/iam/docs/service-account-impersonation): authenticated principal and service-account impersonation model; provider behavior must be checked in the deployed configuration.
- [AWS: Temporary security credentials in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html): temporary credential lifecycle and expiration behavior.
- [IETF RFC 9700: Best Current Practice for OAuth 2.0 Security](https://www.rfc-editor.org/rfc/rfc9700.html): current OAuth security guidance.
- [NIST SP 800-207, Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final): resource-centered access and continuous policy context.
