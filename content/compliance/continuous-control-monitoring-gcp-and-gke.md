---
title: Continuous control monitoring on GCP and GKE with Cloud Asset Inventory and Security Command Center
description: Check GCP and GKE configuration controls every day with Cloud Asset Inventory exports, BigQuery and Security Command Center, and keep dated results as evidence.
type: pattern
tags:
  - compliance
  - gcp
  - gke
  - audit
  - policy-as-code
  - security
created: 2026-10-21
modified: 2026-10-21
draft: false
aliases:
  - continuous-control-monitoring
  - ccm-gcp
---

Most audit evidence is a snapshot taken once a quarter. This pattern checks configuration controls every day instead: a scheduled pipeline exports the organisation's assets with Cloud Asset Inventory into BigQuery, a set of SQL checks finds resources that break a control, Security Command Center adds its own detectors, and each day's results are stored as dated evidence. It complements the preventive guardrails in [[compliance/gcp-organization-policy-guardrails]] and the node-level checks in [[compliance/cis-benchmarks-with-kube-bench]].

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Not checked against a running system
> Written for Cloud Asset Inventory, BigQuery and Security Command Center on a GCP organisation with GKE clusters, run from a GitLab scheduled pipeline. The `gcloud asset` and `gcloud scc` flags were checked against the `gcloud` help text and the Cloud Asset API reference on 2026-10-21. Nothing was run against a real project.
>
> These were not checked and must be compared with your own data before you rely on them: the BigQuery column names and types of the export tables, every JSON path and asset type name in the SQL below, the IAM roles needed to run an export, the Security Command Center tier that includes Security Health Analytics and its compliance mappings, the detector category names, the current CIS Google Cloud Platform Foundation Benchmark version, the Kyverno and Gatekeeper report fields, the `bq` command flags, and all quotas. Run `bq show --schema --format=prettyjson` on your tables and adjust the queries.

## Short answer

- Preventive controls (organisation policies, admission policies, Terraform plan checks) stop most bad configuration. Detective controls find what got through, what existed before the policy, and what was granted an exception.
- Export assets and IAM policies daily with `gcloud asset export` into BigQuery, partitioned by read time, from a GitLab scheduled pipeline that authenticates with workload identity federation as a read-only identity.
- Express each control as a SQL query that returns the resources that fail it, with a control ID in every row. Subtract active waivers. Anything left opens a ticket.
- Add Security Command Center findings (Security Health Analytics, where your tier includes it) for the controls Google already detects, and Kubernetes policy reports for in-cluster controls.
- Store each day's results as JSON in the evidence bucket. Those dated files, plus the export partitions, are what you hand an auditor for "the control operated throughout the period".

## Preventive and detective controls

| Aspect               | Preventive                                                                                   | Detective                                                                |
| -------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Examples             | Org policy constraints, Kyverno or Gatekeeper in enforce mode, plan policy gates             | Asset Inventory queries, Security Health Analytics, policy audit reports |
| When it acts         | Before the change is made                                                                    | After the change, on a schedule or on a feed                             |
| What it misses       | Resources created before the policy, exceptions, services the policy cannot see              | Nothing it can query, but it is late by up to one schedule interval      |
| Evidence it produces | The policy configuration and its change history                                              | Dated results showing the state of every resource on every day           |
| Where on this site   | [[compliance/gcp-organization-policy-guardrails]], [[patterns/terraform-plan-policy-checks]] | This note                                                                |

Run both. An auditor who sees an org policy will ask how you know it was not overridden for one project; the detective result answers that question.

## Ad hoc checks with Cloud Asset Inventory search

Search is the quickest way to answer a single question across the organisation. It needs the `cloudasset.assets.searchAllResources` permission on the scope for resources and `cloudasset.assets.searchAllIamPolicies` for IAM policies.

