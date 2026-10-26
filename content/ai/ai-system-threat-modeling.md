---
title: Threat modeling AI-enabled systems
description: A repeatable way to map AI system assets, trust boundaries, abuse cases, controls, and residual risks before deployment.
type: guide
tags:
  - ai
  - security
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

Threat modeling an AI feature is not a special substitute for application threat modeling. It extends the usual inventory of data, identities, interfaces, and impacts to include model behavior, retrieval, tools, and the uncertain boundary between instructions and content. Use this guide before a design is approved and revisit it after a provider, model, tool, or data-flow change. It complements [[ai/securing-ai-agents-in-ci-and-cloud]], which focuses on operational controls for agents that can reach repositories or cloud resources.

The owner’s [AI skills catalogue](https://ai.szolotov.com) provides reusable skills and workflows.

## Start with the system and its intended use

Write down the user outcome the system is meant to produce, who is allowed to use it, and which decisions remain human-owned. Draw every path from user input through preprocessing, model endpoint, context sources, tools, persistent state, and output consumers. Include administrative paths, telemetry, retries, backups, and support access; these often cross boundaries that the main request diagram omits. Distinguish an assistant that drafts text from one that can send messages, alter records, deploy code, or spend money. Similar-looking chat interfaces can have very different impact because of their authority.

Record model/provider, deployment region, modalities, tools, and data classifications with named owners. Mark provider or service-plan details for deployment-time confirmation. NIST’s AI RMF 1.0 is being revised; name its version and date rather than calling it an unrevised current final standard.

## Identify assets and trust boundaries

List what could be harmed: confidential content, credentials, business records, availability, output integrity, users relying on advice, and contractual commitments. For each asset identify its owner, permitted use, retention, and impact if exposed, altered, deleted, or unavailable. Weights and embeddings may be sensitive; derived data is not automatically harmless.

Mark a boundary wherever content or authority changes hands: a browser page entering context, a vector store returning chunks, an identity provider issuing a token, a tool server returning results, an administrator changing a policy, or a model output entering an automated workflow. Within each boundary, label information by provenance and trust. User-controlled instructions, retrieved content, model-produced text, and policy-controlled configuration must not be treated as interchangeable. The central question is not whether the model “knows” which text is hostile; it is what the system permits if it follows it.

## Describe abuse cases and consequences

Use repeatable questions: What can an untrusted user influence or the model read? Which tool actions are irreversible or visible? How could data leave the approved path? What happens when a dependency is unavailable? Consider confidentiality, integrity, availability, safety, privacy, misuse, confused-deputy cases, and resource exhaustion—not only prompt injection.

Use NIST AI RMF’s Govern, Map, Measure, and Manage functions to assign owners and turn risks into actions. The Generative AI Profile, NIST AI 600-1, supplies additional GenAI risk considerations. OWASP’s LLM and Agentic Top 10 are useful issue catalogs, not a complete threat model or a compliance checklist. MITRE ATLAS can help teams name observed adversary tactics and organize defensive tests; map a technique only when it fits the actual system. Do not claim that a catalog entry proves an exploit exists in your deployment.

## Select controls by failure consequence

Prefer controls that remain effective when the model misunderstands or is manipulated. Keep credentials out of prompts and model-visible context. Enforce authorization in the application or tool service, using the authenticated principal and requested object rather than trusting generated arguments. Split read and write tools, validate inputs against a narrow schema, and require explicit confirmation for high-impact actions. Put hard ceilings around time, tokens, tool calls, concurrency, and monetary spend. Apply network, workload, and storage boundaries outside the model process.

For untrusted retrieved content, preserve source identity and treat it as data, not policy. Do not rely on an instruction such as “ignore malicious text” as the only mitigation. Test the controls at the integration boundary: observe whether an unexpected tool call is blocked, whether a sensitive field is withheld, and whether repeated failures stop. A successful test should show the enforcement point and its audit event, not merely a safe-looking model response.

## Record residual risk and operational ownership

For each scenario, record likelihood rationale, impact, existing control, evidence, residual risk, owner, and a review trigger. Avoid false precision: a risk score is a prioritization aid, not a measurement of model reliability. State assumptions such as provider data handling, identity propagation, and user review, and link each to a current contract, configuration, or test. A vendor’s safety statement does not replace verification of your own permissions and data path.

Define triggers for reassessment: new tools, new data sources, increased autonomy, a model or provider change, public access, a change in retention, or a new downstream action. Incident responders need access to the threat model, tool allowlist, policy version, and dependency inventory. Evidence preservation and response boundaries are expanded in [[ai/ai-agent-security-incident-evidence]] and the general response guidance in [[ai/ai-assisted-incident-response]].

## Review checklist

- Is the intended use and prohibited use explicit, with a named risk owner?
- Are all input sources, tools, identity systems, stores, logs, and output consumers drawn?
- Are trust boundaries and data classifications visible, including multimodal content?
- Does each high-impact scenario name a prevention or detection control outside model instructions?
- Can the system deny a tool action without depending on the model to self-police?
- Are limits for calls, retries, concurrency, duration, and spend enforceable?
- Are model/provider assumptions dated, and are known unknowns marked for confirmation?
- Is there a reassessment trigger and an incident evidence plan?

## Sources

- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework): AI RMF 1.0 overview and revision status; version language should reflect the page checked on 2026-10-26.
- [NIST AI 600-1, Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): NIST’s generative AI risk-management profile.
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): agent-specific risk catalog.
- [MITRE ATLAS](https://atlas.mitre.org/): AI-system adversary tactics and techniques.
