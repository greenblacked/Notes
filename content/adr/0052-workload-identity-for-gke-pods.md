---
title: Pods reach Google APIs only through Workload Identity Federation for GKE
description: Pods get short-lived Google credentials from Workload Identity Federation for GKE, never from key files, and nodes run as a dedicated minimal service account.
type: adr
tags:
  - adr
  - gke
  - gcp
  - kubernetes
  - security
status: accepted
created: 2026-10-21
modified: 2026-10-21
decided: 2026-10-21
draft: false
aliases:
  - ADR-0052
---

## Context

[[0026-keyless-ci-auth-with-workload-identity-federation|ADR-0026]] removed service account keys from CI. It says nothing about the workloads that CI deploys. [[0030-terraform-manages-gcp-infrastructure|ADR-0030]] and [[0036-secret-manager-as-secrets-system-of-record|ADR-0036]] both assume that Pods authenticate with Workload Identity, but no record decides it, so three older patterns survive in the clusters:

- **Keys in Kubernetes Secrets.** A JSON service account key is mounted into the Pod and pointed to with `GOOGLE_APPLICATION_CREDENTIALS`. The key does not expire by default, it is readable by anyone with `get secrets` in the namespace, it ends up in backups and in `kubectl get -o yaml` output, and it works from anywhere once copied. [[service-account-key-expiry-recovery]] exists because of this pattern.
- **The node's identity for everything.** Without Workload Identity Federation, a Pod that calls the metadata server gets the **node's** service account. Every Pod on the node, from every team, shares one identity, so the audit log cannot say which workload made a call and least privilege is impossible.
- **The Compute Engine default service account on nodes.** It is what nodes use when no service account is set. In older projects it was granted Editor automatically, so a compromised container could change most of the project.

Workload Identity Federation for GKE replaces all three. The cluster gets a workload identity pool (`PROJECT_ID.svc.id.goog`), the GKE metadata server on each node intercepts metadata requests from Pods, and each Kubernetes ServiceAccount (KSA) gets its own federated identity with short-lived tokens. The mechanics are in [[gke-workload-identity]]; this record makes it mandatory and fixes the identity design around it.

## Decision

**Every Pod that calls a Google API authenticates through Workload Identity Federation for GKE. Service account keys are not created, not stored in Secrets and not mounted. Nodes run as a dedicated minimal service account, never as the Compute Engine default service account.**

### Workload identities

- **One KSA per workload** that needs Google access, in the workload's own namespace ([[0019-namespace-per-team-tenancy]]). Workloads never share a KSA, and nothing that calls Google APIs runs as the namespace's `default` KSA.
- **Direct principal grants are the default.** IAM roles are granted to the KSA's federated principal (`principal://...`), on the narrowest resource that works (a bucket, a secret, a topic), not on the project. There is no Google service account and no annotation. Google's documentation calls this the preferred method.
- **A linked Google service account only where an API requires it.** Some products do not accept federated principals, or accept them with limits (Google keeps a per-product list of identity federation limitations; for example federated identities cannot sign Cloud Storage URLs). In those cases the workload gets **one Google service account (GSA) of its own**, the KSA is bound to it with `roles/iam.workloadIdentityUser`, and the KSA carries the `iam.gke.io/gcp-service-account` annotation. A GSA is never shared between workloads or namespaces.
- **Secrets come from Secret Manager** through the workload's own identity ([[0036-secret-manager-as-secrets-system-of-record]]), not from a key that unlocks a key.
- **No `hostNetwork: true`** for workloads that call Google APIs: those Pods bypass the GKE metadata server and reach the node's identity. Admission policy ([[0022-admission-policy-pod-security-vap-and-kyverno]]) already restricts host networking; exceptions are platform agents with a recorded reason.

### Clusters and nodes

