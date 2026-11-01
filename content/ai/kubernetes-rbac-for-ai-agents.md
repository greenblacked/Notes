---
title: "Kubernetes RBAC for AI agents: read-only troubleshooting without secrets"
description: Give an AI agent a dedicated identity and a hand-written read-only role with no secrets, exec or escalation verbs, short-lived tokens and tests that prove it.
type: pattern
tags:
  - ai
  - kubernetes
  - gke
  - security
  - audit
created: 2026-10-21
modified: 2026-11-01
draft: false
evidence: source-reviewed
reviewed: 2026-11-01
review-due: 2027-05-01
destructive: true
---

An agent with `kubectl` is useful during an incident: it lists failing pods, reads events, compares a Deployment with its previous revision and suggests the next check. The same access is dangerous in three quiet ways. It can read Secrets, often through a verb nobody thought of as "reading". It can reach inside running containers through `exec`, `attach` or `port-forward`. And it reads text written by outsiders (logs, events, annotations) that can carry instructions it may follow. GCP-side guardrails for agent identities are in [[gcp-iam-guardrails-for-agent-service-accounts]]; this note is the in-cluster half: one identity per agent, a hand-written role, short-lived tokens, tests that fail when the role widens, and audit logs that show what the agent did.

> [!info] Scope
> Kubernetes RBAC on GKE, for agents that troubleshoot (read) and never change the cluster on their own. The RBAC basics (Roles, bindings, `can-i`) are taught in [[rbac-roles-bindings-and-least-privilege]]; the incident workflow around the agent is in [[ai-assisted-incident-response]]. Agent rules in general are in [[securing-ai-agents-in-ci-and-cloud]].

> [!note] Evidence
> The Kubernetes claims in this note were checked against the Kubernetes documentation source on 2026-11-01; nothing was run against a cluster. The GKE and Google Cloud claims could not be checked and are hedged in the text. See the Evidence section at the end for what was and was not verified.

> [!warning] Destructive steps
> The rollback steps delete RoleBindings, a ServiceAccount and (optionally) legacy token Secrets, which cuts off the agent's access. Run them against the right cluster and namespace (`kubectl config current-context`), keep the manifests in Git first, and prefer deleting the bindings before anything else.

## Threat model

What goes wrong when an agent has broad read access:

| Path                              | How it happens                                                                                                                            | Control in this note                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Reads Secrets                     | `get`, and also `list` or `watch`, on `secrets`; a wildcard resource; binding to a broad built-in role                                    | No rule mentions `secrets`; no wildcards; tests                     |
| Reads credentials outside Secrets | Pod specs with plaintext `env` values; ConfigMaps holding tokens                                                                          | Secret references only; ConfigMaps excluded by default              |
| Runs code in workloads            | `pods/exec`, `pods/attach`, `pods/portforward`, `pods/ephemeralcontainers`, `nodes/proxy`                                                 | No verb at all on those subresources                                |
| Grants itself more                | `escalate`, `bind`, `impersonate`, writes to RBAC objects, `serviceaccounts/token`                                                        | None of these; tests                                                |
| Follows planted instructions      | Log lines, event messages or annotations written by an attacker reach the model                                                           | Read-only role limits the blast radius; `pods/log` is a decision    |
| Silent widening                   | A ClusterRole labelled `aggregate-to-view` (for example from an operator) adds rules to an aggregated built-in role the agent is bound to | Never bind agents to `view`, `edit` or `admin`                      |
| Long-lived credential leaks       | A kubeconfig with a token that never expires sits in a CI variable or a laptop                                                            | Short-lived tokens from `kubectl create token` or Workload Identity |

The Kubernetes RBAC good-practices page is explicit on the first row: `get` on Secrets reveals their contents, and `list` and `watch` do too, so they are as dangerous as `get`. It also warns about `escalate` (create roles with more rights than you hold), `bind` (bind roles you do not hold) and `impersonate`.

## One identity per agent

Each agent, and each environment it works in, gets its own identity, so audit logs say which agent did what and one can be revoked without the others:

