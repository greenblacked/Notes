---
title: "Provenance evidence from Artifactory: build info, checksums and promotion records"
description: Use digests, build info, properties and promotion records in Artifactory as an audit trail from source commit to deployed artifact.
type: pattern
tags:
  - compliance
  - supply-chain
  - artifactory
  - audit
  - ci-cd
created: 2026-10-19
modified: 2026-10-19
draft: false
---

This note covers Artifactory as an audit trail: which records it keeps, how to make them useful as evidence, and how to answer "where did this artifact come from?" years later. The pipeline itself (repositories, promotion stages) is in [[patterns/artifact-promotion-artifactory]]; here only the evidence fields and their verification are covered.

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Not checked against a running system
> JFrog CLI subcommand names and flags vary by CLI and Artifactory version, and some features depend on edition. The commands are illustrative; check the current JFrog documentation.

## What Artifactory can prove and what it cannot

It can show what was stored, when, under which checksum, which build produced it, which commit that build recorded, and who promoted it. It cannot prove the build was hermetic or that the build info is truthful, because the CI job writes that information. Proving the build environment is the job of provenance attestations; see [[compliance/slsa-build-provenance]]. Think of Artifactory records as a well-indexed claim by CI, cross-checked against Git and the approval system.

## The digest is the identity

A tag names an artifact; a digest identifies it. Artifactory stores SHA-256 (and others) checksums for files, and container images have a manifest digest. Evidence records and deployments should carry the digest:

- A Docker tag like `1.4.2` can be overwritten or retagged. `sha256:...` cannot refer to different content.
- Deploy by digest, and record the digest in the deploy record. Admission-time verification is in [[patterns/image-signing-and-admission-verification]].

## Publishing build info from CI

Build info is a JSON document tying a build name and number to its artifacts, dependencies, environment and VCS revision. Publish it from CI so it carries the commit and the CI URL.

```yaml title=".gitlab-ci.yml"
variables:
  JF_URL: "https://artifactory.example.com" # change: your Artifactory URL
  BUILD_NAME: "${CI_PROJECT_PATH_SLUG}"
  BUILD_NUMBER: "${CI_PIPELINE_ID}"

publish-build-info:
  stage: publish
  image: releases-docker.jfrog.io/jfrog/jfrog-cli-v2-jf:latest # pin a version or digest in real use
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    # Subcommand names and flags differ by CLI version: check "jf rt --help".
    - jf rt upload "dist/*" example-generic-local/${CI_PROJECT_NAME}/${CI_COMMIT_SHA}/ --build-name="${BUILD_NAME}" --build-number="${BUILD_NUMBER}"
    - jf rt build-collect-env "${BUILD_NAME}" "${BUILD_NUMBER}"
    - jf rt build-add-git "${BUILD_NAME}" "${BUILD_NUMBER}"
    - jf rt build-publish "${BUILD_NAME}" "${BUILD_NUMBER}"
```

Authenticate with a short-lived or narrowly scoped token for this pipeline, supplied as a masked CI variable. Do not give every pipeline an admin token.

## Promotion records

Promotion moves a build's artifacts to the next repository and records who, when and why. Record the change reference as a property so a search can find it.

```bash title="scripts/promote-with-evidence.sh"
set -euo pipefail

BUILD_NAME="example-org-api"          # change: build name
BUILD_NUMBER="1042"                   # change: build number
TARGET_REPO="example-docker-prod-local" # change: target repository
CHANGE_REF="CHG-1234"                 # change: your change ticket

# Check the exact flags in the current JFrog CLI docs before use.
jf rt build-promote "${BUILD_NAME}" "${BUILD_NUMBER}" "${TARGET_REPO}" \
  --status="promoted-to-prod" --comment="Approved under ${CHANGE_REF}"

jf rt set-props "${TARGET_REPO}/example-org/api/*" \
  "promoted.by=${GITLAB_USER_LOGIN:-unknown};promoted.at=$(date -u +%Y-%m-%dT%H:%M:%SZ);change.ref=${CHANGE_REF}"
```

Restrict the permission to promote to a dedicated identity and to the environment approvers' pipeline. If any developer token can promote, the record says nothing about approval.

## Linking attestations and SBOMs

Store the SBOM and the provenance attestation next to the artifact, or reference them by the artifact digest, so one lookup returns all three ([[compliance/sbom-generation-and-storage]]). Newer Artifactory versions have an evidence feature for attaching signed attestations to artifacts and builds. Check the current docs and your edition before relying on it, and keep a plain-file fallback.

## Keeping the chain intact

```mermaid
flowchart LR
    C[Commit<br/>reviewed MR] --> B[CI build]
    B --> BI[Build info<br/>published]
    BI --> P[Promote<br/>with change ref]
    P --> D[Deploy by digest]
    D --> E[Evidence record<br/>in locked bucket]
```

The chain breaks when someone removes a link:

- Cleanup and retention must not delete build info or promoted artifacts needed for the audit period; align with [[standards/artifact-retention-policy]] and [[legal-hold-for-logs-and-artifacts]].
- Make production repositories not allow overwrite or delete for normal users.
- Export build info JSON to the evidence bucket on promotion, so the record survives an Artifactory migration or accidental deletion.

## Verifying an artifact years later

Start from the digest recorded in the deploy record, then walk back.

```bash title="scripts/trace-artifact.sh"
set -euo pipefail

SHA256="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" # change: digest from the deploy record

# 1. Find the file by checksum with AQL.
cat > query.aql <<AQL
items.find({"sha256":"${SHA256}"}).include("repo","path","name","created","@build.name","@build.number")
AQL
jf rt curl -XPOST /api/search/aql -H "Content-Type: text/plain" -d @query.aql

# 2. Fetch the build info (name and number come from step 1).
jf rt curl -XGET "/api/build/example-org-api/1042" > buildinfo.json

# 3. Walk to the commit and the CI run.
jq -r '.buildInfo | {started, url, vcs: .vcs[0].revision, vcsUrl: .vcs[0].url}' buildinfo.json
```

Then take the commit from `vcs`, find its merge request in Git, and read the approvals. If any link is missing, you have found a gap to record, not a detail to skip.

## Pitfalls

- **Overwrite allowed.** The same path can hold different content over time; rely on the checksum.
- **Retagging.** A moved tag silently changes what "1.4.2" means.
- **Build info deleted by a build-retention setting.** Check build retention separately from artifact retention.
- **Shared admin tokens.** Records then name the token, not a person or pipeline.
- **Trusting properties as proof.** Properties can be edited by anyone with permission; protect that permission and export copies.

## Related

- [[patterns/artifact-promotion-artifactory]]: repositories and the promotion pipeline.
- [[compliance/slsa-build-provenance]]: attestations about how the build ran.
- [[compliance/sbom-generation-and-storage]]: inventory of components.
- [[standards/artifact-retention-policy]]: retention rules this must not conflict with.
- [[patterns/image-signing-and-admission-verification]]: verifying digests at deploy time.
- [[legal-hold-for-logs-and-artifacts]]: protecting artifacts from cleanup.

## Sources

- JFrog, [JFrog CLI documentation](https://docs.jfrog-applications.jfrog.io/): build integration and promotion commands.
- JFrog, [Artifactory documentation](https://jfrog.com/help/r/jfrog-artifactory-documentation): build info, AQL and properties pages.
- SLSA, [specification](https://slsa.dev/spec/).
