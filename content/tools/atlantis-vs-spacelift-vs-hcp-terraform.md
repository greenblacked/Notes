---
title: Atlantis vs Spacelift vs HCP Terraform
description: "Comparing Atlantis, Spacelift and HCP Terraform for plan-on-pull-request and gated apply on GCP: state, policy, drift, auth, trust boundary and cost model."
type: tool
tags:
  - tools
  - terraform
  - gcp
  - ci-cd
  - security
  - policy-as-code
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Running `terraform apply` from laptops does not scale and cannot be audited. The usual replacement is automation that plans on every pull request, shows the plan to reviewers, and applies only after approval. Atlantis (self-hosted, open source), Spacelift (commercial platform) and HCP Terraform (HashiCorp's hosted service, formerly Terraform Cloud) are three ways to get it.

> [!info] Not checked against current releases
> Product names, features, configuration keys and pricing were not checked when this note was written. HCP Terraform was formerly named Terraform Cloud; confirm the current name and plans. No prices are quoted here.

## Criteria

- How plan-on-PR and apply gating work, and who can trigger an apply.
- Where state lives and who can read it.
- Policy checks before apply.
- Drift detection.
- How the system authenticates to GCP without JSON keys.
- The trust boundary: what an attacker with PR access can do.
- Operating cost in team time.

## At a glance

| Concern              | Atlantis                                   | Spacelift                               | HCP Terraform                      |
| -------------------- | ------------------------------------------ | --------------------------------------- | ---------------------------------- |
| Hosting              | You run it (often on GKE)                  | SaaS, with optional self-hosted workers | SaaS (agents for private networks) |
| Trigger              | PR comments (`atlantis plan`, `apply`)     | VCS integration, stack-based runs       | VCS-driven runs, workspaces        |
| State                | Your backend (GCS)                         | Managed or your backend                 | Managed by the service             |
| Policy               | Conftest/OPA in workflows                  | OPA built in, plus approval policies    | Sentinel or OPA, depending on plan |
| Drift detection      | DIY with scheduled plans                   | Built in                                | Built in on supported plans        |
| Multi-stack ordering | Limited (project dependencies, workflows)  | Stack dependencies                      | Run triggers between workspaces    |
| Tools supported      | Terraform, OpenTofu, Terragrunt via config | Several IaC tools                       | Terraform                          |
| Cost model           | Compute plus engineer time                 | Subscription                            | Subscription                       |

## Plan on PR and apply gating

All three post the plan on the pull request. Gate applies on review state and merge status.

Atlantis repo-level configuration:

```yaml title="atlantis.yaml"
version: 3
automerge: false
projects:
  - name: platform-dev
    dir: live/dev/platform
    workspace: default
    autoplan:
      when_modified: ["*.tf", "../../modules/**/*.tf"]
      enabled: true
    apply_requirements: [approved, mergeable]
  - name: platform-prod
    dir: live/prod/platform
    workspace: default
    autoplan:
      when_modified: ["*.tf", "../../modules/**/*.tf"]
      enabled: true
    apply_requirements: [approved, mergeable]
```

Verify the key names (`apply_requirements`, `autoplan`, `when_modified`) against the current Atlantis documentation, and enable repo-level configuration on the server only deliberately, since it lets a repository define its own workflows.

Spacelift and HCP Terraform express the same idea through stack or workspace settings, with approval policies and required reviewers. In every product, require at least one reviewer who is not the author for production, and see [[separation-of-duties-in-deployments]].

## State (GCS backend vs managed state)

Atlantis and (optionally) Spacelift use your GCS backend: you control bucket location, encryption keys, versioning and IAM, and it is where [[terraform-state-recovery]] applies. HCP Terraform stores state itself with locking, versions and access control, which is less to run and one more vendor holding your infrastructure secrets (state can contain secrets). Choose by where you are willing to keep state, and whether you need to leave later: moving state out of a managed service is possible but should be rehearsed.

## Policy (Conftest/OPA, Spacelift OPA, Sentinel or OPA in HCP Terraform)

Policy runs against the plan in JSON form. With Atlantis you add a custom workflow step that runs Conftest against `terraform show -json`; Spacelift has OPA policy types built into the platform (plan, approval, push); HCP Terraform offers policy sets using Sentinel and, depending on the plan, OPA. The policies themselves are described in [[terraform-plan-policy-checks]]; the platform decides where they run and whether a failure blocks apply. Check the current docs for which policy languages your plan includes.

## Drift detection

Drift is real infrastructure differing from state or code. Spacelift and HCP Terraform offer scheduled drift detection (check availability on your plan). With Atlantis, schedule a CI job that runs `terraform plan -detailed-exitcode` per project and alerts on exit code 2. Treat drift as a signal: either revert the manual change or codify it.

## GCP auth via Workload Identity Federation, with no JSON keys

None of these should hold a service account key.

- **Atlantis on GKE**: use Workload Identity so the Atlantis pod is a Google service account, or impersonate per-environment service accounts from it. Prefer one service account per environment with only the roles that environment needs, impersonated per project, over one all-powerful identity.
- **Spacelift and HCP Terraform**: use Workload Identity Federation with the platform's OIDC tokens, and restrict the attribute condition to your organisation, stack or workspace. The pattern is in [[iam-groups-and-ci-workload-identity-federation]].

## Trust boundary of a self-hosted Atlantis (webhook secret, repo allowlist, who can comment `atlantis apply`)

Atlantis runs Terraform with the credentials of the server, and anyone who can make it plan can make it execute code (`external` data sources, provisioners, modules).

- Set `--repo-allowlist` to exact repositories (for example `github.com/example-org/infra`), not a wildcard.
- Use a strong **webhook secret** and verify it; expose only the webhook path to the VCS, not the UI, or protect the UI with SSO.
- Treat PR authors as able to run code with the server's identity. Limit plans for forks (disable them), require review for workflow changes, and restrict who can comment `atlantis apply` (VCS permissions, plus `apply_requirements`).
- Run Atlantis in its own namespace and project with least-privilege service accounts, and keep production credentials separate from dev.
- Locks: a plan creates a lock on the project until applied or discarded. A stuck lock is released with `atlantis unlock` on the PR, or in the UI. Do not delete state objects to clear a lock.

Spacelift and HCP Terraform have the same exposure through their runners; self-hosted workers and agents bring it back inside your network, so apply the same care.

## Operating cost: team time, not list prices

Atlantis costs no licence and costs engineer time: keeping it patched and available (a restart mid-apply leaves locks), writing and maintaining workflows, building drift detection, and responding to its security reports. SaaS products exchange that for subscription fees that grow with usage and features; check current pricing pages and ask what a run, a user or a resource count costs in your case. The honest comparison is the subscription against a fraction of an engineer, plus the risk you carry for the service you host.

## When to choose which

- **Atlantis**: small to medium team, comfortable operating it, wants state and runners fully in its own project, and open source.
- **Spacelift**: many stacks, multiple IaC tools, policy and drift needs, and the willingness to pay for a platform.
- **HCP Terraform**: Terraform-only shops that value the managed state and the integrated ecosystem from HashiCorp.

## Recommendation

For a platform team already on GKE with a handful of root modules, run Atlantis with Workload Identity, an exact repo allowlist, Conftest policies and scheduled drift plans, and keep apply on approved, mergeable PRs. Move to a SaaS platform when the number of stacks, the need for drift and policy management, or the on-call burden makes the subscription cheaper than the time. Multi-environment layout matters more than the tool; see [[terragrunt-vs-terraform-workspaces]]. If you adopt OpenTofu, check that the platform supports it ([[terraform-vs-opentofu]]).

## Related

- [[terraform-plan-policy-checks]]
- [[separation-of-duties-in-deployments]]
- [[iam-groups-and-ci-workload-identity-federation]]
- [[terragrunt-vs-terraform-workspaces]]
- [[terraform-vs-opentofu]]

## Sources

- [Atlantis documentation](https://www.runatlantis.io/docs/) (verify the domain)
- [Spacelift documentation](https://docs.spacelift.io/)
- [HCP Terraform documentation](https://developer.hashicorp.com/terraform/cloud-docs)
