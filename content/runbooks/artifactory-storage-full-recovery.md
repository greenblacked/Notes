---
title: Artifactory storage full recovery
description: "Recover Artifactory when its filestore or database disk fills, reclaim space with cleanup policies and garbage collection, and stop it recurring."
type: runbook
tags:
  - runbooks
  - artifactory
  - reliability
  - incident-management
created: 2026-10-19
modified: 2026-10-19
draft: false
---

A full disk is the most common way Artifactory goes down slowly and then all at once. Uploads start failing with write errors, then the database cannot write, then the service stops answering. The cure is rarely complicated, but the wrong cure (deleting files on the host) corrupts the repository. This runbook shows how to measure, stop the growth, reclaim space through Artifactory itself, and prevent a repeat.

> [!info] Scope and verification
> Nothing here was run against a live instance, and the note is not marked `verified`. Cleanup policies, the trash can and garbage collection behave differently by edition and version, and the storage API paths may differ. Check the current JFrog Artifactory documentation for your version before running destructive steps.

## When to use

- Uploads and deployments fail with write or "no space left on device" errors.
- The UI or the logs show storage warnings, or the host's monitoring shows the filestore, database or logs volume near full.
- A previous recovery (see [[artifactory-outage-cache-fallback]]) found storage to be the cause.

## Preconditions

- Edition and version are written down, along with the storage layout: where the filestore lives (local disk, network file system or an object store), where the database lives, and where logs go.
- A recent backup of the database and of the Artifactory configuration exists and has been restored at least once in a test. Without that, treat every deletion below as permanent.
- A maintenance window if you must stop the service to grow a disk, recorded per [[production-change-checklist]].
- If the incident is broad, [[incident-response]] is already running.

```bash
ART_HOME=/opt/jfrog/artifactory/var     # adjust to your install; check the docs for your layout
ART_URL=https://artifactory.example.com
: "${ART_TOKEN:?set ART_TOKEN from your secret store}"
```

## Steps

### 1. Measure

Find which volume is full before doing anything else. The cases are different.

```bash
df -hT                                  # which mount is at 100 percent
du -xh --max-depth=2 "$ART_HOME" 2>/dev/null | sort -h | tail -20
df -i                                   # inodes can run out before bytes
```

Three separate cases:

| Volume          | What fills it                                                     | Where to look                                  |
| --------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| Filestore       | Binaries from uploads and remote caches                           | Repository sizes (step 2), trash can, GC state |
| Database volume | Metadata, indexes, write-ahead logs, replication slots, bloat     | The database host, not Artifactory             |
| Logs and temp   | Verbose logging, heap dumps, core files, request logs not rotated | Log directory, rotation settings, dump files   |

A full **database volume** can look like an Artifactory failure but must be fixed on the database host: free WAL or logs, remove an abandoned replication slot, extend the volume, and only then restart Artifactory. A full **logs volume** is the easy case: rotate or compress logs, delete old dumps, then fix the log level that caused it.

### 2. Find the biggest repositories

Use the storage summary in the UI, or the storage info REST API. Verify the endpoint for your version in the docs.

```bash
curl -sS -H "Authorization: Bearer $ART_TOKEN" \
  "$ART_URL/artifactory/api/storageinfo" \
  | jq '.repositoriesSummaryList | sort_by(.usedSpaceInBytes // 0) | reverse | .[0:15]
        | map({repoKey, repoType, packageType, usedSpace, filesCount})'
```

Typical culprits: snapshot or build repositories without retention, a Docker repository with every CI image tag, remote caches of large upstreams, and a "temporary" repository that became permanent. Note the top five and who owns them.

### 3. Stop the bleeding

Reclaiming space while uploads continue is a treadmill.

- Pause the heaviest CI jobs and scheduled image builds. Announce it in the incident channel.
- Freeze snapshot and build-info repositories that grow fastest. Consider making a repository read-only for the duration, if your edition allows it. Check the docs, and do not block the release path unless you must.
- Ask the owners of the top repositories to stop publishing until cleanup is done.

### 4. Free space safely

> [!danger] Never delete files from the filestore directory on disk
> The filestore holds checksum-addressed binaries that many artifacts may reference. Deleting files by hand with `rm` corrupts the repository: artifacts remain in the database but their content is gone, builds then fail with checksum or 404 errors that are hard to trace. Always delete through Artifactory (UI, REST API or cleanup policies) and let garbage collection remove the unreferenced binaries.

Work in this order:

1. **Review the delete list first.** Produce the list of what a policy or a query would remove and have the repository owner approve it. Deletions are irreversible apart from the trash can and backups.
2. **Apply retention.** Use cleanup policies that match your [[artifact-retention-policy]]: for example old snapshots, artifacts never downloaded for a long period, and old Docker tags beyond the agreed count. Run the policy in a dry-run mode if your version offers one; check the current docs for how it works.
3. **Empty the trash can.** In many setups deleted items go to the trash can first and still occupy disk space until it is emptied or its own retention expires.
4. **Run garbage collection.** Deleting an artifact frees the disk only after garbage collection removes binaries no longer referenced. Whether GC runs on a schedule, how it behaves under load and what the trash can does vary by edition and version, so read the current documentation, then run it in a quiet period.

