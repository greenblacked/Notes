---
title: k9s, kubectx and stern toolbox
description: "A terminal kit for daily Kubernetes work: k9s for cluster views, kubectx and kubens for context switching, stern for multi-pod logs, plus safety habits."
type: tool
tags:
  - tools
  - kubernetes
  - gke
created: 2026-10-19
modified: 2026-10-19
draft: false
---

`kubectl` is the foundation, but three small tools remove most of the friction from daily work on several clusters: k9s as a terminal UI, kubectx and kubens for switching context and namespace, and stern for tailing logs across many pods. They are convenience tools, not a replacement for knowing the underlying `kubectl` commands. The same speed that helps you also helps you delete the wrong thing in the wrong cluster, so this note pairs each tool with a safety habit.

> [!info] Flags and versions not checked
> Flags, key bindings, install methods and versions were not checked against the current releases when this note was written. Confirm them in each project's README or `--help` before relying on them.

## Why a toolbox

A typical GKE platform engineer touches a dev, a stage and a production cluster, often in different projects and regions. Typing `kubectl --context ... -n ... get pods` all day is slow and error-prone, and the cost of an error is highest in production. The tools below shorten the loop; the habits below keep a slip from becoming an incident. For triage procedures, once you are connected, see [[kubernetes-pod-troubleshooting]] and [[node-resource-pressure-triage]].

## k9s

k9s is a terminal UI that shows resources as a live, navigable table: pods, deployments, nodes, events, CronJobs, CRDs. You can jump to logs, shell into a container, describe, edit, delete and port-forward with single keystrokes, which is exactly why it needs guard rails.

```bash title="open k9s on a specific context, read-only"
k9s --readonly --context gke_example-project_europe-west1_prod
```

`--readonly` disables the actions that change the cluster. Use it as the default for production, including in shell aliases:

```bash title="~/.zshrc (zsh and bash compatible)"
alias k9s-prod='k9s --readonly --context gke_example-project_europe-west1_prod'
alias k9s-dev='k9s --context gke_example-project_europe-west1_dev'
```

Useful habits:

- `:` opens the command prompt (`:pods`, `:deploy`, `:nodes`, `:events`, `:ns`). `/` filters the current table, and `?` shows the key bindings for your version.
- Press `l` on a pod for logs, `d` to describe, `s` to shell in (not in read-only mode), `y` to view the YAML.
- Use the pulse and xray views to see relationships at a glance; check the current docs for the command names.
- Set a distinct skin per context so production looks different. k9s supports per-context skins in its configuration directory; the exact file layout and keys are in the README, so verify them for your version.

```yaml title="~/.config/k9s/config.yaml (sketch; verify keys in the k9s docs)"
k9s:
  refreshRate: 2
  readOnly: false
  ui:
    skin: default
```

A red production skin and a green dev skin cost nothing and prevent a surprising number of mistakes. See the k9s documentation for how to bind a skin to a context.

## kubectx and kubens

`kubectx` switches the current kubeconfig context; `kubens` switches the default namespace of the current context.

```bash
kubectx                                    # list contexts
kubectx gke_example-project_europe-west1_dev   # switch
kubectx -                                  # switch back to the previous one
kubens                                     # list namespaces
kubens app                                 # set the default namespace to app
kubens -                                   # switch back
```

Contexts are only names. Make the names mean something, and rename the long GKE defaults to short ones:

```bash
kubectx prod=gke_example-project_europe-west1_prod
kubectx dev=gke_example-project_europe-west1_dev
```

`kubectx` and `kubens` change global state in `~/.kube/config`. Two terminals share it, so switching in one changes the other. For scripts and for anything destructive, do not depend on the current context at all; pass it explicitly.

## stern

`stern` tails logs from many pods at once, following new pods as they appear, and prefixes each line with the pod and container. That is the missing piece when a Deployment rolls and `kubectl logs -f` loses the pod you were watching.

```bash
stern -n app -l app=api --since 15m                   # all pods with a label
stern -n app api --tail 50 --timestamps               # pod name regex
stern -n app -l app=api -c server --since 5m          # one container only
stern -n app -l app=api --since 15m --no-follow       # print and exit
stern -n app -l app=api --since 15m --output json | jq -r '.message'   # JSON output for pipes
```

Combine it with `grep` or `jq` to find an error, and with your logging backend for history; stern shows what the node still has. For logs older than a pod's life, use your log store: see [[loki-vs-elasticsearch-vs-cloud-logging]] and [[searching-logs]]. Verify flag names (`--since`, `--tail`, `--output`, container selectors) against `stern --help` for your version, as options have been renamed in the past.

## Shared safety habits

### Show the context in your prompt

A prompt that always shows the current context and namespace is the cheapest guard. A minimal zsh snippet that turns red for production:

```zsh title="~/.zshrc"
autoload -Uz colors && colors
setopt PROMPT_SUBST

kube_ctx() {
  local ctx ns
  ctx=$(kubectl config current-context 2>/dev/null) || return
  ns=$(kubectl config view --minify --output 'jsonpath={..namespace}' 2>/dev/null)
  case "$ctx" in
    *prod*) print -n "%F{red}[${ctx}/${ns:-default}]%f " ;;
    *)      print -n "%F{green}[${ctx}/${ns:-default}]%f " ;;
  esac
}

PROMPT='$(kube_ctx)%~ %# '
```

