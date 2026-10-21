---
title: "Runbook: stopping a runaway or compromised AI agent"
description: Stop an agent that is overspending, writing where it should not or following injected instructions, contain its credentials, keep the evidence, and recover.
type: runbook
tags:
  - ai
  - incident-management
  - security
  - on-call
  - gcp
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Most incident notes treat AI as a helper during an incident ([[ai-assisted-incident-response]]). This runbook is for the case where the agent is the incident: a token-spend spike from a loop, merge requests or commits from the bot identity that nobody asked for, writes in cloud or cluster audit logs, a canary secret showing up where it should not, or signs that the agent is following instructions injected through an issue, a log line or a web page. The order is: **stop it, contain its credentials, keep the evidence, measure the blast radius, revert, then recover**. Each step gives the command, what to expect, how to verify it and how to undo it.

> [!info] Scope
> Agents that run as GitLab CI jobs, as Kubernetes Deployments or CronJobs on GKE, or as scheduled jobs, with a Google service account, GitLab tokens and a key for an internal LLM gateway ([[llm-api-cost-control]]). A suspected compromise of the wider project or cluster, beyond the agent's own identity, moves to [[compromised-cloud-cluster-containment]]. A single leaked secret with no sign of use is [[leaked-credential-rotation]].

> [!note] Not verified
> No step was run. The `gcloud`, GitLab API and `kubectl` calls were checked at page level, on 2026-10-21, against Google Cloud, GitLab and Kubernetes documentation through search summaries, not a full read. Not checked: whether disabling a service account invalidates access tokens already issued, the `username` filter on the GitLab pipelines list, the GitLab service-account token endpoints, how your gateway's kill switch and audit log work, and every expected output shown. Check `--help` and the version-matched GitLab API docs before you need them, not during the incident.

## Triggers

Start this runbook when any of these is credible, not only when it is proven:

- A gateway budget or token-rate alert for an agent's team or job (`LlmTokenRateHigh`, `LlmJobRunaway` in [[llm-api-cost-control]]).
- Merge requests, commits, comments or pipeline runs from the bot identity that do not match a task anyone started.
- Cloud Audit Log or Kubernetes audit entries showing the agent's identity writing (create, update, patch, delete, setIamPolicy) where it should only read.
- A canary hit: the canary string from the injection test harness ([[prompt-injection-test-harness-for-ci-agents]]) appears in a request, a tool argument, a proxy log or posted output.
- Egress proxy or firewall logs showing the agent's runner reaching hosts outside its allowlist.
- A person sees the agent post or do something that reads like someone else's instructions.

## Severity and roles

Use the scale in [[incident-response]]. Starting points:

| Situation                                                                    | Start at                      |
| ---------------------------------------------------------------------------- | ----------------------------- |
| Spend spike or loop, no writes outside the agent's normal scope              | SEV3                          |
| Unexpected writes to repositories or non-production systems                  | SEV2                          |
| Writes to production, a canary or secret seen leaving, or signs of injection | SEV1 (active security breach) |

Roles as in [[incident-response]]: an incident commander who does not type commands, an ops lead who runs the steps below one at a time and reads the result into the channel, and a scribe who keeps the timeline. Bring in the security lead as soon as injection or exfiltration is possible.

## Preconditions

Have these ready before an incident:

- An operator GitLab token (yours or a break-glass one), never the agent's own token, to cancel pipelines and revoke tokens.
- Rights to disable the agent's Google service account and to read audit logs, including Data Access logs (`roles/logging.privateLogViewer` for the `_Default` bucket).
- Rights to scale and patch the agent's workloads and delete its RBAC bindings in the cluster.
- A forensic bucket in a separate project, as in [[compromised-cloud-cluster-containment]].
- A list of every credential each agent holds, and who else uses each one. Without it, step 2 breaks things you did not expect.

Set the variables once, at the top of the incident shell:

