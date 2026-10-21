---
title: Restore deleted or overwritten Cloud Storage objects
description: Stop the cause, check soft delete and versioning, then restore deleted or overwritten objects or a deleted bucket with gcloud storage, and prove it.
type: runbook
tags:
  - runbooks
  - gcp
  - reliability
  - security
  - incident-management
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Objects in a Cloud Storage bucket can disappear in three ways: someone or something deletes them (a recursive `rm`, a sync job with a delete flag, a compromised credential), a lifecycle rule deletes them on purpose but with the wrong condition, or a writer overwrites them with bad content. Whether you can get them back depends on what protection the bucket had **at the moment of the deletion**: soft delete, Object Versioning, or neither. This runbook stops the damage first, then works out which recovery path exists, then restores and proves the result.

The backup design that should make this a routine job is in [[backup-architecture-gke-cloud-sql-gcs]]; the drill that proves it is [[0051-backups-proven-by-quarterly-restore-drills]].

> [!info] Scope and verification
> The `gcloud storage` commands and flags below were checked with `--help` in Google Cloud SDK 570.0.0 on 2026-10-21, but were not run against a real bucket, so the note is not marked `verified`. Statements about soft delete retention limits, billing, IAM permissions and deleted buckets were checked only from search excerpts of the Cloud Storage documentation (the pages could not be opened directly). **Not verified:**
>
> - whether Object Versioning and a retention policy can be enabled together (the [[backup-architecture-gke-cloud-sql-gcs|backup architecture note]] says they cannot; confirm on the Object Versioning page);
> - how soft delete treats noncurrent versions, and whether objects deleted by a lifecycle rule go through soft delete;
> - restore behaviour when the object's Cloud KMS key version is disabled or destroyed;
> - predefined role names other than `roles/storage.admin`;
> - the exact command and output for listing soft-deleted **buckets**, and the field names of the soft delete policy in `buckets describe`.
>
> Read the linked pages for your case before a large restore.

## When to use

- Objects are missing from a bucket after a script, a sync job or a person deleted them.
- Objects were overwritten with wrong, empty or encrypted (ransomware-style) content.
- A lifecycle rule removed objects it should not have.
- A whole bucket was deleted.
- A restore drill under [[0051-backups-proven-by-quarterly-restore-drills]] uses this procedure.

If the deletion may be malicious, run [[compromised-cloud-cluster-containment]] and [[leaked-credential-rotation]] in parallel: restoring into a bucket that the attacker can still write to only gives them a second chance.

## Preconditions

- An incident or change record, and one person who owns the restore.
- Permissions to list, restore and create objects in the bucket. Per a search excerpt of the "Use soft-deleted objects" page, restoring needs `storage.objects.list`, `storage.objects.restore` and `storage.objects.create`, plus `storage.objects.delete` when the restore replaces a live object; bulk restore also needs `storage.buckets.restore`. `roles/storage.admin` contains them. Check the permission table on that page before granting a narrower role, and grant it temporarily (see [[gcp-iam-and-service-accounts]]).
- A shell with `gcloud` authenticated to the right project. In zsh, quote every URL that contains `**`, `*` or `#`; unquoted, zsh treats them as globs or comments and either errors or passes something different to `gcloud`.

```bash
PROJECT=my-project
BUCKET=example-data-bucket
PREFIX=reports/2026/                  # the affected path inside the bucket, ending in "/"; "" for the whole bucket
INCIDENT_START="2026-10-20T09:00:00Z" # RFC 3339, a little before the first bad delete or overwrite
INCIDENT_END="2026-10-20T10:30:00Z"   # RFC 3339, a little after the last one
WORKDIR="./gcs-restore-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$WORKDIR"
gcloud config set project "$PROJECT"
```

## Steps

### 1. Stop the cause before you restore

A restore that runs while the deleting process is still active loses the race. In order:

1. **Find the actor.** Admin Activity audit logs are always on, but object deletes and writes are Data Access (`DATA_WRITE`) events, which are off by default for Cloud Storage (see [[gcp-audit-logs-siem]]). If Data Access logs were enabled for the bucket, query them:

   ```bash
   gcloud logging read \
     "resource.type=\"gcs_bucket\" AND resource.labels.bucket_name=\"$BUCKET\" AND protoPayload.methodName=\"storage.objects.delete\" AND timestamp>=\"$INCIDENT_START\"" \
     --project "$PROJECT" --limit 50 \
     --format="table(timestamp, protoPayload.authenticationInfo.principalEmail, protoPayload.resourceName)"
   ```

   The method name and the resource type are the usual values for Cloud Storage audit entries; confirm them on the Cloud Storage audit logging page if the query returns nothing. If Data Access logs were off, there is no per-object record: use the job schedules, CI logs and the lifecycle configuration to find the cause instead.

2. **Disable the actor.** Pause the job or schedule, revoke the credential or service account key ([[leaked-credential-rotation]]), or remove the bad lifecycle rule:

   ```bash
   gcloud storage buckets describe "gs://$BUCKET" > "$WORKDIR/bucket-before.txt"   # keep the full config, including lifecycle
   gcloud storage buckets update "gs://$BUCKET" --clear-lifecycle                  # only if a lifecycle rule is the cause
   ```

   `--clear-lifecycle` removes **all** lifecycle rules, including the good ones. Put the corrected rules back from version control after the restore (see Rollback); if the bucket is managed by Terraform, change it there and expect drift until you apply.

3. **Preserve evidence** if the incident may need it: see [[legal-hold-for-logs-and-artifacts]]. Copy the relevant audit log entries out before their retention ends.

> [!warning] Do not shorten or turn off soft delete during an incident
> `--soft-delete-duration` and `--clear-soft-delete` change the policy for future deletions. The help text says clearing does not affect objects that are already soft-deleted, but changing retention in the middle of a recovery is easy to get wrong. Leave the policy alone until the restore is finished and checked.

### 2. Work out which protection the bucket has

```bash
gcloud storage buckets describe "gs://$BUCKET"
gcloud storage buckets describe "gs://$BUCKET" --format="value(versioning.enabled)"   # True when Object Versioning is on
```

Read the full `describe` output for the soft delete policy (retention duration), versioning, the retention policy and whether it is locked, default event-based holds, and the encryption key. The field names for soft delete in this output were not verified; use `--raw` to see the API field names if the default output is unclear.

| What the bucket had                | Recovery path                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| Soft delete, versioning off        | Step 3: restore soft-deleted objects. Overwritten objects also become soft-deleted.        |
| Versioning on                      | Step 4 for overwrites (copy a noncurrent generation back); step 3 for deleted versions.    |
| Both                               | Try step 4 first for overwrites, step 3 for anything that no longer shows as noncurrent.   |
| Neither, or retention has expired  | No recovery from Cloud Storage. Restore from your backup copy or rebuild the data.          |
| Retention policy or holds          | They block deletion of protected objects, so check what was actually deleted before acting. |

Soft delete facts, per search excerpts of the soft delete page (check it for your bucket): new buckets get a soft delete policy by default with a 7-day retention (the CLI help also documents 7 days as the default); retention can be set between 7 and 90 days, and `0` turns soft delete off. Soft-deleted objects cannot be purged before their retention ends. Bucket Lock and object retention lock are listed as compatible with soft delete. A deleted **project** cannot be recovered through soft delete.

### 3. Restore soft-deleted objects

List what is recoverable before restoring anything:

```bash
gcloud storage ls --soft-deleted --long "gs://$BUCKET/$PREFIX**" | tee "$WORKDIR/soft-deleted-long.txt"
gcloud storage ls --soft-deleted --exhaustive "gs://$BUCKET/$PREFIX**" | sort -u > "$WORKDIR/restore-list.txt"
wc -l "$WORKDIR/restore-list.txt"
```

