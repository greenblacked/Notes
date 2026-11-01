---
title: "Sandboxing coding agents on workstations and runners: containers, credentials and egress"
description: Run coding agents where they can reach only the repository, short-lived scoped credentials and an egress allowlist, on laptops and on GitLab runners on GKE.
type: guide
tags:
  - ai
  - security
  - docker
  - linux
  - gitlab-ci
created: 2026-10-21
modified: 2026-11-01
evidence: source-reviewed
reviewed: 2026-11-01
review-due: 2027-05-01
draft: false
---

A coding agent started in a terminal runs as the engineer. It can read everything the engineer can read and run everything the engineer can run: the admin kubeconfig for production, the cloud CLI's stored credentials, the SSH agent, registry logins, the browser's cookies on disk. [[securing-ai-agents-in-ci-and-cloud]] covers agents in CI jobs, where the runner is already a container. This guide covers the gap: agents on engineers' workstations, and the runner side of the same idea. The goal is that a prompt-injected or simply mistaken agent can damage the repository it was given, and nothing else.

> [!info] Scope
> Linux and macOS workstations with Docker or a compatible runtime, Google Cloud and GKE, and GitLab runners with the Kubernetes executor ([[gitlab-runners-on-gke]]). No agent product is named: built-in permission modes and deny rules differ per product and are covered generically in [[ai-coding-assistant-admin-controls]].

## What an agent can reach by default

Run as the logged-in user, an agent inherits all of this. Each row is something a single injected instruction could use.

