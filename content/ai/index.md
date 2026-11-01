---
title: AI in DevOps
description: "Using AI agents and assistants in delivery and operations safely: access, review, provenance, incidents and rollout."
tags:
  - ai
  - meta
created: 2026-10-17
modified: 2026-11-01
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

## Running coding agents safely

Where agents run, what they may reach and how their access is scoped, logged and fenced.

- [[securing-ai-agents-in-ci-and-cloud|Securing AI agents that have repository or cloud access]]: rules for running coding and operations agents in CI or with cloud credentials, covering tokens, triggers, isolation, egress, human gates and data handling.
- [[sandboxing-coding-agents-on-workstations-and-runners|Sandboxing coding agents on workstations and runners: containers, credentials and egress]]: run agents where they reach only the repository, short-lived scoped credentials and an egress allowlist.
- [[coding-agent-permission-allowlists|Coding agent permission allowlists]]: per-repository and per-user allow, ask and deny rules for shell, file, network and MCP use, reviewed and audited.
- [[coding-agent-branch-and-worktree-isolation|Branch and worktree isolation for coding agents]]
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
- [[repository-context-packaging-for-coding-agents|Packaging repository context for coding agents]]
- [[agent-pull-request-size-and-reviewability|Pull request size and reviewability for agent changes]]
- [[ai-code-refactoring-scope-and-rollback|Scope and rollback for AI-assisted refactoring]]
- [[ai-docs-drift-and-verification|Preventing documentation drift in AI-assisted changes]]

## Reviewing AI-generated changes

Deterministic checks and review practice for code, infrastructure, SQL, shell and upgrades an assistant produced.

- [[validating-ai-generated-infrastructure-code|Validating AI-generated Terraform, Helm, Kubernetes and PromQL before review]]: a deterministic ladder of offline and live checks that catches invented arguments, removed APIs and queries that match nothing.
- [[llm-assisted-terraform-plan-review|LLM-assisted Terraform plan review: what the model checks and what it must not decide]]: an advisory model review of redacted plan JSON after deterministic gates, with a human approving every apply.
- [[ai-code-review-bots|AI code review bots in GitLab and GitHub]]: run AI review on merge requests as an advisory reviewer that comments only, with deterministic gates kept, triage, usefulness metrics and data handling.
- [[ai-assisted-test-generation-quality-gates|Quality gates for AI-assisted test generation]]
- [[validating-generated-sql-before-execution|Validating generated SQL before execution]]
- [[safe-shell-command-generation-for-agents|Safe shell command generation for agents]]
- [[ai-assisted-database-migration-review|AI-assisted database migration review]]
- [[dependency-hallucination-controls|Controls for hallucinated dependencies]]
- [[generated-api-client-code-review|Reviewing generated API client code]]
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

## Designing agents

Design agent instructions, context, tools, state and handoffs as explicit, testable contracts.

- [[context-engineering-for-agents|Context engineering for agents]]
- [[system-instruction-lifecycle|System instruction lifecycle]]
- [[prompt-templates-and-versioning|Prompt templates and versioning]]
- [[structured-output-contracts|Structured output contracts]]
- [[validating-model-generated-json|Validating model-generated JSON]]
- [[tool-calling-contracts-and-schemas|Tool-calling contracts and schemas]]
- [[safe-agent-state-machines|Safe agent state machines]]
- [[bounded-agent-loops-and-stop-conditions|Bounded agent loops and stop conditions]]
- [[agent-memory-retention-and-deletion|Agent memory retention and deletion]]
- [[context-window-budgeting|Context window budgeting]]
- [[long-context-retrieval-strategy|Long-context retrieval strategy]]
- [[prompt-caching-and-data-isolation|Prompt caching and data isolation]]
- [[model-router-policy|Model router policy]]
- [[multi-agent-handoff-boundaries|Multi-agent handoff boundaries]]
- [[human-approval-state-machine|Human approval state machine]]

## AI security

Threat-model AI applications and constrain identity, tools, execution, network access, data and model supply chains.

