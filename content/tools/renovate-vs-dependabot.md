---
title: Renovate vs Dependabot
description: "Choosing a dependency update bot for GitHub and GitLab repos with Terraform, Helm, Dockerfiles and CI images: coverage, grouping, automerge and hosting."
type: tool
tags:
  - tools
  - supply-chain
  - ci-cd
  - security
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Unpinned, unreviewed dependencies are a supply chain risk; pinned, never-updated dependencies are a different one. A bot that opens small, tested pull requests is how teams stay between the two. Dependabot and Renovate are the two common choices. The rollout pattern, pinning policy and GitLab setup are in [[automated-dependency-updates]]; this note compares the tools themselves.

> [!info] Not checked against current releases
> Supported ecosystems, configuration keys, hosting options and limits were not checked when this note was written. Confirm them in each tool's current documentation before relying on them.

## Short answer

- GitHub-only repos with common ecosystems and a wish for zero hosting: **Dependabot**.
- GitLab, mixed platforms, many ecosystems, custom managers (regex), or fine-grained rules: **Renovate**.
- Both can run side by side during a migration if they do not touch the same files.

## At a glance

| Concern             | Dependabot                                                 | Renovate                                                           |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Platforms           | GitHub                                                     | GitHub, GitLab, Bitbucket, Azure DevOps and others; check the docs |
| Hosting             | Built into GitHub                                          | Hosted GitHub app, self-hosted container or CI job                 |
| Configuration       | `.github/dependabot.yml`                                   | `renovate.json` (or similar) with presets                          |
| Ecosystems          | Fixed list per package ecosystem; check the docs           | Very broad managers, plus custom regex managers                    |
| Grouping            | `groups` by pattern or update type                         | `packageRules` with `groupName`, presets                           |
| Automerge           | Via GitHub auto-merge and workflow; not built into the bot | Built in, with branch or PR automerge                              |
| Schedules           | `schedule` per ecosystem                                   | Cron-like schedules, rate limits, stabilisation windows            |
| Dashboard           | Security alerts and version updates in GitHub UI           | Optional dependency dashboard issue                                |
| Security updates    | Tied to GitHub's advisory data and alerts                  | Can use vulnerability data; check the docs for sources             |
| Self-hosting effort | None                                                       | Some, if not using the hosted app                                  |

## Ecosystem coverage

The tools in this site's stack: Terraform providers and modules, Helm charts and `Chart.yaml` dependencies, Dockerfile `FROM` lines and digests, GitHub Actions versions, GitLab CI `include` and `image:` references, and language packages.

Both bots handle package managers, Dockerfiles, Terraform and GitHub Actions. Coverage of less common files differs: GitLab CI includes, Helm values with image tags, Kubernetes manifests, `.tool-versions` and custom version strings in scripts are Renovate territory, particularly with regex managers that match any pattern you define. Check each tool's supported-ecosystems page for every file type in your repositories rather than assuming. An unsupported file is silently not updated, which is the worst outcome.

Digest pinning is where the difference is visible in practice. Both can update a pinned `image@sha256:...` digest while keeping the tag comment readable, but the configuration to do it is more explicit in Renovate, and the behaviour for GitHub Actions pinned to a full commit SHA should be confirmed in the current documentation of each. For why to pin, see [[image-signing-and-admission-verification]] and [[dockerfile-hardening]].

## Grouping, schedules and automerge

Noise kills adoption. Two practices help in both tools: group related updates into one PR, and run on a schedule, not on every upstream release.

```yaml title=".github/dependabot.yml"
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
      day: monday
    groups:
      actions:
        patterns: ["*"]
    commit-message:
      prefix: "ci"

  - package-ecosystem: docker
    directory: /
    schedule:
      interval: weekly
    groups:
      docker-minor-patch:
        update-types: [minor, patch]

  - package-ecosystem: terraform
    directory: /infra
    schedule:
      interval: weekly
    groups:
      terraform-minor-patch:
        update-types: [minor, patch]
    open-pull-requests-limit: 5
```

```json title="renovate.json"
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:recommended",
    ":semanticCommits",
    "helpers:pinGitHubActionDigests",
    "docker:pinDigests"
  ],
  "schedule": ["before 6am on monday"],
  "timezone": "Europe/Kyiv",
  "prConcurrentLimit": 5,
  "minimumReleaseAge": "3 days",
  "packageRules": [
    {
      "matchUpdateTypes": ["minor", "patch"],
      "matchManagers": ["terraform", "helm-values", "dockerfile"],
      "groupName": "infrastructure minor and patch"
    },
    {
      "matchUpdateTypes": ["patch"],
      "matchManagers": ["npm"],
      "matchCurrentVersion": "!/^0/",
      "automerge": true,
      "automergeType": "pr"
    },
    {
      "matchManagers": ["terraform", "helm-values", "helmv3", "gitlabci", "dockerfile"],
      "automerge": false
    },
    {
      "matchUpdateTypes": ["major"],
      "automerge": false,
      "labels": ["major-update", "needs-review"]
    }
  ],
  "vulnerabilityAlerts": { "labels": ["security"] }
}
```