```bash title="Ad hoc Cloud Asset Inventory searches"
set -euo pipefail

ORG_NUMBER="123456789012" # change: your organisation number

# Every bucket in the organisation labelled env=prod, with a short set of fields
gcloud asset search-all-resources \
  --scope="organizations/${ORG_NUMBER}" \
  --asset-types='storage.googleapis.com/Bucket' \
  --query='labels.env:prod' \
  --read-mask='name,assetType,project,location,labels' \
  --format=json

# Every compute resource (the asset type filter accepts RE2 regular expressions)
gcloud asset search-all-resources \
  --scope="organizations/${ORG_NUMBER}" \
  --asset-types='compute.googleapis.com.*' \
  --format='table(assetType,name.basename(),location)'

# IAM bindings that grant something to an individual user rather than a group
gcloud asset search-all-iam-policies \
  --scope="organizations/${ORG_NUMBER}" \
  --query='memberTypes:user' \
  --format=json

# Bindings that grant a given role anywhere in the organisation
gcloud asset search-all-iam-policies \
  --scope="organizations/${ORG_NUMBER}" \
  --query='roles:roles/owner' \
  --format=json
```

The IAM search matches each binding separately and returns only the bindings that match, so the output is already the list to review. Search queries also support time comparisons such as `createTime<2026-01-01` and `NOT state:ACTIVE`. For the full query syntax see the searching pages under Sources. [[compliance/encryption-at-rest-and-in-transit-evidence-gcp]] uses the same search with the `kmsKeys` field to prove CMEK coverage.

Search is good for questions and spot checks. For a control that must run every day and leave history, use an export.

## Scheduled export to BigQuery

`gcloud asset export` writes a snapshot of the organisation to BigQuery. The flags that matter for evidence:

| Flag                        | Why                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--organization`            | Exactly one of `--organization`, `--folder` or `--project` is required. Use the organisation so nothing is missed.                                   |
| `--content-type`            | `resource`, `iam-policy`, `org-policy`, `access-policy`, `os-inventory` or `relationship`. Public-bucket checks need a separate `iam-policy` export. |
| `--bigquery-table`          | `projects/PROJECT/datasets/DATASET/tables/TABLE`. The dataset must exist; the table is created if missing.                                           |
| `--partition-key=read-time` | Writes to a partitioned table with `readTime` and `requestTime` columns, so each day's snapshot is kept. This is what makes history.                 |
| `--output-bigquery-force`   | Without it, an export to an existing table fails. With a partition key, only the matching partition is overwritten.                                  |
| `--asset-types`             | Limit the export to the types your controls use, to keep cost and run time down.                                                                     |
| `--per-asset-type`          | One table per asset type with typed columns. The queries below assume it is not set; check the schema page if you use it.                            |

`--snapshot-time` can export a past state, but only within the last 35 days, so it cannot rebuild a year of evidence after the fact. The export is the history; start it before the audit period starts.

The exported `resource.data` has some sensitive fields removed. It describes configuration, not secrets, and it is not a backup.

### The pipeline

The export runs from a GitLab scheduled pipeline in a small compliance project. It authenticates with workload identity federation as described in [[adr/0026-keyless-ci-auth-with-workload-identity-federation]], so there is no service account key. The service account it impersonates holds only what the export needs at the organisation level and write access to one BigQuery dataset in the compliance project. Take the exact roles from the required-permissions section of the export documentation; do not grant a broad viewer or editor role to make it work.

```yaml title=".gitlab-ci.yml"
variables:
  ORG_NUMBER: "123456789012" # change: your organisation number
  BQ_PROJECT: "example-compliance" # change: project that holds the dataset
  BQ_DATASET: "cai" # change: dataset, created beforehand by Terraform
  ASSET_TYPES: >-
    storage.googleapis.com/Bucket,compute.googleapis.com/Firewall,sqladmin.googleapis.com/Instance,container.googleapis.com/Cluster,iam.googleapis.com/ServiceAccountKey

cai-export:
  stage: export
  image: google/cloud-sdk:slim # change: your pinned and mirrored image
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  id_tokens:
    GCP_ID_TOKEN:
      aud: https://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/ci-compliance/providers/gitlab # change: your pool and provider
  script:
    - ./ci/gcp-wif-login.sh # wraps the create-cred-config and gcloud auth login steps from ADR 0026
    - |
      set -euo pipefail
      for CONTENT in resource iam-policy; do
        OP=$(gcloud asset export \
          --organization="${ORG_NUMBER}" \
          --content-type="${CONTENT}" \
          --asset-types="${ASSET_TYPES}" \
          --bigquery-table="projects/${BQ_PROJECT}/datasets/${BQ_DATASET}/tables/${CONTENT//-/_}" \
          --partition-key=read-time \
          --output-bigquery-force \
          --billing-project="${BQ_PROJECT}" \
          --format='value(name)')
        echo "export ${CONTENT}: ${OP}"
        for _ in $(seq 1 60); do
          DONE=$(gcloud asset operations describe "${OP}" --format='value(done)')
          [ "${DONE}" = "True" ] && break
          sleep 20
        done
        [ "${DONE}" = "True" ] || { echo "export ${CONTENT} did not finish in time"; exit 1; }
      done
