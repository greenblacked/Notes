---
title: "Start 01: Set up your lab (and the homelab ladder)"
description: Build a disposable lab (an Ubuntu VM or container, local tools, a budgeted GCP sandbox project) and follow six homelab projects that grow with the learning path.
type: guide
tags:
  - learning
  - linux
  - docker
  - kubernetes
  - gcp
  - cost
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: junior | Time: about 3 h | You need: a laptop you may install software on, and a Google account | Lab: this lesson builds all of them (Lab A is a Linux VM or container, Lab B adds the local tools and a kind cluster, Lab C is the GCP sandbox project)

Every other lesson in the [[learn/index|learning path]] assumes the lab from this page. Do it once, carefully, and the rest of the path is much smoother.

## What you will learn

- Why you practise in a disposable lab and never on production.
- How to get a Linux machine you can break: an Ubuntu LTS VM, or a container for the Linux lessons.
- Which tools the path uses, how to check their versions, and why you pin them.
- How to create a GCP sandbox project with a budget alert, labels and a cleanup rule.
- Which homelab projects to build as you progress, and how each one proves it works.

## Why a lab

DevOps work changes systems that other people depend on. You learn fastest by trying things that can fail: deleting a file, killing a process, applying a bad manifest, locking yourself out of SSH. None of that is acceptable on a shared server, a team cluster or a production project.

A lab gives you three things:

1. **Permission to fail.** If you break it, you delete it and start again.
2. **Repeatability.** You can build the same machine twice and compare. This is the habit behind infrastructure as code.
3. **Separation.** Your lab has its own accounts, keys and cloud project, so a mistake cannot reach real data or real money.

> [!warning] The lab-first rule
> Every command in this path runs in your lab first. Never paste a command from a lesson into a production shell, cluster or cloud project to "see what happens". When you do touch production at work, you will follow your team's change process, for example [[standards/production-change-checklist|the production change checklist]].

## Option A: one Ubuntu LTS VM

A virtual machine (VM) is a complete computer simulated by software. It has its own kernel, its own users and its own disk, so it behaves like the servers you will manage. This is the best base for the Linux, networking and scripting lessons.

Use the latest Ubuntu LTS release (the long-term support line). The lessons were written with Ubuntu 24.04 LTS in mind. Other Debian-based distributions work with minor differences, and the lessons call out the places where Red Hat style systems differ.

Pick one tool for creating the VM:

| Tool      | Works on              | Why choose it                                       |
| --------- | --------------------- | --------------------------------------------------- |
| Multipass | Linux, macOS, Windows | One command to launch an Ubuntu VM; easy snapshots  |
| Lima      | macOS, Linux          | Lightweight Linux VMs; good if you already use brew |
| UTM       | macOS (Apple silicon) | A graphical app; good if you prefer clicking        |

Multipass example. Variables first, then the commands:

```bash
LAB_VM="lab"
LAB_CPUS=2
LAB_MEMORY="4G"
LAB_DISK="20G"

# Install (Linux with snap). On macOS use: brew install --cask multipass
sudo snap install multipass

# Create and enter the VM
multipass launch 24.04 --name "$LAB_VM" --cpus "$LAB_CPUS" --memory "$LAB_MEMORY" --disk "$LAB_DISK"
multipass shell "$LAB_VM"
```

Lima example (macOS or Linux):

```bash
brew install lima
limactl start --name=lab template:ubuntu-lts
limactl shell lab
```

> [!warning] Check before relying on this
> Install and launch syntax changes between releases of Multipass, Lima and UTM, and it was not verified for this page. In particular, check the Multipass `launch` argument order, the Lima template name and the snapshot commands against the current documentation linked under Sources. If a command fails, read its `--help` output first.

Inside the VM, confirm what you have:

```bash
cat /etc/os-release | head -n 3
```

```text
PRETTY_NAME="Ubuntu 24.04.5 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
```

Your exact point release will differ. That is fine.

## Option B: a Docker container for the Linux lessons

If you cannot run a VM (a locked-down work laptop, or no spare memory), a container works for most of the Linux lessons. A container shares the host's kernel, so it is not a full computer. It lacks a service manager by default and is missing some tools.

```bash
docker run --rm -it --name linux-lab ubuntu:24.04 bash
```

Inside, install what the Linux lessons need. Minimal images ship almost nothing:

```bash
apt-get update
apt-get install -y --no-install-recommends curl less nano man-db procps iproute2 iputils-ping dnsutils
```

> [!warning] Check before relying on this
> The Ubuntu base image is "minimized": it may exclude manual pages and other documentation, and the `man` command can print a notice about it. Whether `man-db` brings the pages back depends on the image, so check it for the tag you use. Containers also have no systemd by default, so the lesson on services needs a VM (Option A).

You will meet containers properly in [[learn/containers-under-the-hood]]. For now, treat this one as a throwaway shell: `--rm` deletes it when you exit.

## Tools and version checks

The path uses the same set of tools throughout. Install them now so no lesson stops to ask you to.

| Tool         | Used for                                          | First needed in                               |
| ------------ | ------------------------------------------------- | --------------------------------------------- |
| `git`        | Version control                                   | [[learn/git-mental-model-and-daily-workflow]] |
| `docker`     | Build and run containers (or a compatible engine) | [[learn/containers-under-the-hood]]           |
| `kind`       | A Kubernetes cluster that runs in containers      | [[learn/kubernetes-architecture-and-kind]]    |
| `kubectl`    | The Kubernetes command-line client                | [[learn/kubernetes-architecture-and-kind]]    |
| `helm`       | Kubernetes package manager                        | [[learn/helm-basics-and-capstone]]            |
| `terraform`  | Infrastructure as code                            | [[learn/terraform-basics-on-gcp]]             |
| `gcloud`     | The Google Cloud command-line tool                | [[learn/gcp-foundations]]                     |
| `jq`         | Query JSON                                        | [[learn/text-and-data-tools]]                 |
| `yq`         | Query YAML (the mikefarah version, v4)            | [[learn/text-and-data-tools]]                 |
| `shellcheck` | Find mistakes in shell scripts                    | [[learn/safe-bash-scripts]]                   |
| `python3`    | Scripting                                         | [[learn/python-for-ops]]                      |

Two rules about versions:

- **`kubectl` must be within one minor version of your cluster's API server**, newer or older. The Kubernetes project documents this skew policy. If your cluster is 1.N, `kubectl` 1.(N-1), 1.N or 1.(N+1) is supported.
- **Pin what you teach yourself with.** Write down the versions you used. When a command behaves differently a year from now, the first question is "which version?". Pinning is also what real pipelines do, covered in [[patterns/automated-dependency-updates]].

> [!warning] There are two programs called yq
> A Python `yq` (a wrapper around `jq`) and the Go `yq` by mikefarah share a name. The lessons use the Go version, v4. The script below detects the wrong one.

Here is a version-check script. It prints one line per tool and exits non-zero if anything is missing, so you can also run it in automation later.

```bash title="check-tools.sh"
#!/usr/bin/env bash
# check-tools.sh - print one line per lab tool with its version.
# Exit codes: 0 all tools found, 1 at least one tool missing.
set -uo pipefail

missing=0

# check <command> <version command...>
check() {
  local name="$1"
  shift
  if ! command -v "$name" >/dev/null 2>&1; then
    printf '%-10s MISSING\n' "$name"
    missing=$((missing + 1))
    return
  fi
  local first_line
  first_line="$("$@" 2>&1 | head -n 1)"
  printf '%-10s %s\n' "$name" "${first_line:-no version output}"
}

# The yq in many distro repos is a different tool (a Python wrapper around jq).
check_yq() {
  if command -v yq >/dev/null 2>&1 && ! yq --version 2>&1 | grep -q mikefarah; then
    printf '%-10s WRONG TOOL: install mikefarah/yq (v4)\n' "yq"
    missing=$((missing + 1))
  else
    check yq yq --version
  fi
}

check git git --version
check docker docker --version
check kind kind version
check kubectl kubectl version --client
check helm helm version --short
check terraform terraform version
check gcloud gcloud version
check jq jq --version
check_yq
check shellcheck shellcheck --version
check python3 python3 --version

if [[ "$missing" -gt 0 ]]; then
  printf '%d problem(s) found\n' "$missing" >&2
  exit 1
fi
```

Install the tools with your package manager (`brew`, `apt`, `snap`) or each project's official install page, linked under Sources. Use the official instructions rather than a random blog, because install commands change.

## A GCP sandbox project

From [[learn/gcp-foundations]] onward you use Google Cloud. Set up a safe place for it now.

