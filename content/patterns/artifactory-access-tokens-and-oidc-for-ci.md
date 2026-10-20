---
title: Scoped Artifactory access for CI with access tokens and OIDC
description: Replace shared Artifactory passwords in CI with short-lived scoped access tokens or OIDC federation from GitLab CI and Jenkins, with per-repo permissions.
type: pattern
tags:
  - patterns
  - artifactory
  - security
  - ci-cd
  - gitlab-ci
  - jenkins
  - supply-chain
created: 2026-10-19
modified: 2026-10-20
evidence: source-reviewed
reviewed: 2026-10-20
review-due: 2027-04-20
destructive: true
draft: false
---

The common starting point is one Artifactory admin user, or one long-lived API key, stored as a CI variable and shared by every pipeline. Any job in any project, on any branch, can then read, overwrite and delete anything, and one leaked log line compromises the whole artefact store. The goal here: each pipeline type gets **only the permissions it needs**, for **only as long as it needs them**, and the credential is **minted per job** where possible.

> [!info] Source-reviewed on 2026-10-20
> The Access token and OIDC REST calls, the `jf eot` command, the GitLab ID token claims and the Jenkins notes were checked against vendor documentation. The one thing run in a throwaway lab is the `curl -K` technique, against a stub server on 127.0.0.1: the Authorization header arrives and the token stays out of curl's command line. Nothing was run against Artifactory, GitLab or Jenkins. The Evidence section before Sources lists the sources, what was not verified and the lab output.

> [!danger] Revoking and removing credentials is irreversible
> Revoking a token, deleting an identity mapping and revoking the old shared credential cannot be undone, and short-lived tokens below a threshold cannot be revoked at all. Migrate one project at a time and read the Cleanup and rollback part of the Evidence section first.

## The permission model

Artifactory authorises through three pieces:

- **Users and groups.** Identities. Use groups as the unit of access, never individual users.
- **Permission targets.** A set of repositories, include and exclude path patterns, and the actions granted to groups: read, annotate, deploy or cache, delete or overwrite, manage.
- **Access tokens.** Credentials bound to a user or scoped to a group, with an expiry and an optional audience.

Design principle: separate **reading dependencies** from **writing artefacts** from **promoting artefacts**, because those are different risks. This matches the build once, promote later layout in [[artifact-promotion-artifactory]].

## Identities per pipeline type

| Group             | Repositories                          | Actions                     | Who can use it                       |
| ----------------- | ------------------------------------- | --------------------------- | ------------------------------------ |
| `ci-read`         | virtual repositories for dependencies | read                        | every pipeline, including MR jobs    |
| `ci-deploy-dev`   | `*-dev-local`                         | read, deploy (no overwrite) | branch and MR pipelines in the group |
| `ci-promote-prod` | `*-staging-local`, `*-prod-local`     | read, deploy, annotate      | protected branches and tags only     |
| `ci-cleanup`      | cache and snapshot repositories       | delete                      | scheduled maintenance pipeline only  |
| `platform-admin`  | all                                   | manage                      | humans, through SSO, never CI        |

Rules of thumb:

1. Merge request pipelines, especially from forks, get `ci-read` at most. A job that runs code from an untrusted contribution must never hold a deploy credential.
2. Deploy to dev does not grant overwrite or delete. Immutability of released versions is a property of the repository settings and the permission target.
3. The group that can write to the production repository is reachable only from protected refs. Section on OIDC below shows how to enforce that on the Artifactory side, not just in GitLab.

## Short-lived access tokens

If OIDC is not available, mint a token per pipeline from a long-lived bootstrap credential kept outside the project, or at least use scoped tokens with a short expiry.

