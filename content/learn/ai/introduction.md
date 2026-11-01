---
title: "AI 01: Understand what an assistant can and cannot do"
description: "Recognise tokens, context, inference, retrieval and agents, then test unsupported claims before trusting an answer."
type: guide
tags:
  - learning
  - ai
created: 2026-10-27
modified: 2026-11-01
draft: false
---

[[learn/index#AI practice track|Track overview]] · [[learn/ai/verified-troubleshooting|Next: AI 02]]

> [!info] Level: junior | Time: about 1.5 h | You need: [[learn/lab-setup|Start 01: Set up your lab]] | Lab: an approved chat tool, synthetic text only

An _approved_ tool is one your employer or school allows for the data you will enter. These labs use only synthetic text, so a personal account is acceptable if your employer's policy permits it; record which you used. See [[standards/data-classification-and-handling-standard|data classification]] and [[ai/redacting-sensitive-data-before-llm-calls|redaction]] before any non-synthetic use.

## What you will learn

- Distinguish training, inference, retrieval and tool execution.
- Identify claims that exceed supplied evidence.
- Record exact prompts, responses and checks across repeated runs.

## The mental model

Artificial intelligence is a broad category. Machine learning fits models from examples; deep learning uses layered neural networks. A language model generates sequences of tokens, which may represent words, parts of words or other symbols. Generation samples from a probability distribution over the next token, so the same prompt can give different answers; temperature and other settings shape that sampling, and some services vary even at a low temperature. Training changes model weights. Inference uses those weights to produce an output. A chat conversation normally supplies inference context; it is not the same operation as training. Provider retention and training-use terms are a separate question you must check for the exact account and service.

A context window is a finite input/output budget. Application instructions, chat history, retrieved text and tool results may compete for it. An assistant cannot see your repository merely because you mention its name: the application must supply files or expose a tool that reads them. An application may truncate or summarise older chat history without telling you, and a model may answer confidently about a public project of the same name from its training data. That is not evidence that it read your repository.

An embedding represents input as numbers useful for similarity search. Retrieval finds candidate evidence; retrieval-augmented generation (RAG) gives that evidence to a model. Fine-tuning changes weights using training examples. Neither establishes that an answer is correct. An agent adds a loop that selects tools and reacts to their results. A model's request to run a command is a proposal until the application authorises and executes it.

Fluent answers can contain invented facts and citations. Low temperature is not a correctness guarantee. Check important claims with source material and repeatable tests.

## Hands-on exercises

1. Create a local Markdown file called `ai-evidence.md`. Record the date, tool, displayed model label (or “not exposed”), exact prompt, response and your checks. Use only the synthetic service below.
2. Before the first run, turn off cross-conversation memory, custom or saved instructions, web search, file and code tools where the tool allows. Record anything you cannot turn off under Available settings; results from a tool with memory on are not independent repetitions. Then ask the same tool the following in a fresh conversation three times. Save each answer before comparing them.

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

3. Draw the data flow from this lesson first: input, context, model, proposed action, authorisation, tool result. Then ask the tool what changes if a search tool, repository reader or shell is attached, and mark its claims about its own internals as unverified. Label where a real permission check must live.

No local commands or cloud resources are required. Remove the synthetic conversation through the tool's account controls if desired; check its retention policy rather than assuming deletion is immediate.

## Common mistakes

- **Mistaking confidence for evidence.** Fluent, specific answers feel verified, but a model can state invented facts in the same tone as true ones. Quote the supporting sentence or treat the claim as unsupported.
- **Treating a model name as a capability guarantee.** A label says little about what this account, tool settings and context window can actually do. Test the behaviour you need and record the settings you used.
- **Assuming a chat subscription includes API access.** Chat products and programmatic access are usually separate services with separate terms, limits and data handling. Check the plan and terms for the exact service before you build on it.
- **Assuming a local model means the entire application is offline.** The application around it may still send telemetry or call remote tools. Inspect integrations, telemetry and network access separately.

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

Your evidence log identifies every unsupported claim in the three runs and separates observation from inference. You can explain why a backup is not a tested recovery plan without asking the assistant. Your data-flow sketch places the permission check outside the model.

## Next steps

[[learn/index#AI practice track|Track overview]] · [[learn/ai/verified-troubleshooting|Next: AI 02]]

After completing the pass criteria, keep your evidence log and continue to [[ai/index|the production AI reference notes]] for the boundaries your next project needs. The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

Checked on 2026-10-27: [NIST AI 600-1, Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) (July 2024) and the [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html). Tokens, context windows, embeddings and sampling are general background, not tied to one source. The exercises and grading criteria are this learning track's design. Model behaviour, privacy settings and account capabilities must be checked in the chosen tool. No model-backed runs or production validation are claimed here.
