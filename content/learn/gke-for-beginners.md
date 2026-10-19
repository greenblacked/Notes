---
title: "GCP 04: GKE for beginners: shared responsibility and from kind to GKE"
description: Learn what Google runs and what you still run in GKE, create an Autopilot cluster, deploy your Helm chart on it, and give a Pod cloud access with no key.
type: guide
tags:
  - learning
  - gke
  - gcp
  - kubernetes
  - security
  - cost
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: middle | Time: about 7 h | You need: [[learn/helm-basics-and-capstone|Kubernetes 06: Helm basics and the capstone]] and [[learn/gcp-vpc-compute-and-cloud-sql|GCP 03: VPC networking, Compute Engine and private Cloud SQL]] | Lab: Lab C, the GCP sandbox project from [[learn/lab-setup|Start 01: Set up your lab]], with the Lab B tools (`kubectl`, `helm`) installed

On your laptop, a kind cluster is yours from top to bottom. You start it, you break it, you delete it, and nobody else cares. A managed cluster is different in one important way: Google runs part of it, and you run the rest. Most real incidents on GKE come from people not knowing where that line is.

This lesson draws the line first, then crosses it. You will create a small GKE Autopilot cluster, point `kubectl` at it, deploy the chart you built in Kubernetes 06, expose something with a real cloud load balancer, and give a Pod access to a storage bucket without a downloaded key. Then you will delete everything.

## What you will learn

- Who is responsible for what on Compute Engine, GKE Standard, GKE Autopilot and Cloud Run, and what always stays with you.
- How Autopilot and Standard differ, how each is billed, and why release channels mean upgrades happen to you.
- What is different between your kind cluster and GKE: real load balancers, storage classes, identity, node provisioning and resource defaults.
- How to create a cluster, get credentials, deploy a Helm chart with a GKE-specific values file, and clean it all up.
- How Workload Identity lets a Pod call Google APIs without a key, and how to prove it works and that it is denied otherwise.
- Which cost traps are specific to GKE.

## The shared responsibility line

"Shared responsibility" means the provider secures and runs the lower layers and you secure what you put on top. The line moves depending on the product. Google also uses the term "shared fate", which describes how it tries to help customers with blueprints and secure defaults. The line matters because anything below it you cannot fix, and anything above it nobody will fix for you.

| Layer                                                   | Compute Engine (VMs)  | GKE Standard                                                                                              | GKE Autopilot               | Cloud Run                      |
| ------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------ |
| Data centres, hardware, hypervisor                      | Google                | Google                                                                                                    | Google                      | Google                         |
| Kubernetes control plane (API server, etcd)             | Not applicable        | Google                                                                                                    | Google                      | Not applicable                 |
| Node operating system and node upgrades                 | **You** patch the OS  | Shared: Google ships images and auto-upgrade, **you** own pool design, sizing and tolerating the upgrades | Google runs the nodes       | Google                         |
| Cluster settings (networking, endpoint access, logging) | **You** (the network) | **You**                                                                                                   | **You**, with fewer options | **You** (few settings)         |
| Your containers, manifests and images                   | **You**               | **You**                                                                                                   | **You**                     | **You** (container and config) |
| Identity and access (IAM, RBAC, Workload Identity)      | **You**               | **You**                                                                                                   | **You**                     | **You**                        |
| Your data and its backups                               | **You**               | **You**                                                                                                   | **You**                     | **You**                        |

The short version of the Kubernetes rows: on Standard, you run the nodes (Google helps); on Autopilot, Google runs the nodes and you run the workloads.

> [!warning] Check before relying on this
> This table is a teaching summary. The exact split (for example, who must act when a node upgrade is blocked by a Pod Disruption Budget, what Google patches automatically and what you must opt into) is set out in Google's "Shared responsibility and shared fate" and GKE documentation, and it changes as features are added. Read the current pages before you write a security or compliance statement about it.

Three things stay with you in every row, and they cause most real problems:

1. **What runs in your containers.** Google does not patch your base image, your libraries or your code.
2. **Who is allowed to do what.** IAM roles, Kubernetes RBAC and service accounts are yours.
3. **Your data and your recovery.** A managed control plane does not back up your application's volumes or databases. See [[architecture/backup-architecture-gke-cloud-sql-gcs]].

## Autopilot or Standard

A GKE **cluster** has a control plane (managed by Google) and **nodes** (VMs that run your Pods). The two operating modes differ in who manages the nodes:

| Question             | Autopilot                                                                                | Standard                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Who manages nodes?   | Google. You do not create node pools. Nodes appear when Pods need them.                  | You create and size node pools, or enable node auto-provisioning.               |
| What do you pay for? | The CPU, memory and storage your Pods **request** while they run (plus the cluster fee). | The node VMs, whether the Pods fill them or not (plus the cluster fee).         |
| Guard rails          | Opinionated: hardened defaults, restrictions on privileged Pods and host access.         | You can change almost anything, including things that weaken security.          |
| Best for             | Most application teams, small platforms, anyone who does not want to run nodes.          | Special hardware, unusual node settings, workloads that need host-level access. |

Billing is why the choice matters. On Standard you pay for an idle node. On Autopilot you pay for the requests of your Pods, so **a Pod with a huge request costs money even if it uses nothing**, and a missing request gets a default. This is the same lesson as [[learn/kubernetes-probes-resources-and-debugging|Kubernetes 05]] and [[patterns/kubernetes-resource-requests-and-limits]], now with a bill attached.

Both modes have a **cluster management fee**. Google has offered a free allowance that covers one cluster per billing account.

> [!warning] Check before relying on this
> The cluster management fee, the free allowance, how Autopilot rounds and defaults resource requests, which Pod features Autopilot restricts, and which networking dataplane it uses are version- and time-dependent and were not verified for this page. Read "Choose a GKE mode of operation", "About GKE Autopilot pricing" and the current GKE pricing page before you plan a budget.

### Release channels: why upgrades happen to you

Kubernetes releases a new minor version about three times a year and supports each only for a limited time. GKE manages this with **release channels**: Rapid, Regular and Stable (and, depending on your version, an Extended channel for longer support; verify). You enrol a cluster in a channel, and Google upgrades the control plane, and the nodes, to the versions it offers on that channel.

What this means for you:

- **Upgrades are not optional.** A version that reaches the end of support is upgraded for you. You decide the timing only within limits: a **maintenance window** says when upgrades may start, and a **maintenance exclusion** blocks them for a period.
- **Your workloads must survive a node being replaced.** Nodes are drained during upgrades. Pods need more than one replica, readiness probes and, where it matters, Pod Disruption Budgets. This is the same discipline as [[patterns/zero-downtime-deployments-kubernetes]].
- **APIs get removed.** A manifest that uses an old API version breaks when the cluster moves to a version without it.
- **Test the new version first.** Run a lower environment on a faster channel than production.

For the step-by-step upgrade procedure, see [[runbooks/gke-cluster-upgrade]].

## From kind to GKE: what is different

You tested your chart on kind. It will mostly work on GKE, and most of what fails fails for the reasons in this table.

| Topic                 | kind on your laptop                                   | GKE                                                                                                                                                   |
| --------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Load balancer         | `type: LoadBalancer` stays `<pending>` without extras | Creates a real, billed cloud load balancer and gives an `EXTERNAL-IP`.                                                                                |
| Storage               | A local-path default class                            | `StorageClass` objects backed by Persistent Disk (and others); a `PersistentVolumeClaim` creates a billed disk. List with `kubectl get storageclass`. |
| Identity to the cloud | None. You mount keys if you want cloud access         | **Workload Identity**: a Kubernetes service account is trusted by IAM, with no key.                                                                   |
| Nodes                 | Containers on your machine, fixed number              | VMs you may not see (Autopilot) that appear and disappear with load.                                                                                  |
| Resource defaults     | Whatever you wrote                                    | Autopilot applies default and minimum requests, and may adjust yours.                                                                                 |
| Images                | `kind load docker-image`                              | The cluster pulls from a registry (Artifact Registry). It needs permission to read it.                                                                |
| Network policy        | Needs a plugin                                        | Available; check that it is enforced on your cluster. See [[patterns/kubernetes-network-policies]].                                                   |
| Security defaults     | Permissive                                            | Hardened on Autopilot; Pod Security admission can enforce. See [[patterns/pod-security-admission]].                                                   |
| Cost                  | Free                                                  | Everything above is billed while it exists.                                                                                                           |

> [!warning] Check before relying on this
> The storage class names and defaults, the Autopilot resource rules and the load balancer annotations are specific to GKE versions. Read what your cluster has (`kubectl get storageclass`, `kubectl describe` on a Pod) and the GKE documentation for your version.

### Workload Identity

A Pod that needs a Google API (Cloud Storage, Secret Manager, Pub/Sub) must prove who it is. The old way was to create a service account **key** (a JSON file), put it in a Kubernetes Secret and mount it. That key is a long-lived password: it can be copied, leaked in a repository or a log, and it does not expire unless you rotate it. See [[learn/gcp-iam-and-service-accounts|GCP 02]] for why you should avoid keys.

