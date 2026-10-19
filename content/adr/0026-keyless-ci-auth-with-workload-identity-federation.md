---
title: Keyless CI authentication with Workload Identity Federation
description: GitLab CI and Jenkins exchange their own OIDC tokens for short-lived Google credentials, and service account key creation is blocked by organization policy.
type: adr
tags:
  - adr
  - gcp
  - security
  - ci-cd
  - gitlab-ci
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0026
---

## Context

CI jobs that touch Google Cloud (Terraform applies, image pushes, deploy tooling) historically used JSON service account keys stored as CI variables. Those keys do not expire by default, are copied into runners, logs and laptops, and were shared between pipelines. A leaked key works from anywhere until someone notices and rotates it, which is slow and breaks things.

Both GitLab CI and Jenkins can present an OIDC identity token for a job. Google Cloud Workload Identity Federation (WIF) can trust that token and exchange it for short-lived credentials, with no secret stored anywhere.

## Decision

CI authenticates to Google Cloud with **Workload Identity Federation**. Service account keys are not created.

- One workload identity **pool** per environment, with one **provider** per CI system (GitLab, Jenkins).
- The provider has an **attribute condition** pinned to the project path and a protected ref. A broad condition (for example the whole GitLab instance) is the main risk of this design, because any job that can mint a token would qualify.
- Each environment has its own service account to impersonate, with least-privilege roles. Production deploy permissions are never reachable from unprotected branches.
- GitLab jobs request a token with `id_tokens:` and exchange it; Jenkins uses its OIDC provider plugin (check the plugin and its current maintenance status).
- Organization policy `iam.disableServiceAccountKeyCreation` is enforced at the organization or on folders ([[0024-gcp-folders-by-policy-boundary]]), with exceptions recorded and time-boxed.
- Existing keys are inventoried, replaced, then deleted ([[leaked-credential-rotation]] covers the emergency path).

```yaml title=".gitlab-ci.yml"
deploy:production:
  stage: deploy
  image: registry.example.com/platform/gcloud:pinned
  id_tokens:
    GCP_ID_TOKEN:
      aud: https://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/ci-prod/providers/gitlab
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
  script:
    # Keep the token outside the project directory so no artifacts: or cache: path can pick it up
    - CRED_DIR="$(mktemp -d)"
    - echo "${GCP_ID_TOKEN}" > "${CRED_DIR}/id_token"
    - gcloud iam workload-identity-pools create-cred-config
      projects/123456789012/locations/global/workloadIdentityPools/ci-prod/providers/gitlab
      --service-account=deployer@example-prod.iam.gserviceaccount.com
      --credential-source-file="${CRED_DIR}/id_token"
      --output-file="${CRED_DIR}/wif.json"
    - export GOOGLE_APPLICATION_CREDENTIALS="${CRED_DIR}/wif.json"
    - gcloud auth login --cred-file="${GOOGLE_APPLICATION_CREDENTIALS}"
```

```hcl title="wif.tf"
resource "google_iam_workload_identity_pool_provider" "gitlab" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.ci_prod.workload_identity_pool_id
  workload_identity_pool_provider_id = "gitlab"

  attribute_mapping = {
    "google.subject"         = "assertion.sub"
    "attribute.project_path" = "assertion.project_path"
    "attribute.ref_protected" = "assertion.ref_protected"
  }

  attribute_condition = "assertion.project_path == 'platform/infra' && assertion.ref_protected == 'true'"

  oidc {
    issuer_uri = "https://gitlab.example.com"
  }
}
```

> [!info] Claims not checked against current docs
> The exact `gcloud` flags and token audience format, the claim names GitLab emits (`project_path`, `ref_protected`), the Jenkins OIDC plugin name and status, and the `iam.disableServiceAccountKeyCreation` constraint name. Check the WIF and GitLab Google Cloud integration pages.

## Consequences

Easier:

- No long-lived secret to leak, rotate or find in logs; credentials last for the job.
- Access is tied to a repository and a protected ref, which gives a meaningful audit trail.
- The same pattern serves Terraform ([[0035-terraform-plan-policy-gate-and-ci-only-apply]]) and image signing ([[0037-keyless-cosign-image-signing]]).

Harder or newly required:

- The attribute condition is security-critical and needs review like any IAM change.
- The CI system's OIDC issuer becomes part of the trust chain; if GitLab or Jenkins is compromised, so is what it can impersonate.
- Debugging token exchange failures needs WIF and STS audit logs.
- A few legacy tools only accept key files and need wrappers or replacement.

## Alternatives considered

- **JSON keys in Secret Manager or CI variables.** The status quo; long-lived and copyable. Rejected.
- **Service accounts attached to the runner nodes.** Every job on the runner shares the same identity, so isolation between projects is lost. Acceptable only for a dedicated, protected deploy runner ([[0014-gitlab-runners-kubernetes-executor-on-gke]]).
- **Short-lived keys minted by a broker service.** Another system to run and secure for no gain over WIF.

## Validation

```bash
set -o pipefail
PROJECT_ID="example-prod"

# No user-managed keys on any service account (expect no key lines)
for sa in $(gcloud iam service-accounts list --project="${PROJECT_ID}" --format='value(email)'); do
  gcloud iam service-accounts keys list --iam-account="${sa}" \
    --managed-by=user --format='value(name)' | sed "s|^|${sa}: |"
done

# Provider condition (review that it names the exact project and protected refs)
gcloud iam workload-identity-pools providers describe gitlab \
  --project="${PROJECT_ID}" --location=global --workload-identity-pool=ci-prod \
  --format='value(attributeCondition)'
```

## References

- Workload Identity Federation: https://cloud.google.com/iam/docs/workload-identity-federation
- GitLab Google Cloud integration: https://docs.gitlab.com/ci/cloud_services/google_cloud/
- Related notes: [[iam-groups-and-ci-workload-identity-federation]], [[gke-workload-identity]], [[leaked-credential-rotation]]
- Related ADRs: [[0014-gitlab-runners-kubernetes-executor-on-gke]], [[0035-terraform-plan-policy-gate-and-ci-only-apply]], [[0037-keyless-cosign-image-signing]]
