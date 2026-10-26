---
title: Impact assessment for AI-enabled engineering systems
description: Assess affected people, operational consequences, and control effectiveness before deploying or materially changing an AI-enabled system.
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

## Assessment is a lifecycle activity

An impact assessment helps an engineering organization identify plausible harms, affected groups, and control gaps before a system is deployed and as it changes. It is not a one-time questionnaire, a substitute for threat modeling, or proof of legal compliance. The appropriate scope depends on what the system does, who may be affected, what data and decisions it touches, and the consequences of failure.

Use a multidisciplinary process involving engineering, security, privacy, operations, product, accessibility or domain specialists, and legal/compliance where appropriate. Include people who understand the affected workflow—not only the model or platform team. The assessment should result in decisions: proceed with controls, restrict use, gather evidence, or stop. Record dissent and uncertainty instead of converting them into a false consensus.

NIST's AI RMF 1.0 (2023) is a voluntary framework, and the NIST overview page currently notes that it is being revised. The NIST Generative AI Profile is AI 600-1, published July 2024. Cite versions and dates when using these references; do not describe them as legal requirements or assert compliance. See [[ai-system-risk-classification]] for a complementary engineering risk classification and [[ai-coding-assistant-admin-controls]] for related organizational controls.

## Assessment workflow

1. **Describe the system boundary.** Document model and provider, prompts, retrieval/data sources, tools, interfaces, users, downstream decisions, human handoffs, and operating environments. Include third-party services and logging.
2. **State purpose and limits.** Define intended uses, prohibited uses, user population, affected parties, and decisions the system must not make. Identify incentives that might encourage use beyond the intended scope.
3. **Map impacts.** Consider incorrect or uneven outputs, privacy and confidentiality, security abuse, service denial, accessibility, reputational and financial consequences, worker impacts, and downstream automation. Examine both direct effects and effects of users relying on output.
4. **Identify plausible failure paths.** Analyze data leakage, prompt injection, stale knowledge, model/provider changes, hallucinated instructions, permission misuse, silent failure, and automation bias. Include misuse and failure in ordinary operation, not only adversarial scenarios.
5. **Evaluate affected groups and recourse.** Determine who bears risk and who receives benefits. Where outputs influence people, identify how errors are noticed, contested, corrected, and escalated, and whether affected users can reach a responsible human.
6. **Select and test controls.** Assign least privilege, data minimization, human approval, validation, monitoring, rate limits, audit evidence, rollback, and incident response. Test control behavior under realistic failure cases; document limitations and residual risk.
7. **Make a governed decision.** Name the accountable owner and approvers, decision, deployment scope, conditions, review date, and stop criteria. Do not launch while a material impact is unowned or a critical control is merely planned.
8. **Reassess.** Repeat when purpose, users, data, autonomy, model, provider, integrations, scale, or operational environment changes, and after incidents or monitoring signals.

Keep the assessment proportionate and actionable. A low-impact internal summarizer can use a short review if it has no sensitive data and no authority to act. A system that changes access, executes code, influences high-consequence decisions, or handles sensitive data warrants deeper analysis, independent review, and tested rollback. “Human review” counts only when the reviewer has time, context, authority, and a usable way to reject the output.

## Failure modes and response

Assessment can fail by treating a template as evidence, considering only intended use, omitting downstream reuse, overlooking unequal impacts, or assigning mitigations without owners or deadlines. A risk matrix can hide severe low-likelihood outcomes through arithmetic. A model evaluation on curated prompts cannot establish the safety of the full deployed system.

Use scenarios and control evidence instead of relying only on a single score. If the system's behavior or data flow is not understood, restrict access and gather evidence before expansion. If monitoring indicates unexpected impact, pause the affected capability when safe, preserve relevant records, notify the owner, and follow incident and user-remediation procedures.

## Decision checklist

- Are system boundaries, intended/prohibited uses, and affected groups documented?
- Have technical, operational, privacy, security, accessibility, and downstream impacts been considered?
- Are meaningful human oversight, recourse, and escalation defined where relevant?
- Are mitigations testable, independently enforced, owned, and funded?
- Is residual risk explicitly accepted by an accountable owner?
- Are stop conditions, monitoring, and reassessment triggers in place?
- Are NIST or other frameworks referenced by precise version/date without implying legal compliance?

Legal classification and obligations require qualified advice for the relevant jurisdiction and facts. The engineering assessment supplies evidence and implements controls; it does not make a legal determination.

## Related

- [Owner’s AI skills catalogue](https://ai.szolotov.com).

## Sources

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework): AI RMF 1.0 overview and current revision notice; the framework is voluntary guidance.
- [NIST AI 600-1, Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): generative-AI profile, July 2024.
- [OWASP Top 10 for Agentic Applications for 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): agentic application security risks; not a complete impact or legal assessment.
