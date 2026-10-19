---
title: GCP IAM guardrails for AI agent service accounts
description: Limit what an AI agent can do in Google Cloud with one service account per task, IAM conditions, deny policies, short-lived impersonation and outer fences.
type: pattern
tags:
  - ai
  - gcp
  - security
  - audit
created: 2026-10-19
modified: 2026-10-19
draft: false
---

An AI agent that can act in Google Cloud acts with some identity. Whatever that identity can do, a mistake, a prompt injection or a compromised tool can do. This note goes deeper than the general rules in [[securing-ai-agents-in-ci-and-cloud]] on the GCP side: how to shape a service account so the worst case is small, how to make some actions impossible whatever roles are granted, and how to prove the boundary holds.

> [!info] Scope
> Written for agents that run in CI or on a platform and need read access, or narrow write access, to GCP projects. Role names, permission names and constraint names change; the commands follow the public documentation under Sources. Check each against the current reference. No numeric limits are quoted because they change.

> [!note] Not verified
> Nothing here was run in a real organisation. Unchecked: the permission names supported in deny policies, the exact `gcloud` syntax in your SDK version, the current organisation policy constraint name for service account keys, and the Policy Troubleshooter command. Test every policy in a sandbox project before attaching it anywhere that matters.

## One service account per agent and task

Do not reuse a human's identity, the CI runner's identity or a shared "automation" account. Create one service account per agent and per task class, so permissions are specific and audit logs are readable:

- `review-bot@example-project.iam.gserviceaccount.com` reads code and posts comments in the source host; it has no GCP roles at all.
- `incident-reader@example-project.iam.gserviceaccount.com` reads logs and metrics.
- `plan-reader@example-project.iam.gserviceaccount.com` reads Terraform state metadata for plan review ([[llm-assisted-terraform-plan-review]]).

Name the owner and purpose in the description, and put the account in a project reserved for automation identities so the `iam.serviceAccounts.*` permissions are not scattered. Federation for CI (no keys) is covered in [[iam-groups-and-ci-workload-identity-federation]]; for workloads on GKE use [[gke-workload-identity]].

## Roles and IAM conditions

Start from predefined viewer roles for the exact services the task needs, and grant them on the smallest resource that works (a project, a dataset, a bucket), not on a folder or the organisation. Avoid primitive roles (Owner, Editor) entirely. Then narrow with IAM conditions:

- **By resource name:** `resource.name.startsWith("projects/_/buckets/example-logs-")` restricts a bucket role to matching buckets.
- **By tag:** `resource.matchTag("123456789012/agent-access", "allowed")` grants only on resources an owner has tagged. Tags make a deliberate opt-in per resource.
- **By time:** `request.time < timestamp("2026-12-31T00:00:00Z")` makes a grant expire, which suits pilots and incident access.

```bash title="grant-conditional-role.sh"
set -euo pipefail

PROJECT="example-project"
SA="incident-reader@${PROJECT}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" \
  --role="roles/logging.viewer" \
  --condition='expression=request.time < timestamp("2026-12-31T00:00:00Z"),title=pilot-expiry,description=Review in December'
```

Not every role or resource type supports every condition attribute; check the conditions overview and the per-service pages. A condition that does not apply to a resource type can make the binding useless or surprising, so test it.

## Deny policies

Allow policies add permissions; **deny policies remove them, and deny overrides allow.** Use deny for the few actions that must never be possible for agent identities, whatever roles someone grants later, such as by mistake or in an incident.

Candidates:

- Reading Secret Manager secret versions (`secretmanager.googleapis.com/versions.access`).
- Creating service account keys (`iam.googleapis.com/serviceAccountKeys.create`).
- Changing IAM policies on projects and the organisation.
- Deleting projects, disks or databases.

Permission names in deny policies use the `SERVICE_FQDN/resource.action` format. Not all permissions are supported in deny policies; check the list of supported permissions before relying on a rule, because an unsupported name fails or does nothing.

```json title="agent-deny-policy.json"
{
  "displayName": "Deny risky actions for agent service accounts",
  "rules": [
    {
      "denyRule": {
        "deniedPrincipals": ["principalSet://goog/group/ai-agents@example.com"],
        "deniedPermissions": [
          "secretmanager.googleapis.com/versions.access",
          "iam.googleapis.com/serviceAccountKeys.create"
        ]
      }
    }
  ]
}
```

Attach it at the project, folder or organisation with the CLI. Check the argument names in the current reference:

```bash title="create-deny-policy.sh"
set -euo pipefail

PROJECT_ID="example-project"
# Plain form for gcloud; the REST API takes it URL-encoded: cloudresourcemanager.googleapis.com%2Fprojects%2F<id>
gcloud iam policies create agent-deny \
  --attachment-point="cloudresourcemanager.googleapis.com/projects/${PROJECT_ID}" \
  --kind=denypolicies \
  --policy-file=agent-deny-policy.json
```

Put the agent accounts in a group (or principal set) so the deny rule is one line and new agent accounts are covered when added to the group. Manage the policy in Terraform ([[terraform-module-and-state-layout]]) and review changes like any security control.

## Impersonation instead of keys

Agents should never hold long-lived service account keys. Instead, a caller identity gets permission to **impersonate** the agent account and receives short-lived tokens:

- Grant `roles/iam.serviceAccountTokenCreator` on the agent service account only (not on the project), to the CI identity or person that starts the agent.
- Call with `--impersonate-service-account=AGENT_SA` or the equivalent in client libraries.
- Tokens are short-lived and every use is attributed in audit logs to both the caller and the account.

