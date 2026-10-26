---
title: Agent memory retention and deletion
description: Define what agent memory exists, its purpose, access and expiration, then make deletion and subject requests testable across replicas.
type: standard
tags:
  - ai
  - security
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

“Memory” can mean active conversation history, a saved summary, user preferences, a retrieval index, cached prompt data, tool logs or evaluation records. Treating these as one feature obscures where information persists and whether a deletion request is complete. This note establishes a defensible memory inventory and lifecycle. It does not replace the input redaction controls in [[redacting-sensitive-data-before-llm-calls]] or the provider's separate data-retention terms.

## Inventory memory by purpose

For every retained artifact, document its owner, purpose, data categories, source, storage location, access control, encryption, retention period, deletion trigger, backup behavior and downstream copies. Separate short-lived task state required to resume a workflow from long-term personalization. Do not retain a user's full transcript merely because a summary might be useful later.

Use the minimum memory needed for a stated product function. Prefer a small, user-visible preference or task checkpoint to open-ended retrieval of everything a user has said. Attach provenance and timestamps to remembered facts; expire facts whose source may become stale. Give users a way to inspect and correct persistent personal memory where the product design permits it.

Keep operational audit data separate from conversational memory. Audit records may need to establish who initiated an action and whether it was approved, but often need only IDs, event type, policy revision and outcome—not raw prompt content. Define retention with privacy, security, legal and operational owners rather than inheriting storage defaults.

## Deletion is a workflow

Deletion should cover all live representations: primary database rows, vector or search indexes, derived summaries, caches, application replicas and provider-managed state where applicable. Map identifiers through every transformation so the system can find derivative records. Define what “deleted” means for immutable backups and legal holds, and communicate the actual policy instead of promising immediate erasure from every backup.

Make deletion idempotent and auditable. A request should create a tracked job, identify affected stores, record per-store completion or failure, and retry safely. A partial deletion is not a success; show unresolved systems and escalate to an owner. Ensure a deleted memory cannot be reintroduced from an old conversation snapshot or background sync. Test restoration and backup expiry procedures so deleted records do not unexpectedly return after recovery.

Do not use a model to decide whether a deletion request is valid or to generate the deletion scope. Resolve identity and scope through authenticated product logic. Where regulations or provider contracts apply, confirm duties with counsel and the service owner; this note is operational guidance, not legal advice.

## Safety and quality tradeoffs

Long retention can improve continuity but expands the impact of account compromise, stale facts and accidental disclosure. Short retention reduces exposure but may frustrate users and increase repeated context assembly. A practical compromise is tiered retention: transient task memory expires quickly; user-approved preferences persist with clear controls; audit metadata follows a separate documented schedule.

Avoid putting secrets, credentials or protected data into long-term memory. If memory is retrieved into a model context, apply current access checks at retrieval time; possession of an old memory record should not grant access to a resource whose permissions have since changed. Retrieval results remain untrusted content even if they originated from a prior trusted user session.

## Review checklist

- [ ] Every memory type has owner, purpose, data class and retention period.
- [ ] Long-term memory is opt-in or otherwise clearly justified and disclosed.
- [ ] User access, correction and deletion flows have defined behavior.
- [ ] Deletion maps through indexes, derived summaries and cache layers.
- [ ] Retries, partial failure, backup expiry and legal holds are documented.
- [ ] Retrieval rechecks present-day authorization and source freshness.
- [ ] Audit needs are met with minimal metadata rather than transcript retention.
- [ ] Tests prove deletion completion and prevent stale memory restoration.
- [ ] Provider storage and retention claims are confirmed in current contractual documentation.

## Sources

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) — governance and lifecycle risk management; NIST says AI RMF 1.0 is being revised.
- [Anthropic: API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) — provider-specific retention information; verify current terms and product configuration before relying on it.
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) — security risks involving agentic application data and control.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
