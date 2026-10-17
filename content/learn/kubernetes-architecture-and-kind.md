---
title: "Kubernetes 01: Architecture, kind and the kubectl workflow"
description: Learn what runs inside a Kubernetes cluster, how a command becomes a running Pod, and how to build a local kind cluster and use kubectl safely.
type: guide
tags:
  - learning
  - kubernetes
  - gke
  - reliability
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: junior | Time: about 6 h | You need: [[learn/container-storage-networking-and-compose|Containers 04: Volumes, networks and Docker Compose]] | Lab: Option A, the Ubuntu LTS VM from [[learn/lab-setup|Start 01: Set up your lab]], with Docker, `kind` and `kubectl` installed (see "Tools and version checks" there)

You can now run a few containers on one machine with Compose. Production asks for more: what restarts a container that crashes, what moves it when a machine dies, how a new version replaces an old one without downtime, and how a hundred services find each other. **Kubernetes** answers these questions by keeping a cluster of machines in the state you describe. This lesson explains the parts of a cluster and how they cooperate, so that later errors make sense, and then gives you a local cluster and the habits of a careful `kubectl` user.

## What you will learn

- Why an orchestrator exists, and the problems it solves that Compose on one host does not.
- The control plane and node components: `kube-apiserver`, `etcd`, `kube-scheduler`, `kube-controller-manager`, `cloud-controller-manager`, `kubelet`, the container runtime, `kube-proxy` and the network plugin.
- Desired state, observed state and the reconciliation loop, and the exact path from `kubectl apply` to a running container.
- What a managed service such as GKE runs for you and what stays your job.
- How to create a three-node cluster with `kind`, read and switch `kubeconfig` contexts, and use the core `kubectl` verbs (`get`, `describe`, `apply`, `delete`, `explain`, `diff`, `--dry-run`).
- Safety habits that prevent the classic mistake: running a command against the wrong cluster.

## Why an orchestrator

Compose starts containers on one machine. If that machine dies, everything dies. If a container crashes, nothing but a restart policy brings it back. You cannot say "keep three copies running somewhere" or "replace version 1 with version 2 a few at a time". An **orchestrator** is a system that takes a description of what you want ("three copies of this image, reachable on this name, with this much memory") and keeps doing whatever is needed to make it true across a group of machines.

Kubernetes (also written K8s) is the standard open-source orchestrator. Its jobs, in plain words:

- **Scheduling.** Decide which machine runs each container, based on free CPU and memory and on rules you set.
- **Self-healing.** Restart containers that die, replace Pods on a failed machine, and stop sending traffic to anything that is not ready.
- **Scaling and rollouts.** Change the number of copies, and replace old versions with new ones step by step.
- **Service discovery and load balancing.** Give a group of Pods a stable name and address.
- **Configuration and secrets.** Deliver settings to containers without baking them into images.

It does not build your images, write your code or fix a slow database. It is also a large system; most of the learning is knowing where to look when something is wrong, which starts with the architecture.

## The architecture: a control plane and nodes

A cluster is a set of machines (**nodes**) plus the programs that manage them (the **control plane**). In a self-built cluster the control plane runs on one to three dedicated machines. In a managed service such as GKE you do not see those machines at all.

```text
                        you: kubectl, CI, Argo CD
                                   |  HTTPS (REST API)
                                   v
 +------------------------ CONTROL PLANE -------------------------+
 |                                                                  |
 |   kube-apiserver  <------------->  etcd                          |
 |      ^     ^     ^                 (the cluster's database)      |
 |      |     |     |                                               |
 |      |     |     +-- cloud-controller-manager (cloud API)        |
 |      |     +-------- kube-controller-manager (the controllers)   |
 |      +-------------- kube-scheduler (picks a node for a Pod)     |
 |                                                                  |
 +------------------------------------------------------------------+
        ^ watch / report                       ^ watch / report
        |                                      |
 +------+----------- NODE 1 --------+   +------+--------- NODE 2 ---+
 |  kubelet --CRI--> containerd     |   |  kubelet --CRI--> containerd |
 |  kube-proxy      (runs the       |   |  kube-proxy      (runs the   |
 |  network plugin   containers)    |   |  network plugin   containers)|
 |  [Pod] [Pod] [Pod]               |   |  [Pod] [Pod]                 |
 +----------------------------------+   +------------------------------+
```

