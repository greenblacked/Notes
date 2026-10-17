---
title: Terraform module and state layout
description: A repository layout, remote state in GCS, version pinning and GitLab plan/apply flow that keep Terraform changes small, reviewable and recoverable.
type: pattern
tags:
  - patterns
  - terraform
  - gcp
  - gitlab-ci
  - ci-cd
created: 2026-10-16
modified: 2026-10-17
draft: false
---

The two decisions that shape everything later are where code lives (modules versus live configuration) and how state is split. Get them right early, because moving state is the most expensive Terraform operation. Terraform syntax and backend behaviour are documented at developer.hashicorp.com; the OpenTofu fork behaves the same for everything here, see [[terraform-vs-opentofu]].

## Repository layout

Separate reusable code from the instantiation of that code:

```text
infra/
  modules/                      # reusable, versioned, no environment knowledge
    gke-cluster/
    network/
    cloudsql/
  live/                         # one directory = one state file
    staging/
      network/
        main.tf
        backend.tf
        versions.tf
        terraform.tfvars
      gke/
      data/
    production/
      network/
      gke/
      data/
  .gitlab-ci.yml
  .tflint.hcl
```

- **`modules/`** contains no `provider` blocks, no backend, and no hard-coded project IDs. Inputs are variables, outputs are explicit. A module does one job.
- **`live/<env>/<component>/`** is a root module. Each directory has its own backend `prefix`, so each has its own state. Components are layers that change at different rates: network rarely, cluster occasionally, workloads' cloud resources often.
- Use directories per environment, not workspaces, for anything that differs between environments (see below).
- Modules can live in the same repository (referenced by relative path, which is simplest) or in a separate repository referenced by a Git tag. Move to a separate repository when several repos consume the module and you need release control.

## Remote state in GCS

Create the bucket once, outside the configuration that uses it (a small bootstrap config or a one-off script), with versioning on so a bad write can be reverted:

```bash
PROJECT_ID="my-tf-state-project"
BUCKET="my-org-tfstate"
LOCATION="europe-west1"

gcloud storage buckets create "gs://${BUCKET}" \
  --project="${PROJECT_ID}" \
  --location="${LOCATION}" \
  --uniform-bucket-level-access \
  --public-access-prevention

gcloud storage buckets update "gs://${BUCKET}" --versioning
```

Add a lifecycle rule that deletes noncurrent versions after a number of days or versions, otherwise old state versions accumulate forever. Restrict access: only the CI identities and a small admin group may read or write the bucket, because state can contain secrets in plain text.

```hcl title="live/production/gke/backend.tf"
terraform {
  backend "gcs" {
    bucket = "my-org-tfstate"
    prefix = "production/gke"
  }
}
```

- The GCS backend locks state automatically while an operation runs, so concurrent applies against the same prefix fail rather than corrupt it.
- Backend blocks cannot use variables. Keep one literal `backend.tf` per root module, or pass `-backend-config` at `init` if you want to template it.
- Name prefixes `<env>/<component>` so the bucket listing mirrors the repository.
- Recovering a damaged or lost state is covered in [[terraform-state-recovery]].

## Version pinning

Pin everything that can change behaviour:

```hcl title="live/production/gke/versions.tf"
terraform {
  required_version = "~> 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}
```

- Use a pessimistic constraint (`~>`) on providers and commit `.terraform.lock.hcl`. The lock file pins exact provider versions and checksums; update it deliberately with `terraform init -upgrade` in its own merge request. The versions shown are examples; check the current provider releases before copying them.
- Pin `required_version` and use the same Terraform version in CI as locally (the CI image tag, or a `.terraform-version` file for tfenv or similar).
- Pin modules: `source = "git::https://gitlab.example.com/platform/tf-modules.git//gke-cluster?ref=v2.4.1"`. For local relative paths the version is the commit, which is fine within one repository.
- If you target several platforms, generate lock entries for each with `terraform providers lock -platform=linux_amd64 -platform=darwin_arm64`.

## Workspaces or directories

