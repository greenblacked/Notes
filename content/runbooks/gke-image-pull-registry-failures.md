---
title: Image pull failures from Artifact Registry on GKE
description: "Diagnose registry-side image pull failures on GKE: IAM and node identity, private-cluster egress, rate limits and bad references."
type: runbook
tags:
  - runbooks
  - gke
  - gcp
  - kubernetes
  - supply-chain
  - reliability
created: 2026-10-19
modified: 2026-10-19
draft: false
---

When a Pod is stuck in `ErrImagePull` or `ImagePullBackOff`, the first triage is generic: read the event, check the image name, check pull secrets. That is already covered in [[kubernetes-pod-troubleshooting]]. This runbook starts where that one ends, when the event points at the registry side on GKE: the node cannot authenticate to Artifact Registry, cannot reach it, is rate limited by a public registry, or is asking for a reference that does not exist.

> [!info] Scope and verification
> The commands were not run against a live project when this note was written, and the note is not marked `verified`. Flags, field names and role names come from the `gcloud` command groups as known; run each command with `--help` and compare with the current Artifact Registry and GKE documentation before relying on it.

## When to use

- Section 4 of [[kubernetes-pod-troubleshooting]] showed that the kubelet could not pull, and the event mentions 401, 403, "not found", a timeout or "too many requests".
- Only new nodes or one node pool fail to pull, while old nodes still run the same image.
- A new cluster, a new node pool, a new project or a new registry host was just introduced.
- Pulls from a public registry fail intermittently in a private cluster.

## Preconditions

- Permission to describe the cluster, node pools and the repository (`roles/container.viewer`, `roles/artifactregistry.reader` or equivalent for read), and to change IAM if the fix needs it.
- The failing Pod's namespace, name and the exact image reference from its spec.
- Know whether the cluster has private nodes, and which registries workloads use: Artifact Registry in the same project, in another project, or an external registry reached through a mirror such as Artifactory.

```bash
PROJECT=example-project
LOCATION=europe-west1                  # cluster location (region or zone)
CLUSTER=prod-1
POOL=default-pool
NS=example-app
POD=example-app-7c9f6d5b8-abcde
gcloud config set project "$PROJECT"
```

## Steps

### 1. Classify the error

```bash
kubectl -n "$NS" describe pod "$POD" | sed -n '/Events:/,$p'
kubectl -n "$NS" get pod "$POD" -o jsonpath='{.spec.containers[*].image}{"\n"}{.spec.imagePullSecrets}{"\n"}'
```

| Message contains                                 | Class           | Go to                                        |
| ------------------------------------------------ | --------------- | -------------------------------------------- |
| `401`, `unauthorized`, `authentication required` | Identity        | 3                                            |
| `403`, `permission denied`, `denied`             | Authorisation   | 3                                            |
| `not found`, `manifest unknown`, `name unknown`  | Reference       | 2                                            |
| `i/o timeout`, `dial tcp`, `no route to host`    | Network         | 4                                            |
| `429`, `toomanyrequests`                         | Rate limiting   | 5                                            |
| `x509`, `certificate`                            | TLS to registry | 4, and check any proxy or mirror certificate |

### 2. Check the reference

A large share of "pull failures" are references to images that are not there.

```bash
# Registry host, project, repository, image and tag/digest, exactly as in the Pod spec
REGISTRY=europe-west1-docker.pkg.dev
REPO=apps
IMAGE=example-app
TAG=1.4.2

gcloud artifacts docker images describe "$REGISTRY/$PROJECT/$REPO/$IMAGE:$TAG"
gcloud artifacts docker images list "$REGISTRY/$PROJECT/$REPO/$IMAGE" --include-tags --limit=10
```

Common finds: a typo in the repository path, a tag that CI never pushed, a tag that a cleanup policy deleted, a multi-architecture mismatch (the node is a different architecture than the image), or a reference to a repository in another region or project. Prefer digests (`image@sha256:...`) for production, because tags can move or disappear. A digest that does not exist behaves like a missing tag.

### 3. Identity: the node service account

By default, the kubelet and container runtime pull with the credentials of the **node's service account**, using the node's metadata server access. Workload Identity gives Pods credentials for API calls, but it does not change how image pulls authenticate. Fixing Workload Identity bindings will not fix a pull.

```bash
gcloud container node-pools describe "$POOL" --cluster "$CLUSTER" --location "$LOCATION" \
  --format="value(config.serviceAccount,config.oauthScopes)"
```

Then check that this service account can read the repository:

```bash
NODE_SA=gke-nodes@example-project.iam.gserviceaccount.com     # use the value from the command above

gcloud artifacts repositories get-iam-policy "$REPO" --location "${REGISTRY%%-docker*}" \
  --format="table(bindings.role,bindings.members)"
```

The role to look for is `roles/artifactregistry.reader` on the repository (or a project or folder where that is intended). Grant it at the narrowest scope that works:

```bash
gcloud artifacts repositories add-iam-policy-binding "$REPO" \
  --location "${REGISTRY%%-docker*}" \
  --member "serviceAccount:$NODE_SA" --role roles/artifactregistry.reader
```

Cross-project cases: the repository lives in another project, so the binding must be on that repository or project, for the node service account of the cluster's project. Also check access scopes if your nodes use legacy scopes: the node needs read access to Cloud Storage-backed registries or the cloud-platform scope, per the Artifact Registry GKE integration documentation.

> [!warning] Do not fix this by granting Editor
> Giving the node service account project-level `roles/editor` or `roles/owner` makes the error disappear and gives every container on the node broad access if it reaches the metadata server. Use `roles/artifactregistry.reader` on the repository, and a dedicated node service account instead of the default Compute Engine one.

