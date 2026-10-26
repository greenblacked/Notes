---
title: Token usage metering and chargeback
description: Build auditable usage records that reconcile provider bills with internal teams, services, and request classes.
type: pattern
tags:
  - ai
  - cost
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Define what is being metered

Token counts are one useful unit of LLM consumption, but they are not a bill by themselves. Providers can price input, output, cached input, reasoning, image, audio, batch, or other usage differently, and may revise rates or model identifiers. Maintain an authoritative rate table with effective dates, provider, endpoint, region, model or deployment identifier, unit, currency, and source. Resolve rates by the identifier actually used for the attempt, not a generic display label. Keep provider invoice totals as the financial authority and internal estimates as an attribution aid.

Define a meter event at the provider-attempt level. Include a stable internal request ID, attempt number, timestamp, tenant or cost center, service, environment, provider, region, requested and returned model IDs when available, token categories, outcome, and rate-table version. Do not include prompts, completions, customer names, or secrets in the meter record. Use a separate controlled mapping to resolve internal billing identities if needed, and make the data owner responsible for that mapping.

Count usage for failed and retried calls where the provider bills them. A logical request can incur several attempts, and an output that is discarded may still contribute cost. Record estimates before a response and final provider-reported usage after completion, with clear status to prevent double counting. If streaming terminates early or usage is omitted, record a reason and leave the amount explicitly unknown or estimated rather than fabricating precision.

## Normalize and reconcile

Keep raw provider usage fields alongside normalized internal categories. The normalized schema allows cross-provider reporting, while raw values support audit when a provider introduces a new usage type. Store integer token counts and explicit units; do not use floating point for money where decimal currency arithmetic is available. Apply a versioned pricing table to produce estimates, and record whether the calculation includes discounts, caching, batch rates, or credits. Pricing pages are dynamic, so retain a timestamped copy or reference to the exact published rate source under your normal records policy.

Reconcile at a cadence appropriate to spend. Aggregate internal records by provider, model, region, account, day, and cost center, then compare with provider usage exports and invoices. Investigate mismatches from time-zone boundaries, delayed records, retries, rate changes, minimum charges, caching, and missing attribution tags. Publish both known variance and its reason. A fully balanced daily spreadsheet is not trustworthy if the underlying event stream silently drops unknown fields.

Use immutable or append-only accounting records where practical. Corrections should be new adjustment records that reference the original event, not silent edits to prior usage. Define duplicate detection around provider request IDs where available and internal idempotency keys otherwise. Do not count the same attempt twice when a response callback and billing export both report it; choose a source of truth for each field and preserve provenance.

## Make chargeback fair and actionable

Choose an allocation rule that reflects how the service is consumed. Direct per-request attribution is best when the caller identity is trustworthy. Shared system prompts, scheduled evaluations, and platform-level experiments may belong to a platform cost center rather than being arbitrarily assigned to end users. Document treatment of unassigned usage, shared overhead, credits, and taxes. Chargeback should not penalize teams for safety checks or retries that the platform required without first exposing those drivers.

Provide owners with trends, forecast, effective rates, top request classes, and a path to investigate. Alert on unexpected spend velocity and missing attribution, but distinguish a data-pipeline failure from a real consumption spike. [[llm-api-cost-control]] covers budget enforcement; [[per-request-cost-estimation]] covers a request-time estimate. Accounting reports should feed both, without making a billing label an authorization decision.

## Checklist

- Capture each provider attempt and all billable usage categories.
- Preserve raw fields, normalized units, rate version, and estimation status.
- Attribute with an approved, low-sensitivity cost-center mapping.
- Deduplicate records and append corrections with provenance.
- Reconcile internal usage to provider exports and invoices; report variance.
- Review new models, rate changes, and unknown usage categories promptly.
- Set owners for unallocated usage, report access, and disputed allocations.

Do not expose customer-level prompt data in finance dashboards. Apply retention and access controls to detailed usage records, and aggregate or de-identify reports where possible. Engineering guidance for allocation is not legal or accounting advice.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Agent Platform Pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing): official example of model-specific pricing; rates and billing units can change.
- [Pricing - Claude Platform Docs](https://docs.anthropic.com/en/docs/about-claude/pricing): provider pricing categories; verify the current model and account terms.
- [Generative AI on Agent Platform quotas and system limits](https://cloud.google.com/vertex-ai/generative-ai/docs/quotas): official quota dimensions that may affect metering and service behavior.
