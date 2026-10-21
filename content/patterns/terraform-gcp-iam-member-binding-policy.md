---
title: "GCP IAM in Terraform without lockouts: member, binding and policy resources"
description: When to use the google_*_iam_member, _binding and _policy resources, how to stop them fighting, and how to keep the Terraform identity from locking itself out.
type: pattern
tags:
  - patterns
  - terraform
  - gcp
  - security
created: 2026-10-21
modified: 2026-10-21
draft: false
---

The Google provider gives you three ways to manage an IAM allow policy on a project, folder or organization, and they disagree about who owns what. Mix them, and one apply silently removes grants another root (or a human, or Google itself) made, including the grant that lets your CI identity run Terraform at all. Or two resources take turns rewriting the same role, and the plan never comes back clean. This note sets a default, explains the conflicts, and adds the guard rails: a plan policy, saved policies for rollback, and a break-glass path.

> [!info] What was checked
> The resource semantics, warnings, condition behaviour and import formats come from the Google provider's `google_project_iam` page, read on 2026-10-21; the `gcloud` commands and flags were checked against the local help of gcloud 570.0.0. Nothing was applied to a real project. **Not verified**, because the Google Cloud IAM docs could not be read: etag and concurrency behaviour (including the exact error on a concurrent change), the `deleted:` principal prefix, which roles Google-managed service agents hold, and whether "Policy Analyzer" is the current product name for `gcloud asset analyze-iam-policy`. The plan output and the Rego rule are illustrative; test them on your own plans.

## The three resource kinds

Each resource family (`google_project_iam_*`, `google_folder_iam_*`, `google_organization_iam_*`, and the per-resource ones such as `google_service_account_iam_*` or `google_storage_bucket_iam_*`) has the same shape:

| Resource            | Owns                                                       | What an apply does to grants it does not know about | Use                                     |
| ------------------- | ---------------------------------------------------------- | --------------------------------------------------- | --------------------------------------- |
| `..._iam_member`    | One role for one principal (non-authoritative)             | Leaves them alone                                   | The default                             |
| `..._iam_binding`   | Every principal of one role (authoritative for that role)  | Removes other principals **from that role**         | A role one root owns completely         |
| `..._iam_policy`    | The whole allow policy (authoritative)                     | Removes **everything** not in `policy_data`         | Almost never                            |
| `..._iam_audit_config` | Audit log config for one service                         | Replaces that service's audit config                | Data access logs, see [[gcp-audit-logs-siem]] |

The provider page states the rules that follow from this:

- `_iam_policy` cannot be used together with `_iam_binding`, `_iam_member` or `_iam_audit_config` on the same target: "they will fight over what your policy should be".
- `_iam_binding` and `_iam_member` can coexist only if they do not grant the same role.
- Only one `_iam_binding` per role.
- On `_iam_policy`: "You can accidentally lock yourself out of your project using this resource. Deleting a `google_project_iam_policy` removes access from anyone without organization-level access to the project." The page recommends not using it on the provider's own project and importing the existing policy before the first apply.

## Decision rule

