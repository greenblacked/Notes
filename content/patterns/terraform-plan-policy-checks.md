---
title: Policy checks on Terraform plans
description: Evaluate Terraform plan JSON with Conftest and static scanners in GitLab CI, and treat plan files as secrets, so risky GCP changes are stopped before apply.
type: pattern
tags:
  - patterns
  - terraform
  - policy-as-code
  - security
  - gcp
created: 2026-10-17
modified: 2026-10-17
draft: false
---

Scanning Terraform source finds what is written. Scanning the plan finds what will happen: which resources are created, changed or destroyed, with modules, variables and `for_each` already resolved. This note is for senior DevOps engineers and expands the short policy section of [[patterns/terraform-module-and-state-layout]]; the plan and apply pipeline itself is described there and is not repeated. Testing the modules is in [[patterns/terraform-testing]].

> [!info] Scope and sources
> Written for Terraform (or OpenTofu) with the Google provider, Conftest with Rego v1 syntax, and GitLab CI. Based on the [Terraform JSON output format](https://developer.hashicorp.com/terraform/internals/json-format), the [Conftest docs](https://www.conftest.dev/), the [Checkov docs](https://www.checkov.io/) and the [Trivy docs](https://trivy.dev/).

> [!note] Not verified
> The claims below were written from documentation knowledge and were not checked against a running system or the current docs: Checkov framework flag names, Trivy `config` flags, whether tfsec has been merged into Trivy, GitLab `artifacts:access` values, and the attribute paths of Google provider resources (for example `user_labels` under `settings` of a Cloud SQL instance). Check them before relying on them.

## Why scan the plan as well as the source

- Source scanners see `var.enable_public_access`, not its value in the `prod` environment.
- Modules hide resources. The plan lists every resource the module creates, with its final arguments.
- Only the plan knows about destruction. A rename or a changed immutable argument becomes "delete and create", and a policy can refuse deleting a database instance without an explicit label.
- Plan checks run for the exact change under review, so a failing check points to the merge request that caused it, not to the backlog of old findings.

Source scanning still earns its place: it needs no credentials, runs in seconds, and finds problems in code paths a particular plan does not exercise. Run both.

## Producing plan JSON

```bash
set -euo pipefail

cd environments/prod # change: the Terraform root module to plan

terraform init -input=false
terraform plan -input=false -out=tfplan
terraform show -json tfplan > plan.json

conftest test plan.json --policy ../../policy/terraform --namespace terraform.gcp
```

`terraform show -json` prints the plan as one JSON document. The parts policy uses are `resource_changes` (one entry per resource instance, with `type`, `mode`, `address` and a `change` object), and inside `change`: `actions`, `before`, `after` and `after_unknown`.

## Rego over resource_changes

Four habits keep these rules correct:

- Filter on the action. `resource_changes` also lists unchanged resources (actions `["no-op"]`) and data sources (`mode` `"data"`, action `["read"]`). A rule on `after` must apply only to managed resources that are being created or updated, or every plan fails on legacy resources.
- Guard `change.after`. On a delete it is `null`, and a rule that reads `after.something` must not fire (or crash) on it.
- Respect `after_unknown`. A value computed at apply time is absent from `after`; flagging it as missing would block valid changes.
- Read `before` for deletions, because `after` is gone.

```rego title="policy/terraform/gcp.rego"
package terraform.gcp

import rego.v1

# Resource types that must carry a cost-center label.
labelled_types := {"google_storage_bucket", "google_compute_instance", "google_pubsub_topic"}

unknown(rc, attr) if rc.change.after_unknown[attr] == true

# Only managed resources that this plan creates or updates; skips no-op, read and delete.
changing(rc) if {
  rc.mode == "managed"
  some a in rc.change.actions
  a in {"create", "update"}
}

# Cloud Storage buckets must use uniform bucket-level access.
deny contains msg if {
  some rc in input.resource_changes
  rc.type == "google_storage_bucket"
  changing(rc)
  rc.change.after != null
  not rc.change.after.uniform_bucket_level_access == true
  not unknown(rc, "uniform_bucket_level_access")
  msg := sprintf("%s: uniform_bucket_level_access must be true", [rc.address])
}

# Cloud SQL instances may be deleted only when the previous labels allow it.
destroy_allowed(rc) if rc.change.before.settings[0].user_labels["allow-destroy"] == "true"

deny contains msg if {
  some rc in input.resource_changes
  rc.type == "google_sql_database_instance"
  "delete" in rc.change.actions
  not destroy_allowed(rc)
  msg := sprintf("%s: deleting a Cloud SQL instance needs the user label allow-destroy=true applied first", [rc.address])
}

# Labelled resource types need a non-empty cost-center label.
has_cost_center(rc) if count(rc.change.after.labels["cost-center"]) > 0

# Google provider v5 and later: labels set through provider default_labels appear in
# terraform_labels and effective_labels, not in labels (not verified for your pinned provider version).
has_cost_center(rc) if count(object.get(rc.change.after, "terraform_labels", {})["cost-center"]) > 0

deny contains msg if {
  some rc in input.resource_changes
  rc.type in labelled_types
  changing(rc)
  rc.change.after != null
  not has_cost_center(rc)
  not unknown(rc, "labels")
  not unknown(rc, "terraform_labels")
  msg := sprintf("%s: missing cost-center label", [rc.address])
}
```

The cost-center rule ties into the allocation scheme in [[architecture/finops-cost-allocation-and-guardrails]]. Rules like "no public bucket" and "allowed regions" are better enforced earlier and for every tool by organisation policy ([[compliance/gcp-organization-policy-guardrails]]); use plan policy for team conventions and for guarding destructive changes.

The Cloud SQL rule is deliberately a two-step: first a merge request adds the label to the instance, then a later one removes it. That makes a destroy a conscious change. Adding `deletion_protection` on the resource gives a second layer inside the provider.

### Policy tests

```rego title="policy/terraform/gcp_test.rego"
package terraform.gcp_test

import rego.v1

import data.terraform.gcp

bucket(after) := {"resource_changes": [{
  "address": "google_storage_bucket.logs",
  "mode": "managed",
  "type": "google_storage_bucket",
  "change": {"actions": ["create"], "before": null, "after": after, "after_unknown": {}},
}]}

noop_bucket(after) := {"resource_changes": [{
  "address": "google_storage_bucket.legacy",
  "mode": "managed",
  "type": "google_storage_bucket",
  "change": {"actions": ["no-op"], "before": after, "after": after, "after_unknown": {}},
}]}

sql_delete(before) := {"resource_changes": [{
  "address": "google_sql_database_instance.main",
  "mode": "managed",
  "type": "google_sql_database_instance",
  "change": {"actions": ["delete"], "before": before, "after": null, "after_unknown": {}},
}]}

test_compliant_bucket_passes if {
  count(gcp.deny) == 0 with input as bucket({
    "uniform_bucket_level_access": true,
    "labels": {"cost-center": "cc-1234"},
  })
}

test_bucket_without_uniform_access_fails if {
  count(gcp.deny) == 1 with input as bucket({
    "uniform_bucket_level_access": false,
    "labels": {"cost-center": "cc-1234"},
  })
}

test_bucket_without_cost_center_fails if {
  count(gcp.deny) == 1 with input as bucket({"uniform_bucket_level_access": true, "labels": {}})
}

test_noop_legacy_bucket_is_ignored if {
  count(gcp.deny) == 0 with input as noop_bucket({"uniform_bucket_level_access": false, "labels": {}})
}

test_default_label_in_terraform_labels_passes if {
  count(gcp.deny) == 0 with input as bucket({
    "uniform_bucket_level_access": true,
    "labels": {},
    "terraform_labels": {"cost-center": "cc-1234"},
  })
}

test_sql_delete_without_label_fails if {
  count(gcp.deny) == 1 with input as sql_delete({"settings": [{"user_labels": {}}]})
}

test_sql_delete_with_label_passes if {
  count(gcp.deny) == 0 with input as sql_delete({"settings": [{"user_labels": {"allow-destroy": "true"}}]})
}
```

## Static scanners

Conftest enforces your rules. Scanners such as Checkov and Trivy ship hundreds of general rules for cloud misconfigurations. Use one of them for breadth and keep Rego for what is specific to you.

```bash
set -euo pipefail

# Checkov on the plan JSON; check the framework flag name for your Checkov version
checkov -f plan.json --framework terraform_plan --compact --quiet

# Checkov on the source, for code paths this plan does not exercise
checkov -d . --framework terraform --compact --quiet

# Trivy on the configuration; check the flags for your Trivy version
trivy config --severity HIGH,CRITICAL --exit-code 1 .
```

tfsec has been described as folded into Trivy; if you still run it, confirm that its checks are not duplicated by `trivy config`. Run one scanner family and one engine, not all of them: overlapping tools double the findings and the waivers. Pin the scanner version in CI, because a new release adds rules and turns a green pipeline red without any change from you.

## GitLab job

Plan in an image with Terraform, evaluate in images with the policy tools. Authenticate to GCP with short-lived federated credentials, not a key file ([[architecture/iam-groups-and-ci-workload-identity-federation]]).

```yaml title=".gitlab-ci.yml"
stages:
  - plan
  - policy

variables:
  TERRAFORM_IMAGE: "hashicorp/terraform:X.Y.Z" # change: pin an explicit Terraform tag, mirror it in Artifactory
  CONFTEST_IMAGE: "openpolicyagent/conftest:vX.Y.Z" # change: pin an explicit Conftest tag
  CHECKOV_IMAGE: "bridgecrew/checkov:X.Y.Z" # change: pin an explicit Checkov tag
  TF_ROOT: "environments/prod" # change: the Terraform root module
  TF_IN_AUTOMATION: "true"

terraform:plan:
  stage: plan
  image:
    name: ${TERRAFORM_IMAGE}
    entrypoint:
      - ""
  # change: add the Workload Identity Federation setup (id_tokens plus the credential
  # config) from [[architecture/iam-groups-and-ci-workload-identity-federation]];
  # without GCP credentials, init against a GCS backend fails
  script:
    - cd "${TF_ROOT}"
    - terraform init -input=false
    - terraform plan -input=false -out=tfplan
    - terraform show -json tfplan > plan.json
  artifacts:
    access: developer # plan files can contain secrets; limit who can download them
    expire_in: 1 hour # change: must cover the time until a manual apply that reuses this tfplan
    paths:
      - ${TF_ROOT}/tfplan
      - ${TF_ROOT}/plan.json

policy:conftest:
  stage: policy
  image:
    name: ${CONFTEST_IMAGE}
    entrypoint:
      - ""
  needs:
    - terraform:plan
  script:
    - conftest test "${TF_ROOT}/plan.json" --policy policy/terraform --namespace terraform.gcp

policy:checkov:
  stage: policy
  image:
    name: ${CHECKOV_IMAGE}
    entrypoint:
      - ""
  needs:
    - terraform:plan
  script:
    - checkov -f "${TF_ROOT}/plan.json" --framework terraform_plan --compact --quiet
```

The apply job must consume the same `tfplan` that passed the policy job, not plan again. A fresh plan can differ from the one that was checked.

## Treating plans as secrets

Terraform marks some values as sensitive in its human output, but the plan file and the JSON rendering can still contain the real values of attributes, including passwords generated by resources and data sources. Handle `tfplan` and `plan.json` as secret material:

- Restrict artifact access (the `artifacts:access` keyword; confirm the allowed values in the GitLab docs) and use a short `expire_in`.
- Never print the JSON in job logs, and never attach it to a merge request comment.
- Do not upload plans to a shared bucket or to Artifactory generic repositories without the same access controls as your state ([[runbooks/terraform-state-recovery]] shows what lives there).
- Prefer secrets that Terraform never sees, such as references to Secret Manager versions, over values passed in variables ([[patterns/external-secrets-with-secret-manager]]).
- If a plan leaks, rotate what it contained ([[runbooks/leaked-credential-rotation]]).

## Pitfalls

- Unknown values: values computed at apply time are missing from `after` and listed in `after_unknown`. Rules must treat them as "cannot judge", not as violations.
- `null` after: deletes have no `after`. Guard every access, or a delete either crashes the rule or hides a violation.
- Module sources: a remote module pulled at `init` can change between plan and review. Pin module versions and run `terraform init` in the policy pipeline with the lock file committed.
- Replace is two actions: a replacement shows `["delete", "create"]`. Check with `in`, not equality with a single action.
- Scanner overlap: the same finding reported by Checkov, Trivy and your Rego needs one waiver, not three. Decide which tool owns which class of rule.
- Policy that needs a provider attribute path (such as Cloud SQL labels) breaks when the provider changes the schema. Keep the fixtures in the Rego tests from real `terraform show -json` output of the provider version you pin.

## Verify

```bash
set -euo pipefail

# Policy unit tests pass
opa test policy/terraform --verbose

# A plan that violates a rule is rejected (exit code 1)
conftest test testdata/plan-bucket-without-uniform-access.json \
  --policy policy/terraform --namespace terraform.gcp && {
  echo "expected the gate to fail"
  exit 1
}

# The real plan is accepted
conftest test environments/prod/plan.json --policy policy/terraform --namespace terraform.gcp
```

Create the `testdata` plan from a throwaway root module that deliberately violates one rule.

## Rollback

The gate itself is a CI job. To relax it, switch the offending rule from `deny` to `warn` in the policy repository and merge; do not make the job optional for everything. For a change already applied, use the normal Terraform rollback in [[patterns/terraform-module-and-state-layout]] and, for state damage, [[runbooks/terraform-state-recovery]].

## Related

- [[patterns/terraform-module-and-state-layout]]: the plan and apply pipeline this check plugs into.
- [[patterns/terraform-testing]]: testing modules before they reach a plan.
- [[compliance/gcp-organization-policy-guardrails]]: organisation-level rules that apply to every tool.
- [[architecture/finops-cost-allocation-and-guardrails]]: the label scheme behind the cost-center rule.
- [[runbooks/terraform-state-recovery]]: what to do when state and reality diverge.
- [[patterns/conftest-policy-gate-for-manifests]]: the same approach for rendered Kubernetes manifests.