|                          | Workspaces                                               | Directories per environment                    |
| ------------------------ | -------------------------------------------------------- | ---------------------------------------------- |
| State                    | Same backend, separate state per workspace               | Separate backend prefix per directory          |
| Differences between envs | Conditionals on `terraform.workspace`                    | Plain different values, or different resources |
| Blast radius             | One wrong `workspace select` hits production             | You have to `cd` into production explicitly    |
| Review                   | Diff shows no env difference                             | Diff shows exactly which env changes           |
| Fit                      | Many identical short-lived copies (feature environments) | Long-lived staging and production              |

Use directories for long-lived environments. Use workspaces only for ephemeral clones of the same configuration. Do not use workspaces to separate production from non-production; separate projects and state buckets with separate IAM are a stronger boundary.

## CI plan and apply in GitLab

The flow: every merge request runs `fmt`, `validate`, lint and `plan`, and posts the plan; merging to the default branch re-plans and requires a manual job to apply the exact saved plan. Applying a saved plan file means what was reviewed is what runs. The structure of the pipeline follows [[gitlab-ci-pipeline-structure]].

> [!info] Check the WIF wiring against current docs
> The Workload Identity Federation wiring below follows the GitLab and Google Cloud WIF documentation. Check both for the current flags and token claims before copying it.

The credential config file tells Google's auth libraries where the OIDC token file is and which service account to impersonate. It holds no secret, so generate it once per service account, outside the Terraform jobs (the `hashicorp/terraform` image has no `gcloud`), and commit the result:

```bash
# Placeholders: replace with your own values.
GCP_PROJECT_NUMBER="123456789012"
WIF_POOL="gitlab-pool"
WIF_PROVIDER="gitlab-provider"
PLAN_SA="tf-plan@my-project.iam.gserviceaccount.com"
APPLY_SA="tf-apply@my-project.iam.gserviceaccount.com"

for ROLE in plan apply; do
  SA_VAR="${ROLE^^}_SA"   # PLAN_SA or APPLY_SA
  gcloud iam workload-identity-pools create-cred-config \
    "projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}" \
    --service-account="${!SA_VAR}" \
    --credential-source-file=/tmp/oidc_token \
    --output-file="ci/gcp-${ROLE}-creds.json"
done
```

Check the flags with `gcloud iam workload-identity-pools create-cred-config --help`. The file stores the token path literally, so use a fixed absolute path that every job writes to (`/tmp/oidc_token` here). The Terraform jobs then only write the job's OIDC token to that path:

```yaml title=".gitlab-ci.yml"
variables:
  TF_IMAGE: hashicorp/terraform:1.9
  TF_DIR: live/production/gke
  TF_IN_AUTOMATION: "true"
  # Placeholders: replace with your own values.
  GCP_PROJECT_NUMBER: "123456789012"
  WIF_POOL: gitlab-pool
  WIF_PROVIDER: gitlab-provider

stages: [validate, plan, apply]

.terraform:
  image:
    name: $TF_IMAGE
    entrypoint: [""]
  id_tokens:
    GITLAB_OIDC_TOKEN:
      aud: https://iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}
  before_script:
    # Each job sets $GCP_CRED_FILE to the committed credential config of the
    # service account it should impersonate (generated with the command above).
    - echo "$GITLAB_OIDC_TOKEN" > /tmp/oidc_token
    - export GOOGLE_APPLICATION_CREDENTIALS="$CI_PROJECT_DIR/$GCP_CRED_FILE"
    - cd "$TF_DIR"
    - terraform init -input=false

validate:
  extends: .terraform
  stage: validate
  variables:
    GCP_CRED_FILE: ci/gcp-plan-creds.json
  script:
    - terraform fmt -check -recursive
    - terraform validate

plan:
  extends: .terraform
  stage: plan
  variables:
    GCP_CRED_FILE: ci/gcp-plan-creds.json
  # The plan identity must be read-only (for example roles/viewer plus storage
  # object read on the state bucket). The WIF provider attribute condition must
  # restrict which projects and branches can use each service account.
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - terraform plan -input=false -out=tfplan
    - terraform show -json tfplan > tfplan.json
  artifacts:
    # check the artifacts:access values your GitLab version supports
    access: developer
    paths:
      - $TF_DIR/tfplan
      - $TF_DIR/tfplan.json
    expire_in: 1 day

apply:
  extends: .terraform
  stage: apply
  needs: [plan]
  variables:
    GCP_CRED_FILE: ci/gcp-apply-creds.json
  # The apply service account's WIF binding must be restricted to protected
  # default-branch pipelines (attribute condition on ref_protected / ref).
  script:
    - terraform apply -input=false tfplan
  resource_group: production-gke
  environment:
    name: production/gke
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual
      allow_failure: false
```

