---
title: Renovate opens dependency, image digest and Terraform provider updates on GitLab
description: Self-hosted Renovate, run on a GitLab CI schedule from a central preset, opens update merge requests; only patch and digest updates automerge.
type: adr
tags:
  - adr
  - supply-chain
  - ci-cd
  - gitlab-ci
  - security
status: accepted
created: 2026-10-21
modified: 2026-10-21
decided: 2026-10-21
draft: false
aliases:
  - ADR-0060
---

## Context

Several accepted records pin versions on purpose. Images are deployed by digest ([[0010-deploy-images-by-digest]]), CI templates are included by tag ([[0013-versioned-central-ci-templates]]), Terraform modules and providers are pinned ([[0034-terraform-modules-versioned-by-git-tag]]), and language packages resolve through Artifactory ([[0007-language-packages-resolve-through-artifactory]]). Pinning makes builds reproducible and reviews meaningful. It also means nothing changes until someone changes it.

Without an update mechanism, the result is predictable:

- Base image digests age, and the CVE backlog grows faster than teams can triage it ([[vulnerability-management-slas]]).
- Updates arrive as a few large, risky jumps instead of many small ones, so they are postponed again.
- Template tags and Terraform providers drift between repositories, and an urgent fix has to be rolled out by hand to dozens of projects.

[[dependency-update-policy]] already says what cadence and review we expect, and [[renovate-vs-dependabot]] compares the tools. No record assigns the job to a tool, so each team does it differently or not at all. Our source of truth is self-managed GitLab, which rules out GitHub-only tooling.

## Decision

**Self-hosted Renovate, run as a scheduled GitLab CI pipeline in one dedicated project, opens update merge requests for every repository in scope.** Behaviour comes from one shared preset, versioned and reviewed like the CI templates.

### How it runs

- **One runner project** (`platform/renovate-runner`) holds the pipeline and the bot's global configuration (`config.js`). Renovate's own runner project documents this model: one dedicated project crawls the others, and updates run only from a scheduled or manually started pipeline.[^runner]
- **The image** is the project's official Renovate image, mirrored into our registry and referenced by digest ([[0010-deploy-images-by-digest]]). Renovate updates its own image digest through the same flow.
- **A dedicated bot account** (`renovate-bot`), not a person's account. Its token is a privileged secret: Renovate's self-hosting docs recommend a personal access token with `api`, `read_user` and `write_repository` scopes, which can write to every repository the bot is a member of. The token lives in Secret Manager ([[0036-secret-manager-as-secrets-system-of-record]]), reaches the job as a protected, masked variable, has an expiry and is rotated on a schedule. The bot is a Developer member only in the groups it updates.
- **Repositories opt in.** Autodiscovery is limited to an explicit group filter and onboarding merge requests are off; a repository is in scope when it carries a `renovate.json` that extends the shared preset. The runner README has changed how it describes these flags between revisions, so check the current one.
- **Registry access goes through Artifactory** ([[0007-language-packages-resolve-through-artifactory]]). `hostRules` in the global config give Renovate read tokens for the Artifactory virtual repositories, matched with `matchHost`. Tokens are environment variables in the runner job, never in a preset or a repository.

### What it updates

| Area                    | Where                                                                    | Merge rule                                                                               |
| ----------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Language packages       | Lock files and manifests, resolved through Artifactory                   | Patch automerges behind a green pipeline; minor reviewed; major on approval              |
| Container base images   | `FROM` lines and CI job images, as `tag@sha256:digest`                   | Digest and patch automerge behind a green pipeline                                       |
| CI template includes    | `include: project` refs ([[gitlab-ci-components-and-includes]])          | Reviewed (templates change pipeline behaviour)                                           |
| Helm chart dependencies | `Chart.yaml` dependencies, third-party chart versions in the GitOps repo | Reviewed; never automerged on production paths                                           |
| Terraform providers     | `required_providers` and `.terraform.lock.hcl`                           | Reviewed; the plan gate of [[0035-terraform-plan-policy-gate-and-ci-only-apply]] applies |
| Terraform modules       | Git-tag module sources ([[terraform-module-versioning]])                 | Reviewed; the plan gate applies                                                          |

