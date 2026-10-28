---
title: LLM-assisted cloud cost anomaly investigation
description: Investigate Google Cloud cost anomalies with deterministic BigQuery billing queries first, then a model that explains with cited evidence and never deletes.
type: pattern
tags:
  - ai
  - cost
  - observability
  - team-process
created: 2026-10-27
modified: 2026-10-27
draft: false
---

This note describes how a platform or FinOps engineer can use a language model to help investigate cloud cost anomalies on Google Cloud, using the billing export in BigQuery, resource labels and budgets. It covers the split between deterministic detection and model explanation, the evidence package, owner routing and the controls that stop an investigation from turning into automated deletion. It does not cover the cost of the model calls themselves ([[llm-api-cost-control]]), per-workload Kubernetes allocation ([[opencost-vs-kubecost-vs-gke-cost-allocation]]), or the label scheme ([[gcp-resource-naming-and-labels-standard]]). The same shape applies to logs and alerts in [[llm-log-analysis-and-alert-triage]].

> [!note] Not verified
> The sources below were found through search, but the pages could not be fetched on 2026-10-27. Before relying on this note, check: the current billing export schema (table names, column names, label structure, standard versus detailed versus pricing export, the partitioning column, how late rows arrive and whether they are revised), whether and how Google Cloud offers built-in anomaly detection for your billing account, current budget alert and Pub/Sub behaviour, the current FinOps Framework capability names, and the current OWASP LLM Top 10 category names.

## Principle: queries detect, the model explains

Detection is arithmetic. Daily cost per project and service against a trailing baseline, with a ratio and an absolute floor, is a SQL job that runs on a schedule and produces the same answer every time. The model never decides whether an anomaly exists. It receives the rows that a detector already flagged and does three things: summarises what changed, proposes candidate causes, and names the one query that would confirm or reject each cause.

This keeps the failure cost low. A model that misses an anomaly is not in the detection path. A model that invents a cause produces a hypothesis that a human tests with a query, not a change.

The FinOps Foundation frames anomaly management as detect (tools, alert channels, recipients), enable (data and policy) and manage (analyse, sort false positives, investigate, document the resolution). The model helps with the last group only.

## Prerequisites that decide whether this works

- **Turn the export on before you need it.** Billing export to BigQuery is generally described as not backfilling earlier usage, so assume history starts around the day you enable it. Enable the detailed export as well as the standard one if you need resource-level rows, and set dataset location and retention on purpose. Check the current docs for table names.
- **Labels decide who is asked.** Routing uses the `team`, `service`, `env` and `cost-center` keys from [[gcp-resource-naming-and-labels-standard]]. Labels are not applied retroactively: usage before a label was added carries no label in the export, and not every service passes labels through. Check the current docs for which services do. Unlabelled spend is itself a metric (see below).
- **Governed dataset.** Keep the export in a dedicated project and dataset with least-privilege IAM ([[gcp-iam-and-service-accounts]]). The investigation identity gets read access to the export and nothing else.
- **Allocation context.** For GKE, billing rows show node and SKU cost, not which workload caused it. Pair the export with workload allocation data when the anomaly sits in Compute Engine SKUs under a cluster project.

## Step 1: deterministic detection

Run a scheduled query that compares each day to a trailing window. The column names below follow the commonly documented standard export; verify them against the current schema before use.

```sql
-- anomaly_candidates.sql  (parameters: @run_date, @min_abs, @min_ratio)
WITH daily AS (
  SELECT
    DATE(usage_start_time) AS day,
    project.id AS project_id,
    service.description AS service,
    SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS net_cost
  FROM `billing-admin.billing_export.gcp_billing_export_v1_XXXXXX`
  -- Prune partitions (check which column the table is partitioned on);
  -- rows can land in partitions later than their usage time, so no upper bound.
  WHERE _PARTITIONTIME >= TIMESTAMP_SUB(TIMESTAMP(@run_date), INTERVAL 8 DAY)
    AND usage_start_time >= TIMESTAMP_SUB(TIMESTAMP(@run_date), INTERVAL 7 DAY)
    AND usage_start_time <  TIMESTAMP_ADD(TIMESTAMP(@run_date), INTERVAL 1 DAY)
  GROUP BY day, project_id, service
),
base AS (
  -- Divide by the window length, not AVG, so days with no rows count as zero.
  SELECT project_id, service, SUM(net_cost) / 7 AS baseline
  FROM daily WHERE day < @run_date GROUP BY project_id, service
)
SELECT d.day, d.project_id, d.service, d.net_cost, b.baseline,
       SAFE_DIVIDE(d.net_cost, b.baseline) AS ratio  -- NULL = no baseline: new spend
FROM daily d LEFT JOIN base b USING (project_id, service)
WHERE d.day = @run_date
  AND d.net_cost - IFNULL(b.baseline, 0) >= @min_abs
  AND (IFNULL(b.baseline, 0) <= 0 OR SAFE_DIVIDE(d.net_cost, b.baseline) >= @min_ratio)
ORDER BY d.net_cost - IFNULL(b.baseline, 0) DESC;
```

