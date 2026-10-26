---
title: Due diligence for AI model providers
description: Evaluate a model provider across service scope, security, data handling, reliability, and operational change before adoption.
type: guide
tags:
  - ai
  - security
  - audit
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Evaluate the service, not just the model

Provider due diligence is an engineering and procurement process for a specific service configuration. A model benchmark or public product page does not establish how the selected endpoint handles data, what support is available, or whether the service meets a team's operational needs. Separate provider-level claims from the terms and behavior of the exact product, region, account tier, and feature in use.

Start with the proposed workload: data categories, expected request volume, latency and availability needs, tool access, retention requirements, user population, and consequences of failure. Compare providers against the same use case and evidence requirements. Maintain a source register with the exact documentation or contract version checked, owner, date, and unresolved questions. Provider details change; avoid copying current marketing statements into a permanent policy without a revalidation trigger.

This assessment is complementary to [[model-data-use-contract-review]], which focuses on contractual data-use and retention terms. Model version changes require separate evaluation; see [[model-version-pinning-and-upgrade-evals]].

## Evidence collection workflow

1. **Define service scope.** Record product name, API or platform, deployment option, account tier, region, model family, enabled tools, and any optional processing services. Distinguish direct API use from a cloud provider's hosted model integration.
2. **Review security architecture.** Request current security documentation for identity and access, encryption, tenant isolation, vulnerability response, incident notification, subprocessors, audit logs, and support access. Validate which controls apply to the selected plan rather than assuming a corporate webpage applies universally.
3. **Trace data handling.** Map request, response, feedback, telemetry, abuse monitoring, support, and backup flows. Check retention, training use, deletion, export, regional processing, and opt-out controls in the applicable contract and service docs. Route legal interpretation to counsel.
4. **Test technical suitability.** Run a controlled evaluation using synthetic or approved data. Measure task quality, latency, failure behavior, quotas, cost, and regional availability. Include adversarial and malformed inputs, but do not expose real secrets in a vendor evaluation without authorization.
5. **Assess operations and exit.** Confirm support model, status and incident channels, quota escalation, version lifecycle, deprecation notices, export options, and migration strategy. Estimate the effort to switch models or providers and identify proprietary dependencies.
6. **Record decisions and conditions.** Document accepted risks, required mitigations, restricted data/use cases, approval owners, evidence date, and reassessment triggers. Make adoption conditional when evidence is incomplete.
7. **Recheck at material change.** Reassess when the provider changes terms, data controls, product boundary, model lifecycle, region, or subprocessor; also when the workload gains new data or action permissions.

Use a risk-based evidence request rather than demanding every available certification. A certificate can provide assurance for a defined scope and period; it does not guarantee every feature is covered or that the service is appropriate for a specific system.

## Failure modes

Common mistakes include evaluating the model but not the API layer, applying one service's data policy to another product, confusing zero-retention settings with zero processing, overlooking abuse-monitoring or support paths, and treating a provider's latest public page as a signed contract. A vendor questionnaire completed by marketing may not establish a technical guarantee. Availability claims may exclude preview features or regional limitations.

Do not state that a provider is “compliant” with a law or framework based on an assurance page. Record exactly what source says, its date and scope, and what your organization must still implement. Do not use provider claims to skip access control, data minimization, encryption, monitoring, or incident response on your side.

If evidence cannot be obtained, choose a lower-sensitivity workload, disable affected features, use a different service, or defer. For a material provider incident, preserve the relevant configuration, identify data and users in scope, and follow internal incident and contractual notification processes.

## Decision checklist

- Is the exact product, API, plan, region, and model configuration identified?
- Are security, privacy, retention, subprocessor, and support claims tied to current scoped evidence?
- Has the service been tested against workload quality, reliability, cost, and failure needs?
- Are contractual questions reviewed by authorized procurement and legal staff?
- Are limitations, prohibited data, residual controls, and exit options documented?
- Are approval owners and reassessment triggers assigned?

An adoption decision should be conditional on evidence, not provider reputation. If a material claim remains unresolved, narrow the use case rather than assuming a favorable answer.

## Related

- [Owner’s AI skills catalogue](https://ai.szolotov.com).

## Sources

- [OpenAI API: Data controls in the OpenAI platform](https://developers.openai.com/api/docs/guides/your-data): platform data-control overview; verify current applicability for the selected product and account configuration.
- [Anthropic Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms): contractual terms for applicable commercial services; have counsel confirm scope and current version.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework): risk-management framing; AI RMF 1.0 (2023) is noted as under revision on the NIST page.
