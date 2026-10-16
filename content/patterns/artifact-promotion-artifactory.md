---
title: Artifact promotion with Artifactory
description: Build once, then promote the same artefact from dev to staging to prod in Artifactory using build info and the JFrog CLI in GitLab CI.
type: pattern
tags:
  - patterns
  - artifactory
  - ci-cd
  - gitlab-ci
  - delivery
created: 2026-10-16
modified: 2026-10-16
draft: false
---

The rule: **build an artefact once and move that exact artefact through environments.** Rebuilding for staging or prod means the thing you tested is not the thing you shipped, because base images, dependencies and timestamps drift. In Artifactory, promotion is a copy or move between repositories, so the bytes and checksums stay identical and the repository an artefact lives in records how far it has got.

> [!info] Not checked against live docs
> The JFrog documentation was unreachable when this was written. Command names below (`jf rt build-publish`, `jf rt build-promote`, `jf rt docker-promote`) are from the JFrog CLI v2 command set as I know it. Run `jf rt build-promote --help` on the version your runners use and adjust.

## Repository layout

Artifactory has three repository types, and the layout builds on them.

| Type    | What it is                                                    | Role here                                                |
| ------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| Local   | Stores artefacts you produce                                  | One per stage per package type                           |
| Remote  | Caching proxy of an upstream (Docker Hub, npm, Maven Central) | Dependency source; protects builds from upstream outages |
| Virtual | One URL that aggregates local and remote repos                | What developers and CI actually use                      |

A workable naming scheme, for Docker and Helm:

```text
docker-dev-local        # every CI build lands here
docker-staging-local    # promoted after tests pass
docker-prod-local       # promoted by release approval
docker-remote           # proxy for Docker Hub / gcr
docker                  # virtual: dev + staging + prod + remote (for pulls)
helm-dev-local / helm-staging-local / helm-prod-local / helm   # same idea
```

Clients push to `*-dev-local` only. Each environment resolves from its own repo, so a prod cluster pulls from `docker-prod-local` and cannot accidentally run something no one promoted. Enforce this with permissions: CI can write `dev`, a smaller group or a release job can write `staging` and `prod`, and humans cannot overwrite anything.

## Immutability

- Do not allow redeploying (overwriting) a version in staging and prod repositories. Turn off "Deploy" overwrite in the repo permissions or use the repository's immutability setting where your Artifactory version provides one.
- Tag with the commit SHA or a semantic version, never rely on `latest` or a moving `main` tag.
- Deploy by digest in the manifests where possible. A tag can be re-pushed in dev, but promotion records and checksums catch it.
- Treat "rebuild to fix" as a new version going through the pipeline again.

## Build info

Build info is Artifactory's record of what went into a build: modules, produced artefacts, dependencies, environment variables, VCS revision, and CI URL. Promotion works on a build name and number, so every promoted thing is traceable back to a pipeline run and a commit.

Variables you set once in the job:

```bash
export JFROG_URL="https://artifactory.example.com"
export JFROG_CLI_BUILD_NAME="${CI_PROJECT_PATH_SLUG}"
export JFROG_CLI_BUILD_NUMBER="${CI_PIPELINE_ID}"
export IMAGE="artifactory.example.com/docker/payments-api:${CI_COMMIT_SHORT_SHA}"
```

The CLI reads `JFROG_URL` and `JFROG_ACCESS_TOKEN` from the environment, so use a masked, protected CI variable for the token rather than `jf config add` with a plain argument.

## Pipeline in GitLab CI

Build and publish in one job, promote in later jobs. See [[gitlab-ci-pipeline-structure]] for stages and rules.

```yaml title=".gitlab-ci.yml"
stages: [build, test, promote-staging, promote-prod]

variables:
  JFROG_CLI_BUILD_NAME: $CI_PROJECT_PATH_SLUG
  JFROG_CLI_BUILD_NUMBER: $CI_PIPELINE_ID
  IMAGE: artifactory.example.com/docker-dev-local/my-service:$CI_COMMIT_SHORT_SHA
  # pin to a tested release and digest
  # renovate: datasource=docker depName=releases-docker.jfrog.io/jfrog/jfrog-cli-v2-jf
  JFROG_CLI_IMAGE: releases-docker.jfrog.io/jfrog/jfrog-cli-v2-jf:<tested-version>@sha256:<digest>
  # renovate: datasource=docker depName=aquasec/trivy
  TRIVY_IMAGE: aquasec/trivy:<tested-version>@sha256:<digest>
  BUILDER_IMAGE: <builder-image>:<tested-version>@sha256:<digest>

.jf:
  image: $JFROG_CLI_IMAGE
  before_script:
    - jf rt ping

build-image:
  extends: .jf
  stage: build
  # your builder image with docker CLI and jf, pinned by tag and digest
  image: $BUILDER_IMAGE
  services: [docker:dind]
  variables:
    DOCKER_HOST: tcp://docker:2376
    DOCKER_TLS_VERIFY: "1"
    DOCKER_CERT_PATH: /certs/client
    DOCKER_TLS_CERTDIR: /certs
  script:
    - docker build -t "$IMAGE" .
    - jf docker push "$IMAGE" --build-name="$JFROG_CLI_BUILD_NAME" --build-number="$JFROG_CLI_BUILD_NUMBER"
    - jf rt build-collect-env
    - jf rt build-add-git
    - jf rt build-publish

unit-test:
  stage: test
  needs: []
  script:
    - echo "run the unit tests here" # placeholder

image-scan:
  stage: test
  needs: [build-image]
  image:
    name: $TRIVY_IMAGE
    entrypoint: [""]
  variables:
    TRIVY_USERNAME: $REGISTRY_USER # masked CI/CD variables with read access to the dev repo
    TRIVY_PASSWORD: $REGISTRY_PASSWORD
  script:
    # Scans the image in the dev repo, the one that promotion will copy.
    - trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed "$IMAGE"

promote-staging:
  extends: .jf
  stage: promote-staging
  # A gate must list every job that must pass (see the GitLab note).
  needs: [build-image, unit-test, image-scan]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - >
      jf rt build-promote "$JFROG_CLI_BUILD_NAME" "$JFROG_CLI_BUILD_NUMBER" docker-staging-local
      --status="staging" --comment="Passed integration tests" --source-repo=docker-dev-local --copy=true

promote-prod:
  extends: .jf
  stage: promote-prod
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual
      allow_failure: false # explicit, see gitlab-ci-pipeline-structure
  environment: production
  script:
    - >
      jf rt build-promote "$JFROG_CLI_BUILD_NAME" "$JFROG_CLI_BUILD_NUMBER" docker-prod-local
      --status="released" --comment="Approved for production" --source-repo=docker-staging-local --copy=true
```

