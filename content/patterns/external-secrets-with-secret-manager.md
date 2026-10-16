---
title: External Secrets Operator with Google Secret Manager
description: "Sync Google Secret Manager secrets into Kubernetes Secrets on GKE with External Secrets Operator and Workload Identity: refresh, RBAC and failure modes."
type: pattern
tags:
  - patterns
  - kubernetes
  - gke
  - gcp
  - security
  - gitops
created: 2026-10-16
modified: 2026-10-16
draft: false
---

External Secrets Operator (ESO) reads secrets from an external store and writes them into ordinary Kubernetes `Secret` objects. Git holds only the _reference_ (an `ExternalSecret`), never the value, which is what makes it fit a GitOps flow such as [[0001-gitops-with-argocd]]. On GKE the operator authenticates to Secret Manager with [[gke-workload-identity]], so there is no service account key anywhere.

> [!info] Not checked against live docs
> The documentation sites were unreachable when this note was written, so API versions and field names come from experience with ESO 0.x and 1.x. Run `kubectl explain externalsecret.spec` and `kubectl explain clustersecretstore.spec.provider.gcpsm` against your installed CRDs before copying the YAML.

## How the pieces fit

| Object                            | Scope     | Purpose                                                                         |
| --------------------------------- | --------- | ------------------------------------------------------------------------------- |
| `SecretStore`                     | Namespace | How to reach one backend, usable only by ExternalSecrets in the same namespace. |
| `ClusterSecretStore`              | Cluster   | Same, shared by every namespace (subject to `conditions`).                      |
| `ExternalSecret`                  | Namespace | Which remote keys to fetch, and the shape of the resulting `Secret`.            |
| The resulting Kubernetes `Secret` | Namespace | What the Pods actually mount or reference.                                      |

The ESO controller does the fetching, so **the controller's identity** needs `roles/secretmanager.secretAccessor`, not each application. Per-team isolation therefore comes from the store design (see [RBAC](#rbac)), not from IAM on the Pod.

## Install

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

helm upgrade --install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace \
  --set installCRDs=true
```

Pin the chart version in your GitOps repo and read the release notes on upgrade; the API group has moved between versions (see below).

## Grant the operator access

Read [RBAC](#rbac) before choosing the scope. Set variables, then bind the role on a single secret to the ESO controller ServiceAccount, using the direct principal method from [[gke-workload-identity]]:

```bash
export PROJECT_ID="my-project"
export PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
export ESO_NS="external-secrets"
export ESO_KSA="external-secrets"
export SECRET_ID="payments-db-password"

gcloud secrets add-iam-policy-binding "${SECRET_ID}" \
  --project "${PROJECT_ID}" \
  --role="roles/secretmanager.secretAccessor" \
  --member="principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${PROJECT_ID}.svc.id.goog/subject/ns/${ESO_NS}/sa/${ESO_KSA}" \
  --condition=None
```

Repeat per secret, or use a project-level binding in a dedicated secrets project used only by this store. A project-wide binding is only acceptable when the project holds nothing but this store's secrets. If your environment needs a Google service account instead, annotate the controller's ServiceAccount through the chart values (`serviceAccount.annotations`) and use the impersonation method.

## ClusterSecretStore

```yaml title="clustersecretstore-gcp.yaml"
apiVersion: external-secrets.io/v1
kind: ClusterSecretStore
metadata:
  name: gcp-secret-manager
spec:
  provider:
    gcpsm:
      projectID: my-project
      auth:
        workloadIdentity:
          clusterLocation: europe-west1
          clusterName: platform-1
          clusterProjectID: my-project
          serviceAccountRef:
            name: external-secrets
            namespace: external-secrets
```

Older installs serve `external-secrets.io/v1beta1` with the same fields; newer ones deprecate it. Use whichever `kubectl api-resources --api-group=external-secrets.io` and your chart version report.

With the direct principal method, some ESO versions let you omit `auth` and fall back to Application Default Credentials, which resolve to the controller Pod's own federated identity. Test this on a non-production cluster first; the explicit `workloadIdentity` block is the safe default.

### Restrict which namespaces can reference a ClusterSecretStore

A ClusterSecretStore is usable from any namespace unless you say otherwise. Restrict it:

```yaml title="clustersecretstore-restricted.yaml"
apiVersion: external-secrets.io/v1
kind: ClusterSecretStore
metadata:
  name: gcp-secret-manager-payments
spec:
  conditions:
    - namespaces:
        - payments
  provider:
    gcpsm:
      projectID: payments-secrets
      auth:
        workloadIdentity:
          clusterLocation: europe-west1
          clusterName: platform-1
          clusterProjectID: my-project
          serviceAccountRef:
            name: external-secrets
            namespace: external-secrets
```

The example points at a separate `payments-secrets` project; the isolation comes from that project boundary and the controller's IAM on it, not from conditions. Any other store the controller can use could read the same project if granted.

For hard isolation use one SecretStore per tenant namespace, each pointing at a separate GCP project or at a tenant-specific KSA with narrower IAM. Namespace conditions alone only stop a namespace from _referencing_ the store; IAM is what stops the data leaving the project.

## ExternalSecret

```yaml title="externalsecret-db.yaml"
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: db-credentials
  namespace: payments
spec:
  refreshInterval: 1h
  secretStoreRef:
    kind: ClusterSecretStore
    name: gcp-secret-manager
  target:
    name: db-credentials
    creationPolicy: Owner
    deletionPolicy: Retain
  data:
    - secretKey: password
      remoteRef:
        key: payments-db-password
        version: latest
  dataFrom:
    - extract:
        key: payments-db-config # a JSON secret; each top-level key becomes a Secret key