`--soft-deleted` shows only soft-deleted objects, never live or noncurrent ones. `**` gives a flat list of object URLs (unlike `--recursive`, which adds headers per directory), and it must stand alone in its path segment, which is why `PREFIX` ends in `/`. The listing can return empty pages for soft-deleted objects; `--exhaustive` keeps querying, at the cost of more LIST calls. Use `--all-versions` as well when several generations of the same name were deleted, and `gcloud storage objects describe --soft-deleted "gs://$BUCKET/<object>#<generation>"` to inspect one.

**A handful of objects (synchronous):**

```bash
gcloud storage restore "gs://$BUCKET/reports/2026/q3.csv"                 # latest soft-deleted generation
gcloud storage restore "gs://$BUCKET/reports/2026/q3.csv#1760950000000000" # one specific generation
gcloud storage restore "gs://$BUCKET/reports/2026/**.csv"                 # wildcard, latest generation of each
gcloud storage restore --read-paths-from-stdin < "$WORKDIR/restore-list.txt"
```

`restore-list.txt` is a list of `gs://` URLs, one per line, with or without `#generation`. Edit the list from the listing above down to what should come back before you feed it in; if one name appears with several generations, keep the generation you want. Add `--preserve-acl` if the bucket uses fine-grained ACLs and you need the original ACLs back.

`--all-versions` restores every soft-deleted generation of each name. Per the help text, with versioning on the latest becomes live and the older ones become noncurrent; with versioning off the latest becomes live and the earlier generations are soft-deleted again. It also disables parallelism, so it is slow on large sets.

**Many objects (bulk, asynchronous):**

```bash
gcloud storage restore "gs://$BUCKET/$PREFIX**" --async \
  --deleted-after-time="$INCIDENT_START" \
  --deleted-before-time="$INCIDENT_END"

gcloud storage operations list "gs://$BUCKET"
gcloud storage operations describe "projects/_/buckets/$BUCKET/operations/OPERATION_ID"
```

`OPERATION_ID` is the ID printed by the restore command and shown by `operations list`. `--created-after-time` and `--created-before-time` filter on the object's creation time, and all four filters take RFC 3339 timestamps. A running bulk restore can be stopped with `gcloud storage operations cancel`.

**Overwrites (bulk, back to a point in time).** When good objects were replaced by bad ones, the good versions are soft-deleted (versioning off) and the bad ones are live. The help text documents combining `--created-after-time` and `--deleted-after-time` with `--allow-overwrite` to go back to "the point just before the overwrites began":

> [!warning] `--allow-overwrite` replaces live objects
> Every live object that matches the filters is replaced by the restored generation. With versioning on, the replaced object becomes noncurrent; without it, it becomes soft-deleted, so it is recoverable for the soft delete retention period and then gone. Run it on the narrowest prefix and time window you can, after a dry listing, and only once the writer that caused the overwrites is stopped (step 1).

```bash
gcloud storage restore "gs://$BUCKET/$PREFIX**" --async --allow-overwrite \
  --created-after-time="$INCIDENT_START" \
  --deleted-after-time="$INCIDENT_START"
```

Per a search excerpt of the soft delete page, a restore creates a **new live generation** with a new generation number; the soft-deleted copy stays until its retention ends. Anything that tracks generations (Terraform state, caches, event consumers using `generation` preconditions) sees a new object.

### 4. Restore an overwritten object from a noncurrent version

With Object Versioning on, an overwrite or delete turns the old content into a noncurrent generation. List them, pick the last good one, and copy it back over the live name. This is the same method [[terraform-state-recovery]] uses for state files.

```bash
OBJ="reports/2026/q3.csv"
gcloud storage ls --all-versions --long "gs://$BUCKET/$OBJ"
GEN=1760950000000000                                                        # the last good generation from the listing
gcloud storage cp "gs://$BUCKET/$OBJ#$GEN" "$WORKDIR/candidate"             # inspect it locally first
gcloud storage cp "gs://$BUCKET/$OBJ#$GEN" "gs://$BUCKET/$OBJ" --if-generation-match="$(gcloud storage objects describe "gs://$BUCKET/$OBJ" --format='value(generation)')"
```

