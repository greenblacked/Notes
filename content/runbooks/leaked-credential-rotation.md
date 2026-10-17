---
title: Leaked credential rotation
description: Contain, revoke and rotate a leaked credential (GCP service account key, GitLab or Artifactory token, Kubernetes secret), audit its use and prevent a repeat.
type: runbook
tags:
  - runbooks
  - security
  - incident-management
  - gcp
created: 2026-10-16
modified: 2026-10-17
draft: false
---

A secret has been exposed: committed to Git, printed in CI logs, pasted into a ticket or chat. Assume it is compromised from the moment it was visible to anyone who should not have it. Speed matters more than tidiness: revoke first, clean up after. This runbook is defensive and covers the response and prevention only.

> [!info] Scope
> Commands are for the `gcloud`, `kubectl` and GitLab and Artifactory REST interfaces as known; the vendor pages were not re-fetched, so the note is not marked `verified`. Check token API paths against your GitLab and Artifactory versions.

## When to use

- A key, token, password or certificate private key appears in a repository, merge request, CI job log, artifact, container image, screenshot or chat.
- A secret scanner raises an alert (GitLab secret detection, GitHub secret scanning, gitleaks, a cloud provider notice).
- A laptop or CI runner holding secrets is lost or compromised.

Treat a confirmed exposure as a security incident. Declare it using [[incident-response]] at the severity that matches the credential's reach (a production deploy key is SEV1 or SEV2; a read-only token to a sandbox is lower).

## Preconditions

- Admin access (or a person with it on call) to the systems that issued the credential.
- A list of where the credential is used, so rotation does not cause an outage. If you do not have one, build it as step 2.
- A secure place for the new secret (Secret Manager, a vault), never chat or a ticket. See [[external-secrets-with-secret-manager]].

## Steps

### 1. Contain, and record

1. Note what leaked, where, when it was exposed, who could see it (public repo, internal repo, job log visible to the project), and for how long. Take a screenshot or link; do not copy the secret into the notes.
2. If the exposure is in a public place, restrict visibility now (make the repository private, delete the public paste, hide the job log). This reduces further exposure but does not undo it: the secret is still burned.
3. Do not delay revocation to find out whether it was used.

### 2. Identify the credential and its consumers

Find who owns it, what it can do and what depends on it.

```bash
# GCP: which service account key is it? The JSON contains private_key_id and client_email.
PROJECT=my-project
SA=ci-deployer@my-project.iam.gserviceaccount.com
gcloud iam service-accounts keys list --iam-account "$SA" --managed-by=user \
  --format="table(name.basename(),validAfterTime,validBeforeTime,keyType)"

# What can the account do?
gcloud projects get-iam-policy "$PROJECT" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:$SA" \
  --format="table(bindings.role)"
```

Search your repositories and CI settings for the places that consume it (variables, Kubernetes Secrets, Helm values, Jenkins credentials) so you can replace them in one pass.

### 3. Revoke and rotate by type

Create the replacement first when the consumer would break, deploy it, then revoke the old one. When the leak is serious and the credential is clearly dangerous, revoke first and accept the short outage.

#### GCP service account key

Prefer removing keys entirely in favour of Workload Identity (step 7). To rotate:

```bash
KEY_ID=0123456789abcdef                       # from the keys list or the leaked JSON
gcloud iam service-accounts keys create new-key.json --iam-account "$SA"
# store new-key.json in Secret Manager, update the consumers, then:
gcloud iam service-accounts keys delete "$KEY_ID" --iam-account "$SA"
shred -u new-key.json
```

If you cannot rotate quickly, disable the key (reversible, unlike delete) to stop use at once:

```bash
gcloud iam service-accounts keys disable "$KEY_ID" --iam-account "$SA"
```

If the account is over-privileged or you cannot tell what it did, also consider disabling the service account while you investigate: `gcloud iam service-accounts disable "$SA"`.

#### GitLab tokens

Personal, project, group access tokens, deploy tokens, CI/CD variables and runner registration tokens each have a revoke action. In the UI: **Settings, Access tokens** (project or group) or the user's **Access tokens** page; **Settings, Repository, Deploy tokens**. Via API, revoke a project token (set the ID and use a token with sufficient scope):

```bash
GITLAB=https://gitlab.example.com
PROJECT_ID=1234
TOKEN_ID=56
curl --request DELETE --header "PRIVATE-TOKEN: $ADMIN_TOKEN" \
  "$GITLAB/api/v4/projects/$PROJECT_ID/access_tokens/$TOKEN_ID"
```

Create a replacement with the least scope and an expiry, update the CI/CD variable (masked and protected), and rotate any secret the old token could read. For a leaked CI/CD variable, rotate the underlying secret, not just the variable.

#### Artifactory tokens and API keys

Revoke the token in the UI (**Administration, User Management, Access Tokens**) or with the access API, and issue a scoped, expiring replacement. Check your version's documentation for the API path. Replace the token in CI variables and in any `docker login` or Maven/npm settings that use it. If the credential could push artifacts, verify what was published since the exposure and re-verify checksums or signatures before promoting anything, see [[artifact-promotion-artifactory]].

#### Kubernetes secrets

Rotate the underlying value in the source system first (database password, API key), then update the Secret. Generate the new value once and use the same value in both places; otherwise the application can no longer authenticate. Run this with history disabled (`set +o history`) or from a script; never print the value.

Block A generates the value and changes the source system. Run it first.

```bash
# Generate once, without echoing it.
NEW_PW="$(openssl rand -base64 32)"

# Change it in the source system. The exact command depends on the system.
# Example for PostgreSQL (feed the statement on stdin so it stays out of the process list):
# psql -h "$DB_HOST" -U admin -d postgres <<SQL
# ALTER USER app_user WITH PASSWORD '$NEW_PW';
# SQL
# Or call the vendor's rotate or reset-key API with "$NEW_PW".
```