- [[ai-system-threat-modeling|Threat modeling AI-enabled systems]]
- [[indirect-prompt-injection-in-documents|Indirect prompt injection in documents]]
- [[multimodal-prompt-injection|Multimodal prompt injection boundaries]]
- [[prompt-injection-test-harness-for-ci-agents|Testing CI agents against prompt injection, including tool and MCP inputs]]: a repeatable suite of planted instructions with canary secrets and fail-closed assertions on tool calls and egress.
- [[agent-tool-authorization-boundaries|Authorization boundaries for agent tools]]
- [[delegated-oauth-for-agent-tools|Delegated OAuth for agent tools]]
- [[just-in-time-agent-credentials|Just-in-time credentials for AI agents]]
- [[agent-network-egress-controls|Network egress controls for AI agents]]
- [[browser-agent-isolation|Isolation boundaries for browser agents]]
- [[code-execution-agent-sandboxing|Sandboxing code execution by AI agents]]
- [[ai-agent-package-installation-risks|Package installation risks in AI agent workflows]]
- [[redacting-sensitive-data-before-llm-calls|Redacting sensitive data before LLM calls: secrets, personal data and a fail-closed filter]]: a shared, tested redaction layer in the gateway that blocks the call when it cannot be sure.
- [[llm-denial-of-service-and-resource-exhaustion|Denial of service and resource exhaustion in LLM systems]]
- [[model-supply-chain-verification|Verifying AI model supply chains]]
- [[open-weight-model-risk-assessment|Risk assessment for open-weight models]]
- [[ai-red-team-exercise-planning|Planning defensive AI red-team exercises]]
- [[ai-agent-security-incident-evidence|Evidence collection for AI agent security incidents]]

## RAG and knowledge systems

Build retrieval pipelines with deliberate ingestion, ranking, access control, freshness and quality checks.

- [[document-ingestion-for-enterprise-rag|Document ingestion for enterprise RAG]]
- [[llm-data-pipeline-quality-controls|LLM data pipeline quality controls]]
- [[chunking-strategy-evaluation|Chunking strategy evaluation]]
- [[embedding-model-migration|Embedding model migration]]
- [[embedding-pipeline-idempotency-and-reprocessing|Embedding pipeline idempotency and reprocessing]]
- [[vector-index-capacity-and-lifecycle|Vector index capacity and lifecycle]]
- [[hybrid-search-for-rag|Hybrid search for RAG]]
- [[reranking-and-retrieval-depth|Reranking and retrieval depth]]
- [[metadata-filtering-and-acl-aware-retrieval|Metadata filtering and ACL-aware retrieval]]
- [[citation-grounding-and-source-provenance|Citation grounding and source provenance]]
- [[graph-rag-use-cases-and-limits|Graph RAG use cases and limits]]
- [[knowledge-freshness-and-invalidation|Knowledge freshness and invalidation]]
- [[multi-tenant-rag-isolation|Multi-tenant RAG isolation]]
- [[retrieval-cache-invalidation|Retrieval cache invalidation]]
- [[rag-evaluation-dataset-design|RAG evaluation dataset design]]
- [[search-quality-incident-response|Search quality incident response]]
- [[untrusted-content-in-retrieval-pipelines|Untrusted content in retrieval pipelines]]

## Evaluation and quality

Create representative datasets, trustworthy labels, task-specific metrics and safe model-release gates.

- [[golden-dataset-management-for-llms|Managing golden datasets for LLM evaluation]]
- [[representative-evaluation-set-sampling|Sampling representative evaluation sets]]
- [[human-annotation-guidelines-for-ai-evals|Human annotation guidelines for AI evaluations]]
- [[inter-annotator-agreement-and-adjudication|Inter-annotator agreement and adjudication]]
- [[llm-as-judge-validation|Validating an LLM-as-judge evaluator]]
- [[retrieval-evaluation-metrics-and-thresholds|Retrieval evaluation metrics and thresholds]]
- [[groundedness-and-faithfulness-evaluation|Evaluating groundedness and faithfulness]]
- [[task-success-evaluation-for-agents|Evaluating task success for agents]]
- [[tool-call-accuracy-and-argument-evaluation|Evaluating tool-call accuracy and arguments]]
- [[adversarial-robustness-evaluation|Adversarial robustness evaluation for AI systems]]
- [[model-calibration-and-abstention|Model calibration and abstention]]
- [[hallucination-triage-and-remediation|Hallucination triage and remediation]]
- [[model-version-pinning-and-upgrade-evals|Model versions as dependencies: pinning, deprecation tracking and upgrade evals]]: pinned model IDs with an inventory, retirement dates in the EOL register, an eval gate, a canary and a one-commit rollback.
- [[regression-testing-for-model-upgrades|Regression testing for model upgrades]]
- [[shadow-and-canary-evaluation-for-models|Shadow and canary evaluation for models]]
- [[eval-data-leakage-and-contamination|Evaluation data leakage and contamination]]

## Serving and inference platform