The `LEFT JOIN` matters: with an inner join, a service that never had spend in the project (new GPU or egress spend, a newly enabled API) has no baseline row and is silently dropped, which is exactly the pattern that most often signals compromise. Billing rows arrive with a delay and can be revised, so run the query for a `@run_date` whose data has settled (for example two days back) rather than for yesterday, or a partial day will look like a drop and hide a spike. `usage_start_time` is UTC, which may not match the day boundary on your invoice.

Keep a partition filter in every query, estimate bytes with a dry run before widening the window, and do not hard-code price assumptions into the pipeline. Treat thresholds as configuration owned by FinOps, and review them when false positives accumulate.

Budgets complement this but are notifications, not controls. A budget alert tells you a threshold was crossed; it does not stop spend. Use it as an independent early signal, and do not assume a Pub/Sub message from a budget stops anything unless you built and reviewed that mechanism separately.

## Step 2: build an evidence package

For each flagged row, a second set of fixed queries (a drill-down by SKU, by location, by label, by resource where the detailed export allows it, with the same date range) produces the evidence. Save the result rows and the exact SQL text together.

```json
{
  "anomaly_id": "2026-10-26/acme-orders-prod/Compute Engine",
  "window": { "day": "2026-10-26", "baseline_days": 7 },
  "detector_query": "gs://finops-evidence/queries/anomaly_candidates.sql@3f9c2e1",
  "drilldowns": [
    { "id": "by_sku", "rows_ref": "gs://finops-evidence/2026-10-26/by_sku.json" },
    { "id": "by_location", "rows_ref": "gs://finops-evidence/2026-10-26/by_location.json" },
    { "id": "by_label", "rows_ref": "gs://finops-evidence/2026-10-26/by_label.json" }
  ],
  "changes": ["deploy:orders-api@a1b2c3", "terraform-apply:acme-orders-prod#1842"],
  "labels_present": { "team": "team-orders", "service": "orders-api", "env": "prod" }
}
```

Before any model call, redact identifiers you do not need (billing account IDs, user emails in labels, internal hostnames) following [[redacting-sensitive-data-before-llm-calls]], and log which package went to which model.

## Step 3: model explanation with required citations

Give the model the package and a contract. Require structured output ([[structured-output-contracts]]) in which every claim carries a reference to a row ID or a link, and every hypothesis carries a confirming and a rejecting query.

```json
{
  "summary": "Egress SKUs in europe-west1 rose about threefold from 14:00 UTC.",
  "claims": [{ "text": "Network egress is the largest delta", "evidence": ["by_sku#row3"] }],
  "hypotheses": [
    {
      "cause": "Misconfigured NAT or new cross-region traffic",
      "confidence": "medium",
      "confirm_query": "by_location filtered to egress SKUs, grouped by hour",
      "reject_if": "egress is flat while compute grows",
      "owner_label": "team-orders"
    }
  ],
  "unsupported_statements": []
}
```

Validate the output mechanically ([[validating-model-generated-json]]). A claim with no evidence reference is moved to `unsupported_statements` and displayed as a hypothesis, not a finding. Common candidate causes worth putting in the prompt as a checklist, not as conclusions: a new autoscaling node pool, NAT or cross-region egress, a runaway CronJob, logging volume growth, a forgotten test environment, a new region rollout, and credential misuse. Use a small, fixed set of cause classes in your resolution log (for example infrastructure change, bug, attack, expected, other); the FinOps working-group material proposes a similar grouping, so check its current wording if you want to align with it.

Prompt hygiene matters as much as in any ops task ([[effective-prompting-for-operations-work]]). Label values and resource names in billing data are attacker-influenceable text in some setups, so treat them as data and not as instructions ([[indirect-prompt-injection-in-documents]]).

## Step 4: route to owners, not to a channel

Resolve the owner from the `team` and `service` labels, or from a service catalogue lookup keyed on them. Post one message to that team's alias with the summary, the evidence links and the hypothesis queries, and ask for one of: expected (with a reason and an expiry), explained and fixed, or needs help. When there is no owner label, route to the platform FinOps queue and count it.

