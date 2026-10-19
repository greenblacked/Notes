---
title: Velero vs Backup for GKE
description: Comparing Velero and Backup for GKE on scope, volume snapshots, restore granularity, cross-region restore and operating cost for production GKE.
type: tool
tags:
  - tools
  - kubernetes
  - gke
  - reliability
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Cluster backup tools answer one question: after losing a namespace, a cluster or a region, how much state can I put back, and how fast. Velero is the open-source, cloud-neutral answer. Backup for GKE is Google's managed service. The overall design (what to back up, RPO and RTO, Cloud SQL and buckets) is in [[backup-architecture-gke-cloud-sql-gcs]]; this note compares the two cluster-level tools.

> [!info] Not checked against current releases
> Versions, command syntax, plugin tags, limits and prices were not checked when this note was written. Confirm them in the current documentation, and run `--help` for every command before use.

## Short answer: what GitOps already rebuilds

If your manifests, Helm values and Kustomize overlays live in Git and a GitOps controller applies them, then stateless workloads, Services, Ingresses and RBAC are already backed up by Git. A cluster backup tool earns its place for the rest:

- PersistentVolume data (databases on disks, queues, file stores);
- resources created outside Git (operators' generated objects, manually created Secrets, custom resources with runtime state);
- a faster restore of a namespace than re-running a full sync plus data restore.

Many teams therefore back up only stateful namespaces, and rely on [[argocd-vs-flux|GitOps]] for the rest. Stateful design considerations are in [[stateful-workloads-gke]].

## At a glance

| Concern                 | Velero                                                             | Backup for GKE                                                     |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Operated by             | You install and upgrade the server and plugins                     | Google-managed service plus a GKE add-on                           |
| Portability             | Any Kubernetes; object storage targets across clouds               | GKE only                                                           |
| Scope selection         | Namespaces, labels, resource types, via flags and schedules        | Backup plans with selection by namespace or application            |
| Volume data             | CSI snapshots, or file-system backup with a node agent             | Persistent disk snapshots managed by the service                   |
| Restore granularity     | Whole backup, namespaces, resources, with remapping                | Whole or partial restore with transformation rules; check the docs |
| Cross-region restore    | Possible if the bucket and snapshots are reachable; plan carefully | Supported between clusters in supported locations; check the docs  |
| Application consistency | Hooks (exec into pods before and after)                            | Hooks; check the current docs                                      |
| Cost                    | Bucket and snapshot storage, plus your operational time            | Service charges plus storage; check the current pricing page       |

## What each backs up

Both capture Kubernetes API objects, and both handle volumes, but the mechanics differ.

**Velero** stores the manifests as a tarball in object storage and takes volume snapshots through CSI (a `VolumeSnapshotClass` is required) or copies file contents with the node agent (formerly Restic or Kopia integration) for volumes that cannot snapshot. File-system backup is portable and slow; snapshots are fast and tied to the cloud.

**Backup for GKE** records cluster resources and uses Persistent Disk snapshots under a backup plan with a schedule and retention, managed by Google. You enable the add-on on the cluster and define plans in Terraform or `gcloud`.

Neither tool understands your database. A crash-consistent disk snapshot of a busy PostgreSQL volume may need recovery on restore. For databases, add hooks that quiesce or checkpoint, or prefer the database's own backup mechanism and treat the volume snapshot as a second layer.

## Restore semantics and ordering

- **Ordering.** Cluster-scoped resources and CRDs must exist before the custom resources that use them. Velero restores in a defined resource priority order; Backup for GKE has its own ordering and transformation settings. Verify with a drill rather than trusting the order.
- **Namespace remapping.** Velero can restore into a different namespace; use this to run a restore next to production without conflict.
- **Existing resources.** By default Velero skips resources that already exist. Decide whether a restore should overwrite or only add, and read the current documentation for the existing-resource policy.
- **Service accounts and bindings.** Workload Identity bindings live in IAM, not in the cluster. A restored `ServiceAccount` annotation without the IAM binding gives pods that start but cannot reach Google APIs.
- **External state.** Load balancer IPs, DNS records and Cloud SQL are outside the backup. Record them next to the plan.

## Cross-region and cross-project restore

A region loss is the scenario that distinguishes a backup from a copy in the same failure domain.

- With Velero, keep the backup bucket in a different region (or dual-region) from the cluster, replicate snapshots if the provider allows, and install Velero on the target cluster pointing at the same bucket in read-only mode for the restore.
- With Backup for GKE, restore targets a different cluster in a supported location; check the documentation for which location pairs and which cross-project options are supported today.
- In both cases, the target cluster needs the same node types, storage classes, CRDs, and operators installed first. Provision it from code (see [[disaster-recovery-tiers-rpo-rto]] for choosing the tier that justifies this).

## Installing and running

### Velero

Install with the Google plugin. The plugin tag below is a placeholder; pin to a version you have checked in the plugin's release notes.

```bash title="velero install (verify flags with velero install --help)"
PROJECT=example-project
BUCKET=example-velero
VELERO_GSA=velero@${PROJECT}.iam.gserviceaccount.com

velero install \
  --provider gcp \
  --plugins velero/velero-plugin-for-gcp:v1.x.y \
  --bucket "${BUCKET}" \
  --no-secret \
  --sa-annotations iam.gke.io/gcp-service-account="${VELERO_GSA}" \
  --backup-location-config serviceAccount="${VELERO_GSA}" \
  --use-volume-snapshots=true \
  --features=EnableCSI
```

`--no-secret` together with a Workload Identity annotation avoids a long-lived JSON key; check the plugin README for the current recommended authentication and the IAM roles the service account needs (bucket access plus snapshot permissions, ideally scoped by custom role).

```bash title="back up, inspect and restore"
velero backup create app-daily --include-namespaces app --snapshot-volumes
velero backup describe app-daily --details
velero backup logs app-daily

# Schedule it: 02:00 daily, kept for 30 days
velero schedule create app-daily --schedule="0 2 * * *" \
  --include-namespaces app --ttl 720h

velero restore create --from-backup app-daily \
  --namespace-mappings app:app-restore
velero restore describe <restore-name> --details
velero restore logs <restore-name>
```

### Backup for GKE

```bash title="enable and create a plan (verify the command group with --help)"
gcloud container clusters update example-cluster \
  --region=europe-west1 --project=example-project \
  --update-addons=BackupRestore=ENABLED

gcloud beta container backup-restore backup-plans create app-daily \
  --project=example-project --location=europe-west1 \
  --cluster=projects/example-project/locations/europe-west1/clusters/example-cluster \
  --selected-namespaces=app \
  --include-volume-data --cron-schedule="0 2 * * *" \
  --backup-retain-days=30
```

The command group and flag names have changed in the past, so treat the above as a sketch and confirm them with `gcloud beta container backup-restore --help` and the current concepts page.

## Running a restore drill

A backup that has never been restored is a hope. Quarterly, or after any big change:

1. Create a scratch cluster (or namespace, for Velero remapping) from code.
2. Install the tool, point it at the real backup location, read-only where possible.
3. Restore one namespace, including volumes.
4. Validate: pods ready, PVCs bound, application health endpoint answers, a database query returns the expected last-known row, and the data's latest timestamp matches the RPO you promised.
5. Record the elapsed time, the manual steps and the surprises as your measured RTO.
6. Delete the scratch resources, including restored disks and snapshots, to stop costs. Run the cleanup commands from your notes, and confirm with `gcloud compute disks list` that nothing is left.

The exercise itself belongs in [[game-day-chaos-gke]] alongside other failure drills.

## Failure modes

- **Missing `VolumeSnapshotClass`.** Velero reports snapshot errors or silently skips volumes because the CSI class or label is absent. Check with `kubectl get volumesnapshotclass`.
- **CRDs restored after custom resources.** Restore errors on unknown kinds. Restore CRDs first or install operators before the restore.
- **Workload Identity bindings missing.** The restore succeeds, pods cannot reach Google APIs.
- **Partial backups.** `velero backup describe` shows `PartiallyFailed`. Alert on any backup that is not `Completed`.
- **Retention surprises.** A TTL shorter than your recovery window deletes the backup you need. Review TTLs and the bucket lifecycle together.
- **Credentials as a single point of failure.** If the same project and service account that owns production also owns the backups, an attacker or a mistaken `terraform destroy` can delete both. Keep backups in a separate project with restricted delete rights and object retention (see the bucket retention options in Cloud Storage documentation).
- **Version skew.** Restoring into a much newer or older Kubernetes version can reject API versions. Test the combination you are likely to use.
- **Encryption and Secrets.** Backups contain Secrets in plain Kubernetes form. Encrypt the bucket with a CMEK (see [[cloud-kms-key-management]]) and restrict who can read it.

## Cost

Velero costs bucket storage, snapshot storage and the engineering time to keep it working. Backup for GKE adds a service charge on top of storage. Neither number is stable: use the current pricing page and your own volume sizes, and include restore drills (temporary clusters and disks) in the estimate.

## When to choose which

Choose **Velero** when you run on more than one platform or on-premises Kubernetes, want one tool and format everywhere, or need fine control over hooks and resource filters, and you can own the upgrades.

Choose **Backup for GKE** when you run only on GKE, want Google to operate the control plane of the backup, and value integration with IAM, logging and Terraform.

Choose **neither** for clusters that are fully rebuilt from Git with managed data stores, and invest in the restore of the data stores instead.

## Recommendation

For a GKE-only production platform, use Backup for GKE for the stateful namespaces, keep everything else in Git, and back up Cloud SQL and buckets with their native features. Use Velero when portability or fine hook control outweighs the operating cost. In both cases keep backups in a separate project, alert on failed backups, and run a timed restore drill every quarter. Revisit when you add a second cloud, when the managed service's limits change, or when your measured RTO misses the target.

## Related

- [[backup-architecture-gke-cloud-sql-gcs]]
- [[disaster-recovery-tiers-rpo-rto]]
- [[stateful-workloads-gke]]
- [[game-day-chaos-gke]]
- [[argocd-vs-flux]]

## Sources

- [Velero documentation](https://velero.io/docs/)
- [Velero plugin for GCP](https://github.com/vmware-tanzu/velero-plugin-for-gcp)
- [Backup for GKE concepts](https://cloud.google.com/kubernetes-engine/docs/add-on/backup-for-gke/concepts/backup-for-gke)