Renovate does **not** change the image digests that deploy our own services in the GitOps repository. Those move through the release and promotion flow ([[0004-build-once-promote-between-repositories]], [[0047-semver-release-tags-and-protected-production-deploys]]), not through a bot.

### Merge rules

- **Automerge only patch, digest and pin updates**, and only as a merge request that passed its pipeline (`automergeType: pr`). Every repository in scope must have "Pipelines must succeed" enabled in its GitLab merge settings, independent of Renovate. Renovate's docs warn that platform automerge without required checks can merge a failing change.
- **Minor updates** are reviewed by the owning team. **Major updates** wait for approval on the Dependency Dashboard.
- **Terraform, Helm on production paths and CI templates never automerge.** A provider bump still has to show a clean plan ([[0035-terraform-plan-policy-gate-and-ci-only-apply]]).
- **New releases wait.** `minimumReleaseAge` holds a version back for a few days after release, which limits exposure to a compromised or yanked release. It needs release timestamps, which not every datasource provides.
- **Volume is bounded** by grouping (one merge request for all patch updates of a repository, one per Terraform provider set) and by a weekly schedule, with hourly and concurrent limits set in the preset.
- **Lock file maintenance** runs on its own monthly schedule, which also refreshes `.terraform.lock.hcl` hashes.
- **Signed images only.** A digest update must point to a signed image, or admission will reject it later ([[0038-kyverno-verifies-image-signatures-at-admission]]). Golden base images come from the platform pipeline and are signed there ([[0040-golden-base-images-owned-by-platform]]).

### Security updates

Renovate's `vulnerabilityAlerts` handling is built on GitHub's security alerts, so it cannot be assumed to work on self-managed GitLab. We enable `osvVulnerabilityAlerts`, which uses the OSV database and covers **direct dependencies only**, and we check on a test project whether the merge requests it opens skip the schedule. Whatever Renovate does not raise is still owned by the team under the deadlines of [[vulnerability-management-slas]], with Xray findings ([[0005-xray-scanning-gates-promotion]]) as the source of truth for what is vulnerable.

### Shared preset

The preset lives in `platform/renovate-config` as `default.json`, is changed only by merge request, and is released by tag like the CI templates ([[0013-versioned-central-ci-templates]]). Presets must be JSON, JSONC or JSON5, and a repository's `renovate.json` must not itself be used as a preset.[^presets]

```json title="platform/renovate-config/default.json"
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":dependencyDashboard"],
  "timezone": "UTC",
  "schedule": ["before 6am on monday"],
  "prHourlyLimit": 4,
  "prConcurrentLimit": 10,
  "minimumReleaseAge": "3 days",
  "osvVulnerabilityAlerts": true,
  "labels": ["dependencies"],
  "lockFileMaintenance": {
    "enabled": true,
    "schedule": ["before 6am on the first day of the month"]
  },
  "packageRules": [
    {
      "description": "Small, low-risk updates merge themselves behind a green pipeline",
      "matchUpdateTypes": ["patch", "digest", "pin", "pinDigest"],
      "groupName": "patch and digest updates",
      "automerge": true,
      "automergeType": "pr"
    },
    {
      "description": "Major updates wait for approval on the dashboard",
      "matchUpdateTypes": ["major"],
      "dependencyDashboardApproval": true
    },
    {
      "description": "Terraform never automerges; the plan gate decides",
      "matchManagers": ["terraform"],
      "groupName": "terraform providers and modules",
      "automerge": false
    },
    {
      "description": "Helm charts and CI templates never automerge",
      "matchManagers": ["helmv3", "helm-values", "gitlabci-include"],
      "automerge": false
    }
  ]
}
```

A repository opts in with a minimal file. On self-managed GitLab the preset is referenced with `local>`, which resolves on the same platform instance; `gitlab>` would point at gitlab.com.

```json title="renovate.json"
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["local>platform/renovate-config#v1.0.0"]
}
```

The `#v1.0.0` suffix pins the preset to a tag of the config project; this syntax was not confirmed for this record, so check the presets page before relying on it. Without a pin, every repository follows the preset's default branch.

### Runner configuration and schedule

```js title="platform/renovate-runner/config.js"
module.exports = {
  platform: "gitlab",
  endpoint: "https://gitlab.example.com/api/v4/",
  autodiscover: true,
  autodiscoverFilter: ["payments/**", "platform/**"],
  onboarding: false,
  requireConfig: "required",
  hostRules: [
    {
      matchHost: "artifactory.example.com",
      hostType: "npm",
      token: process.env.ARTIFACTORY_NPM_TOKEN,
    },
  ],
}
```

