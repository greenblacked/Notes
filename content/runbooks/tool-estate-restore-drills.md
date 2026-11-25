---
title: Restore drills for Jenkins, Artifactory, SonarQube and Terraform state
description: Timed, isolated restore drills for the CI tool estate that record measured RPO and RTO per ADR 0051, without letting the restored copy touch production.
type: runbook
tags:
  - runbooks
  - reliability
  - jenkins
  - artifactory
  - sonarqube
  - terraform
  - postgres
  - audit
created: 2026-11-24
modified: 2026-11-25
draft: false
---

[[0051-backups-proven-by-quarterly-restore-drills]] says a backup counts only after a timed restore. Its component list covers GKE, Cloud SQL, Cloud Storage, Terraform state and keys. The CI tools are missing, and they are what you need first after a disaster. This runbook drills each of them into an isolated copy and records the measured RPO and RTO. Targets come from [[disaster-recovery-tiers-rpo-rto]]; the backup design is in [[backup-architecture-gke-cloud-sql-gcs]].

> [!info] Scope and verification
> None of the commands were run for this note, and none were checked against vendor documentation on 2026-11-24. Check each tool's backup and restore page for your version before the first drill. The procedure (isolate, restore, verify content, time it, record it) is the part this note fixes.

> [!danger] A restored CI tool is a live copy of production
> A restored Jenkins still has its cloud configuration, credentials and schedules, and can start builds that deploy to production. A restored Artifactory can run garbage collection against storage it is pointed at. A restored SonarQube can post to merge requests. Restore only into the isolated namespace below, where egress is limited to the scratch database and scratch bucket, and never point a drill copy at production storage or databases.

## When to use

- The quarterly or yearly drill per ADR 0051.
- After any change to backup tooling.
- Before relying on a backup for an upgrade ([[jenkins-core-and-plugin-upgrade-rollback]], [[sonarqube-upgrade-and-db-migration]]).

This runbook is not for a real recovery. Use the tool runbooks, and [[terraform-state-recovery]] for state.

## Preconditions

- The drill runner is not the runbook author (ADR 0051).
- The scratch GKE namespace `restore-drill` exists, with a default-deny ingress and egress NetworkPolicy ([[0020-default-deny-network-policies]]), plus the narrow drill-only allow rules below. The `drill` service account has no Workload Identity mapping. Only `drill-artifactory` maps to a drill-only Google service account ([[gke-workload-identity]]).
- A drill-only Google service account (for example `restore-drill-artifactory@example-drill-project.iam.gserviceaccount.com`, change) with `roles/storage.objectUser` on the scratch bucket only. It has no role in production projects and no access to production buckets or instances.
- The scratch database reachable on a private IP (Cloud SQL private IP, or a Postgres VM in the scratch project). Record its IP and port for the allow rule.
- A scratch project or bucket for copied data, with access limited like production. Restored data may contain personal data; delete it after the drill ([[pci-dss-and-gdpr-for-devops-logs-and-data]]).
- Image digests of the production versions, because a drill restores onto the same version.
- A budget owner. Snapshots, disks and clones cost money.

```yaml title="restore-drill-isolation.yaml"
apiVersion: v1
kind: Namespace
metadata:
  name: restore-drill
  labels:
    pod-security.kubernetes.io/enforce: restricted
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all
  namespace: restore-drill
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: drill
  namespace: restore-drill
automountServiceAccountToken: false
# No iam.gke.io/gcp-service-account annotation: the drill pods get no Google identity.
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: drill-artifactory
  namespace: restore-drill
  annotations:
    # change: the drill-only GSA, never one that exists in production
    iam.gke.io/gcp-service-account: restore-drill-artifactory@example-drill-project.iam.gserviceaccount.com
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: restore-drill
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - { protocol: UDP, port: 53 }
        - { protocol: TCP, port: 53 }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-scratch-db
  namespace: restore-drill
spec:
  podSelector:
    matchLabels:
      drill-db-client: "true" # set on the Artifactory and SonarQube pods only
  policyTypes: [Egress]
  egress:
    - to:
        - ipBlock:
            cidr: 10.20.30.40/32 # change: the scratch DB private IP
      ports:
        - { protocol: TCP, port: 5432 } # change if the DB port differs
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-scratch-gcs
  namespace: restore-drill
spec:
  podSelector:
    matchLabels:
      drill-gcs-client: "true" # set on the Artifactory pod only
  policyTypes: [Egress]
  egress:
    - to:
        - ipBlock:
            cidr: 199.36.153.4/30 # change: your Google APIs endpoint (restricted.googleapis.com VIP with Private Google Access)
      ports:
        - { protocol: TCP, port: 443 }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-metadata-server
  namespace: restore-drill
spec:
  podSelector:
    matchLabels:
      drill-gcs-client: "true" # set on the Artifactory pod only
  policyTypes: [Egress]
  egress:
    - to:
        - ipBlock:
            cidr: METADATA_CIDR # change: the GKE metadata server address from the Workload Identity docs for your dataplane and version
      ports:
        - { protocol: TCP, port: METADATA_PORT } # change: the port from the same docs
```

