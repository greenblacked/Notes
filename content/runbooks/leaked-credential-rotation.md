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
modified: 2026-10-20
evidence: source-reviewed
reviewed: 2026-10-20
review-due: 2027-04-20
destructive: true
draft: false
---

A secret has been exposed: committed to Git, printed in CI logs, pasted into a ticket or chat. Assume it is compromised from the moment it was visible to anyone who should not have it. Speed matters more than tidiness: revoke first, clean up after. This runbook is defensive and covers the response and prevention only.

> [!info] Source-reviewed on 2026-10-20
> The `gcloud`, GitLab, Artifactory, Git and Kubernetes claims were checked against vendor documentation. Only helper steps were run, in a throwaway lab: the Git history search, the `openssl rand` line, the stdin-versus-argv check and the key-file parsing. No cloud, GitLab, Artifactory or Kubernetes command was run. The Evidence section at the end lists the sources, what was not verified and the lab output.

> [!danger] This runbook revokes and deletes credentials
> Deleting a service account key, revoking a token and rewriting Git history cannot be undone. Disable or rotate first where the step says so, and read the Cleanup and rollback part of the Evidence section before running anything.

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
# store new-key.json in Secret Manager, update the consumers, then disable the old key first:
gcloud iam service-accounts keys disable "$KEY_ID" --iam-account "$SA"
# wait, watch for failures, and only then delete it:
gcloud iam service-accounts keys delete "$KEY_ID" --iam-account "$SA"
rm -P new-key.json 2>/dev/null || shred -u new-key.json   # best effort, see the note below
```

> [!danger] Deleting a key is permanent
> Google's key pages describe disabling as reversible (`keys enable`) and recommend disabling before deleting, so you can confirm nothing still depends on the key. The pages I could reach describe no undo for `keys delete`; treat a deleted key as gone. If the key is clearly burned and you must delete it at once, do so, and recover by deploying a new key to the consumer, not by looking for the old one.

Disabling or deleting a key does not cancel short-lived access tokens already issued from it. To cut those off, disable the service account or add an IAM deny policy; both interrupt every workload that uses the account.

> [!warning] Disabling the service account stops all its workloads
> `gcloud iam service-accounts disable "$SA"` is reversible with `gcloud iam service-accounts enable "$SA"`. Use it while you investigate an over-privileged account or when you cannot tell what the key did, and re-enable it as soon as the consumers hold a new credential.

`shred` is not on macOS and is not reliable on SSDs or copy-on-write file systems; write the key only to a temporary directory you delete, and treat the Secret Manager copy as the only copy.

#### GitLab tokens

Personal, project and group access tokens, deploy tokens, CI/CD variables and runner tokens each have a revoke or reset action (check the current docs for the runner action in your version). In the UI: **Settings, Access tokens** (project or group) or the user's **Access tokens** page; **Settings, Repository, Deploy tokens**. Via API, revoke a project token (set the ID and use a token with sufficient scope):

```bash
GITLAB=https://gitlab.example.com
PROJECT_ID=1234
TOKEN_ID=56
curl --request DELETE --header "PRIVATE-TOKEN: $ADMIN_TOKEN" \
  "$GITLAB/api/v4/projects/$PROJECT_ID/access_tokens/$TOKEN_ID"
```

Rotate a token in one call instead of revoke plus create. The rotate endpoints revoke the old token and return a replacement, which expires after one week unless you pass `expires_at`. The old token stops working at once, so have the consumer ready to take the new value from the response.

```bash
curl --request POST --header "PRIVATE-TOKEN: $ADMIN_TOKEN" \
  "$GITLAB/api/v4/projects/$PROJECT_ID/access_tokens/$TOKEN_ID/rotate"
# personal access token:  POST /api/v4/personal_access_tokens/:id/rotate
#                         DELETE /api/v4/personal_access_tokens/:id  (revoke)
# deploy token:           DELETE /api/v4/projects/:id/deploy_tokens/:token_id
```

Group access tokens have the same pair of endpoints under `/groups/:id/access_tokens`; check the group access tokens API page for your version. GitLab keeps revoked project and group tokens listed for a while (30 days by default) but they cannot be used.

> [!warning] Revoking is immediate and cannot be undone
> The only recovery is to create a new token and update every consumer. Rotating a token that was already revoked makes GitLab revoke the other active tokens in the same family, which is intended to limit damage.

Create a replacement with the least scope and an expiry, update the CI/CD variable (masked and protected), and rotate any secret the old token could read. For a leaked CI/CD variable, rotate the underlying secret, not just the variable.

GitLab can revoke some leaked token types itself (GitLab personal access tokens, and tokens of partners who take part in the program). Treat this as a bonus: it covers only certain types, and on self-managed instances an administrator must enable it. Revoke everything else by hand.

#### Artifactory tokens and API keys

Revoke the token in the Administration section of the UI (menu names change between versions) or with the Access REST API, and issue a scoped, expiring replacement.

```bash
# bash or zsh: -K <(...) keeps the token out of the process list
curl -fsS -X DELETE "$ARTIFACTORY_URL/access/api/v1/tokens/$TOKEN_ID" \
  -K <(printf 'header = "Authorization: Bearer %s"\n' "$ADMIN_TOKEN")
