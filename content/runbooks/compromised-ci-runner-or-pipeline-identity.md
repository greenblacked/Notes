---
title: Compromised CI runner or pipeline identity
description: Stop a compromised GitLab runner, Jenkins agent or CI identity, keep evidence, revoke its credentials and decide which artifacts it built can still be trusted.
type: runbook
tags:
  - runbooks
  - security
  - incident-management
  - ci-cd
  - gitlab-ci
  - jenkins
  - supply-chain
created: 2026-11-24
modified: 2026-11-25
draft: false
---

A CI runner is a machine that holds deploy credentials and signs what it builds. If someone else controls it, every artifact it produced since the compromise is suspect, **including artifacts with valid signatures**: with keyless signing, the attacker signs as the pipeline. The order is **stop new jobs, preserve, revoke, scope the artifacts, rebuild clean**. Host-level containment and evidence handling are in [[compromised-cloud-cluster-containment]]. This runbook adds what is specific to the build system.

> [!info] Scope and verification
> GitLab API endpoints and token behaviour were checked against GitLab documentation on 2026-11-24 (see Sources). The `gcloud` and Artifactory steps, and the Jenkins steps, were not checked. Nothing was run. Legal and disclosure duties belong to the security lead and counsel.

> [!danger] Deleting a runner or rotating tokens cannot be undone
> A deleted runner loses its job listing (`GET /runners/:id/jobs`), and a reset token is gone. Export the job list (step 2) and preserve the host (step 3) before step 4.

## When to use

Use this runbook when any of these is credible:

- Unexpected jobs ran on a runner.
- A runner host shows unknown processes.
- An artifact was signed by an unexpected identity.
- WIF tokens were used from outside CI.
- A job printed or exfiltrated secrets.
- A malicious merge request ran on a shared runner.

Use something else for these cases:

- A single leaked token with no sign of use: [[leaked-credential-rotation]].
- Cluster-wide compromise: [[compromised-cloud-cluster-containment]].

## Preconditions

- An admin token for the GitLab API, held by the responder, not by CI.
- A forensic bucket in a separate project.
- Agreed role split per [[incident-response]].
- The expected signing identity and issuer per repository, from [[image-signing-and-admission-verification]].
- An inventory of runners and their tags.
- Knowledge of which runners are shared and which are project-specific (see [[gitlab-runners-on-gke]]).

## Steps

### 0. Set variables without putting tokens on argv

```bash title="00-env.sh"
#!/usr/bin/env bash
# Sourced into the responder's shell: no `set -e`/`-u`, they would close the shell on the first non-zero exit.
GITLAB_URL="https://gitlab.example.com" # change: your GitLab
RUNNER_ID="6"                           # change: the suspect runner's ID
T0="2026-11-20T00:00:00Z"               # change: earliest credible compromise time
CASE_DIR="$HOME/incident-ci-$(date -u +%Y%m%d)"
mkdir -p "$CASE_DIR" && chmod 700 "$CASE_DIR"

HDR_FILE="$CASE_DIR/.gitlab-header"
umask 077
read -rs -p "GitLab admin token: " GL_TOKEN; echo
printf 'PRIVATE-TOKEN: %s\n' "$GL_TOKEN" > "$HDR_FILE" # printf is a builtin: the token never appears in ps
unset GL_TOKEN
glapi() { curl --fail --silent --show-error --header @"$HDR_FILE" "$@"; }
```

Source this file in the responder's bash shell. It sets no `set -e`, `set -u` or `pipefail` on purpose: those options persist in a sourced shell, and an expected non-zero exit later (`grep -F -f` with no match, a `jq` error, a 404 from `glapi`) would close the terminal mid-incident. Check the exit code of the commands that matter yourself. Delete `$HDR_FILE` at the end (see Rollback).

### 1. Stop new jobs on the runner

```bash
glapi --request PUT --form "paused=true" "$GITLAB_URL/api/v4/runners/$RUNNER_ID"
```

- If the runner is shared, pause every runner on the same host or node pool. List them with `glapi "$GITLAB_URL/api/v4/runners/all?per_page=100" > "$CASE_DIR/runners-all.json"`.
- Pausing does not stop a running job. Cancel the running jobs found in step 2 only after you have copied their logs.

### 2. Export what the runner ran

```bash
glapi "$GITLAB_URL/api/v4/runners/$RUNNER_ID/jobs?per_page=100&order_by=id&sort=desc" \
  > "$CASE_DIR/runner-$RUNNER_ID-jobs.json"
jq -r --arg t0 "$T0" '.[] | select(.created_at >= $t0 or .finished_at == null or .finished_at >= $t0)
  | [.id, .project.path_with_namespace, .ref, .commit.id, .user.username, .status] | @tsv' \
  "$CASE_DIR/runner-$RUNNER_ID-jobs.json" > "$CASE_DIR/jobs-in-window.tsv"
```