> [!warning] Costs money
> A GCP project is free to create, but the resources you start in it (VMs, GKE clusters, Cloud SQL, load balancers) are billed while they exist. Billing needs a billing account with a payment method. Never leave lab resources running overnight. The rule is: **when a lesson ends, delete what it created**, and every cloud lesson prints its cleanup command next to the step that costs money. This page does not quote prices; check the current pricing page for anything you start. To remove everything at once, run `gcloud projects delete "$LAB_PROJECT_ID"` (see the cleanup rule below).

### One project, used for nothing else

Use a separate project for the lab, with a name that says what it is. A separate project is a hard boundary: its IAM policy, quotas, billing link and resources are its own. If the lab goes wrong you delete the whole project (see the cleanup rule below) and nothing else is affected. It also keeps your lab bill readable.

```bash
# Variables - change these
LAB_PROJECT_ID="lab-yourname-123456"        # globally unique, 6-30 chars: lowercase letters, digits, hyphens. Change: make it yours.
BILLING_ACCOUNT_ID="XXXXXX-XXXXXX-XXXXXX"   # Change: your billing account id, from "gcloud billing accounts list".

gcloud auth login
gcloud billing accounts list
gcloud projects create "$LAB_PROJECT_ID" --name="learning lab"
gcloud billing projects link "$LAB_PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID"
gcloud beta projects update "$LAB_PROJECT_ID" --update-labels=env=lab,owner=yourname,purpose=learning
```

The labelling step uses the `beta` command group because the GA `gcloud projects update` only changes the name in the version checked. Check `gcloud beta projects update --help` for your version before relying on it; the beta group may need installing (`gcloud components install beta`), and the console or Terraform can set the same labels. [[learn/gcp-foundations]] covers this in its labelling exercise.

Labels (`env=lab`, `owner=...`) travel into billing reports, which is how teams attribute cost later ([[architecture/finops-cost-allocation-and-guardrails]]).

### A budget with alerts

A budget watches spend and notifies you. Set one before you create anything.

```bash
BUDGET_AMOUNT="20USD"                        # Change: an amount you are comfortable losing.
LAB_PROJECT_NUMBER="$(gcloud projects describe "$LAB_PROJECT_ID" --format='value(projectNumber)')"

gcloud billing budgets create \
  --billing-account="$BILLING_ACCOUNT_ID" \
  --display-name="lab-budget" \
  --budget-amount="$BUDGET_AMOUNT" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --filter-projects="projects/${LAB_PROJECT_NUMBER}"
```

This alerts at 50% and 90% of the amount.

> [!warning] A budget alerts. It does not cap spend.
> A budget sends notifications; it does not stop resources or block charges. Spend can continue past 100% and past your alert. Only you stopping the resources, or automation you build on purpose, limits the bill. An alert is a smoke detector, not a sprinkler. Also check where alerts go: by default they reach billing account administrators, so make sure that is you.

> [!warning] Check before relying on this
> The `gcloud billing budgets create` flags (`--budget-amount`, `--threshold-rule`, `--filter-projects`) and whether `--filter-projects` takes a project number or id were not verified for your `gcloud` version. Run `gcloud billing budgets create --help` and compare. Budget data can also lag, so an alert may arrive after the money is spent.

### The cleanup rule

The cleanup rule is two parts:

1. After every cloud lesson, delete the resources it created. Each lesson lists the exact command.
2. When you finish the path, or at any time you are unsure what is still running, delete the entire project:

```bash
gcloud projects delete "$LAB_PROJECT_ID"
```

Deleting a project schedules it for deletion and stops billing for its resources. Google documents a recovery window before the data is gone for good; check the current documentation for its length.

### Use a separate `gcloud` configuration

A named configuration keeps the lab project away from your work projects. This prevents the most expensive mistake in cloud work: running a command against the wrong project.

```bash
gcloud config configurations create lab
gcloud config set project "$LAB_PROJECT_ID"
gcloud config configurations list
```

```text
NAME  IS_ACTIVE  ACCOUNT           PROJECT              COMPUTE_DEFAULT_ZONE  COMPUTE_DEFAULT_REGION
lab   True       you@example.com   lab-yourname-123456
```

The output is illustrative. Whenever you switch tasks, run `gcloud config configurations list` to see which configuration is active.

## Safe habits

