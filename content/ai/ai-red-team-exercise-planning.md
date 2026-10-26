---
title: Planning defensive AI red-team exercises
description: Scope authorized AI security exercises around realistic assets, controlled test cases, safety limits, and measurable defensive outcomes.
type: guide
tags:
  - ai
  - security
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

A defensive AI red-team exercise tests whether an organization’s safeguards prevent, detect, and contain failures in a system it owns or is explicitly authorized to assess. It is not a license to probe public services, attack third parties, or collect real credentials. The goal is to find control gaps safely and create actionable fixes. This planning guide complements the repeatable CI prompt-injection harness in [[ai/prompt-injection-test-harness-for-ci-agents]] by covering governance, scope, and exercise design.

## Set authorization and boundaries first

Name the system owner, exercise lead, security contact, and approving authority. Document the assets, environments, identities, accounts, dates, allowed techniques, rate limits, and test data. Explicitly exclude systems and third-party services outside the authorization. Identify prohibited actions such as real data exfiltration, production destructive changes, uncontrolled model training, social engineering, and public disclosure during the exercise. Define stop conditions and an emergency contact who can halt testing immediately.

Prefer a staging environment with synthetic data and equivalent policy configuration. If production testing is necessary, use a narrowly approved low-impact plan with monitoring and a rollback path. Do not perform open-ended testing against a provider’s public model endpoint unless the provider’s terms and scope authorize it. When test behavior depends on an external provider, use documented testing programs or a controlled proxy and synthetic account where feasible.

## Select risk-based objectives

Begin with the system threat model: data, identities, tools, retrieval sources, execution surfaces, and consequences. Select a small number of objectives tied to important controls, such as whether untrusted document content can trigger an unauthorized action, whether access checks follow the user into a tool call, or whether repeated failures stay within resource budgets. Avoid optimizing for a dramatic prompt or a single model response. The relevant outcome is control behavior and impact, not whether a tester can produce an entertaining output.

Use NIST AI RMF and the Generative AI Profile to organize governance, context, measurement, and response questions. OWASP’s LLM and Agentic Top 10 provide risk categories; MITRE ATLAS offers a knowledge base of AI-related adversary tactics and techniques. Use them as planning references, not as a complete coverage checklist or proof of compliance. Record the framework version or page date because catalogs evolve.

## Design safe test cases

Build test cases around boundaries: user prompt, retrieved document, tool description, API response, browser page, image/audio input, package install, output consumer, and resource limits. Use benign, synthetic content that attempts to elicit a clearly forbidden but harmless behavior, and define the expected enforcement point. Avoid including operational exploit instructions, real secrets, real third-party targets, or steps that could be reused to compromise a system.

Each test should state preconditions, input source, expected control, observable evidence, pass/fail rule, and cleanup. A blocked tool call is stronger evidence than a model saying it will not call a tool. Verify authorization denials in service logs, egress decisions at the proxy, and budget enforcement in the scheduler. Include positive controls to prove that the test harness can detect the expected event and negative controls to reveal false alarms.

## Run with containment and monitoring

Use isolated accounts, short-lived credentials, restricted egress, synthetic records, and a bounded test duration. Notify the operators responsible for the system and monitoring so normal alarms are not mistaken for an incident. Keep test artifacts in a restricted location and label them as exercise material. Capture only the minimum content needed to reproduce the control result; do not dump secrets or unrelated user data into the report.

Have a live stop mechanism. Stop on unexpected access to real data, unexplained external traffic, system instability, uncontrolled spend, or any action outside scope. Exercise leads must have authority to halt testing; testers should not continue because a test is “almost complete.” Preserve the exact configuration and test fixture versions so results can be interpreted later.

## Report, remediate, and retest

Report findings with affected asset, preconditions, observed control gap, safe impact statement, evidence, severity rationale, owner, remediation, and retest date. Avoid exaggerated claims based on model output alone. Separate confirmed behavior from hypotheses, and distinguish a model weakness from an application control failure. Share sensitive details only with the teams that need them.

Track fixes to closure and retest the failed boundary. Add safe regression fixtures to the CI or staging evaluation suite, but do not store dangerous payloads or credentials. Ensure remediation does not break legitimate use, and review for new failure modes introduced by the change. Record lessons in the threat model and exercise plan; preserve a clear audit trail without using the report as a public vulnerability disclosure unless a separate coordinated disclosure process applies.

## Review checklist

- Is the target explicitly authorized, bounded by owner and time, and isolated where possible?
- Are third-party systems and prohibited actions clearly excluded?
- Does each test map to an asset, risk, control, and observable pass/fail criterion?
- Are fixtures synthetic, non-operational, and safe to retain?
- Are containment, monitoring, stop conditions, and rollback ready?
- Does evidence demonstrate enforcement rather than a model’s verbal response?
- Are findings assigned to owners with retest and regression plans?
- Are framework/catalog versions and residual uncertainties recorded?

## Sources

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework): AI RMF 1.0 risk-management functions and revision status.
- [NIST AI 600-1, Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): GenAI-specific risks and risk-management practices.
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): risk categories for agentic systems.
- [MITRE ATLAS](https://atlas.mitre.org/): AI-system tactics and techniques for organizing defensive exercises.
- [Owner’s AI skills catalogue](https://ai.szolotov.com): reusable AI skills and workflows.
