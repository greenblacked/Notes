---
title: GitHub Actions vs GitLab CI vs Jenkins
description: "Adding GitHub Actions to the GitLab CI and Jenkins comparison: OIDC to GCP, runners, reuse, security defaults and lock-in for GKE delivery."
type: tool
tags:
  - tools
  - ci-cd
  - gitlab-ci
  - jenkins
  - security
created: 2026-10-19
modified: 2026-10-19
draft: false
---

[[gitlab-ci-vs-jenkins]] already compares two of the three systems. This note adds GitHub Actions and focuses on what changes the decision for a team deploying to GKE: keyless authentication to GCP, where runners live, how pipelines are reused, and which security defaults you get.

> [!info] Not checked against current releases
> Keywords, defaults, limits and prices were not checked when this note was written. Confirm syntax and settings in the current documentation; GitLab and GitHub documentation paths in particular move.

## Scope: what [[gitlab-ci-vs-jenkins]] already covers

That note covers architecture, plugin risk, Kubernetes runners and agents, migration from Jenkins and total cost of ownership for the two. This note does not repeat those points. It covers GitHub Actions on its own terms and compares all three on authentication, runners, reuse and security defaults.

## At a glance (three columns)

| Concern            | GitHub Actions                                     | GitLab CI/CD                                      | Jenkins                                          |
| ------------------ | -------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| Definition         | Workflow YAML in `.github/workflows/`              | `.gitlab-ci.yml`, `include`, components           | `Jenkinsfile` (Groovy), Shared Libraries         |
| Execution          | Hosted runners or self-hosted runners              | Runners (shared, group, project)                  | Controller plus agents                           |
| Reuse              | Reusable workflows, composite actions, marketplace | `include`, `extends`, CI/CD components            | Shared Libraries, plugins                        |
| Keyless cloud auth | OIDC token to Workload Identity Federation         | `id_tokens` to Workload Identity Federation       | Plugin or credentials provider; OIDC via plugins |
| Secrets            | Repository, environment and organisation secrets   | Masked and protected variables, external secrets  | Credentials plugin, external providers           |
| Marketplace risk   | Third-party actions run in your job                | Templates and components, fewer third-party steps | Plugins run in the controller                    |
| Operations         | None on hosted; you run self-hosted runners        | None on GitLab.com; self-managed GitLab otherwise | Always yours                                     |

## Pipeline model: workflows and jobs vs stages and rules vs Jenkinsfile

GitHub Actions models **workflows** triggered by events (`push`, `pull_request`, `workflow_dispatch`, `schedule`), containing **jobs** that run in parallel unless `needs:` orders them. GitLab models **stages** with jobs controlled by `rules:`. Jenkins models stages inside a Groovy pipeline. Practical differences:

- Actions jobs each get a fresh runner and share files only through artefacts or caches; GitLab behaves the same; Jenkins can share a workspace across stages on one agent.
- Environments and approvals: GitHub Environments with required reviewers, GitLab protected environments with approval rules, and Jenkins `input` steps with a role check. Use them for production deploys in every system.
- Matrix builds exist in all three with different syntax.

## Keyless auth to GCP with Workload Identity Federation

No system should hold a long-lived service account JSON key. All three can exchange a signed job identity token for short-lived Google credentials through Workload Identity Federation (the pool, provider and attribute conditions are covered in [[iam-groups-and-ci-workload-identity-federation]]).

GitHub Actions, with minimal permissions:

```yaml title=".github/workflows/deploy.yml"
name: deploy
on:
  push:
    branches: [main]

permissions:
  contents: read # default for the whole workflow

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production # protected environment with required reviewers
    permissions:
      contents: read
      id-token: write # needed to request the OIDC token; only this job has it
    steps:
      - uses: actions/checkout@0000000000000000000000000000000000000000 # pin a full commit SHA of a release you reviewed
      - id: auth
        uses: google-github-actions/auth@0000000000000000000000000000000000000000 # pin a full commit SHA; the zeros are a placeholder
        with:
          workload_identity_provider: projects/123456789012/locations/global/workloadIdentityPools/example-pool/providers/github
          service_account: deployer@example-project.iam.gserviceaccount.com
      - uses: google-github-actions/get-gke-credentials@0000000000000000000000000000000000000000 # placeholder SHA
        with:
          cluster_name: prod
          location: europe-west1
      - run: kubectl rollout status deployment/app -n app --timeout=120s
```

The all-zero SHAs are placeholders: look up the commit that a release tag points to, review it, and paste the full 40-character SHA with the version in a comment. The provider's attribute condition must restrict the repository, branch or environment, otherwise any workflow in the organisation can impersonate the service account.

GitLab CI:

```yaml title=".gitlab-ci.yml"
deploy:
  stage: deploy
  image: google/cloud-sdk:X.Y.Z@sha256:0000000000000000000000000000000000000000000000000000000000000000 # full (non-slim) image with kubectl and gke-gcloud-auth-plugin; pin a tested tag and digest
  id_tokens:
    GCP_ID_TOKEN:
      aud: https://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/example-pool/providers/gitlab
  script:
    - CRED_DIR="$(mktemp -d)"
    - printf '%s' "$GCP_ID_TOKEN" > "$CRED_DIR/id_token"
    - gcloud iam workload-identity-pools create-cred-config
      projects/123456789012/locations/global/workloadIdentityPools/example-pool/providers/gitlab
      --service-account=deployer@example-project.iam.gserviceaccount.com
      --credential-source-file="$CRED_DIR/id_token"
      --output-file="$CRED_DIR/cred.json"
    - gcloud auth login --cred-file="$CRED_DIR/cred.json"
    - gcloud container clusters get-credentials prod --location=europe-west1 --project=example-project
    - kubectl rollout status deployment/app -n app --timeout=120s
  environment: production
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

The token and credential files are written to a temporary directory, never to the project tree; never add that path to `artifacts:` or `cache:`. Check the GitLab documentation for the current `id_tokens` and Google Cloud integration pages, since paths have moved. **Jenkins** has no built-in equivalent: credentials live on the controller. Use a credentials provider or plugin that supports OIDC or short-lived tokens, run agents on GKE with Workload Identity so the pod itself is the identity, and keep the Credentials plugin for anything that has no better path. See [[jenkins-controller-and-agent-hardening]].

## Runners: hosted vs self-hosted (fork PRs must never reach self-hosted runners)

Hosted runners are ephemeral and need no operations; self-hosted runners give network access to private resources and cost control. The rule for all three systems: **a pull request from a fork must never run on a self-hosted runner or see secrets**. A fork can change the workflow file and run arbitrary code on your network.

- GitHub: require approval for first-time contributors, keep self-hosted runners for private repositories only, and prefer ephemeral runners (one job, then destroyed).
- GitLab: separate runners for protected branches and for merge requests from forks, as described in [[gitlab-runners-on-gke]].
- Jenkins: untrusted multibranch builds on isolated agents without credentials.

## Reuse: reusable workflows and actions vs includes and components vs shared libraries

GitHub offers **reusable workflows** (called with `uses:`) and **composite actions**. GitLab offers `include`, `extends` and CI/CD components with versioning. Jenkins offers Shared Libraries. Version and review shared code like application code, pin consumers to a tag or SHA, and have tests for it. The marketplace is a convenience and a supply-chain risk in the same breath: each third-party action runs with your job's permissions.

## Security defaults: token permissions, pinning to commit SHA, `pull_request_target`, protected environments

- **Token permissions.** Set `permissions: contents: read` at the top of every workflow and add scopes per job. Check the repository and organisation default token permissions and set them to read-only (check the current docs).
- **Pin third-party actions to a full commit SHA**, not a tag, because tags can be moved. Let a bot update the pins; see [[renovate-vs-dependabot]] and [[automated-dependency-updates]].
- **`pull_request_target`** runs with a write token and secrets in the context of the base repository. Never check out and run the pull request's code in that context.
- **Script injection.** Never put `${{ github.event.pull_request.title }}` or other user-controlled values directly in `run:`; pass them through environment variables.
- **Protected environments** with required reviewers and branch restrictions for production in GitHub and GitLab, and role checks in Jenkins.
- **Agents in pipelines** need their own limits; see [[securing-ai-agents-in-ci-and-cloud]].

## Cost and lock-in

Hosted minutes, storage and larger runners are billed; check the current pricing pages and compare against your real usage rather than list prices. Self-hosted runners shift the cost to your cluster. Lock-in lies in the pipeline language and the marketplace: Actions workflows and GitLab YAML are not portable to each other, and Jenkinsfiles least of all. Keep logic in scripts and Makefiles in the repository and let the CI system only orchestrate, so a migration rewrites glue instead of logic.

## When to choose which

- **GitHub Actions** when the code is on GitHub: tight integration, a large action ecosystem, and good OIDC support.
- **GitLab CI** when the code is on GitLab and you want one platform for source, registry, environments and security reports.
- **Jenkins** when existing investment or unusual orchestration needs outweigh the maintenance cost.

## Recommendation

Follow the source host: GitHub Actions for GitHub, GitLab CI for GitLab. Do not run a third system just because it is familiar. Whichever you use, authenticate to GCP with federation instead of keys, pin third-party code, keep self-hosted runners away from untrusted code, and keep deploy logic in scripts under version control. What would change this: a hard requirement for on-premises-only execution, heavy bespoke plugins, or a multi-host organisation that needs a neutral orchestrator.

## Related

- [[gitlab-ci-vs-jenkins]]
- [[iam-groups-and-ci-workload-identity-federation]]
- [[gitlab-runners-on-gke]]
- [[jenkins-controller-and-agent-hardening]]
- [[securing-ai-agents-in-ci-and-cloud]]

## Sources

- [GitHub Actions documentation](https://docs.github.com/en/actions)
- [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
- [Configuring OpenID Connect in Google Cloud Platform](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-google-cloud-platform) (verify the current path)
- [GitLab CI/CD documentation](https://docs.gitlab.com/ci/)
- [Jenkins documentation](https://www.jenkins.io/doc/)
