---
title: Context window budgeting
description: Budget tokens for instructions, history, retrieval and output, with explicit truncation behavior and safe fallback when context does not fit.
type: guide
tags:
  - ai
  - reliability
  - cost
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Context windows are finite, and usable capacity is smaller than the advertised maximum once instructions, tool schemas, message framing and reserved output are included. An agent that silently drops the oldest content may lose the authorization scope, the evidence needed to answer or a pending approval. Budget context as part of application design rather than treating overflow as a prompt-formatting issue. This note complements [[context-engineering-for-agents]], which addresses relevance and selection.

## Model the budget

Estimate capacity for each request using the selected model's current documented limits and the exact request format. Include system/developer instructions, tool schemas, conversation history, retrieved content, multimodal payload overhead where applicable, and a reserved completion budget. Token counts are tokenizer- and model-dependent; a character count is only a coarse safety heuristic. Leave headroom for provider framing and future prompt changes rather than packing to the published ceiling.

A simple accounting ledger can track the categories:

| Context component      | Owner                | Budget treatment                  |
| ---------------------- | -------------------- | --------------------------------- |
| Stable instructions    | Product team         | Fixed allocation; revision tested |
| Tool definitions       | Tool owner           | Bound tool count and schema size  |
| Current user task      | Caller               | Enforce request length            |
| Retrieved evidence     | Retrieval layer      | Rank, deduplicate and cap         |
| Prior turns or summary | Conversation service | Apply relevance and age policy    |
| Output reserve         | Consumer contract    | Reserve before assembling inputs  |

Use the provider's tokenizer or request accounting facilities where available. Do not hard-code a model limit across aliases: a route or model upgrade can change capacity, tokenization, output limits and cost.

## Define overflow behavior

When the planned context exceeds the budget, do not remove arbitrary leading or trailing tokens. First remove redundant low-value material: duplicate passages, irrelevant older turns and low-ranked retrieval results. If still too large, summarize only with provenance and retain references to original material; validate that summaries preserve caveats and required facts. For critical tasks, return an explicit “insufficient context” state rather than dropping the task constraints or approval record.

The order matters. Reserve the output budget and non-negotiable instructions before retrieval. Never truncate a required tool schema or a structured input halfway through. Record which sources were omitted and whether a summary was used. If a user expects completeness, make truncation visible in the result.

## Optimize with measurements

Measure context size, provider-reported input tokens, output tokens, latency and task-quality outcomes by route and model. Keep labels low-cardinality and avoid prompt text or user identifiers in metrics, following [[llm-observability-tracing-and-slos]]. Compare policies using a representative evaluation set: recency truncation, retrieval ranking, bounded summaries and full context have different failure profiles.

Large context can simplify application code, but raises cost and may reduce focus. Summarization can reduce tokens but adds another model call and a second lossy transformation. Retrieval is efficient for large corpora but can omit a fact. Use the simplest strategy that meets measured quality and freshness requirements.

## Failure modes and review checklist

Typical defects include counting tokens before adding tool schemas; reserving no room for a final answer; splitting an item in the middle of a JSON record; summarizing away negation or time range; using one tokenizer estimate for all providers; and treating a provider's context-full error as a request to retry unchanged. An old assistant response may also contain an earlier policy or outdated plan, so conversation history needs version-aware handling.

- [ ] Budget uses the selected model and actual serialization path.
- [ ] Output reserve, tools and hidden framing are included with headroom.
- [ ] Inputs are prioritized by task value, authorization and freshness.
- [ ] Truncation and summarization are explicit and observable.
- [ ] Required constraints, approval state and provenance are never silently dropped.
- [ ] Overflow returns a bounded, truthful outcome rather than fabricated completeness.
- [ ] Token, latency, cost and quality are measured together.
- [ ] Model and tokenizer upgrades trigger budget and evaluation review.

## Sources

- [Google AI: Long context](https://ai.google.dev/gemini-api/docs/long-context) — explains context windows and considerations for long inputs; exact model limits are on the current model documentation.
- [OpenAI: Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering) — provider guidance on prompt organization; consult current model-specific limits.
- [OpenTelemetry GenAI Semantic Conventions](https://github.com/open-telemetry/semantic-conventions-genai) — evolving conventions repository for GenAI telemetry; inspect current files before choosing attribute names.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