- **Snapshot before you change something risky.** Multipass and other VM tools can save the VM state. Take one before the first lesson that edits system files, and restore it when you break something. A snapshot is cheaper than a rebuild.
- **Use a scratch directory.** Work in `~/lab/` and keep experiments there. Do not run recursive commands from `/` or from your home directory root.
- **Never reuse personal keys.** Create a new SSH key for the lab ([[learn/linux-users-permissions-sudo-and-ssh]]). Do not copy your work SSH key, cloud credentials or password manager into the lab. A lab is allowed to be less careful than production, so it must not hold anything production-grade.
- **Keep secrets out of Git.** Even lab tokens. You will practise secret scanning later, and the habit is cheap now.
- **Write down what you did.** Keep a `lab-notes.md` with commands that worked. It becomes your own runbook.

## The homelab ladder

Lessons teach one skill at a time. A homelab project joins several skills into something that works end to end. Build the six projects below as you reach their stage in the path. Each one has a "done when" check: a command and the output that proves it is done. Outputs are illustrative; yours will differ in dates, ids and versions.

| Project | Build after              | You will have                                          |
| ------- | ------------------------ | ------------------------------------------------------ |
| P1      | Stage 1 (Linux)          | A VM with nginx, a systemd unit and a tested backup    |
| P2      | Stage 5 (Containers)     | Compose, a reverse proxy and TLS from a local CA       |
| P3      | Stage 6 (Kubernetes)     | A kind or k3s cluster, Helm, ingress and a rollback    |
| P4      | Stage 8 (CI/CD and IaC)  | Terraform, CI and GitOps on one repository             |
| P5      | Stage 10 (Observability) | Prometheus, Grafana and Loki, plus an alert that fires |
| P6      | After P5                 | A disaster recovery drill with measured RTO and RPO    |

### P1: One VM with nginx, a systemd unit and a restore check

Install nginx on the Lab VM. Write a small systemd service of your own (for example a script that appends a timestamp to a file every minute, driven by a timer). Back up the nginx web root and `/etc/nginx` into a tar archive, record its checksum, delete the original, restore, and compare.

Done when:

```bash
systemctl is-active nginx
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/
sha256sum -c backup.sha256
```

```text
active
200
backup.tar.gz: OK
```

You need [[learn/linux-processes-memory-and-disk]] and [[learn/linux-services-packages-and-scheduled-jobs]] for this one.

### P2: Compose, a reverse proxy and TLS from a local CA

Run two small web apps with Docker Compose behind Caddy or Traefik. Serve them over HTTPS using a certificate from a local certificate authority (Caddy can create one with its `tls internal` option). Use a name like `app.lab.example.com` and point it at `127.0.0.1` with a hosts entry or the `--resolve` option of `curl`.

Done when, with the local CA's root certificate saved as `local-ca.crt`:

```bash
curl --cacert local-ca.crt --resolve app.lab.example.com:443:127.0.0.1 \
  -s -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://app.lab.example.com/
```

```text
200 0
```

`ssl_verify_result` of `0` means the certificate verified. Where Caddy stores its root certificate depends on the image and version (verify for your setup).

You need [[learn/http-and-tls]] and [[learn/container-storage-networking-and-compose]].

### P3: kind or k3s, Helm, ingress and a rollback

Create a cluster, install a small web app with Helm, expose it through an ingress or the Gateway API, release a version that breaks, and roll back.

Done when:

```bash
helm history web
kubectl rollout status deployment/web --timeout=60s
```

```text
REVISION  UPDATED                   STATUS      CHART      APP VERSION  DESCRIPTION
1         Sat Oct 17 10:00:00 2026  superseded  web-0.1.0  1.0.0        Install complete
2         Sat Oct 17 10:05:00 2026  superseded  web-0.2.0  1.1.0        Upgrade complete
3         Sat Oct 17 10:09:00 2026  deployed    web-0.1.0  1.0.0        Rollback to 1
deployment "web" successfully rolled out
```

You need [[learn/kubernetes-services-and-ingress]] and [[learn/helm-basics-and-capstone]]. The senior view is [[runbooks/helm-release-rollback]].

### P4: Terraform, CI and GitOps

Describe a small piece of GCP infrastructure in Terraform (a Cloud Storage bucket is enough), run it from a CI pipeline, and deploy the P3 app to your cluster with Argo CD or Flux reading a Git repository.

