---
title: SonarQube server upgrade and database migration
description: "Upgrade a self-managed SonarQube server along a supported path, with a tested database backup, a watched migration and a restore-based way back."
type: runbook
tags:
  - runbooks
  - sonarqube
  - ci-cd
  - reliability
created: 2026-10-19
modified: 2026-10-19
draft: false
---

A SonarQube upgrade is mostly a database migration with a web server attached. The server starts on the new version, notices the schema is old, and waits for you to trigger the migration. If something goes wrong half way, there is no in-place downgrade, so your real rollback is a restore of the database and directories you backed up before you began. Plan the upgrade around that fact.

> [!info] Scope and verification
> The commands and endpoints were not run against a live SonarQube when this note was written, and the note is not marked `verified`. Supported upgrade paths, endpoint paths, requirements and the downgrade policy change between releases and editions. Take the path and requirements for your exact versions from the SonarQube upgrade documentation, not from this note.

## When to use

- You run a self-managed SonarQube server (Docker, Helm chart or zip install) and need to move to a newer release, including a move to a new long-term support line.
- A security fix requires a newer version.
- The current version is out of support or incompatible with the scanner or plugin versions your pipelines need.

SonarQube Cloud has no server to upgrade; this note does not apply to it.

## Preconditions

- **Upgrade path.** Read the upgrade guide and its upgrade-path table for your source and target versions. Do not skip versions outside the supported path; if the path needs an intermediate release, upgrade to it and let the migration finish first.
- **Compatibility.** Check the new version's requirements: database type and version, Java version, operating system limits and kernel settings. Check that every installed plugin has a compatible release, and that scanners in CI are supported by the target server version.
- **Backups.** A database backup, the data directory, the extensions directory (plugins) and the `conf` directory, all taken with the server stopped, and a tested restore into a scratch environment.
- **Window and communication.** A maintenance window per [[change-freezes-and-maintenance-windows]] and a change record per [[production-change-checklist]]. Quality gates in CI are paused or made non-blocking for the window (see [[sonarqube-quality-gates]]), so pipelines do not fail on an unreachable server.
- A staging server upgraded first with a copy of the production database, to learn how long the migration and the index rebuild take.

```bash
SONAR_URL=https://sonarqube.example.com
SONAR_HOME=/opt/sonarqube                 # adjust to your install
BACKUP_DIR=/backups/sonarqube/$(date +%Y%m%d)
DB_HOST=db.example.com
DB_NAME=sonarqube
DB_USER=sonarqube                          # the password comes from PGPASSFILE or a secret, never the command line
```

## Steps

> [!note] Credentials on the command line
> Passing a token with `-u` puts it in the process arguments, where other users on a shared host can read it. On a shared host use a `~/.netrc` file with mode 600 and `curl -n`, or a header file passed with `-H @file`.

### 1. Pre-checks

```bash
# Current version and status. Verify the endpoint paths in the documentation for your version.
curl -sS "$SONAR_URL/api/system/status"
curl -sS "$SONAR_URL/api/server/version"

# Plugins installed (admin token from the environment)
curl -sS -u "$SONAR_TOKEN:" "$SONAR_URL/api/plugins/installed" | jq '.plugins[] | {key, version}'

# Host settings the search component needs
sysctl vm.max_map_count fs.file-max
ulimit -n
```

Write down the versions. Check the database size and free space on the database volume, because the migration may need room to work.

### 2. Stop the server

Stop analyses first: pause or hold CI pipelines that submit results, and wait for the background task queue to empty (the Administration, Projects, Background Tasks page). Then stop the server cleanly.

```bash
# Package, zip or systemd install
sudo systemctl stop sonarqube

# Kubernetes (Helm chart): scale the StatefulSet to zero
kubectl -n sonarqube scale statefulset sonarqube --replicas=0
```

Confirm no process is left and nothing is writing to the database:

```bash
pgrep -af sonar || echo "stopped"
```

### 3. Back up

With the server stopped:

```bash
mkdir -p "$BACKUP_DIR"
# PostgreSQL example. -Fc gives a custom-format dump that pg_restore can restore selectively.
pg_dump -h "$DB_HOST" -U "$DB_USER" -Fc -f "$BACKUP_DIR/$DB_NAME.dump" "$DB_NAME"
sha256sum "$BACKUP_DIR/$DB_NAME.dump" > "$BACKUP_DIR/$DB_NAME.dump.sha256"

tar -C "$SONAR_HOME" -czf "$BACKUP_DIR/sonar-dirs.tgz" data extensions conf
```

Store the backup off the host. Check it: list the dump contents with `pg_restore --list` and confirm the archive size is plausible. A backup that was never restored is a hope, not a backup; restore it into the scratch database before the window if you have not done so.

For a managed database (for example Cloud SQL), take an on-demand backup or snapshot instead, and note its identifier. See [[backup-architecture-gke-cloud-sql-gcs]] for the pattern.

### 4. Install the new version

- **Zip install:** unpack the new version into a new directory, copy over `conf/sonar.properties` and wrapper settings, and reinstall compatible plugins into the new `extensions/plugins`. Do not copy old plugin jars blindly.
- **Docker or Helm:** change the image tag or chart version in version control, review the diff of the chart's values between versions, and apply. For the release mechanics and how to return to a previous chart revision, see [[helm-release-rollback]]; remember that a chart rollback does not roll back the database.

