---
title: Leaver offboarding for credentials the identity provider does not control
description: Find, revoke and verify a leaver's tokens and keys in GitLab, Jenkins, Artifactory, SonarQube, GCP, GKE and Chef, and record a timestamp per system.
type: runbook
tags:
  - compliance
  - security
  - audit
  - gitlab-ci
  - jenkins
  - artifactory
  - gcp
created: 2026-10-21
modified: 2026-10-21
draft: false
aliases:
  - leaver-offboarding
  - offboarding-token-revocation
---

Disabling a person in the identity provider ends their single sign-on sessions. It does not end the GitLab personal access token in a script on their laptop, the Jenkins API token in a cron job, the service account key they created last year, or the SSH key in project metadata. This runbook lists, revokes and verifies those credentials tool by tool, and produces an evidence record with a timestamp per system. The quarterly review that catches what this misses is in [[compliance/access-reviews-gcp-and-gke]]. The handover plan, the ownership inventory and the people side of a departure are in [[management/offboarding-platform-engineers]].

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Not checked against a running system
> GitLab API endpoints were checked against the GitLab documentation source (which describes GitLab 19.x), SonarQube web services against the SonarQube source, Jenkins token handling against the Jenkins handbook and core source, Chef Infra Server commands against the `chef-server-ctl` reference, and `gcloud` commands against the `gcloud` help text, all on 2026-10-21. Nothing was run against a real system. Endpoints and behaviour vary by version: check each tool's documentation for the version you run (SonarQube documents its own API at `/web_api` on your server).
>
> Not checked for this note: **everything about Artifactory** (token listing, revocation and user removal APIs), offboarding on GitLab.com (SaaS) beyond enterprise users, how to tell who created a GitLab project or group access token, any Jenkins API for listing another user's tokens, whether SonarQube deactivation revokes tokens, HMAC keys tied to user accounts, the `gcloud` format projection for project metadata, the audit log method name for service account key creation, and `knife user key` commands. Each is marked again where it appears.

## When to use

- A person leaves the organisation (leaver), including contractors at contract end.
- A person moves to a team that should no longer have platform or production access (mover losing privilege).
- An account is suspected compromised and the person is still employed: use [[runbooks/leaked-credential-rotation]] first, then the relevant steps here.

Target time: decide it in your access policy and record it in the control (for example, the leaving day for production access). This runbook does not cite a framework number for it.

## Preconditions

- **A ticket** from HR or the contract owner, with the person's leaving date and time, their manager, and who takes over their work. Put the ticket ID in every change and in the evidence record.
- **A username map** for the person across tools: identity provider email, GitLab username and numeric ID, Jenkins user ID, Artifactory username, SonarQube login, GKE principal (usually the email), Chef Infra Server user name. Keep this map in the ticket, not in this note or in Git.
- **Operator access**: a GitLab administrator token (self-managed), Jenkins `Administer`, an Artifactory administrator token, SonarQube Administer System permission, GCP roles to read IAM policies and audit logs and to disable keys, `kubectl` read access to RBAC in every cluster, and Chef Infra Server administrator access. Fetch each admin token from the secret manager for this run only; never paste it into the ticket.
- **A handover identity** for scheduled work: a team-owned account or bot that will own the person's pipeline schedules, with no more access than those schedules need.
- **A second person** for the production steps, if your separation-of-duties rules require it ([[compliance/separation-of-duties-in-deployments]]).

## Step 0: disable the identity provider account

Disable (suspend) the account in the identity provider at the agreed time. This ends SSO to GitLab, Jenkins, Artifactory and SonarQube where they use it, removes group-based GCP and GKE access, and stops new OS Login sessions that depend on the Google identity (not verified for every setup). Record the timestamp.

Do not delete the account yet: deleting it can remove ownership information you need for the steps below, and some tools lose the mapping between the person and their objects.

> [!warning] Revocation cannot be undone
> Revoking a token or deleting a key is permanent. A revoked GitLab token cannot be restored, revoked project and group access tokens are deleted after 30 days, and a deleted service account key cannot be recovered. If a revoked credential was secretly used by production automation, that automation breaks until someone issues a new credential. Transfer pipeline schedules first, disable before deleting where a tool allows it, and keep the list of what you revoked.

## Step 1: GitLab (self-managed)

Variables first; the token comes from the secret manager.