- **Agent running in the cluster:** a dedicated ServiceAccount in a dedicated namespace (`ai-agents`), with `automountServiceAccountToken: false` on every other ServiceAccount there. Cloud access, if any, goes through Workload Identity ([[gke-workload-identity]]).
- **Agent running outside the cluster** (CI, a workstation tool): either a ServiceAccount token minted for a short time (below), or a Google identity that GKE authenticates and RBAC authorises. In the second case keep the GCP side minimal; see "GKE IAM and RBAC" below.
- Never the human operator's kubeconfig, never a shared "automation" account, never `cluster-admin`.

## A hand-written read-only role

Write the role rule by rule. Do not bind the agent to `view`: the built-in `view`, `edit` and `admin` roles are aggregated, so any ClusterRole labelled `rbac.authorization.k8s.io/aggregate-to-view: "true"` (operators often ship one for their custom resources) adds its rules to `view` without any change to your bindings.

```yaml title="agent-reader-rbac.yaml"
apiVersion: v1
kind: Namespace
metadata:
  name: ai-agents
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: agent-reader
  namespace: ai-agents
automountServiceAccountToken: false # mounted explicitly, with a short expiry, only where needed
---
# Namespaced read access, bound per namespace with RoleBindings.
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: agent-troubleshoot-read
rules:
  - apiGroups: [""]
    resources: ["pods", "events", "services", "endpoints", "persistentvolumeclaims"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets", "statefulsets", "daemonsets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["batch"]
    resources: ["jobs", "cronjobs"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["autoscaling"]
    resources: ["horizontalpodautoscalers"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["policy"]
    resources: ["poddisruptionbudgets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["events.k8s.io"]
    resources: ["events"]
    verbs: ["get", "list", "watch"]
  # Deliberately absent: secrets, configmaps, pods/exec, pods/attach, pods/portforward,
  # pods/ephemeralcontainers, pods/log (see below), serviceaccounts/token, any "*",
  # and the verbs escalate, bind and impersonate.
---
# Cluster-scoped objects need a ClusterRoleBinding; keep this role to nodes and namespaces.
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: agent-troubleshoot-cluster-read
rules:
  - apiGroups: [""]
    resources: ["nodes", "namespaces"]
    verbs: ["get", "list", "watch"]
  # Deliberately absent: nodes/proxy, which reaches the kubelet API.
```

Bind the namespaced role only where the agent works, and the cluster role once:

```yaml title="agent-reader-bindings.yaml"
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: agent-troubleshoot-read
  namespace: shop # change: one binding per namespace the agent may look at
subjects:
  - kind: ServiceAccount
    name: agent-reader
    namespace: ai-agents
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: agent-troubleshoot-read
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: agent-troubleshoot-cluster-read
subjects:
  - kind: ServiceAccount
    name: agent-reader
    namespace: ai-agents
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: agent-troubleshoot-cluster-read
```

Why these choices:

- **No wildcards.** `resources: ["*"]` with `get` includes Secrets, and any resource added later. A wildcard entry also grants any subresource or custom verb added later, which the Kubernetes docs warn about.
- **Namespaced by default.** A RoleBinding per namespace ([[0019-namespace-per-team-tenancy]]) means a new namespace is invisible to the agent until someone decides otherwise. Platform namespaces (`kube-system`, the GitOps controller, the secrets operator) stay unbound.
- **No subresources that reach inside.** `exec`, `attach`, `port-forward`, ephemeral containers and `nodes/proxy` are ways to run commands or open connections inside workloads. Grant no verb on them at all; then the question of which verb the API server checks does not arise.
- **Pod specs are not harmless.** `get` on pods returns the full spec, including plaintext `env` values. Before granting this, make sure workloads reference Secrets instead of putting credentials in `env` ([[secrets-architecture-gcp-and-gke]]). ConfigMaps are excluded for the same reason; add them per namespace only where you know they hold no credentials.

### The pods/log decision

Logs are the most useful thing an agent can read and the most dangerous: they can hold customer data, tokens printed by mistake, and text an attacker controls (a request path, a user agent, a form field) that the model reads as instructions. Choose one of:

1. **No `pods/log`.** The agent works from events and status; a human runs a reviewed evidence script and redacts its output first, as in [[ai-assisted-incident-response]].
2. **`pods/log` in selected namespaces**, through a separate role and RoleBinding, with redaction in the path to the model ([[redacting-sensitive-data-before-llm-calls]]) and injection tests in CI ([[prompt-injection-test-harness-for-ci-agents]]).

```yaml title="agent-log-read.yaml"
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: agent-log-read
rules:
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
```