```bash
helm -n sonarqube diff upgrade sonarqube sonarqube/sonarqube -f values.yaml --version <chart-version>   # needs the helm-diff plugin
helm -n sonarqube upgrade sonarqube sonarqube/sonarqube -f values.yaml --version <chart-version>
```

Replace `<chart-version>` with the version you selected from the documentation; do not leave it unpinned. Pin the image tag explicitly too.

### 5. Start and run the database migration

Start the server. On the first start with a newer version it serves a maintenance page and waits for the database upgrade.

```bash
sudo systemctl start sonarqube
curl -sS "$SONAR_URL/api/system/status"          # expect a status that says the database migration is needed
```

Trigger the migration from the setup page at `$SONAR_URL/setup` in the browser, or through the web API documented for your version (it uses a POST to a database migration endpoint). Do this once.

> [!warning] Do not restart in the middle of a migration
> A partial migration leaves the schema in a state neither version understands. Do not stop, restart or scale the server while it runs, and do not run a second migration trigger. If the process dies on its own, restore the backup and start again rather than retrying on a half-migrated database.

### 6. Watch the logs and the status

```bash
sudo tail -F "$SONAR_HOME/logs/sonar.log" "$SONAR_HOME/logs/web.log"
# Kubernetes
kubectl -n sonarqube logs -f sonarqube-0

# Poll status
while true; do curl -sS "$SONAR_URL/api/system/status"; echo; sleep 15; done
```

Phases to expect: schema migration steps, then the search indexes being rebuilt. After an upgrade the search indexes are rebuilt, and on a large instance this can take a long time and use a lot of CPU and disk; your staging run gives you a realistic estimate. Do not announce completion until the status says the server is up and the projects appear in the UI.

## Validation

```bash
curl -sS "$SONAR_URL/api/system/status"        # expect "status":"UP" and the new version
curl -sS "$SONAR_URL/api/server/version"
curl -sS -u "$SONAR_TOKEN:" "$SONAR_URL/api/plugins/installed" | jq '.plugins | length'
```

- Log in, and open a project with history: measures, issues and the activity graph are present.
- Run a real CI analysis on a sample project and check that the background task succeeds.
- Open a merge request with decoration enabled and confirm the quality gate result is posted.
- Re-enable the quality gate in CI pipelines and revert any non-blocking settings you added for the window.
- The log has no repeating errors for the observation period, and background tasks finish in normal time.

## Rollback

There is no supported in-place downgrade; verify this for your release in the documentation. Rollback means returning to the pre-upgrade state:

1. Stop the new server.
2. Restore the database from the backup: drop and recreate the database, or restore into an empty one. Do not restore with `pg_restore --clean` over the migrated database: it drops only the objects that are in the dump, so tables and indexes added by the new version stay behind and the schema ends up mixed. Verify the checksum first.

```bash
dropdb -h "$DB_HOST" -U "$DB_USER" "$DB_NAME"
createdb -h "$DB_HOST" -U "$DB_USER" -O "$DB_USER" "$DB_NAME"
sha256sum -c "$BACKUP_DIR/$DB_NAME.dump.sha256"
pg_restore -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" --no-owner "$BACKUP_DIR/$DB_NAME.dump"
```

3. Restore the `data`, `extensions` and `conf` directories from the archive, or redeploy the previous image tag and chart revision.
4. Start the old version and validate as above. Analyses submitted to the new server during the window are lost; tell teams to re-run them.

Decide the rollback trigger before the window (for example "migration not finished within the time we measured on staging plus a margin"), so you do not debate it under pressure.

## Troubleshooting

| Symptom                                                             | Cause and fix                                                                                         |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Server refuses to start, mentions an unsupported path               | You skipped a required intermediate version. Restore, upgrade via the supported path.                 |
| Search component fails: `vm.max_map_count` too low                  | Raise the kernel setting on the host (or node) as the documentation requires, then start again.       |
| Search index rebuild takes very long                                | Normal after upgrade on large instances. Wait; check CPU, disk and heap; do not restart.              |
| A plugin is reported as incompatible                                | Install a compatible version or remove it. A missing plugin can change quality profiles; review them. |
| Migration fails with a database permission error                    | The database user lacks schema change rights. Fix permissions, restore the backup, retry once.        |
| CI scanners fail after the upgrade                                  | Scanner version unsupported or token invalid. Check scanner compatibility and credentials.            |
| `/api/system/status` shows the migration as running for a long time | Large database. Watch the logs for progress; do not interrupt.                                        |

## Related

- [[sonarqube-quality-gates]] for the gates you pause and re-enable.
- [[change-freezes-and-maintenance-windows]] and [[production-change-checklist]] for the window and the record.
- [[helm-release-rollback]] for chart rollbacks (which do not restore the database).
- [[incident-response]] if the server fails to come back.

## Sources

- [SonarQube Server: upgrade the server](https://docs.sonarsource.com/sonarqube-server/latest/setup-and-upgrade/upgrade-the-server/), and its upgrade path and release notes pages.
