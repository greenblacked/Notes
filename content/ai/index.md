---
title: AI in DevOps
description: "Using AI agents and assistants in delivery and operations safely: access, review, provenance, incidents and rollout."
tags:
  - ai
  - meta
created: 2026-10-17
modified: 2026-10-21
draft: false
---

These notes cover using AI agents and assistants in delivery and operations without giving up control: what they may access, how their output is reviewed, how it is traced and how a team adopts them.

## Security and governance

- [[securing-ai-agents-in-ci-and-cloud|Securing AI agents that have repository or cloud access]]: rules for running coding and operations agents in CI or with cloud credentials, covering tokens, triggers, isolation, egress, human gates and data handling.
- [[ai-generated-code-policy-and-provenance|Policy for AI-generated code - review, provenance and audit trail]]: a team policy for code written with AI assistants covering ownership, review rules, optional provenance records, licence questions and evidence for auditors.
- [[ai-code-review-bots|AI code review bots in GitLab and GitHub]]: run AI review on merge requests as an advisory reviewer that comments only, with deterministic gates kept, triage, usefulness metrics and data handling.
- [[gcp-iam-guardrails-for-agent-service-accounts|GCP IAM guardrails for AI agent service accounts]]: one service account per task, IAM conditions, deny policies, short-lived impersonation and outer fences for agents in Google Cloud.
- [[prompt-injection-test-harness-for-ci-agents|Testing CI agents against prompt injection, including tool and MCP inputs]]: a repeatable suite of planted instructions with canary secrets and fail-closed assertions on tool calls and egress.
- [[ai-coding-assistant-admin-controls|Admin controls for AI coding assistants: seats, data, telemetry and deny rules]]: the settings an admin controls on coding assistants and how to verify each one.
- [[llm-assisted-terraform-plan-review|LLM-assisted Terraform plan review: what the model checks and what it must not decide]]: an advisory model review of redacted plan JSON after deterministic gates, with a human approving every apply.
- [[kubernetes-rbac-for-ai-agents|Kubernetes RBAC for AI agents: read-only troubleshooting without secrets]]: a dedicated identity and hand-written read-only role with no secrets, exec or escalation verbs, short-lived tokens and tests that prove it.
- [[internal-mcp-servers-for-platform-tools|Building internal MCP servers for platform tools: scope, auth, deployment and audit]]: narrow, typed, read-mostly tools with server-side limits, audience-checked tokens and a per-call audit log.
- [[redacting-sensitive-data-before-llm-calls|Redacting sensitive data before LLM calls: secrets, personal data and a fail-closed filter]]: a shared, tested redaction layer in the gateway that blocks the call when it cannot be sure.
- [[sandboxing-coding-agents-on-workstations-and-runners|Sandboxing coding agents on workstations and runners: containers, credentials and egress]]: run agents where they reach only the repository, short-lived scoped credentials and an egress allowlist.

## Operations and teams

- [[ai-assisted-incident-response|AI-assisted incident response, what to automate and what never to]]: how to use AI assistants during incidents and postmortems with read-only access, evidence-first prompts and a clear list of actions that always need a human.
- [[rolling-out-ai-tools-in-a-team|Rolling out AI coding tools in a DevOps team]]: an engineering manager's guide to piloting AI coding and review assistants with a baseline, outcome metrics, security review, cost tracking and a go or no-go decision.
- [[agent-skills-and-shared-workflows|Agent skills and shared workflows for platform teams]]: treat agent instructions, skills and prompt files as versioned platform assets with review, pinned consumption, least-privilege tool lists and tests.
- [[llm-log-analysis-and-alert-triage|LLM-assisted log analysis and alert triage without losing evidence]]: deterministic clustering, evidence-linked summaries and advisory alert triage that never silences.
- [[rag-over-runbooks-for-on-call|RAG over internal runbooks for on-call: access control, citations, staleness and evaluation]]: a retrieval assistant that enforces permissions, cites sources, flags stale pages and is gated on golden questions.
- [[verifying-ai-generated-runbooks|Verifying AI-generated runbooks before on-call uses them]]: check every drafted step against the live system and a staging dry run, with a named owner and a last-verified date.
- [[validating-ai-generated-infrastructure-code|Validating AI-generated Terraform, Helm, Kubernetes and PromQL before review]]: a deterministic ladder of offline and live checks that catches invented arguments, removed APIs and queries that match nothing.
- [[runaway-or-compromised-ai-agent-response|Runbook: stopping a runaway or compromised AI agent]]: stop the agent, contain its credentials, keep the evidence, assess the blast radius and recover.

## Platform for AI

- [[self-hosted-llm-inference-on-gke|Self-hosted LLM inference on GKE: GPU node pools, serving, autoscaling and cost]]: dedicated GPU node pools, a pinned vLLM server, queue-based autoscaling, Spot capacity and a one-step rollback.
- [[vertex-ai-private-access-from-gke|Calling Vertex AI from GKE privately: Workload Identity, VPC Service Controls, regions and quotas]]: no keys or public egress, a VPC Service Controls perimeter, region choice, 429 handling and audit logs.
- [[model-artifacts-in-artifactory|Model weights as supply-chain artifacts: Artifactory, safe formats, scanning and provenance]]: proxied model hubs, pinned revisions, safe weight formats only, scanning and licence review before promotion.
- [[llm-observability-tracing-and-slos|Observability for LLM-backed services and agents: traces, metrics and SLOs]]: traces of model and tool calls, time to first token, errors, 429s and tokens as low-cardinality metrics, and SLOs.
- [[model-version-pinning-and-upgrade-evals|Model versions as dependencies: pinning, deprecation tracking and upgrade evals]]: pinned model IDs with an inventory, retirement dates in the EOL register, an eval gate, a canary and a one-commit rollback.

## Evaluation and cost

- [[evaluating-ai-tools-for-a-platform-team|Evaluating AI tools for a platform team: security scorecard and bake-off on your own repos]]: screen tools on data and security, then compare them on real past changes with CI-measured outcomes.
- [[measuring-ai-impact-on-delivery|Measuring AI impact on delivery without fooling yourself]]: cohorts, a fixed baseline and counter-metrics around the DORA keys, instead of vanity figures.
- [[llm-api-cost-control|Cost control for LLM APIs: gateway budgets, token caps and a kill switch]]: bound LLM spend with a gateway, per-team keys, caps, budget alerts, a kill switch and a tool-call audit trail.

The owner's agent skills and workflows live in [the owner's AI skills catalogue](https://ai.szolotov.com).

> [!note] Tools change fast
> AI tools change quickly, so these notes avoid product-specific claims and describe controls that hold across tools. Find skills and shared workflows at [ai.szolotov.com](https://ai.szolotov.com).
