---
title: Access reviews and least privilege on GCP and GKE
description: Run a quarterly access review for GCP IAM, GKE RBAC, CI service accounts and break-glass accounts, and keep evidence of it.
type: pattern
tags:
  - compliance
  - gcp
  - gke
  - security
  - audit
created: 2026-10-17
modified: 2026-10-17
draft: false
aliases:
  - access-recertification
---

This note describes a quarterly access review for a GCP organisation with GKE clusters: build an inventory, send it to the owners, remove what is not needed, and record the result. It is written for senior DevOps engineers who have to run the review and hand the evidence to an auditor. Designing the groups and CI identities in the first place is covered in [[architecture/iam-groups-and-ci-workload-identity-federation]], and where the evidence is stored is covered in [[compliance/audit-evidence-collection-and-retention]].

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Scope and sources
> Written for Google Cloud IAM, Cloud IAM Recommender and GKE with Kubernetes RBAC, using the `gcloud` and `kubectl` command-line tools. Based on the Google Cloud documentation for IAM, service account keys and the Recommender, and on the Kubernetes documentation for RBAC authorization. Frameworks such as SOC 2 and ISO 27001 ask for periodic user access reviews in general terms; this note does not cite control numbers.

## What to review

A review is only useful if every access path has a named owner who can say "yes, still needed". List the paths first, then decide cadence.

| System                           | Principals                                        | Owner who confirms          | Cadence                    |
| -------------------------------- | ------------------------------------------------- | --------------------------- | -------------------------- |
| GCP organisation and folders     | Groups, users, service accounts with roles        | Platform lead               | Quarterly                  |
| GCP projects (per environment)   | Groups, users, service accounts with roles        | Project or product owner    | Quarterly                  |
| GKE RBAC (per cluster)           | Groups and users bound to ClusterRoles and Roles  | Platform lead               | Quarterly                  |
| CI service accounts and keys     | GitLab CI and Jenkins identities, deploy accounts | Pipeline owner              | Quarterly, keys monthly    |
| Break-glass accounts             | Emergency admin users or groups                   | Security lead               | Quarterly, plus after use  |
| Third-party and contractor users | External identities with any of the above         | Sponsor named at onboarding | Monthly or at contract end |

Review groups rather than individual users wherever you can. If access is granted only through groups, the review is "who is in each group and does each role still fit the group", which is a much smaller list than every binding in every project. A binding to a single user is itself a finding.

## Inventory commands

The script below exports the data an owner needs to review: IAM bindings per project, service accounts, user-managed keys and Recommender output. It only reads. Run it with an identity that has viewer access to the inventory, not with an administrator.

```bash title="scripts/access-review-inventory.sh"
set -euo pipefail

# Change these values before running.
ORG_ID="123456789012"                       # change: your organisation ID
PROJECTS=("my-project-prod" "my-project-stage")  # change: projects in scope for this review
OUT_DIR="access-review-$(date +%Y-%m-%d)"   # output folder, one per review run
RECOMMENDER_ID="google.iam.policy.Recommender"  # check: confirm the recommender ID in the current docs

mkdir -p "${OUT_DIR}"

# Organisation level bindings (who has what above the projects)
gcloud organizations get-iam-policy "${ORG_ID}" \
  --flatten="bindings[].members" \
  --format="csv(bindings.role,bindings.members)" \
  > "${OUT_DIR}/org-iam.csv"

for PROJECT_ID in "${PROJECTS[@]}"; do
  # One row per role and member
  gcloud projects get-iam-policy "${PROJECT_ID}" \
    --flatten="bindings[].members" \
    --format="csv(bindings.role,bindings.members)" \
    > "${OUT_DIR}/${PROJECT_ID}-iam.csv"

  # Service accounts in the project
  gcloud iam service-accounts list \
    --project="${PROJECT_ID}" \
    --format="csv(email,displayName,disabled)" \
    > "${OUT_DIR}/${PROJECT_ID}-service-accounts.csv"

  # User-managed keys for each service account (any row here is a finding to explain)
  : > "${OUT_DIR}/${PROJECT_ID}-sa-keys.csv"
  while read -r SA_EMAIL; do
    gcloud iam service-accounts keys list \
      --iam-account="${SA_EMAIL}" \
      --managed-by=user \
      --format="csv[no-heading](name.basename(),validAfterTime,validBeforeTime)" \
      | sed "s|^|${SA_EMAIL},|" >> "${OUT_DIR}/${PROJECT_ID}-sa-keys.csv"
  done < <(gcloud iam service-accounts list --project="${PROJECT_ID}" --format="value(email)")

  # IAM Recommender output: roles that look unused or too broad (a hint, not a decision)
  gcloud recommender recommendations list \
    --project="${PROJECT_ID}" \
    --location=global \
    --recommender="${RECOMMENDER_ID}" \
    --format=json \
    > "${OUT_DIR}/${PROJECT_ID}-recommender.json"
done

echo "Inventory written to ${OUT_DIR}"
```