This calls `kubectl` on every prompt, which is slow on a laggy VPN. If you notice a delay, read the context from the kubeconfig file instead, or use a ready-made prompt plugin and check its docs.

### Read-only access for browsing

Daily exploration should use credentials that cannot change things. Give engineers a read-only Kubernetes role (the built-in `view` ClusterRole, bound per namespace or cluster) for normal use, and a separate, audited path for write access, for example a break-glass group. `k9s --readonly` is a convenience on top of RBAC, not a substitute: a determined or careless user can still run `kubectl delete`.

### Be explicit in scripts

Never write a script that relies on the current context:

```bash title="deploy-check.sh"
#!/usr/bin/env bash
set -euo pipefail

CONTEXT="gke_example-project_europe-west1_prod"
NAMESPACE="app"

kubectl --context "${CONTEXT}" -n "${NAMESPACE}" rollout status deploy/api --timeout=120s
```

Add `--context` and `-n` to every command in a script, and assert the context at the top of anything that mutates state.

### Habits that prevent most incidents

- Read before write: run `kubectl get` and `kubectl diff` or `--dry-run=server` before `apply` or `delete`.
- Confirm the target: look at the prompt before pressing Enter on a destructive command.
- Separate terminal windows by environment, with different colours.
- Prefer changing things through Git and your delivery pipeline. Hand edits in k9s drift from Git and are reverted by the GitOps controller anyway.

## Install and pinning

Choose one installation method per tool and record the version.

```bash title="Homebrew (macOS and Linux)"
brew install k9s kubectx stern
```

```bash title="krew (kubectl plugins)"
kubectl krew install ctx ns stern
# then: kubectl ctx, kubectl ns, kubectl stern
```

For a controlled setup, such as a team baseline or a Dockerfile for a toolbox container, download release binaries from each project's GitHub releases page and verify them. The pattern below uses a checksum file published with the release; check the release assets for the actual file names:

```bash title="verify a downloaded release (names illustrative)"
VERSION=<pinned-version>
curl -fsSLO "https://github.com/derailed/k9s/releases/download/${VERSION}/k9s_Linux_amd64.tar.gz"
curl -fsSLO "https://github.com/derailed/k9s/releases/download/${VERSION}/checksums.sha256"
grep ' k9s_Linux_amd64.tar.gz$' checksums.sha256 | sha256sum -c -
```

On macOS, use `shasum -a 256 -c` in place of `sha256sum -c`. Replace `<pinned-version>` with a release you have looked at; do not pipe a download into a shell. Some projects also sign releases; if a signature is available, verify it as described in [[cosign-vs-notation]] and the project's own documentation. Track these tools in your dependency-update process too: see [[renovate-vs-dependabot]].

## GKE specifics

On GKE the context is created by `gcloud`:

```bash
gcloud container clusters get-credentials example-prod \
  --region europe-west1 --project example-project
kubectl config current-context
# gke_example-project_europe-west1_example-prod
```

Practical points:

- Install the GKE auth plugin (`gke-gcloud-auth-plugin`) as the current documentation describes; without it `kubectl` and k9s fail to authenticate on recent client versions.
- Context names follow `gke_<project>_<location>_<cluster>`; rename them as shown above for readability, or keep the full names in scripts and short aliases in your shell.
- For private clusters, you may need a bastion, IAP tunnel or authorised network before the API server is reachable. See [[gke-for-beginners]] for the basics and the platform topology notes for private endpoints.
- Credentials expire; if k9s suddenly shows authentication errors, refresh with `gcloud auth login` and re-run `get-credentials`.

## Troubleshooting

- **k9s shows "unauthorized" or an exec plugin error.** The `gke-gcloud-auth-plugin` is missing or not on `PATH`, or the gcloud session expired. Run the plugin by hand and check `gcloud auth list`.
- **Wrong cluster, right name.** Two kubeconfig entries with the same name from different projects. Run `kubectl config get-contexts` and delete the stale one with `kubectl config delete-context`.
- **stern prints nothing.** The label selector matches no pods, the namespace is wrong, or `--since` is shorter than the last log line. Run `kubectl get pods -n app -l app=api` first.
- **k9s is slow on a large cluster.** Restrict to a namespace, reduce the refresh rate, or use the `--readonly` view on a smaller scope. Check the docs for limiting the namespaces watched.
- **kubens changes but pods are still in the old namespace.** Another terminal or a script changed it, or the command was run with an explicit `-n`. Check with `kubectl config view --minify`.
- **Prompt guard is slow.** See the note above; read the kubeconfig directly.

## When not to use them

- In automation. Scripts need stable `kubectl` calls with explicit flags, not interactive UIs or global context switching.
- On a shared jump host where several people use one kubeconfig. Switching context changes it for everyone.
- When the aim is to learn: type the raw `kubectl` commands first, so the tool shortcuts rest on understanding. The Kubernetes reference lists them all.
- For anything that should be a reviewed change. Use Git and the pipeline, see [[helm-vs-kustomize]] for the packaging side.

## Related

- [[kubernetes-pod-troubleshooting]]
- [[node-resource-pressure-triage]]
- [[gke-for-beginners]]
- [[helm-vs-kustomize]]

## Sources

- [k9s documentation](https://k9scli.io/)
- [k9s repository](https://github.com/derailed/k9s)
- [kubectx and kubens repository](https://github.com/ahmetb/kubectx)
- [stern repository](https://github.com/stern/stern)
- [kubectl reference](https://kubernetes.io/docs/reference/kubectl/)