**Workload Identity** replaces the key. Your cluster gets a "workload identity pool" and GKE runs a metadata server on every node. When a Pod asks for credentials, GKE issues a short-lived token that represents the Pod's **Kubernetes service account (KSA)**. In IAM you grant a role directly to that identity, or let the KSA impersonate a Google service account.

The identity of a KSA in IAM is written like this (the parts in capitals are yours):

```text
principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/PROJECT_ID.svc.id.goog/subject/ns/NAMESPACE/sa/KSA_NAME
```

Note that the identity includes the **namespace**. A service account named `app` in `team-a` and one named `app` in `team-b` are different identities. Autopilot clusters have Workload Identity on; Standard clusters need it enabled when you create them or later (verify the flag for your version). For the full design, see [[patterns/gke-workload-identity]].

> [!warning] Check before relying on this
> The principal format above, whether a given Google service accepts the Kubernetes service account directly (rather than through a Google service account), and the settings that enable Workload Identity on Standard clusters are from the author's reading and were not checked against a live cluster. Verify them in "Authenticate to Google Cloud APIs from GKE workloads" before you use them for anything real.

## Cost traps specific to GKE

- **One `LoadBalancer` Service per app.** Each creates a billed load balancer with its own address. Use one shared Gateway or Ingress for HTTP, and `ClusterIP` for everything internal ([[learn/kubernetes-services-and-ingress|Kubernetes 03]]).
- **Log and metric ingestion.** A chatty application writing megabytes of logs per minute can cost more than the compute that runs it. Cluster logging is on by default, and you pay for what is ingested beyond the free allowance (verify). Lower log volume at the source.
- **Idle node pools (Standard).** Nodes cost money when nothing runs on them. Turn on the cluster autoscaler and scale lab pools to zero where you can.
- **Over-requested Pods (Autopilot).** You pay for requests, not for use.
- **Orphaned volumes.** Deleting a cluster does not always delete the disks behind its claims. Check `gcloud compute disks list` after cleanup.
- **Leftover load balancer rules.** A deleted cluster that still had `LoadBalancer` Services can leave forwarding rules behind if cleanup is interrupted. Check `gcloud compute forwarding-rules list`.
- **Forgotten clusters.** The fee and the workloads keep billing while the cluster exists. Label every lab cluster with an owner, and check the list before you finish for the day.

See [[architecture/finops-cost-allocation-and-guardrails]] for how teams track this.

## Hands-on exercises

> [!warning] Costs money
> These exercises create a GKE cluster, a Cloud Storage bucket, and, for a few minutes, a cloud load balancer. A GKE cluster bills while it exists, even with nothing running on it (the management fee, unless a free allowance covers it) and bills more while Pods run. Do the exercises in one sitting. Cleanup: exercise 8 deletes everything; the most important line is `gcloud container clusters delete lab-gke --location="$REGION" --quiet`. If you lose track, `gcloud projects delete "$LAB_PROJECT_ID"` removes the whole sandbox.

All output below is illustrative: names, versions, addresses and ages will differ on your machine. The `gcloud` flags were compared with the help text of Google Cloud SDK 570.0.0 only; they were not run against a live project for this page. Run each command with `--help` if it fails.

1. **Set the variables and prepare a network with room for Pods and Services.** A VPC-native cluster takes its Pod and Service addresses from named secondary ranges of its subnet. If you deleted `lab-vpc` at the end of GCP 03, the first command recreates it.

   ```bash
   export LAB_PROJECT_ID="lab-yourname-123456"   # Change: the id of your sandbox project from Start 01.
   export REGION="europe-west1"                  # Change if you prefer a region near you.
   export MY_IP="203.0.113.10"                   # Change: your public IP; used to limit the test load balancer.

   gcloud config set project "$LAB_PROJECT_ID"
   gcloud services enable container.googleapis.com compute.googleapis.com artifactregistry.googleapis.com

   gcloud compute networks describe lab-vpc >/dev/null 2>&1 || gcloud compute networks create lab-vpc --subnet-mode=custom

   gcloud compute networks subnets create lab-gke-subnet \
     --network=lab-vpc --region="$REGION" \
     --range=10.20.0.0/22 \
     --secondary-range=pods=10.64.0.0/16,services=10.96.0.0/22 \
     --enable-private-ip-google-access

   gcloud compute networks subnets describe lab-gke-subnet --region="$REGION" --format="yaml(ipCidrRange,secondaryIpRanges)"
   ```

   Expected, illustrative:

   ```text
   ipCidrRange: 10.20.0.0/22
   secondaryIpRanges:
   - ipCidrRange: 10.64.0.0/16
     rangeName: pods
   - ipCidrRange: 10.96.0.0/22
     rangeName: services
   ```

   If you see something else: an overlap error means another subnet in `lab-vpc` uses one of these ranges; choose different blocks from the private ranges and use them everywhere below. `API ... has not been used` means the `services enable` step has not finished; wait a minute.

