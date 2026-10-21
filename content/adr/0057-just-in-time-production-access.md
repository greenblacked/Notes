---
title: No standing human write access to production; elevation is just in time and audited
description: People hold read-only roles in production; write access comes only from time-bound, justified, approved grants, with a monitored break-glass path.
type: adr
tags:
  - adr
  - gcp
  - gke
  - security
  - audit
status: accepted
created: 2026-10-21
modified: 2026-10-21
decided: 2026-10-21
draft: false
aliases:
  - ADR-0057
---

## Context

[[0032-terraform-state-in-gcs-per-environment|ADR-0032]] and [[0035-terraform-plan-policy-gate-and-ci-only-apply|ADR-0035]] already take Terraform applies away from people: production changes go through CI. Both mention a break-glass group, but no record says what humans may hold in production otherwise, or how they get more when an incident needs it. [[privileged-access-just-in-time-gcp-gke]] compares the options without choosing.

Without a decision, standing access accumulates:

- **Owner and Editor stay forever.** Basic roles granted "for the migration" or "for on-call" are rarely removed, and each one can change almost anything in the project.
- **Access reviews keep finding the same drift** ([[access-reviews-gcp-and-gke]]): individuals bound directly, leavers' grants left behind, `cluster-admin` bindings nobody remembers.
- **A stolen session is as powerful as its owner.** A phished laptop session with standing Editor in production needs no further step to do damage.
- **Separation of duties is unprovable** ([[separation-of-duties-in-deployments]]): if the same people can change production directly at any time, the review gate in CI is advisory.

Google Cloud **Privileged Access Manager (PAM)** provides time-bound elevation natively: an **entitlement** defines which roles on which resource can be requested, by whom, for how long at most, with what justification, and who approves; a **grant** is one approved request, removed automatically when it expires. It is managed with `gcloud pam` and the Terraform resource `google_privileged_access_manager_entitlement`, which fits [[0030-terraform-manages-gcp-infrastructure]].

## Decision

**No human holds a standing role that can change production. People hold read-only roles; write access is requested just in time through Privileged Access Manager entitlements that have a maximum duration, a required justification and an approver. A break-glass group, under a two-person rule and with alerting, covers the case where PAM itself cannot be used. Grants are reviewed every week.**

### Standing access in production

- **Read-only roles only**, granted to Google groups: predefined viewer roles for the services the team runs (for example `roles/container.viewer`, `roles/logging.viewer`, `roles/monitoring.viewer`), and Kubernetes RBAC `view` bound to the team's Google group through Google Groups for RBAC.
- **No basic roles** (`roles/owner`, `roles/editor`, `roles/viewer`) for any human or group in production projects or folders.
- **Shell access without sudo** through OS Login and IAP counts as read access ([[0056-vm-access-through-os-login-and-iap]]). Sudo (`roles/compute.osAdminLogin`) is write access and comes only from an entitlement.
- **Service accounts are out of scope** of this record: CI identities ([[0026-keyless-ci-auth-with-workload-identity-federation]]) and workload identities ([[0052-workload-identity-for-gke-pods]]) keep the least-privilege roles they need to run and deploy.

### Entitlements

Entitlements are defined in Terraform per production project (or folder, for platform-wide ones), owned by the platform security lead, and built **in advance** for the situations on-call meets, so that nobody designs access during an incident.

| Entitlement        | Role(s) granted                         | Scope                          | Max duration | Eligible             | Approval                                            |
| ------------------ | --------------------------------------- | ------------------------------ | ------------ | -------------------- | --------------------------------------------------- |
| `oncall-gke-write` | `roles/container.developer`             | Workload project               | 4 h          | Team on-call group   | One step: the team's leads group                    |
| `oncall-vm-admin`  | `roles/compute.osAdminLogin`            | Workload project               | 2 h          | Team operators group | One step: the team's leads group                    |
| `db-admin`         | `roles/cloudsql.admin`                  | Data project                   | 2 h          | DBA group            | One step: platform on-call leads                    |
| `state-recovery`   | `roles/storage.objectAdmin`             | Terraform state bucket project | 1 h          | Platform group       | Security group; platform lead signs the ticket      |
| `iam-admin`        | `roles/resourcemanager.projectIamAdmin` | Workload project               | 1 h          | Platform group       | Security group; platform lead signs the ticket      |

- **Justification is required** on every entitlement and must name an incident, change or ticket reference.
- **The approver group never equals the eligible group**, and nobody is a member of both for the same entitlement. Whether PAM itself prevents self-approval was not checked, so this is enforced through group design and the weekly review.
- **Two sign-offs** for the most powerful entitlements (`state-recovery`, `iam-admin`) are split between PAM and the change process: PAM approves through **one step with the security group** as approver, and the **platform lead's approval is recorded on the change ticket** named in the justification before the request is made. PAM cannot hold both: the API reference for the PAM version in Google Cloud SDK 570.0.0 says a manual approval workflow supports only one step, `approvalsNeeded` accepts only 1, and a step's approver list holds at most one entry. The weekly review checks that every grant of these two entitlements has the platform lead's ticket approval; a grant without it is treated as an incident.
- **Durations are maximums.** Requesters ask for the time they need; extensions are new requests.
- Kubernetes write access comes from the **IAM role** granted by PAM, which GKE evaluates alongside RBAC. Elevated access is not given by changing Google group membership or by creating RoleBindings by hand.