| Resource                             | Usually found at                                   | What it grants                                                   |
| ------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------- |
| Kubernetes credentials               | `~/.kube/config` (kubectl's default), `KUBECONFIG` | Every context the engineer has, often including production admin |
| Google Cloud CLI credentials         | Usually `~/.config/gcloud`                         | The engineer's user identity and application default credentials |
| SSH keys and agent                   | `~/.ssh`, `SSH_AUTH_SOCK`                          | Git push, bastion hosts, servers                                 |
| Registry and package credentials     | `~/.docker/config.json`, `~/.npmrc`, `~/.netrc`    | Push to registries and Artifactory                               |
| Git credential helpers and tokens    | Git configuration, OS keychain                     | Push and API access to GitLab                                    |
| The Docker socket                    | `/var/run/docker.sock` or the user's socket        | Root-equivalent access to the host on rootful Docker             |
| Browser profiles and session cookies | Home directory                                     | Logged-in web consoles                                           |
| Environment variables                | The shell                                          | Whatever tokens the engineer exported                            |
| The network                          | Everything the laptop can reach                    | Internal services, VPN, any internet host for exfiltration       |

Deny rules in the agent's settings reduce this, but they are a filter inside the same process: a deny on reading `~/.kube/config` does not stop a shell command that reads it, as [[ai-coding-assistant-admin-controls]] points out. Isolation means the files and sockets are not there to read.

## Isolation levels

| Level                                | What it isolates                                                       | Cost                                        | Use for                                                     |
| ------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| 0. Tool permission modes, deny rules | Nothing at the OS level; asks before acting                            | None                                        | Read-only questions in a trusted repository                 |
| 1. Dev container, repo mount only    | Home directory, credentials, sockets; with an internal network, egress | Container setup per repository              | Default for agent sessions that edit and run code           |
| 2. Rootless container runtime        | As level 1, and a container escape lands in an unprivileged user       | Some runtime features unavailable or slower | Workstations where agents run untrusted code often          |
| 3. Disposable VM                     | A separate kernel; the host is not shared                              | Slowest to start, most resources            | Untrusted repositories, third-party code, security research |

Levels stack: a dev container (1) on a rootless runtime (2) with the agent's own permission prompts still on (0). Level 0 alone is not a sandbox.

## Level 1: a dev container that mounts only the repository

The principle: the container sees the repository, a scratch directory, and nothing from the home directory. Credentials are added deliberately, short-lived and scoped, when a task needs them.

### Plain Docker

The underlying commands are worth knowing, because every dev container tool ends up running something like them:

```bash title="agent-sandbox.sh (illustrative, not run)"
set -euo pipefail

REPO_DIR="$(git rev-parse --show-toplevel)"
AGENT_IMAGE="registry.example.com/platform/agent-sandbox@sha256:0000000000000000000000000000000000000000000000000000000000000000"  # change: your approved image digest
PROXY_IMAGE="registry.example.com/platform/egress-proxy@sha256:0000000000000000000000000000000000000000000000000000000000000000"  # change: your Squid or proxy image digest

# An internal network has no route to the internet; only the proxy is attached to both networks.
# Gateway mode "isolated" also leaves the bridge without a host address, so the agent cannot reach
# host services listening on 0.0.0.0. It is valid only together with --internal.
docker network inspect agent-internal >/dev/null 2>&1 || docker network create --internal \
  -o com.docker.network.bridge.gateway_mode_ipv4=isolated \
  -o com.docker.network.bridge.gateway_mode_ipv6=isolated \
  agent-internal
docker network inspect agent-egress >/dev/null 2>&1 || docker network create agent-egress

docker rm -f egress-proxy >/dev/null 2>&1 || true
docker run -d --name egress-proxy --network agent-egress \
  -v "$PWD/squid.conf:/etc/squid/squid.conf:ro" "$PROXY_IMAGE"
docker network connect agent-internal egress-proxy

docker run --rm -it \
  --network agent-internal \
  --env HTTPS_PROXY=http://egress-proxy:3128 \
  --env HTTP_PROXY=http://egress-proxy:3128 \
  --env NO_PROXY= \
  --user "$(id -u):$(id -g)" \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --read-only \
  --tmpfs /tmp:rw,mode=1777 \
  --tmpfs /home/agent:rw,mode=1777 \
  --env HOME=/home/agent \
  -v "$REPO_DIR:/workspace" \
  -w /workspace \
  "$AGENT_IMAGE"
```

What each part does:

- `--network agent-internal` with an `--internal` network: the container has no route to the internet. Host services listening on the bridge address (including `0.0.0.0` or `::` listeners) stay reachable unless the network is created with `-o com.docker.network.bridge.gateway_mode_ipv4=isolated` (and the `_ipv6` equivalent) or the host firewall blocks it, so keep sensitive local services off all-interface listeners. Its only way out to the internet is the proxy container, which holds the allowlist. Proxy environment variables alone are advisory (a process can ignore them); the internal network is what enforces it.
- `-v "$REPO_DIR:/workspace"` is the only bind mount. No home directory, no `~/.kube`, no `~/.ssh`, no Docker socket.
- `--tmpfs /home/agent` gives tools a writable, empty, throwaway home.
- `--cap-drop ALL`, `--security-opt no-new-privileges`, `--read-only` and a non-root `--user` remove the easy escalation paths.
- The image contains the agent CLI and the repository's toolchain, built by the platform team and pinned by digest.

### The egress allowlist

```text title="squid.conf (illustrative, not run)"
http_port 3128

acl allowed_hosts dstdomain llm-gateway.example.com
acl allowed_hosts dstdomain gitlab.example.com
acl allowed_hosts dstdomain artifactory.example.com
acl SSL_ports port 443
acl CONNECT method CONNECT

http_access deny CONNECT !SSL_ports
http_access allow allowed_hosts
http_access deny all
```

Allow the LLM gateway ([[llm-api-cost-control]]), your Git server and your package mirror; nothing else. Package installs then go through Artifactory, which is where you want them anyway. Keep the proxy's access log: it is the record of what the agent tried to reach, and the first thing to read if something goes wrong. In CI and on GKE, the same allowlist idea is enforced at the network layer, as in [[private-gke-and-controlled-egress]].

### devcontainer.json

Dev container tooling can express a similar setup declaratively; the JSON below mirrors the script's user, read-only root file system, tmpfs mounts and proxy variables, but not its two-network proxy topology, which you create separately. The properties below are defined in the Dev Container specification: `workspaceMount` (which requires `workspaceFolder`) takes the same values as the Docker `--mount` flag, `mounts` adds further mounts, and `runArgs` is an array of Docker CLI arguments.

```json title=".devcontainer/devcontainer.json"
{
  "name": "agent-sandbox",
  "image": "registry.example.com/platform/agent-sandbox@sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "workspaceMount": "source=${localWorkspaceFolder},target=/workspace,type=bind",
  "workspaceFolder": "/workspace",
  "mounts": [],
  "containerUser": "agent",
  "remoteUser": "agent",
  "containerEnv": {
    "HTTPS_PROXY": "http://egress-proxy:3128",
    "HTTP_PROXY": "http://egress-proxy:3128",
    "NO_PROXY": "",
    "HOME": "/home/agent"
  },
  "runArgs": [
    "--network=agent-internal",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--read-only",
    "--tmpfs=/tmp:rw,mode=1777",
    "--tmpfs=/home/agent:rw,mode=1777"
  ]
}
```

Watch for editor features that forward host resources into the container automatically, such as the SSH agent, Git credentials or the Docker socket. Whether and how they are forwarded depends on the tool and its settings; the self-check below is how you find out, not the configuration file.

## Level 2: rootless containers

With rootful Docker, the daemon runs as root, and anyone who can talk to its socket controls the host. In rootless mode the daemon and the containers run inside a user namespace as an unprivileged user; unlike `userns-remap`, the daemon itself is not root. A container escape then lands in an ordinary user account.

- **Prerequisites:** `newuidmap` and `newgidmap` (usually from the `uidmap` package) and subordinate ID ranges for the user in `/etc/subuid` and `/etc/subgid`. Some distributions restrict unprivileged user namespaces by default; check your distribution's documentation.
- **Known limitations:** the Docker documentation lists features that are not supported or behave differently in rootless mode, including AppArmor, overlay networks, slower user-mode networking and binding privileged ports. Read the current limitations and tips pages before rolling it out.
- **Setup:** follow the rootless installation page for your distribution, which uses the `dockerd-rootless-setuptool.sh` script. Then point the CLI at the rootless socket and confirm:

```bash
docker info | grep -A4 'Security Options'
```

Expect the Security Options section of the output to include a `rootless` entry. Podman's rootless mode is an alternative with the same goal; it is not covered here.

## Level 3: a disposable VM

For untrusted repositories (a third-party project, a reproduction from a bug report, anything you would not run on your laptop) use a VM that is created for the session and destroyed after it: a local VM from a clean image, or a cloud VM in a sandbox project with no access to anything else. It gets the same rules: the repository only, an egress allowlist, no personal credentials. Snapshot it if you need evidence, then delete it. The cost is start-up time and resources; the gain is a separate kernel.

## Credentials: none by default

Most agent tasks (read code, edit, run unit tests) need no credentials at all. When one does, give it the shortest-lived, narrowest credential that works, created for the session, never the engineer's own.

### Google Cloud: impersonate a narrow service account

Create one service account per agent task type, with the minimum roles, as in [[gcp-iam-guardrails-for-agent-service-accounts]]. The engineer impersonates it and passes only a short-lived access token into the sandbox:

```bash title="gcp-token-for-sandbox.sh (illustrative, not run)"
set -euo pipefail

AGENT_SA="agent-readonly@example-project.iam.gserviceaccount.com"  # change: the task's service account
TOKEN_FILE="$(mktemp)"
chmod 600 "$TOKEN_FILE"

gcloud auth print-access-token --impersonate-service-account="$AGENT_SA" > "$TOKEN_FILE"
echo "token written to $TOKEN_FILE; mount it read-only into the sandbox and delete it afterwards"
```

- Impersonation needs `roles/iam.serviceAccountTokenCreator` on that service account; Service Account User does not grant it.
- The resulting access token is short-lived (`gcloud auth print-access-token --lifetime` defaults to 3600 seconds, and lengthening it beyond that needs an organization policy constraint) and leaves no key file behind.
- Token creation is written to audit logs only if IAM Data Access audit logs are enabled; enable them if you want that record.
- Inside the sandbox, tools need to be told to use the token. gcloud can read an access token from a file with the global `--access-token-file` flag or the `auth/access_token_file` property (the file contains only the token); how client libraries pick up a token is in their own authentication documentation. Never mount `~/.config/gcloud` into the sandbox.

### Kubernetes: a bound token for a namespaced service account

```bash title="k8s-token-for-sandbox.sh (illustrative, not run)"
set -euo pipefail

CTX="dev-cluster"                 # change: a non-production context you are allowed to use
NS="agent-sandbox"                # change: the namespace the agent may read
SA="agent-reader"                 # change: a ServiceAccount with a read-only Role in that namespace
OUT="./agent.kubeconfig"

SERVER="$(kubectl --context="$CTX" config view --minify -o jsonpath='{.clusters[0].cluster.server}')"
kubectl --context="$CTX" config view --minify --raw \
  -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d > ./agent-ca.crt
TOKEN="$(kubectl --context="$CTX" -n "$NS" create token "$SA" --duration=1h)"

kubectl --kubeconfig="$OUT" config set-cluster sandbox --server="$SERVER" \
  --certificate-authority=./agent-ca.crt --embed-certs=true
kubectl --kubeconfig="$OUT" config set-credentials agent --token="$TOKEN"
kubectl --kubeconfig="$OUT" config set-context sandbox --cluster=sandbox --user=agent --namespace="$NS"
kubectl --kubeconfig="$OUT" config use-context sandbox
rm -f ./agent-ca.crt
chmod 600 "$OUT"
```

`kubectl create token` requests a short-lived token for the ServiceAccount; `--duration` asks for a lifetime, and the server may return a longer or shorter one. Avoid long-lived Secret-based ServiceAccount tokens. The ServiceAccount's Role is read-only and namespaced; design it with [[kubernetes-rbac-for-ai-agents]]. Clusters that use a client-go exec credential plugin need that plugin's credentials only on the engineer's side, not in the sandbox, because the token above is all the sandbox gets.

Mount the generated kubeconfig read-only, set `KUBECONFIG` to it inside the sandbox, and delete it when the session ends. Production contexts never go into an agent sandbox; production changes follow [[production-change-checklist]] with a human running them.

### Git

Give the sandbox no push credentials. The agent commits locally inside `/workspace`; the engineer reviews and pushes from the host. If an agent must open merge requests, use a project access token with the narrowest scope and an expiry, as in [[securing-ai-agents-in-ci-and-cloud]].

## Runners: the same rules on GKE

CI agent jobs already run in pods, but a pod is not automatically a sandbox. For runners that execute agent jobs:

- **A dedicated runner, namespace and Kubernetes service account** for agent jobs, separate from build and deploy runners ([[gitlab-runners-on-gke]]). The service account has no Workload Identity binding unless a job needs cloud access, and then only to a narrow Google service account.
- **Pod Security `restricted`** on that namespace ([[pod-security-admission]]). Restricted allows only a fixed set of volume types (configMap, CSI, downwardAPI, emptyDir, ephemeral, persistentVolumeClaim, projected, secret) and baseline already forbids hostPath; check the current Pod Security Standards table.

```yaml title="agent-runner-namespace.yaml"
apiVersion: v1
kind: Namespace
metadata:
  name: ci-agents
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

- **No Docker socket, no privileged containers**, and no image builds in the agent runner.
- **Egress allowlist** with NetworkPolicy or firewall rules: the LLM gateway, GitLab and Artifactory ([[private-gke-and-controlled-egress]]).
- **Optional: GKE Sandbox (gVisor).** gVisor is an application kernel that runs in user space and intercepts the container's system calls, so a kernel exploit in the container hits gVisor instead of the node's kernel. On GKE Standard, create a node pool with GKE Sandbox enabled and run agent pods with `runtimeClassName: gvisor`; the cluster must keep at least one node pool without the sandbox for system workloads. On Autopilot, gVisor is available without a separate node pool. The `--sandbox=type=gvisor` flag is documented in the gcloud reference (`gvisor` is its only supported type), and the Terraform provider requires the `COS_CONTAINERD` image type for a sandboxed node pool:

```bash title="gke-sandbox-pool.sh"
set -euo pipefail

CLUSTER="ci-cluster"         # change
REGION="europe-west1"        # change
gcloud container node-pools create agents-gvisor \
  --cluster="$CLUSTER" --region="$REGION" \
  --sandbox=type=gvisor \
  --image-type=cos_containerd \
  --num-nodes=1
```

Point the agent runner's job pods at it with the runtime class. The GitLab Runner Kubernetes executor setting for this (`runtime_class_name`) was not checked; read the executor documentation for your runner version.

Know the limits before you rely on it: sandboxed pods support a subset of system calls, cannot be privileged and cannot use hostPath; read the GKE Sandbox limitations list for the rest before you move a job onto it. They cannot reach the node's metadata server, so cloud access needs Workload Identity Federation for GKE. Expect some performance overhead for system-call-heavy work; measure it with your own jobs. The Terraform provider also exposes an `agent_sandbox_config` cluster add-on; read the current GKE documentation before choosing between the two.

## Verify inside the sandbox

Run this as the first command of every new sandbox image, and as a scheduled CI job on the runner. Every line has an expected result; anything else means the sandbox is leaking.

```bash title="sandbox-selfcheck.sh (illustrative, not run)"
#!/usr/bin/env bash
set -uo pipefail

BLOCKED_URL="https://example.org"                      # change: any host not on the allowlist
ALLOWED_URL="https://llm-gateway.example.com/healthz"  # change: an allowlisted health endpoint
fail=0

check() { if eval "$2"; then echo "ok    $1"; else echo "LEAK  $1"; fail=1; fi; }
# Blocked means a network-level refusal: DNS (curl exit 6), connect (7), timeout (28) or
# the proxy refusing CONNECT (56). Anything else (TLS error, curl missing) is not proof.
denied() {
  curl -sS --max-time 5 -o /dev/null "$@" 2>/dev/null
  local rc=$?
  case "$rc" in 6 | 7 | 28 | 56) return 0 ;; esac
  echo "      curl exit ${rc} is not a network refusal" >&2
  return 1
}

