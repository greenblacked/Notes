---
title: GitLab CI vs Jenkins
description: A practical comparison of GitLab CI/CD and Jenkins for Kubernetes-based delivery, with security, cost and migration guidance.
type: tool
tags:
  - tools
  - gitlab-ci
  - jenkins
  - ci-cd
created: 2026-10-16
modified: 2026-10-16
draft: false
---

Jenkins is a self-hosted automation server whose behaviour is assembled from plugins. GitLab CI/CD is a pipeline engine built into the GitLab platform, driven by a single `.gitlab-ci.yml` and executed by runners. Both run jobs in containers on Kubernetes. The difference that matters in practice is who owns the glue: with Jenkins you own it, with GitLab much of it is a product feature.

> [!note] Not independently verified
> This note describes design differences that are stable across versions. Check the current GitLab and Jenkins documentation before relying on a specific keyword, plugin or default.

## At a glance

| Concern            | GitLab CI/CD                                                                | Jenkins                                                               |
| ------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Architecture       | Part of GitLab; coordinator in GitLab, jobs run on separate runners         | Controller (formerly master) plus agents; standalone Java application |
| Pipeline as code   | `.gitlab-ci.yml`, declarative YAML, `include`, `extends`, components        | `Jenkinsfile`, declarative or scripted Groovy, Shared Libraries       |
| Extensibility      | Built-in features, CI/CD components, templates                              | Plugin ecosystem; most features are plugins                           |
| Kubernetes         | Runner with the Kubernetes executor (one pod per job)                       | Kubernetes plugin (one pod per build, pod templates)                  |
| Source integration | Native: merge request pipelines, statuses, environments, approvals          | Via SCM and branch-source plugins and webhooks                        |
| Secrets            | Masked/protected CI variables, external secrets integration, OIDC ID tokens | Credentials plugin and credential providers; Vault and cloud plugins  |
| Upgrades           | GitLab version upgrades (SaaS: none); runner upgraded separately            | Core and every plugin upgraded and tested independently               |
| Scaling            | Add runners; autoscale on Kubernetes                                        | Add agents; controller is a single stateful bottleneck                |
| Operational burden | Low on GitLab.com; moderate if self-managed GitLab                          | Always self-managed: controller, plugins, JVM, backups, agents        |

## Architecture

**Jenkins** keeps job configuration, build history and credentials on one controller. Agents connect to it, and the controller schedules every build. It is one stateful process whose heap, disk and plugin set decide how far it scales. Running it highly available is not a standard feature of the open source distribution.

**GitLab CI** splits the control plane (GitLab itself, usually shared with source control and the registry) from execution (runners). Runners are small stateless binaries that poll for jobs. Losing a runner loses in-flight jobs only; losing the controller on Jenkins can lose the whole build system.

## Pipeline as code

Jenkins Declarative Pipeline is Groovy with a fixed structure; scripted pipelines allow arbitrary code. Reuse is through Shared Libraries (see [[jenkins-shared-libraries]]). The power is real, and so is the risk: Groovy in a Jenkinsfile can do anything, runs in a sandbox with approval friction, and is hard to lint and test.

GitLab pipelines are YAML. Reuse is through `include`, `extends`, hidden jobs and CI/CD components. The model is less expressive but much easier to review and validate (`glab ci lint`, the CI Lint API). Conventions for structuring this are in [[gitlab-ci-pipeline-structure]]. The build job below uses Docker-in-Docker, which needs a privileged runner.

