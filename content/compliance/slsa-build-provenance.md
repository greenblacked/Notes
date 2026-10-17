---
title: SLSA build levels and provenance for GitLab CI and Jenkins
description: What SLSA Build levels ask for, what is realistic on GitLab CI and self-hosted Jenkins, and how consumers verify signed provenance.
type: guide
tags:
  - compliance
  - supply-chain
  - ci-cd
  - gitlab-ci
  - jenkins
created: 2026-10-17
modified: 2026-10-17
draft: false
aliases:
  - SLSA
---

This guide explains what the SLSA Build levels require in plain words, what you can reach with GitLab CI and a self-hosted Jenkins, how to generate and verify signed provenance, and which gaps remain on self-managed runners. It is written for senior DevOps engineers who need a roadmap they can start on Monday. It leaves component inventory to [[compliance/sbom-generation-and-storage]], signature policy and admission enforcement to [[patterns/image-signing-and-admission-verification]], and runner and controller hardening to [[patterns/gitlab-runners-on-gke]] and [[patterns/jenkins-controller-and-agent-hardening]].

> [!info] Scope and sources
> Written against the SLSA specification ([slsa.dev](https://slsa.dev)), the in-toto statement format, and cosign attestations from [sigstore.dev](https://sigstore.dev). The level descriptions are paraphrased; the specification is the authority.

> [!note] Not verified
> The claims below were written from documentation knowledge and were not checked against a running system or the current docs: the current SLSA specification version and the exact level wording, GitLab native provenance support, and slsa-verifier support for non-GitHub builders. Check them before relying on them.

## SLSA in one page

SLSA (Supply-chain Levels for Software Artifacts) describes how much you can trust that an artifact was built from the source you think it was, by the build system you think built it, without tampering on the way. The Build track defines levels. Each level adds a requirement about the build platform and about the provenance it emits.

Provenance is a signed statement that says: this artifact (identified by digest) was produced by this builder, from this source revision, with these parameters and inputs. A consumer checks the signature, then checks that the builder and source match what they expect. Without that second check, provenance only proves that somebody signed something.

## Provenance versus SBOM

| Concern            | Provenance                                       | SBOM                                             |
| ------------------ | ------------------------------------------------ | ------------------------------------------------ |
| Question answered  | How, where and from what was this built          | What components are inside                       |
| Typical content    | Builder identity, source revision, build inputs  | Packages, versions, licences                     |
| Produced by        | The build platform, ideally not the build script | A scanner run against the artifact or the source |
| Consumer use       | Reject artifacts from unexpected builders        | Find affected artifacts, check licences          |
| Failure it detects | Build tampering, wrong source, bypassed pipeline | Vulnerable or disallowed components              |

You want both. They are attached to the same image digest as separate attestations (see [[compliance/sbom-generation-and-storage]]).

## Levels and the controls they need

Treat the table as a map of the controls involved, not as a pass/fail test.

| Level   | Requirement in plain words                                                   | How on GitLab CI                                                                | How on Jenkins                                                               |
| ------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Build 1 | The build is scripted and provenance exists, even if unsigned                | CI pipeline file in the repo; export job metadata as provenance                 | Jenkinsfile in the repo; write a provenance file in a final stage            |
| Build 2 | A hosted build platform generates and signs provenance                       | Sign in a separate job with the job OIDC token; protect the pipeline definition | Sign with a KMS key held by a controller-side step, not by the build agent   |
| Build 3 | Builds are isolated from each other and the signing material is out of reach | Ephemeral runners per job, no shared cache between projects, protected branches | Ephemeral agents per build, no shared workspace, signing outside agent reach |

The hard part of levels 2 and 3 is not the signature. It is making sure the code that runs inside the build cannot forge or alter the provenance. If a build step can read the signing key or can call the signing endpoint with arbitrary content, the provenance only vouches for whatever the build script chose to say.

## Generating provenance

The provenance document is an in-toto statement. The excerpt below shows the shape; every value is an example to change.

```json title="provenance.json"
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [
    {
      "name": "europe-docker.pkg.dev/my-project/my-repo/my-app",
      "digest": {
        "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
      }
    }
  ],
  "predicateType": "https://slsa.dev/provenance/v1",
  "predicate": {
    "buildDefinition": {
      "buildType": "https://example.com/build-types/gitlab-ci/v1",
      "externalParameters": {
        "source": "https://gitlab.example.com/my-group/my-app",
        "ref": "refs/heads/main"
      },
      "resolvedDependencies": [
        {
          "uri": "git+https://gitlab.example.com/my-group/my-app@refs/heads/main",
          "digest": {
            "gitCommit": "1111111111111111111111111111111111111111"
          }
        }
      ]
    },
    "runDetails": {
      "builder": {
        "id": "https://gitlab.example.com/my-group/my-app/-/runners/ephemeral-gke"
      },
      "metadata": {
        "invocationId": "https://gitlab.example.com/my-group/my-app/-/jobs/12345"
      }
    }
  }
}
```

Fill the fields from the CI environment rather than by hand. In GitLab, `CI_PROJECT_URL`, `CI_COMMIT_SHA`, `CI_COMMIT_REF_NAME` and `CI_JOB_URL` cover most of it. A separate job that runs after the build, with no access to the build job's workspace beyond the image digest, produces and attests the statement:

```yaml title=".gitlab-ci.yml"
provenance:
  stage: provenance
  image: registry.example.com/ci-tools/supply-chain:1.0.0 # change: your internal image with cosign and jq; pin by digest
  needs:
    - job: build-image
      artifacts: true
  id_tokens:
    SIGSTORE_ID_TOKEN:
      aud: sigstore
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - |
      jq -n \
        --arg repo "$IMAGE_REPO" \
        --arg digest "${IMAGE_DIGEST#sha256:}" \
        --arg source "$CI_PROJECT_URL" \
        --arg ref "$CI_COMMIT_REF_NAME" \
        --arg commit "$CI_COMMIT_SHA" \
        --arg job "$CI_JOB_URL" \
        '{
          buildType: "https://example.com/build-types/gitlab-ci/v1",
          externalParameters: {source: $source, ref: $ref},
          resolvedDependencies: [{uri: ("git+" + $source), digest: {gitCommit: $commit}}],
          invocation: $job
        }' > predicate.json
    - cosign attest --yes --type https://slsa.dev/provenance/v1 --predicate predicate.json "${IMAGE_REPO}@${IMAGE_DIGEST}"
```

GitLab has its own mechanisms for emitting build metadata and provenance for some artifact types. Whether and how they apply to container images on your GitLab version is not verified here; check the GitLab documentation before replacing the job above. This job is honest about its limit: it is a separate job and uses the platform OIDC token, which is close to level 2, but the runner that executes it is still yours (see the gaps below).

On Jenkins, produce the same predicate in a stage that runs on a dedicated, locked-down agent, and sign with a Cloud KMS key the build agents cannot reach, using `cosign attest --key gcpkms://...` as in the SBOM note.

## Verifying provenance

Verification is the step that gives provenance its value. Pin the expected identity to your project and branch; a loose pattern accepts any project on the same GitLab.

```bash
set -euo pipefail

IMAGE="europe-docker.pkg.dev/my-project/my-repo/my-app"  # change: your image repository
DIGEST="sha256:0000000000000000000000000000000000000000000000000000000000000000"  # change: digest to verify
ISSUER="https://gitlab.example.com"  # change: your GitLab OIDC issuer
IDENTITY_RE='^https://gitlab\.example\.com/my-group/my-app//\.gitlab-ci\.yml@refs/heads/main$'  # change: anchored to your project path and ref

cosign verify-attestation \
  --type https://slsa.dev/provenance/v1 \
  --certificate-identity-regexp "${IDENTITY_RE}" \
  --certificate-oidc-issuer "${ISSUER}" \
  "${IMAGE}@${DIGEST}" \
  | jq -r '.payload | @base64d | fromjson | .predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit'
```

The final line prints the source commit that the provenance claims. Compare it with the commit you released. The slsa-verifier tool exists for verifying provenance from supported builders; whether it supports GitLab builders is not verified, so this guide uses cosign. Cosign accepts a predicate type URI as the `--type` value; the short names it also accepts for SLSA provenance versions are not verified, so use the URI.

For automatic enforcement at deploy time, move the same check into the admission policy described in [[patterns/image-signing-and-admission-verification]].

## Gaps on self-hosted runners

- **Shared runners and caches.** If jobs from different projects share a runner or a cache directory, one project can poison another. Use ephemeral runners per job (see [[patterns/gitlab-runners-on-gke]]) and per-project cache keys.
- **Privileged build steps.** Docker-in-Docker with privileged mode gives the build root-equivalent reach on the node. Prefer rootless builders such as Kaniko or BuildKit in rootless mode, and say so in your risk register if you cannot.
- **Signing in the build job.** If the same job builds and signs, the build script can sign anything. Sign in a later job that only receives the digest.
- **Editable pipeline definitions.** Anyone who can change `.gitlab-ci.yml` on a protected branch can change what is signed. Require merge requests and approvals on the default branch, and pin the identity to that branch.
- **Jenkins controller trust.** Jenkins plugins and shared libraries run with controller privileges. See [[patterns/jenkins-controller-and-agent-hardening]] and keep signing keys in Cloud KMS, not in Jenkins credentials.
- **Provenance generated by the build itself.** Self-reported metadata is level 1 evidence at best. Be explicit about this in internal documents.

## A realistic roadmap

1. **Weeks 1 to 2.** Pin pipeline definitions to the repository, require reviews on the default branch, resolve every image to a digest. Emit unsigned provenance as a pipeline artifact (level 1).
2. **Weeks 3 to 6.** Move to a separate provenance job with keyless signing on GitLab, or a KMS-signed stage on Jenkins. Verify provenance in a release gate script, in audit mode first.
3. **Weeks 7 to 12.** Switch build runners to ephemeral, per-job pods; remove privileged builders; separate signing from building. Enforce verification at admission.
4. **Ongoing.** Re-run the gap list above after every runner or controller change, and record what changed.

> [!note] Levels are a roadmap, not a certification
> Nobody certifies that you are "SLSA level 3" by running these steps. Use the levels to decide the next control to add and to describe your current state honestly. The numbers in the roadmap are starting points for planning, not commitments.

## Related

- [[compliance/sbom-generation-and-storage]]: the component list that complements provenance.
- [[patterns/image-signing-and-admission-verification]]: how the signed statements are enforced at admission.
- [[patterns/jenkins-controller-and-agent-hardening]]: controller and agent isolation needed for the higher levels on Jenkins.
- [[patterns/gitlab-runners-on-gke]]: ephemeral runners that make build isolation realistic.
- [[patterns/artifact-promotion-artifactory]]: keep provenance attached when artifacts are promoted.