```bash title="GitLab variables"
set -euo pipefail

GITLAB_URL="https://gitlab.example.com" # change: your instance
LEAVER_ID="42"                          # change: the leaver's numeric GitLab user ID
GROUP_ID="7"                            # change: top-level group that holds production projects
# GITLAB_ADMIN_TOKEN: administrator token from the secret manager
gl() { curl --fail --silent --show-error --header "PRIVATE-TOKEN: ${GITLAB_ADMIN_TOKEN}" "$@"; }
```

**1a. Transfer pipeline schedules before anything else.** A pipeline schedule runs with its owner's permissions. When the owner is blocked or removed, the schedule becomes inactive. List the schedules the leaver owns in each project, and take ownership with the handover identity's token (`take_ownership` makes the caller the owner; in the UI it needs the Maintainer or Owner role):

```bash title="Take ownership of pipeline schedules"
# Projects in the group, including subgroups (endpoint parameters not verified; check the Groups API)
for PROJECT_ID in $(gl "${GITLAB_URL}/api/v4/groups/${GROUP_ID}/projects?include_subgroups=true&per_page=100" | jq -r '.[].id'); do
  gl "${GITLAB_URL}/api/v4/projects/${PROJECT_ID}/pipeline_schedules?per_page=100" \
    | jq -r --argjson uid "${LEAVER_ID}" --arg p "${PROJECT_ID}" \
        '.[] | select(.owner.id == $uid) | "\($p) \(.id) \(.description)"'
done

# For each line printed, as the handover identity (its token, not the admin token):
PROJECT_ID="1001"  # change: from the list
SCHEDULE_ID="17"   # change: from the list
curl --fail --silent --show-error --request POST \
  --header "PRIVATE-TOKEN: ${HANDOVER_TOKEN}" \
  "${GITLAB_URL}/api/v4/projects/${PROJECT_ID}/pipeline_schedules/${SCHEDULE_ID}/take_ownership"
```

Each request above returns only the first 100 items; page through larger groups. A handover identity with more access than the leaver had widens what the schedule can do, so check its role in each project.

**1b. Revoke personal access tokens.** Administrators can list and revoke any user's tokens. Blocking revokes personal access tokens automatically only for enterprise users, according to the GitLab documentation, so revoke them explicitly.

```bash title="Revoke personal access tokens"
# List active tokens
gl "${GITLAB_URL}/api/v4/personal_access_tokens?user_id=${LEAVER_ID}&state=active" \
  | jq -r '.[] | [.id, .name, .last_used_at] | @tsv'

# Revoke each one (expect HTTP 204)
TOKEN_ID="555" # change: from the list
gl --request DELETE "${GITLAB_URL}/api/v4/personal_access_tokens/${TOKEN_ID}"
```

Also list impersonation tokens an administrator created for the user, with `GET /users/:user_id/impersonation_tokens`, and revoke them with `DELETE /users/:user_id/impersonation_tokens/:impersonation_token_id`.

**1c. Delete SSH keys.**

```bash title="Delete SSH keys"
gl "${GITLAB_URL}/api/v4/users/${LEAVER_ID}/keys" | jq -r '.[] | [.id, .title, .created_at] | @tsv'

KEY_ID="99" # change: from the list
gl --request DELETE "${GITLAB_URL}/api/v4/users/${LEAVER_ID}/keys/${KEY_ID}"
```

GPG keys can be listed with `GET /users/:id/gpg_keys`; they sign commits rather than grant access, so removing them is optional.

**1d. Project and group access tokens.** These belong to a bot user of the project or group, not to the person, so they survive the block. The leaver may still know their secret values. List the tokens in projects the leaver maintained and rotate any they created or could have seen. Who created a token is not a field this runbook could confirm; use your naming convention, the token's description, or the audit events.

```bash title="List project and group access tokens"
gl "${GITLAB_URL}/api/v4/projects/${PROJECT_ID}/access_tokens" | jq -r '.[] | [.id, .name, .created_at, .expires_at] | @tsv'

# Rotate: revokes the old value and returns a new one. Store the new value in the secret manager at once.
gl --request POST "${GITLAB_URL}/api/v4/projects/${PROJECT_ID}/access_tokens/${TOKEN_ID}/rotate"
```

Group access tokens have the same endpoints under `/groups/:id/access_tokens`.