```yaml title="platform/renovate-runner/.gitlab-ci.yml"
renovate:
  image: registry.example.com/mirror/renovate@sha256:<digest-of-the-mirrored-renovate-image>
  resource_group: renovate # never two runs at once
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
    - if: $CI_PIPELINE_SOURCE == "web"
  variables:
    RENOVATE_CONFIG_FILE: config.js
    LOG_LEVEL: info
  script:
    - renovate
  timeout: 2h
```

Replace the digest placeholder with the digest of the image you mirrored. `RENOVATE_TOKEN` (the bot token), `ARTIFACTORY_NPM_TOKEN` and an optional read-only `GITHUB_COM_TOKEN` (the runner README recommends it to avoid GitHub API rate limits when fetching release notes) are protected, masked CI/CD variables in the runner project. The pipeline schedule (Build > Pipeline schedules) runs hourly during working hours; Renovate's own `schedule` decides when merge requests may be opened.

## Consequences

Easier:

- Pinned versions stay current in small steps, so the CVE backlog shrinks and big-bang upgrades become rare.
- A fix to a CI template, a base image or a provider reaches every repository as a reviewable merge request, without anyone writing a script.
- Update policy lives in one versioned preset instead of in each team's habits.
- The Dependency Dashboard gives each repository a single list of pending and blocked updates.

Harder or newly required:

- **More merge requests.** Even grouped and scheduled, teams will see a steady stream. Owners must review and merge them within the cadence of [[dependency-update-policy]]; a pile of stale bot merge requests is a signal, not noise.
- **The bot token is a high-value secret.** It can push branches to every repository in scope. It is scoped by group membership, rotated, and its use is audited. A leaked token is handled as in [[leaked-credential-rotation]].
- **Automerge trusts the pipeline.** A repository with weak tests will merge a breaking patch release. Repositories without meaningful tests set `automerge: false` in their own `renovate.json` until they have them.
- **Supply-chain exposure moves earlier.** A malicious release would be proposed automatically. `minimumReleaseAge`, Artifactory remote repositories with Xray, signature checks at admission and human review for anything above patch are the mitigations.
- **The runner is a platform service.** Its failures (token expired, API rate limits, config errors) silently stop all updates, so the runner pipeline's status is monitored.

## Alternatives considered

- **Dependabot.** A GitHub product; our repositories, permissions and runners are on GitLab. Not used. See [[renovate-vs-dependabot]].
- **Manual quarterly updates.** No tooling, but in practice updates are skipped when teams are busy, and the jumps grow. Rejected as the main mechanism; still the fallback when the bot cannot handle a dependency.
- **GitLab dependency scanning only.** Reports vulnerable dependencies but does not open update merge requests, and does not cover digests, providers or template tags. A detector, not an updater; it complements Renovate where licensed.
- **Hosted Renovate (Mend).** Less to run, but it needs network access to our self-managed GitLab and our Artifactory, and a third party would hold a token that can write to our repositories. Rejected for now.

> [!info] Claims not checked against current docs
> Renovate's documentation was read through search summaries and mirrors, not directly. Not verified, check before relying on them: the token scopes recommended for GitLab; the exact preset names (`config:recommended`) and the `#tag` pinning syntax for `local>` presets, including for projects in subgroups; the manager names (`terraform`, `helmv3`, `helm-values`, `gitlabci-include`) and which files each one handles, including OCI-hosted charts; the `schedule` text syntax; the `requireConfig` and `autodiscoverFilter` values; whether `osvVulnerabilityAlerts` merge requests bypass the schedule on GitLab; whether the Dependency Dashboard renders on our GitLab edition; `platformAutomerge` behaviour and default on GitLab; the default values of the PR limits; and the options of `renovate-config-validator` in the version we run. No Renovate version is stated here on purpose.

## Validation

Validate the preset in its own merge request pipeline, using the same pinned image:

```bash title="validate-preset.sh"
set -o pipefail
RENOVATE_IMAGE="registry.example.com/mirror/renovate@sha256:<digest-of-the-mirrored-renovate-image>"

# Expected: a success message and exit code 0. Check --help for extra options in your version.
docker run --rm -v "${PWD}:/work" -w /work "${RENOVATE_IMAGE}" \
  renovate-config-validator default.json
```