- The Artifactory pod gets its Workload Identity token from the GKE metadata server on the node, so `allow-metadata-server` is needed next to `allow-scratch-gcs`. Without it the pod cannot authenticate to the scratch bucket. Take the address and port from the GKE Workload Identity docs, not from this note ([[kubernetes-network-policies]], [[gke-workload-identity]]).
- Responders reach the drill pods with `kubectl port-forward`, which does not go through the pod network.
- Jenkins gets no allow rule. Its pods carry neither `drill-db-client` nor `drill-gcs-client`, so they keep deny-all plus DNS.
- The scratch DB password goes into a Kubernetes Secret in `restore-drill`, created from a file, never from argv. Delete it with the namespace.
- The Google endpoint above reaches all of that API, but the drill GSA is authorised only on the scratch bucket, so that is the effective limit. Check that the VIP and DNS setup match your network.
- If the restored tool needs the identity provider to log in, use its local break-glass admin instead of opening egress.
- PSA `restricted` may reject the vendor image's securityContext. If so, use `baseline` for the drill namespace only and note it.

## Steps

### 0. Start the clock and the record

```bash
SYSTEM="jenkins"   # change per drill: jenkins | artifactory | sonarqube | terraform-state
RECORD="drill-${SYSTEM}-$(date -u +%Y%m%d).yaml"
START="$(date -u +%FT%TZ)"
echo "drill_started: ${START}" > "$RECORD"
```

### 1. Jenkins: restore JENKINS_HOME

1. Pick the newest scheduled snapshot of the `JENKINS_HOME` disk. Record its creation time as `backup_taken_at`.
2. Create a disk from it:

```bash
PROJECT="example-ci-project"          # change
ZONE="europe-west1-b"                 # change: same zone as the drill node pool
SNAPSHOT="jenkins-home-20261123-0200" # change: the snapshot you chose
gcloud compute snapshots describe "$SNAPSHOT" --project="$PROJECT" --format='value(creationTimestamp)'
gcloud compute disks create "jenkins-home-drill-$(date -u +%Y%m%d)" \
  --project="$PROJECT" --zone="$ZONE" --source-snapshot="$SNAPSHOT"
```

3. Bind the disk to a PV and PVC in `restore-drill`, following your storage class's pre-provisioned PD steps.
4. Start the controller pinned to the production image digest, with:
   - service account `drill`;
   - zero executors on the built-in node;
   - agents unable to connect (no egress, no agent Service).
5. Confirm `secrets/master.key` was restored. Without it no credential decrypts ([[jenkins-core-and-plugin-upgrade-rollback]]).
6. Verify content:
   - the job count matches production;
   - the plugin list matches `plugins.txt`;
   - one credential ID exists and its secret decrypts, checked by its presence in the UI only, never by printing it;
   - the last build of a reference job is present.
7. Record the `service_verified` time.

### 2. Artifactory (self-managed): database and filestore

> [!danger] Never point a drill instance at the production filestore
> Garbage collection on the drill instance deletes binaries its database does not reference. Pointed at the production bucket, it deletes production artifacts.