- **Standard clusters** have a workload pool set at creation and every node pool runs with `GKE_METADATA`. **Autopilot clusters** ([[0018-gke-autopilot-for-new-clusters]]) have Workload Identity Federation enabled always; there is nothing to switch on.
- **One node service account per cluster**, created by Terraform in the cluster's project, holding only what nodes need: `roles/container.defaultNodeServiceAccount` on the project (the role Google's node service account page names as the minimum, covering logging and monitoring), plus `roles/artifactregistry.reader` on the registry project when nodes pull private images from Artifact Registry. Nothing else. In particular, never Compute Instance Admin or any role with `compute.instances.get` on the node identity.
- Node pools use the `cloud-platform` OAuth scope and IAM decides access, which is the provider's documented recommendation for custom node service accounts. Scopes are not used as a security boundary.

### Guardrails

Organization policies, set on the environment folders ([[0024-gcp-folders-by-policy-boundary]]):

| Constraint                                                                                                    | Effect                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `iam.managed.disableServiceAccountKeyCreation` (or the legacy boolean `iam.disableServiceAccountKeyCreation`) | No new service account keys.                                              |
| `iam.disableServiceAccountKeyUpload`                                                                          | No uploaded external keys either.                                         |
| `iam.automaticIamGrantsForDefaultServiceAccounts`                                                             | Default service accounts in new projects do not get Editor automatically. |
| `container.managed.disallowDefaultComputeServiceAccount`                                                      | New clusters and node pools must name a custom node service account.      |
| `container.managed.enableWorkloadIdentityFederation`                                                          | Clusters must have Workload Identity Federation enabled.                  |

Exceptions follow [[policy-exception-and-waiver-process]]: named service account, reason, owner and expiry.

### Terraform shape

The node identity and the cluster settings, for a Standard cluster:

```hcl title="gke-identity.tf"
variable "project_id" {
  type        = string
  description = "Project that holds the cluster, for example app-prod."
}

variable "registry_project_id" {
  type        = string
  description = "Project that holds the Artifact Registry repositories the nodes pull from."
}

variable "region" {
  type    = string
  default = "europe-west1"
}

resource "google_service_account" "gke_nodes" {
  project      = var.project_id
  account_id   = "gke-nodes-apps"
  display_name = "GKE nodes, apps cluster (minimal)"
}

resource "google_project_iam_member" "gke_nodes_default" {
  project = var.project_id
  role    = "roles/container.defaultNodeServiceAccount"
  member  = "serviceAccount:${google_service_account.gke_nodes.email}"
}

resource "google_project_iam_member" "gke_nodes_pull" {
  project = var.registry_project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.gke_nodes.email}"
}

resource "google_container_cluster" "apps" {
  project  = var.project_id
  name     = "apps-prod-01"
  location = var.region

  remove_default_node_pool = true
  initial_node_count       = 1

  # The default pool is created (then removed) from this block; without it the
  # pool runs as the Compute Engine default SA and the org policy denies it.
  node_config {
    service_account = google_service_account.gke_nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }
}

resource "google_container_node_pool" "general" {
  project  = var.project_id
  name     = "general"
  cluster  = google_container_cluster.apps.id
  location = var.region

  node_config {
    service_account = google_service_account.gke_nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }
}
```

For Autopilot, the node service account is set when the cluster is created (`gcloud container clusters create-auto --service-account=...`, or the matching Terraform argument).

A workload with a direct grant, and the fallback for an API that needs a GSA:

```hcl title="orders-api-identity.tf"
variable "project_number" {
  type        = string
  description = "Number (not ID) of the cluster's project; the principal identifier uses it."
}

locals {
  pool      = "${var.project_id}.svc.id.goog"
  orders_ns = "orders"
  orders_sa = "orders-api"
}

# Default: grant the role straight to the KSA's federated principal, on one bucket.
resource "google_storage_bucket_iam_member" "orders_exports_read" {
  bucket = "app-prod-orders-exports"
  role   = "roles/storage.objectViewer"
  member = "principal://iam.googleapis.com/projects/${var.project_number}/locations/global/workloadIdentityPools/${local.pool}/subject/ns/${local.orders_ns}/sa/${local.orders_sa}"
}

# Fallback: the workload must sign URLs, which federated identities cannot do.
resource "google_service_account" "orders_signer" {
  project      = var.project_id
  account_id   = "orders-api-signer"
  display_name = "orders-api: URL signing only"
}

resource "google_service_account_iam_member" "orders_signer_wi" {
  service_account_id = google_service_account.orders_signer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${local.pool}[${local.orders_ns}/${local.orders_sa}]"
}
```

