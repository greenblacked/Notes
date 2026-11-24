---
title: Control mapping for AI services - EU AI Act, SOC 2 and ISO 27001
description: Map model gateways and agents to platform controls with stable IDs, the SOC 2 and ISO 27001 areas they evidence, and the EU AI Act dates and duties that apply to them.
type: guide
tags:
  - compliance
  - ai
  - audit
created: 2026-11-24
modified: 2026-11-24
draft: false
aliases:
  - EU AI Act
---

A model gateway and a set of agents are new systems inside the same audit scope as the rest of the platform. Most of what an auditor asks about them is ordinary: access, change, logging, suppliers. A few duties are new and come from the EU AI Act. This note adds `PLT-AI-*` controls to the set in [[common-control-framework-for-platform-teams]] and maps each to evidence the platform already produces.

> [!warning] Not legal or audit advice
> These notes are general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation, and who is a provider or deployer under the AI Act.

> [!info] Scope and verification
> AI Act dates were checked on 2026-11-24 against the European Commission's AI Act page and the EUR-Lex record of Regulation (EU) 2026/1744 (see Sources). The articles' own text, ISO/IEC 42001 and the SOC 2 and ISO 27001 references in the table were not checked; the table marks them "(check)" as the common control framework does.

## EU AI Act: what applies when

- The AI Act, Regulation (EU) 2024/1689, entered into force on 1 August 2024. It became generally applicable on 2 August 2026, with exceptions.
- The Digital Omnibus on AI, Regulation (EU) 2026/1744 dated 8 July 2026, entered into force on 27 July 2026 and moved the high-risk dates.

| From            | What applies                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------- |
| 2 February 2025 | Prohibited practices; AI literacy                                                             |
| 2 August 2025   | Governance; general-purpose AI model obligations                                              |
| 2 August 2026   | General application, including the transparency rules                                         |
| December 2026   | The added prohibition on non-consensual sexual content and CSAM (by the AI Omnibus)           |
| 2 December 2027 | High-risk systems in Annex III use cases (for example employment, education, law enforcement) |
| 2 August 2028   | High-risk systems embedded in products (Annex I)                                              |

Commentary on the Omnibus reports that the AI literacy duty was reworded, and that content-marking for generative systems already on the market before 2 August 2026 has until 2 December 2026. Confirm both against the consolidated text before relying on them.

## Where a platform team usually sits

- The Commission describes four risk levels: unacceptable (banned), high, transparency, and minimal.
- Internal engineering uses (coding agents, incident assistants, log triage) are usually minimal risk.
- A user-facing chatbot carries transparency duties: tell people they are talking to AI.
- An AI system used in an Annex III area, such as hiring, makes the organisation a deployer, or a provider, of a high-risk system. That is a legal question.
- Classify with [[ai-system-risk-classification]] and [[ai-impact-assessment-for-engineering-systems]], and record the legal decision with counsel.

## Platform controls for AI services

