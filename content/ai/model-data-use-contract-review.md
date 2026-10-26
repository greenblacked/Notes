---
title: Reviewing model data-use terms
description: Coordinate legal and engineering review of model-provider terms for data use, retention, access, and deletion.
type: guide
tags:
  - ai
  - compliance
  - security
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Separate contract interpretation from system controls

A provider's public documentation, a sales statement, and an executed agreement are not interchangeable. Engineering should identify the data flows and controls a system needs; authorized legal, privacy, procurement, and security reviewers should interpret applicable terms and decide whether the contract supports the intended use. This note is an implementation checklist, not legal advice and not a statement that any service or deployment complies with a law.

Review the exact offering: API versus consumer product, cloud-hosted endpoint versus provider-hosted service, account tier, region, enabled features, and date/version of terms. A control described for one product may not apply to another. Terms and service documentation can change, and some controls may depend on configuration or additional agreements.

Use [[model-provider-due-diligence]] for the broader technical and operational provider assessment. For minimizing sensitive prompt content before transmission, see [[redacting-sensitive-data-before-llm-calls]].

## Review workflow

1. **Inventory data.** List prompt inputs, retrieved content, source code, personal or confidential information, outputs, feedback, telemetry, error traces, and support materials. Map each category to collection, transit, processing, storage, logs, and backups.
2. **Identify governing documents.** Ask authorized procurement/legal staff to identify the master agreement, product terms, data processing addendum, service-specific documentation, order form, and any configuration-dependent commitments. Record versions, effective dates, precedence, and applicable entity.
3. **Resolve key questions with counsel.** Determine permitted purposes; whether customer content may train or improve models; retention periods and exceptions; abuse-monitoring; human access; subprocessors; geographic processing; deletion and backup timelines; security incident notice; audit evidence; and return/export on termination. Do not infer answers from ambiguous marketing language.
4. **Translate terms into engineering settings.** Map approved retention and training choices to actual account settings, endpoint selection, region, logging, feedback controls, and data-routing rules. Verify the setting is available to the intended tenant and is enforced by policy or code where possible.
5. **Test and monitor implementation.** Use synthetic data to test configuration, logging, retention behavior where observable, and access controls. Document what cannot be tested directly. Detect unauthorized endpoint or account changes and review provider notices for changes to relevant terms.
6. **Set use-case boundaries.** Publish allowed and prohibited data categories, user responsibilities, and escalation paths. Ensure the product does not accept sensitive content through a path excluded from the reviewed configuration.
7. **Reassess on change.** Trigger review when terms, product features, subprocessors, account tier, region, data classes, or use cases change. Keep approval and configuration evidence together, with access limited to appropriate reviewers.

Engineering teams should not independently interpret clauses such as “service improvement,” “de-identified,” “retention,” or “processor” as if they were self-explanatory guarantees. Provide counsel with a clear data-flow diagram, configuration evidence, business purpose, and concrete question. If terms do not clearly cover a proposed use, pause that use until the authorized reviewers resolve it.

## Failure modes

Teams often rely on an old public webpage, apply an API policy to a chat product, overlook data included in logs or feedback, assume deletion includes backups immediately, or conclude that “not used for training” means no retention or human access. Another failure is treating a settings screenshot as durable evidence while allowing users to change the setting later.

Do not record an unsupported conclusion such as “provider cannot access prompts” or “data is never retained.” Write down the exact promise, scope, exception, source, and unresolved point. If controls are account-level, restrict who can modify them and alert on changes. If data may have gone to an unapproved endpoint, preserve logs and follow internal privacy/security incident procedures.

## Decision checklist

- Does the review identify the exact product, account, region, and effective documents?
- Are all prompt, output, telemetry, support, and backup data paths included?
- Have legal/privacy teams answered purpose, retention, training, access, subprocessors, deletion, and incident-notice questions?
- Are approved contractual commitments reflected in enforceable configuration and user guidance?
- Is evidence preserved with dates and scope, including limitations of testing?
- Are changes monitored and reassessment triggers assigned?

Engineering can implement and verify controls, but only authorized legal and privacy reviewers should make legal interpretations or approve contractual sufficiency.

## Related

- [Owner’s AI skills catalogue](https://ai.szolotov.com).

## Sources

- [OpenAI API: Data controls in the OpenAI platform](https://developers.openai.com/api/docs/guides/your-data): current documentation on platform data controls; confirm product/account applicability and contractual precedence.
- [Anthropic Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms): primary commercial terms; contract interpretation belongs to authorized counsel.
- [Google Cloud documentation: Gemini Enterprise Agent Platform and zero data retention](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/zero-data-retention): Google Cloud's product-specific zero-retention documentation; check current product naming, configuration scope, and contractual terms.
