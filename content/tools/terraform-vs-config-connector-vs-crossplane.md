---
title: Terraform vs Config Connector vs Crossplane for GCP resources
description: Comparing Terraform, Config Connector and Crossplane for Google Cloud resources on change preview, drift, deletion semantics, identity and failure modes.
type: tool
tags:
  - tools
  - terraform
  - gcp
  - gitops
  - kubernetes
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Once Argo CD manages everything inside the clusters, someone always asks why Google Cloud resources are not Kubernetes objects too. Config Connector and Crossplane make that possible: a bucket, a Pub/Sub topic or a Cloud SQL instance becomes a custom resource that a controller keeps in line with the cloud. [[0030-terraform-manages-gcp-infrastructure]] rejects both in one line each and keeps Terraform for Google Cloud, with [[0001-gitops-with-argocd]] for workloads. This note is the evidence behind that line. It compares the three on what goes wrong in production: what a reviewer can see before a change, what happens on delete, which identity acts, and how each fails.

> [!info] Not checked against current releases
> Written from the projects' documentation source and the `gcloud` 570.0.0 help text on 2026-10-21; not checked against the published documentation pages, so verify there. Not verified: Config Connector's current support status and whether the GKE add-on is the recommended install, its behaviour on Autopilot and its resource coverage; the accepted values of the `deletion-policy` annotation beyond `abandon`; the readiness condition names; a Crossplane ProviderConfig for GKE Workload Identity; the current Crossplane provider package versions and apiVersions. Confirm them in the current documentation before you build on them.

## Criteria

| Criterion                | Why it matters                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| Change preview           | A reviewer must see "this replaces the database" before merge, not after.                       |
| Drift and reconcile      | Whether manual changes are found on a schedule, reverted continuously, or only on the next run. |
| State                    | Where the record of "what we manage" lives, and what happens when it is lost or corrupted.      |
| Identity                 | Which Google identity acts, how widely it is scoped, and whether it needs a key.                |
| Blast radius of a delete | Whether deleting a manifest, a namespace or a CRD deletes cloud resources.                      |
| Coverage                 | Whether the Google Cloud services you use exist in the tool, with the fields you need.          |
| Import and adoption      | How an existing resource comes under management without being recreated.                        |
| Operating cost           | What you run, upgrade and page on: a CLI in CI, or a controller in a cluster.                   |

## At a glance

| Concern              | Terraform (Google provider)                          | Config Connector                                                                | Crossplane (GCP provider family)                                               |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Model                | Plan and apply, run on demand or in CI               | Kubernetes controller, continuous reconcile                                     | Kubernetes controller, continuous reconcile                                    |
| Preview              | Saved plan shows create, update, destroy and replace | `kubectl diff` or Argo CD diff of the manifest, not of the cloud change         | Same as Config Connector                                                       |
| State                | State file (GCS backend), locked                     | The custom resources in etcd plus the cloud itself                              | The managed resources in etcd plus the cloud itself                            |
| Drift                | Seen on the next `plan`                              | Re-applied on every reconcile                                                   | Re-applied on every poll                                                       |
| Delete semantics     | `destroy` or removal from config shows in the plan   | Deleting the resource deletes the cloud resource unless the policy says abandon | Deleting the managed resource deletes the cloud resource unless told otherwise |
| Immutable field edit | Plan shows a replacement                             | Not applied; needs abandon, delete, re-create (see below)                       | Not applied; Crossplane never deletes on a spec change                         |
| Identity             | WIF in CI, or a service account in the runner        | One Google service account per cluster or per namespace                         | ProviderConfig credentials                                                     |
| Who runs it          | CI runners, state bucket                             | Controller in a cluster (add-on or manual install)                              | Crossplane core plus providers in a cluster                                    |
| Composition          | Modules                                              | None built in                                                                   | Compositions and composite resources                                           |

## Change preview

This is the deciding criterion for foundations. Terraform's saved plan is a diff of the **cloud**: it calls the APIs, compares, and says which resources will be created, updated in place, destroyed, or destroyed and re-created. Reviewers and policy checks read that plan ([[terraform-plan-policy-checks]]), and the apply runs exactly the reviewed plan.

```bash title="plan in CI, detect drift by exit code"
set -euo pipefail
terraform -chdir=environments/prod plan -input=false -lock-timeout=5m \
  -detailed-exitcode -out=tfplan || rc=$?
# 0 = no changes, 1 = error, 2 = changes present
echo "plan exit code: ${rc:-0}"
terraform -chdir=environments/prod show -json tfplan > tfplan.json
```

With a controller, the reviewable diff is the **manifest**. Argo CD or `kubectl diff --server-side` shows that `spec.location` changed in YAML; it does not show what the controller will do to the cloud resource, because the controller has not run yet. That is the replace-vs-update blind spot:

- Crossplane's documentation is explicit: it lets you edit an immutable field but does not apply the change, and "never deletes a resource based on a `forProvider` change". It contrasts this with Terraform, which deletes and re-creates to change an immutable field. Crossplane deletes the external resource only when you delete the managed resource object.
- Config Connector's troubleshooting route for an immutable field is to set the abandon policy, delete the custom resource, change the field and apply again so the controller acquires or re-creates the resource. That sequence is manual and outside any plan.

So the controllers are safer in one way (no surprise replacement) and weaker in another (a change that cannot be applied silently does nothing until someone reads the resource status). Neither gives a reviewer a "this will be replaced" line before merge.

## Continuous reconciliation and deletion semantics

Controllers re-apply the desired state on a schedule. Config Connector has a per-resource annotation `cnrm.cloud.google.com/reconcile-interval-in-seconds`, and its generated reference lists a default average reconcile interval of 600 seconds for `StorageBucket`. Crossplane's poll interval is a provider setting (`--poll`); check whether your provider also supports a per-resource override. A console change during an incident is therefore reverted within minutes; Terraform leaves it until the next plan shows it as drift. Pick the behaviour deliberately: continuous revert is great for compliance and painful for break-glass work.

Deletion is where the controllers bite.

**Config Connector.** The annotation `cnrm.cloud.google.com/deletion-policy: abandon` keeps the Google Cloud resource when the custom resource is deleted. Without it, deleting the custom resource deletes the cloud resource. The annotation accepts `abandon`; the source also names `delete`, which is the default behaviour. Check the annotations reference for any other accepted value. `cnrm.cloud.google.com/force-destroy: "true"` on a bucket empties it before delete; keep it `"false"`. For a paused controller, `ConfigConnector.spec.actuationMode: Paused` keeps reconciling with the API server but stops actuation to Google Cloud.

**Crossplane.** Two mechanisms, depending on the major version you run:

- `spec.deletionPolicy: Orphan` (default `Delete`) keeps the external resource. It is documented on the v1.x managed resource page and still present on the cluster-scoped provider CRDs, whose description says it is planned to be deprecated in favour of management policies.
- `spec.managementPolicies` (beta, on by default in the v2 documentation) takes a list of `Observe`, `Create`, `Update`, `Delete`, `LateInitialize` or `*`. A list without `Delete` means deleting the managed resource leaves the cloud resource in place. `["Observe"]` makes a read-only, observe-only resource. An empty list pauses the resource. Support depends on the provider.

Crossplane v2 also introduced namespaced managed resources in a separate API group (`storage.gcp.m.upbound.io` for buckets, next to the legacy cluster-scoped `storage.gcp.upbound.io`). The namespaced CRD has no `deletionPolicy` field, so on v2 namespaced resources use management policies.

**Argo CD in front of either.** Pruning a manifest, or deleting an Application with the cascade finalizer `resources-finalizer.argocd.argoproj.io`, deletes the custom resources, which deletes the cloud resources. Protect stateful cloud resources with the abandon or orphan policy **and** the Argo CD sync options:

```yaml title="annotations on a stateful cloud resource managed by Argo CD"
metadata:
  annotations:
    argocd.argoproj.io/sync-options: Prune=false,Delete=false
```

`Prune=false` stops Argo CD from pruning the object when it disappears from Git; `Delete=false` keeps it when the Application is deleted. See [[argocd-sync-failure-and-drift]] for how these interact with sync status.

## One GCS bucket in all three

The same bucket, with versioning, uniform bucket-level access and a lifecycle rule. Names are examples; bucket names are globally unique.

```hcl title="terraform/buckets.tf"
resource "google_storage_bucket" "reports" {
  name                        = "example-project-reports"
  project                     = "example-project"
  location                    = "EU"
  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}
```

```yaml title="config-connector/storagebucket.yaml"
apiVersion: storage.cnrm.cloud.google.com/v1beta1
kind: StorageBucket
metadata:
  name: example-project-reports
  namespace: team-reports
  annotations:
    cnrm.cloud.google.com/project-id: example-project
    cnrm.cloud.google.com/deletion-policy: abandon
    cnrm.cloud.google.com/force-destroy: "false"
spec:
  location: EU
  uniformBucketLevelAccess: true
  versioning:
    enabled: true
  lifecycleRule:
    - action:
        type: Delete
      condition:
        age: 30
```