Check that the bot is doing its job across a group:

```bash title="check-renovate-health.sh"
set -o pipefail
GITLAB_URL="https://gitlab.example.com"
GITLAB_TOKEN="${GITLAB_TOKEN:?set a read-only API token}"
GROUP_ID="42"            # example numeric group ID
BOT_USER="renovate-bot"
MAX_AGE_DAYS=14

CUTOFF="$(python3 -c 'import datetime,sys; d=int(sys.argv[1]); print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=d)).strftime("%Y-%m-%dT%H:%M:%SZ"))' "${MAX_AGE_DAYS}")"

# Write the token to a curl config file so it does not appear in the process list.
CURL_CFG="$(mktemp)"; trap 'rm -f "${CURL_CFG}"' EXIT
printf 'header = "PRIVATE-TOKEN: %s"\n' "${GITLAB_TOKEN}" > "${CURL_CFG}"

# 1. Open bot merge requests older than MAX_AGE_DAYS, per project.
#    Expected: a short list that does not grow week over week.
curl -fsS -K "${CURL_CFG}" \
  "${GITLAB_URL}/api/v4/groups/${GROUP_ID}/merge_requests?state=opened&author_username=${BOT_USER}&created_before=${CUTOFF}&per_page=100" \
  | jq -r '.[] | "\(.created_at[0:10])  \(.references.full)  \(.title)"'

# 2. Each in-scope project has an open Dependency Dashboard issue.
#    Expected: one line per project that carries renovate.json.
curl -fsS -K "${CURL_CFG}" \
  "${GITLAB_URL}/api/v4/groups/${GROUP_ID}/issues?state=opened&author_username=${BOT_USER}&search=Dependency%20Dashboard&per_page=100" \
  | jq -r '.[] | .references.full'

# 3. Projects where "Pipelines must succeed" is off (automerge would be unsafe).
#    Expected: no output.
curl -fsS -K "${CURL_CFG}" \
  "${GITLAB_URL}/api/v4/groups/${GROUP_ID}/projects?include_subgroups=true&per_page=100" \
  | jq -r '.[] | select(.only_allow_merge_if_pipeline_succeeds != true) | .path_with_namespace'
```

Finally, the runner pipeline itself: the last scheduled run of `platform/renovate-runner` succeeded within the last day. A failed run is triaged the same day, because a broken runner stops every update at once.

## References

- Renovate configuration presets: https://docs.renovatebot.com/config-presets/
- Renovate configuration options: https://docs.renovatebot.com/configuration-options/
- Dependency Dashboard: https://docs.renovatebot.com/key-concepts/dashboard/
- Docker and digest pinning: https://docs.renovatebot.com/docker/
- GitLab CI include manager: https://docs.renovatebot.com/modules/manager/gitlabci-include/
- Config validation: https://docs.renovatebot.com/config-validation/
- Running Renovate (self-hosting): https://docs.renovatebot.com/getting-started/running/
- Renovate runner for GitLab: https://gitlab.com/renovate-bot/renovate-runner

Related notes:

- [[renovate-vs-dependabot]]
- [[automated-dependency-updates]]
- [[dependency-update-policy]]
- [[vulnerability-management-slas]]
- [[gitlab-ci-components-and-includes]]
- [[terraform-module-versioning]]
- [[helm-chart-ci-quality-gates]]

Related ADRs:

- [[0007-language-packages-resolve-through-artifactory]]
- [[0010-deploy-images-by-digest]]
- [[0012-gitlab-ci-for-new-pipelines]]
- [[0013-versioned-central-ci-templates]]
- [[0034-terraform-modules-versioned-by-git-tag]]
- [[0035-terraform-plan-policy-gate-and-ci-only-apply]]
- [[0036-secret-manager-as-secrets-system-of-record]]
- [[0038-kyverno-verifies-image-signatures-at-admission]]
- [[0040-golden-base-images-owned-by-platform]]

[^runner]: Per the README of the renovate-runner project on gitlab.com, which also provides a CI template for this setup.

[^presets]: Per Renovate's configuration presets page; a preset file in another project defaults to `default.json`.