The key fact in the picture: **everything talks to `kube-apiserver`, and nothing else talks to `etcd`.** The scheduler, the controllers and every kubelet read and write through the API server.

### Control plane components

| Component                  | What it does                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kube-apiserver`           | The front door. A REST API over HTTPS. It authenticates and authorises each request, runs admission checks, validates objects, stores them in etcd and lets other components watch for changes.   |
| `etcd`                     | A consistent key-value database. It holds the cluster's whole state: every Deployment, Pod, Secret and node. Lose it without a backup and you lose the cluster's memory.                          |
| `kube-scheduler`           | Watches for Pods with no node, and chooses a node for each. It first removes nodes that cannot fit the Pod (filtering), then ranks the rest (scoring).                                            |
| `kube-controller-manager`  | Runs many **controllers** in one process: the Deployment controller, the ReplicaSet controller, the node controller (notices dead nodes), the Job controller, and more.                           |
| `cloud-controller-manager` | Connects the cluster to a cloud provider's API: creates a cloud load balancer for a Service of type `LoadBalancer`, manages routes, and learns about cloud nodes. Absent in a local kind cluster. |

### Node components

| Component               | What it does                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kubelet`               | The agent on every node. It watches the API for Pods assigned to its node, makes them run through the container runtime, runs the health probes and reports status and node health back. |
| Container runtime (CRI) | The program that pulls images and runs containers. Kubernetes talks to it over the **Container Runtime Interface** (CRI). `containerd` is the common choice; `CRI-O` is another.         |
| `kube-proxy`            | Programs the node's network rules (iptables, IPVS or nftables, depending on the setup) so a Service's virtual IP reaches one of its Pods. Some network plugins replace it.               |
| Network plugin (CNI)    | A plugin that gives each Pod an IP address and connects Pods across nodes. Which one you have decides whether features such as network policies work.                                    |

Other pieces are **add-ons** that run as normal Pods in the `kube-system` namespace, for example CoreDNS (cluster DNS). The programs above are what you must be able to name in an interview, and more importantly when you read an error.

> [!note] Docker and the runtime
> Kubernetes dropped the old built-in Docker integration ("dockershim") some time ago, and the common runtime today is `containerd`, the same engine that sits under Docker. Images built with `docker build` run unchanged, because they follow the OCI format you met in [[learn/containers-under-the-hood|Containers 01]].

## Desired state, observed state and reconciliation

The central idea of Kubernetes is that you do not give commands such as "start a container". You store a description of the state you want, and programs called **controllers** work to make reality match it.

- **Desired state** is what you declared. In an object it lives under `spec`.
- **Observed state** is what exists now. In an object it lives under `status`, written by the controllers and the kubelet.
- A **controller** runs a loop forever: _observe_ the current state, _compare_ it to the desired state, _act_ to reduce the difference, repeat.

A thermostat is the usual comparison: you set 20 degrees, and the heater turns on and off to keep the room there, without anyone asking it each time. If a node dies and takes two of your three Pods with it, the controller sees `desired 3, observed 1` and creates two more. You never issued a "restart" command. This is also why you should be suspicious of manual fixes: the controller will quietly undo anything that contradicts the spec.

Every Kubernetes object has the same shape:

```yaml
apiVersion: apps/v1 # which API group and version
kind: Deployment # what type of object
metadata: # name, namespace, labels, annotations
  name: hello
spec: # the DESIRED state (you write this)
  replicas: 2
status: # the OBSERVED state (the cluster writes this)
  readyReplicas: 2
```

## From `kubectl apply` to a running container

When you run `kubectl apply -f deployment.yaml`, this is what happens. Learn this list: nearly every Kubernetes failure stops at one of these steps, and knowing which tells you where to look.