- The filter keeps jobs created before `T0` that were still running at `T0` or finished after it. Page until the jobs' `created_at` is older than `T0` minus the longest job timeout on that runner (or page the whole list if it is small), because an older, longer job can still have been running at `T0`. The API supports keyset pagination.
- For each job in the window, record the project, ref, commit, triggering user and status. These rows define the artifact scope in step 5.
- The field names in the `jq` filter must be checked against one real response first (see Not verified).

### 3. Preserve the runner host

- On GKE (Kubernetes executor): follow [[compromised-cloud-cluster-containment#Preserve evidence first]] for the runner manager pod and the job pods' node. Snapshot the node disk before any drain.
- On a VM: snapshot the disk, then isolate it with a firewall rule. Do not stop it.
- Copy the runner `config.toml` to the case directory. It contains the runner token, so keep it in `$CASE_DIR` (mode 700) only.

### 4. Revoke what the runner could reach

> [!danger] Irreversible
> Steps in this table delete or reset credentials. Confirm steps 2 and 3 are done first.

| Credential                            | Why it is exposed                                    | Action                                                                                                                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runner authentication token (`glrt-`) | Stored on the host                                   | Delete the runner after step 2: `glapi --request DELETE "$GITLAB_URL/api/v4/runners/$RUNNER_ID"`. Register a new runner on a rebuilt host. A reset prints the new token, so prefer delete.                                                 |
| CI/CD job tokens                      | Valid only while a job runs (job timeout plus 5 min) | No revoke exists. Cancel running jobs in scope. Confirm each project's job token allowlist contains only what it needs.                                                                                                                    |
| Masked or protected CI/CD variables   | Readable by any job on the runner                    | Rotate every variable that a job in `jobs-in-window.tsv` could read. Follow [[leaked-credential-rotation]] per secret type.                                                                                                                |
| Project, group and deploy tokens      | If stored as CI variables                            | Revoke and reissue ([[leaked-credential-rotation]]).                                                                                                                                                                                       |
| Pipeline trigger tokens (`glptt-`)    | If stored on the host                                | Revoke and reissue.                                                                                                                                                                                                                        |
| WIF federation to GCP                 | Jobs exchange their ID token for GCP access          | Remove the `roles/iam.workloadIdentityUser` binding for the affected `principalSet` (save the policy first). See below, [[iam-groups-and-ci-workload-identity-federation]] and [[0026-keyless-ci-auth-with-workload-identity-federation]]. |
| Artifactory access tokens or OIDC     | Used to publish                                      | Revoke tokens. Tighten the OIDC identity mapping. See [[artifactory-access-tokens-and-oidc-for-ci]].                                                                                                                                       |
| Signing keys (key-based cosign)       | If a job could read the key                          | Revoke and rotate the key. Publish the new public key to the admission policy.                                                                                                                                                             |

For WIF, save the policy, then remove the binding:

```bash
SA="ci-deployer@example-project.iam.gserviceaccount.com" # change
MEMBER="principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/gitlab/attribute.project_path/group/app" # change: the exact member in the policy
gcloud iam service-accounts get-iam-policy "$SA" --format=json > "$CASE_DIR/sa-policy-before.json"
gcloud iam service-accounts remove-iam-policy-binding "$SA" \
  --member="$MEMBER" --role="roles/iam.workloadIdentityUser"
```

Copy the member string from `sa-policy-before.json`; do not retype it.

Removing the binding stops new token exchanges. It does not invalidate access tokens already issued for the service account: they stay usable until they expire (check the current lifetime in the IAM documentation), so the audit-log check in Validation must cover that period. If the service account is used only by CI, disabling it is the faster stop; see [[leaked-credential-rotation]] for the wait before re-enabling.

The runner token prefix is `glrt-` (`glrtr-` if the runner was made with a registration token). GitLab's token overview says to use the runners API to rotate or revoke a runner authentication token.

### 5. Decide which artifacts to trust

A valid signature from inside the window proves nothing. Treat every artifact built by an in-scope job as untrusted until it is rebuilt.

1. List the digests produced by the jobs in `jobs-in-window.tsv`, from Artifactory build info ([[artifactory-provenance-evidence]]) or the registry.
2. Block them:
   - Remove them from promotion.
   - Move them to a quarantine repository, or deny them at admission ([[image-signing-and-admission-verification]]).
   - Write them to `$CASE_DIR/suspect-digests.txt`.
3. Verify everything else currently deployed against the expected identity, to catch artifacts signed by an identity that should not exist:

```bash
EXPECTED_IDENTITY="https://gitlab.example.com/group/app//.gitlab-ci.yml@refs/heads/main" # change: from your signing policy
EXPECTED_ISSUER="https://gitlab.example.com"                                            # change: your GitLab OIDC issuer
while read -r IMAGE; do
  if cosign verify "$IMAGE" \
      --certificate-identity="$EXPECTED_IDENTITY" \
      --certificate-oidc-issuer="$EXPECTED_ISSUER" > /dev/null 2>&1; then
    echo "OK   $IMAGE"
  else
    echo "FAIL $IMAGE"
  fi
done < "$CASE_DIR/deployed-digests.txt" | tee "$CASE_DIR/verify-results.txt"
```

- `deployed-digests.txt` holds one `registry/repo@sha256:...` per line. Generate it with the command below, which keeps only first-party images and strips a `docker-pullable://` prefix some runtimes add. Change the registry prefix to your own; an `imageID` that is a bare `sha256:...` has no registry path, so look up its image name in the pod spec instead.

```bash
REGISTRY_PREFIX="europe-docker.pkg.dev/example-project/" # change: your first-party registry or repository prefix
kubectl get pods -A -o jsonpath='{range .items[*]}{range .status.containerStatuses[*]}{.imageID}{"\n"}{end}{end}' \
  | sed 's#^docker-pullable://##' | grep -F "$REGISTRY_PREFIX" | sort -u > "$CASE_DIR/deployed-digests.txt"
```

- Check the SBOMs of suspect digests ([[sbom-generation-and-storage]]) for unexpected components.

### 6. Rebuild clean

- Build a new runner host or node pool from the pinned image ([[gitlab-runners-on-gke]], [[jenkins-controller-and-agent-hardening]]).
- Register a new runner with new tags.
- Re-add WIF bindings with the narrowest attribute condition.
- Rebuild every suspect artifact from a known-good commit on the clean runner, and redeploy by digest.
- Compare the old and new SBOMs.

### 7. Jenkins agents and controllers

- Disconnect the agent and put the controller in quiet-down mode.
- Treat every credential in the Jenkins credential store as exposed if the controller (not only an agent) is suspect. `secrets/master.key` decrypts them all; see [[jenkins-core-and-plugin-upgrade-rollback]] on the key.
- Rotate those credentials through [[leaked-credential-rotation]].

## Validation

- The runner shows paused, then is deleted.
- New jobs land only on the new runner.
- `verify-results.txt` has no `FAIL` for first-party workloads. Images from kube-system, GKE and third parties are out of this check; review them separately if the pipeline could have pushed to their registries.
- No digest from `suspect-digests.txt` runs: `grep -F -f suspect-digests.txt` over the step 5 pod listing returns nothing.
- After the step 4 removals and once already-issued access tokens have expired, Cloud Audit Logs show no further use of the WIF principal; see [[gcp-audit-logs-siem]].

## Rollback

- Un-pausing a runner (`paused=false`) is reversible, but do it only on a rebuilt host.
- Deletion, token resets and rotations cannot be undone. The way back is reissue.
- A WIF binding removal is restored from `sa-policy-before.json` with `add-iam-policy-binding` for the same member and role.
- Delete `$HDR_FILE` (`rm -f "$CASE_DIR/.gitlab-header"`) when the incident closes.

## Troubleshooting

| Symptom                                      | Fix                                                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `401` from the API                           | The admin token lacks admin scope or has expired. Issue a short-lived one.                                                  |
| The job listing is empty but you saw jobs    | Wrong runner ID, or pagination. Find the runner with `runners/all`.                                                         |
| `cosign verify` fails for every image        | Identity or issuer string mismatch. Compare with one known-good signature's certificate before treating all as compromised. |
| Pipelines stop after the WIF binding removal | Expected. Restore only for the rebuilt runner's identity.                                                                   |

## Not verified

- `jq` field names in the jobs response (`project.path_with_namespace`, `commit.id`, `user.username`).
- Whether a deleted runner's jobs stay visible on the project.
- The GitLab keyless certificate identity format and self-managed issuer URL.
- `gcloud iam service-accounts remove-iam-policy-binding` syntax (from the Google docs, not read today).
- Jenkins quiet-down and agent-disconnect steps.
- Artifactory quarantine mechanics.
- `curl -H @file` minimum version.
- The lifetime of access tokens already issued for a service account, and that they survive removal of the binding (stated from general IAM behaviour, not read today).
- Nothing was run.

## Related

- [[compromised-cloud-cluster-containment]]
- [[leaked-credential-rotation]]
- [[runtime-detection-alert-response]]
- [[slsa-build-provenance]]
- [[software-supply-chain-end-to-end]]
- [[ci-platform-gitlab-runners-and-jenkins-agents-on-gke]]
- [[incident-response]]

## Sources

- [GitLab Runners API](https://docs.gitlab.com/api/runners/): pause (`PUT /runners/:id` with `paused=true`), delete, reset token, `GET /runners/:id/jobs` and `GET /runners/all`. Read 2026-11-24.
- [GitLab token overview](https://docs.gitlab.com/security/tokens/): runner token prefixes `glrt-` and `glrtr-`, trigger token prefix `glptt-`, rotate or revoke through the runners API. Read 2026-11-24.
- [GitLab CI/CD job token](https://docs.gitlab.com/ci/jobs/ci_job_token/): valid only while the job runs, no manual revoke described, allowlist defaults. Read 2026-11-24.
- [Sigstore cosign verify](https://docs.sigstore.dev/cosign/verifying/verify/): `--certificate-identity` and `--certificate-oidc-issuer`. Read 2026-11-24.
- [curl man page](https://curl.se/docs/manpage.html): `-H @filename` adds a header for each line in the file. Read 2026-11-24.
