---
title: AI in DevOps
description: "Using AI agents and assistants in delivery and operations safely: access, review, provenance, incidents and rollout."
tags:
  - ai
  - meta
created: 2026-10-17
modified: 2026-10-17
draft: false
---

These notes cover using AI agents and assistants in delivery and operations without giving up control: what they may access, how their output is reviewed, how it is traced and how a team adopts them.

## Security and governance

- [[securing-ai-agents-in-ci-and-cloud|Securing AI agents that have repository or cloud access]]: rules for running coding and operations agents in CI or with cloud credentials, covering tokens, triggers, isolation, egress, human gates and data handling.
- [[ai-generated-code-policy-and-provenance|Policy for AI-generated code - review, provenance and audit trail]]: a team policy for code written with AI assistants covering ownership, review rules, optional provenance records, licence questions and evidence for auditors.
- [[ai-code-review-bots|AI code review bots in GitLab and GitHub]]: run AI review on merge requests as an advisory reviewer that comments only, with deterministic gates kept, triage, usefulness metrics and data handling.

## Operations and teams

- [[ai-assisted-incident-response|AI-assisted incident response, what to automate and what never to]]: how to use AI assistants during incidents and postmortems with read-only access, evidence-first prompts and a clear list of actions that always need a human.
- [[rolling-out-ai-tools-in-a-team|Rolling out AI coding tools in a DevOps team]]: an engineering manager's guide to piloting AI coding and review assistants with a baseline, outcome metrics, security review, cost tracking and a go or no-go decision.
- [[agent-skills-and-shared-workflows|Agent skills and shared workflows for platform teams]]: treat agent instructions, skills and prompt files as versioned platform assets with review, pinned consumption, least-privilege tool lists and tests.

The owner's agent skills and workflows live in [the owner's AI skills catalogue](https://ai.szolotov.com).

> [!note] Tools change fast
> AI tools change quickly, so these notes avoid product-specific claims and describe controls that hold across tools. Find skills and shared workflows at [ai.szolotov.com](https://ai.szolotov.com).