```

`DELETE /access/api/v1/tokens/{id}` revokes by token ID (`me` revokes the token making the call); admins can revoke any token, other users only their own. A separate endpoint revokes by token value; see the Revoke Token by Value page. Tokens created with an expiry below the revocable-expiry threshold (6 hours by default) cannot be revoked and simply expire, so for those, remove the user or group permission instead.

> [!warning] Revocation is immediate
> Anything still using the token fails at once. There is no undo; issue a new token and update the consumers.

Replace the token in CI variables and in any `docker login` or Maven/npm settings that use it. If the credential could push artifacts, verify what was published since the exposure and re-verify checksums or signatures before promoting anything, see [[artifact-promotion-artifactory]].

#### Kubernetes secrets

Rotate the underlying value in the source system first (database password, API key), then update the Secret. Generate the new value once and use the same value in both places; otherwise the application can no longer authenticate. Run this with history disabled (`set +o history`) or from a script; never print the value. The `kubectl` flags below were not re-checked against the reference in this review; run `kubectl create secret generic --help` on your version first.

Block A generates the value and changes the source system. Run it first.

```bash
# Generate once, without echoing it.
NEW_PW="$(openssl rand -base64 32)"

# Change it in the source system. The exact command depends on the system.
# Example for PostgreSQL (feed the statement on stdin so it stays out of the process list.
# PostgreSQL warns that a cleartext password can reach the server log; psql's \password
# avoids that, and a pre-computed SCRAM verifier is the other option):
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

Pods do not read changed environment variable secrets until restarted, and a container that mounts the Secret with `subPath` never receives updates; a whole-volume mount updates after a delay. Delete old ServiceAccount token Secrets if the exposed item was one. If the Secret came from an external manager, rotate it there and let the operator sync; editing the cluster copy will be overwritten.

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

Look for: calls from IP addresses or regions you do not use, `google.iam.admin.v1.CreateServiceAccountKey` (find it by `protoPayload.methodName`; the key-name filter above matches calls made with a key, not its creation), IAM policy changes, new service accounts, new VMs or GPU instances, storage reads and large egress, and changes to logging sinks. For GitLab, check audit events and the token's last used IP; for Artifactory, the access and request logs. If you find abuse, escalate the severity, preserve logs, and treat anything the credential could reach as compromised.

### 5. Git history and artifacts

Removing the secret from the latest commit is not remediation, because history and forks keep it.

- Rotation is the fix. Purging is hygiene.
- First find every place the value lives. Search all refs, not only the current branch:

```bash
git log --all -S'glpat-EXAMPLEEXAMPLEEXAMPL' --oneline   # commits that added or removed this exact string
git log --all -G'glpat-[A-Za-z0-9_-]{20}' --oneline       # commits whose diff matches a regex
git grep -n 'glpat-EXAMPLEEXAMPLEEXAMPL' $(git rev-list --all)   # every reachable commit; slow on big repos
```

In a lab these found the value on a deleted-from-HEAD file, a side branch and a stash (`--all` includes `refs/stash`). Once a branch or tag is deleted, `--all` no longer finds its commits, but they stay in the object store until garbage collection, and the host may still hold them (merge request refs, forks, caches).

- If you purge, use `git filter-repo` on a fresh mirror clone (the Git manual advises against `git filter-branch` and points to `git filter-repo`), force-push every branch and tag, have all collaborators re-clone, and ask the host to expunge cached views and run garbage collection. Plan this as a coordinated change: it rewrites commit IDs and breaks open merge requests and signed tags.

> [!danger] A history rewrite is irreversible and does not un-leak the secret
> Rewriting and force-pushing destroys the old commit IDs for everyone, and anyone with an old clone or fork still has the value. Keep an untouched backup mirror until the rewrite is verified, tell every collaborator before the force-push, and make sure the credential is already revoked.

