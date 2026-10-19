---
title: Production ships from protected SemVer tags behind a manual gate
description: Releases are annotated vX.Y.Z tags cut from a tested stage state, with generated changelogs; only protected tags reach the protected production environment.
type: adr
tags:
  - adr
  - delivery
  - ci-cd
  - gitlab-ci
  - security
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0047
---

## Context

Production deployments currently start from whichever branch or commit someone chooses. Version numbers are informal, release notes are written by hand when someone remembers, and a pipeline on any branch can in principle reach production credentials. When something breaks, answering "what exactly is in production and what changed since the last release?" takes archaeology.

We want a release to be a named, immutable, reviewable event: one identifier that links the code, the built artifact, the changelog and the deployment, with a human decision before production and no way to reach production from an unprotected ref.

## Decision

We will release from **annotated, protected SemVer tags (`vX.Y.Z`)**, cut from a state that has passed stage, with a **protected `production` environment that requires manual approval**.

- Versions follow Semantic Versioning. The next version is derived from Conventional Commits since the previous tag (breaking change, feature, fix). The tooling for this is described in [[release-versioning-and-changelog-automation]].
- A changelog is generated from the same commits and published with the release. Nobody writes release notes by hand.
- Tags matching `v*` are protected: only a small maintainer group can create them, and nobody can move or delete one.
- Pipelines on branches and merge requests run build, test and scan, and deploy only to non-production. Production deploy jobs exist only in tag pipelines, targeting a protected environment with named approvers and, where practical, an approver who is not the author of the release ([[separation-of-duties-in-deployments]]).
- Production credentials (cloud identity, Argo CD tokens) are scoped to the protected environment or protected refs, so an unprotected pipeline cannot read them. See [[0026-keyless-ci-auth-with-workload-identity-federation]] for the identity side.
- The tag promotes artifacts that were already built and scanned; it does not rebuild ([[0004-build-once-promote-between-repositories]]).
- A hotfix is a patch release cut from the release tag it fixes, through the same gates, with the fix merged back to the main line. Expedited approval is allowed; skipping the pipeline is not.
- Release cadence is set per team and written in the team's runbook. This record does not fix a number of releases per week.
- The deployment of a tag can be rolled back to the previous tag's digests as described in [[0048-rollback-by-redeploying-previous-digest]].

```yaml title=".gitlab-ci.yml"
deploy-production:
  stage: deploy
  rules:
    - if: '$CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/'
      when: manual
  environment:
    name: production
    deployment_tier: production
  script:
    - ./scripts/promote-and-bump.sh "${CI_COMMIT_TAG}"
```

Break-glass only: the normal path is the release workflow, which creates the tag. The maintainer group may run this script when the workflow is unavailable, and the use is recorded in the change log.

```bash title="cut-release.sh"
set -euo pipefail
VERSION="1.4.0"

git switch main
git pull --ff-only
git tag --annotate "v${VERSION}" --message "Release v${VERSION}"
git push origin "v${VERSION}"
```

> [!info] Claims not checked against current docs
> GitLab protected tag and protected environment settings, the approval rule options available on your GitLab tier, and the exact `rules` semantics were not verified. Check the GitLab documentation for protected environments and tag protection for your version.

## Consequences

Easier:

- "What is in production" has a one-word answer, and the diff to the previous release is a tag comparison.
- A compromised feature branch cannot reach production credentials.
- Changelogs and version numbers are consistent and automatic.
- Audit evidence (who approved which version, when) is a by-product ([[change-management-controls-and-pipeline-evidence]]).

Harder or newly required:

- Commit messages must follow the convention for version derivation to work. A linter in merge request pipelines enforces it, and bad messages produce wrong versions.
- The manual gate adds latency. Teams need approvers available, and on-call needs a documented expedited path.
- Protected tags and environments need setup per project and drift if not managed as code. Put the settings in Terraform or the GitLab API.
- SemVer for services is a convention, not a compatibility promise by itself. Teams must define what a breaking change means for their API.
- Monorepos with several deployables need per-component tags or a clear mapping.

## Alternatives considered

- **Continuous deploy to production from the main branch.** Fastest feedback, and appropriate for some low-risk services, but it removes the human gate we want for regulated and tier-1 systems. Teams may propose it per service with evidence from [[production-change-checklist]].
- **Ad hoc tags or commit SHAs.** Simple, but no meaning, no ordering and no changelog.
- **CalVer.** Good for products with a time-based release identity, but it says nothing about the type of change. Rejected for services.

## Validation

```bash
set -o pipefail
GITLAB_URL="https://gitlab.example.com"
PROJECT_ID="1234"
# GITLAB_TOKEN must be a read-only API token provided by your environment

# -H/-u expose the token in the process list on a shared host; prefer a curl config file (-K) or ~/.netrc written from a masked variable.
# Tag protection includes v*
curl -sS --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
  "${GITLAB_URL}/api/v4/projects/${PROJECT_ID}/protected_tags" | jq -r '.[].name'

# The production environment is protected (field names depend on the GitLab version)
curl -sS --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
  "${GITLAB_URL}/api/v4/projects/${PROJECT_ID}/protected_environments" | jq -r '.[].name'

# Every release tag matches SemVer and is annotated (prints offenders)
git tag --list 'v*' | grep -Ev '^v[0-9]+\.[0-9]+\.[0-9]+$' || true
git for-each-ref 'refs/tags/v*' --format='%(objecttype) %(refname:short)' | awk '$1!="tag"{print "lightweight: "$2}'
```

## References

- Semantic Versioning: https://semver.org/
- Conventional Commits: https://www.conventionalcommits.org/en/v1.0.0/
- GitLab protected environments: https://docs.gitlab.com/ci/environments/protected_environments/
- Related notes: [[release-versioning-and-changelog-automation]], [[environments-releases-and-rollbacks]], [[production-change-checklist]], [[change-freezes-and-maintenance-windows]]
- Related ADRs: [[0004-build-once-promote-between-repositories]], [[0048-rollback-by-redeploying-previous-digest]]