```yaml title="crossplane/bucket.yaml (namespaced, Crossplane v2 provider; verify the apiVersion for your provider release)"
apiVersion: storage.gcp.m.upbound.io/v1beta1
kind: Bucket
metadata:
  name: example-project-reports
  namespace: team-reports
spec:
  managementPolicies: ["Observe", "Create", "Update", "LateInitialize"]
  forProvider:
    location: EU
    uniformBucketLevelAccess: true
    versioning:
      enabled: true
  providerConfigRef:
    kind: ClusterProviderConfig
    name: default
```

Notes on the examples:

- Terraform's `prevent_destroy` makes a plan that would destroy the bucket fail. Its counterparts in the controllers are the abandon annotation and a management policy list without `Delete`.
- The Config Connector `project-id` annotation can also be set on the namespace so every resource in it lands in one project.
- The Crossplane `providerConfigRef` default in the namespaced CRD is `ClusterProviderConfig` named `default`. Provider CRD versions move on the provider's main branch, so take the apiVersion from the CRDs installed in your cluster (`kubectl explain bucket.spec --api-version=storage.gcp.m.upbound.io/v1beta1`).

## Identity

| Tool             | How it authenticates to Google Cloud                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terraform        | CI runner with Workload Identity Federation ([[0026-keyless-ci-auth-with-workload-identity-federation]]), one service account per environment, separate plan and apply identities.            |
| Config Connector | `ConfigConnector.spec.mode: cluster` uses one Google service account (`googleServiceAccount`). `mode: namespaced` uses one `ConfigConnectorContext` per namespace, each with its own account. |
| Crossplane       | A ProviderConfig whose `credentials.source` is one of None, Secret, AccessToken, ImpersonateServiceAccount, InjectedIdentity, Environment, Filesystem or Upbound.                             |

Config Connector in namespaced mode fits [[0019-namespace-per-team-tenancy]]: each team namespace acts as its own service account with roles on its own project only. Cluster mode gives one account the union of every team's rights, which is a large target.

```yaml title="config connector: namespaced mode"
apiVersion: core.cnrm.cloud.google.com/v1beta1
kind: ConfigConnector
metadata:
  name: configconnector.core.cnrm.cloud.google.com
spec:
  mode: namespaced
---
apiVersion: core.cnrm.cloud.google.com/v1beta1
kind: ConfigConnectorContext
metadata:
  name: configconnectorcontext.core.cnrm.cloud.google.com
  namespace: team-reports
spec:
  googleServiceAccount: kcc-team-reports@example-project.iam.gserviceaccount.com
```

Each of those service accounts needs a Workload Identity binding to the controller's Kubernetes service account; see [[gke-workload-identity]] for the binding pattern and the Config Connector documentation for the exact member name. For Crossplane on GKE, `InjectedIdentity` (application default credentials from the provider pod) is the likely route for Workload Identity; that mapping is not verified, so test it in a scratch project. Avoid the `Secret` source with a JSON key.

## Failure modes

- **Namespace deletion cascades to the cloud.** Deleting a namespace deletes every custom resource in it, and each delete becomes a cloud delete unless abandoned or orphaned. A mistyped `kubectl delete ns` can remove a team's buckets and databases.
- **CRD deletion is worse.** The Config Connector GitOps guide warns never to delete its CRDs: deleting a CRD cascade-deletes all its custom resources, and their finalizers make the controller delete the Google Cloud resources. Upgrade CRDs in place.
- **Stuck finalizers.** Config Connector adds `cnrm.cloud.google.com/finalizer` and `cnrm.cloud.google.com/deletion-defender`. If the controller is down or lacks permission to delete, the resource and its namespace hang in `Terminating`. Fix the controller or its permissions first; removing a finalizer by hand skips the cloud delete and leaves an orphan. See [[namespace-stuck-terminating]].
- **Controller outage.** Nothing is reconciled while the controller is down; existing cloud resources keep running. Changes merged to Git queue up silently, so alert on the controller's readiness and on custom resources that are not ready.
- **Bootstrap cycle.** The cluster that runs the controller is itself a Google Cloud resource. If the controller manages its own cluster, network or service accounts, losing the cluster loses the tool that would rebuild it. Foundations must come from outside the cluster.
- **Large CRD sets in Argo CD.** The Config Connector GitOps guide says it ships over 250 CRDs, too big for client-side apply's last-applied annotation; enable `ServerSideApply=true` on the Application.
- **Paused resources cannot be deleted.** A Crossplane resource with `crossplane.io/paused: "true"` cannot be deleted even with `kubectl delete`; unpause it first.
- **Terraform's own failure modes.** Lost or corrupted state, a stale lock, or an apply of an unreviewed plan. [[terraform-module-and-state-layout]] covers state protection.

## Import and adoption