Escalate to security instead when the pattern looks like compromise: spend in a region you do not use, a new service account or API enabled, sudden egress or GPU spend in a project that never had it. Link the containment procedure ([[compromised-cloud-cluster-containment]], [[leaked-credential-rotation]]) and preserve evidence before anyone changes the environment.

## Step 5: actions stay with humans

The model may propose actions. It does not delete, stop, resize or detach anything, and the investigation identity has no write permissions to the resources it investigates. Concretely:

- The investigation service account holds read roles on the export dataset and nothing on the workload projects ([[gcp-iam-guardrails-for-agent-service-accounts]]).
- Proposed actions are written as text with the exact resource and command, then executed by the owner through the normal change path ([[production-change-checklist]]).
- Where an approval is needed, bind it to one exact action and give it an expiry ([[human-approval-state-machine]]).
- Reversible, low-risk actions such as adding a missing label or creating a budget alert can be automated, but only by a separate reviewed job with its own narrow permissions, never by the investigation agent.

## FinOps hygiene that makes anomalies visible

- Track unallocated spend (rows without `team` or `service`) as a KPI per team and per month, and treat it like a failing test.
- Enforce labels at creation through Terraform validation and policy, as described in [[gcp-resource-naming-and-labels-standard]], and review the allocation approach in [[finops-cost-allocation-and-guardrails]].
- Keep a suppression and annotation list for planned launches, load tests and migrations, owned by the team causing the change, with an expiry date. Do not silence a detector by deleting it.
- Keep a resolution log: anomaly ID, cause class, owner, outcome, and whether the model's hypotheses were right. Feed false positives back into thresholds, and use the hypothesis hit rate to decide whether the model step is worth keeping.
- Review commitments and discounts monthly; they change baselines without any workload change.

## Failure modes

- The model is asked "is this an anomaly?" and its answer replaces the detector.
- A confident hypothesis is posted as fact because the claim-to-evidence check was skipped.
- Export was enabled late, so there is no baseline for the period that matters.
- Labels are inconsistent (`prod`, `production`), so the same cost is split across routes and nobody owns it.
- A planned load test pages three teams every quarter because suppression lives in someone's head.
- A budget alert is mistaken for a spending limit.
- Raw billing and log content, including identifiers, is sent to a model without redaction.
- An agent with write access "cleans up" an idle-looking resource that is a backup, a DR target or a compliance hold.
- Unbounded investigation queries scan the whole export repeatedly.
- The detector inner-joins on the baseline, so a service with no prior spend in the project (often the compromise case) never produces a candidate.
- The detector runs on a day whose billing data is still arriving, so spikes look like drops and are missed.

## Review checklist

- [ ] Standard and detailed billing export are enabled, with location, retention and IAM set deliberately.
- [ ] Detection is a scheduled, version-controlled query with owned thresholds; no model is in the detection path.
- [ ] Queries use partition filters and a dry-run size check.
- [ ] New spend with no baseline is flagged, and detection runs on a day whose data has settled.
- [ ] Each anomaly gets a saved evidence package with SQL text and result rows.
- [ ] Redaction runs before model calls, and model, data and time are logged.
- [ ] Model output is schema-validated; uncited claims are shown as hypotheses.
- [ ] Every hypothesis names a confirming and a rejecting query.
- [ ] Routing uses owner labels or a catalogue; unowned spend goes to a named queue and is counted.
- [ ] Compromise patterns escalate to security with the runbook linked.
- [ ] The investigation identity is read-only; no automated deletion or resizing exists.
- [ ] Approvals for changes are bound to one action and expire.
- [ ] Suppressions have owners and expiry dates; a resolution log is maintained.
- [ ] Billing schema, anomaly-detection features and budget behaviour were rechecked against current docs on a stated date.

## Sources

- [FinOps Foundation: Manage anomalies](https://www.finops.org/framework/capabilities/manage-anomalies/) — detect, enable and manage structure for anomaly handling; check the current capability names.
- [FinOps Foundation: Managing cloud cost anomalies](https://www.finops.org/wg/managing-cloud-cost-anomalies/) — working-group notes on anomaly causes and handling.
- [Google Cloud: Export Cloud Billing data to BigQuery](https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery) — export types, lack of backfill and label fields; check the current schema before writing SQL.
- [OWASP Top 10 for LLM Applications (2023, v0.9)](https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-2023-v09.pdf) — prompt injection and excessive agency framing; cite category names, as numbering has changed between editions.
- [OWASP GenAI: LLM Top 10](https://genai.owasp.org/llm-top-10/) — current list of categories; verify the edition before quoting numbers.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