1. **kubectl builds a request.** It reads your `kubeconfig` to find the API server address and your credentials, and sends an HTTPS request.
2. **Authentication.** The API server asks _who are you?_ (a client certificate, a token, a cloud identity). Failure: `Unauthorized` (401).
3. **Authorisation.** It asks _may you do this?_ Usually with RBAC (role-based access control). Failure: `Forbidden` (403).
4. **Admission.** Admission controllers can change the object (**mutating** admission, for example adding defaults) and then check it (**validating** admission, for example a policy that forbids privileged Pods). Failure: a message naming the policy that denied the request. See [[patterns/pod-security-admission]].
5. **Validation and storage.** The API server checks the object against its schema and writes it to etcd. At this point `kubectl apply` returns: `deployment.apps/hello created`. **Nothing is running yet.** Only a description exists.
6. **The Deployment controller** (in kube-controller-manager) sees the new Deployment and creates a ReplicaSet. The **ReplicaSet controller** sees that it has no Pods and creates the Pod objects. These Pods have no node assigned: `status.phase` is `Pending`.
7. **The scheduler** sees Pods without a node, filters and scores the nodes, and writes the chosen node into each Pod (a "binding"). A failure here leaves the Pod `Pending` with a `FailedScheduling` event ("0/3 nodes are available: ...").
8. **The kubelet** on the chosen node sees a Pod assigned to it. It asks the container runtime over CRI to pull the image, sets up the network through the CNI plugin, starts the containers and runs the probes. Failures here show up as `ImagePullBackOff`, `CrashLoopBackOff` or `ContainerCreating` for a long time.
9. **The kubelet reports back.** It writes the Pod's `status` (phase, container states, IP) to the API server. `kubectl get pods` now shows `Running`.

Two consequences. First, components do not call each other directly: each one **watches** the API server for the objects it cares about and writes its results back as new or updated objects. That is why the control plane is loosely coupled and why a restart of one component does not lose work. Second, `kubectl` only ever talks to the API server. Even `kubectl logs` and `kubectl exec` go through it: the API server forwards the request to the kubelet on the right node.

### Managed Kubernetes: what GKE runs and what you still own

On Google Kubernetes Engine (GKE), Google runs the control plane for you: the API server, etcd, the scheduler and the controller manager, including their upgrades and availability. You never log in to those machines. You choose a mode:

- **Standard.** You also manage **node pools** (the machine types, count and upgrade settings for the worker nodes), although Google can automate node upgrades.
- **Autopilot.** Google also manages the nodes, and you pay for the resources your Pods request. This changes what you can do on a node.

What stays yours in every mode: your workloads and their manifests, resource requests and limits, RBAC and who may do what, network policies, secrets handling, when and how you upgrade versions within the allowed window, and the bill. "Managed" does not mean "someone else fixes my application".

> [!warning] Check before relying on this
> The exact split of responsibilities between you and Google, the options per mode, and the defaults for upgrades change over time. Read the GKE documentation for the mode you use before you plan around it. The details come in [[learn/gke-for-beginners|GCP 04: GKE for beginners]]; the upgrade procedure is in [[runbooks/gke-cluster-upgrade]].

## kind: a cluster in Docker containers

**kind** ("Kubernetes in Docker") creates a cluster whose nodes are Docker containers. Each "node" is a container running the kubelet, containerd and, on the control-plane node, the control plane programs. It starts in about a minute, costs nothing and is easy to throw away. It is meant for learning, testing and CI, never for production.

The default cluster has one node. A realistic lab has a control plane and two workers, so you can see scheduling and node failure. Describe it in a config file:

```yaml title="kind-lab.yaml"
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
  - role: worker
```

```bash
kind create cluster --name lab --config kind-lab.yaml --wait 120s
```

```text
Creating cluster "lab" ...
 * Ensuring node image (kindest/node:v1.xx.x)
 * Preparing nodes
 * Writing configuration
 * Starting control-plane
 * Installing CNI
 * Installing StorageClass
 * Joining worker nodes
 * Waiting <= 2m0s for control-plane = Ready
Set kubectl context to "kind-lab"
```

_Illustrative. The real output uses emoji in place of the `*`, and the Kubernetes version is the default node image of your kind release (verify with the kind release notes)._

kind writes a **context** named `kind-lab` into your `kubeconfig` and switches to it.

## kubeconfig, clusters and contexts

`kubectl` has no built-in idea of which cluster you mean. It reads a file, by default `~/.kube/config` (or the files named in the `KUBECONFIG` environment variable), which holds three lists:

- **clusters**: an API server address and the certificate authority that signed its certificate.
- **users**: credentials (a client certificate, a token, or a command that fetches one).
- **contexts**: a named combination of one cluster, one user and, optionally, a default namespace.

A field named `current-context` says which context is active. Every `kubectl` command runs against it.

