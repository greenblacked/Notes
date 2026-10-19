---
title: Terraform plan policy gate and CI-only apply
description: Every merge request runs plan plus policy checks, applies run only from CI after approval, and local apply is a logged break-glass action.
type: adr
tags:
  - adr
  - terraform
  - ci-cd
  - security
  - policy-as-code
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0035
---

## Context

When engineers apply from their laptops, three things go wrong. The applied code may differ from what was reviewed. Powerful cloud credentials sit on personal devices. And there is no record of who changed production infrastructure, why, and what the plan said. Reviewers also cannot easily judge risk from HCL alone: a one-line change can destroy a database.

## Decision

Infrastructure changes follow one path: merge request, plan, policy check, approval, CI apply.

1. Every MR runs `terraform plan` and stores the plan output as a job artifact with a short expiry. Plan files are treated as secrets because they can contain sensitive values (see [[0032-terraform-state-in-gcs-per-environment]]).
2. The plan is converted with `terraform show -json` and evaluated by Conftest policies (see [[terraform-plan-policy-checks]]): for example no public buckets, no deletes of protected resource types without a labelled exception, and required labels on every resource.
3. Apply runs only from CI on the protected default branch, after merge, in a **protected environment** that requires an approval for production. The approver is not the author (see [[separation-of-duties-in-deployments]]).
4. The apply job applies the saved plan from the approved pipeline, not a fresh plan, so the reviewed change is the applied change.
5. Each environment has its own CI identity, obtained through Workload Identity Federation (see [[0026-keyless-ci-auth-with-workload-identity-federation]]). Non-production identities cannot touch production.
6. **Break-glass.** A local apply is allowed only when CI is unavailable during an incident. It uses a time-boxed elevated grant, requires a ticket reference, is announced in the incident channel, and is followed by a reconciling MR within one working day. Cloud Audit Logs record the grant.

```yaml title=".gitlab-ci.yml (excerpt)"
plan:
  stage: plan
  script:
    - terraform init -input=false
    - terraform plan -input=false -out=tfplan
    - terraform show -json tfplan > tfplan.json
    - conftest test --policy policy/ tfplan.json
  artifacts:
    paths: [tfplan, tfplan.json]
    expire_in: 1 day

apply:
  stage: apply
  script:
    - terraform apply -input=false tfplan
  environment:
    name: production
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual
  needs: [plan]
```

> [!info] Claims not checked against current docs
> GitLab protected-environment approval settings, and whether artifacts from a pre-merge plan can be reused after merge. A plan from the merge request pipeline is stale if the target branch moved, so many teams re-plan on the default branch and require a second approval. Decide this per environment and check the current GitLab documentation.

## Consequences

Easier:

- A complete audit trail: MR, plan, policy result, approver and apply log are linked.
- Dangerous changes are caught mechanically before a human reads the diff.
- No standing cloud-admin credentials on laptops.

Harder:

- Applies take pipeline time. For emergencies the break-glass path exists, and it must be rehearsed.
- Policies need owners and tests, or they become noise. Roll new rules out in warn mode first (see [[policy-rollout-audit-to-enforce]]).
- A stale plan between plan and apply must be handled explicitly, or applies fail.
- Pipeline evidence supports change-management controls (see [[change-management-controls-and-pipeline-evidence]]). That is engineering practice, not audit advice.

## Alternatives considered

- **Local applies by trusted engineers.** Fast, but unreviewed and unrecorded. Rejected.
- **Atlantis.** Gives plan and apply by MR comment. Reasonable, but adds a long-running service with cloud credentials. Not chosen because the CI system already provides the same flow.
- **HCP Terraform runs.** Provides a managed run and policy path. Depends on the outcome of [[0031-terraform-or-opentofu]] and on licence terms; check current terms.

## Validation

```bash title="validate-ci-only-apply.sh"
set -euo pipefail
PROJECT_ID="example-prod-platform"

# Humans with powerful roles on the project (expected: only the break-glass group)
gcloud projects get-iam-policy "${PROJECT_ID}" --format=json \
  | jq -r '.bindings[] | select(.role=="roles/owner" or .role=="roles/editor") | .members[]'

# Recent state-changing admin activity by a human (expected: none outside break-glass)
gcloud logging read \
  'logName:"cloudaudit.googleapis.com%2Factivity" AND protoPayload.authenticationInfo.principalEmail:"@example.com" AND NOT protoPayload.authenticationInfo.principalEmail:"gserviceaccount.com"' \
  --project="${PROJECT_ID}" --limit=20 --freshness=7d
```

## References

- terraform plan: https://developer.hashicorp.com/terraform/cli/commands/plan
- Conftest: https://www.conftest.dev/
- GitLab protected environments: https://docs.gitlab.com/ci/environments/protected_environments/

Related notes:

- [[terraform-plan-policy-checks]]
- [[change-management-controls-and-pipeline-evidence]]
- [[separation-of-duties-in-deployments]]
- [[0026-keyless-ci-auth-with-workload-identity-federation]]
- [[0032-terraform-state-in-gcs-per-environment]]
