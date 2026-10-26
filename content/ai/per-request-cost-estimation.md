---
title: Estimating LLM cost per request
description: Estimate request cost from bounded inputs and versioned rate data, then compare estimates with actual usage.
type: pattern
tags:
  - ai
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Purpose and limits

A per-request estimate is a decision aid for admission, product design, and budget forecasting. It is not an invoice and must not be presented as an exact amount before provider usage is known. Actual charges depend on the endpoint and model, input and output usage, cached tokens, tool loops, retries, provider pricing rules, and any account-specific discount or credit. Keep the estimate tied to a rate-table version and show an uncertainty range where the request length or output is not yet known.

Estimate the whole workflow, not just the first model call. A retrieval-augmented answer may have multiple generations, a reranker, embeddings, image processing, or tools. An agent may call the same model several times before returning. For each expected call, identify provider, region, model/deployment, operation, and billable token classes. Add non-token service charges only when the pricing basis is known and relevant. If a rate or unit is unclear, label it as unknown instead of silently treating it as zero.

## Estimate inputs transparently

Before a request, derive conservative input bounds from the prompt template, retrieved context limit, conversation history policy, and user input limit. A tokenizer estimate can approximate token counts, but the provider's tokenizer and request transformations may differ. Include fixed system and tool-schema content, not just user text. For output, use an explicit maximum or a workload-derived range rather than assuming every answer is short. Treat cached input as a separate scenario: cache eligibility, retention, and pricing vary, so the uncached case should remain visible.

Use a formula that is explicit about units: estimated cost equals the sum over calls and token categories of estimated units multiplied by the current rate per unit, plus known fixed charges. Keep currency conversion separate and timestamped. Store the calculation inputs and rate version, not merely a formatted decimal. The actual response usage replaces the estimate for accounting when the provider reports it, while both records remain available to measure forecast error.

## Use estimates in policy decisions

For a low-risk product estimate, show a range or a “typical” estimate based on a documented workload distribution. For a hard budget gate, use a conservative upper bound and an independent maximum on output or agent steps. When an estimate exceeds an approved threshold, the service can choose a cheaper pre-approved model, ask the user to narrow the work, defer a batch task, or return a clear budget-limited response. Avoid abruptly truncating a response without communicating that it is incomplete.

Do not let a low estimate authorize unbounded retries or tool loops. Set a maximum number of model attempts and a separate request-level spend ceiling, then reserve a margin for retry and billing uncertainty. If attempts have already incurred cost, an error on the final call does not undo earlier charges. Maintain a distinct estimate for best case, expected case, and bounded worst case so that product teams understand where savings come from.

Calibration matters. Compare estimate to actual usage by task type, model, and context size. Monitor median and tail error, not just aggregate mean. Investigate underestimation caused by long system prompts, retries, cache misclassification, or provider-side token accounting changes. Revisit the estimator when a model family or tool schema changes and after any pricing revision. Tie the records to [[token-usage-metering-and-chargeback]] so forecast and invoice reconciliation use compatible definitions.

## Worked operational pattern

For a service with one initial generation and one optional follow-up, define two call profiles. The first profile includes system prompt, conversation window, retrieved context cap, and expected output range. The follow-up profile includes the tool result and a shorter answer bound. Estimate both profiles at current rates, weight the second by its observed frequency for forecasts, and use its full cost in the per-request worst-case bound. Keep the provider's cached-input discount out of a guaranteed cap unless cache behavior is measurable and contractually understood.

At request admission, record estimate ID, rate version, planned model, and ceiling. At completion, attach provider-reported usage per attempt and compute estimate error. An alert should fire on a sustained pattern of actual usage exceeding estimates or on an unexpected share of requests approaching the ceiling. Make the dashboard show model and request class; do not label it with user input or raw prompt text.

## Checklist

- Include every expected call, tool loop, retry, and billable category.
- Bound input, output, attempts, and per-request spend.
- Timestamp and version rates, tokenizer assumptions, and calculation rules.
- Preserve the uncached or conservative case where caching is uncertain.
- Replace forecasts with actual reported usage while preserving both.
- Track estimation error by workload and investigate tail misses.
- Explain a budget-limited result to users instead of silently clipping it.

This estimator supports engineering controls and does not replace provider invoices, finance review, or contractual interpretation. See [[llm-api-cost-control]] for aggregate budget gates.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Agent Platform Pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing): official example of rate dimensions; check current region and model prices.
- [Pricing - Claude Platform Docs](https://docs.anthropic.com/en/docs/about-claude/pricing): provider-specific token and model pricing details, subject to change.
- [Prompt caching](https://platform.openai.com/docs/guides/prompt-caching): provider-specific cache behavior and pricing context; verify current eligibility.