**1e. Block the user.** Last, so the steps above can still find the person's objects:

```bash title="Block the user"
gl --request POST "${GITLAB_URL}/api/v4/users/${LEAVER_ID}/block" # expect HTTP 201
```

A blocked user cannot sign in or access repositories, and their data is kept. Do not delete the user until your retention rules allow it: their merge requests and approvals are change evidence.

**GitLab.com.** The block, ban and deactivate APIs are for instance administrators, which GitLab.com customers are not. For enterprise users, blocking or deleting the account revokes their personal access tokens. Beyond that (removing the member from groups, and what happens to a non-enterprise user's own tokens), the SaaS path was not verified; check the GitLab.com documentation for group Owners.

## Step 2: Jenkins

- **API tokens.** As an administrator, open the user's configuration page, **Security** section, and revoke each API token. Revocation needs `Administer` or the user themselves. The HTTP handlers behind that page are internal to Jenkins and not a stable API, and no supported API for listing another user's tokens was found, so use the UI or a reviewed script console snippet and record what you revoked.
- **The account.** Jenkins core does not disable accounts itself in the pages read for this note; access ends when the security realm (SSO or LDAP) stops authenticating the user, which Step 0 does. If you use Jenkins' own user database, delete or disable the user there (not verified).
- **Credentials and jobs tied to the person.** Search the JCasC and Job DSL repositories and job configurations for the person's user ID and email, for credentials stored in their personal credential store, and for jobs configured to run as them. Rotate every credential they could read; how a job is bound to a user's identity depends on your plugins and is not verified here.

```bash title="Jenkins jobs that mention the user"
# On the controller, read-only: job configurations that mention the user
JENKINS_HOME="/var/jenkins_home" # change: your controller's home
LEAVER_JENKINS_ID="jdoe"         # change: Jenkins user ID
grep -rl --include=config.xml -- "${LEAVER_JENKINS_ID}" "${JENKINS_HOME}/jobs" || true
```

The Audit Trail entries described in [[compliance/jenkins-audit-trail-and-configuration-evidence]] show which credentials and jobs the person used recently.

## Step 3: Artifactory

Everything in this step is not verified; check the JFrog Access tokens documentation for your version before running anything.

- List the access tokens issued to the user's username through the Access API (the listing endpoint and its filters were not verified) and revoke each with `DELETE /access/api/v1/tokens/{id}`, the revocation call that [[patterns/artifactory-access-tokens-and-oidc-for-ci]] documents. That note also records that tokens with an expiry below the revocable threshold cannot be revoked and only expire.
- Remove or disable the Artifactory user, or confirm that the identity provider sync has done so. Check for legacy API keys if your version still has them.
- Rotate any shared or group-scoped token the person could read, through [[runbooks/leaked-credential-rotation]].

## Step 4: SonarQube

The token search only works for a user who exists and is active, so list and revoke tokens before deactivating the user. Listing or revoking another user's tokens needs administration permissions; deactivation needs Administer System. The way the admin token authenticates below (as the user name with an empty password) was not verified; check your server's `/web_api` page.

```bash title="Revoke SonarQube tokens and deactivate"
SONAR_URL="https://sonar.example.com" # change: your server
SONAR_LOGIN="jdoe"                    # change: the leaver's SonarQube login
# SONAR_ADMIN_TOKEN: from the secret manager

# List token names (the response field name is not verified; check the example on /web_api)
curl --fail --silent --show-error -u "${SONAR_ADMIN_TOKEN}:" \
  "${SONAR_URL}/api/user_tokens/search?login=${SONAR_LOGIN}" | jq -r '.userTokens[].name'

# Revoke one token by name
TOKEN_NAME="ci-scan" # change: from the list
curl --fail --silent --show-error -u "${SONAR_ADMIN_TOKEN}:" --request POST \
  --data-urlencode "login=${SONAR_LOGIN}" --data-urlencode "name=${TOKEN_NAME}" \
  "${SONAR_URL}/api/user_tokens/revoke"

# Deactivate the user, after all tokens are revoked
curl --fail --silent --show-error -u "${SONAR_ADMIN_TOKEN}:" --request POST \
  --data-urlencode "login=${SONAR_LOGIN}" \
  "${SONAR_URL}/api/users/deactivate"
```

Whether deactivation also removes tokens was not verified, so do not skip the revoke calls. `api/users/deactivate` also accepts `anonymize`; use it only if your retention rules say so, because it removes the link between the person and their past actions.

## Step 5: GCP

```bash title="GCP variables"
set -euo pipefail

ORG_NUMBER="123456789012"        # change: your organisation number
LEAVER_EMAIL="jdoe@example.com"  # change: the leaver's Google identity
AUDIT_PROJECT="example-audit"    # change: project with the central audit log bucket
```

**5a. Direct IAM bindings.** Group bindings went away with Step 0. Bindings granted to the person directly did not:

```bash title="Direct IAM bindings for the leaver"
gcloud asset search-all-iam-policies \
  --scope="organizations/${ORG_NUMBER}" \
  --query="policy:${LEAVER_EMAIL}" \
  --format=json > leaver-iam-bindings.json
jq -r '.[] | .resource as $r | .policy.bindings[] | [$r, .role] | @tsv' leaver-iam-bindings.json
```

Remove each binding through Terraform, not the console, so the next apply does not restore it.

**5b. Service account keys the person created.** The reliable inventory is every user-managed key on every service account the person could create keys for; the audit log only tells you who created them, and only as far back as your log retention.

```bash title="Service account keys the leaver created"
# Who created keys (method name not verified; check it against a known key creation in your logs)
gcloud logging read \
  "protoPayload.methodName=\"google.iam.admin.v1.CreateServiceAccountKey\" AND protoPayload.authenticationInfo.principalEmail=\"${LEAVER_EMAIL}\"" \
  --project="${AUDIT_PROJECT}" --freshness=365d --format=json \
  | jq -r '.[] | [.timestamp, .protoPayload.resourceName] | @tsv'

# For each service account found: list user-managed keys, disable first, delete later
SA_EMAIL="batch-runner@example-prod-1.iam.gserviceaccount.com" # change: from the list
gcloud iam service-accounts keys list --iam-account="${SA_EMAIL}" --managed-by=user
KEY_ID="0123456789abcdef0123456789abcdef01234567" # change: the key ID from the list
gcloud iam service-accounts keys disable "${KEY_ID}" --iam-account="${SA_EMAIL}"
```

`gcloud logging read` reads one day unless `--freshness` is set. Disable a key, watch for breakage for an agreed period, then `gcloud iam service-accounts keys delete`. Replace any key that production still needs with workload identity federation; see [[runbooks/service-account-key-expiry-recovery]] if something breaks. Service accounts created for the person's own use should be disabled with `gcloud iam service-accounts disable` and deleted later.

**5c. SSH keys in project metadata.** Project-wide `ssh-keys` metadata is one value with one line per key. Removing the whole key removes everyone's keys, so edit the value instead:

```bash title="Remove the leaver from project SSH metadata"
PROJECT_ID="example-prod-1" # change: each project that uses metadata SSH keys
LEAVER_SSH_USER="jdoe"      # change: the user name in the key lines

gcloud compute project-info describe --project="${PROJECT_ID}" --format=json \
  | jq -r '.commonInstanceMetadata.items[]? | select(.key == "ssh-keys") | .value' > ssh-keys.before
grep -v -- "^${LEAVER_SSH_USER}:" ssh-keys.before > ssh-keys.after || true
diff ssh-keys.before ssh-keys.after || true   # review: only the leaver's lines are removed
gcloud compute project-info add-metadata --project="${PROJECT_ID}" \
  --metadata-from-file=ssh-keys=ssh-keys.after
```

The JSON path to the metadata items was not verified; look at the `describe` output once before scripting it. Check instance-level metadata the same way on instances that do not block project-wide keys, and prefer OS Login, which ties keys to the Google identity, over metadata keys.

**5d. HMAC keys.** `gcloud storage hmac list --service-account="${SA_EMAIL}" --long` lists HMAC keys for a service account; check the service accounts from 5b. HMAC keys tied to a user account are not covered by that command, and how to find them was not verified.

## Step 6: GKE

RBAC bindings with a `User` subject survive the identity provider change and come back to life if the email is ever reused. Check every cluster:

```bash title="GKE RBAC bindings for the leaver"
CONTEXT="gke_example-prod-1_europe-west1_prod-1" # change: each cluster's kubectl context
LEAVER_EMAIL="jdoe@example.com"                  # change

kubectl --context "${CONTEXT}" get clusterrolebindings,rolebindings -A -o json \
  | jq -r --arg u "${LEAVER_EMAIL}" '
      .items[]
      | select(any(.subjects[]?; .kind == "User" and .name == $u))
      | [.kind, (.metadata.namespace // "-"), .metadata.name, .roleRef.name] | @tsv'
```

That GKE uses the Google account email as the RBAC user name is the usual setup but was not verified here. Remove the bindings from the GitOps repository, not with `kubectl delete`, or Argo CD restores them. [[learn/rbac-roles-bindings-and-least-privilege]] explains the binding types.

## Step 7: Chef Infra Server (if you still run it)

New hosts no longer use Chef on this site ([[adr/0041-retire-chef-for-immutable-images]]); skip this step if you no longer run a Chef Infra Server. On the Chef Infra Server host:

```bash title="Remove the user from Chef Infra Server"
CHEF_USER="jdoe"   # change: the leaver's Chef user name
CHEF_ORG="example" # change: each organisation the user belongs to

chef-server-ctl list-user-keys "${CHEF_USER}" --verbose
chef-server-ctl delete-user-key "${CHEF_USER}" default   # change: each key name from the list; user first, then key
chef-server-ctl org-user-remove "${CHEF_ORG}" "${CHEF_USER}"
```

The argument order of `delete-user-key` matters (user name, then key name). `chef-server-ctl user-delete` with `--remove-from-admin-groups` removes the user entirely, unless they are the only member of an admin group. The `knife user key` equivalents were not verified.

## Step 8: shared secrets the person knew

List the shared secrets the person could read: break-glass credentials, shared vault entries, CI variables in projects they maintained, database passwords from their team. Rotate them through [[runbooks/leaked-credential-rotation]] and [[patterns/secret-rotation-without-downtime]]. Prioritise anything that grants production or customer data access.

## Expected results

- GitLab: the personal access token list for the user with `state=active` is empty, the SSH key list is empty, the user's state is `blocked`, and every schedule they owned has a new owner and is active.
- Jenkins: no API tokens remain on the user's Security page, and the security realm no longer authenticates them.
- Artifactory and SonarQube: no tokens remain, and the user is removed or deactivated.
- GCP: `search-all-iam-policies` with the person's email returns no bindings; every user-managed key they created is disabled or deleted; no `ssh-keys` lines for them remain in project metadata.
- GKE: the binding query returns no rows in any cluster.
- Chef: `list-user-keys` shows no keys, or the user no longer exists.

## Evidence record

Write one record per leaver and store it with the access review evidence described in [[compliance/audit-evidence-collection-and-retention]]. Use an employee or contractor ID rather than a name; keep the username map in the ticket.

```yaml title="leaver-HR-1234.yaml"
ticket: HR-1234
subject: employee-id-12345
leaving_at: 2026-10-21T17:00:00Z
operator: platform-oncall
second_person: security-oncall
systems:
  identity_provider: { action: suspended, at: 2026-10-21T17:02:10Z }
  gitlab:
    schedules_transferred: { count: 2, to: handover-bot, at: 2026-10-21T17:05:40Z }
    personal_access_tokens_revoked: { count: 3, at: 2026-10-21T17:07:02Z }
    ssh_keys_deleted: { count: 1, at: 2026-10-21T17:07:30Z }
    project_access_tokens_rotated: { count: 1, at: 2026-10-21T17:12:00Z }
    user_blocked: { at: 2026-10-21T17:13:05Z }
  jenkins: { api_tokens_revoked: 1, at: 2026-10-21T17:20:00Z }
  artifactory: { tokens_revoked: 0, user_removed: true, at: 2026-10-21T17:25:00Z }
  sonarqube: { tokens_revoked: 2, user_deactivated: true, at: 2026-10-21T17:28:00Z }
  gcp:
    direct_bindings_removed: { count: 1, change: "MR !812", at: 2026-10-21T17:40:00Z }
    sa_keys_disabled: { count: 1, at: 2026-10-21T17:44:00Z }
    metadata_ssh_keys_removed: { projects: 1, at: 2026-10-21T17:50:00Z }
  gke: { user_bindings_removed: 0, checked_clusters: 3, at: 2026-10-21T17:55:00Z }
  chef: { not_applicable: true }
shared_secrets_rotated: ["break-glass-prod", "ci-deploy-db-password"]
verification_completed_at: 2026-10-21T18:05:00Z
```

## Failure conditions

Stop, escalate to the security lead, and record the reason in the ticket if:

- A revocation call returns anything other than success, or a verification list is not empty after revocation.
- Audit logs show the person's credentials in use after Step 0 (treat it as a possible compromise: [[runbooks/incident-response]]).
- A production job fails after a revocation and nobody can say which credential it needs.
- A schedule cannot be transferred because no suitable handover identity exists.
- The target time passes with any system not done.

## Rollback

Revocation is the safe direction; rollback is for mistakes such as offboarding the wrong account, or production automation that depended on a personal credential.

- **Wrong person or early offboarding.** Re-enable the identity provider account; unblock the GitLab user with `POST /users/:id/unblock` (not possible for users blocked by LDAP); re-enable disabled GCP keys with `gcloud iam service-accounts keys enable`; restore removed bindings by reverting the merge request. Revoked tokens and deleted keys cannot be restored: the person creates new ones.
- **Broken automation.** Issue a new credential to a service identity, not to a person, and store it in the secret manager. For GitLab schedules, call `take_ownership` again with the right identity. For GCP, prefer workload identity federation over a new key.
- **Metadata SSH keys.** Re-apply `ssh-keys.before` with `add-metadata` if the edit removed the wrong lines.

Record every rollback action in the same ticket with a timestamp.

## Automation sketch

The script below covers the GitLab and SonarQube steps, whose APIs were checked. It runs in dry-run mode unless `DRY_RUN=false` is set, and appends to the evidence record. Treat it as a starting point; run it first against a test user on a test instance.

```bash title="scripts/offboard-gitlab-sonar.sh"
#!/usr/bin/env bash
set -euo pipefail

# Change these before running.
GITLAB_URL="https://gitlab.example.com"
GITLAB_USER_ID="42"
SONAR_URL="https://sonar.example.com"
SONAR_LOGIN="jdoe"
TICKET="HR-1234"
DRY_RUN="${DRY_RUN:-true}"  # set DRY_RUN=false to revoke for real

: "${GITLAB_ADMIN_TOKEN:?fetch it from the secret manager}"
: "${SONAR_ADMIN_TOKEN:?fetch it from the secret manager}"

EVIDENCE="leaver-${TICKET}.yaml"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
run() { if [ "${DRY_RUN}" = "true" ]; then echo "DRY RUN: $*"; else "$@"; fi; }
gl() { curl --fail --silent --show-error --header "PRIVATE-TOKEN: ${GITLAB_ADMIN_TOKEN}" "$@"; }
sq() { curl --fail --silent --show-error -u "${SONAR_ADMIN_TOKEN}:" "$@"; }

echo "ticket: ${TICKET}" > "${EVIDENCE}"
echo "dry_run: ${DRY_RUN}" >> "${EVIDENCE}"

# GitLab: personal access tokens
count=0
for id in $(gl "${GITLAB_URL}/api/v4/personal_access_tokens?user_id=${GITLAB_USER_ID}&state=active&per_page=100" | jq -r '.[].id'); do
  run gl --request DELETE "${GITLAB_URL}/api/v4/personal_access_tokens/${id}"
  count=$((count + 1))
done
echo "gitlab_pats_revoked: { count: ${count}, at: $(now) }" >> "${EVIDENCE}"

# GitLab: SSH keys
count=0
for id in $(gl "${GITLAB_URL}/api/v4/users/${GITLAB_USER_ID}/keys" | jq -r '.[].id'); do
  run gl --request DELETE "${GITLAB_URL}/api/v4/users/${GITLAB_USER_ID}/keys/${id}"
  count=$((count + 1))
done
echo "gitlab_ssh_keys_deleted: { count: ${count}, at: $(now) }" >> "${EVIDENCE}"

# SonarQube: tokens first, then deactivate (search fails once the user is inactive)
count=0
while IFS= read -r name; do
  [ -n "${name}" ] || continue
  run sq --request POST --data-urlencode "login=${SONAR_LOGIN}" --data-urlencode "name=${name}" \
    "${SONAR_URL}/api/user_tokens/revoke"
  count=$((count + 1))
done < <(sq "${SONAR_URL}/api/user_tokens/search?login=${SONAR_LOGIN}" | jq -r '.userTokens[]?.name')
run sq --request POST --data-urlencode "login=${SONAR_LOGIN}" "${SONAR_URL}/api/users/deactivate"
echo "sonarqube: { tokens_revoked: ${count}, deactivated_at: $(now) }" >> "${EVIDENCE}"

# GitLab: block last. Schedules must already be transferred (step 1a).
run gl --request POST "${GITLAB_URL}/api/v4/users/${GITLAB_USER_ID}/block"
echo "gitlab_user_blocked: { at: $(now) }" >> "${EVIDENCE}"

echo "Evidence written to ${EVIDENCE}. Review it, then attach it to ${TICKET}."
```

The script does not transfer schedules (that needs the handover identity's token and a human check of each schedule), and it pages only the first 100 tokens. Never run it with `set -x`, which would print the tokens.

## Pitfalls

- **Blocking first.** Schedules owned by the person go inactive and nightly jobs silently stop. Transfer first.
- **Assuming SSO ends everything.** Tokens and keys are separate credentials. The identity provider does not know about them.
- **Deactivating SonarQube users first.** Their tokens can no longer be listed through the search API.
- **Removing all metadata SSH keys.** The whole `ssh-keys` value is shared by everyone in the project.
- **Fixing GCP and GKE by hand.** Terraform or Argo CD restores what is in Git. Change the code.
- **Forgetting project and group access tokens.** They are not the person's, but the person may know their values.
- **No record of what was revoked.** Without the evidence record, a broken pipeline next week cannot be traced back, and the auditor sees an unverified offboarding.

## Related

- [[compliance/access-reviews-gcp-and-gke]]: the quarterly review that checks leavers were fully removed.
- [[management/onboarding-engineers]]: the joiner side, which should create the username map used here.
- [[management/offboarding-platform-engineers]]: the handover and ownership plan this runbook runs inside.
- [[compliance/privileged-access-just-in-time-gcp-gke]]: time-bound elevated access, which leaves less to revoke.
- [[architecture/iam-groups-and-ci-workload-identity-federation]]: group-based access and keyless CI, which shrink this runbook.
- [[compliance/gitlab-compliance-frameworks-and-security-policies]]: GitLab group controls and audit events.
- [[compliance/common-control-framework-for-platform-teams]]: the leaver control and its test.

## Sources

- GitLab, [User moderation API](https://docs.gitlab.com/api/user_moderation/): block, unblock, deactivate and ban.
- GitLab, [Users API](https://docs.gitlab.com/api/users/).
- GitLab, [Personal access tokens API](https://docs.gitlab.com/api/personal_access_tokens/): list by user and revoke.
- GitLab, [Personal access tokens](https://docs.gitlab.com/user/profile/personal_access_tokens/): enterprise users' tokens on block or delete.
- GitLab, [User SSH keys API](https://docs.gitlab.com/api/user_keys/).
- GitLab, [Project access tokens](https://docs.gitlab.com/user/project/settings/project_access_tokens/): bot users and revocation.
- GitLab, [Pipeline schedules API](https://docs.gitlab.com/api/pipeline_schedules/) and [Scheduled pipelines](https://docs.gitlab.com/ci/pipelines/schedules/): ownership and `take_ownership`.
- GitLab, [Moderate users](https://docs.gitlab.com/administration/moderate_users/).
- Jenkins handbook, [Authenticating scripted clients](https://www.jenkins.io/doc/book/system-administration/authenticating-scripted-clients/): API tokens.
- JFrog, [Access tokens REST API](https://jfrog.com/help/r/jfrog-rest-apis/access-tokens) (not verified for this note).
- SonarSource, [SonarQube documentation](https://docs.sonarsource.com/), and the `/web_api` page on your own server.
- Google Cloud, [Searching IAM policies](https://cloud.google.com/asset-inventory/docs/searching-iam-policies).
- Google Cloud, [gcloud iam service-accounts keys list](https://cloud.google.com/sdk/gcloud/reference/iam/service-accounts/keys/list), [gcloud storage hmac list](https://cloud.google.com/sdk/gcloud/reference/storage/hmac/list) and [gcloud compute project-info describe](https://cloud.google.com/sdk/gcloud/reference/compute/project-info/describe).
- Chef, [chef-server-ctl reference](https://docs.chef.io/server/ctl_chef_server/).
