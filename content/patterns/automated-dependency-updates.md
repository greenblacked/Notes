---
title: Automated dependency and image updates
description: Keep base images, CI tool images, Helm charts and Terraform providers pinned by digest and current with Renovate merge requests in GitLab.
type: pattern
tags:
  - patterns
  - ci-cd
  - docker
  - gitlab-ci
  - security
created: 2026-10-16
modified: 2026-10-16
draft: false
---

Pinning an image by digest makes a build reproducible, and it also freezes it: the pin never picks up a security fix on its own. Without automation, pins go stale and people quietly go back to `latest`. The fix is a bot that opens a merge request for every bump, so updating is a small reviewed change rather than a chore nobody owns. The pinning rules are in [[dockerfile-hardening]] and [[gitlab-ci-pipeline-structure]]; this note is how to keep those pins current.

## How Renovate fits

Renovate is a dependency update bot. Against GitLab it runs as a scheduled pipeline in a small project of its own (or in each repository), authenticates with a bot user's access token, scans the repositories it is given, and opens merge requests for outdated dependencies. It also maintains a dependency dashboard issue that lists pending updates.

- Run it from a GitLab scheduled pipeline, for example daily, using a masked, protected CI/CD variable for the bot token.
- Pin the Renovate image itself by tag and digest, like any other tool image. Renovate can bump its own pin if you let it manage that file.
- Use a dedicated bot user with the minimum role needed to push branches and open merge requests, not a personal token.
- It understands Dockerfiles, Helm charts, Terraform providers and modules, and GitLab CI files out of the box. Check the Renovate docs for the managers your version enables by default.

## A starting renovate.json

```json title="renovate.json"
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "pinDigests": true,
  "labels": ["dependencies"],
  "packageRules": [
    {
      "description": "Group digest-only updates and merge them when the pipeline passes",
      "matchUpdateTypes": ["digest", "pin"],
      "groupName": "image digests",
      "automerge": true
    },
    {
      "description": "Let new major releases age before a merge request is opened",
      "matchUpdateTypes": ["major"],
      "minimumReleaseAge": "7 days",
      "labels": ["dependencies", "major"]
    }
  ]
}
```

`pinDigests` makes Renovate add the digest to tags that have none and keep it fresh afterwards. Automerge only happens when the project's required checks pass; keep "pipelines must succeed" on for the target branch.

## Images in .gitlab-ci.yml variables

Tool images in a `variables:` block are plain strings, so Renovate needs a hint. A custom manager with a regular expression reads a comment placed on the line above the variable:

```yaml title=".gitlab-ci.yml (excerpt)"
variables:
  # renovate: datasource=docker depName=aquasec/trivy
  TRIVY_IMAGE: aquasec/trivy:<tested-version>@sha256:<digest>
```

```json title="renovate.json (customManagers excerpt)"
{
  "customManagers": [
    {
      "customType": "regex",
      "managerFilePatterns": ["/(^|/)\\.gitlab-ci\\.ya?ml$/"],
      "matchStrings": [
        "# renovate: datasource=(?<datasource>\\S+) depName=(?<depName>\\S+)\\n\\s*\\w+: \\S+?:(?<currentValue>[^@\\s]+)(?:@(?<currentDigest>sha256:[a-f0-9]+))?"
      ]
    }
  ]
}
```

> [!info] Check option names against your Renovate version
> Renovate renames options between releases (for example the file pattern option of custom managers). Check the Renovate docs for the version you run before copying this configuration, and test it with a dry run.

## Policy

- **Who reviews.** The team that owns the repository reviews the merge requests; the platform team owns the shared templates and the Renovate configuration itself.
- **Automerge.** Only for digest and pin updates, and only with a passing pipeline. Anything that changes behaviour waits for a person.
- **Major updates.** Each needs a named owner and a short note on what was checked. Do not let majors pile up; a stale major is a larger upgrade later.
- **Security alerts.** A security fix is not held back by the release-age delay. Route vulnerability findings from the image scan to the same owners and handle them as normal merge requests, with the severity deciding the deadline; for exposed credentials follow [[leaked-credential-rotation]] instead.
- **Noise.** Group updates, limit concurrent merge requests, and schedule runs outside working hours so the queue stays reviewable.

## Verify

- The dependency dashboard issue exists in the repository after the first run.
- The first merge requests arrive, each with a digest or version bump and a green pipeline.

## Rollback

Revert the bump merge request. If the cause was a bad image, pin the previous digest by hand and, if needed, add a package rule to hold that dependency until the issue is understood.

## Related

- [[helm-chart-conventions]]: chart dependencies and versioning that Renovate updates.
- [[terraform-module-and-state-layout]]: provider and module pins, and the lock file.
- [[sonarqube-quality-gates]]: the scanner image pin.