```

The export is a long-running operation; `gcloud asset operations describe` reports its state, and the loop waits for it before the check job runs. The `--format='value(name)'` and `value(done)` projections and the printed value of `done` are not verified; run the commands once by hand and adjust.

A scheduled pipeline runs with the permissions of its owner. Make the schedule owner a team-owned account, not a person, and transfer it when people leave (see [[compliance/leaver-credential-revocation-devops-tools]]).

## Controls as SQL

Each check returns one row per failing resource, with the control ID and a short reason. Combining them in one view gives one result set to alert on and to archive. The queries assume tables named `resource` and `iam_policy` (from the job above), with `name`, `asset_type`, `readTime`, a `resource.data` column that holds the resource as a JSON string, and `iam_policy.bindings` as a repeated record of `role` and `members`. Those names and types are not verified; check them with:

```bash title="Check the export table schemas"
bq show --schema --format=prettyjson example-compliance:cai.resource
bq show --schema --format=prettyjson example-compliance:cai.iam_policy
```

If `resource.data` is a `JSON` column rather than a string, the JSON functions below still work in BigQuery, but check the result types. The asset type names and JSON paths come from the REST representation of each resource and are also not verified: pick one real row per asset type and compare.

```sql title="sql/control_results.sql"
CREATE OR REPLACE VIEW `example-compliance.cai.control_results` AS
WITH res AS (
  SELECT name, asset_type, resource.data AS d, readTime
  FROM `example-compliance.cai.resource`
  WHERE DATE(readTime) = CURRENT_DATE()
),
pol AS (
  SELECT name, asset_type, iam_policy, readTime
  FROM `example-compliance.cai.iam_policy`
  WHERE DATE(readTime) = CURRENT_DATE()
)

-- PLT-CFG-11: no bucket is readable by allUsers or allAuthenticatedUsers
SELECT 'PLT-CFG-11' AS control_id, p.name, CONCAT(b.role, ' to ', m) AS detail, p.readTime
FROM pol AS p, UNNEST(p.iam_policy.bindings) AS b, UNNEST(b.members) AS m
WHERE p.asset_type = 'storage.googleapis.com/Bucket'
  AND m IN ('allUsers', 'allAuthenticatedUsers')

UNION ALL

-- PLT-CFG-12: user-managed service account keys are younger than 90 days
SELECT 'PLT-CFG-12', name,
  CONCAT('user-managed key created ', JSON_VALUE(d, '$.validAfterTime')), readTime
FROM res
WHERE asset_type = 'iam.googleapis.com/ServiceAccountKey'
  AND JSON_VALUE(d, '$.keyType') = 'USER_MANAGED'
  AND TIMESTAMP(JSON_VALUE(d, '$.validAfterTime'))
      < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)

UNION ALL

-- PLT-CFG-13: no ingress firewall rule opens SSH or RDP to 0.0.0.0/0
SELECT DISTINCT 'PLT-CFG-13', name, 'ingress from 0.0.0.0/0 to 22 or 3389 (or all ports)', readTime
FROM res, UNNEST(JSON_QUERY_ARRAY(d, '$.allowed')) AS a
WHERE asset_type = 'compute.googleapis.com/Firewall'
  AND JSON_VALUE(d, '$.direction') = 'INGRESS'
  AND IFNULL(JSON_VALUE(d, '$.disabled'), 'false') != 'true'
  AND '0.0.0.0/0' IN UNNEST(JSON_VALUE_ARRAY(d, '$.sourceRanges'))
  AND (
    JSON_VALUE(a, '$.IPProtocol') = 'all'
    OR JSON_QUERY(a, '$.ports') IS NULL
    OR EXISTS (
      SELECT 1 FROM UNNEST(JSON_VALUE_ARRAY(a, '$.ports')) AS port
      WHERE port IN ('22', '3389')
    )
  )

UNION ALL

-- PLT-CFG-14: no Cloud SQL instance has a public IPv4 address
SELECT 'PLT-CFG-14', name, 'ipv4Enabled is true', readTime
FROM res
WHERE asset_type = 'sqladmin.googleapis.com/Instance'
  AND JSON_VALUE(d, '$.settings.ipConfiguration.ipv4Enabled') = 'true'

