---
title: Offboarding a platform engineer safely
description: Hand over ownership, inventory and remove a leaving platform engineer's access across GCP, GKE, GitLab, Jenkins and Artifactory, and prove it is gone.
type: guide
tags:
  - management
  - security
  - team-process
  - audit
  - gcp
  - gitlab-ci
created: 2026-10-21
modified: 2026-10-21
draft: false
---

A platform engineer who leaves takes two risks out of the door with them. The first is access: they usually hold more privilege than anyone else in the company, spread across an identity provider, cloud IAM, cluster RBAC, CI, the artifact registry and a few systems nobody remembers. The second is ownership: pipeline schedules, trigger tokens, Jenkins jobs and service-account keys that quietly run as that person and stop, or keep running unseen, the day the account is closed. Onboarding has its own guide ([[onboarding-engineers]]); this one covers the other end, for planned departures and for the ones that happen the same day. It is the people and ownership side; the per-system revocation steps, with a timestamp per system for the audit record, are in the runbook [[leaver-credential-revocation-devops-tools]].

> [!info] Scope and what is not verified
> The GitLab, gcloud, Kubernetes and Google Admin SDK calls below follow the official documentation as read on 2026-10-21; nothing was run against a live GitLab, GCP organisation, cluster, Jenkins or Artifactory. The GitLab inventory script and the jq filters were tested against a local mock API and sample JSON only. **Not verified**: whether suspending a Google identity revokes existing gcloud refresh tokens and how quickly; the exact audit-log `methodName` for service-account key creation; how a GitLab pipeline trigger token behaves after its owner is blocked; whether a Jenkins API token keeps working when the person is disabled only in an external SSO realm; and the Artifactory endpoints for listing a user's tokens. Each is marked where it appears. GitLab features change by version and tier: check the docs for yours.

## Planned and immediate departures

The same checklist applies to both; only the clock differs.

| Situation                                          | Handover                              | Access removal                                                                      |
| -------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| Planned (resignation, internal move, contract end) | Weeks -4 to 0, with the person's help | On the last working day, at an agreed hour, after the last handover call            |
| Immediate (dismissal, security concern)            | After removal, without the person     | Before or at the conversation, coordinated with HR; minutes, not hours              |
| Internal move to another team                      | As planned, shorter                   | Remove what the new role does not need on the move date; see [[team-reorg-runbook]] |

For an immediate departure, run the access-removal checklist first and the ownership inventory straight after. Expect things to break, because nobody took over the schedules and tokens; have the on-call engineer ready and tell them what is being removed.