Either way, the role stays read-only, so a followed instruction can at worst make the agent read more of what it can already read, and say something wrong. That is why write access never comes from the same identity.

## GKE IAM and RBAC together

On GKE, a request can be allowed by Kubernetes RBAC or by Google Cloud IAM; as I understand the GKE documentation the two are additive, so the narrower of your two layers does not win (not verified here; check the current GKE docs). An IAM role granted on the project for convenience can give the agent's Google identity Kubernetes read access that your hand-written RBAC role does not. What `roles/container.viewer` and the other predefined roles grant is listed in the GKE IAM page, which could not be checked for this note; read it rather than assume, and check the result with `inspect-gke-roles.sh` below.

Rules for agents that authenticate with a Google identity:

- Grant only the IAM permission needed to find the cluster and get credentials, and do every Kubernetes permission in RBAC. Read what each candidate role contains before granting it:

```bash title="inspect-gke-roles.sh"
set -euo pipefail

for ROLE in roles/container.clusterViewer roles/container.viewer roles/container.developer; do
  echo "== ${ROLE}"
  # Read the role first: a failed describe must stop the script, not read as "none".
  PERMS="$(gcloud iam roles describe "$ROLE" --format='value(includedPermissions)')"
  tr ';' '\n' <<< "$PERMS" \
    | grep -E 'secrets|exec|portForward|attach|proxy|impersonate' || echo "(none of the risky permissions listed)"
done
```

- Bind RBAC to the Google identity (on GKE, a `User` subject whose name is the service account email; not verified here, check the GKE RBAC page) or, for people, to a Google Group through Google Groups for RBAC ([[privileged-access-just-in-time-gcp-gke]]).
- Review project-level `container.*` grants for agent identities in the access review ([[access-reviews-gcp-and-gke]]).

## Short-lived credentials

No agent holds a token that never expires.

**In the cluster**, mount a projected token with an expiry instead of the automatic one:

```yaml title="agent-pod-token.yaml"
apiVersion: v1
kind: Pod
metadata:
  name: troubleshoot-agent
  namespace: ai-agents
spec:
  serviceAccountName: agent-reader
  automountServiceAccountToken: false
  containers:
    - name: agent
      image: example.com/platform/troubleshoot-agent@sha256:0000000000000000000000000000000000000000000000000000000000000000 # change: your agent image, pinned by digest
      volumeMounts:
        - name: kube-api-token
          mountPath: /var/run/secrets/kubernetes.io/serviceaccount
          readOnly: true
  volumes:
    - name: kube-api-token
      projected:
        sources:
          - serviceAccountToken:
              path: token
              expirationSeconds: 3600
          - configMap:
              name: kube-root-ca.crt
              items: [{ key: ca.crt, path: ca.crt }]
          - downwardAPI:
              items:
                - path: namespace
                  fieldRef: { fieldPath: metadata.namespace }
```

The kubelet refreshes the projected token before it expires, and the application is responsible for reloading it, so clients must re-read the file. The token stops working when the Pod or the ServiceAccount is deleted. A token requested this way lasts 1 hour by default; the `expirationSeconds` above sets it explicitly.

**Outside the cluster**, mint a token for the run and build a throwaway kubeconfig from it. `kubectl create token` takes `--duration`, but the Kubernetes docs say the actual duration of the issued token might be shorter, or even longer, than requested, so check the `exp` claim if it matters. Check `kubectl create token --help` for the default in your kubectl version.

```bash title="agent-kubeconfig.sh"
set -euo pipefail
umask 077

NAMESPACE="ai-agents"
SA="agent-reader"
DURATION="1h"                          # change: the length of one agent run, no longer
CLUSTER_NAME="$(kubectl config view --minify -o jsonpath='{.clusters[0].name}')"
SERVER="$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
OUT="$(mktemp -d)/agent.kubeconfig"

kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' \
  | base64 -d > "${OUT%.kubeconfig}.ca.crt"

TOKEN="$(kubectl -n "$NAMESPACE" create token "$SA" --duration="$DURATION")"

KUBECONFIG="$OUT" kubectl config set-cluster "$CLUSTER_NAME" --server="$SERVER" \
  --certificate-authority="${OUT%.kubeconfig}.ca.crt" --embed-certs=true >/dev/null
KUBECONFIG="$OUT" kubectl config set-credentials "$SA" --token="$TOKEN" >/dev/null
KUBECONFIG="$OUT" kubectl config set-context agent --cluster="$CLUSTER_NAME" --user="$SA" >/dev/null
KUBECONFIG="$OUT" kubectl config use-context agent >/dev/null
unset TOKEN

echo "$OUT"
```

