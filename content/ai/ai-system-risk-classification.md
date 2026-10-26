---
title: Risk classification for AI-enabled engineering systems
description: Classify an AI system by its uses, autonomy, access, and potential impacts to select proportionate engineering controls.
type: guide
tags:
  - ai
  - security
  - compliance
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Classify the system in context

A model name or provider tier is not a useful risk classification by itself. The same model can be a low-impact drafting aid in one workflow and a high-impact decision component when connected to production data, privileged tools, or automatic deployment. Classify the complete system: model, prompts, retrieval sources, tools, users, outputs, downstream decisions, and operating environment.

Use a local engineering classification to select controls, not to declare legal status or regulatory compliance. The NIST AI Risk Management Framework (AI RMF 1.0, 2023) describes a voluntary risk-management framework; NIST's framework page currently notes that RMF 1.0 is being revised. Check that notice and the framework version when adopting the process. This note does not interpret statutory definitions, thresholds, or obligations. Seek qualified legal and compliance advice when jurisdiction or regulated use matters.

For system-wide governance and ownership, connect this assessment to [[ai-impact-assessment-for-engineering-systems]]. Tool evaluation is a separate decision; see [[evaluating-ai-tools-for-a-platform-team]].

## Practical classification dimensions

Record evidence for each dimension and the uncertainty, rather than averaging to one reassuring number:

- **Impact:** What could happen if output is wrong, biased, unavailable, or misunderstood? Consider people, security, privacy, finances, safety, service reliability, and data integrity.
- **Autonomy:** Does the system only suggest, edit files, execute commands, change access, make decisions, or trigger external actions? Can a human meaningfully review before the effect?
- **Access and reach:** What repositories, data, credentials, APIs, networks, tenants, and environments can it reach? Is scope per-task or persistent?
- **Exposure:** Who uses it, who is affected, how often, and can output be redistributed or used downstream without context?
- **Data sensitivity:** Does it process source code, personal information, secrets, regulated data, customer content, or confidential internal material?
- **Reversibility:** Can an erroneous action be detected and undone? How long until the impact becomes visible?
- **Control quality:** Are boundaries independently enforced, logs useful, failure modes tested, and a responsible human identified?

A practical local scheme can use three qualitative bands—baseline, elevated, and critical—with written criteria and examples. Baseline might mean internal, non-sensitive, advisory use with no write permissions. Elevated might include sensitive code or bounded write access with required review. Critical might include privileged production operations, decisions affecting people, or actions that are difficult to reverse. These are engineering labels only; an organization should define its own thresholds, ownership, and escalation.

## Classification workflow

1. Define intended and prohibited uses, user groups, deployment context, and affected parties.
2. Draw the data and action flow from prompt to model, tools, storage, logs, and downstream systems.
3. Identify threats and plausible harms, including misuse, prompt injection, stale information, and provider or dependency changes.
4. Assign an owner and a provisional risk band using documented local criteria. Record uncertain assumptions rather than lowering the band by default.
5. Select controls: least privilege, human approval, sandboxing, data minimization, output validation, monitoring, incident response, and change management.
6. Test the controls under realistic failure cases and document evidence. Reassess when permissions, model/provider, data, audience, or task changes.

Classification should be a decision record with a review date or trigger. A self-assessment form is not a control if nobody can reject the launch or fund mitigation.

## Failure modes

Common failures include rating only the model, mistaking “human in the loop” for effective oversight, averaging away a severe impact, reusing a classification after capabilities change, and assuming that an internal system cannot affect external users. A nominal approval step is weak if the reviewer cannot inspect inputs, outputs, and consequences or is pressured to rubber-stamp.

If risk is uncertain, limit capability while evidence is gathered: use synthetic data, read-only access, a small pilot, or a human-controlled sandbox. Do not label a system “low risk” only because an assessment is incomplete. If a high-impact use lacks a viable human escalation, rollback, or monitoring path, defer deployment.

## Decision checklist

- Is the system boundary and intended use described, including downstream use?
- Are impact, autonomy, access, data, reach, reversibility, and control quality assessed?
- Are uncertainties and prohibited uses explicit?
- Is the classification based on local engineering criteria rather than an invented legal threshold?
- Are controls proportionate and independently enforceable?
- Is an accountable owner empowered to delay or stop deployment?
- Are change triggers defined for reassessment?

Use legal counsel for legal classifications and obligations; use engineering assessment to implement controls and produce evidence, not to make a compliance claim.

## Related

- [Owner’s AI skills catalogue](https://ai.szolotov.com).

## Sources

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework): AI RMF 1.0 (2023) overview; the page notes that the framework is being revised, so verify version and status before reuse.
- [NIST AI 600-1, Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): July 2024 generative-AI risk profile.
- [OWASP Top 10 for Agentic Applications for 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): agent-specific security risk categories; not a legal classification scheme.