```

Notes on the fields:

- `remoteRef.key` is the Secret Manager secret ID, not a resource path. `version` defaults to the latest; pin a number when you want a deliberate rollout.
- `creationPolicy: Owner` makes ESO own the `Secret` and garbage-collect it with the ExternalSecret. Use `Merge` only when you must add keys to a Secret created elsewhere.
- `deletionPolicy: Retain` keeps the Kubernetes Secret if the ExternalSecret is deleted, which is safer during a migration.
- To reshape values (a connection string, a `.dockerconfigjson`), use `target.template`; check the current templating engine version in the docs because it changed between releases.

## Refresh and rotation

ESO polls: every `refreshInterval` it re-reads Secret Manager and updates the Kubernetes Secret if the value changed. Consequences:

1. **The Kubernetes Secret updates; your Pod may not notice.** Environment variables are fixed at container start. Files mounted from a Secret volume update in place after the kubelet sync delay, but the application must re-read them. Otherwise restart the workload when the Secret changes, for example with Reloader or a checksum annotation in the [[helm-chart-conventions|Helm chart]].
2. **Rotation is two-phase.** Add a new Secret Manager version, wait for the refresh, roll the workload, then disable the old version. Disabling first causes an outage the next time a Pod starts.
3. **Lower intervals cost API quota.** With hundreds of ExternalSecrets, a one-minute interval multiplies reads. Check the current Secret Manager quotas and choose the longest interval your rotation process tolerates.
4. A force refresh is an annotation change:

```bash
kubectl annotate externalsecret db-credentials --namespace payments \
  force-sync="$(date +%s)" --overwrite
```

For a leaked value, follow [[leaked-credential-rotation]] rather than waiting for the interval.

## RBAC

> [!warning] Creating an ExternalSecret is reading a secret
> Whoever can create an `ExternalSecret` against a store can set `remoteRef.key` to **any** secret that the store's identity can read, have ESO copy it into their namespace, and mount it in a Pod. With one shared ClusterSecretStore and a project-wide `secretAccessor` binding, that is every secret in the project. Withholding `get` on `secrets` does not prevent it.

Isolate tenants with at least one of these:

- **Per-tenant stores and identities.** One `SecretStore` per team namespace, authenticating as a team-specific identity whose IAM covers only that team's secrets (a separate project, per-secret bindings, or an IAM condition on the secret name). This is the boundary that holds.
- **Admission policy.** A Kyverno or Gatekeeper rule that only admits `ExternalSecret` objects whose `remoteRef.key` matches the namespace's prefix (for example `payments-*` in `payments`).
- **Narrow store conditions.** `conditions` on a ClusterSecretStore limit which namespaces may use it, which helps only when each store's identity is already scoped to those namespaces' secrets.

Then:

- Developers get `create/update` on `externalsecrets` in their own namespace and nothing on `secrets` in other namespaces. On its own this is not isolation, see the warning above.
- Only the platform team needs rights on `clustersecretstores` and `secretstores`.
- Anyone who can create a `Pod` in a namespace can mount any `Secret` there. ESO does not change that, so combine it with namespace boundaries and [[kubernetes-network-policies]].
- Secret Manager audit logs (Data Access logs, which must be enabled) record `AccessSecretVersion` calls by the ESO principal, not by the end user. Per-team attribution needs per-team stores.

## Failure modes

| Symptom                                             | Cause and check                                                                                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| ExternalSecret `SecretSyncedError`, store not ready | `kubectl describe clustersecretstore`: usually IAM (`secretmanager.versions.access` denied) or a wrong project ID or cluster name.       |
| Works, then stops after a Pod restart               | ESO controller moved to a node pool without `GKE_METADATA`, or hostNetwork. See troubleshooting in [[gke-workload-identity]].            |
| Secret exists but has stale value                   | Refresh interval not elapsed, or `version` pinned. Force sync with the annotation above.                                                 |
| Application still uses the old value                | Env var or process cache. Restart the workload.                                                                                          |
| Secret Manager outage or quota error                | ESO keeps the last synced Secret; running Pods are unaffected, new rollouts keep working. Alert on the ExternalSecret `Ready` condition. |
| ESO is down                                         | Same: existing Secrets stay. Only changes and new ExternalSecrets stall.                                                                 |
| ExternalSecret deleted by mistake with `Delete`     | The Secret goes with it and Pods fail on next start. Use `deletionPolicy: Retain` for critical secrets.                                  |

Monitor with the controller metrics (`externalsecret_status_condition` and sync-call counters; confirm names on your version) and alert when an ExternalSecret has been not-Ready for longer than two refresh intervals.

## Alternatives

- **Secret Manager add-on / CSI driver.** GKE offers a managed Secret Manager add-on built on the Secrets Store CSI driver. Secrets are mounted as files via a `SecretProviderClass`, and no Kubernetes Secret is created unless you enable sync. This reduces the amount of secret material in etcd and needs no extra operator, but gives you files only, per-Pod mount configuration, and less templating. Check the current GKE docs for supported versions and rotation behaviour.
- **Application reads Secret Manager directly** with the client library and Workload Identity. Smallest footprint and instant rotation, but couples code to GCP.
- **Sealed Secrets / SOPS.** Encrypted values in Git. Simple, but rotation and audit live in Git history, not in a secrets store.

Choose ESO when you want Kubernetes-native `Secret` objects for Helm charts and third-party software that only understands them. Choose the CSI route when keeping values out of etcd matters more than convenience.

## Rollout checklist

1. Install ESO via GitOps with a pinned chart version.
2. Grant the controller `secretAccessor` on a test project and create one ClusterSecretStore.
3. Convert one non-critical workload and verify the Secret contents match.
4. Add the not-Ready alert and a reload mechanism.
5. Migrate remaining secrets, then remove plaintext values from Git and rotate every value that was ever committed.