```bash
# Example: find a candidate set in one repository before any delete (AQL).
# Replace the repository, the age and the path with values you have agreed.
curl -sS -X POST -H "Authorization: Bearer $ART_TOKEN" -H "Content-Type: text/plain" \
  "$ART_URL/artifactory/api/search/aql" \
  --data 'items.find({"repo":"example-snapshots","created":{"$before":"90d"}}).include("repo","path","name","size")' \
  | jq '.results | length, (map(.size) | add)'
```

The query reports the count and total bytes only. Review the list, record it in the change record, then delete through a policy or an explicit reviewed script. After the deletion, check how much space is now in the trash can versus actually freed on disk.

### 5. Grow the disk if cleanup is not enough

If the data is legitimate and the growth is real, add capacity: extend the volume, or move the filestore to a larger volume or an object store. The mechanics depend on where the filestore is. For a cloud persistent disk, resize the disk and the file system, restart only if the file system needs it, and confirm with `df -h`. For a Kubernetes install, expand the PersistentVolumeClaim if the storage class allows it (see [[kubernetes-pod-troubleshooting]] for Pod-level checks). Check the documentation for filestore changes in HA setups, where all nodes must see the same data.

### 6. Prevent a recurrence

- **Alerts.** Disk usage on the filestore, database and logs volumes with a warning threshold (for example at the point you can still react during working hours) and a critical threshold with paging. Alert on growth rate, not only on level.
- **Retention.** Every snapshot, build-info and remote-cache repository has a retention rule, owned by a named team. New repositories do not ship without one.
- **Quotas and reviews.** Review the top repositories monthly and compare with the previous month; unexplained growth is a bug in a pipeline.
- **Garbage collection.** Make sure GC runs on a schedule and that someone watches its result.
- **Capacity planning.** Track the growth trend and extend with margin, not at 100 percent.

## Validation

```bash
df -hT                                                     # free space is back above the alert threshold
curl -sS -o /dev/null -w "ping: %{http_code}\n" "$ART_URL/artifactory/api/system/ping"
curl -sS -H "Authorization: Bearer $ART_TOKEN" "$ART_URL/artifactory/api/storageinfo" \
  | jq '.binariesSummary'                                   # field names vary by version
```

Confirm that:

- Free space is above the warning threshold on every affected volume and stays there for the observation period.
- A test deploy and a test download work in a repository that was failing.
- A build that depends on artifacts you kept still resolves, including one that uses an old release (to catch accidental deletion).
- The next scheduled GC and cleanup jobs run and report no errors.

## Rollback

Deletion is the one-way part. Plan for it:

- **Before deleting:** keep the reviewed delete list, and the trash can intact until the validation is done.
- **If you deleted too much:** restore from the trash can if the item is still there; otherwise restore from backup into a staging instance and copy the artifacts back. Rebuilding from source is often possible for snapshots but not for released artifacts that were not reproducible.
- **If a cleanup policy was wrong:** disable it first, then correct its rule. Do not run it again to "fix" it.
- **If you grew the disk and the change failed:** the old volume is the rollback; keep it until the new one is validated.
- **If you froze repositories:** lift the freeze in the reverse order and tell the owners in the incident channel.

## Troubleshooting

| Symptom                                             | Likely cause and fix                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Deleted a lot, disk usage unchanged                 | Trash can not emptied or GC has not run. Empty the trash, run GC (check the docs for your version).               |
| GC runs but frees little                            | Binaries are still referenced (for example by build info or other repositories). Find and clean those references. |
| Service will not start, logs say disk full          | Free space on the logs or temp volume first so it can start, then clean through Artifactory.                      |
| Database errors but filestore has space             | Database volume full or connection limit. Fix on the database host, see step 1.                                   |
| 404 or checksum errors after manual cleanup on disk | Files were removed from the filestore by hand. Restore from backup; do not continue deleting by hand.             |
| Cleanup policy removes nothing                      | Policy scope or age rule does not match, or it is disabled. Review the policy against the AQL result in step 4.   |
| Space comes back within days                        | A pipeline publishes without retention. Find the repository from the growth chart and apply a rule.               |

## Related

- [[artifact-retention-policy]] for the retention rules these cleanups should implement.
- [[artifact-promotion-artifactory]] for promotion between repositories, which changes what each repository holds.
- [[artifactory-outage-cache-fallback]] when the service is down while you work on storage.
- [[incident-response]] for roles and communication, and [[production-change-checklist]] for the window and the change record.

## Sources

- [JFrog Artifactory documentation](https://jfrog.com/help/r/jfrog-artifactory-documentation): the pages on cleanup policies, garbage collection, the trash can and the storage summary. Check the page for your Artifactory edition and version.
