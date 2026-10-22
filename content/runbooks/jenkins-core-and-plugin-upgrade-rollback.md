---
title: Upgrade Jenkins core and plugins with a way back
description: Upgrade a Jenkins controller's core and plugins through a pinned image and plugins.txt, with a JENKINS_HOME snapshot, a smoke test and a tested rollback.
type: runbook
tags:
  - runbooks
  - jenkins
  - ci-cd
  - security
  - reliability
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Most Jenkins outages that are not disk or memory start with an upgrade: a plugin that needs a newer core, a core that needs a newer Java, two plugins that disagree about a shared dependency, or a configuration file rewritten in a format the old version cannot read. Security advisories make upgrades frequent, so the answer is not to upgrade less, but to make every upgrade a small, rehearsed change with a known way back.

The way back has two parts, and you need both: the **previous image** (core plus plugin set) and the **previous `JENKINS_HOME`** (configuration, jobs, build records, and the plugin files the controller actually loads). This runbook covers planned upgrades. If the controller is already down, start with [[jenkins-controller-down-and-queue-stuck]].

> [!info] Scope and verification
> Checked on 2026-10-21 against the documentation source of the Jenkins handbook (managing plugins, backing up), the plugin installation manager tool and the official Docker image READMEs, the configuration-as-code plugin docs, and the Jenkins core source for quiet down and the `.bak` downgrade files. Nothing was run against a live controller, and the note is not marked `verified`. It names no Jenkins, Java or plugin versions on purpose: read the pages linked below for your target. **Not verified:**
>
> - the contents of the Jenkins LTS upgrade guide (read it for every LTS line you cross);
> - whether a downgraded core or plugin can read configuration that the newer version has already rewritten (assume it may not; the `JENKINS_HOME` restore is the primary rollback);
> - the UI downgrade button and how long `.bak` files are kept (seen in core source only, not in the handbook);
> - the `/manage` prefix of the configuration-as-code endpoints on older plugin versions.

## When to use

- A Jenkins security advisory affects core or a plugin you run.
- A new LTS release is due under your [[dependency-update-policy]], or your current line is near end of life ([[end-of-life-tracking-platform-versions]]).
- A plugin update is blocked by a dependency on a newer core or another plugin.
- A Java runtime upgrade for the controller or the agents.

## Preconditions

