---
title: Automated dependency and image updates
description: Keep image digests, Helm chart versions and Terraform provider locks current with Renovate merge requests in GitLab.
type: pattern
tags:
  - patterns
  - ci-cd
  - docker
  - gitlab-ci
  - security
created: 2026-10-16
modified: 2026-11-25
draft: false
---

Pinning an image by digest makes a build reproducible, and it also freezes it: the pin never picks up a security fix on its own. Without automation, pins go stale and people quietly go back to `latest`. The fix is a bot that opens a merge request for every bump, so updating is a small reviewed change rather than a chore nobody owns. The pinning rules are in [[dockerfile-hardening]] and [[gitlab-ci-pipeline-structure]]; this note is how to keep those pins current.

## How Renovate fits

Renovate is a dependency update bot. Against GitLab it runs as a scheduled pipeline in a small project of its own (or in each repository), authenticates with a bot user's access token, scans the repositories it is given, and opens merge requests for outdated dependencies. It also maintains a dependency dashboard issue that lists pending updates.

- Run it from a GitLab scheduled pipeline, for example daily, using a masked, protected CI/CD variable for the bot token.
- Pin the Renovate image itself by tag and digest, like any other tool image. Renovate can bump its own pin if you let it manage that file.
- Use a dedicated bot user with the minimum role needed to push branches and open merge requests, not a personal token.
- It understands Dockerfiles, Helm charts, Terraform providers (by version constraint and lock file) and modules, and GitLab CI files out of the box. Check the Renovate docs for the managers your version enables by default.

## A starting renovate.json

```json title="renovate.json"
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "pinDigests": true,
  "labels": ["dependencies"],
  "packageRules": [
    {
      "description": "Group digest-only updates into one merge request for review",
      "matchUpdateTypes": ["digest", "pin"],
      "groupName": "image digests"
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

`pinDigests` makes Renovate add the digest to tags that have none and keep it fresh afterwards. The digest rule does not automerge: a digest that changes under an unchanged tag is also what a re-pushed or tampered tag looks like, so a person looks at it first (see Policy).

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

## Terraform providers and the lock file

Providers are not pinned by digest. `required_providers` holds a version constraint (`~> 8.0`), and `terraform init` writes the exact version it selected, the constraints it considered and the package hashes into `.terraform.lock.hcl`. Commit that file, so a provider change is reviewed like any other change; `terraform init -upgrade` picks the newest version the constraint allows and rewrites the file. The lock file covers providers only: pin modules with an exact `version`.

The hashes are per platform. When CI runs on Linux and people run plans on macOS, record both in advance so `init` does not add hashes later on someone's laptop:

```bash title="record provider hashes for every platform you run on"
terraform providers lock \
  -platform=linux_amd64 \
  -platform=darwin_arm64   # change: the platforms your CI runners and laptops use
```

Renovate's Terraform manager updates provider constraints and supports `lockFileMaintenance` for `.terraform.lock.hcl`, which it performs itself without calling Terraform. Whether a provider bump also refreshes the hashes for every platform you need is not stated in its docs: read the lock diff of the first merge request, and if a platform is missing, run the command above in the merge request's branch. A plan job with `terraform init -lockfile=readonly` (check the flag for your version) fails when the committed lock does not match.

## Policy

- **Who reviews.** The team that owns the repository reviews the merge requests; the platform team owns the shared templates and the Renovate configuration itself.
- **Automerge.** Off by default, including for digest and pin updates, because a digest change under the same tag is exactly what a tampered tag looks like and an automerge would take it without a person, including for CI tool images that run with deploy credentials. If you turn it on, limit it with a package rule to images from registries you control or mirror, require a passing pipeline, and keep "pipelines must succeed" on for the target branch; check the Renovate docs for the rule fields your version supports. This is stricter than [[0060-renovate-for-automated-dependency-updates]], which still automerges digest and pin updates; follow this note for CI and base images. Anything that changes behaviour waits for a person.
- **Major updates.** Each needs a named owner and a short note on what was checked. Do not let majors pile up; a stale major is a larger upgrade later.
- **Security alerts.** A security fix is not held back by the release-age delay. Route vulnerability findings from the image scan to the same owners and handle them as normal merge requests, with the severity deciding the deadline; for exposed credentials follow [[leaked-credential-rotation]] instead.
- **Noise.** Group updates, limit concurrent merge requests, and schedule runs outside working hours so the queue stays reviewable.

## Verify

- The dependency dashboard issue exists in the repository after the first run.
- The first merge requests arrive, each with a digest or version bump and a green pipeline.

## Rollback

Revert the bump merge request. If the cause was a bad image, pin the previous digest by hand and, if needed, add a package rule to hold that dependency until the issue is understood.

## Sources

- HashiCorp Developer, "Dependency lock file" (https://developer.hashicorp.com/terraform/language/files/dependency-lock): what the file records, that it covers providers and not modules, `terraform init -upgrade` and `terraform providers lock` with `-platform`; checked 2026-11-24.
- Renovate documentation, Terraform manager (https://docs.renovatebot.com/modules/manager/terraform/): provider updates and `lockFileMaintenance`; checked 2026-11-24.
- Not verified: `terraform init -lockfile=readonly`, whether Renovate refreshes hashes for every platform on a provider bump, and the Renovate package-rule fields for limiting automerge to chosen registries.

## Related

- [[helm-chart-conventions]]: chart dependencies and versioning that Renovate updates.
- [[terraform-module-and-state-layout]]: provider and module pins, and the lock file.
- [[sonarqube-quality-gates]]: the scanner image pin.