2. **Create an Autopilot cluster.** This takes several minutes. The cluster is regional (a `--location` that is a region) which is the Autopilot norm.

   ```bash
   gcloud container clusters create-auto lab-gke \
     --location="$REGION" \
     --release-channel=regular \
     --network=lab-vpc \
     --subnetwork=lab-gke-subnet \
     --cluster-secondary-range-name=pods \
     --services-secondary-range-name=services \
     --labels=env=lab,owner=yourname

   gcloud container clusters list
   ```

   Expected, illustrative:

   ```text
   NAME     LOCATION      MASTER_VERSION      MASTER_IP     MACHINE_TYPE  NODE_VERSION        NUM_NODES  STATUS
   lab-gke  europe-west1  1.xx.x-gke.xxxxxxx  203.0.113.20  ek-standard-8 1.xx.x-gke.xxxxxxx  0          RUNNING
   ```

   Your versions, addresses and machine type column will differ. `NUM_NODES` may be 0 or small, because Autopilot creates nodes when Pods need them.
   If you see something else: `STATUS` of `PROVISIONING` means wait. An error that the secondary range is not found means the name does not match exercise 1 (`pods` and `services`). `Insufficient regional quota` means your project's quota is too small; try another region or ask for a quota increase. Check for flags that changed with `gcloud container clusters create-auto --help`.

   > [!tip] Limit who can reach the API server
   >
   > By default a GKE control plane has a public endpoint that is protected by authentication, but reachable from the internet. For anything beyond a lab, restrict it with `--enable-master-authorized-networks --master-authorized-networks=YOUR_CIDR`, or use private nodes with a private endpoint. If you do this in the lab, use a correct range, or you lock yourself out of your own cluster. See [[architecture/private-gke-and-controlled-egress]].