- **Pinned state in Git.** The controller image is built from a Dockerfile with an exact core tag, a `plugins.txt` with an exact version for every plugin, and JCasC YAML for the configuration, as in [[jenkins-agents-configuration-as-code-and-shared-libraries]]. Plugins installed by hand in the UI are drift: capture them first (step 2).
- **A backup you have restored at least once.** The handbook recommends filesystem snapshots (LVM, btrfs, ZFS or the cloud provider's disk snapshots) for the most consistent backup. On GKE that is a snapshot of the persistent disk behind `JENKINS_HOME`.
- **A staging controller** that can start from a copy of production `JENKINS_HOME` with outbound notifications, deployments and SCM webhooks disabled.
- A change record and a maintenance window agreed with the teams, following [[production-change-checklist]].

```bash
JENKINS_URL=https://jenkins.example.com
# export JENKINS_USER=...  JENKINS_TOKEN=...   # an API token from your secret store; never commit it
NS=jenkins                                    # namespace of the controller, if it runs on Kubernetes
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
```

> [!warning] A full backup contains the controller key
> The handbook says never to include the controller key in an ordinary Jenkins backup: `secrets/hudson.util.Secret` is encrypted with `secrets/master.key`, which must be backed up separately and securely. A whole-disk snapshot contains both, so anyone who can read the snapshot can decrypt every stored credential. Restrict access to snapshots as tightly as to the controller itself, see [[jenkins-controller-and-agent-hardening]].

## Steps

### 1. Read before you change anything

- The **LTS upgrade guide** for every LTS line between your current and target version. It lists breaking changes, removed features and required plugin versions.
- The **changelog** of each plugin that will change, especially major versions.
- The **Java support policy** page. A controller started on an unsupported Java version does not run, and the requirement covers the controller, the agents and CLI clients. If the target needs a newer Java, upgrade Java as its own change first, following the Java upgrade guide (it includes a Script Console script to check agents' Java versions).
- The **security advisories** that triggered the upgrade, so you know which plugins must move and which may stay.

Write the result into the change record: target core, plugins that change, Java requirement, known breaking changes.

### 2. Record the current versions and back up

Record what is actually loaded, not what the repository says. The script endpoint runs Groovy with full rights and needs the Administer permission; use it from an admin workstation, never from a build:

```bash
# Plugins and versions from the running controller (Script Console snippet from the handbook, run over the API)
curl -sS -X POST -u "$JENKINS_USER:$JENKINS_TOKEN" "$JENKINS_URL/scriptText" \
  --data-urlencode 'script=Jenkins.instance.pluginManager.plugins.sort{it.shortName}.each { println("${it.shortName}:${it.version}") }' \
  > "plugins-running-$STAMP.txt"

curl -sS -u "$JENKINS_USER:$JENKINS_TOKEN" -o /dev/null -D - "$JENKINS_URL/login" | grep -i '^x-jenkins:'   # core version header
diff <(sort plugins.txt) <(sort "plugins-running-$STAMP.txt")                                        # drift between Git and reality
```

If the diff shows plugins that are not in `plugins.txt`, add them to Git now and rebuild the **current** image with them, so that rollback (the previous image) matches reality.

Then take the backup, with the controller quiet (step 3) so no build is writing:

```bash
# GKE: snapshot the persistent disk behind JENKINS_HOME (find it from the PVC's PV)
PV=$(kubectl -n "$NS" get pvc jenkins-home -o jsonpath='{.spec.volumeName}')
kubectl get pv "$PV" -o jsonpath='{.spec.csi.volumeHandle}{"\n"}'    # projects/<p>/zones/<z>/disks/<disk>
gcloud compute snapshots create "jenkins-home-pre-upgrade-$STAMP" \
  --source-disk=DISK_NAME --source-disk-zone=ZONE
```

Replace `jenkins-home`, `DISK_NAME` and `ZONE` with your PVC name and the disk from the volume handle. If you use a `VolumeSnapshot` class instead, take the snapshot that way; the point is a point-in-time copy of the whole volume. On a VM, use the platform's disk snapshot. If snapshots are not available, the handbook's minimum file set is `JENKINS_HOME/*.xml`, `jobs/` and `plugins/*.jpi` (or `*.hpi`), with `secrets/master.key` stored separately.

### 3. Quiet down and drain

Quiet down stops new builds from starting while running builds finish. It needs the Manage permission.

```bash
curl -sS -X POST -u "$JENKINS_USER:$JENKINS_TOKEN" \
  "$JENKINS_URL/quietDown" --data-urlencode "message=Upgrade in progress, change $STAMP"

# Running builds; wait until this prints 0, or until the window says to stop waiting
curl -sS -u "$JENKINS_USER:$JENKINS_TOKEN" \
  "$JENKINS_URL/computer/api/json?tree=computer[executors[currentExecutable[url]],oneOffExecutors[currentExecutable[url]]]" \
  | jq '[.computer[] | ((.executors // []) + (.oneOffExecutors // []))[] | .currentExecutable] | map(select(. != null)) | length'
```

In core source, `quietDown` also accepts `block` and `timeout` (milliseconds) parameters, and the CLI has `quiet-down` with `-block`, `-timeout` and `-reason`. The CLI help notes that running Pipeline builds do not block quiet down: they pause at the end of their current step. Decide in advance which long builds you will abort when the window starts.

### 4. Build and roll out the new controller image

The preferred path changes **Git**, not the running controller. Bump the core tag and the plugin versions together:

```dockerfile title="controller/Dockerfile"
# CORE_TAG is the exact LTS tag you chose in step 1 (an LTS tag with the JDK suffix you run), never "lts"
ARG CORE_TAG
FROM jenkins/jenkins:${CORE_TAG}
COPY --chown=jenkins:jenkins plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt --latest=false --view-all-security-warnings
# Keep JCasC outside JENKINS_HOME: the volume mounted at /var/jenkins_home would hide files baked there
COPY --chown=jenkins:jenkins casc/ /etc/jenkins/casc/
ENV CASC_JENKINS_CONFIG=/etc/jenkins/casc
```

```text title="controller/plugins.txt (excerpt)"
configuration-as-code:VERSION
git:VERSION
kubernetes:VERSION
workflow-aggregator:VERSION
```

Replace each `VERSION` with an exact version. Find the update candidates with the tool itself, against the **target** core:

```bash
docker run --rm -v "$PWD/plugins.txt:/tmp/plugins.txt:ro" "jenkins/jenkins:$CORE_TAG" \
  jenkins-plugin-cli --plugin-file /tmp/plugins.txt --available-updates --output txt > plugins-candidates.txt
diff plugins.txt plugins-candidates.txt
```

The tool accepts only a plugins file ending in `.txt`, `.yaml` or `.yml`, which is why the file is mounted rather than piped. Do not take every candidate blindly: bump what the advisories and the target core require, plus what those bumps pull in, and leave the rest for a later, smaller change.

Notes on `jenkins-plugin-cli`, from its README:

- `--latest` defaults to `true`, which lets dependencies pull newer versions than you pinned. `--latest=false` keeps your pins and fails if they cannot be satisfied, which is what you want in a reviewed upgrade.
- `--view-all-security-warnings` prints the security warnings for the resolved set; review them in the build log.
- `--plugin-download-directory` is deleted and recreated, so never point it at a live `plugins/` directory.

Roll out: build, push, and change the image tag through your deployment pipeline (Helm values or manifests in Git). On Kubernetes the controller Pod is replaced, which is the restart.

> [!warning] The image upgrades plugins in `JENKINS_HOME`, but never downgrades them
> At start-up the official image copies reference files from `/usr/share/jenkins/ref` into `JENKINS_HOME` only when they are missing; it does not override other existing files (a `.override` suffix on the reference file forces it). For plugins, the image README says a plugin is upgraded when the image's version is **newer** and the plugin was not upgraded manually (tracked through a marker file); `PLUGINS_FORCE_UPGRADE=true` also upgrades manually upgraded plugins, and `TRY_UPGRADE_IF_NO_MARKER=true` covers homes written by images without markers. So a new image upgrades plugins, but going back to an older image does **not** put older plugin files back. Some Helm charts install plugins into `JENKINS_HOME` on every start instead; check how yours does it.

**Legacy controllers** that are managed in the UI: Manage Jenkins, Plugins, Updates, then "Download now and install after restart", and restart once all downloads finish. The update center only offers the newest release of each plugin. Capture the result into `plugins.txt` afterwards so the next upgrade can follow the preferred path.

### 5. Watch the start-up

```bash
kubectl -n "$NS" logs -f statefulset/jenkins -c jenkins | grep -i -E 'SEVERE|WARNING|Failed to load|dependency|requires'
```

Adjust the workload and container names to your install. Look for:

- **Plugins that failed to load**, usually because a dependency is missing or too old, or a plugin needs a newer core. Manage Jenkins also lists them after start-up.
- **Old data warnings.** Configuration left behind by removed or changed plugins is kept and reported; Manage Jenkins, "Manage Old Data", shows it. Do not purge it during the upgrade window: it is part of your way back.
- **JCasC errors.** Validate the configuration against the running controller without applying it:

```bash
curl -sS -X POST -u "$JENKINS_USER:$JENKINS_TOKEN" \
  -H "Content-Type: application/yaml" --data-binary @casc/jenkins.yaml \
  "$JENKINS_URL/manage/configuration-as-code/check"     # [] means valid; needs SYSTEM_READ
```

Older plugin versions serve the endpoint without the `/manage` prefix; check the plugin docs for your version. Run the same check on the staging controller before production.

### 6. Smoke test before you reopen

- A Pipeline from each major team runs end to end, including checkout, a build on a Kubernetes agent, credentials binding, a shared library load ([[jenkins-shared-libraries]]) and artifact or report publishing.
- Agents connect: static agents are online, and new Kubernetes agent Pods start and finish.
- Login and authorization work for a normal user, not only for an admin.
- Webhooks from the SCM trigger builds.
- If the controller talks to SonarQube, Artifactory or other tools through plugins, one build exercises each integration (see also [[sonarqube-upgrade-and-db-migration]] if that tool is being upgraded in the same window; avoid that).

Then cancel quiet down if the restart did not clear it:

```bash
curl -sS -X POST -u "$JENKINS_USER:$JENKINS_TOKEN" "$JENKINS_URL/cancelQuietDown"
```

## Validation

```bash
curl -sS -u "$JENKINS_USER:$JENKINS_TOKEN" -o /dev/null -D - "$JENKINS_URL/login" | grep -i '^x-jenkins:'
curl -sS -X POST -u "$JENKINS_USER:$JENKINS_TOKEN" "$JENKINS_URL/scriptText" \
  --data-urlencode 'script=Jenkins.instance.pluginManager.plugins.sort{it.shortName}.each { println("${it.shortName}:${it.version}") }' \
  > "plugins-running-after-$STAMP.txt"
diff <(sort plugins.txt) <(sort "plugins-running-after-$STAMP.txt")   # should be empty
curl -sS -u "$JENKINS_USER:$JENKINS_TOKEN" "$JENKINS_URL/queue/api/json" | jq '.items | length'
```

- The core header shows the target version and the running plugin list matches `plugins.txt` exactly.
- No plugin failed to load, and the administrative monitors show no new warnings you have not read.
- The smoke tests above pass, the queue drains, and build durations are in their usual range over the next working day.
- The security advisories that triggered the upgrade no longer list your versions.

## Rollback

Decide the rollback trigger before the window: for example, any plugin failing to load that a production pipeline uses, or a smoke test failing for more than an agreed time.

1. **Preferred: previous image and previous `JENKINS_HOME` together.** Scale the controller down, restore the disk from the pre-upgrade snapshot (create a new disk from the snapshot and point the PV at it, or follow your storage class's restore path), set the image tag back to the previous one in Git, and start it. Builds that ran after the snapshot are lost from history; their logs are still in the systems they deployed to.
2. **Previous image only.** Not enough on its own: plugin files and configuration already written to `JENKINS_HOME` stay, because the image upgrades plugins but never downgrades them (step 4). Use it only when you know nothing in `JENKINS_HOME` changed, for example when the new controller never finished starting.
3. **One plugin.** The update center offers only the newest release. To go back, download the older `.hpi`, upload it under Manage Jenkins, Plugins, Advanced settings, Deploy plugin, or copy it into `JENKINS_HOME/plugins/` as `<name>.jpi` with the controller stopped, then restart; then pin that version in `plugins.txt`. Core source also keeps the previous file as `plugins/<name>.bak` after an update-center update and offers a downgrade when that file exists, but this is not described in the handbook.

> [!warning] Downgrading over newer configuration
> A newer core or plugin may already have rewritten job or system configuration in a format the older version does not understand (not verified for any specific version). That is why a single-plugin or core downgrade without restoring `JENKINS_HOME` is the last resort, and why you do not purge old data during the window.

After any rollback, record the failing plugin and version in the change record and open an item to retry in staging.

## Troubleshooting

| Symptom                                           | Likely cause and fix                                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image build fails in `jenkins-plugin-cli`         | Pinned versions cannot be satisfied with `--latest=false`. Read the dependency it names, bump that plugin too, or choose an older target.                                                               |
| Controller does not start after the image change  | Java version not supported by the new core, or a broken plugin set. Read the first `SEVERE` line; roll back (option 1) if the fix is not obvious.                                                       |
| A plugin fails to load: needs a newer core        | The plugin was bumped past what the core supports. Pin the previous plugin version or move the core first.                                                                                              |
| A plugin fails to load: missing or old dependency | A dependency was not bumped with it. Add the dependency at the required version to `plugins.txt`.                                                                                                       |
| Plugins in the UI do not match `plugins.txt`      | A plugin was upgraded manually, so the image skips it, or the home has no marker files. Check `PLUGINS_FORCE_UPGRADE` and `TRY_UPGRADE_IF_NO_MARKER` in the image README, or your chart's install mode. |
| JCasC check returns issues                        | A plugin renamed or removed a configuration attribute. Update the YAML in Git; validate on staging first.                                                                                               |
| UI loads but pages error or look broken           | Usually a UI or theme plugin mismatch, or a cached page. Check the log for the plugin, then clear the browser cache before rolling back.                                                                |
| Agents do not connect                             | Java on agents older than the new core requires, or a remoting change. Check agent Java with the guide's script and the agent logs.                                                                     |
| Credentials missing or unreadable after a restore | `secrets/master.key` was not restored with the rest of `JENKINS_HOME`. Restore it from its separate backup.                                                                                             |
| Queue never drains after the restart              | Quiet down still active. Run `cancelQuietDown`. Otherwise follow [[jenkins-controller-down-and-queue-stuck]].                                                                                           |

## Related

- [[jenkins-controller-down-and-queue-stuck]] when the controller is already down or the queue is stuck.
- [[0061-jenkins-controllers-as-code-with-ephemeral-agents]] for the decision to build controllers from code with pinned plugins.
- [[jenkins-controller-and-agent-hardening]] for the security baseline and why advisories are urgent.
- [[jenkins-agents-configuration-as-code-and-shared-libraries]] and [[jenkins-shared-libraries]] for JCasC and shared libraries.
- [[dependency-update-policy]] for how often to upgrade.
- [[production-change-checklist]] for the change record.
- [[sonarqube-upgrade-and-db-migration]] for the same pattern on another CI tool.

## Sources

Checked 2026-10-21 against the documentation source on the default branch:

- [Jenkins: Managing plugins](https://www.jenkins.io/doc/book/managing/plugins/): the Updates tab, newest-release-only updates, manual install of an older `.hpi`, the Script Console listing, disabling and old data.
- [Jenkins: Backing up and restoring](https://www.jenkins.io/doc/book/system-administration/backing-up/): snapshots, the controller key, the minimum file set, validating a backup.
- [Jenkins: Java support policy](https://www.jenkins.io/doc/book/platform-information/support-policy-java/) and [Upgrading to Java 21](https://www.jenkins.io/doc/book/platform-information/upgrade-java-to-21/).
- [Jenkins: LTS upgrade guide](https://www.jenkins.io/doc/upgrade-guide/): not read; read it for your versions.
- [Jenkins security advisories](https://www.jenkins.io/security/advisories/): not read.
- [Plugin installation manager tool](https://github.com/jenkinsci/plugin-installation-manager-tool): `jenkins-plugin-cli` options and the plugins file format.
- [Official Jenkins Docker image](https://github.com/jenkinsci/docker): `plugins.txt` in derived images, reference files not overriding `JENKINS_HOME`, `.override`, plugin upgrade markers, `PLUGINS_FORCE_UPGRADE` and `TRY_UPGRADE_IF_NO_MARKER`.
- [Configuration as Code](https://www.jenkins.io/doc/book/managing/casc/) and the plugin's [configuration check](https://github.com/jenkinsci/configuration-as-code-plugin/blob/master/docs/features/configurationCheck.md) document.
- [Jenkins core source](https://github.com/jenkinsci/jenkins): `quietDown` parameters, the `quiet-down` CLI command and the plugin and core `.bak` downgrade files; read in source, not documented in the handbook.