```yaml title="orders-api/serviceaccount.yaml"
apiVersion: v1
kind: ServiceAccount
metadata:
  name: orders-api
  namespace: orders
  annotations:
    # Only in the linked-GSA case. Without the IAM binding above it does nothing.
    iam.gke.io/gcp-service-account: orders-api-signer@app-prod.iam.gserviceaccount.com
```

Both the `roles/iam.workloadIdentityUser` binding and the annotation are required for the linked method; either one alone fails with a permission error.

> [!info] Claims not checked against current docs
> Google's documentation pages could not be opened when this record was written; the behaviour below comes from search excerpts of the official pages and from `gcloud --help` and the Terraform provider's resource documentation. Check before relying on: the exact `principal://.../subject/ns/NAMESPACE/sa/KSA` subject format; the contents of `roles/container.defaultNodeServiceAccount` and whether newer GKE versions also need a node service agent role; the five constraint names in the table and their current default enforcement (key creation is reported as enforced by default in organizations created since 2024); Autopilot's handling of a changed node service account; the per-product federation limitations, including that federated identities cannot sign Cloud Storage URLs; and the metadata path used in Validation for the email check.

## Consequences

Easier:

- No key to leak, rotate or chase through backups. Tokens are short-lived and issued per KSA.
- Audit logs name the workload (namespace and KSA, or its own GSA), so access reviews ([[access-reviews-gcp-and-gke]]) and incident scoping work per service.
- A compromised container gets the rights of its own workload, not of the node or the project.

Harder or newly required:

- **IAM churn moves into Terraform.** Every new workload needs a KSA and its grants in the project's Terraform, so the project factory ([[gcp-resource-hierarchy-and-landing-zone]]) and the service template generate them. Teams request grants through merge requests instead of copying a key.
- **The principal identifier uses the project number**, which is easy to get wrong. Modules take it as an input and derive the string in one place.
- **Federation limitations need a lookup.** Before choosing the direct method for a new Google product, check its entry on the limitations page. The fallback GSA is allowed, but it must be per workload.
- **Metadata server dependency.** Default-deny egress ([[0020-default-deny-network-policies]]) must allow Pods to reach the GKE metadata server, and clients must retry the first token request after a Pod starts, which can time out.
- **Legacy tools** that only read a key file need replacing or a wrapper that uses Application Default Credentials.

### Migration and rollback

Existing workloads move one at a time: grant the roles to the new identity, deploy the KSA (and annotation if linked), roll the Deployment, confirm the identity in the audit log, then remove the Secret and **delete the old key**. Enabling `GKE_METADATA` on an existing node pool cuts Pods on that pool off from the node's identity, so move workloads to a new pool with the setting, or switch a pool only after every workload on it has its own identity. If a switched pool breaks a workload that was missed, the rollback for that pool is `--workload-metadata=GCE_METADATA` on the node pool while the workload gets its identity; it is never to create a new key.

## Alternatives considered

- **Keys kept in Secret Manager and fetched at start.** Removes keys from manifests but not the problem: the key is still long-lived, still copyable once fetched, and the Pod needs an identity to fetch it anyway. Rejected.
- **One GSA per namespace, shared by its workloads.** Fewer bindings, but one compromised workload gets every other workload's access in the namespace, and the audit log cannot tell them apart. Rejected; a namespace-wide `principalSet` grant is allowed only for read-only access that every workload in the namespace genuinely needs.
- **Node service account with narrow OAuth scopes.** Scopes are a legacy, coarse control and are shared by every Pod on the node. Rejected as a security boundary.
- **Linked GSA as the default for uniformity.** Works everywhere, but doubles the number of identities and bindings for no gain where direct grants are supported. Kept only as the fallback.

## Validation