| ID        | Control                                                                        | Owner               | Main evidence source                                                                                      | ISO 27001:2022 (check) | SOC 2 family (check)        | EU AI Act touchpoint (check)                |
| --------- | ------------------------------------------------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------- | ------------------------------------------- |
| PLT-AI-01 | Every model and agent in use has an owner and a risk class                     | platform-lead       | Model inventory export ([[model-inventory-and-owner-registration]])                                       | 5.9                    | Risk assessment             | Risk classification; high-risk scoping      |
| PLT-AI-02 | Model providers are reviewed before use and yearly                             | security-lead       | Due diligence records ([[model-provider-due-diligence]])                                                  | 5.19, 5.20, 5.23       | Vendor management           | Provider and deployer roles                 |
| PLT-AI-03 | Only approved services call models, through the gateway, with per-service keys | platform-lead       | Gateway config in Git, key inventory ([[ai-gateway-architecture-and-policy]])                             | 5.15, 8.2              | Logical and physical access | -                                           |
| PLT-AI-04 | Agents hold least-privilege, time-bound credentials                            | platform-lead       | Tool allowlists, JIT grants ([[agent-tool-authorization-boundaries]], [[just-in-time-agent-credentials]]) | 5.15, 8.2              | Logical and physical access | Human oversight                             |
| PLT-AI-05 | Model, prompt and policy changes pass release gates                            | engineering-manager | Eval results and MR approvals ([[llm-change-management-and-release-gates]])                               | 8.32                   | Change management           | Accuracy and robustness (high-risk only)    |
| PLT-AI-06 | Prompts and responses are logged with redaction and set retention              | platform-lead       | Trace config, retention settings ([[llm-tracing-with-sensitive-data-controls]])                           | 8.15, 8.16             | System operations           | Logging (high-risk only)                    |
| PLT-AI-07 | Agent actions with impact need human approval                                  | engineering-manager | Approval records ([[human-approval-state-machine]])                                                       | -                      | Change management           | Human oversight                             |
| PLT-AI-08 | Users are told when they interact with AI or see AI content                    | product-owner       | UI copy review, release checklist                                                                         | -                      | -                           | Transparency (Article 50)                   |
| PLT-AI-09 | AI incidents are handled and reviewed                                          | sre-lead            | Incident records ([[postmortems-for-ai-involved-incidents]], [[ai-agent-security-incident-evidence]])     | -                      | System operations           | Serious incident reporting (high-risk only) |
| PLT-AI-10 | Staff who use or run AI systems are trained                                    | engineering-manager | Training records                                                                                          | 6.3                    | Control environment         | AI literacy (Article 4)                     |
| PLT-AI-11 | AI state is restored on a schedule                                             | sre-lead            | Restore drill records ([[backup-and-dr-for-ai-state]])                                                    | 8.13                   | -                           | -                                           |

## Evidence the gateway and agents already produce

- The gateway config and key inventory in Git (PLT-AI-03).
- Per-request traces with model ID and version (PLT-AI-05 and PLT-AI-06, [[llm-observability-tracing-and-slos]]).
- Approval state transitions (PLT-AI-07).
- Eval reports attached to release MRs (PLT-AI-05).

Collect them once, per [[audit-evidence-collection-and-retention]].

## ISO/IEC 42001

- ISO/IEC 42001 is the management-system standard for AI.
- If the organisation certifies against it, the `PLT-AI-*` controls supply operational evidence, but the management system itself (policy, objectives, impact assessment process) sits above the platform.
- Clause mapping is not given here, because the standard was not read.

## Pitfalls

- Treating the AI Act as a platform problem. Roles and classification are legal decisions.
- Logging everything to satisfy "logging", which then violates data minimisation ([[pci-dss-and-gdpr-for-devops-logs-and-data]]).
- An inventory that misses agents running in CI.
- Using dates from memory. The Omnibus moved them once already.

## Not verified

- The AI Act article text (Articles 4, 50 and 113, and Annex III wording). The EUR-Lex fetch returned no article text.
- The amended article text of Regulation (EU) 2026/1744.
- The secondary-source claims on Article 4 and the 2 December 2026 marking deadline.
- ISO/IEC 42001 (page unreachable).
- All ISO 27001:2022 Annex A numbers and SOC 2 family names in the table.
- Which obligations apply to deployers as opposed to providers.

## Related

- [[common-control-framework-for-platform-teams]]
- [[soc2-for-ci-cd-controls]]
- [[iso-27001-annex-a-for-platform-teams]]
- [[nis2-basics-for-engineering-teams]]
- [[dora-eu-operational-resilience-for-engineers]]
- [[model-region-selection-and-data-residency]]

## Sources

- [European Commission, AI Act](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai): entry into force, application dates, the Omnibus changes and the risk levels, read 2026-11-24.
- [EUR-Lex, Regulation (EU) 2026/1744](https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng): title, date 8 July 2026 and entry into force 27 July 2026, read 2026-11-24.
- [EUR-Lex, Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng): the Act itself. The page was reached on 2026-11-24 but its text was not read; see Not verified.
