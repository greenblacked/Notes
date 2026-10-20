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
modified: 2026-10-20
evidence: source-reviewed
reviewed: 2026-10-20
review-due: 2027-04-20
destructive: true
draft: false
---

An AI agent that can act in Google Cloud acts with some identity. Whatever that identity can do, a mistake, a prompt injection or a compromised tool can do. This note goes deeper than the general rules in [[securing-ai-agents-in-ci-and-cloud]] on the GCP side: how to shape a service account so the worst case is small, how to make some actions impossible whatever roles are granted, and how to prove the boundary holds.

> [!info] Scope
> Written for agents that run in CI or on a platform and need read access, or narrow write access, to GCP projects. Role names, permission names and constraint names change; the commands follow the public documentation under Sources. Check each against the current reference. No numeric limits are quoted because they change.

> [!note] What was checked
> Command syntax, permission formats, condition attributes, constraint names and the Troubleshooter behaviour were checked against Google Cloud documentation on 2026-10-20, and the policies were never applied to a real organisation. Test every policy in a sandbox project before attaching it anywhere that matters. See Evidence for what is and is not verified.

## One service account per agent and task

Do not reuse a human's identity, the CI runner's identity or a shared "automation" account. Create one service account per agent and per task class, so permissions are specific and audit logs are readable:

- `review-bot@example-project.iam.gserviceaccount.com` reads code and posts comments in the source host; it has no GCP roles at all.
- `incident-reader@example-project.iam.gserviceaccount.com` reads logs and metrics.
- `plan-reader@example-project.iam.gserviceaccount.com` reads Terraform state metadata for plan review ([[llm-assisted-terraform-plan-review]]).

Name the owner and purpose in the description, and put the account in a project reserved for automation identities so the `iam.serviceAccounts.*` permissions are not scattered. Federation for CI (no keys) is covered in [[iam-groups-and-ci-workload-identity-federation]]; for workloads on GKE use [[gke-workload-identity]].

## Roles and IAM conditions

Start from predefined viewer roles for the exact services the task needs, and grant them on the smallest resource that works (a project, a dataset, a bucket), not on a folder or the organisation. Avoid primitive roles (Owner, Editor) entirely. Then narrow with IAM conditions:

- **By resource name:** `resource.name.startsWith("projects/_/buckets/example-logs-")` restricts a bucket role to matching buckets. The `resource.name` attribute is available only for some resource types (Cloud Storage buckets and objects are among them), so check the attribute reference for your service.
- **By tag:** `resource.matchTag("123456789012/agent-access", "allowed")` grants only on resources an owner has tagged. Tags make a deliberate opt-in per resource.
- **By time:** `request.time < timestamp("2026-12-31T00:00:00Z")` makes a grant expire, which suits pilots and incident access. Date and time conditions work for all Google Cloud services and resource types.

```bash title="grant-conditional-role.sh"
set -euo pipefail

PROJECT="example-project"
SA="incident-reader@${PROJECT}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" \
  --role="roles/logging.viewer" \
  --condition='expression=request.time < timestamp("2026-12-31T00:00:00Z"),title=pilot-expiry,description=Review in December'
```

Not every service accepts conditional role bindings, and not every attribute exists for every resource type; check the conditions overview, the attribute reference and the list of services that allow conditional bindings. According to the attribute reference, a part of a condition that uses an attribute the resource does not have never grants access, so a mismatched condition makes the binding useless; test it with a real call.

## Deny policies

Allow policies add permissions; **deny policies remove them, and deny overrides allow.** Use deny for the few actions that must never be possible for agent identities, whatever roles someone grants later, such as by mistake or in an incident.

Candidates:

- Reading Secret Manager secret versions (`secretmanager.googleapis.com/versions.access`).
- Creating service account keys (`iam.googleapis.com/serviceAccountKeys.create`).
- Changing IAM policies on projects and the organisation.
- Deleting projects, disks or databases.