check "no kubeconfig in home"          '[ ! -e "$HOME/.kube/config" ]'
check "no KUBECONFIG unless intended"  '[ -z "${KUBECONFIG:-}" ] || [ "${KUBECONFIG}" = "/run/agent/agent.kubeconfig" ]'
check "no gcloud config"               '[ ! -d "$HOME/.config/gcloud" ]'
check "no gcloud accounts"             '! command -v gcloud >/dev/null || { a="$(gcloud auth list --format="value(account)")" && [ -z "$a" ]; }'
check "no SSH agent"                   '[ -z "${SSH_AUTH_SOCK:-}" ]'
check "no SSH keys"                    '[ ! -d "$HOME/.ssh" ]'
check "no Docker socket"               '[ ! -S /var/run/docker.sock ]'
check "not root"                       '[ "$(id -u)" -ne 0 ]'
check "blocked host is blocked"        'denied "$BLOCKED_URL"'
check "blocked host without proxy"     'denied --noproxy "*" "$BLOCKED_URL"'
check "allowed host works"             'curl -sS --max-time 10 -o /dev/null "$ALLOWED_URL"'

exit "$fail"
```

```text
ok    no kubeconfig in home
ok    no KUBECONFIG unless intended
ok    no gcloud config
ok    no gcloud accounts
ok    no SSH agent
ok    no SSH keys
ok    no Docker socket
ok    not root
ok    blocked host is blocked
ok    blocked host without proxy
ok    allowed host works
```

The "without proxy" line is the important one: it proves the network blocks egress, not just the proxy setting. If it prints `LEAK`, the container has a direct route out. Adjust the `KUBECONFIG` path to wherever you mount the session kubeconfig.

## Trade-offs

- **Friction.** Engineers lose their shell history, dotfiles and tools inside the sandbox. Provide a good image with the toolchain and a fast start; a sandbox people bypass is worse than none, because you think you have one.
- **Performance.** File system bind mounts on macOS and rootless user-mode networking can be slower; gVisor adds overhead to system-call-heavy work. Measure your own builds and test suites.
- **Tool compatibility.** Some tools need a Docker socket (integration tests with containers) or privileged features. Run those outside the agent sandbox, by the engineer or in CI.
- **Credential hand-off.** Short-lived tokens expire mid-session. That is the point; make re-issuing them a single command.

## Rolling it out and rolling back

Roll out per team: publish the image and the launcher script, make the sandbox the documented way to run agents, then turn on the managed setting that requires it where the product supports that ([[ai-coding-assistant-admin-controls]]). On runners, move agent jobs to the new runner tag first and keep the old runner for a short overlap.

Rollback is configuration only: engineers can run the agent outside the sandbox again (with its permission prompts), and on GKE the agent runner can be pointed back at a normal node pool by removing the runtime class. Neither removes the egress allowlist; that stays. If the self-check ever reports a leak in production use, stop using that image, treat any credential that was reachable as exposed, and follow [[leaked-credential-rotation]].

## Evidence

Source-reviewed on 2026-11-01. Nothing was run. The review covered the documented behaviour of Docker rootless mode, Dev Container properties, gVisor, Pod Security Standards, `kubectl create token`, gcloud flags and GitLab project access tokens that this note relies on.

### Sources checked

- [Rootless mode](https://docs.docker.com/engine/security/rootless/) and its [troubleshooting](https://docs.docker.com/engine/security/rootless/troubleshoot/) page: daemon and containers run without root in a user namespace, unlike `userns-remap`, where the daemon is root; `newuidmap` and `newgidmap` (the `uidmap` package); at least 65,536 subordinate IDs in `/etc/subuid` and `/etc/subgid`; `dockerd-rootless-setuptool.sh install`; `docker info` shows `rootless` under Security Options; known limitations include AppArmor and overlay networks, privileged ports below 1024 need extra setup, and user-mode networking is listed as slow. Checked 2026-11-01 against docker/docs commit 53581df.
- [Docker Engine security](https://docs.docker.com/engine/security/): the daemon requires root unless rootless mode is used, and anyone controlling it can share host directories into a container. [Networking overview](https://docs.docker.com/engine/network/): an `--internal` network is for containers that do not need external network access. [Port publishing](https://docs.docker.com/engine/network/port-publishing/): containers in an `internal` network can still reach host services listening on the bridge address (including `0.0.0.0` or `::`); gateway mode `isolated` assigns no bridge address. Checked 2026-11-01 against docker/docs commit 53581df.
- [devcontainer.json reference](https://containers.dev/implementors/json_reference/): `workspaceMount` requires `workspaceFolder` and accepts Docker `--mount` values, `mounts`, `runArgs` as an array of Docker CLI arguments, `containerEnv`, `containerUser` (sets the user the container as a whole runs as) and `remoteUser` (does not). Checked 2026-11-01 against devcontainers/spec commit c95ffee.
- [gVisor documentation](https://gvisor.dev/docs/) and [Kubernetes quick start](https://gvisor.dev/docs/user_guide/quick_start/kubernetes/): application kernel written in Go and running in user space; it does not pass system calls through to the host kernel; implements a subset of the Linux system call interface; GKE Sandbox runs pods with `runtimeClassName: gvisor` on a node pool with gVisor enabled. Checked 2026-11-01 against google/gvisor commit aa767e4.
- [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) and [Pod Security admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/): the Restricted volume-type list (configMap, csi, downwardAPI, emptyDir, ephemeral, persistentVolumeClaim, projected, secret); hostPath volumes forbidden in Baseline; namespace labels of the form `pod-security.kubernetes.io/<MODE>: <LEVEL>`. Checked 2026-11-01 against kubernetes/website commit 491f14e.
- [kubectl create token](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_token/): `--duration` is a requested lifetime and the server may return a longer or shorter one. [Service accounts](https://kubernetes.io/docs/concepts/security/service-accounts/): long-lived Secret-based tokens are discouraged. [Organizing cluster access using kubeconfig](https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/): kubectl reads `$HOME/.kube/config` by default and `KUBECONFIG` overrides it. [Authentication](https://kubernetes.io/docs/reference/access-authn-authz/authentication/): client-go credential plugins exist. Checked 2026-11-01 against kubernetes/website commit 491f14e.
- gcloud SDK 570.0.0 `--help` output (`gcloud auth print-access-token`, `gcloud config`, `gcloud container node-pools create`): `--impersonate-service-account` and `--access-token-file` are global flags; `--lifetime` defaults to 3600 seconds and requires impersonation; `auth/access_token_file` property; `--sandbox=[type=TYPE]` with `gvisor` the only supported type; `--image-type`, `--num-nodes`. Checked 2026-11-01 against the installed SDK; no credentials or API calls were used.
- [google_container_cluster](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/container_cluster): `sandbox_config` requires the `COS_CONTAINERD` image type; an `agent_sandbox_config` add-on exists. Checked 2026-11-01 against terraform-provider-google commit c4248bd.
- [Project access tokens](https://docs.gitlab.com/user/project/settings/project_access_tokens/): scoped to one project, selectable scopes, expiration dates. Checked 2026-11-01 against gitlabhq/gitlabhq commit d7b9a61.
- [gitcredentials](https://git-scm.com/docs/gitcredentials): Git obtains credentials through configurable credential helpers. Checked 2026-11-01 against git/git commit 50fe5cc.

### Not verified

- The minimum Docker Engine version that supports bridge gateway mode `isolated`; older engines reject the option, in which case drop it and block host services with the host firewall instead.
- Google Cloud documentation was not reachable: the need for `roles/iam.serviceAccountTokenCreator` (and that Service Account User is not enough), IAM Data Access audit logging of token creation, the GKE Sandbox requirements and limits (a node pool without the sandbox for system workloads, Autopilot behaviour, no hostPath or privileged pods, no node metadata server access, Workload Identity Federation for GKE), and the GKE Sandbox how-to itself.
- The GitLab Runner Kubernetes executor setting `runtime_class_name`: runner documentation is not in the local GitLab docs.
- The `docker run` flag semantics used in the script (`--cap-drop`, `--security-opt no-new-privileges`, `--read-only`, `--tmpfs`, `--user`): the Docker CLI reference is not in the local docs checkout. The Squid configuration, the curl exit codes used in the self-check, and Podman rootless mode were also not checked.
- `CLOUDSDK_*` environment variable names for gcloud properties and how client libraries consume an access token.
- Engineering guidance, not a documented claim: the isolation-level ranking, the rollout and rollback approach, and the trade-offs section.
- No performance figures are given because none were measured.
- Nothing was run: every command, script and expected output in the note is unexecuted.

## Sources

- [devcontainer.json reference](https://containers.dev/implementors/json_reference/), Development Containers specification.
- [Rootless mode](https://docs.docker.com/engine/security/rootless/), Docker documentation, with its troubleshooting and tips pages.
- [gVisor documentation](https://gvisor.dev/docs/).
- [GKE Sandbox](https://cloud.google.com/kubernetes-engine/docs/concepts/sandbox-pods), Google Kubernetes Engine documentation, and the [how-to](https://cloud.google.com/kubernetes-engine/docs/how-to/sandbox-pods).
- [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/) and [Pod Security admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/), Kubernetes documentation.
- [Service account impersonation](https://cloud.google.com/iam/docs/service-account-impersonation), Google Cloud IAM documentation.
- [kubectl create token](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_token/), Kubernetes documentation.

## Related

- [[securing-ai-agents-in-ci-and-cloud]]: rules for agents in CI jobs.
- [[ai-coding-assistant-admin-controls]]: permission modes, deny rules and managed settings.
- [[gitlab-runners-on-gke]]: the runner platform the agent runner builds on.
- [[pod-security-admission]]: enforcing restricted on runner namespaces.
- [[private-gke-and-controlled-egress]]: network-level egress allowlists.
- [[gcp-iam-guardrails-for-agent-service-accounts]]: narrow service accounts to impersonate.
- [[kubernetes-rbac-for-ai-agents]]: read-only Roles for agent ServiceAccounts.
- [[runaway-or-compromised-ai-agent-response]]: what to do when an agent misbehaves anyway.
- [the owner's AI skills catalogue](https://ai.szolotov.com): reusable agent skills and workflows.