- The plan file contains the full planned values, including secrets. Keep artifact access restricted and expiry short.
- A plan goes stale: if state changes between plan and apply, `apply tfplan` refuses to run. That is the desired behaviour; re-run the pipeline.
- Use `resource_group` so two pipelines cannot apply to the same state at once, in addition to the backend lock.
- For many components, generate one job per directory with `rules:changes` or a parent-child pipeline, and order dependent layers with `needs`.
- The example authenticates to Google Cloud with short-lived credentials from GitLab OIDC through Workload Identity Federation, with separate plan and apply identities, not a downloaded service account key. The idea is the same as [[gke-workload-identity]] but for CI.
- GitLab also offers a managed Terraform state backend over HTTP. It is a valid alternative, but the GCS layout above keeps state inside your own GCP projects and IAM.

## Drift detection

Drift is any difference between real infrastructure and the code. Detect it on a schedule rather than when someone next applies:

```bash
cd live/production/gke
terraform init -input=false
terraform plan -input=false -detailed-exitcode -lock=false
echo "exit code: $?"
```

With `-detailed-exitcode`, exit code 0 means no changes, 1 means an error, and 2 means changes are pending. Run it from a GitLab scheduled pipeline, treat 2 as a failure that notifies the owning team, and open an issue with the plan output. `-lock=false` stops a read-only check from blocking a real apply; do not use it for applies. Decide for each drift whether to revert it (apply) or adopt it (change the code).

## Policy checks

Run these in the merge request before the plan is approved:

- `terraform fmt -check` and `terraform validate` for hygiene.
- `tflint` for provider-specific mistakes.
- A static scanner such as Checkov or Trivy's config scanning for insecure defaults (public buckets, open firewall rules).
- Policy-as-code on the plan JSON (`tfplan.json`) with OPA and Conftest: deny deletion of stateful resources, require labels, forbid public IPs. HashiCorp Sentinel does the same but is part of HCP Terraform and Terraform Enterprise. Details: [[patterns/terraform-plan-policy-checks]].
- Branch protection plus a required reviewer from the platform team for `live/production/**`, via CODEOWNERS.

## Pitfalls

- A single giant state for everything: slow plans, large blast radius, locking contention. Split by component and by environment.
- Local state or state committed to Git. Never.
- `terraform apply` from laptops against production. Remove human write access to the bucket and apply only from CI.
- Cross-state references with `terraform_remote_state` create hidden coupling. Prefer passing values explicitly or reading them with data sources.
- Renaming a resource without a `moved` block destroys and recreates it. Use `moved` blocks for refactors and review plans for any `destroy`.
- Provider upgrades mixed with feature changes. Upgrade in isolation.

## Verify

- A merge request pipeline shows a `plan` job with the planned changes and no apply job.
- A default-branch pipeline shows a manual `apply` job bound to the plan from the same pipeline.

## Rollback

Revert the merge request and re-apply through the same pipeline. If state itself is damaged, see [[terraform-state-recovery]].

## Related

- [[production-change-checklist]]: review items for any production infrastructure change.
- [[kubernetes-resource-requests-and-limits]]: Autopilot and node sizing decisions that end up in this code.
- [[patterns/terraform-testing]]: static checks, `terraform test` and Terratest for modules.