> [!warning] Costs money
> A Cloud Storage bucket is billed for what it stores. Clean up with `terraform destroy`, and if objects remain and the bucket will not delete, `gsutil rm -r gs://BUCKET` (use your bucket name), or delete the whole project: `gcloud projects delete "$LAB_PROJECT_ID"`.

Done when:

```bash
terraform plan -detailed-exitcode ; echo "exit=$?"
kubectl -n argocd get applications.argoproj.io web
```

```text
No changes. Your infrastructure matches the configuration.
exit=0
NAME   SYNC STATUS   HEALTH STATUS
web    Synced        Healthy
```

Exit code `0` means no changes, `2` means changes are pending, `1` means an error. See [[adr/0001-gitops-with-argocd]] for why this site uses Argo CD, and [[patterns/terraform-module-and-state-layout]].

### P5: Prometheus, Grafana and Loki, and an alert that fires

Install the monitoring stack on the P3 cluster. Create one alert rule, break the app on purpose, and watch the alert fire.

Done when:

```bash
kubectl -n monitoring port-forward svc/prometheus 9090:9090 &
sleep 2
curl -s http://localhost:9090/api/v1/alerts | jq -r '.data.alerts[].labels | "\(.alertname) \(.severity)"'
kill %1
```

```text
WebHighErrorRatio page
```

The service name depends on how you installed the stack; change it to match. Needs [[learn/first-prometheus-alert]].

### P6: A disaster recovery drill

Pick the data in P1 or P3. Take a backup, destroy the original, restore from the backup, and measure two numbers: **RTO** (recovery time objective: how long recovery took) and **RPO** (recovery point objective: how much data you lost). Write both in a file together with the commands you used.

Done when:

```bash
cat dr-drill.txt
```

```text
backup taken:        10:00:00
data lost at:        10:07:30
restore finished:    10:19:30
RPO (last backup to loss): 7m30s
RTO (loss to restored):    12m00s
checksum after restore:    OK
```

The numbers are an example. What matters is that you measured them. See [[architecture/disaster-recovery-tiers-rpo-rto]] for how teams set targets.

## Hands-on exercises

Do these in order, in your lab.

1. **Run the version-check script.** Save the script above as `check-tools.sh` and run it.

   ```bash
   bash check-tools.sh; echo "exit=$?"
   ```

   Expected: one line per tool with a version, then `exit=0` once everything is installed. Illustrative output:

   ```text
   git        git version 2.43.0
   docker     Docker version 2x.y.z, build xxxxxxx
   kind       kind v0.x.y go1.x.y linux/amd64
   ...
   exit=0
   ```

   While tools are missing you see `MISSING` lines, a `N problem(s) found` message on stderr and `exit=1`. If you see something else: if a line says `no version output`, run that tool's version command by hand and read the error; if `yq` says `WRONG TOOL`, uninstall the Python `yq` and install the mikefarah one.

2. **Create a kind cluster.**

   ```bash
   kind create cluster --name lab
   kubectl get nodes
   ```

   Expected: kind prints progress lines (preparing nodes, writing configuration, starting the control plane) and then `kubectl get nodes` shows one node that is `Ready` (illustrative):

   ```text
   NAME                 STATUS   ROLES           AGE   VERSION
   lab-control-plane    Ready    control-plane   60s   v1.xx.x
   ```

   If you see something else: `NotReady` for the first minute is normal, so wait and repeat. If `kind` cannot reach the Docker daemon, start Docker and check `docker ps`. If `kubectl` talks to a different cluster, run `kubectl config current-context`; it should be `kind-lab`. The Kubernetes version comes from the kind release's default node image, which differs per release (verify with `kind --help` and the release notes).

3. **Create a gcloud configuration and see the budget.**

   If you skipped the section above, set `LAB_PROJECT_ID` and `BILLING_ACCOUNT_ID` again in this shell first; variables do not survive a new shell.

   ```bash
   gcloud config configurations create lab
   gcloud config set project "$LAB_PROJECT_ID"
   gcloud billing budgets list --billing-account="$BILLING_ACCOUNT_ID"
   ```

   Expected: the configuration is created and activated, and the list shows the `lab-budget` budget (illustrative):

   ```text
   Created [lab].
   Activated [lab].
   Updated property [core/project].
   ---
   displayName: lab-budget
   ...
   ```

   If you see something else: if `configurations create` says the configuration already exists, use `gcloud config configurations activate lab`. If `budgets list` is denied, your account needs a billing role on the billing account (for example Billing Account Administrator or a budget viewer role; check the exact role names in the IAM documentation). If the command is unknown, update `gcloud` or look under `gcloud beta billing`.