```yaml title="~/.kube/config (shape only, values are placeholders)"
apiVersion: v1
kind: Config
current-context: kind-lab
clusters:
  - name: kind-lab
    cluster:
      server: https://127.0.0.1:PORT
      certificate-authority-data: REDACTED
users:
  - name: kind-lab
    user:
      client-certificate-data: REDACTED
      client-key-data: REDACTED
contexts:
  - name: kind-lab
    context:
      cluster: kind-lab
      user: kind-lab
      namespace: default
```

> [!warning] A kubeconfig is a credential
> It can contain private keys and tokens that give admin access to a cluster. Do not commit it, paste it into a chat or a ticket, or send it by email. Keep the file readable only by you (`chmod 600 ~/.kube/config`). `kubectl config view` hides secrets by default; `--raw` shows them, so be careful where that output goes.

The commands you will use constantly:

```bash
kubectl config get-contexts                    # list contexts; * marks the current one
kubectl config current-context                 # print the active one
kubectl config use-context kind-lab            # switch
kubectl config set-context --current --namespace=kube-system   # change the default namespace
kubectl config view --minify                   # only the active context, secrets hidden
```

To keep clusters apart, many people keep **one kubeconfig file per cluster** and list them in `KUBECONFIG` (`export KUBECONFIG=~/.kube/dev:~/.kube/prod`, joined with a colon). Kubectl merges them. You can also override the context for one command with `--context NAME`, which is much safer than switching and forgetting.

## The core kubectl verbs

`kubectl` has a few verbs you will use for the rest of your career.

| Command                                      | What it does                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `kubectl get TYPE [NAME]`                    | List objects. `-o wide` adds columns, `-o yaml` or `-o json` prints the full object, `-A` means all namespaces. |
| `kubectl describe TYPE NAME`                 | A human-readable summary **with recent events**. First stop when something is wrong.                            |
| `kubectl apply -f FILE`                      | Make the cluster match the file (create or update). The declarative way.                                        |
| `kubectl delete TYPE NAME` / `-f FILE`       | Delete an object.                                                                                               |
| `kubectl explain PATH`                       | Show the documentation of any field, straight from the API, for example `deployment.spec.replicas`.             |
| `kubectl api-resources`                      | List every object type the cluster knows, with short names and whether it is namespaced.                        |
| `kubectl diff -f FILE`                       | Show what `apply` would change, without changing it.                                                            |
| `kubectl logs POD` / `exec` / `port-forward` | Read logs, run a command in a container, forward a local port. Covered in later lessons.                        |

Output formats are worth knowing:

```bash
kubectl get nodes -o wide                                   # more columns
kubectl get pod web -o yaml                                 # the whole object, including status
kubectl get nodes -o jsonpath='{.items[*].metadata.name}'   # pick fields out
kubectl get nodes -o custom-columns=NAME:.metadata.name,KUBELET:.status.nodeInfo.kubeletVersion
```

### Imperative versus declarative

There are two ways to change a cluster.

- **Imperative**: tell it what to do _now_. `kubectl create deployment hello --image=...`, `kubectl scale`, `kubectl delete pod`. Quick for learning and for emergencies. The result lives only in the cluster, and nobody can see how it got there.
- **Declarative**: write the desired state in a file and run `kubectl apply -f`. The file goes into Git, reviews and CI, and the same file reproduces the cluster. This is how teams work, and it is the foundation of GitOps (see [[adr/0001-gitops-with-argocd]]).

Use the imperative style to explore, and the declarative one for anything that should still exist next week. A useful bridge is to let kubectl write the YAML for you and then keep the file:

```bash
kubectl create deployment hello --image=nginx:1.27-alpine --replicas=2 --dry-run=client -o yaml > deployment.yaml
```

### Dry runs and diff

- `--dry-run=client` builds the object **locally** and prints it. Nothing is sent to the cluster. It will not catch errors that only the server knows about.
- `--dry-run=server` sends the request through authentication, authorisation, admission and validation, and **stops before saving it**. It tells you whether the cluster would accept it.
- `kubectl diff -f deployment.yaml` compares the file with the live object. It exits with `0` when there is no difference, `1` when there is one, and a higher code on an error. That makes it usable as a pre-merge check.

A good habit before any change to a shared cluster: `kubectl diff`, read the result, then `kubectl apply`.

## Safety habits for a shared cluster

The commonest serious `kubectl` mistake is the right command against the wrong cluster: `kubectl delete -f .` meant for staging, run with the production context active.