- **Terraform.** An `import` block (since v1.5) makes adoption a reviewable, plannable change. `terraform plan -generate-config-out=generated.tf` (experimental) writes a starting configuration you must review.

  ```hcl title="import.tf"
  import {
    to = google_storage_bucket.reports
    id = "example-project-reports"
  }
  ```

- **Config Connector.** Create a custom resource whose name and project match the existing resource; the controller acquires it instead of creating a new one. Set the abandon policy first so a mistake does not delete it.
- **Crossplane.** Set the `crossplane.io/external-name` annotation to the existing resource's name before creation. Start with `managementPolicies: ["Observe"]` to read the resource without changing it, then widen.

Never manage one resource with two tools. Terraform and a controller fighting over the same bucket each revert the other's changes, and whichever deletes first wins.

## Validation

```bash title="controllers: is the resource ready and in sync?"
NS=team-reports
# Config Connector
kubectl -n "${NS}" get storagebucket example-project-reports -o yaml | yq '.status.conditions'
kubectl -n "${NS}" wait storagebucket/example-project-reports --for=condition=Ready --timeout=5m
# Crossplane: READY and SYNCED columns
kubectl -n "${NS}" get bucket.storage.gcp.m.upbound.io example-project-reports
kubectl -n "${NS}" wait bucket.storage.gcp.m.upbound.io/example-project-reports --for=condition=Ready --timeout=5m
```

The condition names above are inferred from the resource status columns; confirm them with `-o yaml` before you script on them.

```bash title="terraform: no drift, and the bucket is what the plan says"
terraform -chdir=environments/prod plan -detailed-exitcode -lock=false -input=false
gcloud storage buckets describe gs://example-project-reports \
  --format='value(versioning_enabled,uniform_bucket_level_access)'
```

## When to choose which

Choose **Terraform** for foundations: organisation policy, folders and projects, networks, clusters, IAM, KMS, shared databases. These need a plan that shows replacements, a lifecycle independent of any cluster, and a slow, reviewed change cadence. Compare runners in [[atlantis-vs-spacelift-vs-hcp-terraform]] and the CLI choice in [[terraform-vs-opentofu]].

Choose **Config Connector** for application-scoped resources that live and die with one team's namespace, such as a team's Pub/Sub topics or buckets, when you run GKE only, want namespaced Google identities, and accept a controller in the cluster. Check its current support status and install method first.

Choose **Crossplane** when you need compositions (one claim that builds a set of resources) or more than one cloud behind one Kubernetes API, and you will operate Crossplane core, provider packages and their upgrades.

## Recommendation

Keep [[0030-terraform-manages-gcp-infrastructure]] as it is: Terraform owns foundations and shared resources. If teams want self-service cloud resources from their Argo CD repositories ([[gitops-repo-topology-and-promotion]]), allow a controller only for application-scoped resources, in namespaced mode, with these guard rails:

1. Every stateful resource carries the abandon or orphan policy and the Argo CD `Prune=false,Delete=false` sync options.
2. The controller's Google identity can reach only the team's project, never the foundations.
3. Admission policy rejects controller resources in namespaces that are not on the allow list.
4. No resource is managed by both Terraform and a controller.

Revisit when a controller can show a cloud-side plan before merge, or when Config Connector's support status changes. [[argocd-vs-flux]] does not change the answer; both delivery tools hand the same custom resources to the same controllers.

## Related

- [[0030-terraform-manages-gcp-infrastructure]]
- [[0001-gitops-with-argocd]]
- [[terraform-vs-opentofu]]
- [[atlantis-vs-spacelift-vs-hcp-terraform]]
- [[terraform-plan-policy-checks]]
- [[terraform-module-and-state-layout]]
- [[gke-workload-identity]]
- [[0026-keyless-ci-auth-with-workload-identity-federation]]

## Sources

- [Config Connector overview](https://cloud.google.com/config-connector/docs/overview)
- [Config Connector: managing and deleting resources](https://cloud.google.com/config-connector/docs/how-to/managing-deleting-resources)
- [Config Connector resource reference](https://cloud.google.com/config-connector/docs/reference/overview)
- [Config Connector repository, including the Argo CD GitOps guide](https://github.com/GoogleCloudPlatform/k8s-config-connector)
- [Crossplane documentation: managed resources](https://docs.crossplane.io/latest/)
- [Upbound GCP provider family](https://marketplace.upbound.io/providers/upbound/provider-family-gcp)
- [GCP provider source (provider-upjet-gcp)](https://github.com/crossplane-contrib/provider-upjet-gcp)
- [Terraform import blocks](https://developer.hashicorp.com/terraform/language/import)
- [terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [Argo CD sync options](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/)
- [Argo CD app deletion](https://argo-cd.readthedocs.io/en/stable/user-guide/app_deletion/)
