---
title: Jenkins audit trail and configuration evidence
description: Make Jenkins auditable with configuration in Git, Audit Trail and Job Configuration History, logs shipped off the controller and evidence kept outside it.
type: pattern
tags:
  - compliance
  - jenkins
  - audit
  - ci-cd
  - security
created: 2026-10-21
modified: 2026-10-21
draft: false
aliases:
  - jenkins-audit-trail
  - jenkins-audit-logging
---

An auditor asks three questions of any CI system: who changed the pipeline and system configuration, who ran or approved what, and can those records be trusted. Out of the box Jenkins answers none of them well. It keeps a system log for troubleshooting, not an audit trail of who changed what, and its build discarder deletes old builds with their logs. This note makes a Jenkins controller auditable: configuration in Git, an audit log of user actions, a history of job configuration, logs shipped to a store that Jenkins administrators cannot edit, and deploy evidence kept outside Jenkins. Hardening the controller itself is in [[patterns/jenkins-controller-and-agent-hardening]].

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Not checked against a running system
> Written against the Audit Trail, Job Configuration History and Configuration as Code plugin documentation, the Jenkins handbook pages on the script console, pipeline syntax and API tokens, and the Ops Agent configuration reference, read on 2026-10-21. Nothing was run against a Jenkins controller, and no plugin versions are recommended: check the plugin pages and the Jenkins security advisories before installing anything.
>
> Not checked for this note: the exact format of an Audit Trail log line, the Configuration as Code keys for the Audit Trail plugin, the Credentials plugin's usage tracking and fingerprints, permission names in authorization strategies other than `Administer`, the plugins' default file sizes, rotation counts and URL pattern, the Ops Agent configuration file path and pipeline section, the Cloud Logging resource types and log names for the shipped logs, and the Cloud Storage retention-lock behaviour. Each is marked again where it appears.

## Short answer

- Keep Jenkins system configuration in Git with Configuration as Code (JCasC), and pipelines as `Jenkinsfile`s or Job DSL in Git. Then most "who changed the configuration" questions are answered by merge requests, and UI edits become exceptions.
- Restrict who can change configuration in the UI and who has `Administer`, because `Administer` includes the script console, which can do anything and may not be audited in the normal logs.
- Install the Audit Trail plugin for who did what (configuration submits, deletes, builds started, logins, credential use, Groovy script use), and Job Configuration History for what changed in each job's `config.xml`.
- Ship the audit log off the controller as it is written, to Cloud Logging and a locked archive. Anything kept only on the controller can be edited by a controller administrator.
- Export a deploy evidence record from each production pipeline to the evidence store, so `buildDiscarder` can clean up Jenkins without deleting evidence.

## What Jenkins records by default

| Question                                | Jenkins core without plugins                                               | With this pattern                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Who changed a job or system setting     | Not recorded as an audit event                                             | Audit Trail entry; merge request for JCasC and pipelines in Git                        |
| What exactly changed in a job           | Only the current `config.xml`                                              | Job Configuration History diff; Git diff when the job is code                          |
| Who started, stopped or deleted a build | Build cause on the build record, while the build is kept                   | Audit Trail entry, kept off the controller                                             |
| Who logged in, and failed logins        | Depends on the security realm                                              | Audit Trail authentication events                                                      |
| Who ran a script in the script console  | Not reliably: the handbook says script changes may not be audited normally | Audit Trail Groovy script usage, plus an alert                                         |
| Which build used which credential       | Not as an audit event                                                      | Audit Trail credential-use entries for credentials used through the Credentials plugin |
| Records after the build is discarded    | Gone                                                                       | Deploy evidence record in the evidence store                                           |

The first column is based on the Jenkins handbook's description of the system log and the script console, and is not a complete statement of core behaviour; check what your security realm and installed plugins add.

## Configuration in Git

JCasC reads YAML from the path in the `CASC_JENKINS_CONFIG` environment variable (a comma-separated list of files, folders or URLs; folders are searched recursively for `.yml` and `.yaml` files) or from the `casc.jenkins.config` Java system property. Combined with pipelines from SCM and Job DSL for job definitions, the controller's configuration becomes a set of reviewed commits. The details of setting this up are in [[learn/jenkins-agents-configuration-as-code-and-shared-libraries]] and [[patterns/jenkins-shared-libraries]].

For audit purposes:

- Store the JCasC YAML in a repository with protected branches and required approval, the same as infrastructure code. The merge request is the change record.
- Apply it from a pipeline or a controller restart, not by editing in the UI. Treat any UI change as drift: Job Configuration History will show it, and the next JCasC reload overwrites it.
- JCasC interpolates `${VAR}` everywhere. Do not interpolate secrets into fields that are displayed, such as the system message; the plugin's documentation warns about this.
- Most plugins' settings live under the `unclassified` root element. To get the exact keys for a plugin on your version, configure it once on a test controller and export the configuration from **Manage Jenkins > Configuration as Code**.

Restrict UI changes through the authorization strategy: give `Administer` to a very small group, give job configuration rights only where a team still maintains freestyle jobs, and grant read-only access to everyone else. Which permission names your authorization strategy plugin exposes (for example a job configure permission) is not verified here; check that plugin's documentation, and see [[patterns/jenkins-controller-and-agent-hardening]] for the authorization model on this site.

## Audit Trail plugin

The Audit Trail plugin "keeps a log of who performed particular Jenkins operations, such as configuring jobs". It adds an Audit Trail section to **Manage Jenkins > System** with:

- **Loggers**: a file logger (rolling files using `java.util.logging.FileHandler` patterns such as `%h` and `%g`, with a file size, a number of rotating files and an optional field separator, a space by default), a syslog logger, a console logger to stdout or stderr ("primarily intended for debugging"), and an Elasticsearch logger.
- **A URL pattern** for the requests to log. The default selects most significant actions: creating, configuring and deleting jobs and views, and deleting, keeping forever or starting builds.
- **Options**, each true by default: log build triggers (the cause of a build), log credential users (credentials consumed through the Credentials plugin), log Groovy script usage (for example from the script console), and log authentication events (successful logins, failed logins and logouts).

It records who did what, not the content of a configuration change. For the diff, use Job Configuration History.

Behind a reverse proxy the plugin may log the proxy's address instead of the client's. Set `X-Forwarded-For` on the proxy and follow the Jenkins reverse proxy troubleshooting guidance, as the plugin README recommends.

The JCasC block below shows where the configuration goes. The key names were not verified: export the configuration from a test controller after setting the plugin up in the UI, and replace this block with what your version produces.

```yaml title="jcasc/audit-trail.yaml"
# Illustrative only: key names not verified. Export your own from a test controller.
unclassified:
  audit-trail:
    logBuildCause: true
    logCredentialsUsage: true
    loggers:
      - logFile:
          log: "/var/jenkins_home/audit/audit-%g.log" # change: a path on the controller's volume
          limit: 100 # change: size limit per file, in the unit your version's UI shows
          count: 20 # change: number of rotating files
```

Keep the plugin's default URL pattern unless you have a reason to change it, and if you change it, keep the old and new patterns in the merge request so an auditor can see what was logged when.

## Ship logs off the controller

A Jenkins administrator can edit or delete any file on the controller, including the audit log and the configuration history. The audit trail is only trustworthy once it is somewhere they cannot change. Ship each line as it is written, then keep it in a bucket with a retention policy, as described in [[compliance/audit-evidence-collection-and-retention]] and [[adr/0044-central-log-sinks-and-retention-tiers]].

### Controller on a VM: Ops Agent

The Ops Agent's `files` receiver tails files and sends each line to Cloud Logging. The receiver keys `type: files`, `include_paths` (required), `exclude_paths`, `wildcard_refresh_interval` and `record_log_file_path` come from the agent's configuration reference; the surrounding `service.pipelines` structure and the file location `/etc/google-cloud-ops-agent/config.yaml` are not verified, so compare with the configuration page.

```yaml title="/etc/google-cloud-ops-agent/config.yaml"
logging:
  receivers:
    jenkins_audit:
      type: files
      include_paths:
        - /var/jenkins_home/audit/audit-*.log* # change: match the file logger's real file names
      record_log_file_path: true
  service:
    pipelines:
      jenkins_audit:
        receivers: [jenkins_audit]
```

The file logger's `%g` pattern produces numbered files that rotate. Check the real names on the controller and use a wildcard that matches them all, or lines written just before a rotation can be missed. Restart the agent after the change and check its status.

### Controller on GKE

Files written inside the pod are not collected by GKE's logging agent unless they reach stdout or stderr. Two options:

- Use the console logger to stdout. GKE collects it with the container logs. The plugin README calls this logger debugging-oriented, so check that the lines carry everything you need.
- Keep the file logger on the controller's volume and add a small sidecar that tails the files to its own stdout. This keeps a local copy for troubleshooting and ships every line.

Either way, route the resulting entries with a log sink to the central audit project, and from there to the locked archive bucket. A Cloud Storage bucket with a locked retention policy is meant to stop objects from being deleted or replaced before the retention period ends, and the lock itself is meant to be permanent. Both points are not verified here: read the Cloud Storage documentation on retention policies and locks before you lock a bucket. [[compliance/legal-hold-for-logs-and-artifacts]] covers holds on top of retention.

Restrict the Jenkins administrators' own access in GCP: they should not hold roles that can change the sink, the log bucket or the archive bucket. Otherwise the separation is only on paper.

## Job Configuration History as a secondary record

Job Configuration History saves a copy of each job's and agent's `config.xml` on every change, and of system configuration files, recording who made the change when a security realm is configured. It shows side-by-side diffs at `<jenkins_url>/jobConfigHistory` and can restore an older job configuration (not system configuration). Exclude noisy files with the "Configuration exclude file pattern" setting.

Its history is stored on the controller, so an administrator can alter it. Use it to answer "what changed" quickly, and rely on the shipped audit log and Git for "who changed it and can we prove it". When a job is restored to an old configuration, newer fields that the old version did not have stay in place, per the plugin README; check the result.

## The script console is a high-risk event

The script console runs arbitrary Groovy in the controller, at `/script` or through the API. The Jenkins handbook is explicit: access is controlled by the `Administer` permission, scripts can bypass all security controls and read any data, credentials accessed by scripts are decrypted, and changes made by scripts may not be audited in the normal logs.

Treat every use as a privileged action:

- Keep `Administer` to a named break-glass group and use JCasC for routine changes.
- With "Log Groovy script usage" on, Audit Trail writes an entry when a script runs. During validation, run a harmless script and note the exact line your version writes, then build a log-based alert on that text in Cloud Logging, using the pattern in [[compliance/out-of-band-change-detection-gcp-gke#Alerting in Terraform]].
- Require a ticket for each use and review uses in the access review ([[compliance/access-reviews-gcp-and-gke]]).

## Credentials usage

With "Log credential users" on, Audit Trail logs the use of credentials consumed through the Credentials plugin. That answers "which job used the production deploy credential, and when". The Credentials plugin also has its own usage tracking based on fingerprints; whether it is enabled by default and what it records was not verified, so check the Credentials plugin documentation before you rely on it.

Prefer short-lived federated credentials over stored secrets, so there is less to track: see [[patterns/artifactory-access-tokens-and-oidc-for-ci]] and [[adr/0026-keyless-ci-auth-with-workload-identity-federation]].

## buildDiscarder and evidence retention

`buildDiscarder(logRotator(numToKeepStr: '...'))` in a pipeline's `options` keeps artifacts and console output only for the given number of recent runs. That is good housekeeping and bad evidence storage: a deploy from eight months ago is gone, with its approval and its log.

Do not raise the discarder limits to keep evidence. Instead, have each production deploy write its own record outside Jenkins:

```groovy title="Jenkinsfile (excerpt)"
pipeline {
  agent { label 'deploy' }
  options {
    buildDiscarder(logRotator(numToKeepStr: '50'))
  }
  stages {
    stage('Deploy') {
      steps {
        sh './deploy.sh'
      }
    }
  }
  post {
    always {
      // Writes build URL, commit, approver, result and timestamps to the evidence bucket.
      withEnv(["BUILD_RESULT=${currentBuild.currentResult}"]) {
        sh './ci/export-deploy-evidence.sh "${BUILD_URL}" "${GIT_COMMIT}" "${BUILD_RESULT}"'
      }
    }
  }
}
```

`export-deploy-evidence.sh` is your own script; the record's fields and storage are described in [[compliance/soc2-for-ci-cd-controls]] and [[compliance/change-management-controls-and-pipeline-evidence]]. Put the call in a shared library step so every production pipeline uses the same one. Retention of build artifacts in general is in [[standards/artifact-retention-policy]].

## Validation

Run these on a test controller first, then once on production after the change, and keep the results as the control's first evidence.

1. Change a job's description in the UI. Expected: an Audit Trail line naming you and the job's configuration URL, and a new entry in Job Configuration History with the diff.
2. Find the same line in Cloud Logging within a few minutes. On a VM with the Ops Agent, search for the file path if `record_log_file_path` is on; on GKE, search the controller or sidecar container's logs. Resource types and log names depend on your setup and are not verified here.
3. Run `println 'audit test'` in the script console. Expected: a Groovy script usage entry, and the alert from the section above fires.
4. Log out and fail one login. Expected: authentication events for both.
5. Run a production-like pipeline in a test folder. Expected: the evidence record appears in the evidence bucket with the build URL and commit.
6. Revert the job description through JCasC or Job DSL and confirm the drift disappears.

## Troubleshooting

| Symptom                                  | Likely cause                                                                                            | Check                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| No audit lines at all                    | No logger configured, or the file path is not writable by the Jenkins user                              | The Audit Trail section in system configuration; the controller's system log for errors |
| Some actions are not logged              | The URL pattern does not match them                                                                     | Compare the request path with the pattern; restore the default if it was changed        |
| Gaps in Cloud Logging around rotation    | The agent's include path misses rotated file names, or files rotate faster than the agent picks them up | Widen the wildcard; lower `wildcard_refresh_interval`; raise the file size limit        |
| Client IP is always the proxy            | `X-Forwarded-For` not set or not trusted                                                                | Reverse proxy configuration and the Jenkins reverse proxy troubleshooting page          |
| Job Configuration History fills the disk | Plugins writing frequent configuration changes                                                          | Add those paths to the exclude pattern                                                  |
| Configuration reverts after a restart    | A UI change that was not put into JCasC                                                                 | Put the change in Git; this is the intended behaviour                                   |

If the controller itself is down, the audit trail is the least of your problems; see [[runbooks/jenkins-controller-down-and-queue-stuck]].

## Pitfalls

- **Plugins are third-party code with full controller access.** Every plugin you add for auditing widens the attack surface. Install only what you use, keep them updated, and watch the Jenkins security advisories.
- **Administrators can edit the evidence.** Local log files and configuration history are not evidence on their own. Ship them, and keep administrators away from the destination.
- **Console logger only, without checking.** It is described as for debugging; confirm that its output includes user, action and time before relying on it.
- **Relying on build records.** `buildDiscarder` and manual deletes remove them. The evidence store is the record.
- **Script console as a routine tool.** If it is used weekly, something that belongs in JCasC or a pipeline is missing.
- **Planning only for Jenkins.** If new pipelines are moving to GitLab CI as in [[adr/0012-gitlab-ci-for-new-pipelines]], apply the GitLab equivalents in [[compliance/gitlab-compliance-frameworks-and-security-policies]] there, and keep this pattern for as long as Jenkins deploys to production.

## Related

- [[patterns/jenkins-controller-and-agent-hardening]]: authorization, executors and credentials on the controller.
- [[compliance/separation-of-duties-in-deployments]]: who may approve and run deploys from Jenkins.
- [[compliance/soc2-for-ci-cd-controls]]: the deploy record and how auditors sample it.
- [[compliance/leaver-credential-revocation-devops-tools]]: revoking a leaver's Jenkins API tokens.
- [[patterns/gcp-audit-logs-siem]]: correlating Jenkins and GCP audit entries.
- [[architecture/logging-architecture-gke-and-cloud-logging]]: how GKE container logs reach Cloud Logging.

## Sources

- Jenkins plugins, [Audit Trail](https://plugins.jenkins.io/audit-trail/): loggers, options and defaults.
- Jenkins plugins, [Job Configuration History](https://plugins.jenkins.io/jobConfigHistory/).
- Jenkins plugins, [Configuration as Code](https://plugins.jenkins.io/configuration-as-code/): configuration locations and interpolation.
- Jenkins handbook, [Script Console](https://www.jenkins.io/doc/book/managing/script-console/): permissions and the auditing warning.
- Jenkins handbook, [Using credentials](https://www.jenkins.io/doc/book/using/using-credentials/).
- Jenkins handbook, [Pipeline syntax: options](https://www.jenkins.io/doc/book/pipeline/syntax/#options): `buildDiscarder`.
- Jenkins handbook, [Viewing logs](https://www.jenkins.io/doc/book/system-administration/viewing-logs/): the system log.
- Google Cloud, [Ops Agent configuration](https://cloud.google.com/logging/docs/agent/ops-agent/configuration): the `files` receiver.