The person or CI job that runs this needs `create` on `serviceaccounts/token` for that one ServiceAccount; grant it with a Role scoped by `resourceNames: ["agent-reader"]`, not cluster-wide. A token can also be bound to an object with `--bound-object-kind` and `--bound-object-name`, so it stops working when that object is deleted; the docs list Pod, Secret and Node (node-bound tokens GA in v1.33+) as supported kinds, so check which your version accepts.

List legacy long-lived token Secrets for agent accounts (the command only lists; delete a Secret only after confirming nothing uses it). Since Kubernetes 1.29 the control plane marks auto-generated legacy tokens invalid after a period of disuse (one year by default) and later purges them, but manually created ones remain until you delete them:

```bash
kubectl get secrets -A --field-selector type=kubernetes.io/service-account-token \
  -o custom-columns='NS:.metadata.namespace,NAME:.metadata.name,SA:.metadata.annotations.kubernetes\.io/service-account\.name'
```

## Prove it: positive and negative tests

`kubectl auth can-i` answers the authorization question without doing the action and pairs with impersonation (`--as`); the caller needs permission to impersonate. Run these in CI against a test cluster whenever the role or bindings change, and on a schedule against production, so a widening shows up as a failed job:

```bash title="test-agent-rbac.sh"
#!/usr/bin/env bash
set -uo pipefail

NS="shop"                                          # change: a namespace the agent is bound in
OTHER_NS="kube-system"                             # a namespace the agent must not see
AS="system:serviceaccount:ai-agents:agent-reader"
fail=0

expect() {  # expect yes|no verb resource namespace [subresource]
  local want="$1" verb="$2" res="$3" ns="$4" sub="${5:-}" got
  local args=("$verb" "$res" -n "$ns" --as="$AS")
  [[ -n "$sub" ]] && args+=(--subresource="$sub")
  got="$(kubectl auth can-i "${args[@]}" 2>/dev/null)"
  got="${got%% *}"  # a denial can print "no - <reason>"; compare the first word only
  if [[ "$got" != "$want" ]]; then
    echo "FAIL: can-i ${args[*]}: got '$got', want '$want'"
    fail=1
  fi
}

expect yes list pods "$NS"
expect yes get deployments.apps "$NS"
expect yes list events "$NS"

expect no get secrets "$NS"
expect no list secrets "$NS"
expect no watch secrets "$NS"
expect no get configmaps "$NS"
expect no create pods "$NS" exec
expect no get pods "$NS" exec
expect no create pods "$NS" attach
expect no create pods "$NS" portforward
expect no patch pods "$NS" ephemeralcontainers
expect no create serviceaccounts "$NS" token
expect no delete pods "$NS"
expect no patch deployments.apps "$NS"
expect no create rolebindings.rbac.authorization.k8s.io "$NS"
expect no escalate clusterroles.rbac.authorization.k8s.io "$NS"
expect no bind clusterroles.rbac.authorization.k8s.io "$NS"
expect no impersonate serviceaccounts "$NS"
expect no list pods "$OTHER_NS"
expect no get nodes "$NS" proxy

echo "--- everything the agent can do in ${NS}:"
kubectl auth can-i --list -n "$NS" --as="$AS"

exit "$fail"
```

Subresources go in `--subresource`, not as `pods/exec`, because in `can-i` `TYPE/NAME` means a named object (this flag behaviour comes from the kubectl reference, which was not available for this review; confirm with `kubectl auth can-i --help` on your version). The full `--list` output is for review: read it once per change, and diff it against the last approved copy kept in the repository. `can-i` checks authorization only; a `yes` can still be rejected later by admission control.

Also test the agent itself, not just its role: in a test cluster, plant an event message or log line that tells the agent to read a Secret or exec into a pod, and assert that the run made no such request (the harness in [[prompt-injection-test-harness-for-ci-agents]]).

## Audit what the agent did