UNION ALL

-- PLT-CFG-15: every bucket uses uniform bucket-level access
SELECT 'PLT-CFG-15', name, 'uniform bucket-level access disabled', readTime
FROM res
WHERE asset_type = 'storage.googleapis.com/Bucket'
  AND IFNULL(JSON_VALUE(d, '$.iamConfiguration.uniformBucketLevelAccess.enabled'), 'false') != 'true'

UNION ALL

-- PLT-CFG-16: every GKE cluster uses private nodes
SELECT 'PLT-CFG-16', name, 'private nodes not enabled', readTime
FROM res
WHERE asset_type = 'container.googleapis.com/Cluster'
  AND IFNULL(JSON_VALUE(d, '$.privateClusterConfig.enablePrivateNodes'), 'false') != 'true'
```

Limits of these checks, to state in the control's test procedure:

- The firewall check matches the exact ports `22` and `3389`, a rule with no ports, and protocol `all`. A port range such as `1-65535` that contains 22 is not caught; add a range parser or treat any range as a finding. It also ignores IPv6 (`::/0`); add that if you use IPv6.
- The key-age check depends on the key asset carrying `keyType` and `validAfterTime` in the export, which is not verified. A confirmed alternative per service account is `gcloud iam service-accounts keys list --iam-account=SA_EMAIL --managed-by=user --created-before=TIMESTAMP`.
- GKE can record private nodes in more than one place depending on the cluster's age and API version; check a real cluster row. If a check reports every cluster, the path is wrong, not the fleet.
- The control IDs are examples. Use the IDs from your control set (see [[compliance/common-control-framework-for-platform-teams]]).

### Subtracting waivers

Approved exceptions live in a small table, maintained from the waiver records described in [[compliance/policy-exception-and-waiver-process]]: `control_id`, `resource_name`, `waiver_id`, `expires_on`. The open findings are the results without an active waiver.

```sql title="sql/open_findings.sql"
SELECT r.control_id, r.name, r.detail, r.readTime
FROM `example-compliance.cai.control_results` AS r
LEFT JOIN `example-compliance.cai.waivers` AS w
  ON w.control_id = r.control_id
  AND w.resource_name = r.name
  AND w.expires_on >= CURRENT_DATE()
WHERE w.waiver_id IS NULL
ORDER BY r.control_id, r.name
```

An expired waiver drops out of the join, so the resource reappears as a finding on the day after expiry without anyone remembering to look.

## Security Command Center and Security Health Analytics

Security Health Analytics is Security Command Center's built-in scanner for misconfigurations. Its findings overlap with the checks above and come with compliance mappings: each finding has a `compliances` field that lists a standard, a version and the control IDs it maps to, including CIS Google Cloud benchmark references. Which detectors, and whether the compliance mappings and reports are included, depends on your Security Command Center tier; check the Security Health Analytics page for your tier before you design around it. The CIS benchmark version that the detectors map to is also listed there.

Use it this way:

- Where Security Health Analytics covers a control, prefer its finding to your own SQL: Google maintains the detector. Keep your SQL for the controls it does not cover, and for your own thresholds.
- List the categories your organisation actually produces instead of copying detector names from elsewhere.
- Export findings continuously to BigQuery so they sit next to your own results.

```bash title="List SCC finding categories and export them to BigQuery"
set -euo pipefail

ORG_NUMBER="123456789012"       # change: your organisation number
BQ_DATASET_PATH="projects/example-compliance/datasets/scc" # change: dataset for SCC findings

# Active findings, with only the fields needed to see which categories exist
gcloud scc findings list "${ORG_NUMBER}" \
  --filter='state="ACTIVE"' \
  --field-mask='finding.category,finding.resource_name' \
  --format='value(finding.category)' | sort | uniq -c | sort -rn

# Continuous export of active findings to BigQuery
gcloud scc bqexports create scc-active-findings \
  --organization="${ORG_NUMBER}" \
  --dataset="${BQ_DATASET_PATH}" \
  --filter='state="ACTIVE"' \
  --description="Active findings for control monitoring"