```bash title="validate-workload-identity.sh"
set -o pipefail
PROJECT_ID="app-prod"
CLUSTER="apps-prod-01"
LOCATION="europe-west1"

# 1. The cluster has a workload pool. Expected: app-prod.svc.id.goog
gcloud container clusters describe "${CLUSTER}" --location "${LOCATION}" --project "${PROJECT_ID}" \
  --format='value(workloadIdentityConfig.workloadPool)'

# 2. Every node pool runs as the custom node service account with the GKE metadata server.
#    Expected: sa=gke-nodes-apps@... and GKE_METADATA on every line; "default" or a
#    ...-compute@developer.gserviceaccount.com address is a finding.
#    Field names: confirm once with --format=json if this prints empty values.
for np in $(gcloud container node-pools list --cluster "${CLUSTER}" --location "${LOCATION}" \
    --project "${PROJECT_ID}" --format='value(name)'); do
  gcloud container node-pools describe "${np}" --cluster "${CLUSTER}" --location "${LOCATION}" \
    --project "${PROJECT_ID}" \
    --format="value(name, config.serviceAccount, config.workloadMetadataConfig.mode)"
done

# 3. No user-managed keys on any service account in the project. Expected: no output.
for sa in $(gcloud iam service-accounts list --project "${PROJECT_ID}" --format='value(email)'); do
  gcloud iam service-accounts keys list --iam-account="${sa}" --managed-by=user \
    --format='value(name)' | sed "s|^|${sa}: |"
done

# 4. No Secret in the cluster holds a service account key. Expected: no output.
kubectl get secrets --all-namespaces -o json \
  | jq -r '.items[] | select([.data // {} | to_entries[] | .value | @base64d
      | test("\"type\": *\"service_account\"")] | any)
      | "\(.metadata.namespace)/\(.metadata.name)"'
```

From inside a Pod running as the workload's KSA, the metadata server must answer with a token, and the identity must not be the node's:

```bash
NAMESPACE="orders"
KSA="orders-api"

kubectl run wi-check --namespace "${NAMESPACE}" --rm -it --restart=Never \
  --image=curlimages/curl:latest \
  --overrides="{\"spec\":{\"serviceAccountName\":\"${KSA}\"}}" \
  -- sh -c '
    curl -sf -H "Metadata-Flavor: Google" \
      http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email; echo
    curl -sf -o /dev/null -w "token HTTP %{http_code}\n" -H "Metadata-Flavor: Google" \
      http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
```

Expected: the pool form (`app-prod.svc.id.goog`) for a direct-grant workload, or the workload's own GSA for a linked one, and `token HTTP 200`. A `...-compute@developer.gserviceaccount.com` address or the node service account means the Pod is not on Workload Identity Federation. Pin the image by digest in real use. Symptoms and fixes are in the troubleshooting table of [[gke-workload-identity]].

## References

- About Workload Identity Federation for GKE: https://docs.cloud.google.com/kubernetes-engine/docs/concepts/workload-identity
- Authenticate to Google Cloud APIs from GKE workloads: https://docs.cloud.google.com/kubernetes-engine/docs/how-to/workload-identity
- Identity federation, products and limitations: https://docs.cloud.google.com/iam/docs/federated-identity-supported-services
- Configure GKE node service accounts: https://docs.cloud.google.com/kubernetes-engine/security/configure-node-service-accounts
- Harden your cluster's security: https://docs.cloud.google.com/kubernetes-engine/docs/how-to/hardening-your-cluster
- Restricting service account usage (key constraints): https://docs.cloud.google.com/organization-policy/restrict-service-accounts
- Migrate from service account keys: https://docs.cloud.google.com/iam/docs/migrate-from-service-account-keys
- Best practices for using service accounts: https://docs.cloud.google.com/iam/docs/best-practices-service-accounts
- Terraform `google_container_cluster`: https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/container_cluster

Related notes: [[gke-workload-identity]], [[iam-groups-and-ci-workload-identity-federation]], [[secrets-architecture-gcp-and-gke]], [[gcp-iam-and-service-accounts]], [[service-account-key-expiry-recovery]], [[leaked-credential-rotation]]

Related ADRs: [[0018-gke-autopilot-for-new-clusters]], [[0024-gcp-folders-by-policy-boundary]], [[0026-keyless-ci-auth-with-workload-identity-federation]], [[0030-terraform-manages-gcp-infrastructure]], [[0036-secret-manager-as-secrets-system-of-record]], [[0053-production-and-non-production-never-share-a-cluster]]