3. **Get credentials and look at the nodes.** `kubectl` needs a plugin to authenticate to GKE; `gcloud` tells you if it is missing.

   ```bash
   gcloud container clusters get-credentials lab-gke --location="$REGION"
   kubectl config current-context
   kubectl get nodes
   kubectl get ns
   ```

   Expected, illustrative:

   ```text
   Fetching cluster endpoint and auth data.
   kubeconfig entry generated for lab-gke.
   gke_lab-yourname-123456_europe-west1_lab-gke
   No resources found
   NAME              STATUS   AGE
   default           Active   5m
   kube-node-lease   Active   5m
   kube-public       Active   5m
   kube-system       Active   5m
   ```

   `No resources found` for nodes is normal on a fresh Autopilot cluster. If you do see nodes, their names look like `gk3-lab-gke-pool-...` (illustrative) and the status is `Ready`. The set of namespaces varies with version, and Autopilot may add system namespaces of its own.
   If you see something else: `gke-gcloud-auth-plugin` not found means install it (`gcloud components install gke-gcloud-auth-plugin`, or your operating system's package for it; check the current instructions) and run `get-credentials` again. A timeout talking to the cluster means your network cannot reach the endpoint (for example, authorised networks that exclude you).

4. **Deploy the capstone chart with a GKE values file.** Use the chart you built in [[learn/helm-basics-and-capstone|Kubernetes 06]]. First, push its image where GKE can pull it. Then write a values file that overrides only what differs from kind.

   ```bash
   export CHART_DIR="$HOME/lab/capstone"   # Change: the folder that holds your capstone chart (Chart.yaml).
   export REPO="lab-images"
   export IMAGE_NAME="capstone"            # Change: your image name.
   export IMAGE_TAG="0.1.0"                # Change: the tag you pushed. Never use "latest".

   gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1 \
     || gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION"
   gcloud auth configure-docker "${REGION}-docker.pkg.dev"
   # Tag and push the image you built in Containers 03 / Kubernetes 06:
   docker tag "${IMAGE_NAME}:${IMAGE_TAG}" "${REGION}-docker.pkg.dev/${LAB_PROJECT_ID}/${REPO}/${IMAGE_NAME}:${IMAGE_TAG}"
   docker push "${REGION}-docker.pkg.dev/${LAB_PROJECT_ID}/${REPO}/${IMAGE_NAME}:${IMAGE_TAG}"
   ```

   ```yaml title="values-gke.yaml"
   # Overrides for GKE. Every key below must exist in YOUR chart's values.yaml:
   # compare with "helm show values $CHART_DIR" and rename keys that differ.
   replicaCount: 2 # two replicas so a node replacement does not take the app down

   image:
     # Change: your project id, region, repository, image name.
     repository: europe-west1-docker.pkg.dev/lab-yourname-123456/lab-images/capstone
     tag: "0.1.0" # Change: the tag you pushed.
     pullPolicy: IfNotPresent

   service:
     type: ClusterIP # internal only; exposing it is exercise 5

   ingress:
     enabled: false # no shared entry point in this lab

   resources:
     # Autopilot bills for requests, so set them deliberately.
     requests:
       cpu: 100m
       memory: 128Mi
     limits:
       memory: 128Mi
   ```

   ```bash
   kubectl create namespace lab
   helm upgrade --install capstone "$CHART_DIR" \
     --namespace lab \
     --values values-gke.yaml \
     --atomic --timeout 8m

   kubectl get pods -n lab
   ```

   Expected, illustrative. The first install can take a few minutes, because Autopilot has to create a node for the Pods:

   ```text
   Release "capstone" does not exist. Installing it now.
   NAME: capstone
   LAST DEPLOYED: Sat Oct 17 10:05:41 2026
   NAMESPACE: lab
   STATUS: deployed
   REVISION: 1

   NAME                        READY   STATUS    RESTARTS   AGE
   capstone-6d8f7c9b5d-4kq2x   1/1     Running   0          2m
   capstone-6d8f7c9b5d-h7w9p   1/1     Running   0          2m
   ```

   If you see something else: `ImagePullBackOff` or `ErrImagePull` with a 403 or "not found" in `kubectl describe pod` means the nodes cannot read the repository. Check the image path and tag, and that the node service account may read Artifact Registry in this project (grant `roles/artifactregistry.reader` to the account the node uses; check which one in the cluster details). Pods `Pending` for several minutes, with an event such as `Insufficient cpu`, usually means a node is being added; wait, then read `kubectl describe pod`. A Helm error `unknown field` or `<nil>` means a key in `values-gke.yaml` does not exist in your chart; fix the key names. `--atomic` rolls the release back on failure, so `helm list -n lab` may show nothing. `exec format error` in the Pod logs means the image was built for another CPU architecture (for example on an ARM laptop); rebuild with `docker buildx build --platform linux/amd64`.

5. **Expose a Pod with a real load balancer, then remove it.** Use a throwaway Deployment so that your chart stays internal. The Service limits who can connect with `loadBalancerSourceRanges`.

   ```yaml title="lb-test.yaml"
   apiVersion: apps/v1
   kind: Deployment
   metadata:
     name: lb-test
     namespace: lab
   spec:
     replicas: 1
     selector:
       matchLabels:
         app: lb-test
     template:
       metadata:
         labels:
           app: lb-test
       spec:
         containers:
           - name: web
             # Example image: an nginx build that runs as a non-root user and listens on 8080.
             # Check the tag exists and pin the one you use.
             image: nginxinc/nginx-unprivileged:1.27-alpine
             ports:
               - name: http
                 containerPort: 8080
             resources:
               requests:
                 cpu: 50m
                 memory: 64Mi
               limits:
                 memory: 64Mi
             securityContext:
               runAsNonRoot: true
               runAsUser: 101
               allowPrivilegeEscalation: false
               capabilities:
                 drop: ["ALL"]
               seccompProfile:
                 type: RuntimeDefault
   ---
   apiVersion: v1
   kind: Service
   metadata:
     name: lb-test
     namespace: lab
   spec:
     type: LoadBalancer
     selector:
       app: lb-test
     loadBalancerSourceRanges:
       - 203.0.113.10/32 # Change: your public IP. Only this address may connect.
     ports:
       - name: http
         port: 80
         targetPort: http
   ```

   ```bash
   sed -i "s|203.0.113.10/32|${MY_IP}/32|" lb-test.yaml   # GNU sed; on macOS use sed -i ''
   kubectl apply -f lb-test.yaml
   kubectl get svc lb-test -n lab --watch
   ```

   Press Ctrl-C when the address appears. Expected, illustrative:

   ```text
   NAME      TYPE           CLUSTER-IP     EXTERNAL-IP   PORT(S)        AGE
   lb-test   LoadBalancer   10.96.0.123    <pending>     80:30123/TCP   5s
   lb-test   LoadBalancer   10.96.0.123    198.51.100.7  80:30123/TCP   58s
   ```

   Test it from the machine whose address you put in the source range, and then delete everything you created here:

   ```bash
   EXTERNAL_IP="$(kubectl get svc lb-test -n lab -o jsonpath='{.status.loadBalancer.ingress[0].ip}')"
   curl -sI "http://${EXTERNAL_IP}/" | head -n 1

   kubectl delete -f lb-test.yaml
   gcloud compute forwarding-rules list
   ```

   Expected: `HTTP/1.1 200 OK`; after the delete, the forwarding-rules list shows no rule for it (it can take a minute to disappear).
   If you see something else: `<pending>` for more than a few minutes means the load balancer could not be created; read `kubectl describe svc lb-test -n lab` for events (a quota, or a firewall or permission problem). A hanging `curl` means your real address is not in the source range. If a forwarding rule remains after a few minutes, delete the Service again and check `gcloud compute forwarding-rules list` before you finish the lab.

6. **Prove Workload Identity: read a bucket with no key.** Create a bucket and an object, a Kubernetes service account, and grant that identity read access on that one bucket. Then run a Pod that lists it.

   ```bash
   export BUCKET="${LAB_PROJECT_ID}-wi-lab"
   export PROJECT_NUMBER="$(gcloud projects describe "$LAB_PROJECT_ID" --format='value(projectNumber)')"

   gcloud storage buckets create "gs://${BUCKET}" --location="$REGION" \
     --uniform-bucket-level-access --public-access-prevention
   echo "hello from workload identity" | gcloud storage cp - "gs://${BUCKET}/hello.txt"

   kubectl create serviceaccount wi-reader -n lab

   gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
     --role=roles/storage.objectViewer \
     --member="principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${LAB_PROJECT_ID}.svc.id.goog/subject/ns/lab/sa/wi-reader"
   ```

   The Pod below uses `wi-reader`. It mounts no key. The `emptyDir` gives the CLI a writable home directory.

   ```yaml title="wi-test.yaml"
   apiVersion: v1
   kind: Pod
   metadata:
     name: wi-test
     namespace: lab
   spec:
     serviceAccountName: wi-reader
     restartPolicy: Never
     securityContext:
       runAsNonRoot: true
       runAsUser: 1000
       seccompProfile:
         type: RuntimeDefault
     containers:
       - name: gcloud
         # Example image: the Google Cloud CLI image. Check the tag exists and pin the one you use.
         image: gcr.io/google.com/cloudsdktool/google-cloud-cli:stable
         command: ["gcloud", "storage", "ls", "gs://$(BUCKET)"]
         env:
           - name: BUCKET
             value: "REPLACE_WITH_BUCKET_NAME" # Change: the value of $BUCKET above.
           - name: HOME
             value: /tmp
         resources:
           requests:
             cpu: 100m
             memory: 256Mi
           limits:
             memory: 256Mi
         securityContext:
           allowPrivilegeEscalation: false
           capabilities:
             drop: ["ALL"]
         volumeMounts:
           - name: tmp
             mountPath: /tmp
     volumes:
       - name: tmp
         emptyDir: {}
   ```

   ```bash
   sed -i "s|REPLACE_WITH_BUCKET_NAME|${BUCKET}|" wi-test.yaml
   kubectl apply -f wi-test.yaml
   kubectl wait --for=jsonpath='{.status.phase}'=Succeeded pod/wi-test -n lab --timeout=300s
   kubectl logs wi-test -n lab
   kubectl get pod wi-test -n lab -o jsonpath='{.spec.volumes[*].name}{"\n"}'
   ```

   Expected, illustrative:

   ```text
   pod/wi-test condition met
   gs://lab-yourname-123456-wi-lab/hello.txt
   tmp kube-api-access-xxxxx
   ```

   The last line lists the volumes: only a service-account token volume and `tmp`, and no Secret with a key file.
   If you see something else: a `403` in the logs means the binding does not match the namespace or the service account name exactly, or it has not propagated (wait a minute; IAM changes can take time). If the Pod cannot start the image, the tag may have moved or been removed; check the image page. If `gcloud` says it has no credentials, the cluster may not have Workload Identity on (Autopilot has it on; on Standard, check the cluster's workload pool).

   Now show that the same Pod with a different identity is denied. This proves it is the identity that grants access, not the network:

   ```bash
   sed -e 's/name: wi-test/name: wi-denied/' -e 's/serviceAccountName: wi-reader/serviceAccountName: default/' wi-test.yaml | kubectl apply -f -
   kubectl wait --for=jsonpath='{.status.phase}'=Failed pod/wi-denied -n lab --timeout=300s
   kubectl logs wi-denied -n lab | head -n 5
   ```

   Expected, illustrative:

   ```text
   pod/wi-denied condition met
   ERROR: (gcloud.storage.ls) HTTPError 403: ...@... does not have storage.objects.list access to the Google Cloud Storage bucket. Permission 'storage.objects.list' denied on resource (or it may not exist).
   ```

   If you see something else: if it succeeds, the `default` service account in `lab` also has access (someone granted it a role), which is a finding. If it never finishes, read `kubectl describe pod wi-denied -n lab`.

7. **Look at the cost traps in your project.** Before you delete the cluster, see what GKE created.

   ```bash
   gcloud compute forwarding-rules list
   gcloud compute disks list
   gcloud compute addresses list
   kubectl get pvc -A
   ```

   Expected: the forwarding rules, disks and addresses are empty (you made no load balancer, volume or static address that still exists), and there are no claims. Autopilot nodes' boot disks may not appear in your list. If anything is listed, find out what created it before you delete the cluster.
   If you see something else: a forwarding rule you do not recognise often belongs to a `LoadBalancer` Service; find it with `kubectl get svc -A`.

8. **Delete everything.** Remove the Helm release and the namespace first, so nothing in the cluster owns a cloud resource, then the cluster, then the rest.

   ```bash
   helm uninstall capstone -n lab
   kubectl delete namespace lab

   gcloud container clusters delete lab-gke --location="$REGION" --quiet
   gcloud storage rm --recursive "gs://${BUCKET}"
   gcloud artifacts repositories delete "$REPO" --location="$REGION" --quiet
   gcloud compute networks subnets delete lab-gke-subnet --region="$REGION" --quiet

   gcloud container clusters list
   gcloud compute disks list
   gcloud compute forwarding-rules list
   ```

   Expected: the three final lists print `Listed 0 items.` (or nothing). Keep `lab-vpc` only if you will use it again soon; otherwise delete it as in GCP 03.
   If you see something else: if the cluster delete fails, read the error, which usually names a resource that is in use. If the subnet delete fails because "it is being used", the cluster is still deleting: wait and retry. Remaining disks or forwarding rules are your orphans: delete them by name.

## Common mistakes

- **Assuming Google patches your application.** Why it bites: a managed control plane and managed nodes do nothing for your base image or libraries. Fix: scan and rebuild images ([[patterns/dockerfile-hardening]]) and track updates.
- **Mounting a service account key instead of using Workload Identity.** Why it bites: the key is a long-lived password that spreads through backups, logs and laptops. Fix: grant IAM to the Kubernetes service account identity, and keep keys out of the project (organisation policy can forbid creating them).
- **Granting a project-wide role to a Pod's identity.** Why it bites: a compromised Pod gets everything the role allows. Fix: grant the narrowest role on the narrowest resource (one bucket, as in exercise 6).
- **One `LoadBalancer` per app.** Why it bites: each is a billed load balancer with a public address. Fix: a shared Gateway or Ingress, and `ClusterIP` inside.
- **Forgetting that upgrades happen to you.** Why it bites: nodes are drained on Google's schedule, and a single-replica app with no Pod Disruption Budget goes down. Fix: run at least two replicas, add probes, and set maintenance windows ([[runbooks/gke-cluster-upgrade]]).
- **Not setting resource requests on Autopilot.** Why it bites: you pay for defaults that may not fit, and Pods can be evicted or slow. Fix: set requests deliberately, and watch real usage.
- **A public API endpoint with no authorised networks.** Why it bites: the control plane is reachable from anywhere, so a stolen credential works from anywhere. Fix: authorised networks, or a private endpoint.
- **Deleting a cluster and assuming everything is gone.** Why it bites: disks, load balancer rules, buckets and registries can remain and bill. Fix: delete Services and claims first, then list leftovers in exercise 8 and 7.
- **Letting Pods run as root with wide capabilities because kind allowed it.** Why it bites: Autopilot or Pod Security admission rejects the Pod, or worse, accepts it. Fix: keep the security context from the exercises ([[patterns/pod-security-admission]]).

## Check your understanding

1. Who patches the nodes of an Autopilot cluster, and who patches the nodes of a Standard cluster?
2. Why use Workload Identity instead of a service account key?
3. Your cluster has a managed control plane. Name three things that still belong to you.
4. How does the way Autopilot bills differ from Standard, and what does that change about how you write resource requests?
5. A Pod's logs show `403` when it reads a bucket, though you granted the role to a service account called `wi-reader`. Give two likely causes.
6. A team creates a `LoadBalancer` Service for each of its 12 internal services. What goes wrong, and what is the fix?

> [!question]- Answers
>
> 1. On Autopilot Google runs the nodes, including OS and version upgrades, according to the release channel. On Standard, Google provides node images and auto-upgrade, but you own the node pool configuration, sizing and keeping workloads able to survive the upgrades (verify the details in the shared responsibility documentation).
> 2. Because the key is a long-lived secret that can leak and must be rotated, while Workload Identity issues short-lived tokens tied to a Pod's Kubernetes service account, with nothing to store. Access is controlled in IAM and can be removed in one place.
> 3. Any three of: the container images and the code and libraries inside them; IAM roles, RBAC and service accounts; the manifests and their security settings; the application's data and backups; the network exposure you create (Services, ingress); the cost.
> 4. Autopilot bills for the resources your Pods request while they run (plus the cluster fee); Standard bills for the node VMs whether or not Pods fill them. On Autopilot every request is a cost, so right-size requests from measured usage. On Standard you also want to pack nodes well, because empty capacity is paid for.
> 5. The IAM member must match the namespace and name exactly (a service account `wi-reader` in the wrong namespace is a different identity), and the Pod might not be using that service account (`serviceAccountName`). Other causes: the binding has not propagated yet, or it was granted on the wrong bucket or resource.
> 6. Twelve billed load balancers, twelve public addresses and twelve firewall surfaces, which costs money and widens the attack surface. Use `ClusterIP` for internal services and one shared Gateway or Ingress for HTTP traffic, with authentication where needed.

## Next steps

Next lesson: [[learn/ci-cd-concepts-and-branching|Delivery 01: CI and CD from the ground up, with branching strategies]]. Previous lesson: [[learn/gcp-vpc-compute-and-cloud-sql|GCP 03: VPC networking, Compute Engine and private Cloud SQL]].

To go deeper:

- [[patterns/gke-workload-identity]] is the full design for identity from Pods to Google APIs, including federation for CI.
- [[runbooks/gke-cluster-upgrade]] is the procedure for upgrades, including what to check before and after.
- [[patterns/pod-security-admission]] shows how to enforce Pod security settings in a cluster.
- [[architecture/gke-platform-topology-and-tenancy]] and [[architecture/private-gke-and-controlled-egress]] show how teams lay out clusters and lock down access.
- [[patterns/kubernetes-resource-requests-and-limits]] and [[patterns/zero-downtime-deployments-kubernetes]] for requests and safe rollouts on a managed cluster.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

Not checked against a live project or cluster for this page. The `gcloud` flags were compared only with the help text of Google Cloud SDK 570.0.0. Check each page for the version you use.

- Google Cloud documentation, "Shared responsibility and shared fate on Google Cloud" (https://cloud.google.com/architecture/framework/security/shared-responsibility-shared-fate).
- Google Kubernetes Engine documentation, "Choose a GKE mode of operation" and "Autopilot overview" (https://cloud.google.com/kubernetes-engine/docs/concepts/choose-cluster-mode). Not verified: Autopilot restrictions and resource defaults.
- Google Kubernetes Engine documentation, "GKE pricing" (https://cloud.google.com/kubernetes-engine/pricing) and "About GKE Autopilot pricing". Not verified: the management fee and the free allowance.
- Google Kubernetes Engine documentation, "About release channels" and "Maintenance windows and exclusions" (https://cloud.google.com/kubernetes-engine/docs/concepts/release-channels). Not verified: the channel list.
- Google Kubernetes Engine documentation, "Authenticate to Google Cloud APIs from GKE workloads" (Workload Identity Federation for GKE) (https://cloud.google.com/kubernetes-engine/docs/concepts/workload-identity). Not verified: the principal format and which services accept it directly.
- Google Kubernetes Engine documentation, "Configure cluster access for kubectl" and "Install kubectl and configure cluster access" (https://cloud.google.com/kubernetes-engine/docs/how-to/cluster-access-for-kubectl), including the `gke-gcloud-auth-plugin`.
- Google Kubernetes Engine documentation, "LoadBalancer Service concepts" (https://cloud.google.com/kubernetes-engine/docs/concepts/service-load-balancer).
- Google Kubernetes Engine documentation, "About VPC-native clusters" and "Harden your cluster's security", including control plane access (https://cloud.google.com/kubernetes-engine/docs/how-to/hardening-your-cluster).
- Google Cloud documentation, "Artifact Registry: Configure authentication to Docker" (https://cloud.google.com/artifact-registry/docs/docker/authentication).
- Kubernetes documentation, "Service" and "Version skew policy" (https://kubernetes.io/docs/concepts/services-networking/service/).