```

In `gcloud scc findings list`, `--source` defaults to `-`, which means all sources. The `bqexports create` help text shows `--dataset` in the `projects/PROJECT/datasets/DATASET` form used above. The `--format` projection on `finding.category` is not verified; check `gcloud scc findings list --help` and `gcloud scc bqexports create --help` for your SDK version.

## Kubernetes policy reports

In-cluster controls (no privileged pods, required labels, image registries) are enforced or audited by Kyverno or Gatekeeper; [[tools/gatekeeper-vs-kyverno]] compares them and [[runbooks/policy-rollout-audit-to-enforce]] covers moving a policy from audit to enforce. For control monitoring, the question is only how to get their audit results into the same dataset:

- Kyverno writes PolicyReport and ClusterPolicyReport resources with a result per resource and rule.
- Gatekeeper's audit writes violations into the `status` of each constraint.

Both CRD names and field layouts are not verified here. A small job per cluster reads them with `kubectl get ... -o json`, reshapes each failure into the same columns as `control_results` (control ID from a label or annotation on the policy, the resource, a detail string, the read time) with `jq`, and loads the file into a `k8s_policy_results` table with `bq load --source_format=NEWLINE_DELIMITED_JSON` (flags not verified). Add a `UNION ALL` from that table to the view. Keep the job's Kubernetes identity read-only on those resources.

## Alerts, tickets and evidence

The check job runs after the export in the same scheduled pipeline:

1. Run `open_findings.sql` and save the result as JSON.
2. Copy the result, and a summary with the row count per control, to the evidence bucket under a dated path, for example `gs://example-evidence-archive/ccm/2026-10-21/`. Use the archive bucket and retention described in [[compliance/audit-evidence-collection-and-retention]].
3. For each control with open findings, create or update one issue in the owning team's tracker, with the resource list. One issue per control and day of first detection is easier to work than one per resource.
4. Fail the job if a control marked critical has findings, so the pipeline status shows it.

```bash title="ci/run-checks.sh"
set -euo pipefail

DAY="$(date -u +%F)"
EVIDENCE_BUCKET="gs://example-evidence-archive/ccm" # change: your evidence bucket path
CRITICAL_CONTROLS="PLT-CFG-11 PLT-CFG-13"            # change: controls that must fail the job

bq query --use_legacy_sql=false --format=json --max_rows=10000 \
  "$(cat sql/open_findings.sql)" > open_findings.json

jq -r 'group_by(.control_id) | map({control_id: .[0].control_id, count: length})' \
  open_findings.json > summary.json

gcloud storage cp open_findings.json summary.json "${EVIDENCE_BUCKET}/${DAY}/"

for CONTROL in ${CRITICAL_CONTROLS}; do
  COUNT=$(jq --arg c "${CONTROL}" '[.[] | select(.control_id == $c)] | length' open_findings.json)
  if [ "${COUNT}" -gt 0 ]; then
    echo "critical control ${CONTROL} has ${COUNT} open findings"
    FAILED=1
  fi
done
exit "${FAILED:-0}"
```

The `bq query` flags are not verified; check `bq query --help` for your version. The evidence a control owner shows an auditor is then: the view definition in Git (what was checked), the daily result files (that it ran and what it found), the issues (that findings were handled) and the waiver records (why some findings were accepted).

## Validation

Prove each check finds what it should before you rely on it. Use a sandbox project inside the organisation, under a folder where the preventive org policies are relaxed for this test only.

> [!warning] Costs money and opens access
> The seeded resources below are deliberately insecure. Create them in a sandbox with no data and no instances, and delete them as soon as the check has found them.

```bash title="Seed and clean up sandbox test resources"
set -euo pipefail

SANDBOX_PROJECT="example-sandbox-ccm"         # change: sandbox project
SEED_BUCKET="gs://example-ccm-seed-20261021"  # change: a unique bucket name
NETWORK="ccm-test"                            # change: an empty test VPC

# Seed: a public bucket and an open SSH rule
gcloud storage buckets create "${SEED_BUCKET}" --project="${SANDBOX_PROJECT}" --location=europe-west1
gcloud storage buckets add-iam-policy-binding "${SEED_BUCKET}" \
  --member=allUsers --role=roles/storage.objectViewer
gcloud compute firewall-rules create ccm-seed-open-ssh \
  --project="${SANDBOX_PROJECT}" --network="${NETWORK}" \
  --direction=INGRESS --allow=tcp:22 --source-ranges=0.0.0.0/0

# Run the scheduled pipeline by hand, then expect one row each for PLT-CFG-11 and PLT-CFG-13

# Cleanup
gcloud compute firewall-rules delete ccm-seed-open-ssh --project="${SANDBOX_PROJECT}" --quiet
gcloud storage buckets remove-iam-policy-binding "${SEED_BUCKET}" \
  --member=allUsers --role=roles/storage.objectViewer
gcloud storage rm --recursive "${SEED_BUCKET}"
```

