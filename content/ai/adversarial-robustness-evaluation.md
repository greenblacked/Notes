---
title: Adversarial robustness evaluation for AI systems
description: Probe model and agent behavior under hostile, confusing and out-of-distribution inputs without overstating test coverage.
type: guide
tags:
  - ai
  - security
  - reliability
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Define the threat and the boundary

Adversarial robustness evaluation asks whether an AI system maintains its required behavior under intentionally difficult inputs. It does not establish that a system is secure, and a finite test suite cannot prove absence of vulnerabilities. Start with a threat model: assets, trust boundaries, attackers, their access and goals, relevant tools or data, and harms from failure. Include the full application pipeline—retrieval, orchestration, model, tools and output handling—not only the prompt. Existing prompt-injection harnesses for CI agents are described in [[prompt-injection-test-harness-for-ci-agents]].

Translate each threat into an observable test: what would an attacker-controlled input contain, what forbidden behavior must not occur, what safe behavior is acceptable, and which independent assertion will detect it? Examples include ignoring instructions embedded in retrieved documents, refusing unauthorized data disclosure, maintaining tool allowlists after misleading tool output, and separating quoted content from trusted instructions. Avoid vague tests such as “resists jailbreaks.”

## Construct a threat-informed suite

Organize cases by attack surface and failure mechanism: direct prompt injection, indirect instructions in documents or tool output, conflicting instructions, data exfiltration attempts, sensitive-data requests, encoded or obfuscated text, multilingual input, malformed structured data, context flooding, refusal manipulation, and attempts to trigger prohibited tool actions. Include benign near-neighbors to check that safeguards do not block ordinary work. Build cases from policy-approved incidents, expert threat modeling and synthetic variations, while recording provenance and limitations.

Use canary values or inert test secrets in isolated environments to detect unintended disclosure. Use mock tools and fake records; do not introduce real credentials or target a live service without explicit authorization. Assertions should check state, network/tool activity, output disclosure and audit events rather than judging only the final response. Keep outputs that contain attacks clearly marked as untrusted test data.

Separate known regression cases from red-team discovery. The former should be stable and deterministic; the latter explores unexpected behaviors and needs careful documentation, triage and reproduction. Capture the exact model, system prompt, tool schema, retrieval corpus, safety configuration, random seed where available, and environment version. Do not publish sensitive exploit details unnecessarily.

## Metrics and interpretation

Track attack success rate by threat class, severity-weighted failure counts, sensitive-data disclosure, unauthorized tool attempts, unsafe state changes, correct safe-completion rate on benign controls, refusal quality and recovery after malicious context. Define denominators: attempts, turns, tasks, or unique attack templates. Report coverage by category and variant; many paraphrases of one attack are not broad coverage. For stochastic behavior, repeat selected cases and report variance rather than cherry-picking a single pass.

A “block rate” alone is not enough. It may reward blanket refusal, ignore leaked data in tool traces, or miss successful attacks where the final answer remains polite. Measure usefulness on benign controls and verify the system state after every test. Avoid claiming a universal robustness percentage or passing threshold. Set local release criteria based on consequence, existing controls, and residual risk; explain what attack classes remain untested.

## Failure modes and tradeoffs

A fixed benchmark can be memorized or become stale. Overly artificial attacks may miss real workflow conditions, while use of production data creates privacy and operational exposure. Testing only the base model misses application-layer failures; testing only end-to-end obscures which control failed. A strong refusal can still leak sensitive snippets earlier in the trace. Evaluation itself may trigger side effects if the harness is not isolated.

Balance coverage with operational realism through controlled layers: component tests, offline adversarial suites, sandbox integrations and authorized exercises. Keep defense-in-depth: evaluation does not replace least privilege, output validation, egress controls or human approval. Feed findings into the security and incident processes, including [[runaway-or-compromised-ai-agent-response]].

## Review checklist

- Is there a documented threat model and trust-boundary map?
- Do cases map to explicit forbidden behaviors and independent assertions?
- Are untrusted inputs tested across retrieval, tools and outputs?
- Are tests isolated and free of real secrets or unauthorized targets?
- Are attack success, harmful outcome and benign utility all measured?
- Are coverage, denominators, model/configuration and limitations reported?
- Are discovered cases triaged, reproduced and added with provenance?
- Are security controls maintained independently of benchmark scores?

The owner's agent skills and workflows are listed in [the AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile (NIST AI 600-1; July 2024)](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): risks including information security, prompt injection and harmful misuse.
- [NIST AI RMF Playbook (AI RMF 1.0 (January 2023); page notes it is being updated, accessed 2026-10-26)](https://airc.nist.gov/airmf-resources/playbook/): risk identification, measurement and management; the linked page states AI RMF 1.0 is being updated (accessed 2026-10-26).
- [Mitigate jailbreaks and prompt injections (Claude Platform Docs; accessed 2026-10-26)](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks): provider guidance on reducing prompt-injection and jailbreak risk.