```yaml title=".gitlab-ci.yml"
stages: [build, test, deploy]

build:
  stage: build
  image: docker:cli
  services:
    - docker:dind # needs a privileged runner; a rootless builder is the alternative
  variables:
    DOCKER_TLS_CERTDIR: "/certs"
  before_script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
  script:
    - docker build -t "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA" .
    - docker push "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

## Plugins versus built-ins

Jenkins' plugin catalogue is its biggest strength and its main liability. Integrations that GitLab ships (SCM status, environments, review apps, merge request widgets, container registry, security reports) are separate plugins in Jenkins, each with its own maintainer, release cadence and compatibility matrix. A controller upgrade becomes a dependency-resolution exercise.

GitLab has plugins in the sense of integrations, but the pipeline engine itself has none to install. The trade-off is that you accept GitLab's model: if a feature is missing or paywalled in your tier, there is no plugin to fill the gap.

## Runners and agents on Kubernetes

Both use ephemeral pods per job, which gives clean workspaces and horizontal scaling.

- **GitLab Runner** with the Kubernetes executor creates a pod per job in a namespace you choose. Configure resource requests and limits, a dedicated service account and node selectors in `config.toml` or the Helm chart values. Use separate runners for trusted and untrusted (fork/MR) workloads.
- **Jenkins** uses the Kubernetes plugin with pod templates (inline in the Jenkinsfile or defined in the controller). The controller itself should run outside the build namespace.

For either, set resource requests and limits on build pods (see [[kubernetes-resource-requests-and-limits]]) and avoid privileged Docker-in-Docker where a rootless builder such as BuildKit rootless will do; check the maintenance status of any builder you pick, as some have been archived.

## Security posture

- **Plugin CVEs.** Jenkins publishes frequent security advisories, mostly for plugins. Each installed plugin enlarges the attack surface and must be patched on your schedule. Keep the plugin list short and review it regularly.
- **Credentials.** In Jenkins, credentials live on the controller and are exposed to builds through bindings; a compromised Jenkinsfile can often exfiltrate any credential its job can reach. In GitLab, use protected and masked variables, restrict by protected branch, and prefer short-lived OIDC ID tokens to cloud providers over stored keys.
- **Blast radius.** Jenkins controllers tend to become highly privileged and long-lived. GitLab runners are separable by project, group and protection level.
- **Pipeline injection.** Both are vulnerable to untrusted merge requests running with secrets. Do not expose secrets to fork pipelines in either system.

## Scaling and cost of ownership

Jenkins licence cost is zero, but ownership cost is not: someone patches the controller and plugins, tunes the JVM, restores backups, and answers "why is the queue stuck". The controller is the scaling ceiling; teams usually shard into several controllers.

GitLab costs depend on the tier and whether you use GitLab.com or self-managed. See the [GitLab pricing page](https://about.gitlab.com/pricing/) for current tiers and CI minutes. If you already run GitLab for source control, CI adds little incremental operations work. Runner compute is your cluster's cost in both cases.

## Migration path from Jenkins to GitLab CI

1. **Inventory.** List jobs, their triggers, credentials and plugins used. Drop dead jobs.
2. **Move the source to GitLab** (or mirror it) so merge request pipelines are possible.
3. **Stand up runners** on Kubernetes with the same base images the Jenkins agents use.
4. **Translate by capability, not line by line.** Map stages to stages, shared library steps to `include`d templates or components, credentials to protected CI variables or OIDC.
5. **Run both in parallel** for a few releases on the same commits and compare artefacts and test results.
6. **Cut over per repository**, disable the Jenkins job (do not delete it yet), and remove it after a full release cycle.
7. **Decommission** controller, plugins and credentials. Rotate every credential that lived on Jenkins (see [[leaked-credential-rotation]]).

> [!warning] Credentials do not migrate cleanly
> Treat the migration as a credential rotation event. Anything stored in Jenkins should be assumed exposed to anyone who could edit a job.

## When to choose which

Choose **GitLab CI** when:

- you already use GitLab for source control and want pipelines tied to merge requests;
- you want to reduce operational burden and plugin risk;
- reviewable, lintable YAML is preferable to Groovy.

Choose **Jenkins** when:

- you have heavy investment in Shared Libraries and bespoke plugins that cannot be reproduced cheaply;
- your source is not on GitLab and will not move;
- you need highly custom orchestration that YAML cannot express.

## Recommendation

For new work on GKE with GitLab as the source host, use GitLab CI. Keep Jenkins only where migration cost exceeds the operational and security cost of keeping it, and put an end date and an owner on every remaining Jenkins controller.