If the bucket binding is refused, an organisation policy such as public access prevention is working; that is the preventive control, and it is good news. Test the detective check in a folder where that constraint is relaxed, or seed a different control. Repeat the seed test after every change to the SQL.

## Troubleshooting

| Symptom                                       | Likely cause                                                                                                        | Check                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Permission denied on export or search         | The identity lacks the Cloud Asset permission on the organisation, or the API is not enabled in the billing project | `gcloud services list --enabled --project=example-compliance`, then the export page's permission list |
| `INVALID_ARGUMENT` on export                  | The dataset does not exist, or an `--asset-types` pattern matches no type                                           | Create the dataset with Terraform; compare types with the supported asset types page                  |
| Export fails because the table exists         | `--output-bigquery-force` missing                                                                                   | Add it; with `--partition-key` only that partition is replaced                                        |
| Checks return yesterday's data or nothing     | The query ran before the export operation finished, or the partition filter uses the wrong date                     | `gcloud asset operations describe OPERATION`; check `readTime` values in the table                    |
| Every resource of a type is reported          | A JSON path is wrong, so the value is always null                                                                   | Read one row's `resource.data` and fix the path                                                       |
| Export rejected or slow at organisation scale | Quotas                                                                                                              | Check the Cloud Asset Inventory quotas page; narrow `--asset-types`                                   |

## Pitfalls

- **Treating the inventory dataset as harmless.** It lists every resource and every IAM binding in the organisation. Restrict access to it as you would the audit logs.
- **Only the latest partition.** If you overwrite one table every day, you have a current state, not evidence over a period. Keep the partitions for the audit period plus a margin.
- **Detective without an owner.** A finding nobody owns is noise. Route each control to the owner named in the control set.
- **Waivers in comments.** An exception that is not in the waiver table reappears every day and trains people to ignore the report.
- **Trusting one source.** Asset Inventory shows configuration; the audit logs show who changed it. For "who opened this firewall rule", use [[compliance/out-of-band-change-detection-gcp-gke]] and [[patterns/gcp-audit-logs-siem]].
- **A schedule owned by a person.** When they leave, the schedule stops and the evidence has a gap that nobody notices until the audit.
- **Assuming the export holds secrets or full config.** Sensitive fields are removed; never use it as a backup or a secret inventory.

## Related

- [[compliance/gcp-organization-policy-guardrails]]: the preventive side.
- [[compliance/access-reviews-gcp-and-gke]]: the quarterly human review that uses the same IAM data.
- [[compliance/audit-evidence-collection-and-retention]]: the evidence bucket and retention.
- [[compliance/policy-exception-and-waiver-process]]: waivers that the checks subtract.
- [[architecture/gcp-resource-hierarchy-and-landing-zone]]: the folder layout the scopes follow.
- [[tools/gatekeeper-vs-kyverno]]: in-cluster policy engines and their reports.
- [[patterns/gcp-audit-logs-siem]]: who changed what, as opposed to what the state is.

## Sources

- Google Cloud, [Searching resources](https://cloud.google.com/asset-inventory/docs/searching-resources): `search-all-resources` scopes and query syntax.
- Google Cloud, [Searching IAM policies](https://cloud.google.com/asset-inventory/docs/searching-iam-policies): `search-all-iam-policies` query syntax.
- Google Cloud, [Exporting asset metadata to BigQuery](https://cloud.google.com/asset-inventory/docs/exporting-to-bigquery): export flags, partitioning and the table schema.
- Google Cloud, [Supported asset types](https://cloud.google.com/asset-inventory/docs/supported-asset-types).
- Google Cloud, [Security Health Analytics](https://cloud.google.com/security-command-center/docs/concepts-security-health-analytics): detectors, tiers and compliance mappings.
- Center for Internet Security, [CIS Google Cloud Platform Foundation Benchmark](https://www.cisecurity.org/benchmark/google_cloud_computing_platform).