Permission names in deny policies use the `SERVICE_FQDN/resource.action` format. Not all permissions are supported in deny policies; check the page "Permissions supported in deny policies" before relying on a rule. `iam.googleapis.com/serviceAccountKeys.create` appears in Google's own deny policy example. I could not confirm that `secretmanager.googleapis.com/versions.access` is on the supported list, so look it up and, if it is missing, drop it from the example and cover secrets with narrower grants instead. A rule that names an unsupported permission may be rejected or have no effect; test with a real call either way.

The rule fields are `deniedPrincipals`, `exceptionPrincipals` (optional: principals that stay allowed even if they are in a denied set) and `deniedPermissions`, with an optional `denialCondition` that can only use resource tag functions. A deny policy attaches to an organisation, folder or project, applies to everything below it, and is evaluated before allow policies.

> [!warning] A broad deny policy can lock out operators
> A deny rule beats every allow policy, including Owner and break-glass roles. A deny with a wrong or too wide principal (for example all users, or a group your administrators belong to) can stop people from fixing the very thing it broke. Before attaching it: keep the principals to the agent group only, test in a sandbox project, name a break-glass group in `exceptionPrincipals` for any rule whose denied principals could include operators, and keep the rollback below in reach. Attaching at the organisation or a folder affects every project below it.

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

Attach it at the project, folder or organisation with the CLI. `--attachment-point`, `--kind=denypolicies` and `--policy-file` are the flags in the current reference (the same group also exists under `gcloud beta iam`); the policy ID is positional:

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

**No keys at all:** enforce with the organisation policy constraint that disables service account key creation. The documented names are the legacy boolean `iam.disableServiceAccountKeyCreation` and the managed `iam.managed.disableServiceAccountKeyCreation`, which Google recommends; the documentation says new organisations created from 2024-05-03 enforce the legacy one by default, so check what your organisation already has. A related constraint, `iam.allowedPolicyMemberDomains`, limits which identities can be granted roles. Enforcing a key-creation ban breaks any workflow that still creates keys, so see [[gcp-organization-policy-guardrails]] for the rollout pattern (dry run first, then enforce).

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

   The command takes the full resource name as a positional argument plus `--principal-email` and `--permission`, and the permission may be written in the IAM form shown or the deny-policy form. It evaluates the effective allow and deny policies, including inherited ones, and reports the deny policy that applies. To see deny policies you need the Deny Reviewer role (`roles/iam.denyReviewer`), and without it the result can come back as unknown. Older documentation uses `gcloud policy-troubleshoot iam`, so check `gcloud help` for your SDK version. Expected result: denied, with the deny policy named.

2. **Make real calls that must fail.** In a test project, impersonate the agent account and try the forbidden things: read a secret version, create a key, list resources outside the tag. Record the error codes. Put these checks in a scheduled job so a later IAM change that opens a hole is noticed, in the spirit of the harness in [[prompt-injection-test-harness-for-ci-agents]].

Keep a short table of "action, expected result, last tested date" for each agent account, and treat a changed result as a finding.

## Audit logs and alerts

Admin Activity logs are always on. **Data Access audit logs** are disabled by default except for BigQuery, and they are what show reads; impersonation itself (`GenerateAccessToken`, from the IAM Service Account Credentials API) is a Data Access event, so token requests appear only if you enable those logs for the IAM and Security Token Service APIs. Enable them for the services the agent touches, at least for the agent identities, and send the logs to your SIEM ([[gcp-audit-logs-siem]]). Then alert on what should never happen:

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
2. For an emergency, delete the deny policy and note the time; the allow policies still hold. Deletion is permanent and asynchronous, so export the policy file first:

   ```bash title="delete-deny-policy.sh"
   set -euo pipefail

   PROJECT_ID="example-project"
   gcloud iam policies delete agent-deny \
     --attachment-point="cloudresourcemanager.googleapis.com/projects/${PROJECT_ID}" \
     --kind=denypolicies
   ```

   To relax a rule instead of removing the whole policy, update the policy with a corrected file, or add the affected operators to `exceptionPrincipals` as a break-glass exception. Deny policies are read and updated with the same `gcloud iam policies` commands.