> [!warning] Agree immediate removals with HR and security
> An unannounced removal is a people decision as much as a technical one. Coordinate the timing with HR, and with security if there is any suspicion of misuse: in that case preserve evidence (audit logs, a copy of the account's recent activity) before you change anything, and follow [[incident-response]].

## Handover plan for a planned departure

Most of the risk is removed before the last day, while the person can still explain things.

| When    | What                                                                                                                                                                                                                  | Owner              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Week -4 | Run the ownership inventory below. Agree a handover list: every system, schedule, token, on-call slot and open piece of work, each with a named receiver.                                                             | Manager and leaver |
| Week -3 | Knowledge sessions on the things only they know, recorded and written up. Use the method in [[bus-factor-and-knowledge-transfer]]. Remove them from the on-call schedule from week -1 onwards and backfill the slots. | Leaver, receivers  |
| Week -2 | Move ownership: CODEOWNERS entries, pipeline schedules, trigger tokens and Jenkins credentials to team-owned identities (see Recurring things that break, below). Transfer open merge requests and tickets.           | Receivers          |
| Week -1 | Re-run the inventory; anything still in the person's name gets an owner and a date. Confirm the receivers can do each handed-over task alone.                                                                         | Manager            |
| Day 0   | Access removal checklist at the agreed time, then validation.                                                                                                                                                         | Manager, platform  |
| Day +7  | Re-run the inventory and the audit-log activity query. Close the offboarding ticket with the evidence.                                                                                                                | Manager            |

Keep the whole plan in one ticket. It becomes the audit evidence described below.

## Ownership inventory

Group-based access ([[iam-groups-and-ci-workload-identity-federation]]) makes leaving cheap: remove the person from the identity provider and the groups go with them. The inventory finds everything that is **not** group-based: direct bindings, personal keys and tokens, and objects that run as the person.

### GCP IAM and service-account keys

`gcloud asset search-all-iam-policies` searches IAM policies across a scope and returns only the bindings that match the query. It needs `cloudasset.assets.searchAllIamPolicies` on the scope. It finds bindings that name the person directly, including bindings on service accounts (which are impersonation rights). It does **not** show access that arrives through a group, because a group binding names the group.

```bash title="gcp-inventory.sh"
#!/usr/bin/env bash
# Read-only. Lists direct GCP IAM bindings for a leaver and the keys they created.
set -euo pipefail

EMAIL="alice@example.com"        # the leaver's identity
ORG_ID="123456789012"            # your organisation number
PROJECTS=("prod-app-1" "ops-tools")  # projects to search for key creation

echo "## Direct bindings anywhere in the organisation"
gcloud asset search-all-iam-policies \
  --scope="organizations/${ORG_ID}" \
  --query="policy:${EMAIL}" \
  --format=json |
  jq -r '.[] | .resource as $r | .policy.bindings[] | [$r, .role] | @tsv'

echo "## Access through groups (expanded)"
gcloud asset analyze-iam-policy \
  --organization="${ORG_ID}" \
  --identity="user:${EMAIL}" \
  --expand-groups \
  --format=yaml

echo "## Service-account keys created by the leaver (from audit logs)"
for p in "${PROJECTS[@]}"; do
  # methodName is inferred from the IAM Admin API, not verified: check one entry in your logs first.
  gcloud logging read \
    "protoPayload.methodName=\"google.iam.admin.v1.CreateServiceAccountKey\" AND protoPayload.authenticationInfo.principalEmail=\"${EMAIL}\"" \
    --project="$p" --freshness=365d --order=desc \
    --format="table(timestamp, protoPayload.resourceName)"
done
```

The key resource itself does not record who created it: the IAM key fields are name, algorithm, validity times, origin, type and disabled state. The audit log is the only place that links a key to a person, and only for as long as your log retention keeps it. Cross-check with the keys that exist now:

```bash
SA="deployer@prod-app-1.iam.gserviceaccount.com"
gcloud iam service-accounts keys list --iam-account="$SA" --managed-by=user
```

> [!note] Search results may lag
> Cloud Asset search is an index over IAM policies. For the few projects that matter most (production, the Terraform state project, the organisation itself) also read the policy directly with `gcloud projects get-iam-policy`, and compare. Group-derived access is better removed by removing the group membership than by chasing each binding.

Because the [[access-reviews-gcp-and-gke]] process already runs these inventories each quarter, a leaver with many direct bindings is also a finding for the next review: direct bindings should not exist in the first place.

### GKE RBAC

Google identities appear in Kubernetes RBAC as their email address when bound directly. List every binding that names the person as a `User` subject, case-insensitively, in each cluster:

```bash title="rbac-inventory.sh"
EMAIL="alice@example.com"
for ctx in $(kubectl config get-contexts -o name); do
  echo "## ${ctx}"
  kubectl --context "$ctx" get rolebindings,clusterrolebindings -A -o json |
    jq -r --arg u "$EMAIL" '.items[]
      | select(any(.subjects[]?; .kind == "User" and (.name | ascii_downcase) == ($u | ascii_downcase)))
      | [.kind, (.metadata.namespace // "-"), .metadata.name, .roleRef.name] | @tsv'
done
```

The filter skips bindings without subjects and ignores a `Group` subject with the same string. It does not see access through groups or through GCP IAM roles on the cluster; those come from the GCP inventory above. Check the GKE documentation for how IAM and RBAC combine on your clusters (not verified here), and see [[rbac-roles-bindings-and-least-privilege]].

### GitLab

On GitLab Self-Managed or Dedicated, an administrator token can list the person's direct memberships and personal access tokens, and any token with read access can list who owns each pipeline schedule and trigger token. The script below does all three for one group tree. It pages through results by following the `x-next-page` header, because some pagination headers may be missing on large collections.

```bash title="gitlab-ownership.sh"
#!/usr/bin/env bash
# Read-only: list what a leaver owns in GitLab. Needs an administrator token for
# memberships and personal access tokens (GitLab Self-Managed or Dedicated).
set -euo pipefail

GITLAB_URL="${GITLAB_URL:-https://gitlab.example.com}"
LEAVER="${1:?usage: gitlab-ownership.sh <gitlab-username> <group-path>}"
GROUP="${2:?usage: gitlab-ownership.sh <gitlab-username> <group-path>}"
: "${GITLAB_TOKEN:?export GITLAB_TOKEN (an administrator's token, read_api scope)}"

# GET every page of a list endpoint; prints one JSON array per page.
gl_get_all() {
  local path="$1" sep='?' page=1 hdr
  [[ "$path" == *\?* ]] && sep='&'
  hdr="$(mktemp)"
  while [[ -n "$page" ]]; do
    # The token goes in through a config on stdin, so it is not in the process list.
    printf 'header = "PRIVATE-TOKEN: %s"\n' "$GITLAB_TOKEN" |
      curl -sS --fail --config - -D "$hdr" \
        "${GITLAB_URL}/api/v4/${path}${sep}per_page=100&page=${page}" || {
      rm -f "$hdr"; return 1
    }
    echo
    page="$(awk 'tolower($1) == "x-next-page:" { gsub("\r", "", $2); print $2 }' "$hdr")"
  done
  rm -f "$hdr"
}

group_enc="$(jq -rn --arg g "$GROUP" '$g | @uri')"
user_id="$(gl_get_all "users?username=${LEAVER}" | jq -r '.[0].id // empty')"
[[ -n "$user_id" ]] || { echo "no GitLab user named ${LEAVER}" >&2; exit 1; }

echo "## Direct memberships (inherited ones are not listed)"
gl_get_all "users/${user_id}/memberships" |
  jq -r '.[] | [.source_type, .source_id, .source_name, .access_level] | @tsv'

echo "## Personal access tokens"
gl_get_all "personal_access_tokens?user_id=${user_id}" |
  jq -r '.[] | [.id, .name, (.scopes | join(",")), .expires_at, .last_used_at, .active] | @tsv'

echo "## Pipeline schedules and trigger tokens owned by ${LEAVER} in ${GROUP}"
gl_get_all "groups/${group_enc}/projects?include_subgroups=true&archived=false&simple=true" |
  jq -r '.[] | [.id, .path_with_namespace] | @tsv' |
  while IFS=$'\t' read -r pid path; do
    gl_get_all "projects/${pid}/pipeline_schedules" |
      jq -r --arg u "$LEAVER" --arg p "$path" \
        '.[] | select(.owner.username == $u) | ["schedule", $p, .id, .description, .cron, .active] | @tsv'
    gl_get_all "projects/${pid}/triggers" |
      jq -r --arg u "$LEAVER" --arg p "$path" \
        '.[] | select(.owner.username == $u) | ["trigger", $p, .id, .description, (.last_used // "never")] | @tsv'
  done
```

Run it as `GITLAB_TOKEN=... ./gitlab-ownership.sh alice platform`. Access levels in the membership output are numbers: 10 Guest, 20 Reporter, 30 Developer, 40 Maintainer, 50 Owner. The memberships endpoint returns direct memberships only; inherited ones come from the group the person was added to, so check group memberships at the top of each tree. On GitLab.com there is no instance administrator for you; the group Owner removes the member instead (see the checklist).

Also check, while you have the project list:

- Schedule variables (returned in the `variables` field of `GET /projects/:id/pipeline_schedules/:pipeline_schedule_id`, only for Maintainers, Owners and the schedule owner): people store secrets there.
- Forks of private projects in the person's own namespace, and webhooks they created. GitLab's members documentation warns that existing forks keep receiving upstream changes and webhooks keep receiving updates after a member is removed.
- Deploy keys and deploy tokens they added.

### CODEOWNERS, Jenkins, Artifactory and the rest

```bash title="codeowners-grep.sh"
# Run in a directory with shallow clones of the group's repositories.
LEAVER_HANDLE="@alice"
grep -rIn --include=CODEOWNERS -F "$LEAVER_HANDLE" . || echo "no CODEOWNERS entries"
```

GitLab reads `CODEOWNERS` from the repository root, `docs/` and `.gitlab/`, so the `--include` pattern covers all three. Also search for group handles the person was the only member of.

- **Jenkins.** Scripted clients use HTTP basic auth with a user name and an API token from the user's Security page. Search job configurations, shared libraries and other repositories' CI for the person's user name: anything calling Jenkins with their token breaks when they go. Credentials they added to the system (global or folder) credentials store (SSH keys, tokens) stay there after the user is deleted; list them by creator if your setup records it, otherwise review the store with the receivers. Credentials in their personal user store go with the user, so move any that jobs depend on first. If build authorization is configured so that jobs run as a named user, find the jobs that run as the person ([[jenkins-controller-and-agent-hardening]]).
- **Artifactory.** Personal access tokens, API keys and the person's entries in permission targets. The current token and OIDC model is in [[artifactory-access-tokens-and-oidc-for-ci]]; listing tokens per user is **not verified** here, so check the JFrog documentation for your version.
- **SSH and Chef.** Keys in `authorized_keys` on hosts and bastions, OS Login profiles, and, where Chef is still in use, the Chef user and its keys. The platform is retiring Chef ([[0041-retire-chef-for-immutable-images]]), so this list should shrink.
- **Everything else.** The paging tool, the status page, the cloud billing console, domain registrar, certificate authority accounts, vendor support portals, shared password vault folders. Keep this list in the team's offboarding template, because it is never in any API.

## Access removal checklist

Do it in this order: the identity provider first, because it cuts off every federated system at once; then the systems that hold their own credentials. The commands for each step, including SonarQube and Chef, are in [[leaver-credential-revocation-devops-tools]].

| #   | Step                                                                            | How                                                                                                                                                                                                                                                                                                                                | Rollback                              |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | Suspend the identity in the identity provider                                   | Google Workspace or Cloud Identity: suspend the user. Then sign them out of all web and device sessions (Admin SDK `users.signOut`) and delete the OAuth tokens they issued to applications (`tokens.list`, then `tokens.delete` per client). Whether suspension alone revokes gcloud refresh tokens is **not verified**: do both. | Unsuspend; the person signs in again  |
| 2   | Remove group memberships                                                        | Remove from every group, starting with privileged and on-call groups. This removes group-derived GCP IAM and GKE access.                                                                                                                                                                                                           | Re-add from the recorded list         |
| 3   | Remove direct GCP IAM bindings                                                  | From the inventory, through Terraform where the binding is managed there; by hand only for drift, then fix the code.                                                                                                                                                                                                               | Re-apply the previous Terraform state |
| 4   | Disable then delete user-managed SA keys they created                           | `gcloud iam service-accounts keys disable KEY_ID --iam-account=SA` first; delete after the observation window. See [[service-account-key-expiry-recovery]] for workloads that depended on a key.                                                                                                                                   | `keys enable` during the window       |
| 5   | Remove direct GKE RBAC bindings                                                 | Delete the bindings from the inventory through the GitOps repository that owns them.                                                                                                                                                                                                                                               | Revert the commit                     |
| 6   | Block the GitLab user (Self-Managed, Dedicated); remove the member (GitLab.com) | Block, do not delete (see below). Revoke their personal access tokens explicitly with `DELETE /personal_access_tokens/:id`.                                                                                                                                                                                                        | Unblock (`POST /users/:id/unblock`)   |
| 7   | Disable or delete the Jenkins user and revoke API tokens                        | Per your security realm. Prefer disabling to deleting while jobs still reference the user (**not verified** against the Jenkins user-management docs: check them for your version).                                                                                                                                                | Re-enable in the realm                |
| 8   | Revoke Artifactory tokens and remove the user from permission targets           | Revoke by token ID; the method is in [[artifactory-access-tokens-and-oidc-for-ci]].                                                                                                                                                                                                                                                | Issue a new token to the new owner    |
| 9   | Remove SSH keys, OS Login, bastion and Chef access                              | Through configuration management, not by hand on hosts.                                                                                                                                                                                                                                                                            | Revert the change                     |
| 10  | Vendor and SaaS accounts from the template                                      | Paging tool, status page, registrar, support portals, vault folders.                                                                                                                                                                                                                                                               | Re-invite                             |

### Block, deactivate, ban or delete in GitLab

| Action     | What it does (per GitLab docs)                                                                                                          | For a leaver?                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Block      | Cannot sign in or access repositories; data stays; does not use a seat. Self-Managed and Dedicated.                                     | **Yes.** Reversible, keeps history.                       |
| Deactivate | Only for users inactive for 90 days, and signing in again reactivates the account.                                                      | No: the person can undo it.                               |
| Ban        | Blocks and hides the person's projects, issues, merge requests and comments.                                                            | No: hides history the team needs.                         |
| Delete     | Moves contributions to a Ghost User, or with "and contributions" deletes issues, merge requests, notes, tokens and solely-owned groups. | Only later, and only if policy requires it. Prefer block. |

> [!danger] Deleting a GitLab user can remove more than you expect
> "Delete user and contributions" also deletes the person's issues, merge requests, notes and groups where they are the only Owner. GitLab's own documentation warns that it may remove more data than intended and suggests blocking instead. Block on the last day; decide on deletion months later, if ever.

Blocking also stops schedules owned by the person: GitLab's troubleshooting guidance says a schedule becomes inactive when its owner is blocked or removed from the project. That is why ownership moves in week -2, not on day 0.

## Shared secrets to rotate

Rotating everything a senior platform engineer ever saw is impossible. Rotate by risk: what they could still use from outside, and what would hurt most if they did.

| Secret                                                          | Rotate?                   | Why                                                                                                                                                            |
| --------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Break-glass account passwords and their MFA devices             | Always                    | Designed to work when everything else is off. See [[privileged-access-just-in-time-gcp-gke]].                                                                  |
| Service-account keys they downloaded or could download          | Always                    | Keys work from anywhere until disabled. Prefer replacing them with keyless auth ([[0026-keyless-ci-auth-with-workload-identity-federation]]).                  |
| Shared admin credentials (registrar, CA, vendor consoles)       | Always                    | Not covered by the identity provider.                                                                                                                          |
| Kubernetes client certificates in old kubeconfigs               | If any were issued        | Kubernetes does not support certificate revocation; a certificate stays valid until it expires. Removing RBAC bindings for that user name is what cuts it off. |
| CI variables and secrets they could read as Maintainer or admin | Production-impacting ones | Reading is not logged everywhere; assume they saw them.                                                                                                        |
| Application secrets in a secret manager they had read access to | By data sensitivity       | Use [[secret-rotation-without-downtime]] so rotation does not cause an outage.                                                                                 |
| Anything leaked or suspected                                    | Immediately               | Treat as an incident: [[leaked-credential-rotation]].                                                                                                          |

Write the decision for each row into the offboarding ticket, including "not rotated, because...". For a hostile departure, rotate the whole list on day 0.

## Recurring things that break

These are the failures that show up a week later, on a Saturday.

- **GitLab pipeline schedules.** A schedule runs with its owner's permissions; when the owner is blocked or removed it goes inactive. A Maintainer or Owner takes ownership in the UI or with `POST /projects/:id/pipeline_schedules/:schedule_id/take_ownership`. Better: move schedules to a service account or a project or group access token bot so that no schedule depends on a person.
- **CI job tokens.** A job token gets the access level of the user who triggered the pipeline, so cross-project fetches in scheduled pipelines fail when the owner loses access.
- **Pipeline trigger tokens.** A trigger token acts with the project access of the user who created it. What happens to a trigger token after its owner is blocked is **not verified**: replace each one the inventory found with a token created by a team-owned identity, and update the callers.
- **Personal access tokens in automation.** Bots, scripts and other CI systems calling GitLab with the person's token. Replace with project or group access tokens (each creates a bot member that cannot be removed from the project, with an expiry) or a GitLab service account.
- **Jenkins jobs and webhooks** that call Jenkins with the person's user name and token, and credentials they created in the store.
- **Cloud schedulers, Cloud Functions or VMs** running as a user-managed key the person created.
- **Calendars and rotations.** On-call schedules, recurring meetings they organised (the invite dies with the account), vendor contacts that send renewal notices to their mailbox ([[devops-vendor-and-licence-management]]).

## Validation

The offboarding is done when the evidence says so, not when the checklist is ticked.

1. Re-run every inventory script. Expected: no direct GCP bindings, no RBAC bindings, no GitLab memberships, no active personal access tokens, no schedules or triggers owned by the person.
2. Check from the access side: `kubectl auth can-i --list --as alice@example.com` per cluster should show nothing beyond what unauthenticated discovery allows.
3. Look for activity after the removal time. The Admin Activity and Data Access audit logs record `protoPayload.authenticationInfo.principalEmail`; search the aggregated logs (the [[gcp-audit-logs-siem]] pipeline) for the identity from the removal time onwards:

   ```bash
   EMAIL="alice@example.com"
   SINCE="2026-10-21T17:00:00Z"
   PROJECT="prod-app-1"
   gcloud logging read \
     "protoPayload.authenticationInfo.principalEmail=\"${EMAIL}\" AND timestamp>=\"${SINCE}\"" \
     --project="$PROJECT" --order=desc --limit=50 \
     --format="table(timestamp, protoPayload.serviceName, protoPayload.methodName)"
   ```

   Expected: no entries, or only failed (permission denied) attempts. Any successful call is an incident.

4. In GitLab, `GET /users?blocked=true` lists the person. Confirm that the schedules taken over in week -2 ran successfully at least once since.
5. Re-run steps 1 and 3 on day +7 and attach the output to the ticket.

## Audit evidence

The offboarding ticket is the evidence for the leaver control. Store, as described in [[audit-evidence-collection-and-retention]]:

- The handover list with receivers and dates.
- The day-0 timestamp of identity suspension, and who did it.
- Inventory output before and after (with dates), including the empty after-runs.
- The secret rotation decisions.
- The audit-log query output from validation.

> [!warning] Not legal or audit advice
> Which evidence satisfies a leaver control, and how quickly access must be removed, depends on your framework and your auditor. Agree both with them.

## Doing it humanely

Most people leave on good terms, and the process should treat them that way.

- Tell the person in week -4 what will happen and when. "Your access goes at 17:00 on Friday, after the last handover call" is respectful; a surprise lockout at lunch is not.
- Give them time to move their personal things (personal dotfiles, conference talks they own) off company systems before the last day, within policy.
- Thank them publicly for what they built and name the receivers in the same message, so the team knows who to ask now.
- Keep the security steps impersonal: the same checklist for everyone, from the most junior to the team lead. That avoids any suggestion of suspicion.

## Common mistakes

- **Deleting instead of blocking.** Merge request history, review comments and issue context disappear. Block.
- **Removing access before moving ownership.** Schedules, triggers and jobs stop, and the person who knew why is gone. Move ownership first in a planned departure.
- **Trusting the identity provider to cover everything.** Service-account keys, personal access tokens, Jenkins tokens, kubeconfig certificates and vendor accounts live outside it.
- **Searching only for the person's email.** Group-derived access needs `--expand-groups` or a group review; CODEOWNERS needs the handle; Jenkins needs the user name.
- **No validation.** A checklist ticked on day 0 proves nothing without the after-run and the audit-log query.
- **Rotating everything in a panic, or nothing.** Rotate by the risk table and write down why.
- **Forgetting the on-call schedule.** Remove the person from rotations and backfill before the last week, not after a missed page ([[on-call-health]]).

## Sources

- [gcloud asset search-all-iam-policies](https://cloud.google.com/sdk/gcloud/reference/asset/search-all-iam-policies): query syntax, scope and required permission.
- [gcloud asset analyze-iam-policy](https://cloud.google.com/sdk/gcloud/reference/asset/analyze-iam-policy): `--identity` and `--expand-groups`.
- [List and get service account keys](https://cloud.google.com/iam/docs/keys-list-get) and [gcloud iam service-accounts keys list](https://cloud.google.com/sdk/gcloud/reference/iam/service-accounts/keys/list): key fields and `--managed-by`.
- [Cloud Audit Logs overview](https://cloud.google.com/logging/docs/audit): audit log entries and the principal field. Check log types and retention for your organisation.
- [Admin SDK Directory API](https://developers.google.com/admin-sdk/directory/reference/rest): `users.signOut`, `tokens.list` and `tokens.delete`.
- [Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) and [authentication](https://kubernetes.io/docs/reference/access-authn-authz/authentication/): subjects, and that certificates cannot be revoked.
- [GitLab: moderate users](https://docs.gitlab.com/administration/moderate_users/), [delete a user account](https://docs.gitlab.com/user/profile/account/delete_account/) and [user moderation API](https://docs.gitlab.com/api/user_moderation/): block, deactivate, ban and delete.
- [GitLab: users API](https://docs.gitlab.com/api/users/) and [personal access tokens API](https://docs.gitlab.com/api/personal_access_tokens/): memberships and token listing.
- [GitLab: scheduled pipelines](https://docs.gitlab.com/ci/pipelines/schedules/) and [pipeline schedules API](https://docs.gitlab.com/api/pipeline_schedules/): owner permissions, inactive schedules and take ownership.
- [GitLab: project access tokens](https://docs.gitlab.com/user/project/settings/project_access_tokens/), [CI/CD job token](https://docs.gitlab.com/ci/jobs/ci_job_token/) and [project members](https://docs.gitlab.com/user/project/members/).
- [GitLab: Code Owners](https://docs.gitlab.com/user/project/codeowners/): file locations.
- [Jenkins: authenticating scripted clients](https://www.jenkins.io/doc/book/system-administration/authenticating-scripted-clients/) and [managing users](https://www.jenkins.io/doc/book/managing/users/).

## Related

- [[onboarding-engineers]]: the joiner side of the same process.
- [[leaver-credential-revocation-devops-tools]]: the tool-by-tool revocation runbook and its evidence record.
- [[access-reviews-gcp-and-gke]]: the quarterly review whose inventories this reuses.
- [[bus-factor-and-knowledge-transfer]]: running the knowledge sessions.
- [[leaked-credential-rotation]]: credential rotation.
- [[privileged-access-just-in-time-gcp-gke]]: why standing privilege should be rare to begin with.
- [[artifactory-access-tokens-and-oidc-for-ci]]: the token model for a system outside the identity provider.
- [[audit-evidence-collection-and-retention]]: keeping the evidence.