Notes on the script:

- The organisation file shows inherited access. A project owner cannot review what is granted above the project, so the platform lead reviews it.
- Users and groups appear as `user:`, `group:` and `serviceAccount:` prefixes in the member column. Sort and filter on the prefix to split the review into human and machine access.
- Keep the raw CSV files with the review record. They show what the reviewers saw at the time.

## Using IAM Recommender carefully

The IAM Recommender compares granted permissions with permissions observed in use over a period, and suggests replacing a role with a smaller one or removing it. It is a good source of candidates, and a poor source of decisions.

- Recommendations are based on observed activity. Access used once a year (disaster recovery, year-end jobs, break-glass) looks unused.
- Not every permission is covered by usage data, so a suggestion to drop a role may remove something that is needed but not logged. Test the smaller role in a non-production project first.
- Apply recommendations through code (Terraform), not in the console, so the next apply does not undo them.
- Record each recommendation as "applied", "declined with reason" or "deferred", the same as any other finding.

> [!note] Not verified
> The claims below were written from documentation knowledge and were not checked against a running system or the current docs: the recommender type ID `google.iam.policy.Recommender`, the length of the observation window the Recommender uses, and the exact `gcloud` flag names and `--format` projections in the script. Check them before relying on them.

## GKE RBAC review

IAM roles decide who can reach the cluster API. Kubernetes RBAC decides what they can do inside it. Review both, starting with the strongest binding.

```bash title="Subjects bound to cluster-admin"
set -euo pipefail

# Change the context before running: the cluster to review.
CONTEXT="gke_my-project-prod_europe-west1_prod-1"  # change: kubectl context of the cluster

kubectl --context "${CONTEXT}" get clusterrolebindings -o json \
  | jq -r '
      .items[]
      | select(.roleRef.name == "cluster-admin")
      | .metadata.name as $binding
      | (.subjects // [])[]
      | [$binding, .kind, .name, (.namespace // "")]
      | @csv'
```

Every row should be explainable. Expect the system bindings that GKE creates (names starting with `system:`); the rest should be a short list of groups. A `User` subject bound to `cluster-admin` is a finding. Also review the following:

- Bindings to `system:authenticated` or `system:unauthenticated`, which grant access to everyone who can reach the API.
- Roles that allow `*` verbs or resources, `secrets` read across namespaces, `pods/exec`, or `impersonate`.
- Namespaced `RoleBinding` objects that reference a `ClusterRole` such as `admin` or `edit` for a person rather than a group.

For day-to-day access, bind a group to a namespaced role with the least role that fits. This example grants a team the built-in `edit` role in a single namespace.

```yaml title="rbac/payments-team-edit.yaml"
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: payments-team-edit
  namespace: payments # change: the team's namespace
subjects:
  - apiGroup: rbac.authorization.k8s.io
    kind: Group
    name: gke-security-groups-payments@example.com # change: group used with Google Groups for RBAC, check the exact format for your setup
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: edit
```

Keep these manifests in Git and apply them through your GitOps tool (see [[adr/0001-gitops-with-argocd]]). Then the review compares what Git says with what the cluster has, and any binding that exists only in the cluster is drift to explain.

## Service accounts and keys

Machine access grows quietly, so review it more often than human access.

- Every service account needs an owner, a purpose in its description and a project. A service account with no owner is disabled first and deleted after a waiting period.
- User-managed keys should be absent. The inventory lists them with `--managed-by=user`. For each key found, either remove it or write down why it must exist and when it will be rotated. Replace keys with federation: [[patterns/gke-workload-identity]] for Pods and the CI federation described in [[architecture/iam-groups-and-ci-workload-identity-federation]] for GitLab CI and Jenkins.
- Check who can impersonate each service account (`roles/iam.serviceAccountTokenCreator`, `roles/iam.serviceAccountUser`). That permission is effectively the service account's own access.
- A key that is found in a repository or log is not a review finding, it is an incident: follow [[runbooks/leaked-credential-rotation]].

## Break-glass accounts

Break-glass access exists for outages when the normal route (SSO, a group, a CI pipeline) is not working. The review checks that it is rare, visible and still works.

- Keep the list short and named: which accounts or group, who holds the credentials, and where they are stored.
- Alert on every use, and require a ticket or incident reference afterwards. Each use is reviewed within a few days, not at the next quarterly review.
- Test the access on a schedule, in a non-production project, so you know it works before the night you need it. Record the test.
- Rotate the credentials after any use and after any change in who holds them.
- Check that the account is not used for routine work. Audit logs showing weekly use mean the normal route is missing something.

## Recording the review

The record is what you show an auditor, so make it complete and short. One record per review, stored with the raw exports as described in [[compliance/audit-evidence-collection-and-retention]].