1. Restore the database into a scratch instance. For Cloud SQL, use a clone at the backup time ([[cloud-sql-point-in-time-recovery]]). For self-managed Postgres, use `pg_restore` into an empty scratch database with `--no-owner`.
2. Copy a **sample** of the filestore into the scratch bucket: the checksum paths of a list of reference artifacts (release builds, a Helm chart, a base image). Measure the full-copy throughput on that sample and extrapolate. Record honestly that the full copy was extrapolated.
3. Start Artifactory at the production version, with service account `drill-artifactory` and the labels `drill-db-client` and `drill-gcs-client`, against the scratch DB and bucket, with GC and replication disabled in its config before first start.
4. Verify that each reference artifact downloads and its SHA-256 matches the build info record ([[artifactory-provenance-evidence]]). Then compare repository counts.
5. For Artifactory SaaS: record the vendor's stated backup and RPO from the vendor review ([[vendor-soc2-report-review-for-devops-saas]]), and drill only the export of your configuration. See [[artifactory-outage-cache-fallback]] for the outage path.

### 3. SonarQube: database restore

1. Restore the DB into a scratch database, as in step 2.1.
2. Start SonarQube at the production version, with the label `drill-db-client` and no GCS label, `sonar.jdbc.url` set to the scratch DB and an empty data directory, so the search index is rebuilt from the database. Record the reindex time; it is part of RTO.
3. Verify through the API. The token is read into a file, not argv:

```bash
SONAR_URL="http://127.0.0.1:9000" # port-forward to the drill pod
HDR_FILE="$(mktemp)"; chmod 600 "$HDR_FILE"
printf 'SonarQube admin token (drill instance): ' >&2; stty -echo; IFS= read -r T; stty echo; echo >&2 # portable to bash and zsh
printf 'Authorization: Bearer %s\n' "$T" > "$HDR_FILE"; unset T
curl --fail -sS --header @"$HDR_FILE" "$SONAR_URL/api/system/status"
curl --fail -sS --header @"$HDR_FILE" "$SONAR_URL/api/projects/search?ps=1" | jq '.paging.total'
rm -f "$HDR_FILE"
```

4. Compare `paging.total` with production, and confirm the quality gate of one reference project.

### 4. Terraform state: recover a previous generation

Read-only against production. Copy, never overwrite. See [[terraform-state-recovery]] for a real recovery.

```bash
STATE_BUCKET="example-tfstate-prod"  # change
STATE_PATH="network/default.tfstate" # change: one root module's state
DRILL_DIR="$(mktemp -d)"
gcloud storage ls --all-versions "gs://${STATE_BUCKET}/${STATE_PATH}"
GEN="1732406400000000"               # change: a generation from the listing, about one day old
gcloud storage cp "gs://${STATE_BUCKET}/${STATE_PATH}#${GEN}" "$DRILL_DIR/restored.tfstate"
gcloud storage cp "gs://${STATE_BUCKET}/${STATE_PATH}" "$DRILL_DIR/current.tfstate"
for f in restored current; do
  jq -r --arg f "$f" '[$f, .lineage, .serial, .terraform_version, (.resources | length)] | @tsv' "$DRILL_DIR/$f.tfstate"
done
```

Pass criteria:

- Same `lineage`.
- `serial` lower or equal.
- Resource count plausible.
- The file parses.

Delete `$DRILL_DIR` afterwards: state files hold secrets ([[secrets-out-of-terraform-state]]).

### 5. Record the result

```yaml title="evidence/restore-drills/drill-jenkins-20261124.yaml"
system: jenkins # jenkins | artifactory | sonarqube | terraform-state
drill_started: 2026-11-24T09:00:00Z
backup_used: jenkins-home-20261124-0200 # the newest snapshot at drill time, not an older one
backup_taken_at: 2026-11-24T02:00:00Z
previous_backup_at: 2026-11-23T02:00:00Z
service_verified: 2026-11-24T10:12:00Z
measured_rpo_minutes: 420 # ADR 0051 field: age of the data restored, backup_taken_at to drill_started
backup_interval_minutes: 1440 # worst-case data loss: backup_taken_at minus previous_backup_at
measured_rto_minutes: 72 # drill_started to service_verified
target_rpo_minutes: 720 # from the DR tier
target_rto_minutes: 240
run_by: sre-oncall # a role, not the runbook author
result: fail # fail: worst-case RPO target missed
defects:
  - "snapshot schedule is daily at 02:00; worst-case data loss is 24h, tier allows 12h (720 minutes)"
cleanup_done: true
```