As I understand the GKE documentation, Kubernetes audit logs on GKE go to Cloud Logging under `resource.type="k8s_cluster"` (not verified; check the current GKE docs). As I understand the GKE documentation, writes are recorded by default and reads are Data Access entries that depend on your audit configuration (not verified; check the current GKE docs) ([[gcp-audit-logs-siem]]). For agents, enabling read logging is worth the volume: the postmortem needs to show what the agent saw.

```text title="All requests by the agent identity"
resource.type="k8s_cluster"
protoPayload.serviceName="k8s.io"
protoPayload.authenticationInfo.principalEmail="system:serviceaccount:ai-agents:agent-reader"
```

```text title="Alert: the agent identity tried anything sensitive or any write"
resource.type="k8s_cluster"
protoPayload.serviceName="k8s.io"
protoPayload.authenticationInfo.principalEmail="system:serviceaccount:ai-agents:agent-reader"
(protoPayload.methodName:("secrets" OR "exec" OR "attach" OR "portforward" OR "token")
 OR protoPayload.methodName:(".create" OR ".update" OR ".patch" OR ".delete"))
```

Check the field names and method strings against an entry from your own cluster before you build alerts on them; the substring matches above are deliberately broad and will need tuning. A denied attempt is as interesting as an allowed one: it is either a bug in the agent or an instruction it picked up from somewhere.

## Write access goes through a human

The agent proposes; a person acts. When a fix is needed (restart a Deployment, scale it, roll back), the agent writes the exact command and its reasoning, and an on-call engineer runs it with their own just-in-time access ([[privileged-access-just-in-time-gcp-gke]]). If you later want the agent to run a small set of actions itself, use a **separate** identity with a separate role limited to those verbs and resources (for example `patch` on `deployments` in one namespace for restarts), bound only for the duration of an approved incident, and keep the read-only identity as the default. Never add write verbs to `agent-troubleshoot-read`.

## Rollback

- **Too narrow.** Add the missing resource to the role in a reviewed change, run the test script, and re-approve the `--list` output.
- **Too wide, or the agent misbehaved.** Delete its bindings first (`kubectl delete rolebinding agent-troubleshoot-read -n shop`, `kubectl delete clusterrolebinding agent-troubleshoot-cluster-read`): authorization for that binding stops for every token of the agent (RBAC is evaluated per request, but allow a short propagation delay). Then, if a token may have leaked, delete and recreate the ServiceAccount: that changes its UID and invalidates all tokens issued for it, since there is no way to revoke an individual short-lived token (a Pod-bound token also dies with its Pod). Rotate anything the agent could read ([[leaked-credential-rotation]]).
- Keep the RBAC objects in Git and apply them through your GitOps flow, so every change and revert is a reviewed commit.

## Evidence

### Sources checked

All Kubernetes pages were read from the documentation source at commit 491f14e of the website repository (content/en/docs), checked 2026-11-01.