3. If an agent loses access it needs, grant the minimum back with a time-bound condition and file the missing permission as a change, not as a permanent broad role.
4. If a perimeter blocks legitimate work, switch it back to dry-run mode and read the violation logs before changing the rules.

## Evidence

### Sources checked

- [Deny policies](https://cloud.google.com/iam/docs/deny-overview) and [Deny access to resources](https://cloud.google.com/iam/docs/deny-access): `deniedPrincipals`, `exceptionPrincipals`, `deniedPermissions`, the `SERVICE_FQDN/resource.action` format, attachment at organisation, folder or project, deny evaluated before allow, conditions limited to resource tag functions, the `gcloud iam policies create` flags, the `delete` command and its asynchronous behaviour, checked 2026-10-20 (search excerpts, the pages could not be fetched).
- [Permissions supported in deny policies](https://cloud.google.com/iam/docs/deny-permissions-support): that only some permissions are supported, checked 2026-10-20. The Secret Manager entry was not confirmed.
- [Overview of IAM Conditions](https://cloud.google.com/iam/docs/conditions-overview) and the [attribute reference](https://cloud.google.com/iam/docs/conditions-attribute-reference): `request.time` for all services, `resource.name` for some resource types, resource tags in allow and deny, checked 2026-10-20 (search excerpts).
- [Service account impersonation](https://cloud.google.com/iam/docs/service-account-impersonation): `roles/iam.serviceAccountTokenCreator`, the `--impersonate-service-account` flag, `GenerateAccessToken` logged as a Data Access event, grant on the individual service account rather than the project, checked 2026-10-20 (search excerpts).
- [Restrict IAM service account usage](https://cloud.google.com/organization-policy/restrict-service-accounts): the constraints `iam.disableServiceAccountKeyCreation`, `iam.managed.disableServiceAccountKeyCreation` and `iam.allowedPolicyMemberDomains`, checked 2026-10-20 (search excerpt).
- [Troubleshoot IAM permissions (Policy Intelligence)](https://cloud.google.com/policy-intelligence/docs/troubleshoot-access) and the [gcloud reference](https://cloud.google.com/sdk/gcloud/reference/policy-intelligence/troubleshoot-policy/iam): the command shape, evaluation of deny policies, the Deny Reviewer role, checked 2026-10-20 (search excerpts).
- [Cloud Audit Logs overview](https://cloud.google.com/logging/docs/audit): Admin Activity always on, Data Access off by default except BigQuery, checked 2026-10-20 (search excerpt).
- [VPC Service Controls dry run mode](https://cloud.google.com/vpc-service-controls/docs/dry-run-mode) and [overview](https://cloud.google.com/vpc-service-controls/docs/overview): dry run logs violations without denying them; perimeters deny access from unauthorised networks even when IAM is misconfigured, checked 2026-10-20 (search excerpts).

Corrections made on 2026-10-20: the Data Access log statement now says disabled by default except BigQuery, and that `GenerateAccessToken` is a Data Access event; the `resource.name` condition now says it is limited to some resource types; the Troubleshooter paragraph now covers the Deny Reviewer role and permission formats; the key-creation constraint names were given instead of "check the name"; the `gcloud iam policies delete` command is now spelled out; a lockout warning, the break-glass exception and the update option were added; the Secret Manager deny permission is hedged because the supported list could not be confirmed.

### Not verified

- Whether `secretmanager.googleapis.com/versions.access` is supported in deny policies.
- The exact audit log method names for key creation and IAM policy changes were not checked.
- No policy, binding, constraint, perimeter or impersonation call was applied or run; the `gcloud` commands are as documented, not as observed. The Policy Troubleshooter output was not seen.
- The `resource.matchTag` tag format, the `principalSet://goog/group/` form for your identity setup, and numeric limits (the note quotes none) were not checked.
- The documentation pages were reached through search excerpts only, because the lab's network policy blocked fetching them. Nothing was verified against a real environment.

### Environment

The commands assume the Google Cloud CLI with the `gcloud iam policies` and `gcloud policy-intelligence` groups, a sandbox project, and permission to manage deny policies at the chosen attachment point; check `gcloud --version` and the reference for your SDK. The helper check ran on Ubuntu 24.04.5 LTS with Python 3.13.16.

### Prerequisites

A sandbox project that is not used for real work, a group for the agent identities, a separate break-glass group that is not in any deny rule, and a person who can delete the policy. A copy of the current policy state (for example the Terraform code) before any change.

### Expected results

`gcloud iam policies create` returns an operation and the policy appears under the project; the Troubleshooter then shows access to the denied permission as denied by that policy for the agent account, and a real call from the impersonated account fails with a permission error. Other permissions and other principals are unaffected.

### Failure conditions

The create call is rejected (unsupported permission, wrong principal format or attachment point); the Troubleshooter returns unknown (missing Deny Reviewer role); the real call still succeeds (rule not effective or wrong principal); or operators lose access they need (rule too broad). Treat the last one as an incident and use the rollback.

### Cleanup and rollback

See the Rollback section. In short: delete or update the deny policy (permanent, asynchronous), use `exceptionPrincipals` for break-glass access, revert the Terraform commit, and delete the sandbox project when testing is finished. Do not run these against a production project to test them.

### Lab run

A helper check only; it does not raise the evidence level. Host: Ubuntu 24.04.5 LTS, Linux 6.18.44. `python3 --version` printed `Python 3.13.16`. Run 2026-10-20 with `python3 -I`, no network. The file `agent-deny-policy.json` is the JSON example above, saved as is. The script is shown in full. It checks that the JSON example in this note parses and that the two permissions the example is meant to deny are in the rule.

```python title="check_policy.py"
import json
import sys

policy = json.load(open(sys.argv[1]))
rules = policy["rules"]
print("parsed OK; keys:", sorted(policy.keys(), key=lambda k: k != "displayName"), "rules:", len(rules))
text = json.dumps(rules)
for perm in ("secretmanager.googleapis.com/versions.access", "iam.googleapis.com/serviceAccountKeys.create"):
    print(perm, "in rule:", perm in text)
```

```bash
python3 -I check_policy.py agent-deny-policy.json
```

```text
parsed OK; keys: ['displayName', 'rules'] rules: 1
secretmanager.googleapis.com/versions.access in rule: True
iam.googleapis.com/serviceAccountKeys.create in rule: True
```

The other candidates in the list (changing IAM policies, deleting projects, disks or databases) are suggestions and are not in the example rule. Parsing proves the JSON is valid, not that Google Cloud accepts the policy.

## Sources

- [IAM conditions overview](https://cloud.google.com/iam/docs/conditions-overview), Google Cloud documentation.
- [Deny policies overview](https://cloud.google.com/iam/docs/deny-overview), Google Cloud documentation.
- [Service account impersonation](https://cloud.google.com/iam/docs/service-account-impersonation), Google Cloud documentation.
- [VPC Service Controls overview](https://cloud.google.com/vpc-service-controls/docs/overview), Google Cloud documentation.
- [Organization Policy Service overview](https://cloud.google.com/resource-manager/docs/organization-policy/overview), Google Cloud documentation.
- More pages are listed under Evidence.

## Related

- [[securing-ai-agents-in-ci-and-cloud]]: the general rules this note deepens.
- [[gke-workload-identity]]: keyless identity for agents running on GKE.
- [[iam-groups-and-ci-workload-identity-federation]]: keyless identity for CI.
- [[gcp-organization-policy-guardrails]]: organisation policies and how to roll them out.
- [[zero-trust-access-iap-and-vpc-service-controls]]: perimeters and access levels.
- [[gcp-audit-logs-siem]]: sending audit logs to the SIEM.
- [[ai-assisted-incident-response]]: read-only access for assistants during incidents.
- [the owner's AI skills catalogue](https://ai.szolotov.com): reusable agent skills and workflows.