`measured_rpo_minutes` follows [[0051-backups-proven-by-quarterly-restore-drills]]: the age of the data restored, from `backup_taken_at` to `drill_started` (420 minutes here, within the 720 target). `backup_interval_minutes` is a separate, stricter check that this runbook adds: the gap between two consecutive backups, because a failure just before the next snapshot loses that whole gap. This runbook judges the tier on the worst-case interval, which is stricter than the ADR wording. Here 1440 is above the 720 target, so the drill fails and the defect is the schedule. The RTO clock starts at `drill_started`.

Commit it where [[audit-evidence-collection-and-retention]] expects evidence. A miss or failure is an incident per ADR 0051.

## Validation

- Every system in scope has a record for the quarter with `result: pass`, or an open defect with an owner.
- `kubectl get networkpolicy -n restore-drill` shows `deny-all` and exactly the four allow rules `allow-dns`, `allow-scratch-db`, `allow-scratch-gcs` and `allow-metadata-server`, each reviewed. No other egress rule exists.
- The drill GSA has no role outside the scratch bucket: `gcloud storage buckets get-iam-policy gs://<production-bucket>` does not list it.
- No drill resource outlives the drill (see Rollback).

## Rollback

Cleanup removes only drill resources. The deletes are permanent.

> [!warning] Delete only drill resources
> Check each name contains `drill` before deleting, including the PersistentVolume.

```bash
kubectl delete namespace restore-drill
kubectl delete pv "<drill PV name>" # change: the pre-provisioned PV from step 1.3; it is cluster-scoped and survives the namespace
gcloud compute disks delete "jenkins-home-drill-YYYYMMDD" --project="$PROJECT" --zone="$ZONE" # change: the drill disk name
```

- Delete scratch DB clones and the scratch bucket.
- Production is untouched by design. If anything in production changed during the drill, that is an incident.

## Troubleshooting

| Symptom                                                 | Fix                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Jenkins credentials show as unreadable                  | `master.key` missing from the backup. That is a defect: back the key up separately and securely.            |
| Artifactory starts but downloads 404                    | Expected outside the sampled checksums. Only the reference list is in the drill bucket.                     |
| SonarQube stuck on "DB migration needed"                | The drill image version differs from production. Use the production digest.                                 |
| `gcloud storage ls --all-versions` shows one generation | Object versioning is off on the state bucket. That is a defect ([[backup-architecture-gke-cloud-sql-gcs]]). |

## Not verified

- All vendor restore procedures: Jenkins handbook, JFrog backup docs (DB plus filestore, GC and replication settings), and SonarQube backup and reindex behaviour.
- SonarQube `api/system/status` and `api/projects/search` responses and Bearer auth.
- `gcloud compute disks create --source-snapshot` and the `gs://...#generation` copy syntax.
- Terraform state JSON field names.
- PSA `restricted` compatibility of the vendor images.
- The drill allow rules: the Google APIs endpoint range, the GKE metadata server address and port for `allow-metadata-server` (left as `METADATA_CIDR` and `METADATA_PORT` until taken from the docs), the Workload Identity binding and whether Artifactory's GCS filestore works through it, and Cloud SQL private IP connectivity from the cluster.

## Related

- [[backup-and-dr-for-ai-state]]
- [[game-day-chaos-gke]]
- [[sonarqube-platform-architecture]]
- [[artifactory-storage-full-recovery]]

## Sources

No vendor page was read for this version of the note; see Not verified. Read before the first drill:

- [Jenkins handbook, backing up](https://www.jenkins.io/doc/book/system-administration/backing-up/): to read. It is already cited in [[jenkins-core-and-plugin-upgrade-rollback]].
- The JFrog Artifactory and SonarQube backup documentation for your version: to read.