Continue only after the source system accepts the new value, in the same shell so `NEW_PW` is still set. Block B updates the Secret from stdin, so the value never appears in the `kubectl` arguments, and restarts the workload:

```bash
NS=my-namespace
SECRET=app-db
DEPLOY=my-app

printf '%s' "$NEW_PW" | kubectl create secret generic "$SECRET" -n "$NS" \
  --from-file=password=/dev/stdin \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl rollout restart deployment/"$DEPLOY" -n "$NS"
kubectl rollout status deployment/"$DEPLOY" -n "$NS"

unset NEW_PW
```

Pods do not read changed environment variable secrets until restarted. Delete old ServiceAccount token Secrets if the exposed item was one. If the Secret came from an external manager, rotate it there and let the operator sync; editing the cluster copy will be overwritten.

### 4. Audit usage

Look for use of the credential between the time of exposure and revocation. For GCP, use Cloud Audit Logs: Admin Activity logs are always on; Data Access logs are on only if enabled.

```bash
START=2026-10-14T00:00:00Z
gcloud logging read \
  "protoPayload.authenticationInfo.principalEmail=\"$SA\" AND timestamp>=\"$START\"" \
  --project "$PROJECT" --freshness=7d --limit=200 \
  --format="table(timestamp,protoPayload.methodName,protoPayload.resourceName,protoPayload.requestMetadata.callerIp)"

# Calls made with one specific key
gcloud logging read \
  "protoPayload.authenticationInfo.serviceAccountKeyName:\"$KEY_ID\"" \
  --project "$PROJECT" --freshness=30d --limit=200
```

Look for: calls from IP addresses or regions you do not use, `CreateServiceAccountKey`, IAM policy changes, new service accounts, new VMs or GPU instances, storage reads and large egress, and changes to logging sinks. For GitLab, check audit events and the token's last used IP; for Artifactory, the access and request logs. If you find abuse, escalate the severity, preserve logs, and treat anything the credential could reach as compromised.

### 5. Git history and artifacts

Removing the secret from the latest commit is not remediation, because history and forks keep it.

- Rotation is the fix. Purging is hygiene.
- If you purge, use `git filter-repo` (or BFG) on a fresh mirror clone, force-push every branch and tag, have all collaborators re-clone, and ask the host to expunge cached views and run garbage collection. Plan this as a coordinated change: it rewrites commit IDs and breaks open merge requests and signed tags.
- Delete or expire CI job logs and artifacts that contain the secret, and purge any container image layers or packages published with it.
- Remember copies: forks, local clones, backups, chat, wikis and caches.

### 6. Notify

- Security lead and the service owner, immediately.
- The customer, vendor or compliance contact if customer data or a third-party credential was exposed; follow your policy on timelines (some regulations set deadlines, ask your security or legal contact).
- The wider team, in a short factual summary, once the credential is dead.

### 7. Prevent a repeat

- **Remove long-lived keys.** Use [[gke-workload-identity|Workload Identity]] for pods and Workload Identity Federation for CI, so no JSON key exists to leak. Block key creation with the organisation policy constraint `iam.disableServiceAccountKeyCreation` where you can.
- **Scan.** Enable secret detection in the pipeline and as a pre-receive or push protection rule, plus a pre-commit hook such as gitleaks. See [[gitlab-ci-pipeline-structure]] for where to place the job.
- **Mask and scope.** Mask and protect CI variables, give tokens the narrowest scope and the shortest expiry, and avoid `set -x` and echoing environment in jobs.
- **Centralise.** Keep secrets in Secret Manager or a vault and deliver them at runtime.
- **Alert.** Alert on service account key creation and on use from unexpected networks.

## Validation

```bash
gcloud iam service-accounts keys list --iam-account "$SA" --managed-by=user   # old key gone or disabled
gcloud logging read "protoPayload.authenticationInfo.serviceAccountKeyName:\"$KEY_ID\" AND timestamp>=\"$(date -u -d '-15 min' +%FT%TZ)\"" --limit=5   # no new calls
kubectl rollout status deployment/my-app -n "$NS"
```

Also confirm the old token returns 401 or 403 against the real endpoint, the pipelines that used it are green with the new one, and the secret scanner no longer reports the finding (or it is marked resolved with a reason).

## Rollback

Revocation of a leaked credential is intended to be permanent; do not restore it. If rotation broke a consumer, fix the consumer by deploying the new credential, not by re-enabling the old one. The one reversible case is a disabled key (`keys enable`), which you might use for a short, supervised window only if the key was not proven exposed. Deleted keys and revoked tokens cannot be recovered.

## Troubleshooting

| Symptom                                              | Cause and fix                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Cannot tell which key leaked                         | Read `private_key_id` in the JSON, or match the key name in audit logs; if unsure, rotate every key on the account. |
| Rotation caused an outage                            | A consumer you did not find. Deploy the new secret there; add it to the consumer list for next time.                |
| No audit entries for data reads                      | Data Access logs were off. Treat reads as possible, and enable the logs for the future.                             |
| Secret still appears in GitLab after history rewrite | Merge request refs and caches keep it. Ask the instance admin to remove them; rotation already covers the risk.     |
| Pods still use the old secret                        | Not restarted, or mounted from a stale source. Restart and check the operator sync.                                 |
| Alert is a false positive                            | Document why, mark it resolved in the scanner, and add an allowlist rule with a comment.                            |

Finish with a [[blameless-postmortems|blameless postmortem]] that asks which control was missing, not who made the commit. To catch the next leak earlier, see [[patterns/secret-scanning-pre-commit-and-ci]].