```text title="access-review-record.md"
Access review: 2026-Q4
Scope: org my-org, projects my-project-prod and my-project-stage, clusters prod-1 and stage-1
Review window: 2026-10-01 to 2026-10-14
Run by: <name>          Approved by: <name>          Date approved: <date>

Data pulled (file, pulled at, by):
- org-iam.csv, 2026-10-01 09:12 UTC, <name>
- my-project-prod-iam.csv, 2026-10-01 09:14 UTC, <name>
- my-project-prod-sa-keys.csv, 2026-10-01 09:15 UTC, <name>
- clusterrolebindings (cluster-admin), 2026-10-01 09:20 UTC, <name>

Owner confirmations:
| Area              | Owner  | Sent       | Answered   | Result            |
| ----------------- | ------ | ---------- | ---------- | ----------------- |
| Org IAM           | <name> | 2026-10-02 | 2026-10-05 | 2 removals        |
| Prod project IAM  | <name> | 2026-10-02 | 2026-10-09 | 5 removals        |
| GKE RBAC prod-1   | <name> | 2026-10-02 | 2026-10-06 | 1 binding changed |
| CI service accts  | <name> | 2026-10-02 | 2026-10-08 | 3 keys removed    |
| Break-glass       | <name> | 2026-10-02 | 2026-10-03 | Test passed       |

Changes made (link to merge request or ticket for each):
- <MR or ticket>: removed role X from group Y
- <MR or ticket>: deleted key Z on service account S

Exceptions kept (reason, owner, review-by date):
- <principal>, <role>, <reason>, <owner>, <date>

Recommender items: applied <n>, declined <n> (reasons in tickets), deferred <n>
Not answered by deadline: <list>, escalated to <name> on <date>
```

Treat a missing answer as a failed review item, not as consent. Escalate it, and if the owner still does not answer, remove the access and let them ask for it back.

## Joiner, mover, leaver

A quarterly review catches what the daily process missed. If the daily process is good, the review has little to remove.

- **Joiner**: access comes from group membership requested by the manager, with the role defined by the team's template. No one is granted project roles directly. Include the access steps in [[management/onboarding-engineers]].
- **Mover**: when someone changes team, remove the old team's groups in the same change that adds the new ones. Movers are where most excess access comes from, because nobody is asked to give anything up.
- **Leaver**: disable the identity in the identity provider on the last day, which removes group membership. Then check for direct bindings, personal service accounts, API keys and SSH keys that the identity provider does not control. The inventory finds these.
- Make the HR or ticketing system the trigger, and compare it with the identity provider list as part of each quarterly review: anyone who left and still appears is a finding.

## Pitfalls

- **Reviewing only IAM.** A user with a viewer role in GCP can still hold `cluster-admin` through a stale RBAC binding. Review both layers.
- **Rubber-stamping.** An owner who answers "all fine" within minutes did not look. Send a short list with differences since the last review, and ask for removals, not approvals.
- **Trusting the Recommender blindly.** It cannot see access that is needed rarely. Test, and keep a rollback in Git.
- **Fixing in the console.** The next Terraform apply restores the access. Make every removal a code change.
- **Reviewing inherited access only at project level.** Folder and organisation bindings reach every project below them.
- **No evidence of the data pulled.** If the exports are not saved with a timestamp, the auditor cannot tell what the reviewers saw.
- **Break-glass credentials that no one has tested.** They fail on the day they are needed.

## Verify

After removals, confirm that the access is really gone and that nothing broke.

```bash
set -euo pipefail

PROJECT_ID="my-project-prod"      # change: project you changed
MEMBER="group:payments-dev@example.com"  # change: the member you removed a role from

# The member should no longer hold the removed role
gcloud projects get-iam-policy "${PROJECT_ID}" \
  --flatten="bindings[].members" \
  --filter="bindings.members:${MEMBER}" \
  --format="table(bindings.role)"

# Deployments still work: run the pipeline against stage and check the result
kubectl --context "gke_my-project-stage_europe-west1_stage-1" auth can-i create deployments -n payments
```

Expected: the first command lists only the roles you meant to keep, and `kubectl auth can-i` prints `yes` for identities that must still deploy.

## Rollback

Every removal is a code change, so a rollback is a revert of that merge request followed by an apply. For urgent access during an outage, use a break-glass account, then restore the binding through code and record why in the review record. Do not re-add a role by hand and leave it.

## Related

- [[architecture/iam-groups-and-ci-workload-identity-federation]]: how to structure groups and CI identities so the review stays small.
- [[patterns/gke-workload-identity]]: replaces service account keys for Pods.
- [[runbooks/leaked-credential-rotation]]: what to do when a review (or anyone) finds an exposed key.
- [[compliance/audit-evidence-collection-and-retention]]: where to store the exports and the signed record.
- [[management/onboarding-engineers]]: the joiner steps that feed this review.