- Delete or expire CI job logs and artifacts that contain the secret, and purge any container image layers or packages published with it.
- Remember copies: forks, local clones, backups, chat, wikis and caches.

### 6. Notify

- Security lead and the service owner, immediately.
- The customer, vendor or compliance contact if customer data or a third-party credential was exposed; follow your policy on timelines (some regulations set deadlines, ask your security or legal contact).
- The wider team, in a short factual summary, once the credential is dead.

### 7. Prevent a repeat

- **Remove long-lived keys.** Use [[gke-workload-identity|Workload Identity]] for pods and Workload Identity Federation for CI, so no JSON key exists to leak. Block key creation with the organisation policy constraint `iam.disableServiceAccountKeyCreation` where you can (Google's docs also name a managed equivalent, `iam.managed.disableServiceAccountKeyCreation`; check which your organisation uses, and check that no resource needs a permanent key before you enforce it).
- **Scan.** Enable secret detection in the pipeline and as a pre-receive or push protection rule, plus a pre-commit hook such as gitleaks. See [[gitlab-ci-pipeline-structure]] for where to place the job.
- **Mask and scope.** Mask and protect CI variables, give tokens the narrowest scope and the shortest expiry, and avoid `set -x` and echoing environment in jobs.
- **Centralise.** Keep secrets in Secret Manager or a vault and deliver them at runtime.
- **Alert.** Alert on service account key creation and on use from unexpected networks.

## Validation

```bash
gcloud iam service-accounts keys list --iam-account "$SA" --managed-by=user   # old key gone or disabled
gcloud logging read "protoPayload.authenticationInfo.serviceAccountKeyName:\"$KEY_ID\" AND timestamp>=\"$(date -u -d '-15 min' +%FT%TZ)\"" --limit=5   # no new calls (GNU date; on macOS use: date -u -v-15M +%FT%TZ)
kubectl rollout status deployment/my-app -n "$NS"
```

Also confirm the old token returns 401 or 403 against the real endpoint, the pipelines that used it are green with the new one, and the secret scanner no longer reports the finding (or it is marked resolved with a reason).

## Rollback

Revocation of a leaked credential is intended to be permanent; do not restore it. If rotation broke a consumer, fix the consumer by deploying the new credential, not by re-enabling the old one. The one reversible case is a disabled key (`keys enable`), which you might use for a short, supervised window only if the key was not proven exposed. Treat deleted keys and revoked tokens as unrecoverable.

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

## Evidence

Source-reviewed on 2026-10-20. Only helper steps were run, in a disposable lab. Read this section before using the note.

### Sources checked

Each bullet gives the page, the claims it backs and the check date.

- [Disable and enable service account keys](https://docs.cloud.google.com/iam/docs/keys-disable-enable): a disabled key stops authenticating and can be enabled again; disable before deleting; disabling does not revoke short-lived credentials already issued; the Service Account Key Admin role. Checked 2026-10-20.
- [gcloud iam service-accounts keys list](https://docs.cloud.google.com/sdk/gcloud/reference/iam/service-accounts/keys/list) and [keys disable](https://docs.cloud.google.com/sdk/gcloud/reference/iam/service-accounts/keys/disable): `--managed-by` takes `user`, `system` or `any` (default `any`); `--iam-account` syntax. Checked 2026-10-20, and the same synopses were read from the installed `gcloud` 570.0.0 help for `keys delete`, `keys disable`, `keys enable`, `keys list`, `service-accounts disable` and `service-accounts enable`.
- [Audit log examples for service accounts](https://docs.cloud.google.com/iam/docs/audit-logging/examples-service-accounts) and [Cloud Audit Logs overview](https://docs.cloud.google.com/logging/docs/audit): method name `google.iam.admin.v1.CreateServiceAccountKey`; field `protoPayload.authenticationInfo.serviceAccountKeyName`; Data Access logs are not on by default. Checked 2026-10-20. `gcloud logging read` flags `--freshness`, `--limit`, `--project` were read from the installed `gcloud` help.
- [Restrict service account usage](https://docs.cloud.google.com/organization-policy/restrict-service-accounts): `iam.disableServiceAccountKeyCreation`, and the managed equivalent Google recommends. Checked 2026-10-20.
- [Personal access tokens API](https://docs.gitlab.com/api/personal_access_tokens/): `DELETE /personal_access_tokens/:id`, `POST /personal_access_tokens/:id/rotate`, one-week default expiry after rotation, reuse detection. [Project access tokens API](https://archives.docs.gitlab.com/17.7/ee/api/project_access_tokens): `DELETE /projects/:id/access_tokens/:token_id` returns 204, rotate endpoint. Checked 2026-10-20 (the project page was reached as an archived 16.x/17.x copy).
- [Project access tokens](https://docs.gitlab.com/user/project/settings/project_access_tokens/) and [Deploy tokens](https://docs.gitlab.com/user/project/deploy_tokens/): UI paths, revoke is immediate, revoked group and project tokens are deleted after 30 days by default, deploy token DELETE endpoints. Checked 2026-10-20.
- [Automatic response to leaked secrets](https://docs.gitlab.com/user/application_security/secret_detection/automatic_response/): automatic revocation covers only certain token types; self-managed needs an administrator to enable it; a removed secret still lives in forks and clones. Checked 2026-10-20.
- [Revoke Token by ID](https://docs.jfrog.com/administration/reference/revoketokenbyid) and [Access Tokens](https://docs.jfrog.com/administration/docs/access-tokens): `DELETE /access/api/v1/tokens/{tokenId}`, `me`, admin versus own tokens, the revocable-expiry threshold (default 6 hours). Checked 2026-10-20.
- [git filter-branch](https://git-scm.com/docs/git-filter-branch) and [git log](https://git-scm.com/docs/git-log): filter-branch is not recommended and `git filter-repo` is the suggested alternative; `-S`, `-G`, `--all` semantics. Checked 2026-10-20.
- [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/): `subPath` mounts do not receive Secret updates; environment variables are not refreshed in a running container. Checked 2026-10-20.
- [ALTER ROLE](https://www.postgresql.org/docs/current/sql-alterrole.html): the cleartext-password caution and `\password`. Checked 2026-10-20.

### Not verified

- Direct page fetches of `docs.gitlab.com`, `docs.cloud.google.com` and `docs.jfrog.com` were blocked in the review environment. The claims above were checked against search results that summarise those official pages, plus the installed `gcloud` help. Re-read the linked pages before relying on exact wording.
- That `gcloud iam service-accounts keys delete` is irreversible: no page I could reach says so either way. The note says to treat it as gone.
- The `--format` projection `table(name.basename(),validAfterTime,validBeforeTime,keyType)` in step 2, and the `gcloud projects get-iam-policy` filter.
- Group access token endpoints (`/groups/:id/access_tokens`) were not individually fetched; the note points to the API page.
- Runner token reset in current GitLab versions; the Artifactory UI menu path; the Artifactory revoke-by-value request shape.
- The `kubectl create secret generic ... --from-file=password=/dev/stdin --dry-run=client -o yaml | kubectl apply -f -` pipeline and `kubectl rollout` commands (`kubectl` is not installed in the lab).
- `date -u -v-15M` on macOS, and `rm -P` on macOS.
- The `psql` heredoc against a real PostgreSQL server.
- Every cloud, GitLab, Artifactory and Kubernetes action in Steps 3 and 4, in a real environment. No step of this runbook was run against a real system.

### Environment

- Commands assume bash or zsh on Linux or macOS, `gcloud` with the IAM and Logging components, `kubectl`, `curl` and `git` (plus `git filter-repo` installed separately if you purge history). The `-K <(...)` form needs bash or zsh; plain `sh` rejects it.
- Lab host: see the Lab run below.

### Prerequisites

See Preconditions. Also: a role that may manage the credential (for GCP, Service Account Key Admin or equivalent), a known list of consumers, and a backup mirror of the repository before any history rewrite.

### Expected results

See Validation. After the steps, `keys list` shows the old key gone or disabled, the audit query shows no new calls from the old key, the old token returns 401 or 403, and the rollout is healthy.

### Failure conditions

See Troubleshooting. Stop and escalate if: the audit log shows use you cannot explain; the replacement credential does not work on a consumer you cannot reach; `git log --all -S` still finds the value after a rewrite (a ref or clone was missed); or the Artifactory token is below the revocable threshold and cannot be revoked.

### Cleanup and rollback

See Rollback. Disabled keys and service accounts can be enabled again; deleted keys, revoked tokens and rewritten history cannot be restored, so recover by issuing new credentials. Remove local key files and shell variables (`unset NEW_PW`), and delete the backup mirror only after the rewrite is verified.

### Lab run

Date: 2026-10-20. Host: `Linux 6.18.44-fc-v139` (`uname -sr`). Tools as printed: `git version 2.43.0`, `OpenSSL 3.0.13 30 Jan 2024`, `Python 3.13.16`, `GNU bash, version 5.2.21(1)-release`, `curl 8.5.0`. Only fake values were used in a temporary directory that the script deletes. Hashes differ on every run.

Git history search:

```bash
# fixture: a throwaway repo with a fake token committed, removed, and copied to a side branch and a stash
D="$(mktemp -d)"; cd "$D"
git init -q -b main && git config user.name lab && git config user.email lab@example.com
echo base > README && git add . && git commit -qm base
echo 'GITLAB_TOKEN=glpat-EXAMPLEEXAMPLEEXAMPL' > .env.ci && git add . && git commit -qm 'add config'
git rm -q .env.ci && git commit -qm 'remove config'
git switch -q -c feature/x && echo 'tok=glpat-EXAMPLEEXAMPLEEXAMPL' > side.txt && git add . && git commit -qm side
git switch -q main
echo 'x=glpat-EXAMPLEEXAMPLEEXAMPL' > stashed.txt && git add stashed.txt && git stash -q

echo "# 1 current tree only:"; git grep -c EXAMPLEEXAMPLE HEAD || echo "not in HEAD"
echo "# 2 pickaxe over all refs:"; git log --all -S'glpat-EXAMPLEEXAMPLEEXAMPL' --oneline
echo "# 3 regex over all refs:"; git log --all -G'glpat-[A-Za-z0-9_-]{20}' --oneline
echo "# 4 grep every reachable commit:"; git grep -n EXAMPLEEXAMPLE $(git rev-list --all) | cut -d: -f1,2,3 | cut -c1-12,41-
echo "# 5 stash is included in rev-list --all:"; git rev-list --all | grep -c "$(git rev-parse refs/stash)"

echo "# 6 delete the branch and see what --all still finds:"
git branch -q -D feature/x; git log --all -S'glpat-EXAMPLEEXAMPLEEXAMPL' --oneline | wc -l
echo "# 7 the side-branch commit is still in the object store:"
git fsck --unreachable --no-reflogs 2>/dev/null | grep -c '^unreachable commit'
cd /; rm -rf "$D"
```

```text
# 1 current tree only:
not in HEAD
# 2 pickaxe over all refs:
bc0c057 side
b400788 remove config
1b152ef add config
f447ef0 index on main: b400788 remove config
# 3 regex over all refs:
bc0c057 side
b400788 remove config
1b152ef add config
f447ef0 index on main: b400788 remove config
# 4 grep every reachable commit:
bc0c05770e36:side.txt:1
8a36d4dc9172:stashed.txt:1
1b152ef73058:.env.ci:1
f447ef0cdb8a:stashed.txt:1
# 5 stash is included in rev-list --all:
1
# 6 delete the branch and see what --all still finds:
3
# 7 the side-branch commit is still in the object store:
1
```

Generator, stdin versus argv, and key-file parsing:

```bash
D="$(mktemp -d)"; cd "$D"
# 8 the note's generator: length and character set
NEW_PW="$(openssl rand -base64 32)"
echo "length=${#NEW_PW} outside-base64-alphabet=$(printf '%s' "$NEW_PW" | tr -d 'A-Za-z0-9+/=' | wc -c)"
unset NEW_PW

# 9 stdin versus argv: a stub that prints its own command line and how many stdin bytes it read
cat > stub.py <<'PY'
import sys
data = sys.stdin.buffer.read() if not sys.stdin.isatty() else b""
print("cmdline:", open("/proc/self/cmdline", "rb").read().replace(b"\0", b" ").decode().strip(), "| stdin bytes:", len(data))
PY
V='fakeSecret+/Abc123=='
printf '%s' "$V" | python3 -I stub.py --from-file=-
python3 -I stub.py "--password=$V" </dev/null

# 10 a FAKE service account key file: which fields identify the key
cat > sa.json <<'JSON'
{"type":"service_account","project_id":"example-project","private_key_id":"0123456789abcdef0123456789abcdef01234567","private_key":"-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n","client_email":"ci-deployer@example-project.iam.gserviceaccount.com"}
JSON
python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["private_key_id"], d["client_email"])' sa.json
cd /; rm -rf "$D"
```

```text
length=44 outside-base64-alphabet=0
cmdline: python3 -I stub.py --from-file=- | stdin bytes: 20
cmdline: python3 -I stub.py --password=fakeSecret+/Abc123== | stdin bytes: 0
0123456789abcdef0123456789abcdef01234567 ci-deployer@example-project.iam.gserviceaccount.com
```

The stub shows the secret in its command line only in the argv form. That is what `ps` and `/proc/<pid>/cmdline` expose, which is why the note feeds secrets on stdin.
