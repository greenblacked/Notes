---
title: "AI 01: Understand what an assistant can and cannot do"
description: "Recognise tokens, context, inference, retrieval and agents, then test unsupported claims before trusting an answer."
type: guide
tags:
  - learning
  - ai
created: 2026-10-27
modified: 2026-10-27
draft: false
---

[[learn/index#AI practice track|Track overview]] · [[learn/ai/verified-troubleshooting|Next: AI 02]]

> [!info] Level: junior | Time: 90 min | Prerequisites: [[learn/lab-setup|Lab setup]] | Lab: an approved chat tool, synthetic text only

## What you will learn

- Distinguish training, inference, retrieval and tool execution.
- Identify claims that exceed supplied evidence.
- Record exact prompts, responses and checks across repeated runs.

## The mental model

Artificial intelligence is a broad category. Machine learning fits models from examples; deep learning uses layered neural networks. A language model generates sequences of tokens, which may represent words, parts of words or other symbols. Training changes model weights. Inference uses those weights to produce an output. A chat conversation normally supplies inference context; it is not the same operation as training. Provider retention and training-use terms are a separate question you must check for the exact account and service.

A context window is a finite input/output budget. Application instructions, chat history, retrieved text and tool results may compete for it. An assistant cannot see your repository merely because you mention its name: the application must supply files or expose a tool that reads them.

An embedding represents input as numbers useful for similarity search. Retrieval finds candidate evidence; retrieval-augmented generation (RAG) gives that evidence to a model. Fine-tuning changes weights using training examples. Neither establishes that an answer is correct. An agent adds a loop that selects tools and reacts to their results. A model's request to run a command is a proposal until the application authorises and executes it.

Fluent answers can contain invented facts and citations. Low temperature is not a correctness guarantee. Check important claims with source material and repeatable tests.

## Hands-on exercises

1. Create a local Markdown file called `ai-evidence.md`. Record the date, tool, displayed model label (or “not exposed”), exact prompt, response and your checks. Use only the synthetic service below.
2. Ask the same tool the following in a fresh conversation three times. Save each answer before comparing them.

```text
Use only the service card below. For each answer, quote its supporting
sentence or say "not provided". Do not invent settings or commands.
Service: lantern-lab. Owner: learning team. Restart policy: manual.
Last backup: 2026-10-01. No restore drill has been recorded.
Questions:
1. Who owns it?
2. What is its recovery time objective?
3. Has recovery been demonstrated?
4. What read-only evidence would you request next?
```

Expected: owner is the learning team; RTO is not provided; recovery has not been demonstrated by the supplied evidence. A backup timestamp does not prove recoverability. The last answer should request evidence, such as a restore-drill record, without claiming it exists.

**If you see something else:** mark the exact unsupported sentence. Tighten the evidence requirement and repeat, retaining the failed answer. Do not quietly discard failures.

3. Ask what changes if a search tool, repository reader or shell is attached. Draw the data flow in your notes: input, context, model, proposed action, authorisation, tool result. Label where a real permission check must live.

No local commands or cloud resources are required. Remove the synthetic conversation through the tool's account controls if desired; check its retention policy rather than assuming deletion is immediate.

## Common mistakes

Mistaking confidence for evidence; treating a model name as a capability guarantee; assuming a chat subscription includes API access; assuming a local model means the entire application is offline. Inspect integrations, telemetry and network access separately.

## Check your understanding

1. Does adding a document to a chat necessarily retrain the model?
2. What can you conclude from no recorded restore drill?
3. Why keep three answers to the same prompt?
4. Where must permission to execute a proposed command be checked?

> [!question]- Answers
>
> 1. No. It normally supplies inference context; fine-tuning and provider data-use terms are separate questions.
> 2. Recovery is not demonstrated by the supplied evidence. You cannot conclude recovery is impossible or that no drill ever occurred.
> 3. They expose variation and preserve failures that a single selected answer could hide.
> 4. In the application or tool authorisation boundary, outside generated text.

## Pass criteria

Your evidence log identifies every unsupported claim in the three runs and separates observation from inference. You can explain why a backup is not a tested recovery plan without asking the assistant.

## Next steps

[[learn/index#AI practice track|Track overview]] · [[learn/ai/verified-troubleshooting|Next: AI 02]]

After completing the pass criteria, keep your evidence log and continue to [[ai/index|the production AI reference notes]] for the boundaries your next project needs.

## Sources

Concepts checked on 2026-10-27 against [NIST's Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) and [OWASP's prompt-injection prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html). The exercises and grading criteria are this learning track's design. Model behaviour, privacy settings and account capabilities must be checked in the chosen tool. No model-backed runs or production validation are claimed here.
