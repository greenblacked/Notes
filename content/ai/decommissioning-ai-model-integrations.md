---
title: Decommissioning AI model integrations
description: Retire an LLM integration with owner approval, dependency discovery, data-lifecycle review, and verified service closure.
type: runbook
tags:
  - ai
  - runbooks
  - reliability
  - audit
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Scope and safety boundary

Use this runbook when a model endpoint, provider integration, prompt workflow, or internal inference service is being retired. Retirement can affect live requests, queued jobs, audit records, caches, evaluation sets, credentials, provider commitments, and user data. This document intentionally does not provide direct commands for deleting resources, revoking credentials, disabling endpoints, or removing records. Those actions require the organization's approved change and evidence process.

Start with the inventory record and named service owner. Confirm the business reason, target date, affected users, contractual commitments, retention obligations, and replacement behavior. If the integration is involved in an incident, legal hold, or active investigation, stop the ordinary retirement workflow and follow the responsible incident, records, or legal process. [[model-inventory-and-owner-registration]] describes the inventory fields and ownership expectations.

## Discover dependents and define end state

Find every caller and related asset: gateway routes, application configuration, agents, scheduled jobs, queues, feature flags, evaluation pipelines, dashboards, alerts, cost reports, cache namespaces, retrieval indexes, telemetry exporters, and support procedures. Use repository search, deployment inventory, traffic data, and owner confirmation; no single source is complete. Check for dormant integrations that can still be called through a shared endpoint. Capture a dependency map and baseline request volume before moving traffic.

Write the intended end state for each component. A caller may transition to a new model, a human workflow, a limited service mode, or no function. Record the compatibility requirements and the user-facing message. Decide whether queued work will complete, be reprocessed, or be stopped through an approved procedure. Identify data that must remain for accounting, audit, or legal reasons separately from data that can follow the approved retention schedule. Engineering guidance is not legal advice; privacy, records, and legal owners determine retention requirements.

## Stage the transition

Create a change record with implementation owner, approvers, test evidence, timing, monitoring, and rollback conditions. Where a replacement exists, validate it against the same evaluation set and safety policy; a replacement is not automatically equivalent. Confirm its region and data handling, capacity and quota, cost center, SLO, and incident contact. Use a limited traffic cohort or test environment where feasible and compare operational and quality signals.

Plan communication for users, support, dependent teams, and finance. Give a clear transition date and identify what will change. Do not announce that data or credentials have been removed until the relevant system owners provide evidence. For a provider-managed endpoint, document what provider-side closure means, what records remain, and which contract or account confirmation supports the claim.

During cutover, monitor callers, requests, queues, errors, latency, costs, and replacement output validity. Keep a known rollback point until the observation window passes. If the new route fails or unexpected dependents appear, pause further retirement and use the approved rollback path. Do not make a broad change based solely on a quiet dashboard; low traffic may reflect an off-peak interval or hidden asynchronous caller.

## Close out with evidence

After cutover, have an independent reviewer compare the intended end state with runtime configuration, traffic, deployment records, billing signals, and dependency owners' confirmations. This is a verification gate, not a request to perform destructive steps without approval. Evidence should identify what was checked, by whom, when, relevant system identifiers, remaining exceptions, and the accountable owner for each exception. Preserve records required by policy and ensure retained artifacts are access-controlled.

Close the inventory entry with retirement date, replacement or successor, approvals, user communication, outstanding provider charges or commitments, and retention notes. Update dashboards, on-call links, system diagrams, and release documentation. Confirm cost reports stop attributing new usage after the expected billing delay; investigate residual traffic before considering the integration fully retired. Feed any missed dependency into inventory discovery and release gates.

## Checklist

- Owner, rationale, date, and required approvals are recorded.
- Callers, queues, credentials, routes, data copies, telemetry, and reports are mapped.
- Replacement or degraded behavior is tested and communicated.
- Privacy, records, contractual, and provider-side obligations are reviewed.
- Rollback criteria and observation window are explicit.
- Independent evidence confirms the intended end state.
- Inventory, dashboards, runbooks, and cost ownership are updated.

If any owner cannot confirm the state of a dependent system, treat retirement as incomplete and keep the exception visible. Do not equate a lack of requests in one dashboard with proof that no caller exists. Follow [[llm-change-management-and-release-gates]] for change controls, [[data-retention-and-deletion-in-llm-systems]] for lifecycle evidence, and [[model-version-pinning-and-upgrade-evals]] for model retirement and upgrade tracking.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).

## Sources

- [Google SRE: Role of Release Engineer and Best Practices](https://sre.google/sre-book/release-engineering/): controlled releases and change accountability.
- [Data controls in the OpenAI platform](https://platform.openai.com/docs/guides/your-data): provider-specific retention controls and limitations; verify current scope.
- [NIST AI Risk Management Framework Playbook](https://airc.nist.gov/airmf-resources/playbook/): risk-management lifecycle context for AI RMF 1.0; the NIST page states revision is underway.