```bash title="incident-vars.sh"
export INCIDENT="INC-0000"                                          # change: the incident ID
export SINCE="2026-10-21T00:00:00Z"                                 # change: start of the suspicious window, with margin
export PROJECT="example-project"                                    # change: the project the agent works in
export AGENT_SA="agent-review@example-project.iam.gserviceaccount.com"  # change: the agent's Google service account
export K8S_CONTEXT="prod-cluster"                                   # change: the cluster context
export AGENT_NS="ai-agents"                                         # change: the agent's namespace
export AGENT_SELECTOR="app.kubernetes.io/part-of=ai-agent"          # change: a label selecting the agent's workloads
export K8S_SA="agent-review"                                        # change: the agent's Kubernetes ServiceAccount
export GITLAB="https://gitlab.example.com/api/v4"
export GL_PROJECT="platform%2Fexample-repo"                         # change: URL-encoded project path or numeric ID
export BOT_USER="agent-review-bot"                                  # change: the bot user's username
mkdir -p "evidence/$INCIDENT"
printf 'Operator GitLab token: '; read -rs GL_TOKEN; echo; export GL_TOKEN
```

Keep a containment log: time, who ran which command, the output, and the rollback. Every step below adds a line to it.

## Steps

### 1. Stop the agent

The aim is to stop new actions within minutes, without destroying anything.

#### 1a. Gateway kill switch

Turn off the agent's key or team at the gateway, or the global flag if you cannot tell which agent it is. How depends on your gateway (a feature flag, a policy change, disabling a key); see the kill switch section of [[llm-api-cost-control]].

- **Expected:** new requests from the agent are refused with the gateway's "disabled" error.
- **Verify:** the gateway's request metric for the agent's team or job drops to zero, and its log shows refusals.
- **Rollback:** turn the switch back on (step 6, not before).

Stopping the model stops new decisions, but tool calls already in flight and CI jobs already running continue. Do 1b and 1c as well.

#### 1b. Cancel the agent's pipelines

List running pipelines started by the bot, then cancel each. The cancel endpoint returns 200 whatever state the pipeline was in, so do not read a 200 as "it was running"; list again afterwards.

```bash title="cancel-agent-pipelines.sh"
set -euo pipefail

curl -sS --fail -H "PRIVATE-TOKEN: $GL_TOKEN" \
  "$GITLAB/projects/$GL_PROJECT/pipelines?status=running&username=$BOT_USER&per_page=100" \
  | tee "evidence/$INCIDENT/pipelines-running-before.json" \
  | jq -r '.[].id' > /tmp/agent-pipelines.txt

while read -r id; do
  curl -sS --fail -X POST -H "PRIVATE-TOKEN: $GL_TOKEN" \
    "$GITLAB/projects/$GL_PROJECT/pipelines/$id/cancel" | jq -r '"\(.id) \(.status)"'
done < /tmp/agent-pipelines.txt
```

- **Expected:** each pipeline prints its ID with status `canceled` or `canceling`.
- **Verify:** run the list call again; it returns `[]`. If the `username` filter is not supported by your GitLab version, list without it and filter on `.user.username` with jq. Do the same for `status=pending` and for every project the bot can reach.
- **Troubleshooting:** a 429 means the rate limit was hit; wait for `Retry-After`. A job that ignores the cancel can be cancelled individually through the Jobs API (`POST /projects/:id/jobs/:job_id/cancel`).
- **Rollback:** none needed; do not use the retry endpoint on these pipelines during recovery, because it would re-run the same inputs.