Run model serving on GKE or call managed endpoints privately, and plan capacity, latency, tenancy and routing.

- [[self-hosted-llm-inference-on-gke|Self-hosted LLM inference on GKE: GPU node pools, serving, autoscaling and cost]]: dedicated GPU node pools, a pinned vLLM server, queue-based autoscaling, Spot capacity and a one-step rollback.
- [[vertex-ai-private-access-from-gke|Calling Vertex AI from GKE privately: Workload Identity, VPC Service Controls, regions and quotas]]: no keys or public egress, a VPC Service Controls perimeter, region choice, 429 handling and audit logs.
- [[model-artifacts-in-artifactory|Model weights as supply-chain artifacts: Artifactory, safe formats, scanning and provenance]]: proxied model hubs, pinned revisions, safe weight formats only, scanning and licence review before promotion.
- [[llm-inference-capacity-planning|LLM inference capacity planning]]
- [[gpu-utilization-and-serving-efficiency|GPU utilization and serving efficiency]]
- [[inference-batching-and-queueing|Inference batching and queueing]]
- [[kv-cache-capacity-and-paging|KV cache capacity and paging]]
- [[quantization-quality-and-performance-tradeoffs|Quantization quality and performance tradeoffs]]
- [[speculative-decoding-deployment|Speculative decoding deployment]]
- [[streaming-inference-latency-budgets|Streaming inference latency budgets]]
- [[ai-gateway-architecture-and-policy|AI gateway architecture and policy]]
- [[model-provider-failover-and-routing|Model provider failover and routing]]
- [[rate-limits-backpressure-and-queue-design|Rate limits, backpressure, and queue design]]
- [[llm-serving-autoscaling-signals|LLM serving autoscaling signals]]
- [[multi-tenant-inference-isolation|Multi-tenant inference isolation]]
- [[inference-cold-start-mitigation|Inference cold-start mitigation]]

## Production operations and cost

Define reliability, observability and cost controls for AI-backed services.

- [[llm-observability-tracing-and-slos|Observability for LLM-backed services and agents: traces, metrics and SLOs]]: traces of model and tool calls, time to first token, errors, 429s and tokens as low-cardinality metrics, and SLOs.
- [[llm-slo-definition-and-error-budgets|Defining SLOs and error budgets for LLM-backed services]]
- [[model-provider-outage-runbook|Responding to an LLM provider outage]]
- [[model-degradation-detection|Detecting model degradation in production]]
- [[llm-tracing-with-sensitive-data-controls|LLM tracing with sensitive-data controls]]
- [[llm-retry-timeout-and-circuit-breaker-policy|Retry, timeout, and circuit-breaker policy for LLM calls]]
- [[fallback-model-selection-and-quality-degradation|Selecting fallback models and managing quality degradation]]
- [[llm-caching-correctness-and-safety|Correctness and safety for LLM caching]]
- [[model-capacity-forecasting|Forecasting capacity for LLM workloads]]
- [[llm-api-cost-control|Cost control for LLM APIs: gateway budgets, token caps and a kill switch]]: bound LLM spend with a gateway, per-team keys, caps, budget alerts, a kill switch and a tool-call audit trail.
- [[per-request-cost-estimation|Estimating LLM cost per request]]
- [[token-usage-metering-and-chargeback|Token usage metering and chargeback]]

## Risk and governance

Classify risk, review providers and contracts, keep an inventory, and control data, regions, change and retirement.

- [[ai-system-risk-classification|Risk classification for AI-enabled engineering systems]]
- [[ai-impact-assessment-for-engineering-systems|Impact assessment for AI-enabled engineering systems]]
- [[model-provider-due-diligence|Due diligence for AI model providers]]
- [[model-data-use-contract-review|Reviewing model data-use terms]]
- [[model-inventory-and-owner-registration|Model inventory and owner registration]]
- [[data-retention-and-deletion-in-llm-systems|Data retention and deletion in LLM systems]]
- [[model-region-selection-and-data-residency|Selecting model regions and controlling data residency]]
- [[llm-change-management-and-release-gates|Change management and release gates for LLM systems]]
- [[decommissioning-ai-model-integrations|Decommissioning AI model integrations]]

The owner's agent skills and workflows live in [the owner's AI skills catalogue](https://ai.szolotov.com).

> [!note] Tools change fast
> AI tools change quickly, so these notes avoid product-specific claims and describe controls that hold across tools. Find skills and shared workflows at [ai.szolotov.com](https://ai.szolotov.com).