```bash title="impersonate.sh"
set -euo pipefail

AGENT_SA="incident-reader@example-project.iam.gserviceaccount.com"

gcloud logging read 'severity>=ERROR' --limit=10 --freshness=1h \
  --project=example-project \
  --impersonate-service-account="$AGENT_SA"
```

Keep who may impersonate small, review it in your access reviews ([[access-reviews-gcp-and-gke]]), and do not grant Token Creator broadly: with it, the holder can act as the account, which can include creating tokens with its permissions.

**No keys at all:** enforce with the organisation policy constraint that disables service account key creation. Check the current constraint name in the Organization Policy reference before applying it, and see [[gcp-organization-policy-guardrails]] for the rollout pattern (dry run first, then enforce).

## Outer fences: Organization Policy and VPC Service Controls

IAM answers "who may do this". Two other layers limit the damage when IAM is too broad:

- **Organization Policy** constrains what can be configured in a project whatever the role: disabling key creation, restricting where resources can be created, requiring OS Login, and more. Apply at folder level for automation projects ([[gcp-organization-policy-guardrails]]).
- **VPC Service Controls** put a perimeter around services such as Cloud Storage and BigQuery so that data cannot leave it even for an identity that has permission, and calls from outside are rejected unless an access level allows them. This fences exfiltration through a stolen token ([[zero-trust-access-iap-and-vpc-service-controls]]). Run a perimeter in dry-run mode first to see what would break.

These are not substitutes for least privilege. They are the layer that still holds when someone later grants a role too widely.

## Testing the boundary

A policy is a hypothesis until you test it. Two methods, both needed:

1. **Explain the policy.** Policy Troubleshooter answers "would principal P be allowed permission X on resource R, and which policy decides?":

   ```bash title="troubleshoot.sh"
   set -euo pipefail

   gcloud policy-intelligence troubleshoot-policy iam \
     //cloudresourcemanager.googleapis.com/projects/example-project \
     --principal-email=incident-reader@example-project.iam.gserviceaccount.com \
     --permission=secretmanager.versions.access
   ```

   Check the command group and arguments in the current reference; the syntax has changed over time. Expected result: denied, with the deny policy named.

2. **Make real calls that must fail.** In a test project, impersonate the agent account and try the forbidden things: read a secret version, create a key, list resources outside the tag. Record the error codes. Put these checks in a scheduled job so a later IAM change that opens a hole is noticed, in the spirit of the harness in [[prompt-injection-test-harness-for-ci-agents]].

Keep a short table of "action, expected result, last tested date" for each agent account, and treat a changed result as a finding.

## Audit logs and alerts

Admin Activity logs are on by default; **Data Access audit logs** are not enabled for most services unless you turn them on, and they are what show reads. Enable them for the services the agent touches, at least for the agent identities, and send the logs to your SIEM ([[gcp-audit-logs-siem]]). Then alert on what should never happen:

- Any `PERMISSION_DENIED` from an agent account on sensitive methods (an agent poking at secrets is a signal, not noise).
- Creation of keys, IAM policy changes, or new bindings that mention an agent account.
- Impersonation of the agent account by an unexpected caller.
- Activity outside the agent's normal hours or source networks.

Use the agent account's email as the filter, which is one reason for one account per task. For the response, an agent identity under suspicion is disabled first and investigated second; the steps in [[ai-assisted-incident-response]] about read-only evidence apply to the agent itself.

## Pitfalls

- **Inheritance surprises.** A role on a folder reaches every project below it. Grant low.
- **Deny policy rolled out unseen.** Test in a sandbox and name the group carefully, since a wrong principal denies the wrong people.
- **Conditions that do nothing.** Unsupported attributes for a resource type. Verify with real calls.
- **Group sprawl.** An "ai-agents" group everyone is added to. Review membership.
- **Token Creator everywhere.** Equivalent to handing out the account.
- **Forgetting the data plane.** IAM covers the control plane well; buckets and databases may have their own ACLs and grants.
- **Logs without alerts.** Enabled Data Access logs nobody reads protect nothing.

## Rollback

Deny policies and bindings are reversible configuration:

1. Keep them in Terraform. To roll back, revert the commit and apply.
2. For an emergency, delete the deny policy with `gcloud iam policies delete` (check syntax) and note the time; the allow policies still hold.
3. If an agent loses access it needs, grant the minimum back with a time-bound condition and file the missing permission as a change, not as a permanent broad role.
4. If a perimeter blocks legitimate work, switch it back to dry-run mode and read the violation logs before changing the rules.

## Sources

- [IAM conditions overview](https://cloud.google.com/iam/docs/conditions-overview), Google Cloud documentation.
- [Deny policies overview](https://cloud.google.com/iam/docs/deny-overview), Google Cloud documentation.
- [Service account impersonation](https://cloud.google.com/iam/docs/service-account-impersonation), Google Cloud documentation.
- [VPC Service Controls overview](https://cloud.google.com/vpc-service-controls/docs/overview), Google Cloud documentation.
- [Organization Policy Service overview](https://cloud.google.com/resource-manager/docs/organization-policy/overview), Google Cloud documentation.

## Related

- [[securing-ai-agents-in-ci-and-cloud]]: the general rules this note deepens.
- [[gke-workload-identity]]: keyless identity for agents running on GKE.
- [[iam-groups-and-ci-workload-identity-federation]]: keyless identity for CI.
- [[gcp-organization-policy-guardrails]]: organisation policies and how to roll them out.
- [[zero-trust-access-iap-and-vpc-service-controls]]: perimeters and access levels.
- [[gcp-audit-logs-siem]]: sending audit logs to the SIEM.
- [[ai-assisted-incident-response]]: read-only access for assistants during incidents.
- [the owner's AI skills catalogue](https://ai.szolotov.com): reusable agent skills and workflows.