The precondition makes the copy fail if someone wrote the object again between your check and the copy. The `generation` field name in the `describe` output is the usual one; check the output if the value comes back empty. For many objects, script the same loop from `ls --all-versions` output and review the list of `(object, generation)` pairs before running it.

### 5. Restore a deleted bucket

The `restore` command accepts a bucket URL with a generation (`gs://bucket#123`), and there is no `gcloud storage buckets restore` subcommand. Per search excerpts of the soft-deleted buckets pages, a soft-deleted bucket can be restored within its soft delete retention period; it comes back live, and its objects are then recoverable as in step 3 within the same window.

```bash
gcloud storage ls --soft-deleted --buckets "gs://$BUCKET" --full     # find the bucket generation; this combination was not run
gcloud storage restore "gs://$BUCKET#BUCKET_GENERATION"
gcloud storage ls "gs://$BUCKET/$PREFIX"                              # objects are likely still soft-deleted: continue with step 3
```

`BUCKET_GENERATION` comes from the listing. If someone has already created a new bucket with the same name, check the "Use soft-deleted buckets" page for what that means for the restore before doing anything else.

### 6. Cost

Soft-deleted data is billed at its storage class rate until its retention ends, and per the soft delete page early-deletion charges can apply for non-Standard classes. A bulk restore of a whole bucket also creates new live objects (more storage) and, with `--exhaustive`, more LIST calls. None of this is a reason to delay a restore; it is a reason to restore only the prefix and time window that matter, and to record the cost in the incident. Check the Cloud Storage pricing page for current figures.

## Validation

Compare the restored set with the list you expected, by count and by hash:

```bash
gcloud storage ls "gs://$BUCKET/$PREFIX**" | sort > "$WORKDIR/live-after.txt"
wc -l "$WORKDIR/live-after.txt"
comm -13 "$WORKDIR/live-after.txt" <(sed 's/#.*//' "$WORKDIR/restore-list.txt" | sort -u)   # expected but still missing; should be empty
gcloud storage du --summarize "gs://$BUCKET/$PREFIX"
gcloud storage hash "gs://$BUCKET/reports/2026/q3.csv"                                        # compare with a hash you trust
```

- Every object you meant to restore is live, and nothing extra was restored. For overwrite restores, spot-check content, not only names.
- Hashes match a known good source where you have one: an inventory, a manifest, a backup copy, or `gcloud storage ls -L` output captured before the incident.
- `gcloud storage operations describe` shows the bulk restore as done without errors.
- The applications that read the bucket work, and nothing new is being deleted (watch the audit logs or the object count for a few hours).
- Record the result, timings and gaps in the incident and in the next restore drill.

## Rollback

- A restore creates new live generations; it does not destroy anything that soft delete or versioning was keeping. If you restored the wrong set, delete the wrongly restored live objects (they become soft-deleted or noncurrent in turn) and restore the right generations.
- If `--allow-overwrite` replaced objects you wanted, the replaced content is noncurrent (versioning on) or soft-deleted (versioning off) and can be restored with steps 3 or 4 within its retention period.
- Put back the lifecycle rules from version control once the cause is fixed, and compare with `bucket-before.txt`.
- Revoke any temporary IAM grant made for the restore.

## Troubleshooting