4. **Delete the cluster.**

   ```bash
   kind delete cluster --name lab
   ```

   Expected: `Deleting cluster "lab" ...` followed by `Deleted nodes: ["lab-control-plane"]`. Running `docker ps` no longer shows the node container. If you see something else: if kind says the cluster does not exist, check `kind get clusters`.

## Common mistakes

- **Practising on a real cluster "just to look".** A read-only habit slides into an accidental write. Keep the lab as the default context and read `kubectl config current-context` before every session.
- **Forgetting the cleanup rule.** A forgotten cluster or VM bills every hour. Run the cleanup command at the end of each cloud lesson, and check the console for running resources every week.
- **Believing the budget is a limit.** It is not. Set alerts low, and send them to an address you read.
- **Installing the wrong `yq`.** Scripts then fail with confusing syntax errors. Run the version-check script after every install.
- **A `kubectl` far from the cluster version.** Odd errors appear when the skew is more than one minor version. Check both versions when something unexplained fails.
- **Reusing personal credentials in the lab.** If a lab VM is ever shared or compromised, your real keys go with it. Create lab-only keys.

## Check your understanding

1. Why use a separate GCP project for the lab instead of a folder or label inside your work project?
2. What does a budget do, and what does it not do?
3. Why pin or record tool versions?
4. Which `kubectl` versions are supported against a 1.N cluster?
5. Why does a container not replace a VM for the lesson on services?

> [!question]- Answers
>
> 1. A project is a hard boundary for IAM, quotas, billing and resources. Deleting it removes everything at once, and a mistake cannot reach other resources. A label or folder gives no such isolation.
> 2. It notifies you when spend crosses thresholds. It does not stop resources, block charges or cap the bill, and its data can lag.
> 3. Behaviour changes between versions. Knowing which versions you used lets you reproduce a result, explain a difference and upgrade on purpose. Real pipelines pin versions for the same reason.
> 4. The Kubernetes version skew policy supports `kubectl` one minor version older or newer than the API server: 1.(N-1), 1.N and 1.(N+1).
> 5. A container shares the host's kernel and usually has no init system, so there is no systemd to manage services, timers or boot behaviour.

## Next steps

- Next lesson: [[learn/linux-shell-and-filesystem|Linux 01: The shell, the filesystem and the command line]].
- Go deeper: [[management/onboarding-engineers]] shows how a team onboards a new engineer, which is the same access-first, small-wins sequence you just did for yourself.
- Back to the [[learn/index|learning path]].

## Sources

- Multipass documentation: <https://documentation.ubuntu.com/multipass/>
- Lima documentation: <https://lima-vm.io/docs/>
- UTM documentation: <https://docs.getutm.app/>
- Docker Engine install documentation: <https://docs.docker.com/engine/install/>
- kind quick start: <https://kind.sigs.k8s.io/docs/user/quick-start/>
- Kubernetes version skew policy: <https://kubernetes.io/releases/version-skew-policy/>
- Install `kubectl`: <https://kubernetes.io/docs/tasks/tools/>
- Helm install: <https://helm.sh/docs/intro/install/>
- Terraform install: <https://developer.hashicorp.com/terraform/install>
- Google Cloud CLI install: <https://cloud.google.com/sdk/docs/install>
- Create and manage projects: <https://cloud.google.com/resource-manager/docs/creating-managing-projects>
- Cloud Billing budgets and alerts: <https://cloud.google.com/billing/docs/how-to/budgets>
- `gcloud billing budgets create` reference: <https://cloud.google.com/sdk/gcloud/reference/billing/budgets/create>
- `jq`: <https://jqlang.org/>
- `yq` (mikefarah): <https://github.com/mikefarah/yq>
- ShellCheck: <https://www.shellcheck.net/>

Versions checked: none of the cloud or install commands were run against the current releases; only `check-tools.sh` was run (Ubuntu 24.04, Bash 5.2) on a machine where several tools were missing, which exercised the `MISSING` and `WRONG TOOL` paths.