- [Role-based access control good practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/): `list` and `watch` on Secrets reveal contents; `escalate`, `bind` and `impersonate` verbs; `nodes/proxy` reaches the Kubelet API and `get` on it is not read-only; `create` on `serviceaccounts/token`; `automountServiceAccountToken: false`. Website repository commit 491f14e, checked 2026-11-01.
- [Using RBAC authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/): RoleBinding to a ClusterRole, aggregated ClusterRoles and the `aggregate-to-view` label, `view` excludes Secrets, wildcard caution, `resourceNames` on subresources such as `pods/exec`. Website repository commit 491f14e, checked 2026-11-01.
- [Authorization overview](https://kubernetes.io/docs/reference/access-authn-authz/authorization/): `kubectl auth can-i` with `--as system:serviceaccount:<ns>:<name>`. Website repository commit 491f14e, checked 2026-11-01.
- [Managing service accounts](https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/): projected token volume (`serviceAccountToken`, `kube-root-ca.crt` ConfigMap, `downwardAPI` namespace), 1 hour default lifetime, kubelet refresh, no mechanism to invalidate a TokenRequest token other than deleting the Pod, legacy token cleanup from 1.29 (auto-generated, unmounted, unused for one year by default), Pod, Secret and Node as bound-object kinds, deleting and recreating a ServiceAccount invalidates all its tokens. Website repository commit 491f14e, checked 2026-11-01.
- [Configure service accounts for Pods](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/): `kubectl create token` with `--duration` (actual duration may differ), `--bound-object-kind`, kubelet rotation, token invalid when the Pod or ServiceAccount is deleted, `kubernetes.io/service-account-token` Secrets. Website repository commit 491f14e, checked 2026-11-01.
- [User impersonation](https://kubernetes.io/docs/reference/access-authn-authz/user-impersonation/): the caller needs the `impersonate` verb. Website repository commit 491f14e, checked 2026-11-01.

Corrections made in this review: the aggregation risk comes from a labelled ClusterRole, not from CRDs; the `--duration` wording now follows the docs (shorter or longer than requested); object-bound tokens are documented for Pod, Secret and Node; the claim that deleting a ServiceAccount invalidates tokens is kept and now matches the docs for projected tokens.

### Not verified

- Everything about GKE and Google Cloud: that IAM and RBAC are additive, the `User` subject naming for Google identities, the `k8s_cluster` log destination, the contents of `roles/container.viewer`, `roles/container.clusterViewer` and `roles/container.developer`, the role names in `inspect-gke-roles.sh`, Google Groups for RBAC, Workload Identity behaviour, the default audit logging of writes and reads, the Cloud Logging fields and method strings, and the GKE pages listed under Sources.
- The kubectl generated reference pages (`kubectl auth can-i`, `kubectl create token`) are not in the local checkout, so the `--subresource` flag, `TYPE/NAME` behaviour, `--list`, the `--duration` default, the `--bound-object-kind` values your kubectl version accepts, and the `custom-columns` and `--field-selector type=` forms were not confirmed.
- The exact verbs the API server checks on `pods/exec`, `pods/attach` and `pods/portforward` (the role grants none), and the exact contents of the default `view` ClusterRole in your version.
- That the API groups and resource names in the role (for example `policy` and `events.k8s.io`) match your cluster version.
- How quickly deleting a RoleBinding takes effect.
- None of the scripts or manifests were run against a cluster.

### Environment

A Kubernetes cluster at a version covered by the documentation commit above (the legacy token behaviour needs 1.29 or later), kubectl, and for the GKE parts a GKE cluster and `gcloud`.

### Prerequisites

Permission to create RBAC objects, a test cluster to run the test script first, the manifests kept in Git, and, for the Rollback steps, the names of the bindings and ServiceAccount to remove.

### Expected results

The test script exits 0, with every `expect yes` answered `yes` and every `expect no` answered `no`. After the rollback deletions, `kubectl auth can-i list pods -n shop --as=system:serviceaccount:ai-agents:agent-reader` answers `no`.

### Failure conditions

The test script exits 1 with a FAIL line, or the `--list` output differs from the last approved copy. A rollback command that reports NotFound means the target name or namespace is wrong; stop and check the context.

### Cleanup and rollback

See the Rollback section of this note: delete the RoleBindings first, then the ServiceAccount if a token may have leaked, and restore from Git to undo.

## Sources

- [Using RBAC authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/), Kubernetes documentation: default roles, aggregation, `escalate` and `bind`.
- [Role-based access control good practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/), Kubernetes documentation: Secrets via `list` and `watch`, escalation verbs, token mounting.
- [kubectl auth can-i](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_auth/kubectl_auth_can-i/) and [kubectl create token](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_token/), kubectl reference.
- [Authorize actions in clusters using role-based access control](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/role-based-access-control), GKE documentation.
- [Create IAM policies](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/iam), GKE documentation: predefined GKE roles.

## Related

- [[rbac-roles-bindings-and-least-privilege]]: the RBAC lesson this builds on.
- [[gcp-iam-guardrails-for-agent-service-accounts]]: the GCP side of agent identities.
- [[securing-ai-agents-in-ci-and-cloud]]: general rules for agents with access.
- [[ai-assisted-incident-response]]: the incident workflow and the evidence script.
- [[privileged-access-just-in-time-gcp-gke]]: the human path to write access.
- [[access-reviews-gcp-and-gke]]: reviewing agent grants on a schedule.
- [[kubernetes-pod-troubleshooting]]: what the agent is helping with.
- [[internal-mcp-servers-for-platform-tools]]: exposing narrow tools instead of raw `kubectl`.
- [the owner's AI skills catalogue](https://ai.szolotov.com): reusable agent skills and workflows.