1. **Default to `_iam_member`.** One resource per role and principal. Adding or removing a grant touches only that grant; other roots, Google's own service agents and the emergency path are untouched.
2. **Use `_iam_binding` only when one root owns the role completely**, and you want drift removed: a custom role that exists only for this system, or a high-risk role such as `roles/owner` where any extra principal must disappear on the next apply. Before you switch, list who holds the role today (see Verify). Every principal not in `members` will be removed.
3. **Do not use `_iam_policy`** on projects, folders or the organization. The one defensible case is a small resource-level policy fully owned by one module (for example a service account's own policy, where the set of principals that may impersonate it is the whole point). Even there, `_iam_binding` per role is usually enough.

Then grant to **groups**, not people: `group:platform-oncall@example.com`, not `user:jane@example.com`. Joiners and leavers become group membership changes outside Terraform, the plan stays stable, and access reviews look at a handful of groups ([[access-reviews-gcp-and-gke]]). The group model and the CI identities are in [[iam-groups-and-ci-workload-identity-federation]].

## How the kinds fight

| Combination                                                    | What happens                                                                                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_binding` for `roles/X` and `_member` for `roles/X`           | The binding removes the member's grant, the member adds it back. Every plan shows a change, and between the two writes the principal has no access. |
| Two roots each with a `_binding` for the same role             | Each apply removes the other root's principals. Last writer wins until the next apply.                                                               |
| `_policy` plus anything else                                   | The policy wipes the other resources' grants on every apply; they recreate them on theirs.                                                           |
| `_binding` for a role that Google's service agents also hold   | The binding may remove the service agent's grant and break the service that relies on it (not verified per role; check the service agents page). |
| `_policy` on a project                                         | Removes every grant not in the policy: other teams' roots, manual emergency grants, and service agent grants that the policy forgot.                 |

Service agents are Google-managed service accounts that act for a Google service inside your project, and some of them receive grants on your project when an API is enabled. An authoritative resource does not know they exist. This is the main practical reason to avoid `_policy` and to be careful with `_binding` on broad roles. Which agent holds which role is **not verified** here: read the service agents page before you make any role authoritative.

## Conditional grants

Both `_member` and `_binding` accept a `condition` block with a `title`, an optional `description` and a CEL `expression`:

```hcl title="conditional-grant.tf"
resource "google_project_iam_member" "contractor_temp_viewer" {
  project = var.project_id
  role    = "roles/viewer"
  member  = "group:contractors-reporting@example.com"

  condition {
    title       = "expires-2026-12-31"
    description = "Temporary read access for the Q4 reporting project"
    expression  = "request.time < timestamp(\"2027-01-01T00:00:00Z\")"
  }
}
```

Rules from the provider page:

- Terraform identifies a conditional grant by `role` plus the condition's title, description and expression. Change any of them out of band and Terraform sees a different resource: it adds yours and leaves the edited one behind. Make titles unique per role and never edit conditions in the console.
- IAM Conditions cannot be used with basic roles such as Owner; the API returns HTTP 400.
- Importing a conditional binding needs the condition title in the import ID.

An expiring condition is not removal: the grant stays in the policy after it expires. Delete the resource after the date, or a later review will find a pile of expired bindings.

## A role-to-members module

Most roots need "these roles for these principals". Express it as a map and flatten it into one `_iam_member` per pair, so each grant has a stable address:

```hcl title="modules/project-iam/main.tf"
variable "project_id" {
  type        = string
  description = "Project that receives the grants."
}

variable "grants" {
  type        = map(list(string))
  description = "Role to list of principals, for example { \"roles/logging.viewer\" = [\"group:sre@example.com\"] }."

  validation {
    condition = alltrue([
      for role, members in var.grants : alltrue([
        for m in members : can(regex("^(group|serviceAccount|domain|principal|principalSet):", m))
      ])
    ])
    error_message = "Grant to groups, service accounts or workload identity principals, not to individual users."
  }

  validation {
    condition     = !contains(keys(var.grants), "roles/owner") && !contains(keys(var.grants), "roles/editor")
    error_message = "Basic roles are not granted through this module."
  }
}

locals {
  # One entry per role and member, keyed by a stable string.
  pairs = {
    for pair in flatten([
      for role, members in var.grants : [
        for m in members : { role = role, member = m }
      ]
    ]) : "${pair.role}|${pair.member}" => pair
  }
}

resource "google_project_iam_member" "this" {
  for_each = local.pairs

  project = var.project_id
  role    = each.value.role
  member  = each.value.member
}

output "granted" {
  description = "The role and member pairs this module manages."
  value       = keys(local.pairs)
}
```

```hcl title="envs/prod/iam.tf"
module "iam" {
  source     = "../../modules/project-iam"
  project_id = "example-prod-app"

  grants = {
    "roles/logging.viewer"        = ["group:sre@example.com", "group:payments-devs@example.com"]
    "roles/monitoring.editor"     = ["group:sre@example.com"]
    "roles/cloudsql.client"       = ["serviceAccount:payments-api@example-prod-app.iam.gserviceaccount.com"]
  }
}
```

Why it is shaped this way:

- The key `"role|member"` means adding a principal adds one resource and removes none. Using a list index as the key would shift every later grant on removal.
- The validation forbids `user:` principals and basic roles. The `principal:` and `principalSet:` prefixes are there for workload identity federation; the provider page lists only `user:`, `serviceAccount:`, `group:` and `domain:`, so check the IAM principal identifiers page before relying on the others.
- Module conventions and tests are in [[terraform-module-standard]] and [[terraform-for-each-lifecycle-and-tests]]; state layout per environment is in [[terraform-module-and-state-layout]].

## Reviewing the plan

What a dangerous IAM plan looks like (illustrative output, exact formatting varies by Terraform version):

```text title="terraform plan (illustrative)"
  # google_project_iam_binding.owners will be updated in-place
  ~ resource "google_project_iam_binding" "owners" {
        id      = "example-prod-app/roles/owner"
      ~ members = [
          - "group:break-glass@example.com",
          - "serviceAccount:terraform-prod@example-seed.iam.gserviceaccount.com",
            "group:platform-admins@example.com",
        ]
        # (2 unchanged attributes hidden)
    }
```

Read it this way:

- A `-` line inside `members` of a `_binding` is a **revocation on apply**, even when nobody touched that principal in the code: it was added outside Terraform, and the binding is removing the drift. Find out who added it and why before you apply.
- A removed `_member` resource (`will be destroyed`) revokes exactly one grant. That is the expected way to remove access.
- Any change to an `_iam_policy` resource deserves a line-by-line read of the whole `policy_data` diff.
- The Terraform identity's own service account appearing in a removal is a stop sign.

## Blocking authoritative resources in CI

Turn the decision rule into a plan check, next to the other rules in [[terraform-plan-policy-checks]] and enforced by the CI gate of [[0035-terraform-plan-policy-gate-and-ci-only-apply]]:

```rego title="policy/terraform/iam.rego (example, test before use)"
package terraform.iam

import rego.v1

# Authoritative IAM resources on hierarchy nodes: never allowed.
forbidden_policy_types := {
  "google_project_iam_policy",
  "google_folder_iam_policy",
  "google_organization_iam_policy",
}

# Authoritative per-role bindings on hierarchy nodes: allowed only for listed roles.
binding_types := {
  "google_project_iam_binding",
  "google_folder_iam_binding",
  "google_organization_iam_binding",
}

allowed_binding_roles := {"roles/owner"}

changing(rc) if {
  rc.mode == "managed"
  some a in rc.change.actions
  a in {"create", "update"}
}

deny contains msg if {
  some rc in input.resource_changes
  rc.type in forbidden_policy_types
  changing(rc)
  msg := sprintf("%s: authoritative IAM policy resources are not allowed; use _iam_member", [rc.address])
}

deny contains msg if {
  some rc in input.resource_changes
  rc.type in binding_types
  changing(rc)
  not rc.change.after.role in allowed_binding_roles
  msg := sprintf("%s: _iam_binding is only allowed for %v; use _iam_member", [rc.address, allowed_binding_roles])
}
```

```bash title="run the check locally"
terraform plan -out=tfplan
terraform show -json tfplan > plan.json
conftest test --policy policy/terraform --namespace terraform.iam plan.json
```

Treat `plan.json` as a secret; see [[secrets-out-of-terraform-state]].

## Importing existing grants

Grants made by hand before Terraform existed should be imported, not recreated. The import ID formats from the provider page:

```hcl title="imports.tf"
# _iam_member: "<project> <role> <member>" (Terraform 1.5.0 or later for import blocks)
import {
  to = module.iam.google_project_iam_member.this["roles/logging.viewer|group:sre@example.com"]
  id = "example-prod-app roles/logging.viewer group:sre@example.com"
}

# _iam_binding: "<project> <role>", plus the condition title for a conditional binding
# import {
#   to = google_project_iam_binding.owners
#   id = "example-prod-app roles/owner"
# }
```

Since Terraform 1.12 the member and binding resources also support import by resource identity (`identity = { project, role, member, condition_title }`). Run `terraform plan` after adding import blocks: it must show only imports and no changes. Then remove the import blocks.

To stop managing a grant **without revoking it**, remove it from state rather than from the configuration alone (`terraform state rm`, or a `removed` block where your Terraform version supports it; check the Terraform docs). Deleting the resource block revokes the grant on the next apply.

## Break-glass: Terraform must not lock itself out

The identity that runs Terraform needs IAM admin rights on the project, which means a bad apply can remove them. Layers that prevent a self-lockout:

1. **Grant the Terraform identity at a higher level** (the folder), from a separate bootstrap root that project roots cannot touch. A project-level apply cannot remove a folder-level grant. The hierarchy design is in [[gcp-resource-hierarchy-and-landing-zone]].
2. **Keep a break-glass group** with project or folder admin rights, granted at the folder or organization level, with no standing members. Adding a member is an audited, alerted event; see [[access-reviews-gcp-and-gke]].
3. **No `_iam_policy`** on projects and folders (the CI rule above), and no `_iam_binding` on the roles the Terraform identity relies on.
4. **Organization guard rails** such as domain-restricted sharing stop a typo from granting to an outside account; see [[gcp-organization-policy-guardrails]].
5. **Save the policy before every IAM apply** (next section), so recovery is a single command.

## Verify

```bash title="inspect the live policy"
PROJECT=example-prod-app

# Full policy, including etag and version, as JSON.
gcloud projects get-iam-policy "$PROJECT" --format=json > "iam-${PROJECT}-$(date +%Y%m%dT%H%M%S).json"

# Who holds a given role.
gcloud projects get-iam-policy "$PROJECT" \
  --flatten="bindings[].members" \
  --filter="bindings.role=roles/owner" \
  --format="table(bindings.role, bindings.members, bindings.condition.title)"

# Every role one principal holds on the project.
gcloud projects get-iam-policy "$PROJECT" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:terraform-prod@example-seed.iam.gserviceaccount.com" \
  --format="value(bindings.role)"

# Effective access including inheritance and group expansion (Cloud Asset API; check that it is enabled).
gcloud asset analyze-iam-policy --project="$PROJECT" \
  --identity="serviceAccount:terraform-prod@example-seed.iam.gserviceaccount.com" \
  --expand-groups --expand-roles
```

After an apply, `terraform plan` must report no changes. A plan that is never clean is the symptom of two resources fighting (see Troubleshooting). `gcloud policy-intelligence troubleshoot-policy` and `gcloud policy-troubleshoot` answer "why can this principal (not) do X"; see their `--help`.

## Troubleshooting

| Symptom                                                          | Likely cause                                                                                                                         | Fix                                                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every plan shows the same IAM change                             | `_binding` and `_member` for the same role, two roots with a `_binding` for one role, or a condition edited out of band               | Find every resource for that role across roots (`grep -r '"roles/X"'`), keep one owner, convert to `_member`.                                                           |
| Apply fails with a concurrent policy change error                | Another apply or a console edit changed the policy between read and write (read-modify-write with an etag; exact code not verified) | Re-run the plan and apply; serialise roots that write the same project's policy; avoid console edits on Terraform-managed projects.                                      |
| HTTP 400 on a conditional grant                                  | A condition on a basic role, or an invalid CEL expression                                                                            | Use a predefined or custom role; validate the expression.                                                                                                                 |
| Members shown as `deleted:serviceAccount:...` in the policy       | The principal was deleted while still granted (prefix format not verified)                                                          | Remove the grant from code. For a recreated account with the same email, grant the new one explicitly; the old entry is understood to refer to the deleted identity (not verified).             |
| A Google service stopped working after an IAM apply               | An authoritative resource removed a service agent's grant                                                                             | Restore from the saved policy, then convert the resource to `_member`. Check the service agents page for the grant the service needs.                                    |
| Terraform identity gets 403 on its next run                      | The apply removed its own grant                                                                                                      | Use the folder-level or break-glass access to restore the grant, then fix the code before the next apply.                                                                 |

## Rollback

1. **Stop applies** to the affected root (lock the pipeline or the environment).
2. **Restore the saved policy** taken before the apply:

   ```bash title="restore a saved policy"
   PROJECT=example-prod-app
   SAVED=iam-example-prod-app-20261021T101500.json
   gcloud projects set-iam-policy "$PROJECT" "$SAVED"
   ```

   `set-iam-policy` replaces the whole policy, and the `get-iam-policy` output is a valid input file. The file carries the `etag` it was read with; if the policy changed since, expect the write to be rejected as a concurrent change (behaviour not verified). Do not delete the `etag` from the file to force it through without first diffing the current policy against the saved one: you would silently drop every change made since.

3. **Reconcile Terraform**: revert the commit that caused the damage, run `terraform plan`, and make sure it shows no further removals before you re-enable applies. If state is damaged as well, follow [[terraform-state-recovery]].

## Related

- [[terraform-module-and-state-layout]]
- [[terraform-plan-policy-checks]]
- [[iam-groups-and-ci-workload-identity-federation]]
- [[access-reviews-gcp-and-gke]]
- [[terraform-state-recovery]]
- [[0030-terraform-manages-gcp-infrastructure]]
- [[gcp-iam-and-service-accounts]]
- [[gcp-organization-policy-guardrails]]

## Sources

- [Google provider: IAM policy for projects](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/google_project_iam)
- [Terraform: import block](https://developer.hashicorp.com/terraform/language/import)
- [Google Cloud: Understanding allow policies](https://cloud.google.com/iam/docs/policies) (not verified in this review)
- [Google Cloud: IAM Conditions overview](https://cloud.google.com/iam/docs/conditions-overview) (not verified in this review)
- [Google Cloud: Service agents](https://cloud.google.com/iam/docs/service-agents) (not verified in this review)
- [gcloud projects get-iam-policy](https://cloud.google.com/sdk/gcloud/reference/projects/get-iam-policy), [set-iam-policy](https://cloud.google.com/sdk/gcloud/reference/projects/set-iam-policy) and [asset analyze-iam-policy](https://cloud.google.com/sdk/gcloud/reference/asset/analyze-iam-policy) (flags checked with gcloud 570.0.0 `--help`)
