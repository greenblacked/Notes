---
title: Risk assessment for open-weight models
description: Assess open-weight model artifacts, licensing, behavior, hosting, and operations without treating openness as proof of safety or provenance.
type: guide
tags:
  - ai
  - security
  - supply-chain
created: 2026-10-26
modified: 2026-10-26
draft: false
---

An open-weight model makes some parameters available for download or use, but the exact permissions, transparency, reproducibility, training data, and deployment obligations differ by publisher and license. “Open weight” does not automatically mean open source, independently reproducible, safe, private, or free of restrictions. A team taking custody of weights also takes responsibility for artifact verification, runtime hardening, updates, and incident response. This assessment pairs with [[ai/model-supply-chain-verification]], which focuses on identity and integrity.

Existing controls for storing and pinning model artifacts are described in [[ai/model-artifacts-in-artifactory]] and [[ai/model-version-pinning-and-upgrade-evals]].

## Establish what “open” means for this model

Inspect the exact license attached to the specific artifact revision and confirm whether it permits the intended commercial, geographic, redistribution, modification, and user population. Some terms may impose use restrictions or additional obligations. Do not infer legal rights from the repository label or a general project page. Record the version, publisher, license text, model card, and any separate terms for associated code, tokenizer, adapters, or datasets. Have legal or procurement owners resolve ambiguity rather than making a legal conclusion from a summary.

Determine what is actually available: weights, model architecture, tokenizer, configuration, training details, datasets, evaluation reports, and conversion tools. A model card may describe intended uses, limitations, training parameters, and evaluation results, but content is provided by the publisher and can be incomplete. Treat claims as inputs to due diligence. Ask what cannot be independently reproduced or verified, and document the residual uncertainty.

## Evaluate security and operational custody

Verify the model artifact using the workflow in [[ai/model-supply-chain-verification]]. Download into quarantine, validate digests and source identity, inspect required custom code, pin immutable versions, and promote only approved artifacts. Do not enable remote custom model code simply because a README instructs it. Keep the inference image, runtime, tokenizer, and dependencies inventoried as well as the weights.

Self-hosting changes the data boundary. The organization may control inference hardware and request logs, but must also secure the model-serving endpoint, accelerators, storage, caches, telemetry, backups, and access control. Verify who can retrieve weights and who can query the service. Limit model access to approved networks; models do not automatically protect confidential training or prompt data. Document retention, deletion, abuse monitoring, and isolation between tenants. Provider or framework-specific behavior should be confirmed against current documentation and actual deployment settings.

## Measure suitability and harms

Evaluate the selected model on representative tasks, languages, data formats, and failure modes, including refusal, calibration, hallucination, privacy, bias, and misuse relevant to the intended context. Test with safe, non-operational fixtures and known-answer cases. Compare performance and risk to an approved baseline. A benchmark score is not a security guarantee, and fine-tuning may change behavior or introduce new data exposure. Reevaluate after quantization, adapter changes, tokenizer changes, inference engine upgrades, or prompt-template changes.

Decide whether model outputs can affect users, eligibility, health, finances, employment, infrastructure, or other consequential domains. Set a human-review threshold and a non-AI fallback. Ensure users can identify where model-generated output is advisory and provide a correction path. Assess the model’s limitations and potential impacts using a risk-management process such as NIST AI RMF 1.0 and its GenAI Profile, while accurately noting that NIST says RMF 1.0 is under revision as of 2026-10-26.

## Compare with hosted service trade-offs

Self-hosting can improve control over deployment location and configuration, but it does not automatically lower total cost, improve privacy, or simplify compliance. Account for accelerator availability, patching, capacity planning, incident response, model updates, evaluation, and support. A managed provider may offer contractual and operational features unavailable in a local deployment; verify the chosen plan and region rather than generalizing from vendor documentation. A mixed design can still send sensitive prompts to a hosted endpoint, so map each data path separately.

## Decide and record residual risk

Use a documented decision record that names the intended use, artifact revision, license owner, technical owner, deployment owner, data classes, evaluation results, required controls, residual risks, and review date. Define triggers for reassessment: new version, license change, new fine-tune, new user population, new use case, incident, vulnerability, or provider policy change. Reject deployment if provenance is insufficient, license terms are unresolved, required isolation is unavailable, or the team cannot maintain the runtime.

For a suspected vulnerability or behavioral incident, preserve model digests, runtime version, configuration, input/output samples under restricted access, evaluation evidence, and deployment records. Assess whether rollback is safer than an untested replacement. Do not download a “fixed” revision directly into production without verification and evaluation.

## Review checklist

- Is the exact license reviewed for the intended use and distribution?
- Are publisher claims distinguished from independently supported evidence?
- Are weights, tokenizer, custom code, runtime, and dependencies versioned?
- Is artifact identity verified and deployment pinned immutably?
- Is the serving boundary, logging, retention, and tenant isolation understood?
- Are task-specific safety and quality evaluations documented?
- Are costs, operations, update ownership, and fallback plans realistic?
- Are review triggers and incident rollback evidence defined?

## Sources

- [Hugging Face Hub model cards](https://huggingface.co/docs/hub/en/model-cards): documented purpose, limitations, training, and evaluation fields for model cards.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework): AI RMF 1.0 context and current revision notice, checked 2026-10-26.
- [NIST AI 600-1, Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): GenAI risk-management guidance.
- [SLSA specification v1.1](https://slsa.dev/spec/v1.1/): provenance concepts for artifact supply chains.
- [Owner’s AI skills catalogue](https://ai.szolotov.com): reusable AI skills and workflows.
