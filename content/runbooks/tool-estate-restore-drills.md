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
modified: 2026-11-24
draft: false
---

[[0051-backups-proven-by-quarterly-restore-drills]] says a backup counts only after a timed restore. Its component list covers GKE, Cloud SQL, Cloud Storage, Terraform state and keys. The CI tools are missing, and they are what you need first after a disaster. This runbook drills each of them into an isolated copy and records the measured RPO and RTO. Targets come from [[disaster-recovery-tiers-rpo-rto]]; the backup design is in [[backup-architecture-gke-cloud-sql-gcs]].

> [!info] Scope and verification
> None of the commands were run for this note, and none were checked against vendor documentation on 2026-11-24. Check each tool's backup and restore page for your version before the first drill. The procedure (isolate, restore, verify content, time it, record it) is the part this note fixes.

> [!danger] A restored CI tool is a live copy of production
> A restored Jenkins still has its cloud configuration, credentials and schedules, and can start builds that deploy to production. A restored Artifactory can run garbage collection against storage it is pointed at. A restored SonarQube can post to merge requests. Restore only into the isolated namespace below, with no egress, and never point a drill copy at production storage or databases.

## When to use

- The quarterly or yearly drill per ADR 0051.
- After any change to backup tooling.
- Before relying on a backup for an upgrade ([[jenkins-core-and-plugin-upgrade-rollback]], [[sonarqube-upgrade-and-db-migration]]).

This runbook is not for a real recovery. Use the tool runbooks, and [[terraform-state-recovery]] for state.

## Preconditions

- The drill runner is not the runbook author (ADR 0051).
- The scratch GKE namespace `restore-drill` exists, with a default-deny ingress and egress NetworkPolicy ([[0020-default-deny-network-policies]]) and no Workload Identity mapping on its service accounts ([[gke-workload-identity]]).
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
```

- Responders reach the drill pods with `kubectl port-forward`, which does not go through the pod network.
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
3. Start Artifactory at the production version against the scratch DB and bucket, with GC and replication disabled in its config before first start.
4. Verify that each reference artifact downloads and its SHA-256 matches the build info record ([[artifactory-provenance-evidence]]). Then compare repository counts.
5. For Artifactory SaaS: record the vendor's stated backup and RPO from the vendor review ([[vendor-soc2-report-review-for-devops-saas]]), and drill only the export of your configuration. See [[artifactory-outage-cache-fallback]] for the outage path.

### 3. SonarQube: database restore

1. Restore the DB into a scratch database, as in step 2.1.
2. Start SonarQube at the production version, with `sonar.jdbc.url` set to the scratch DB and an empty data directory, so the search index is rebuilt from the database. Record the reindex time; it is part of RTO.
3. Verify through the API. The token is read into a file, not argv:

```bash
SONAR_URL="http://127.0.0.1:9000" # port-forward to the drill pod
HDR_FILE="$(mktemp)"; chmod 600 "$HDR_FILE"
read -rs -p "SonarQube admin token (drill instance): " T; echo
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
backup_used: jenkins-home-20261123-0200
backup_taken_at: 2026-11-23T02:00:00Z
service_verified: 2026-11-24T10:12:00Z
measured_rpo_minutes: 1860 # drill_started minus backup_taken_at, i.e. the age of data restored
measured_rto_minutes: 72 # drill_started to service_verified
target_rpo_minutes: 1440 # from the DR tier
target_rto_minutes: 240
run_by: sre-oncall # a role, not the runbook author
result: fail # fail: RPO target missed
defects:
  - "snapshot schedule is daily at 02:00; tier needs 12h"
cleanup_done: true
```

Commit it where [[audit-evidence-collection-and-retention]] expects evidence. A miss or failure is an incident per ADR 0051.

## Validation

- Every system in scope has a record for the quarter with `result: pass`, or an open defect with an owner.
- `kubectl get networkpolicy -n restore-drill` still shows `deny-all`.
- No drill resource outlives the drill (see Rollback).

## Rollback

Cleanup removes only drill resources. The deletes are permanent.

> [!warning] Delete only drill resources
> Check each name contains `drill` before deleting.

```bash
kubectl delete namespace restore-drill
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

## Related

- [[backup-and-dr-for-ai-state]]
- [[game-day-chaos-gke]]
- [[sonarqube-platform-architecture]]
- [[artifactory-storage-full-recovery]]

## Sources

No vendor page was read for this version of the note; see Not verified. Read before the first drill:

- [Jenkins handbook, backing up](https://www.jenkins.io/doc/book/system-administration/backing-up/): to read. It is already cited in [[jenkins-core-and-plugin-upgrade-rollback]].
- The JFrog Artifactory and SonarQube backup documentation for your version: to read.