| Symptom                                                    | Likely cause and fix                                                                                                                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ls --soft-deleted` prints nothing                         | Soft delete was off, retention has passed, or the listing returned empty pages. Retry with `--exhaustive`. If the policy was off, restore from backup.                                         |
| Restore returns a permission error                         | The caller lacks `storage.objects.restore` or `storage.objects.create` (or `storage.buckets.restore` for bulk). Grant temporarily; check the permission table on the soft-deleted objects page. |
| Restore fails with a precondition error                    | A live object with that name changed, or your `--if-generation-match` value is stale. Re-read the generation and retry.                                                                       |
| Restore fails on a CMEK-encrypted object (not verified)    | The Cloud KMS key version may be disabled or destroyed. Re-enable a disabled version first, see [[cloud-kms-key-management]]; a destroyed version cannot be brought back.                      |
| Objects reappear, then disappear again                     | The cause is still active: a lifecycle rule, a sync job with delete, or a credential. Go back to step 1.                                                                                       |
| Restored objects are wrong content                         | The wrong generation or time window. Use `ls --all-versions` or the soft-deleted listing with `--long`, pick by time, and restore that generation.                                             |
| Delete was blocked, but the app still lost data            | A retention policy or hold protected the objects; the data loss is elsewhere (an overwrite in another bucket, a cache). Check what the app actually reads.                                    |
| Bulk restore is slow or still running                      | Bulk restore is a long-running operation. Track it with `operations describe`, and do not start a second overlapping restore.                                                                  |
| The bucket or project is gone and soft delete does not help | A deleted project's buckets cannot be restored this way. Restore from the backup copy described in [[backup-architecture-gke-cloud-sql-gcs]].                                                 |

## Prevention

- Keep soft delete on for buckets that hold anything you cannot rebuild, with a retention long enough to cover your detection time; add Object Versioning (with a lifecycle rule that limits noncurrent versions) where overwrites are the risk. See [[backup-architecture-gke-cloud-sql-gcs]] and [[terraform-module-and-state-layout]].
- Turn on Data Access audit logs for buckets where you need to know who deleted what, and accept their cost knowingly ([[gcp-audit-logs-siem]]).
- Give writers `storage.objects.create` without `storage.objects.delete` where the workload allows it.
- Keep a second copy outside the blast radius of one credential, and restore from it in the quarterly drill.

## Related

- [[backup-architecture-gke-cloud-sql-gcs]] for the backup design, versioning and retention policy trade-offs.
- [[0051-backups-proven-by-quarterly-restore-drills]] for the drill this runbook feeds.
- [[terraform-state-recovery]] for the same versioned-object method applied to Terraform state.
- [[compromised-cloud-cluster-containment]] and [[leaked-credential-rotation]] when the deletion was malicious.
- [[legal-hold-for-logs-and-artifacts]] when evidence must be kept.
- [[gcp-audit-logs-siem]] for audit log coverage.
- [[incident-response]] for running the incident.

## Sources

- [Cloud Storage: Soft delete](https://docs.cloud.google.com/storage/docs/soft-delete): default, minimum and maximum retention, billing, compatibility, project deletion; checked from a search excerpt, 2026-10-21.
- [Cloud Storage: Use soft-deleted objects](https://docs.cloud.google.com/storage/docs/use-soft-deleted-objects): restore behaviour and permissions; checked from a search excerpt, 2026-10-21.
- [Cloud Storage: Soft-deleted buckets](https://docs.cloud.google.com/storage/docs/soft-deleted-buckets) and [Use soft-deleted buckets](https://docs.cloud.google.com/storage/docs/use-soft-deleted-buckets): bucket restore; checked from a search excerpt, 2026-10-21.
- [Cloud Storage: Object Versioning](https://docs.cloud.google.com/storage/docs/object-versioning) and [Use versioned objects](https://docs.cloud.google.com/storage/docs/using-versioned-objects).
- [Cloud Storage: Audit logging](https://docs.cloud.google.com/storage/docs/audit-logging): Admin Activity always on, Data Access off by default; checked from a search excerpt, 2026-10-21.
- `gcloud storage restore`, `ls`, `operations`, `objects describe`, `hash`, `du` and `buckets update`: checked with `--help` in Google Cloud SDK 570.0.0, 2026-10-21. Reference: [gcloud storage restore](https://cloud.google.com/sdk/gcloud/reference/storage/restore).