- **Read the context before you change anything.** Run `kubectl config current-context`, or make your shell prompt show the context and namespace (the tools `kube-ps1` or `starship` do this). Third-party tools such as `kubectx` and `kubens` make switching quicker; they are optional conveniences, and you should read their source or documentation before installing them on a work machine.
- **Be explicit.** Put `--context NAME` and `-n NAMESPACE` in commands you save in runbooks and scripts, so they do not depend on whatever is active.
- **Separate environments.** One kubeconfig file per environment, and a different colour or prompt for production.
- **Read first, write second.** Run `get` and `describe` before `delete` and `apply`. Use `diff` and `--dry-run=server`.
- **Never use wildcards casually.** `kubectl delete pods --all -n NAME` and `-A` deserve a second look at the context and namespace.
- **Least privilege.** Day to day, use an account that can read production but not change it, and use the powerful one only when needed.

## Version skew

Kubernetes releases a new minor version (1.xx) several times a year, and components in a cluster do not have to be on exactly the same version. The **version skew policy** says how far apart they may be. In general the API server is the newest, `kubectl` may be one minor version older or newer than the API server, and kubelets may be older than the API server by a few minor versions but never newer.

> [!warning] Check before relying on this
> The exact number of minor versions a kubelet may lag behind the API server, and which releases are currently supported, change over time. Read the "Version Skew Policy" page for the version you run. Plan upgrades against it, and compare `kubectl version` (client and server) before you use a new feature. A client far outside the window can behave strangely.

## Hands-on exercises

Run these on the lab VM. Outputs are illustrative: ages, hashes, addresses, ports and versions will differ. The nodes are Docker containers, so the first exercise also reminds you where to look when the cluster does not start.

1. **Check the tools and clear any old cluster.**

   ```bash
   kind version
   kubectl version --client
   docker ps --format 'table {{.Names}}\t{{.Status}}'
   kind get clusters
   ```

   Expected: a `kind v0.xx.x` line, a client version line, a (possibly empty) container table and a list of kind clusters. If [[learn/lab-setup|Start 01]] left a one-node cluster called `lab`, you will see `lab`; delete it with `kind delete cluster --name lab` so this exercise can reuse the name.
   If you see something else: `command not found` means the tool is not installed; run the version-check script from [[learn/lab-setup|Start 01]]. `Cannot connect to the Docker daemon` means Docker is not running or your user is not in the `docker` group.

2. **Create a cluster with one control plane and two workers.**

   ```bash
   mkdir -p ~/k8s01 && cd ~/k8s01
   cat > kind-lab.yaml <<'EOF'
   kind: Cluster
   apiVersion: kind.x-k8s.io/v1alpha4
   nodes:
     - role: control-plane
     - role: worker
     - role: worker
   EOF
   kind create cluster --name lab --config kind-lab.yaml --wait 120s
   kubectl get nodes
   ```

   Expected: kind prints its progress lines and ends with `Set kubectl context to "kind-lab"`. Then:

   ```text
   NAME                STATUS   ROLES           AGE   VERSION
   lab-control-plane   Ready    control-plane   70s   v1.xx.x
   lab-worker          Ready    <none>          50s   v1.xx.x
   lab-worker2         Ready    <none>          50s   v1.xx.x
   ```

   If you see something else: `NotReady` in the first minute is normal, so wait and repeat. If creation fails with an error about a name that already exists, run `kind delete cluster --name lab` and try again. If it stalls while pulling the node image, check your network and the free disk space (`df -h`). If kind reports a configuration parse error, check the indentation of `kind-lab.yaml`.