Notes:

- `build-image` uses `docker:dind`, which needs a privileged runner, the same setup as in [[gitlab-ci-pipeline-structure]]. `BUILDER_IMAGE` is your own image that contains both the Docker CLI and `jf`. The stock `docker:cli` image has no JFrog CLI, and because a custom image does not get the Docker client setup that the `docker` image entrypoint provides, the job sets `DOCKER_HOST`, `DOCKER_TLS_VERIFY` and `DOCKER_CERT_PATH` itself to reach the `dind` service over TLS (confirm the values against the GitLab docs for your runner's `dind` setup). Do not rely on a floating tag for it: pin `JFROG_CLI_IMAGE` and the scanner image by tag and digest, and let [[automated-dependency-updates]] keep them current.
- `image-scan` runs against the image in the dev repo, which is the exact image `promote-staging` then copies. `promote-staging` lists `build-image`, `unit-test` and `image-scan` in `needs`, because a `needs` list replaces the stage barrier and only the listed jobs gate the promotion.
- Running Docker builds in GitLab needs a Docker-capable runner or a daemonless builder; the `jf docker push` flow above assumes a Docker client with a daemon. With Kaniko or Buildx, push normally and then register the image with the build using the CLI's Docker build-info commands.
- `--copy=true` copies rather than moves, which keeps the earlier stage's copy for audit. Moving makes dev cleaner. Pick one and apply it consistently.
- Use a protected, manual `promote-prod` job so promotion is a recorded decision. Pair it with [[production-change-checklist]].
- The promotion token should only have deploy rights to the target repos, and prod promotion should use a different token from dev builds.

Verify after promotion:

```bash
jf rt search --build="${JFROG_CLI_BUILD_NAME}/${JFROG_CLI_BUILD_NUMBER}" "docker-prod-local/**"
```

Promoting a bare Docker image without a build is also possible with `jf rt docker-promote`, but build-level promotion promotes every module and artefact of the build together and leaves a status history on the build.

## Deploying what you promoted

The Helm release should reference the image digest or version taken from the promoted build, and pull from the prod repo. With GitOps ([[0001-gitops-with-argocd]]), the promotion job (or a follow-up job) commits the new image reference to the environment's config repo. Do not let the manifests reference `docker-dev-local` from prod.

## Helm charts

Treat charts like any artefact: `helm package`, push once to `helm-dev-local`, promote the same `.tgz`. With an OCI-capable Artifactory the chart is pushed as an OCI artefact (`helm push chart-1.2.3.tgz oci://artifactory.example.com/helm-dev-local`), and with a classic Helm repo you push the file and Artifactory builds `index.yaml`. The chart version must be unique in the repository; `appVersion` is informational and need not change with every chart release (see [[helm-chart-conventions]]). Promote chart and image from the same pipeline run so the pair stays consistent.

## Retention and cleanup

Left alone, dev repos grow forever. Keep policy per stage:

| Repo          | Typical policy                                                            |
| ------------- | ------------------------------------------------------------------------- |
| dev           | Keep last N builds or N days; delete the rest, except anything promoted.  |
| staging       | Keep longer, for example the last releases plus those deployed recently.  |
| prod          | Keep everything that ever ran in production, or as long as audit demands. |
| remote caches | Cache cleanup by unused-days; safe, since they refetch.                   |

Use Artifactory's cleanup/retention policies where your version provides them, or a scheduled job running AQL queries (for example artefacts in dev not downloaded in 30 days and without a promotion property). Always run it in dry-run first, and never let cleanup touch a tag that a running cluster references; query the clusters or the prod repo first.

Docker caveat: deleting a tag does not remove layers other images share, and Artifactory's garbage collection then reclaims unreferenced binaries. Plan GC windows.

## Failure modes

- Promotion succeeds but the cluster pulls from dev: a mutable tag or wrong repo in values. Pin digests.
- Build number reuse across projects causes confusion: include the project in the build name.
- Token in the job log: keep it masked, and rotate per [[leaked-credential-rotation]] if exposed.
- Prod promotion of an image that was never scanned: add the scan gate before `promote-staging`, and use the promotion status as the gate for Xray policies if licensed.