```bash title="create-scoped-token.sh"
set -euo pipefail
: "${ARTIFACTORY_URL:?}" "${ADMIN_TOKEN:?}"

# Needs bash or zsh: process substitution is a syntax error in plain sh (dash).
# -K reads the header from a process substitution, so the bootstrap token never appears in argv (visible in ps).
# The body is JSON, which the API reference gives as the default content type.
# CI_PIPELINE_ID is digits, so it is safe inside the JSON string; escape any other value you add.
curl -fsS -X POST "${ARTIFACTORY_URL}/access/api/v1/tokens" \
  -K <(printf 'header = "Authorization: Bearer %s"\n' "${ADMIN_TOKEN}") \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"ci-deploy-dev\",\"scope\":\"applied-permissions/groups:ci-deploy-dev\",\"expires_in\":3600,\"refreshable\":false,\"description\":\"gitlab pipeline ${CI_PIPELINE_ID:-manual}\"}"
```

In the API reference, `username` takes up to 255 characters, `scope` up to 500 (it defaults to the user's own permissions), `expires_in` is an integer in seconds (0 means non-expiring and is admin-only), `refreshable` is a boolean that defaults to false, `description` takes up to 1024 characters and `audience` defaults to all services. For groups the scope looks like `applied-permissions/groups:group_1,group_2`; the docs show several spellings, so test the exact string on your instance. The docs disagree about the default expiry between pages (3600 seconds in one guide, longer elsewhere), so always set `expires_in` yourself.

Practical guidance:

- Expiry slightly above the longest expected job. Non-refreshable.
- Description carries the pipeline ID so audit logs map a token to a run.
- Revoking: `DELETE /access/api/v1/tokens/{id}` revokes a token by ID, but tokens created with an expiry below the revocable-expiry threshold (6 hours by default) cannot be revoked and only expire. A one-hour CI token is therefore not revocable by default, so the damage limit is its expiry and the group permission behind it. The API reference also lists a `force_revocable` option; check the docs and your instance's threshold before relying on revocation. See [[leaked-credential-rotation]].
- The bootstrap credential that can mint tokens is itself the most sensitive secret you have. Keep it in the secret manager used by a dedicated broker job, not in project variables.

## OIDC from GitLab CI

OIDC removes the stored secret altogether. GitLab issues a signed JWT for the job, Artifactory validates it against GitLab's published keys, applies an **identity mapping** that matches claims, and returns a short-lived Artifactory token for a mapped user or group. It is the same idea as keyless cloud authentication in [[iam-groups-and-ci-workload-identity-federation]] and [[0026-keyless-ci-auth-with-workload-identity-federation]].

```mermaid
sequenceDiagram
    autonumber
    participant Job as GitLab job
    participant GL as GitLab (issuer)
    participant RT as Artifactory (OIDC integration)
    Job->>GL: Request id_token (aud = Artifactory URL)
    GL-->>Job: Signed JWT with project_path, ref, ref_protected
    Job->>RT: Exchange JWT for access token
    RT->>GL: Fetch signing keys (cached)
    RT->>RT: Match claims against identity mappings
    RT-->>Job: Short-lived token for mapped group
    Job->>RT: Pull, deploy or promote
```

### The GitLab job

```yaml title=".gitlab-ci.yml"
promote-prod:
  stage: release
  image: releases-docker.jfrog.io/jfrog/jfrog-cli-v2-jf:X.Y.Z@sha256:0000000000000000000000000000000000000000000000000000000000000000
  id_tokens:
    ARTIFACTORY_ID_TOKEN:
      aud: https://artifactory.example.com
  variables:
    JF_URL: https://artifactory.example.com
    OIDC_PROVIDER_NAME: gitlab-ci
  script:
    - export JFROG_CLI_OIDC_EXCHANGE_TOKEN_ID="${ARTIFACTORY_ID_TOKEN}"
    - >
      export JF_ACCESS_TOKEN="$(jf eot "${OIDC_PROVIDER_NAME}" --url "${JF_URL}"
      --oidc-provider-type=GenericOidc --oidc-audience "https://artifactory.example.com"
      --format=json | jq -r .AccessToken)"
    - jf rt ping
    - jf rt build-promote --copy=true "${CI_PROJECT_NAME}" "${CI_PIPELINE_ID}" prod-local
  rules:
    - if: '$CI_COMMIT_TAG && $CI_COMMIT_REF_PROTECTED == "true"'
```

The image reference above is a placeholder: replace `X.Y.Z` and the digest with a real pinned version ([[dockerfile-hardening]]). `jf eot` (short for `jf exchange-oidc-token`) takes the provider name first and, per the JFrog CLI docs, reads the ID token from the optional second argument, from `--oidc-token-id`, or from the `JFROG_CLI_OIDC_EXCHANGE_TOKEN_ID` environment variable. The example uses the environment variable, so the JWT is not in the command line. `--oidc-provider-type` accepts `GitHub` (the default), `Azure` or `GenericOidc`; GitLab needs `GenericOidc`, so leaving it out would use the wrong default. `--format` (json or table) exists from JFrog CLI 2.105.0. `jf eot` prints the exchanged token and username rather than configuring the CLI, so the job captures the token into `JF_ACCESS_TOKEN`. The docs reviewed do not show the JSON key name, so `AccessToken` is an assumption: print the output once in a test job and adjust. The `JF_URL` and `JF_ACCESS_TOKEN` variable names for the later `jf rt` calls, and `jf rt build-promote` itself, were not checked; confirm with `jf --help` on the version your runners use. `--copy=true` makes the promotion copy instead of move, so `ci-promote-prod` does not need delete permission on the staging repository.

Without the CLI, the Access API does the same exchange: `POST /access/api/v1/oidc/token` with a token-exchange grant type, the CI ID token as `subject_token`, its type as `subject_token_type` and the integration's `provider_name`; optional fields include `project_key`, `identity_mapping_name` and `include_reference_token`. JFrog recommends keeping exchanges below 40 requests per second. Send the JWT from a file or stdin, as with the bootstrap token above, not in a command-line argument.

### The identity mapping

The mapping is where least privilege is actually enforced. It must say "this claim set gets this group", and nothing broader. Illustrative claims, using GitLab's documented claim names:

```json title="identity-mapping-promote.json"
{
  "name": "gitlab-promote-prod",
  "provider_name": "gitlab-ci",
  "priority": 1,
  "claims": {
    "iss": "https://gitlab.example.com",
    "aud": "https://artifactory.example.com",
    "project_path": "platform/payments-api",
    "ref_protected": "true"
  },
  "token_spec": {
    "username": "ci-promote-prod",
    "scope": "applied-permissions/groups:ci-promote-prod",
    "expires_in": 600
  }
}
```

Field names above are illustrative; check the current JFrog docs for the real schema and for how claim matching works (exact, wildcard, regex). The docs state that a mapping's expiration is limited to 24 hours (1440 minutes), that priority 1 is the highest, and that a project-scoped mapping wins over a global one when the request names a project. For GitLab you choose the Generic OpenID Connect provider type, and a token issuer value is needed only if the `iss` claim differs from the provider URL.

GitLab's documented ID token claims include `project_path`, `namespace_path`, `ref`, `ref_type` (branch or tag), `ref_protected` (a boolean) and, only for jobs that declare an environment, `environment` and related fields such as `environment_protected`. Newer claims exist on newer GitLab versions, so check your instance.

Conditions to put in mappings:

| Mapping          | Claim conditions                                                                           | Result group      |
| ---------------- | ------------------------------------------------------------------------------------------ | ----------------- |
| Read             | `iss`, `aud`, `namespace_path` is your group                                               | `ci-read`         |
| Deploy to dev    | `project_path` is a known project, any ref                                                 | `ci-deploy-dev`   |
| Promote and prod | `project_path` known, `ref_protected == "true"`, and `ref` matching release tags or `main` | `ci-promote-prod` |

The `ref_protected` condition is what stops an arbitrary branch from promoting. A mapping that matches on `project_path` alone means any developer who can push a branch can mint a production-capable token.

## Jenkins

Jenkins has no built-in per-job JWT. The community OpenID Connect Provider plugin can issue one: when its ID token credential is bound with the Credentials Binding plugin, Jenkins generates a fresh token for that build with limited validity, and an issuer can be scoped to a folder. Whether Artifactory's OIDC integration accepts those tokens, and what the identity mapping would match on, was not tested; check both products' docs before choosing that route. Without it:

- Store tokens as **folder-scoped credentials**, not global credentials, so only jobs in that folder can bind them. One folder per team, one credential per permission level.
- Bind with `withCredentials` so Jenkins masks the value in the log, and never `echo` it or pass it on a command line that shows up in the process list. Masking guards against accidents, not against a job that deliberately encodes or writes out the secret.
- Keep the deploy token only on the controller-managed credential store of the folder that builds protected branches. Multibranch jobs for pull requests use the read credential.
- Rotate on a schedule, and on any change of folder ownership.

Agent and controller hardening is in [[jenkins-controller-and-agent-hardening]].

## Protect the credentials in GitLab

For anything that is not OIDC:

- Mark variables **masked** (hides the value in logs when it matches; the value must be a single line, at least 8 characters, and a masked value can still leak into an artifact or a remote system) and **protected** (injected only into pipelines on protected branches and tags; Maintainers and Owners can still read them, and protection does not stop malicious code on a protected branch).
- Scope variables to environments when the CI tier allows it, so production credentials never appear in a dev job.
- Do not write tokens into files committed to the repository, artefacts or cache.
- Disable debug tracing (`CI_DEBUG_TRACE`) on pipelines holding credentials: GitLab says it exposes all variables and secrets available to the job in the job log.

Structure for the pipeline layout lives in [[gitlab-ci-pipeline-structure]].

## Rotation and revocation

| Credential              | Rotation                                    | Revocation                                             |
| ----------------------- | ------------------------------------------- | ------------------------------------------------------ |
| OIDC-minted token       | Not needed; expires in minutes              | Remove or disable the identity mapping                 |
| Scoped token (minted)   | Expires with the job                        | Revoke by ID only if above the revocable threshold     |
| Stored read token       | Regular schedule, and on suspected exposure | Revoke, issue a new one, update the variable           |
| Bootstrap/minting token | Shortest schedule you can keep up with      | Revoke immediately on exposure; audit tokens it minted |

A token below the threshold cannot be revoked, so for it the response is to remove the permission it relies on (the group's permission target or the user) and wait for expiry.

> [!warning] Removing a mapping or permission stops every pipeline that relies on it
> Disabling an identity mapping or a permission target is the OIDC-side revocation. Pipelines fail with 401 or 403 until the mapping is restored, and there is no way to recall tokens already minted. Re-create the mapping from your source copy to restore access.

After any exposure: revoke, review the Artifactory audit and request logs for the token's use, and check for artefacts deployed or overwritten in the window. The full procedure is [[leaked-credential-rotation]].

## Failure modes

- **Token expires mid-pipeline.** Long builds with a short expiry fail on the deploy step. Mint the token in the job that uses it, not in an early stage that other jobs inherit, and size expiry to the job.
- **Over-broad mapping.** Wildcard `project_path` or missing `ref_protected` lets any branch deploy. Test with a negative case (below).
- **Token in logs.** Masking only hides exact matches; a base64 or URL-encoded form leaks. Pass tokens through stdin or an env var consumed by the tool, and never `set -x` around the call.
- **Clock or issuer drift.** Validation fails after a GitLab URL or key change. Alert on failed exchanges.
- **One shared mapping for everything.** Defeats the point; the first compromised MR job holds the prod group.
- **Artifactory unavailable.** Both read and write pipelines stop. See the availability trade-off in [[artifactory-remote-repo-caching-for-ci]].

## Verify

```bash title="verify access"
# Authenticated and reachable
jf rt ping

# Positive: protected tag pipeline can promote
# Negative: the production job only runs on protected tags, so pushing an unprotected branch tests nothing.
# Instead add a temporary job, with no protected-ref rule, that runs only the token exchange:
#   jf eot "${OIDC_PROVIDER_NAME}" "${ARTIFACTORY_ID_TOKEN}" --oidc-audience "https://artifactory.example.com"
git switch -c test/unprotected-oidc
git push origin test/unprotected-oidc
# Expect the exchange to be refused (401/403) and no token minted. Then delete the temporary job and branch:
git push origin --delete test/unprotected-oidc
```

> [!warning] Run the negative test on a canary project
> The test pushes a branch and adds a temporary job. Delete both afterwards (the last command above removes the remote branch) and make sure the temporary job never merges, because it runs the exchange on an unprotected ref.

Also confirm in the Artifactory audit log that tokens carry the expected username and short expiry, and that `ci-read` cannot deploy: try a deploy with the read credential and expect 403.

## Rollback

1. Keep the old stored credential in place, but unreferenced, until OIDC works on a canary project.
2. Migrate one project at a time: add its mapping, switch its pipeline, run the positive and negative tests.
3. If exchange fails across the fleet, restore the stored-token variable on the affected projects (revoke it again after the incident) and disable the faulty mapping.
4. Remove the old shared credential only after every project has moved, then revoke it.

> [!danger] Revoking the old shared credential is the point of no return
> After it, any forgotten consumer fails and the only fix is a new credential. Keep it unreferenced but valid until the audit log shows no use for at least one full release cycle.

## Related

- [[artifact-promotion-artifactory]]
- [[artifactory-remote-repo-caching-for-ci]]
- [[iam-groups-and-ci-workload-identity-federation]]
- [[leaked-credential-rotation]]
- [[jenkins-controller-and-agent-hardening]]
- [[gitlab-ci-pipeline-structure]]
- [[secret-rotation-without-downtime]]

## Evidence

Source-reviewed on 2026-10-20. Only the `curl -K` technique was run, in a disposable lab. Read this section before using the note.

### Sources checked

Each bullet gives the page, the claims it backs and the check date.

- [Create Token / Refresh Token](https://docs.jfrog.com/administration/reference/createtoken): `POST /access/api/v1/tokens`; `username`, `scope`, `expires_in`, `refreshable`, `description`, `audience`, `force_revocable`; JSON as the default content type. Checked 2026-10-20.
- [Access Tokens](https://docs.jfrog.com/administration/docs/access-tokens): group scope `applied-permissions/groups:group_1,group_2`; the revocable-expiry threshold (default 6 hours). Checked 2026-10-20.
- [Revoke Token by ID](https://docs.jfrog.com/administration/reference/revoketokenbyid): `DELETE /access/api/v1/tokens/{tokenId}`, `me`, admin versus own tokens. Checked 2026-10-20.
- [OpenID Connect Integration](https://docs.jfrog.com/administration/docs/openid-connect-integration) and [OIDC Token Exchange](https://docs.jfrog.com/administration/reference/oidctokenexchange): Generic OpenID Connect for GitLab, identity mapping priority and the 24-hour cap, `POST /access/api/v1/oidc/token` and its fields, the exchange rate recommendation. Checked 2026-10-20.
- [Exchange an OIDC Token for JFrog Access](https://docs.jfrog.com/integrations/docs/jf-exchange-oidc-token): `jf eot` syntax, `--oidc-audience`, `--oidc-provider-type` (`GitHub`, `Azure`, `GenericOidc`), `--oidc-token-id`, `JFROG_CLI_OIDC_EXCHANGE_TOKEN_ID`, `--format` from 2.105.0. Checked 2026-10-20.
- [OIDC authentication with ID tokens](https://docs.gitlab.com/ci/secrets/id_token_authentication/): `id_tokens` with `aud`, and the claims `project_path`, `namespace_path`, `ref`, `ref_type`, `ref_protected`, `environment`. Checked 2026-10-20.
- [GitLab CI/CD variables](https://docs.gitlab.com/ci/variables/) and [Pipeline security](https://docs.gitlab.com/ci/pipeline_security/): masking limits, protected variables, `CI_DEBUG_TRACE` exposure. Checked 2026-10-20.
- [Credentials Binding plugin](https://plugins.jenkins.io/credentials-binding/) and [OpenID Connect Provider plugin](https://plugins.jenkins.io/oidc-provider/): masking limits, fresh per-build ID token, folder-scoped issuer. Checked 2026-10-20.

### Not verified

- Direct page fetches of `docs.gitlab.com` and `docs.jfrog.com` were blocked in the review environment. The claims above were checked against search results that summarise the official pages. Re-read the linked pages before relying on exact wording.
- The identity-mapping JSON schema (`token_spec`, `claims` and the matching rules); the note's example stays labelled illustrative.
- The JSON key name that `jf eot --format=json` prints (`AccessToken` is an assumption), the `JF_URL` and `JF_ACCESS_TOKEN` environment variable names, `jf rt ping`, and `jf rt build-promote --copy=true`. The `jf` binary was not available.
- That a form-encoded body (`curl -d key=value`) is accepted; the note sends JSON, which the API reference gives as the default. The JSON body was not sent to a real Artifactory.
- Whether `force_revocable` lets a short token be revoked, the endpoint for listing tokens, and the revoke-by-value request shape.
- Which JFrog editions and hosting models support OIDC integrations, and whether Artifactory accepts tokens from the Jenkins OIDC Provider plugin.
- Project-scoped mappings and the dynamic mapping feature mentioned in the docs; the note does not use them.
- Every Artifactory, GitLab and Jenkins action in a real environment. No step of this pattern was run against a real system.

### Environment

- Commands assume bash or zsh (`-K <(...)` is a syntax error in plain `sh`), `curl` with `-K` support, `jq`, and for the OIDC route JFrog CLI 2.105.0 or newer for `--format`.
- Lab host: see the Lab run below.

### Prerequisites

An Artifactory instance whose edition supports OIDC integrations and access tokens, an OIDC integration for your GitLab issuer, identity mappings per group, protected branches and tags for the production path, and the groups and permission targets from the table above. A canary project for the migration.

### Expected results

The positive pipeline on a protected tag exchanges its ID token and promotes. The negative test on an unprotected branch gets 401 or 403 and no token. The read credential cannot deploy (403). Minted tokens in the audit log carry the expected username and a short expiry. See Verify.

### Failure conditions

Stop the migration if: the exchange succeeds on an unprotected ref (the mapping is too broad); a token is minted for a different group than the mapping names; the exchange fails across the fleet (see Rollback); or a token you need to revoke is below the revocable threshold.

### Cleanup and rollback

See Rollback. Disabled mappings can be re-created; revoked tokens and a revoked shared credential cannot be restored. Delete the negative-test branch and temporary job, and `unset` any exported token variables.

### Lab run

Date: 2026-10-20. Host: `Linux 6.18.44-fc-v139` (`uname -sr`). Tools as printed: `curl 8.5.0 (x86_64-pc-linux-gnu) libcurl/8.5.0 OpenSSL/3.0.13` (`curl --version | head -1`), `Python 3.13.16`, `GNU bash, version 5.2.21(1)-release`. A stub server on 127.0.0.1 records the Authorization header and holds each request open for three seconds so curl's command line can be sampled. Only a fake token was used.

Stub server (`srv.py`):

```python
import http.server, sys, time, json
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n=int(self.headers.get("Content-Length",0)); body=self.rfile.read(n).decode()
        with open("seen.txt","a") as f:
            f.write("Authorization=%s\nbody=%s\n" % (self.headers.get("Authorization"), body))
        time.sleep(3)  # hold request open so curl can be sampled
        out=json.dumps({"ok":True}).encode()
        self.send_response(200); self.send_header("Content-Length",str(len(out))); self.end_headers(); self.wfile.write(out)
    def log_message(self,*a): pass
http.server.ThreadingHTTPServer(("127.0.0.1",18080),H).serve_forever()
```

The note's token-minting `curl` call, saved as `mint.sh` (comments omitted):

```bash
set -euo pipefail
: "${ARTIFACTORY_URL:?}" "${ADMIN_TOKEN:?}"
curl -fsS -X POST "${ARTIFACTORY_URL}/access/api/v1/tokens" \
  -K <(printf 'header = "Authorization: Bearer %s"\n' "${ADMIN_TOKEN}") \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"ci-deploy-dev\",\"scope\":\"applied-permissions/groups:ci-deploy-dev\",\"expires_in\":3600,\"refreshable\":false,\"description\":\"gitlab pipeline ${CI_PIPELINE_ID:-manual}\"}"
```

Commands:

```bash
# A tiny stub server on 127.0.0.1 that records the Authorization header and body, and holds each request open for 3 seconds
python3 -I srv.py & SP=$!
sleep 1
export ADMIN_TOKEN='fake-admin-token-EXAMPLE123' ARTIFACTORY_URL=http://127.0.0.1:18080 CI_PIPELINE_ID=42

check() {  # print whether the token is in the running curl's command line
  CP=$(pgrep -n -x curl)
  echo "token in /proc/$CP/cmdline: $(tr '\0' ' ' </proc/$CP/cmdline | grep -c "$ADMIN_TOKEN")"
  tr '\0' ' ' </proc/$CP/cmdline | cut -c1-150; echo
}

echo "== A: the note's form, -K <(printf ...), JSON body"
bash mint.sh >/dev/null & sleep 1; check; sleep 3

echo "== B: -K - with the header on stdin"
printf 'header = "Authorization: Bearer %s"\n' "$ADMIN_TOKEN" | curl -fsS -X POST "$ARTIFACTORY_URL/y" -K - -d a=b >/dev/null & sleep 1; check; sleep 3

echo "== C: header in argv (what to avoid)"
curl -fsS -X POST "$ARTIFACTORY_URL/x" -H "Authorization: Bearer ${ADMIN_TOKEN}" -d a=b >/dev/null & sleep 1; check; sleep 3

echo "== D: what the server received"
cat seen.txt
echo "== E: process substitution under dash"
sh -c 'curl -K <(echo x) http://127.0.0.1:1/' 2>&1 | head -1
kill $SP; wait 2>/dev/null
```

Observed output:

```text
== A: the note's form, -K <(printf ...), JSON body
token in /proc/27861/cmdline: 0
curl -fsS -X POST http://127.0.0.1:18080/access/api/v1/tokens -K /dev/fd/63 -H Content-Type: application/json -d {"username":"ci-deploy-dev","scope":"

== B: -K - with the header on stdin
token in /proc/28035/cmdline: 0
curl -fsS -X POST http://127.0.0.1:18080/y -K - -d a=b

== C: header in argv (what to avoid)
token in /proc/28161/cmdline: 1
curl -fsS -X POST http://127.0.0.1:18080/x -H Authorization: Bearer fake-admin-token-EXAMPLE123 -d a=b

== D: what the server received
Authorization=Bearer fake-admin-token-EXAMPLE123
body={"username":"ci-deploy-dev","scope":"applied-permissions/groups:ci-deploy-dev","expires_in":3600,"refreshable":false,"description":"gitlab pipeline 42"}
Authorization=Bearer fake-admin-token-EXAMPLE123
body=a=b
Authorization=Bearer fake-admin-token-EXAMPLE123
body=a=b
== E: process substitution under dash
sh: 1: Syntax error: "(" unexpected
```

This shows that the header arrives at the server in all three forms, and that the token is in curl's command line only in the `-H` form. It does not show anything about Artifactory itself. A token in an environment variable is not in the command line either, but it is readable through the process environment by the same user and root.

## Sources

- [jfrog.com/help/r/jfrog-platform-administration-documentation](https://jfrog.com/help/r/jfrog-platform-administration-documentation)
- [docs.jfrog-applications.jfrog.io/jfrog-applications/jfrog-cli](https://docs.jfrog-applications.jfrog.io/jfrog-applications/jfrog-cli)
- [docs.gitlab.com/ci/secrets/id_token_authentication](https://docs.gitlab.com/ci/secrets/id_token_authentication/)
- [docs.jfrog.com: Create Token](https://docs.jfrog.com/administration/reference/createtoken)
- [docs.jfrog.com: Access Tokens](https://docs.jfrog.com/administration/docs/access-tokens)
- [docs.jfrog.com: OpenID Connect Integration](https://docs.jfrog.com/administration/docs/openid-connect-integration)
- [docs.jfrog.com: Exchange an OIDC Token for JFrog Access](https://docs.jfrog.com/integrations/docs/jf-exchange-oidc-token)
- [docs.gitlab.com/ci/variables](https://docs.gitlab.com/ci/variables/)
- [plugins.jenkins.io/oidc-provider](https://plugins.jenkins.io/oidc-provider/)
