---
title: Hallucination triage and remediation
description: Classify unsupported model outputs by root cause and route fixes to the responsible system layer.
type: guide
tags:
  - ai
  - reliability
  - incident-management
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Define the failure before fixing it

“Hallucination” is often used for several different defects: a false factual claim, unsupported inference, fabricated citation, stale information, or failure to disclose uncertainty. Triage begins by preserving the request, generated response, evidence available to the system, source version, retrieval results, prompt/configuration and any tool calls. Redact sensitive content according to policy. Do not assume that a confident-sounding answer is false or that a cited answer is grounded.

Classify the defect at the claim level: unsupported by context, contradicted by authoritative evidence, invented entity or reference, citation mismatch, incorrect calculation, or overstatement of confidence. Then locate the likely layer: source content, indexing or retrieval, access filter, prompt instructions, generation, tool result interpretation, output transformation, or evaluation rubric. The grounding rubric in [[groundedness-and-faithfulness-evaluation]] helps make these distinctions reproducible.

## Triage with evidence

For every report, establish what the user asked, what evidence the application actually supplied, and what evidence should have been supplied under the product contract. Compare retrieved sources with the authoritative current source and check freshness, permissions, chunk boundaries, ranking and truncation. Determine whether the answer asserted more than the evidence supported, omitted a key qualification, or misrepresented a tool result. Record the impact and affected workflow, not merely a vague “wrong answer” label.

Prioritize by consequence, exposure and recurrence. A fabricated low-impact example differs from incorrect operational instructions or a privacy leak. Use the established incident severity and escalation process rather than inventing a separate AI-only severity scale. If behavior can trigger harmful side effects, contain the capability and use the runbook in [[runaway-or-compromised-ai-agent-response]]. Preserve relevant logs within retention rules, but avoid retaining personal or secret content longer than necessary.

Build a minimized reproducible case using synthetic or redacted data. Pin model, prompt, retrieval corpus, tool schema and decoding configuration. Re-run only in a safe environment. If a failure is stochastic, retain the observed run and report reproduction frequency across repeated controlled attempts rather than claiming it is deterministic. A failure that cannot be reproduced still merits tracking when evidence is credible.

## Remediate the correct layer

If source material is inaccurate or stale, correct ownership and freshness controls. If retrieval misses a source, investigate chunking, indexing, query rewrite, ranker and permission filters; do not solve every miss by adding prompt text. If the model overstates evidence, constrain the answer contract, include an abstention path, strengthen citations and test groundedness. If a tool response is misread, validate tool outputs, schema and state transition. If evaluation labels are wrong, adjudicate and version the rubric.

Use a regression case for the failure and add nearby counterexamples so a fix does not merely memorize one prompt. Include benign examples to catch over-refusal and adversarial variants where relevant. Validate the change against a held-out set and track both target metric and counter-metrics such as task completion, citation coverage, latency, cost and human escalation. Do not claim a fix based on a single hand-picked success.

For repeated or high-impact failures, assign an owner, due date and remediation action. Decide whether the issue needs customer communication, policy review or a broader model upgrade check. Roll out with monitoring and a rollback path; compare the impact of a data fix, retrieval change, prompt change or model change before combining them, so attribution remains possible.

## Failure modes and tradeoffs

Overly broad fixes can suppress useful answers, create refusal loops or shift errors elsewhere. Prompt patches can conceal a retrieval defect. Adding the bad answer as a regression example may leak it into tuning. Ad hoc incident logs may expose private data. Fixes that change several layers at once are hard to assess. Track root cause confidence and unresolved questions rather than pretending every case has a certain explanation.

## Review checklist

- Is the original system evidence and configuration preserved safely?
- Is the failure defined at claim or action level with impact?
- Was supplied evidence compared to the authoritative source?
- Is root cause assigned to a specific pipeline layer?
- Does the regression include neighboring cases and counter-metrics?
- Are privacy, incident escalation and rollback handled?
- Is remediation independently evaluated beyond a single replay?
- Are recurrence, ownership and unresolved uncertainty tracked?

The owner's agent skills and workflows are listed in [the AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile (NIST AI 600-1; July 2024)](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): confabulation and information integrity risks and mitigations.
- [NIST AI RMF Playbook (AI RMF 1.0 (January 2023); page notes it is being updated, accessed 2026-10-26)](https://airc.nist.gov/airmf-resources/playbook/): monitoring, incident learning and lifecycle risk management; the linked page states AI RMF 1.0 is being updated (accessed 2026-10-26).
- [Define success criteria and build evaluations (Claude Platform Docs; accessed 2026-10-26)](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests): converting observed failures into evaluation cases.