3. **Identify the control plane components.**

   ```bash
   kubectl get pods -n kube-system -o wide
   ```

   Expected (illustrative): one pod each for `etcd-lab-control-plane`, `kube-apiserver-lab-control-plane`, `kube-controller-manager-lab-control-plane` and `kube-scheduler-lab-control-plane`, all on the control-plane node; two `coredns-...` pods; and three each of `kube-proxy-...` and `kindnet-...` (kind's network plugin), one per node. All `Running`. There is no cloud-controller-manager, because there is no cloud.
   If you see something else: pods in `Pending` or `ContainerCreating` for more than a few minutes mean the nodes are still starting or the network plugin has not come up; run `kubectl describe pod NAME -n kube-system` and read the events. Do not worry if the pod name suffixes differ from the sample.

   Name each component in your own words, using the tables above, before moving on.

4. **See that the nodes are containers, and which runtime they use.**

   ```bash
   kubectl get nodes -o wide
   docker ps --format 'table {{.Names}}\t{{.Image}}'
   docker exec lab-worker crictl ps
   ```

   Expected: `-o wide` adds `INTERNAL-IP`, `OS-IMAGE`, `KERNEL-VERSION` and a `CONTAINER-RUNTIME` column that reads `containerd://1.x.x`. `docker ps` lists `lab-control-plane`, `lab-worker` and `lab-worker2`, all from a `kindest/node` image. `crictl ps` (run inside the worker) lists the containers that the kubelet started there, such as `kube-proxy` and `kindnet-cni`.
   If you see something else: if `crictl` is not found in your node image, skip that command; `docker exec lab-worker ps aux | grep kubelet` also shows the kubelet running inside the node container.

5. **Read the documentation from the API.**

   ```bash
   kubectl explain deployment.spec.replicas
   kubectl api-resources | head -n 8
   ```

   Expected: `explain` prints `KIND: Deployment`, `VERSION: apps/v1`, the field name with type `<integer>` and a description that says it is the number of desired Pods and that it defaults to 1. `api-resources` prints a table with `NAME`, `SHORTNAMES`, `APIVERSION`, `NAMESPACED` and `KIND` columns, starting with `bindings` and `componentstatuses` (the order can differ).
   If you see something else: the exact text differs between versions. If you get `error: the server doesn't have a resource type`, check the path for a typo; `kubectl explain deployment.spec` lists the valid children.

6. **Apply a Deployment, and compare spec with status.** Create the file, check the diff, apply, then check the diff again.

   ```bash
   cd ~/k8s01
   cat > deployment.yaml <<'EOF'
   apiVersion: apps/v1
   kind: Deployment
   metadata:
     name: hello
   spec:
     replicas: 2
     selector:
       matchLabels:
         app: hello
     template:
       metadata:
         labels:
           app: hello
       spec:
         containers:
           - name: web
             image: nginx:1.27-alpine
             ports:
               - containerPort: 80
   EOF
   kubectl diff -f deployment.yaml; echo "diff-exit=$?"
   kubectl apply -f deployment.yaml --dry-run=server
   kubectl apply -f deployment.yaml
   kubectl rollout status deployment/hello --timeout=120s
   kubectl diff -f deployment.yaml; echo "diff-exit=$?"
   kubectl get deployment hello -o jsonpath='desired={.spec.replicas} ready={.status.readyReplicas}{"\n"}'
   kubectl get pods -o wide
   ```

   Expected: the first `diff` prints a `+` listing of the whole object and `diff-exit=1`. The server dry run prints `deployment.apps/hello created (server dry run)`. The apply prints `deployment.apps/hello created`. `rollout status` ends with `deployment "hello" successfully rolled out`. The second `diff` prints nothing and `diff-exit=0`. The jsonpath line prints `desired=2 ready=2`. The Pods are spread over the two workers (in most runs; the scheduler decides).
   If you see something else: `ImagePullBackOff` means the node cannot pull the image (the tag `nginx:1.27-alpine` is an example and was not checked; use a tag that exists, and check your network). `diff-exit=1` on the second diff usually means the live object has a field the file does not set; read the diff, it names the field.

   Now watch reconciliation. Delete one Pod and look again:

   ```bash
   POD=$(kubectl get pods -l app=hello -o name | head -n 1)
   echo "deleting $POD"
   kubectl delete "$POD" --wait=false
   kubectl get pods -l app=hello
   ```

   Expected: one Pod is `Terminating` or already gone, and a new one is `ContainerCreating` or `Running` with an age of a few seconds. You asked for one fewer Pod, and the ReplicaSet controller created a replacement without being told.
   If you see something else: if no new Pod appears, check `kubectl get replicaset` for the desired count.

7. **Add a second cluster and switch contexts.**

   ```bash
   kind create cluster --name lab2
   kubectl config get-contexts
   kubectl config use-context kind-lab
   kubectl config current-context
   kubectl get nodes --context kind-lab2
   ```

   Expected: creating `lab2` switches the active context to `kind-lab2`. `get-contexts` lists `kind-lab` and `kind-lab2`, with `*` next to the active one. The `use-context` command prints `Switched to context "kind-lab".` The `get nodes --context kind-lab2` command shows a single `lab2-control-plane` node without changing the active context.
   If you see something else: if `get-contexts` shows only one, creation of `lab2` failed or wrote the config elsewhere; check `echo $KUBECONFIG`. If the `*` is on the wrong line, run `kubectl config use-context kind-lab` again.

   Now set a default namespace for the context, check it, and put it back:

   ```bash
   kubectl config set-context --current --namespace=kube-system
   kubectl get pods | head -n 3
   kubectl config set-context --current --namespace=default
   kubectl get pods
   ```

   Expected: `Context "kind-lab" modified.`, then the `kube-system` pods without `-n`, then another `modified` line and the `hello` pods. A default namespace in a context is convenient and also a trap: the same command now means something different. Look at the namespace whenever the output surprises you.
   If you see something else: if `get pods` after the reset says `No resources found in default namespace.`, the Deployment from the previous exercise was created in another namespace or has been deleted.

8. **Stop a kubelet and watch a node become NotReady.**

   ```bash
   docker exec lab-worker systemctl stop kubelet
   for i in $(seq 1 12); do date +%T; kubectl get node lab-worker --no-headers; sleep 10; done
   ```

   Expected: for about a minute the node shows `Ready`, because the control plane has not yet missed enough heartbeats. Then it changes to `NotReady`. Afterwards start the kubelet again and watch it recover:

   ```bash
   docker exec lab-worker systemctl start kubelet
   for i in $(seq 1 6); do kubectl get node lab-worker --no-headers; sleep 5; done
   ```

   Expected: within a few seconds `lab-worker` is `Ready` again.
   If you see something else: the delay depends on the version's node monitor settings. The default grace period was raised in recent releases, so "about a minute" is a guideline, not a promise (verify for your version). If `systemctl` is not found in the node container, use `docker stop lab-worker` and `docker start lab-worker` instead; the effect on the node is similar. If the node never turns `NotReady` after three minutes, check that the stop command succeeded (`docker exec lab-worker systemctl is-active kubelet` should print `inactive`).

   While the node is `NotReady`, notice what did **not** happen: the Pods on it stayed listed as `Running` for a while. Kubernetes waits before it evicts Pods from a node it cannot reach, in case the problem is brief. The delay is configurable (verify the default for your version).

9. **Delete both clusters.**

   ```bash
   kind delete cluster --name lab
   kind delete cluster --name lab2
   kind get clusters
   kubectl config get-contexts
   ```

   Expected: `Deleting cluster "lab" ...` followed by `Deleted nodes: ["lab-control-plane" "lab-worker" "lab-worker2"]`, then the same for `lab2`, then `No kind clusters found.` The kind contexts are gone from `get-contexts`.
   If you see something else: if a cluster cannot be deleted, remove its node containers by hand (`docker rm -f lab-control-plane lab-worker lab-worker2`) and run `kind delete cluster --name lab` again. Delete `~/k8s01` when you no longer need the files, or keep them for the next lesson.

## Common mistakes

- **Treating `kubectl apply` returning as "it works".** It means the object was stored in etcd. Whether anything runs is decided later by the scheduler and the kubelet. Check with `kubectl rollout status` or `get pods`.
- **Running a command against the wrong context.** It deletes or changes the wrong cluster. Check `kubectl config current-context` and put `--context` and `-n` in saved commands.
- **Editing a live object by hand and expecting it to last.** `kubectl edit`, `scale` and `set image` change the cluster but not your file, and the next `apply` of the file reverts them. Change the file.
- **Reading only `get`.** `kubectl get pods` says `Pending` or `CrashLoopBackOff`; the reason is in `kubectl describe` (the Events at the bottom). Always read both.
- **Committing or pasting a kubeconfig.** It holds credentials. Treat it like a private key.
- **Mixing up `spec` and `status`.** You write `spec`; the cluster writes `status`. A file that includes `status` or cluster-set fields such as `resourceVersion` came from `get -o yaml` and needs cleaning before it is a real manifest.
- **Using kind as a model of production.** It has one machine, no cloud load balancer, no cloud storage and no real node failures. Use it to learn, then test on a real cluster.
- **Ignoring versions.** A very old `kubectl` or an API object that no longer exists produces confusing errors. Compare `kubectl version` and read the release notes before upgrading.

## Check your understanding

1. Which component is the only one that talks to etcd, and why does that matter?
2. Does `kubectl` talk to the nodes? What happens when you run `kubectl logs`?
3. What is the difference between `spec` and `status`, and who writes each?
4. After `kubectl apply -f deployment.yaml` prints `created`, the Pods are still `Pending`. Name the steps that remain and which component does each.
5. On GKE, which parts of the cluster does Google run, and what do you still own?
6. You want to know what an `apply` would change in a shared cluster without changing anything. Which two commands help, and what is the difference between them?

> [!question]- Answers
>
> 1. The `kube-apiserver`. Every other component, including the scheduler, the controllers and the kubelets, reads and writes through the API. That gives one place for authentication, authorisation, admission and auditing, and means you protect and back up etcd as a single dependency.
> 2. `kubectl` talks only to the API server. For `logs`, `exec` and `port-forward` the API server forwards the request to the kubelet on the node that runs the Pod, and sends the answer back.
> 3. `spec` is the desired state and you write it. `status` is the observed state and the cluster writes it (controllers and kubelets). A controller works to make `status` match `spec`.
> 4. The scheduler must choose a node and write it into the Pod. The kubelet on that node must then pull the image through the container runtime, create the network through the CNI plugin, start the containers and report the status. If it stays `Pending`, `describe` the Pod and read the scheduler's events.
> 5. Google runs the control plane (API server, etcd, scheduler, controller manager), including its upgrades and availability. In Standard mode you also manage node pools; in Autopilot Google manages the nodes too. You always own your workloads, resource requests, RBAC, network policies, secrets handling, upgrade decisions and cost. Verify the current split in the GKE documentation.
> 6. `kubectl diff -f FILE` shows the difference between the file and the live objects. `kubectl apply -f FILE --dry-run=server` sends the request through authentication, authorisation, admission and validation and reports whether the cluster would accept it, without saving. `diff` shows _what_ would change; the dry run shows _whether it would be accepted_. `--dry-run=client` does neither, because it never contacts the cluster for validation.

## Next steps

Next lesson: [[learn/kubernetes-pods-and-deployments|Kubernetes 02: Pods, labels and Deployments]]. Previous lesson: [[learn/container-storage-networking-and-compose|Containers 04: Volumes, networks and Docker Compose]].

To go deeper:

- [[runbooks/gke-cluster-upgrade]] shows how version skew, node pools and a managed control plane meet in a real upgrade.
- [[patterns/pod-security-admission]] is an example of the admission step in the walk above, enforced for every Pod.
- [[runbooks/kubernetes-pod-troubleshooting]] turns the "where did it stop" list into a triage procedure.
- [[learn/gke-for-beginners|GCP 04: GKE for beginners]] repeats this lesson on a real managed cluster.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- Kubernetes documentation, "Cluster Architecture" and "Kubernetes Components": <https://kubernetes.io/docs/concepts/architecture/> and <https://kubernetes.io/docs/concepts/overview/components/>. Not checked against a running cluster for this page.
- Kubernetes documentation, "Controllers" (the control loop and desired state): <https://kubernetes.io/docs/concepts/architecture/controller/>.
- Kubernetes documentation, "Controlling Access to the Kubernetes API" (authentication, authorisation, admission): <https://kubernetes.io/docs/concepts/security/controlling-access/>.
- Kubernetes documentation, "Organizing Cluster Access Using kubeconfig Files": <https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/>.
- Kubernetes documentation, "Nodes" (heartbeats and node status) and "Version Skew Policy": <https://kubernetes.io/docs/concepts/architecture/nodes/> and <https://kubernetes.io/releases/version-skew-policy/>.
- kubectl reference and "Declarative management of objects" (`apply`, `diff`, `--dry-run`): <https://kubernetes.io/docs/reference/kubectl/>.
- kind documentation, "Quick Start" and "Configuration": <https://kind.sigs.k8s.io/docs/user/quick-start/> and <https://kind.sigs.k8s.io/docs/user/configuration/>.
- GKE documentation, "GKE overview" and the cluster modes (Autopilot and Standard): <https://cloud.google.com/kubernetes-engine/docs/concepts/kubernetes-engine-overview>. The shared-responsibility details were not checked for this page.
- Versions and sample output on this page were not run against a live cluster, so no value on this page is marked as verified.
