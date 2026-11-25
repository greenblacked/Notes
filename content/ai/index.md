---
title: AI in DevOps
description: "Using AI agents and assistants in delivery and operations safely: access, review, provenance, incidents and rollout."
tags:
  - ai
  - meta
created: 2026-10-17
modified: 2026-11-25
draft: false
---

These notes cover using AI agents and assistants in delivery and operations without giving up control: what they may access, how their output is reviewed, how it is traced and how a team adopts them.

## Start here

New to AI? Take [[learn/index#AI practice track|the five-lesson AI practice track]]: fundamentals, evidence-based troubleshooting, a dependency-free retrieval lab, evaluation and an incident-assistant capstone. Each lesson has prerequisites, exercises, failure checks and pass criteria.

Then read these four, in order: [[effective-prompting-for-operations-work|prompting for operations work]], [[securing-ai-agents-in-ci-and-cloud|securing agents with repository or cloud access]], [[ai-generated-code-policy-and-provenance|the policy for AI-generated code]] and [[ai-system-threat-modeling|threat modeling AI-enabled systems]]. The sections below follow the same path: adopt, run safely, review, operate, then design, secure, evaluate and run the platform.

## Adopting AI in a team

How a team chooses, rolls out, measures and governs day-to-day use of assistants and coding agents.

- [[rolling-out-ai-tools-in-a-team|Rolling out AI coding tools in a DevOps team]]: an engineering manager's guide to piloting AI coding and review assistants with a baseline, outcome metrics, security review, cost tracking and a go or no-go decision.
- [[team-norms-for-ai-assisted-engineering|Team norms for AI-assisted engineering]]: author ownership, review disclosure, what never to paste, review load, junior learning and pairing.
- [[evaluating-ai-tools-for-a-platform-team|Evaluating AI tools for a platform team: security scorecard and bake-off on your own repos]]: screen tools on data and security, then compare them on real past changes with CI-measured outcomes.
- [[measuring-ai-impact-on-delivery|Measuring AI impact on delivery without fooling yourself]]: cohorts, a fixed baseline and counter-metrics around the DORA keys, instead of vanity figures.
- [[ai-generated-code-policy-and-provenance|Policy for AI-generated code - review, provenance and audit trail]]: a team policy for code written with AI assistants covering ownership, review rules, optional provenance records, licence questions and evidence for auditors.
- [[tooling-attribution-in-git-history|Tooling attribution in git history]]: decide whether commits, PRs and branch names may name the tool used, enforce it in CI and keep provenance elsewhere.
- [[ai-coding-assistant-admin-controls|Admin controls for AI coding assistants: seats, data, telemetry and deny rules]]: the settings an admin controls on coding assistants and how to verify each one.
- [[agent-skills-and-shared-workflows|Agent skills and shared workflows for platform teams]]: treat agent instructions, skills and prompt files as versioned platform assets with review, pinned consumption, least-privilege tool lists and tests.
- [[effective-prompting-for-operations-work|Effective prompting for operations work]]: raw evidence, stated versions, ranked hypotheses, verification commands and fixed output formats.
- [[local-models-on-engineer-workstations|Local models on engineer workstations]]: baseline for running open-weight models locally, covering approved sources and licences, scanning, data classes, encryption, loopback binding, resource limits, updates and when local is the wrong answer.

## Running coding agents safely

Where agents run, what they may reach and how their access is scoped, logged and fenced.

- [[securing-ai-agents-in-ci-and-cloud|Securing AI agents that have repository or cloud access]]: rules for running coding and operations agents in CI or with cloud credentials, covering tokens, triggers, isolation, egress, human gates and data handling.
- [[sandboxing-coding-agents-on-workstations-and-runners|Sandboxing coding agents on workstations and runners: containers, credentials and egress]]: run agents where they reach only the repository, short-lived scoped credentials and an egress allowlist.
- [[coding-agent-permission-allowlists|Coding agent permission allowlists]]: per-repository and per-user allow, ask and deny rules for shell, file, network and MCP use, reviewed and audited.
- [[coding-agent-branch-and-worktree-isolation|Branch and worktree isolation for coding agents]]: separate concurrent agent changes and limit their credentials while preserving normal review and integration controls.
- [[deterministic-hooks-for-coding-agents|Deterministic hooks for coding agents]]: harness tool hooks and git hooks that enforce must-hold rules, fail closed and are proven to fire.
- [[gcp-iam-guardrails-for-agent-service-accounts|GCP IAM guardrails for AI agent service accounts]]: one service account per task, IAM conditions, deny policies, short-lived impersonation and outer fences for agents in Google Cloud.
- [[kubernetes-rbac-for-ai-agents|Kubernetes RBAC for AI agents: read-only troubleshooting without secrets]]: a dedicated identity and hand-written read-only role with no secrets, exec or escalation verbs, short-lived tokens and tests that prove it.
- [[internal-mcp-servers-for-platform-tools|Building internal MCP servers for platform tools: scope, auth, deployment and audit]]: narrow, typed, read-mostly tools with server-side limits, audience-checked tokens and a per-call audit log.
- [[third-party-mcp-server-vetting|Third-party MCP server vetting]]: provenance, version pinning, tool description review, scoped credentials, allowlists and re-review on update.
- [[scheduled-autonomous-agent-jobs|Scheduled autonomous agent jobs]]: agents on cron, CI schedules or webhooks with scoped identities, idempotent proposals, run budgets, a kill switch and alerts on silence.
- [[chatops-ai-assistants-in-slack|ChatOps AI assistants in Slack]]: verified requests, scoped channels, per-user authorization, bound approvals, audit and rate limits.
- [[agent-session-transcript-handling|Agent session transcript handling]]: transcripts as sensitive data, covering secrets in tool output, retention, redaction before sharing and a separate audit record.

## Agentic engineering workflows

Run coding agents as an engineered workflow: plans, model tiers, parallel work, independent review and evidence of done.

- [[plan-first-agent-workflows|Plan-first agent workflows]]: a reviewed, versioned plan before an agent edits files, with approval gates and scripted plan-drift checks.
- [[tiered-model-agent-workflows|Tiered model agent workflows]]: route agent subtasks to cheap, mid or strongest model tiers by risk and verifiability, with escalation caps and handoff discipline.
- [[parallel-agent-fan-out-and-result-merging|Parallel agent fan-out and result merging]]: one worktree and branch per subtask, sequential merges behind gates, and caps on concurrency, cost and attempts.
- [[independent-review-agents|Independent review agents]]: a separate reviewer with fresh context, narrow scope and adversarial framing, backed by deterministic gates and a capped fix loop.
- [[agent-done-criteria-and-verification|Agent done criteria and verification]]: done as checkable commands, evidence and a "not verified" section in every agent report, gated in CI.
- [[repository-context-packaging-for-coding-agents|Packaging repository context for coding agents]]: provide the minimum authoritative, current repository context an agent needs while clearly separating instructions from untrusted data.
- [[agent-pull-request-size-and-reviewability|Pull request size and reviewability for agent changes]]: bound agent-authored pull requests so reviewers can understand intent, validate evidence, and reject unsafe scope expansion.
- [[ai-code-refactoring-scope-and-rollback|Scope and rollback for AI-assisted refactoring]]: keep AI-assisted refactors behavior-preserving, reviewable, and reversible through explicit boundaries and validation.
- [[ai-docs-drift-and-verification|Preventing documentation drift in AI-assisted changes]]: tie generated documentation to authoritative code and verify examples and operational claims with repeatable checks.

## Reviewing AI-generated changes

Deterministic checks and review practice for code, infrastructure, SQL, shell and upgrades an assistant produced.

- [[validating-ai-generated-infrastructure-code|Validating AI-generated Terraform, Helm, Kubernetes and PromQL before review]]: a deterministic ladder of offline and live checks that catches invented arguments, removed APIs and queries that match nothing.
- [[llm-assisted-terraform-plan-review|LLM-assisted Terraform plan review: what the model checks and what it must not decide]]: an advisory model review of redacted plan JSON after deterministic gates, with a human approving every apply.
- [[ai-code-review-bots|AI code review bots in GitLab and GitHub]]: run AI review on merge requests as an advisory reviewer that comments only, with deterministic gates kept, triage, usefulness metrics and data handling.
- [[ai-assisted-test-generation-quality-gates|Quality gates for AI-assisted test generation]]: a reviewable workflow for turning generated tests into useful evidence without treating coverage as correctness.
- [[validating-generated-sql-before-execution|Validating generated SQL before execution]]: treat model-produced SQL as untrusted code and validate its intent, scope, and effects before any database accepts it.
- [[safe-shell-command-generation-for-agents|Safe shell command generation for agents]]: review generated shell commands as executable code and enforce limits outside the model before running them.
- [[ai-assisted-database-migration-review|AI-assisted database migration review]]: review generated schema migrations for correctness, deployment safety, data preservation, and a tested recovery path.
- [[dependency-hallucination-controls|Controls for hallucinated dependencies]]: verify every AI-suggested package against authoritative registries and project policy before adding or importing it.
- [[generated-api-client-code-review|Reviewing generated API client code]]: validate generated clients against their source contract and runtime behavior instead of treating generation as a correctness guarantee.
- [[agent-assisted-dependency-upgrades|Agent-assisted dependency upgrades]]: an agent fixes breaking Renovate or Dependabot upgrades on the bot branch, with CI, supply-chain checks and no auto-merged majors.
- [[ai-assisted-kubernetes-api-deprecation-upgrades|AI-assisted Kubernetes API deprecation upgrades]]: deterministic detectors first, constrained agent fixes, target-version validation and staged rollout.
- [[ai-assisted-jenkins-to-gitlab-pipeline-conversion|AI-assisted Jenkins to GitLab pipeline conversion]]: inventory, a reviewed mapping table, lint gates, credential mapping and parity checks.

## AI in operations and incidents

Use assistants during on-call, triage and incident work with read-only access and evidence-first answers.

- [[ai-assisted-incident-response|AI-assisted incident response, what to automate and what never to]]: how to use AI assistants during incidents and postmortems with read-only access, evidence-first prompts and a clear list of actions that always need a human.
- [[llm-log-analysis-and-alert-triage|LLM-assisted log analysis and alert triage without losing evidence]]: deterministic clustering, evidence-linked summaries and advisory alert triage that never silences.
- [[rag-over-runbooks-for-on-call|RAG over internal runbooks for on-call: access control, citations, staleness and evaluation]]: a retrieval assistant that enforces permissions, cites sources, flags stale pages and is gated on golden questions.
- [[ai-assisted-ci-failure-triage|AI-assisted CI failure triage]]: classify failed GitLab CI and Jenkins runs as infrastructure, flaky or real with cited evidence, owner routing and no auto-retry.
- [[ai-assisted-security-findings-triage|AI-assisted security findings triage]]: cluster and contextualise scanner findings and draft decisions, while humans own risk acceptance and nothing is auto-suppressed.
- [[ai-assisted-runbook-authoring-and-testing|AI-assisted runbook authoring and testing]]: evidence-grounded steps, lab-verified commands, destructive-step markers, freshness reviews and game days.
- [[llm-assisted-cloud-cost-anomaly-investigation|LLM-assisted cloud cost anomaly investigation]]: deterministic billing-export queries first, then a model that explains with cited evidence and never deletes.
- [[runaway-or-compromised-ai-agent-response|Runbook: stopping a runaway or compromised AI agent]]: stop the agent, contain its credentials, keep the evidence, assess the blast radius and recover.
- [[postmortems-for-ai-involved-incidents|Postmortems for AI-involved incidents]]: run blameless postmortems when an AI assistant or agent contributed, preserving evidence, fixing controls rather than prompts, and adding regression cases.

## Designing agents

Design agent instructions, context, tools, state and handoffs as explicit, testable contracts.

- [[context-engineering-for-agents|Context engineering for agents]]: assemble only the task-relevant instructions, evidence and tools an agent needs, while preserving provenance, freshness and access boundaries.
- [[system-instruction-lifecycle|System instruction lifecycle]]: govern system instructions as production policy through ownership, testing, release, rollback and retirement.
- [[prompt-templates-and-versioning|Prompt templates and versioning]]: design parameterized prompt templates with explicit data boundaries, compatible revisions and regression tests.
- [[structured-output-contracts|Structured output contracts]]: specify machine-consumable model responses as versioned contracts with explicit semantics, refusal handling and downstream validation.
- [[validating-model-generated-json|Validating model-generated JSON]]: parse and validate model JSON locally, handle refusal and truncation explicitly, and prevent malformed or untrusted data from reaching side effects.
- [[tool-calling-contracts-and-schemas|Tool-calling contracts and schemas]]: design typed tool interfaces whose server-side validation, authorization and bounded results remain safe even when model arguments are wrong.
- [[safe-agent-state-machines|Safe agent state machines]]: model an agent workflow as explicit states and guarded transitions so retries, failures and approvals cannot skip safety checks.
- [[bounded-agent-loops-and-stop-conditions|Bounded agent loops and stop conditions]]: limit agent iterations, tool calls, time and retries with explicit stopping rules that fail visibly rather than running indefinitely.
- [[agent-memory-retention-and-deletion|Agent memory retention and deletion]]: define what agent memory exists, its purpose, access and expiration, then make deletion and subject requests testable across replicas.
- [[context-window-budgeting|Context window budgeting]]: budget tokens for instructions, history, retrieval and output, with explicit truncation behavior and safe fallback when context does not fit.
- [[long-context-retrieval-strategy|Long-context retrieval strategy]]: combine permission-aware retrieval, source ranking and bounded evidence packing instead of treating a large context window as a search strategy.
- [[prompt-caching-and-data-isolation|Prompt caching and data isolation]]: use prompt-prefix caching only after understanding provider semantics, tenant boundaries, sensitive data exposure and cache lifecycle.
- [[model-router-policy|Model router policy]]: route requests among approved models using explicit capability, privacy, residency, reliability and cost rules with a safe fallback policy.
- [[multi-agent-handoff-boundaries|Multi-agent handoff boundaries]]: define what one agent may delegate, what context crosses a handoff, and how identity, authority and accountability persist.
- [[human-approval-state-machine|Human approval state machine]]: make human approval an authenticated, expiring decision over an exact action and evidence revision, not a generic prompt confirmation.
- [[choosing-prompting-rag-or-fine-tuning|Choosing prompting, RAG, tool use or fine-tuning]]: classify the failure, try the cheapest reversible lever first, and test the choice on a frozen eval set before committing.

## AI security

Threat-model AI applications and constrain identity, tools, execution, network access, data and model supply chains.

- [[ai-system-threat-modeling|Threat modeling AI-enabled systems]]: a repeatable way to map AI system assets, trust boundaries, abuse cases, controls, and residual risks before deployment.
- [[indirect-prompt-injection-in-documents|Indirect prompt injection in documents]]: keep instructions embedded in files, records, and retrieved text from gaining authority over an AI application.
- [[multimodal-prompt-injection|Multimodal prompt injection boundaries]]: defend vision, audio, and document workflows when untrusted media can influence model behavior or downstream tools.
- [[prompt-injection-test-harness-for-ci-agents|Testing CI agents against prompt injection, including tool and MCP inputs]]: a repeatable suite of planted instructions with canary secrets and fail-closed assertions on tool calls and egress.
- [[agent-tool-authorization-boundaries|Authorization boundaries for agent tools]]: enforce user-aware authorization at every agent tool call rather than treating model intent or tool metadata as permission.
- [[delegated-oauth-for-agent-tools|Delegated OAuth for agent tools]]: design user-delegated access for AI tools with explicit consent, narrow scopes, audience checks, and short-lived tokens.
- [[just-in-time-agent-credentials|Just-in-time credentials for AI agents]]: issue temporary, task-scoped credentials to agents and prevent renewal or privilege expansion from becoming a standing capability.
- [[agent-network-egress-controls|Network egress controls for AI agents]]: restrict and observe agent network access so prompt-driven activity cannot freely reach internal services or external destinations.
- [[browser-agent-isolation|Isolation boundaries for browser agents]]: separate browser-agent sessions, identities, profiles, and network reach so web content cannot inherit a human operator’s broad access.
- [[code-execution-agent-sandboxing|Sandboxing code execution by AI agents]]: run model-selected code with disposable isolation, bounded resources, controlled inputs, and no ambient credentials.
- [[ai-agent-package-installation-risks|Package installation risks in AI agent workflows]]: prevent package managers and generated dependency changes from turning agent execution into unreviewed code execution or supply-chain exposure.
- [[redacting-sensitive-data-before-llm-calls|Redacting sensitive data before LLM calls: secrets, personal data and a fail-closed filter]]: a shared, tested redaction layer in the gateway that blocks the call when it cannot be sure.
- [[llm-denial-of-service-and-resource-exhaustion|Denial of service and resource exhaustion in LLM systems]]: bound model, tool, retrieval, and infrastructure consumption to keep AI services available and costs predictable under hostile or accidental load.
- [[model-supply-chain-verification|Verifying AI model supply chains]]: establish model artifact identity, provenance, integrity, and controlled promotion instead of trusting a model name or download page.
- [[open-weight-model-risk-assessment|Risk assessment for open-weight models]]: assess open-weight model artifacts, licensing, behavior, hosting, and operations without treating openness as proof of safety or provenance.
- [[ai-red-team-exercise-planning|Planning defensive AI red-team exercises]]: scope authorized AI security exercises around realistic assets, controlled test cases, safety limits, and measurable defensive outcomes.
- [[ai-agent-security-incident-evidence|Evidence collection for AI agent security incidents]]: preserve enough AI workflow evidence to reconstruct decisions and actions while minimizing sensitive content and protecting chain of custody.
- [[output-guardrails-and-content-filtering|Output guardrails and content filtering]]: layer deterministic validators, classifiers and egress scanning with per-check fail-open or fail-closed policy, latency budgets, content-free logs and an adversarial test set.

## RAG and knowledge systems

Build retrieval pipelines with deliberate ingestion, ranking, access control, freshness and quality checks.

- [[document-ingestion-for-enterprise-rag|Document ingestion for enterprise RAG]]: build a governed ingestion path that turns changing enterprise documents into searchable, traceable retrieval units.
- [[llm-data-pipeline-quality-controls|LLM data pipeline quality controls]]: add observable, fail-safe validation from source ingestion through preprocessing and evaluation data publication for AI workloads.
- [[chunking-strategy-evaluation|Chunking strategy evaluation]]: select chunk boundaries by measuring answer evidence, retrieval recall, context cost and source fidelity on real documents.
- [[embedding-model-migration|Embedding model migration]]: migrate vector representations with explicit compatibility checks, parallel evaluation and a reversible index cutover.
- [[embedding-pipeline-idempotency-and-reprocessing|Embedding pipeline idempotency and reprocessing]]: make embedding generation and index updates restartable with stable identities, versioned transformations, and safe reprocessing boundaries.
- [[vector-index-capacity-and-lifecycle|Vector index capacity and lifecycle]]: plan vector-index growth, rebuilds, retention and retirement using measured workload and recoverability requirements.
- [[hybrid-search-for-rag|Hybrid search for RAG]]: combine lexical and semantic retrieval when their complementary strengths improve measured evidence recall.
- [[reranking-and-retrieval-depth|Reranking and retrieval depth]]: choose candidate depth and reranking stages by measuring evidence coverage, ranking quality, latency and context pressure.
- [[metadata-filtering-and-acl-aware-retrieval|Metadata filtering and ACL-aware retrieval]]: apply authoritative, current permissions before retrieved content reaches a model, including through hybrid and cached paths.
- [[citation-grounding-and-source-provenance|Citation grounding and source provenance]]: make every answer citation point to a versioned source span and distinguish retrieval evidence from generated claims.
- [[graph-rag-use-cases-and-limits|Graph RAG use cases and limits]]: use entity and relationship retrieval only where graph structure answers questions that passages and ordinary search miss.
- [[knowledge-freshness-and-invalidation|Knowledge freshness and invalidation]]: define freshness by source authority, update signals and risk-specific staleness limits, then propagate changes to every derived layer.
- [[multi-tenant-rag-isolation|Multi-tenant RAG isolation]]: design tenant boundaries across ingestion, indexes, authorization, caches, logs and recovery rather than relying on one query filter.
- [[retrieval-cache-invalidation|Retrieval cache invalidation]]: cache retrieval work only with keys and invalidation signals that preserve authorization, freshness and index-generation correctness.
- [[rag-evaluation-dataset-design|RAG evaluation dataset design]]: build a versioned, representative evaluation set that measures evidence retrieval, answer support, abstention and operational trade-offs.
- [[search-quality-incident-response|Search quality incident response]]: triage retrieval regressions with evidence-preserving diagnostics, bounded mitigations and measured recovery criteria.
- [[untrusted-content-in-retrieval-pipelines|Untrusted content in retrieval pipelines]]: treat retrieved documents as data rather than instructions, and constrain how their text influences model behavior and tools.

## Evaluation and quality

Create representative datasets, trustworthy labels, task-specific metrics and safe model-release gates.

- [[golden-dataset-management-for-llms|Managing golden datasets for LLM evaluation]]: version, curate and govern reference examples so model evaluations remain reproducible and useful.
- [[representative-evaluation-set-sampling|Sampling representative evaluation sets]]: build evaluation samples that reflect real tasks while preserving coverage of rare, high-impact failures.
- [[human-annotation-guidelines-for-ai-evals|Human annotation guidelines for AI evaluations]]: write task-specific annotation instructions that make human judgments consistent, auditable and actionable.
- [[inter-annotator-agreement-and-adjudication|Inter-annotator agreement and adjudication]]: interpret disagreement as a measurement signal and resolve evaluation labels with a documented process.
- [[llm-as-judge-validation|Validating an LLM-as-judge evaluator]]: test whether a model grader agrees with trusted judgments before using its scores in model decisions.
- [[retrieval-evaluation-metrics-and-thresholds|Retrieval evaluation metrics and thresholds]]: measure retrieval quality by stage and choose locally justified thresholds for a RAG application.
- [[groundedness-and-faithfulness-evaluation|Evaluating groundedness and faithfulness]]: check whether generated claims are supported by supplied evidence and whether citations actually substantiate them.
- [[task-success-evaluation-for-agents|Evaluating task success for agents]]: measure whether an agent reaches a valid outcome safely across complete multi-step tasks.
- [[tool-call-accuracy-and-argument-evaluation|Evaluating tool-call accuracy and arguments]]: test agent tool selection, argument correctness, sequencing and safety independently from final response quality.
- [[adversarial-robustness-evaluation|Adversarial robustness evaluation for AI systems]]: probe model and agent behavior under hostile, confusing and out-of-distribution inputs without overstating test coverage.
- [[model-calibration-and-abstention|Model calibration and abstention]]: evaluate whether confidence signals match observed correctness and whether the system abstains appropriately.
- [[hallucination-triage-and-remediation|Hallucination triage and remediation]]: classify unsupported model outputs by root cause and route fixes to the responsible system layer.
- [[model-version-pinning-and-upgrade-evals|Model versions as dependencies: pinning, deprecation tracking and upgrade evals]]: pinned model IDs with an inventory, retirement dates in the EOL register, an eval gate, a canary and a one-commit rollback.
- [[regression-testing-for-model-upgrades|Regression testing for model upgrades]]: compare a candidate model with the pinned baseline using controlled tests, risk slices and rollback criteria.
- [[shadow-and-canary-evaluation-for-models|Shadow and canary evaluation for models]]: validate candidate model behavior on live-like traffic while controlling exposure, privacy, cost and rollback risk.
- [[eval-data-leakage-and-contamination|Evaluation data leakage and contamination]]: prevent accidental access to test answers and detect overlap that makes evaluation results look better than they are.
- [[synthetic-data-for-ai-evaluation|Synthetic data for AI evaluation]]: generate and govern synthetic test data for LLM and RAG evaluation, covering drift, leakage, review, privacy and versioning with golden sets.

## Serving and inference platform

Run model serving on GKE or call managed endpoints privately, and plan capacity, latency, tenancy and routing.

- [[self-hosted-llm-inference-on-gke|Self-hosted LLM inference on GKE: GPU node pools, serving, autoscaling and cost]]: dedicated GPU node pools, a pinned vLLM server, queue-based autoscaling, Spot capacity and a one-step rollback.
- [[vertex-ai-private-access-from-gke|Calling Vertex AI from GKE privately: Workload Identity, VPC Service Controls, regions and quotas]]: no keys or public egress, a VPC Service Controls perimeter, region choice, 429 handling and audit logs.
- [[model-artifacts-in-artifactory|Model weights as supply-chain artifacts: Artifactory, safe formats, scanning and provenance]]: proxied model hubs, pinned revisions, safe weight formats only, scanning and licence review before promotion.
- [[llm-inference-capacity-planning|LLM inference capacity planning]]: estimate serving capacity from workload shape, latency objectives, memory, and measured saturation rather than a single tokens-per-second figure.
- [[gpu-utilization-and-serving-efficiency|GPU utilization and serving efficiency]]: diagnose whether inference accelerators are productively serving requests and improve efficiency without mistaking utilization for user value.
- [[inference-batching-and-queueing|Inference batching and queueing]]: balance accelerator-efficient batching against queue delay using bounded queues, explicit admission policy, and workload-aware latency objectives.
- [[kv-cache-capacity-and-paging|KV cache capacity and paging]]: plan autoregressive serving memory around the key-value cache, identify fragmentation and eviction risks, and validate paging behavior under real request mixes.
- [[quantization-quality-and-performance-tradeoffs|Quantization quality and performance tradeoffs]]: evaluate inference quantization as a workload-specific exchange among memory, throughput, latency, compatibility, and model quality.
- [[speculative-decoding-deployment|Speculative decoding deployment]]: deploy speculative decoding as an optional serving optimization with compatibility checks, representative evaluation, and a measured fallback path.
- [[streaming-inference-latency-budgets|Streaming inference latency budgets]]: set and instrument separate budgets for request acceptance, first token, ongoing stream cadence, and completion.
- [[ai-gateway-architecture-and-policy|AI gateway architecture and policy]]: place a policy-enforcing gateway between applications and model endpoints while keeping routing, identity, data handling, and failure behavior explicit.
- [[model-provider-failover-and-routing|Model provider failover and routing]]: route inference across approved providers using explicit health, capability, residency, deadline, and failure policies rather than blind retries.
- [[rate-limits-backpressure-and-queue-design|Rate limits, backpressure, and queue design]]: protect inference services from overload with explicit quotas, admission control, bounded queues, and retry behavior that does not amplify demand.
- [[llm-serving-autoscaling-signals|LLM serving autoscaling signals]]: scale inference replicas using signals tied to unmet work and latency, while accounting for GPU placement and slow capacity acquisition.
- [[multi-tenant-inference-isolation|Multi-tenant inference isolation]]: design tenant boundaries across identity, queues, cache, model processes, telemetry, and accelerator placement for shared inference platforms.
- [[inference-cold-start-mitigation|Inference cold-start mitigation]]: reduce time-to-ready for model-serving replicas by measuring each startup stage and balancing warm capacity against cost.
- [[gpu-sharing-on-kubernetes|GPU sharing on Kubernetes]]: whole-GPU, time-slicing and hardware partitioning for inference on Kubernetes and GKE, with resource names, quotas, monitoring and when sharing is unsafe.

## Production operations and cost

Define reliability, observability and cost controls for AI-backed services.

- [[llm-observability-tracing-and-slos|Observability for LLM-backed services and agents: traces, metrics and SLOs]]: traces of model and tool calls, time to first token, errors, 429s and tokens as low-cardinality metrics, and SLOs.
- [[llm-slo-definition-and-error-budgets|Defining SLOs and error budgets for LLM-backed services]]: turn user-visible quality and latency expectations into measurable SLOs and safe operational decisions.
- [[model-provider-outage-runbook|Responding to an LLM provider outage]]: a provider incident procedure for confirming impact, protecting traffic, communicating status, and restoring service safely.
- [[model-degradation-detection|Detecting model degradation in production]]: combine service telemetry, output checks, and sampled review to catch model regressions without logging sensitive content.
- [[llm-tracing-with-sensitive-data-controls|LLM tracing with sensitive-data controls]]: trace model workflows end to end while limiting prompt, completion, and tool data exposure.
- [[llm-retry-timeout-and-circuit-breaker-policy|Retry, timeout, and circuit-breaker policy for LLM calls]]: bound latency and provider load with explicit deadlines, retry eligibility, and dependency isolation.
- [[fallback-model-selection-and-quality-degradation|Selecting fallback models and managing quality degradation]]: route around model failures only through evaluated alternatives with explicit quality, privacy, capacity, and cost limits.
- [[llm-caching-correctness-and-safety|Correctness and safety for LLM caching]]: cache model work only when the key, scope, freshness, and privacy behavior preserve the original request's meaning.
- [[model-capacity-forecasting|Forecasting capacity for LLM workloads]]: forecast request, token, concurrency, and quota demand against latency goals before traffic outgrows provider capacity.
- [[llm-api-cost-control|Cost control for LLM APIs: gateway budgets, token caps and a kill switch]]: bound LLM spend with a gateway, per-team keys, caps, budget alerts, a kill switch and a tool-call audit trail.
- [[per-request-cost-estimation|Estimating LLM cost per request]]: estimate request cost from bounded inputs and versioned rate data, then compare estimates with actual usage.
- [[token-usage-metering-and-chargeback|Token usage metering and chargeback]]: build auditable usage records that reconcile provider bills with internal teams, services, and request classes.

## Risk and governance

Classify risk, review providers and contracts, keep an inventory, and control data, regions, change and retirement. For one system, work through [[ai-system-risk-classification|risk classification]], [[ai-impact-assessment-for-engineering-systems|impact assessment]], [[ai-system-threat-modeling|threat modeling]] and [[ai-red-team-exercise-planning|red-team planning]] in that order.

- [[ai-system-risk-classification|Risk classification for AI-enabled engineering systems]]: classify an AI system by its uses, autonomy, access, and potential impacts to select proportionate engineering controls.
- [[ai-impact-assessment-for-engineering-systems|Impact assessment for AI-enabled engineering systems]]: assess affected people, operational consequences, and control effectiveness before deploying or materially changing an AI-enabled system.
- [[model-provider-due-diligence|Due diligence for AI model providers]]: evaluate a model provider across service scope, security, data handling, reliability, and operational change before adoption.
- [[model-data-use-contract-review|Reviewing model data-use terms]]: coordinate legal and engineering review of model-provider terms for data use, retention, access, and deletion.
- [[model-inventory-and-owner-registration|Model inventory and owner registration]]: maintain a service-facing inventory of models, endpoints, data flows, owners, and lifecycle decisions.
- [[data-retention-and-deletion-in-llm-systems|Data retention and deletion in LLM systems]]: map data copies across model workflows and implement reviewable retention, deletion, and evidence controls.
- [[model-region-selection-and-data-residency|Selecting model regions and controlling data residency]]: choose inference locations using a documented data-flow, service-capability, latency, resilience, and residency review.
- [[llm-change-management-and-release-gates|Change management and release gates for LLM systems]]: control changes to models, prompts, tools, data, and providers with staged evaluation and observable rollback criteria.
- [[decommissioning-ai-model-integrations|Decommissioning AI model integrations]]: retire an LLM integration with owner approval, dependency discovery, data-lifecycle review, and verified service closure.
- [[remote-code-at-model-load-time|Remote code at model load time]]: how a model artifact runs code when it is loaded (trust_remote_code, auto_map, pickle weights, custom ops) and how to load models with no code path.
- [[backup-and-dr-for-ai-state|Backup and disaster recovery for AI state]]: what AI systems hold that must survive a disaster (indexes, registry, prompts, gateway policy, evals, memory) and whether to back each up or rebuild it.

The owner's agent skills and workflows live in [the owner's AI skills catalogue](https://ai.szolotov.com).

> [!note] Tools change fast
> AI tools change quickly, so these notes avoid product-specific claims and describe controls that hold across tools. Find reusable skills and shared workflows in the catalogue linked above.