```hcl title="pam-oncall-gke-write.tf"
variable "project_id" {
  type        = string
  description = "Production workload project, for example app-prod."
}

resource "google_privileged_access_manager_entitlement" "oncall_gke_write" {
  parent               = "projects/${var.project_id}"
  location             = "global"
  entitlement_id       = "oncall-gke-write"
  max_request_duration = "14400s" # 4 hours

  eligible_users {
    principals = ["group:app-oncall@example.com"]
  }

  requester_justification_config {
    unstructured {}
  }

  privileged_access {
    gcp_iam_access {
      resource_type = "cloudresourcemanager.googleapis.com/Project"
      resource      = "//cloudresourcemanager.googleapis.com/projects/${var.project_id}"
      role_bindings {
        role = "roles/container.developer"
      }
    }
  }

  approval_workflow {
    manual_approvals {
      require_approver_justification = true
      steps {
        approvals_needed = 1
        approvers {
          principals = ["group:app-leads@example.com"]
        }
      }
    }
  }

  additional_notification_targets {
    admin_email_recipients = ["security-alerts@example.com"]
  }
}
```

Illustrative: the argument names follow the Google provider's resource documentation; check them, and the roles PAM accepts, against the current provider and product docs. The `state-recovery` and `iam-admin` entitlements use the same single `steps` block with the security group as the approver; their second sign-off lives on the change ticket.

Requesting and approving, for example during an incident:

```bash title="pam-request.sh"
set -o pipefail
PROJECT_ID="app-prod"
ENTITLEMENT="oncall-gke-write"

# Requester: which entitlements can I request here?
gcloud pam entitlements search --caller-access-type=grant-requester \
  --location=global --project="${PROJECT_ID}"

# Requester: ask for one hour, with the incident reference.
gcloud pam grants create --entitlement="${ENTITLEMENT}" \
  --location=global --project="${PROJECT_ID}" \
  --requested-duration=3600s \
  --justification="INC-1234: roll back orders-api, see incident channel"

# Approver: grants waiting for me, then approve one by its full name.
gcloud pam grants search --entitlement="${ENTITLEMENT}" \
  --location=global --project="${PROJECT_ID}" --caller-relationship=can-approve
gcloud pam grants approve GRANT_NAME --reason="Matches INC-1234, rollback only"

# Either side: end it early when the work is done.
gcloud pam grants revoke GRANT_NAME --reason="Work complete"
```

`GRANT_NAME` is the full grant name printed by `grants search`.

### Break-glass

When PAM, the approvers or the identity provider cannot be used and production needs a change:

- A **break-glass group** holds a standing high-privilege binding on the production folder and has **no members**.
- Adding a member needs **two people**: the responder, and a group administrator who is not the responder and who is not in the production break-glass rota. This is a process control; the group's settings restrict who may manage membership.
- **Every membership change and every action by a member alerts** the security channel and opens a review ([[0050-incident-severity-levels-and-roles]]); membership is removed when the incident ends, and the use is recorded as an exception ([[policy-exception-and-waiver-process]]).
- For the case where the identity provider itself is down, the sealed emergency account in [[privileged-access-just-in-time-gcp-gke#Break-glass]] applies, with the same alerting.
- The break-glass path is **tested twice a year** in non-prod and once a year in prod, with a planned change.

> [!warning] Keep two working administrator paths
> Remove standing Owner and Editor only after the entitlements and the break-glass path have been tested end to end. Removing the last administrator of a project or organization can lock you out in a way that needs Google support to fix.

### Weekly review

The security team reviews every production grant of the past week from the central audit sink ([[0044-central-log-sinks-and-retention-tiers]], [[gcp-audit-logs-siem]]): each grant must match an incident or change reference, its duration must fit the work, and break-glass use must have its review. Entitlements nobody used in a quarter are candidates for removal.

> [!info] Claims not checked against current docs
> The `gcloud pam` commands and flags were read from `gcloud --help` (Google Cloud SDK 570.0.0, where `gcloud pam` is outside the alpha and beta surfaces) and the entitlement arguments from the Google provider's resource documentation; Google's online documentation could not be opened when this record was written. Not verified, check before relying on: PAM's launch stage, the resource levels and roles it supports, its quotas and pricing; whether PAM still supports only one approval step, `approvals_needed` only 1 and approver lists only one entry (as the API reference shipped with SDK 570.0.0 says), which is what forces the second sign-off onto the ticket; whether PAM blocks self-approval; the audit log service and method names for PAM events; whether an active grant appears as a conditional IAM binding; how GKE combines IAM roles with RBAC for `roles/container.developer`; and the Google Groups for RBAC setup (the cluster's `--security-group` and group naming).

## Consequences

Easier:

- A stolen or misused session cannot change production without a visible, approved request.
- Access reviews shrink: standing grants are read-only, and elevated access is a list of grants with reasons and approvers, which is also audit evidence.
- Separation of duties becomes demonstrable: CI deploys, people elevate on record.

Harder or newly required:

- **Approval latency during incidents.** On-call must reach an approver before acting. Entitlements are pre-built, approver groups are wide enough to be awake at any hour, and the severity process lists "request elevation" as an early step ([[incident-response]]).
- **Entitlement upkeep.** New services and roles need entitlements, owned and reviewed like any IAM change, in Terraform.
- **Break-glass needs drills.** A path that is never tested will fail when it is needed.
- **Muscle memory changes.** Engineers used to standing access will find read-only frustrating at first; tooling such as `gcloud pam entitlements search` and a short internal guide help.

## Alternatives considered

- **Standing access plus quarterly reviews.** The status quo. Reviews find drift after the fact and do nothing about stolen sessions. Rejected.
- **Group membership that expires.** Elevation by adding a person to a privileged group for a time. Works for Kubernetes RBAC, but depends on group admin tooling, is harder to audit as one request and approval, and approvals live outside Google Cloud. Rejected as the main path; used only for the break-glass group.
- **IAM conditions with a `request.time` expiry.** Time-bound bindings without PAM ([[privileged-access-just-in-time-gcp-gke]], option B). No request or approval workflow, and each grant is a Terraform change. Kept as the fallback if PAM cannot cover a role or resource.
- **A third-party privileged access tool.** Can add session recording and cross-cloud coverage, but adds another system in the trust chain and its own cost. Reconsider if session recording becomes a requirement.

## Validation

```bash title="validate-no-standing-write.sh"
set -o pipefail
PROD_FOLDER="123456789012"   # folder number of the production folder

# 1. Human principals (users and groups) holding any role that is not read-only under
#    the prod folder. Expected: only the break-glass group, and any grant active right now
#    (compare with check 2). The read-only allow list is our convention; extend it with care.
for t in user group; do
  gcloud asset search-all-iam-policies --scope="folders/${PROD_FOLDER}" \
    --query="memberTypes:${t}" --format=json
done | jq -r -s 'add | .[] | .resource as $r | (.policy.bindings // [])[] | .role as $role
    | select($role | test("\\.(viewer|reader)$|^roles/browser$|^roles/iap\\.tunnelResourceAccessor$|^roles/compute\\.osLogin$") | not)
    | .members[] | select(startswith("user:") or startswith("group:"))
    | "\($r)\t\($role)\t\(.)"'

# 2. Active and recent grants for one entitlement.
gcloud pam grants list --entitlement=oncall-gke-write --location=global --project=app-prod
```

Basic roles show up in check 1 because `roles/viewer`, `roles/editor` and `roles/owner` do not match the allow list. Check that `memberTypes:group` returns group bindings in your organization; if it does not, run the search without `--query` and rely on the `startswith` filter.

Alerting: a log-based alert on PAM grant events (filter on the PAM audit log entries; take the service and method names from a real entry), and a second alert on `SetIamPolicy` changes that add a write role for a `user:` or `group:` member in a production project outside PAM. The second filter can start from the one in [[privileged-access-just-in-time-gcp-gke#Evidence and alerting]].

End-to-end test, each quarter: a member of the on-call group requests `oncall-gke-write`, is approved, runs `kubectl auth can-i create deployments --namespace orders` (expected `yes` during the grant and `no` after it expires), and the grant appears in the weekly review.

## References

- Privileged Access Manager overview: https://cloud.google.com/iam/docs/pam-overview
- Create entitlements: https://cloud.google.com/iam/docs/pam-create-entitlements
- PAM REST reference: https://cloud.google.com/iam/docs/reference/pam/rest
- IAM conditions overview: https://cloud.google.com/iam/docs/conditions-overview
- IAM principal identifiers: https://cloud.google.com/iam/docs/principal-identifiers
- Cloud Asset Inventory, searching IAM policies: https://cloud.google.com/asset-inventory/docs/searching-iam-policies
- GKE hardening guide (RBAC and groups): https://docs.cloud.google.com/kubernetes-engine/docs/how-to/hardening-your-cluster
- Terraform `google_privileged_access_manager_entitlement`: https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/privileged_access_manager_entitlement

Related notes: [[privileged-access-just-in-time-gcp-gke]], [[access-reviews-gcp-and-gke]], [[separation-of-duties-in-deployments]], [[gcp-audit-logs-siem]], [[incident-response]]

Related ADRs: [[0026-keyless-ci-auth-with-workload-identity-federation]], [[0030-terraform-manages-gcp-infrastructure]], [[0032-terraform-state-in-gcs-per-environment]], [[0035-terraform-plan-policy-gate-and-ci-only-apply]], [[0044-central-log-sinks-and-retention-tiers]], [[0050-incident-severity-levels-and-roles]], [[0053-production-and-non-production-never-share-a-cluster]], [[0056-vm-access-through-os-login-and-iap]]