IAM changes can take a short time to propagate; retry the pull after a minute before changing anything else.

### 4. Network path

Timeouts mean the node cannot reach the registry.

- **Private nodes.** Nodes without external IPs reach Google APIs, including Artifact Registry, only through Private Google Access on the subnet (or Private Service Connect for Google APIs). Check the subnet:

```bash
gcloud compute networks subnets describe "$SUBNET" --region "$REGION" \
  --format="value(privateIpGoogleAccess)"
```

- **External registries.** Reaching Docker Hub or another public registry from private nodes needs Cloud NAT or an egress proxy. See [[private-gke-and-controlled-egress]] for the egress design, and check the NAT's logs for dropped connections.
- **Firewalls and VPC Service Controls.** An egress rule, a proxy or a service perimeter can block the registry. VPC Service Controls blocks are visible in audit logs as a denied request with a violation reason.
- **DNS.** If `*.pkg.dev` or the custom domain does not resolve from the node, pulls time out. Test from a Pod or the node (below) and see [[network-troubleshooting-dns-mtu-tls-load-balancers]].

### 5. Rate limits on public registries

A `429` or "too many requests" from a public registry means the shared egress address of your nodes (often a single NAT address) is being limited. Do not quote or rely on numbers here; they change, so check the registry's current limits documentation.

The durable fix is not to pull from public registries at runtime:

- Mirror the images you depend on through Artifactory (see [[artifactory-outage-cache-fallback]] for what happens when that mirror is down) or an Artifact Registry remote repository, and reference the mirror in manifests.
- Use authenticated pulls from the mirror with a read-only identity.
- Pin by digest and let the mirror's cache serve repeat pulls.

Pull secrets (`imagePullSecrets`) are for **external** registries that require credentials. Do not use a long-lived key to pull from Artifact Registry in the same organisation; the node service account is the preferred path. See [[image-signing-and-admission-verification]] if admission also verifies signatures, because a signature failure can look like a pull failure in some tools.

### 6. Test a pull from the node

Reproduce outside the Pod to separate the registry from Kubernetes. With a debug Pod on the same node, or with SSH access to the node:

```bash
NODE=$(kubectl -n "$NS" get pod "$POD" -o jsonpath='{.spec.nodeName}')
kubectl debug node/"$NODE" -it --image=busybox:1.36 -- chroot /host \
  crictl pull "$REGISTRY/$PROJECT/$REPO/$IMAGE:$TAG"
```

If `crictl` is not on the host path, use the container runtime's own tooling for your node image; check the GKE documentation for the supported way to run it. A successful `crictl pull` means the node is fine and the problem is in the Pod spec (pull secret, reference, image policy); a failing pull gives the registry's real error text.

### 7. Prevent

- Pin images by digest and promote the digest, not the tag, between environments.
- Use one dedicated node service account per environment with only the roles it needs.
- Keep a pull-through mirror for public images and alert on its error rate.
- Monitor image pull errors with a rate alert; see [[observability-signals-and-dashboards]].
- Test new node pools and new clusters with a pull of a known image as part of their creation checklist.

## Validation

```bash
kubectl -n "$NS" delete pod "$POD"                       # let the controller recreate it
kubectl -n "$NS" get pods -w
kubectl -n "$NS" describe pod -l app=example-app | grep -E 'Pulled|Pulling|Failed' | tail
```

- The Pod reaches Running and its events show `Successfully pulled image` with the expected reference.
- A Pod scheduled to a freshly created node also pulls successfully (not only nodes with a warm cache).
- The error alert clears and stays clear through one deploy.

## Rollback

- Remove an IAM binding you added only if the change was wrong, using `remove-iam-policy-binding`. Removing it may break pulls that now depend on it, so check usage first.
- Revert manifest changes (image reference, mirror host) in version control through your normal deploy path.
- Undo network changes (Private Google Access, NAT, firewall rules) through your infrastructure-as-code repository so state stays consistent, rather than editing in the console.

## Troubleshooting

| Symptom                                          | Likely cause and fix                                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 403 on a repository in another project           | Binding is on the wrong project. Bind the node service account on the repository's project.                    |
| Works on old nodes, fails on new nodes           | New pool uses a different service account or scopes. Compare `config.serviceAccount`.                          |
| Works on nodes in zone a, times out in zone b    | Subnet or route difference. Check the subnet's Private Google Access and firewall rules.                       |
| `manifest unknown` right after a CI push         | Replication delay or wrong region. Verify with `images list`, then check the repository location.              |
| Fails only for Docker Hub images                 | Rate limit or NAT address. Mirror the image (step 5).                                                          |
| Pull succeeds on the node, fails in the Pod      | `imagePullSecrets` points to a wrong or missing Secret in that namespace.                                      |
| Image exists but the Pod is rejected, not pulled | An admission policy blocked it. Check the admission message, see [[image-signing-and-admission-verification]]. |

## Related

- [[kubernetes-pod-troubleshooting]] for the first-level triage this note builds on.
- [[private-gke-and-controlled-egress]] for private nodes, NAT and controlled egress.
- [[image-signing-and-admission-verification]] for signing and admission checks on images.
- [[artifactory-outage-cache-fallback]] when the mirror itself is the failing component.
- [[gke-workload-identity]] for Pod identity, which is separate from node pulls.

## Sources

- [Artifact Registry: integrate with GKE](https://cloud.google.com/artifact-registry/docs/integrate-gke)
- [Artifact Registry access control](https://cloud.google.com/artifact-registry/docs/access-control)
- [Private Google Access](https://cloud.google.com/vpc/docs/private-google-access)
- [Kubernetes: images](https://kubernetes.io/docs/concepts/containers/images/)