The `minimumReleaseAge` of 3 days is a proposed default from [[dependency-update-policy]], so a release that is yanked or found malicious within days is not adopted at once. Automerge is limited to patch updates of the `npm` manager (an example; list the ecosystems where you have a required test gate), and a later rule switches it off for Terraform, Helm, GitLab CI and Dockerfile updates, including base images, which a person reviews. Renovate applies matching `packageRules` in order, so the later `false` wins.

Preset names and option keys change between releases, so validate the file (below) and read the current preset documentation before adopting any of them. The `Europe/Kyiv` timezone is an example; use yours.

Dependabot has no built-in automerge. The usual pattern is a workflow that enables GitHub auto-merge for patch updates once required checks pass. That workflow runs with a token, so treat it carefully: never trigger it from `pull_request_target` with a checkout of the PR head, and see [[secret-scanning-pre-commit-and-ci]] and the Actions security notes in [[github-actions-vs-gitlab-ci-vs-jenkins]].

## Security updates and alerts

Dependabot security updates are driven by GitHub's advisory database and the repository's alert settings; version updates are configured separately by the YAML above. Renovate raises vulnerability PRs from the data sources its managers use, and can label and prioritise them. Whichever bot you use, the signal should land in the same place as other findings (your ticket system or dashboard), and exceptions should go through [[policy-exception-and-waiver-process]] with an expiry.

Security PRs deserve a faster path than routine ones: allow them outside the weekly window, and do not group them behind a slow batch.

## Hosting

- **Dependabot:** nothing to host. Runs in GitHub; private registry credentials are stored as Dependabot secrets, separate from Actions secrets.
- **Renovate hosted app:** install on GitHub, no hosting. Check the current terms and the scope of repository access you grant.
- **Renovate self-hosted:** run the container on a schedule in CI, authenticated with a bot account or app token. This is the route for GitLab and for private networks. The token's scope is the blast radius: give the bot only the repositories it manages and the minimum permissions to open PRs.

The GitLab runner and token setup is in [[automated-dependency-updates]]. Do not store the bot token in the repository; use a masked, protected CI variable.

## Guardrails

Automerge is where the risk is. A safe default:

- Automerge only **patch** updates of dependencies at `1.0` and above, and only when required CI checks pass, including tests, `terraform plan` checks and scans.
- Major updates, and anything for `0.x` versions, stay manual and are reviewed against the changelog.
- Anything touching base images, CI images or the build toolchain is reviewed, because it changes what runs with your credentials.
- A stabilisation window (wait a few days after release) reduces exposure to a yanked or compromised release. Renovate supports a minimum release age; check the option name in its docs.
- The bot's own configuration is protected: branch protection and code owners on `renovate.json`, `.github/dependabot.yml` and the workflows that merge.
- Limit the number of open PRs so the review queue stays humane.

## Validation and rollback

Validate Renovate configuration in CI so a typo does not silently disable updates. Run the validator through a pinned image:

```bash title="validate renovate.json"
docker run --rm -v "$PWD":/repo -w /repo \
  --entrypoint renovate-config-validator \
  ghcr.io/renovatebot/renovate:<pinned-version> \
  renovate.json
```

Replace `<pinned-version>` with a release you have checked on the Renovate releases page, ideally pinned by digest, and let the bot update its own pin. Dependabot configuration errors appear in the repository's Dependabot insights page, and GitHub validates the file when it is committed.

Rollback is an ordinary revert of the bot's merge commit, followed by a pinned exclusion if the update must wait:

```bash
git revert -m 1 <merge-commit>
```

For a bad Helm chart or image bump already deployed, follow the deployment rollback in [[helm-release-rollback]], and add an ignore rule with a comment and a date so the bot does not reopen the PR immediately. For release notes and changelog handling around bot merges see [[release-versioning-and-changelog-automation]]; for chart test gates that catch a bad bump before merge, see [[helm-chart-ci-quality-gates]].

## When to choose which

Choose **Dependabot** when you are on GitHub, your ecosystems are covered, and you value having nothing to run or secure.

Choose **Renovate** when you are on GitLab or multiple platforms, need custom managers, rich grouping and built-in automerge, or want one tool and one config format everywhere.

## Recommendation

For GitHub-only repositories with standard ecosystems, start with Dependabot, grouped weekly, with security alerts on. For GitLab, or when you need broad coverage and automerge policy, run Renovate self-hosted with a scoped token, validated config and patch-only automerge behind green CI. Do not run both on the same ecosystem in one repository. Revisit when your platform changes, when a file type you rely on is unsupported, or when the review queue becomes the bottleneck. Lock-in is low: both tools open ordinary PRs, so you can switch by changing the config and retiring the other.

## Related

- [[automated-dependency-updates]]
- [[release-versioning-and-changelog-automation]]
- [[helm-chart-ci-quality-gates]]
- [[terraform-vs-opentofu]]

## Sources

- [Dependabot documentation](https://docs.github.com/en/code-security/dependabot)
- [Renovate documentation](https://docs.renovatebot.com/)
- [Renovate configuration validation](https://docs.renovatebot.com/config-validation/)