Also pause any pipeline schedule that starts the agent (in the project's schedules, or through the Pipeline schedules API).

#### 1c. Scale the agent's workloads to zero

Record the current state first; it is both evidence and the rollback.

```bash title="scale-agent-to-zero.sh"
set -euo pipefail

kubectl --context="$K8S_CONTEXT" -n "$AGENT_NS" get deploy,statefulset,cronjob,hpa \
  -l "$AGENT_SELECTOR" -o json > "evidence/$INCIDENT/workloads-before.json"
jq -r '.items[] | select(.kind=="Deployment" or .kind=="StatefulSet")
  | "\(.kind) \(.metadata.name) \(.spec.replicas)"' "evidence/$INCIDENT/workloads-before.json"

for w in $(kubectl --context="$K8S_CONTEXT" -n "$AGENT_NS" get deployment,statefulset -l "$AGENT_SELECTOR" -o name); do
  kubectl --context="$K8S_CONTEXT" -n "$AGENT_NS" scale "$w" --replicas=0
done

for cj in $(kubectl --context="$K8S_CONTEXT" -n "$AGENT_NS" get cronjob -l "$AGENT_SELECTOR" -o name); do
  kubectl --context="$K8S_CONTEXT" -n "$AGENT_NS" patch "$cj" -p '{"spec":{"suspend":true}}'
done
```

- **Expected:** `deployment.apps/<name> scaled` for each workload, `cronjob.batch/<name> patched` for each CronJob. Pods terminate gracefully within their `terminationGracePeriodSeconds`; the Deployments stay.
- **Verify:** `kubectl --context="$K8S_CONTEXT" -n "$AGENT_NS" get pods -l "$AGENT_SELECTOR"` returns no pods after the grace period, and stays empty for a few minutes.
- **Watch out:** a GitOps controller or an autoscaler can scale it back up. Suspend the sync for the agent's application first (for example `flux suspend kustomization <name>` or `argocd app set <name> --sync-policy none`), and check whether an HPA or another controller targets the workload. The HPA page documents that an HPA stops adjusting a target whose replicas you set to 0 while its `minReplicas` is above 0, until you scale the target up again; check the HPA page for your version.
- **Rollback:** scale each workload back to the replica count recorded in `workloads-before.json`, and set `suspend` back to `false` (step 6).

If you need the pods' memory or local files as evidence (an agent that may have written secrets to disk), copy what you need before scaling, as in the evidence section of [[compromised-cloud-cluster-containment]]; scaling to zero loses `emptyDir` data and process state.

### 2. Contain the credentials

> [!warning] Each revocation breaks every other user of that credential
> Disabling the Google service account stops every workload and pipeline that uses it, not only the agent. Revoking a GitLab project or group access token breaks every pipeline, script and integration that uses that token. Rotating a provider key at the provider breaks every consumer of that key, including the gateway itself if the gateway holds it. Removing RBAC bindings breaks anything else bound through the same binding. Check the credential list from the preconditions, tell the owners of shared consumers, and record each action and its rollback in the containment log before you run it.

#### 2a. Disable the agent's Google service account

```bash
gcloud iam service-accounts disable "$AGENT_SA" --project="$PROJECT"
gcloud iam service-accounts describe "$AGENT_SA" --project="$PROJECT" --format='value(disabled)'
```

- **Expected:** the describe prints `True`.
- **What it does:** while disabled, the account cannot be used to generate credentials or call Google APIs. Disabling an already disabled account changes nothing. Google recommends disabling before deleting; do not delete it, because deletion loses the identity you are investigating.
- **Not verified:** whether access tokens already issued stop working at once. Check the disable page; until you know, assume a token issued just before may work until it expires, and keep watching the audit logs.
- **Keys:** if the account has user-managed keys, list them with `gcloud iam service-accounts keys list --iam-account="$AGENT_SA" --managed-by=user` and disable each with `gcloud iam service-accounts keys disable KEY_ID --iam-account="$AGENT_SA"`. Check the flags with `--help`. Then plan to remove keys altogether ([[gcp-iam-guardrails-for-agent-service-accounts]]).
- **Rollback:** `gcloud iam service-accounts enable "$AGENT_SA" --project="$PROJECT"` in step 6. An account that Google itself disabled (for example after detecting a compromise) cannot be re-enabled this way.

#### 2b. Revoke the agent's GitLab tokens

Find the token IDs, then revoke. Do this for every project and group token the agent holds.

```bash title="revoke-gitlab-tokens.sh"
set -euo pipefail

# Project access tokens: list, keep the record, then revoke the agent's token by ID.
curl -sS --fail -H "PRIVATE-TOKEN: $GL_TOKEN" "$GITLAB/projects/$GL_PROJECT/access_tokens" \
  | tee "evidence/$INCIDENT/project-tokens.json" | jq -r '.[] | "\(.id) \(.name) \(.scopes|join(",")) \(.expires_at)"'

TOKEN_ID="0"  # change: the ID of the agent's token from the list above
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "PRIVATE-TOKEN: $GL_TOKEN" \
  "$GITLAB/projects/$GL_PROJECT/access_tokens/$TOKEN_ID"
```

- **Expected:** `204`.
- **Group tokens:** `DELETE /groups/:id/access_tokens/:token_id`, also `204` (`404` if it does not exist).
- **Personal access tokens** of a bot user: `DELETE /personal_access_tokens/:id`, `204`; an administrator can revoke any user's token. Revocation is permanent and GitLab keeps the record for audit.
- **Service-account tokens** have their own endpoints in the GitLab service accounts API; the exact path was not verified.
- **Verify:** list the tokens again and confirm the token shows as revoked or is gone, and that a call with the revoked token returns `401`.
- **Rollback:** there is none for a revoked token. Recovery issues a new token with a narrower scope and an expiry (step 6). Do not use the rotate endpoint as containment: it issues a new token, and if the attacker controls the agent's environment they may get the new one too.

#### 2c. Rotate provider and gateway keys

- **The agent's gateway key:** revoke it in the gateway; it is scoped to the agent or team, so nothing else breaks.
- **Provider keys held by the gateway:** rotate only if there is a sign the provider key itself left the gateway (it should never be in the agent's environment). Use the provider's console or API and check its documentation; then update the gateway's secret.
- **Verify:** a request with the old gateway key is refused, and the gateway's own provider calls still succeed with the new provider key.

#### 2d. Remove the agent's Kubernetes permissions

Save every binding before deleting it; the saved file is both evidence and the rollback.

```bash title="remove-agent-rbac.sh"
set -euo pipefail

kubectl --context="$K8S_CONTEXT" get rolebindings,clusterrolebindings -A -o json \
  | jq --arg ns "$AGENT_NS" --arg sa "$K8S_SA" '{apiVersion: "v1", kind: "List", items: [.items[]
      | select(any(.subjects[]?; .kind == "ServiceAccount" and .name == $sa and .namespace == $ns))]}' \
  > "evidence/$INCIDENT/agent-bindings.json"

jq -r '.items[] | "\(.kind) \(.metadata.namespace // "-") \(.metadata.name)"' "evidence/$INCIDENT/agent-bindings.json"

jq -r '.items[] | if .kind == "ClusterRoleBinding" then "clusterrolebinding/\(.metadata.name)"
  else "-n \(.metadata.namespace) rolebinding/\(.metadata.name)" end' "evidence/$INCIDENT/agent-bindings.json" \
  | while read -r args; do
      # shellcheck disable=SC2086
      kubectl --context="$K8S_CONTEXT" delete $args
    done
```

- **Expected:** one `deleted` line per binding listed.
- **Verify:** `kubectl --context="$K8S_CONTEXT" auth can-i --list --as="system:serviceaccount:$AGENT_NS:$K8S_SA"` shows only the default discovery permissions.
- **Bindings shared with other subjects:** if a binding lists the agent next to other subjects, deleting it removes their access too. Edit that binding to remove only the agent's subject instead, after saving it.
- **Workload Identity:** if the Kubernetes ServiceAccount is bound to the Google service account, disabling the Google account (2a) already blocks it. Removing the `roles/iam.workloadIdentityUser` binding is the longer-term fix.
- **Tokens already issued:** whether ServiceAccount tokens already issued stop working was not verified; removing the bindings takes away what they can do, which is the documented route. Deleting the ServiceAccount also invalidates its bound tokens but loses the object; save it first if you do.
- **Rollback:** restore from the agent's GitOps source in step 6, or re-apply from the saved file after removing `metadata.resourceVersion`, `metadata.uid`, `metadata.creationTimestamp` and `metadata.managedFields`.

The design of narrow Roles for agents is in [[kubernetes-rbac-for-ai-agents]].

### 3. Preserve the evidence

Collect before anyone cleans up, and copy it out of the affected project. Logs expire: Data Access entries in the `_Default` bucket and the gateway's logs have their own retention.

#### 3a. Gateway audit log

Export the agent's request and tool-call lines for the window from the gateway's log store: request IDs, job IDs, tools called, input hashes, token counts. The format depends on your gateway; the fields are described in [[llm-api-cost-control]].

#### 3b. Cloud Audit Logs for the agent's identity

```bash title="collect-gcp-audit.sh"
set -euo pipefail

FILTER="protoPayload.authenticationInfo.principalEmail=\"$AGENT_SA\" AND timestamp>=\"$SINCE\""
gcloud logging read "$FILTER" --project="$PROJECT" --order=asc --format=json \
  > "evidence/$INCIDENT/gcp-audit-agent.json"

# Summary: which log, which method, how often.
jq -r '.[] | "\(.logName | split("/") | last) \(.protoPayload.methodName)"' \
  "evidence/$INCIDENT/gcp-audit-agent.json" | sort | uniq -c | sort -rn
```

- **Expected:** a JSON array and a count per log and method. Log names end in `cloudaudit.googleapis.com%2Factivity` (Admin Activity, always on), `%2Fdata_access` (only if Data Access logs are enabled for that service), `%2Fsystem_event` or `%2Fpolicy`.
- **Set the time explicitly.** Without a timestamp in the filter, `gcloud logging read` only looks back one day by default (`--freshness`), and older evidence is silently missed. The filter above sets it.
- **Reads may be missing.** Data Access logs are off by default for most services (BigQuery is an exception), so "no read entries" does not mean "no reads". Write that down in the blast-radius table.
- **Impersonation:** if the agent impersonated other service accounts, search for each of those as well; the caller shows up in the delegation information of the entry. Token creation is logged only if IAM Data Access logs are enabled.
- Repeat for every project the account has roles in.

#### 3c. Kubernetes audit logs

```bash
FILTER="resource.type=\"k8s_cluster\" AND protoPayload.authenticationInfo.principalEmail=\"system:serviceaccount:$AGENT_NS:$K8S_SA\" AND timestamp>=\"$SINCE\""
gcloud logging read "$FILTER" --project="$PROJECT" --order=asc --format=json \
  > "evidence/$INCIDENT/k8s-audit-agent.json"
jq -r '.[] | "\(.protoPayload.methodName) \(.protoPayload.resourceName)"' \
  "evidence/$INCIDENT/k8s-audit-agent.json" | sort | uniq -c | sort -rn
```

On GKE, API server entries use the resource type `k8s_cluster`; `get` and `list` go to Data Access logs, so they are present only if enabled. Check how the ServiceAccount appears in `principalEmail` in your cluster's entries before relying on this filter.

#### 3d. GitLab history

```bash title="collect-gitlab.sh"
set -euo pipefail

curl -sS --fail -H "PRIVATE-TOKEN: $GL_TOKEN" \
  "$GITLAB/projects/$GL_PROJECT/merge_requests?author_username=$BOT_USER&created_after=$SINCE&state=all&per_page=100" \
  > "evidence/$INCIDENT/agent-mrs.json"
jq -r '.[] | "\(.iid) \(.state) \(.merged_at // "-") \(.title)"' "evidence/$INCIDENT/agent-mrs.json"
```

Also export the pipelines list from step 1b, and, in a fresh clone, the bot's commits on every branch: `git log --all --since="$SINCE" --author="$BOT_USER" --format='%H %ad %s'` (the author name or email the bot uses may differ from its username). If your GitLab edition has audit events, export those for the bot user too.

#### 3e. Seal and copy the evidence

```bash
FORENSIC_BUCKET="gs://example-forensics"   # change: the bucket in the separate forensic project
( cd "evidence/$INCIDENT" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS )
gcloud storage cp -r "evidence/$INCIDENT" "$FORENSIC_BUCKET/$INCIDENT/"
```

- **Verify:** `gcloud storage ls -r "$FORENSIC_BUCKET/$INCIDENT/"` lists every file, and `sha256sum --check SHA256SUMS` passes on a downloaded copy.
- Evidence files may contain secrets the agent touched. Restrict the bucket as described in [[compromised-cloud-cluster-containment]].

### 4. Blast radius

Fill one table from the evidence. Mark every cell as "seen", "not seen" or "no data" (for example, Data Access logs were off); "no data" is not "not seen".

| Question                    | Where to look                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| What did it read?           | Gateway tool-call log (files, URLs, APIs), Data Access logs if enabled, Kubernetes `get`/`list` if enabled                                    |
| What did it write?          | Admin Activity logs (methods), Kubernetes write verbs, merge requests, commits, comments, pipeline runs                                       |
| What did it send out?       | Gateway requests (prompts carry data to the provider), egress proxy, VPC flow and DNS logs if enabled ([[private-gke-and-controlled-egress]]) |
| Which secrets could it see? | The job's environment, mounted secrets, files in the workspace, anything it read above                                                        |
| What did the injection say? | The input the agent read just before the first unexpected action: issue text, MR description, log line, web page                              |

Every secret the agent could see is treated as exposed and rotated through [[leaked-credential-rotation]], even if nothing shows it left.

### 5. Revert what it changed

#### 5a. Merge requests and commits

Revert merged changes through a new, reviewed merge request, never by force-pushing:

```bash
MERGE_SHA="0000000000000000000000000000000000000000"  # change: the merge commit from agent-mrs.json
git switch -c "revert/$INCIDENT" origin/main
git revert -m 1 "$MERGE_SHA"
git push -u origin "revert/$INCIDENT"
```

`-m 1` keeps the first parent (the target branch) when reverting a merge commit; for a squash-merged change, revert the single commit without `-m`. Close the agent's open merge requests and remove any branches it created after the evidence is saved. Check that the agent did not change CI configuration, protected branch settings, CODEOWNERS or webhooks; those outlive the revert.

#### 5b. Infrastructure

If the agent could reach Terraform state or apply changes, compare reality with code using a read-only identity:

```bash
terraform -chdir="infra/example" plan -detailed-exitcode -lock=false -input=false
echo "exit: $?"
```

Exit code `0` means no differences, `2` means differences, `1` means an error. A difference is something to explain, not proof of the agent's work. A clean plan does not prove nothing changed: resources outside Terraform, and data inside resources, need the audit logs from step 3. If the state file itself was written, compare its object versions in the state bucket (`gcloud storage ls --all-versions` on the state object) before touching it, and follow your state recovery procedure ([[terraform-plan-policy-checks]] covers plan JSON for the comparison).

#### 5c. Cluster and cloud resources

For each write in the blast-radius table, restore from Git (GitOps) or revert by hand, one change at a time, recording each in the containment log. Resources the agent created and that nothing else uses are deleted only after the evidence has been copied.

### 6. Recover and re-enable

Re-enable only when the cause is understood and fixed. "The agent looped" is not a cause; "a retry without a cap re-sent a growing conversation" is.

1. **Fix the cause:** a cap, a tool removed from the allowlist, an untrusted input removed from the agent's reach, a narrower token. Add the failing case to the injection test harness ([[prompt-injection-test-harness-for-ci-agents]]) so CI catches it next time.
2. **Issue new credentials** with narrower scopes and expiries: a new GitLab token, a new gateway key, reviewed RBAC from the GitOps source.
3. **Re-enable the service account:** `gcloud iam service-accounts enable "$AGENT_SA" --project="$PROJECT"`, then `describe` shows `disabled` empty or `False`.
4. **Scale back** to the recorded replica counts, one workload at a time, and set `suspend: false` on the CronJobs. Resume the GitOps sync.
5. **Turn the gateway switch back on** for the agent, ideally with a lower temporary budget.
6. **Watch** token rate, tool calls, audit log writes and the egress log for at least one full working cycle of the agent.

**Verify:** the agent completes a known, harmless task end to end, the audit log shows only expected methods, and the gateway metrics match the agent's normal pattern.

## Communication

- Post updates at the cadence for the severity in [[incident-response]].
- Tell the owners of every system the agent wrote to, and of every shared credential you revoked, before or immediately after you act.
- If code, logs or data may have reached a provider or an outside host, the security lead decides on notifications with counsel. Engineering supplies the blast-radius table.
- Do not paste secrets, tokens or the injected text into the incident channel; reference the evidence file.

## Postmortem

Run a blameless review ([[blameless-postmortems]]). Questions specific to agents:

- Which untrusted input reached the agent, and why could it?
- Which permission turned a wrong decision into damage, and was it needed?
- Which cap or alert should have stopped it earlier, and why did it not?
- How long from trigger to stop, and which step was slowest?
- Which evidence was missing (Data Access logs off, gateway logs not retained)?

Feed the actions back into [[securing-ai-agents-in-ci-and-cloud]], [[gcp-iam-guardrails-for-agent-service-accounts]] and the agent's own configuration.

## Validation

The incident is contained when all of these hold:

- No running pipelines, pods or CronJob runs from the agent, and nothing has scaled back up.
- The service account shows `disabled: True`, and no new audit entries for it appear after the disable time (allow for tokens already issued).
- The agent's GitLab tokens and gateway key are revoked, and calls with them fail.
- The agent's ServiceAccount has no permissions beyond discovery.
- The evidence is in the forensic bucket with a checksum file.

## Rollback of this runbook's actions

| Step                     | Undo                                                                             |
| ------------------------ | -------------------------------------------------------------------------------- |
| Gateway kill switch      | Turn it back on                                                                  |
| Pipelines cancelled      | Nothing to undo; start fresh pipelines after recovery, do not retry old ones     |
| Workloads scaled to zero | Scale to the counts in `workloads-before.json`; unsuspend CronJobs; resume sync  |
| Service account disabled | `gcloud iam service-accounts enable`, unless Google disabled it                  |
| GitLab tokens revoked    | Not reversible; issue new, narrower tokens                                       |
| RBAC bindings deleted    | Restore from GitOps or the saved `agent-bindings.json`                           |
| Reverts                  | Revert the revert through a reviewed merge request, if the change was legitimate |

## Sources

- [gcloud iam service-accounts disable](https://cloud.google.com/sdk/gcloud/reference/iam/service-accounts/disable), Google Cloud SDK reference, and [Disable and enable service accounts](https://cloud.google.com/iam/docs/service-accounts-disable-enable).
- [Cloud Audit Logs overview](https://cloud.google.com/logging/docs/audit), Google Cloud Logging documentation.
- [gcloud logging read](https://cloud.google.com/sdk/gcloud/reference/logging/read), Google Cloud SDK reference.
- [GKE audit logging](https://cloud.google.com/kubernetes-engine/docs/how-to/audit-logging), Google Kubernetes Engine documentation.
- [Pipelines API](https://docs.gitlab.com/api/pipelines/) and [Jobs API](https://docs.gitlab.com/api/jobs/), GitLab documentation.
- [Project access tokens API](https://docs.gitlab.com/api/project_access_tokens/), [Group access tokens API](https://docs.gitlab.com/api/group_access_tokens/) and [Personal access tokens API](https://docs.gitlab.com/api/personal_access_tokens/), GitLab documentation.
- [Merge requests API](https://docs.gitlab.com/api/merge_requests/), GitLab documentation (the `author_username` and `created_after` filters were not re-checked).
- [kubectl scale](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_scale/), Kubernetes documentation.
- [git revert](https://git-scm.com/docs/git-revert), Git documentation.

## Related

- [[incident-response]]: severity, roles and cadence.
- [[compromised-cloud-cluster-containment]]: when the compromise goes beyond the agent.
- [[leaked-credential-rotation]]: rotating everything the agent could see.
- [[llm-api-cost-control]]: the gateway, its alerts, kill switch and audit log.
- [[securing-ai-agents-in-ci-and-cloud]]: the rules that limit what an agent can reach.
- [[gcp-iam-guardrails-for-agent-service-accounts]]: narrow service accounts and audit alerts.
- [[kubernetes-rbac-for-ai-agents]]: narrow Roles for agent ServiceAccounts.
- [[prompt-injection-test-harness-for-ci-agents]]: canaries and regression cases.
- [[sandboxing-coding-agents-on-workstations-and-runners]]: limiting agents on laptops and runners.
- [[blameless-postmortems]]: the review afterwards.
- [the owner's AI skills catalogue](https://ai.szolotov.com): reusable agent skills and workflows.
