---
title: BuildKit registry cache in CI
description: Export and import BuildKit layer cache through a registry in GitLab CI and Jenkins for fast image builds, without letting untrusted branches poison the cache.
type: pattern
tags:
  - patterns
  - docker
  - ci-cd
  - supply-chain
  - gitlab-ci
  - jenkins
created: 2026-10-19
modified: 2026-10-19
draft: false
---

On a laptop, Docker keeps layer cache on disk and the second build is fast. On ephemeral CI runners (Kubernetes pods, autoscaled VMs) that disk is gone after every job, so every build starts cold and re-downloads dependencies. BuildKit can store the cache in a **registry** instead: the job pulls the cache metadata and the layers it can reuse, and pushes new cache at the end. This note covers the setup and, more importantly, who is allowed to write to that cache.

> [!info] Not checked against live docs
> Flag names, cache backend attributes (`mode`, `ref`, `image-manifest`, `oci-mediatypes`) and the default provenance and SBOM attestations of recent buildx versions were not checked against the live docs. Run `docker buildx build --help` and read the cache backend pages listed in Sources for the versions your runners use. Attestation defaults have changed between releases and can affect registries that do not accept the cache manifest format.

## When a registry cache helps

| Situation                                             | Registry cache                                     |
| ----------------------------------------------------- | -------------------------------------------------- |
| Ephemeral runners, new pod per job                    | Yes. The local cache is lost every time.           |
| Long-lived runner with a persistent disk              | Often unnecessary; the local cache works.          |
| Large dependency layers (npm, pip, Maven, apt)        | Yes. Biggest savings.                              |
| Images that change in the first layers on every build | No. Fix the Dockerfile layer order first.          |
| Registry in a slow or distant region                  | Maybe not; measure pull time against rebuild time. |

First fix the Dockerfile: stable layers (OS packages, dependency manifests, `npm ci`) before volatile ones (source code). A registry cache only helps layers that are cacheable in the first place. See [[dockerfile-hardening]].

## Cache options

BuildKit exposes cache through `--cache-from` (import) and `--cache-to` (export).

| Option                                    | Meaning                                                                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--cache-from type=registry,ref=R`        | Read cache from image reference `R`. Can be repeated; BuildKit uses them as candidates.                                            |
| `--cache-to type=registry,ref=R,mode=max` | Write cache for all layers of all stages, including intermediate multi-stage layers.                                               |
| `mode=min` (default)                      | Write cache only for layers of the final image. Smaller, but misses build stage layers.                                            |
| Inline cache (`type=inline`)              | Embeds cache metadata in the pushed image itself. Simple, but only final layers (min), and it mixes cache with a deployable image. |

For multi-stage builds, which is nearly all of them, `mode=max` is what makes the dependency stage cacheable. The cost is a bigger cache repository; handle that with retention.

Two requirements:

1. A builder that supports the registry cache exporter. The default `docker` driver does not export it; use the `docker-container` driver (`docker buildx create --use`), or a rootless BuildKit daemon.
2. Credentials that can push to the cache repository for writers and pull for readers.

## Cache references

Use two kinds of refs in a dedicated repository:

```text title="cache references"
registry.example.com/cache/payments-api:main                 # written only by the default branch
registry.example.com/cache/payments-api:<branch-slug>        # written by that branch's trusted pipeline
```

Every build reads `main` and its own branch ref. Only `main` (and chosen protected branches) write. A new feature branch therefore starts with the main cache instead of cold, and a merge request cannot alter what the next main build trusts.

Cache images are **not deployable images**. They carry layer data and a cache manifest, not a runnable image config. Keep them in a separate repository (or path) with its own permissions and cleanup, never in the repository that deploy tooling or admission policy treats as a source of images. Mixing them confuses scanners and promotion tooling (see [[artifact-promotion-artifactory]]).

## GitLab CI

```yaml title=".gitlab-ci.yml"
variables:
  IMAGE: $CI_REGISTRY_IMAGE
  CACHE_REF: $CI_REGISTRY/platform/cache/$CI_PROJECT_NAME

build-image:
  stage: build
  image: docker:cli
  services:
    - name: docker:dind
      command: ["--tls=false"]
  variables:
    DOCKER_HOST: tcp://docker:2375
  before_script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"
    - docker buildx create --name ci --driver docker-container --use
  script:
    - |
      CACHE_TO=""
      if [ "$CI_COMMIT_REF_PROTECTED" = "true" ]; then
        CACHE_TO="--cache-to type=registry,ref=${CACHE_REF}:${CI_COMMIT_REF_SLUG},mode=max"
      fi
      docker buildx build \
        --cache-from type=registry,ref=${CACHE_REF}:main \
        --cache-from type=registry,ref=${CACHE_REF}:${CI_COMMIT_REF_SLUG} \
        ${CACHE_TO} \
        --tag "${IMAGE}:${CI_COMMIT_SHORT_SHA}" \
        --push .
```

Notes:

- `--cache-to` is added **only** when the ref is protected. Merge request pipelines and unprotected branches read the cache and never write it.
- A missing cache ref on the first run is not an error for `--cache-from`; BuildKit continues cold. Confirm this on your version.
- The `dind` service with `--tls=false` shown here runs privileged and is only an illustration. This repository's position on privileged builds is in [[0015-no-privileged-image-builds-in-ci]]; prefer a rootless BuildKit or Kaniko-style builder pod where your policy requires it, with the same `--cache-from` and `--cache-to` arguments (BuildKit's `buildctl --export-cache` and `--import-cache` use the same attributes). Runner setup is in [[gitlab-runners-on-gke]].
- Registry pushes from the job use the job token or an identity as described in [[artifactory-access-tokens-and-oidc-for-ci]], not a long-lived password.

## Jenkins

On Jenkins with Kubernetes agents, run BuildKit as a rootless container in the pod, or a buildx builder pointing at a remote BuildKit service in the cluster:

```groovy title="Jenkinsfile"
pipeline {
  agent {
    kubernetes {
      yaml '''
        apiVersion: v1
        kind: Pod
        spec:
          containers:
            - name: buildkit
              image: moby/buildkit:rootless
              args: ["--oci-worker-no-process-sandbox"]
              securityContext:
                seccompProfile: { type: Unconfined }
                runAsUser: 1000
              tty: true
      '''
    }
  }
  environment {
    CACHE_REF = 'registry.example.com/cache/payments-api'
  }
  stages {
    stage('Build') {
      steps {
        container('buildkit') {
          script {
            def cacheTo = (env.BRANCH_NAME == 'main')
              ? "--export-cache type=registry,ref=${CACHE_REF}:main,mode=max"
              : ''
            sh """
              buildctl-daemonless.sh build \\
                --frontend dockerfile.v0 --local context=. --local dockerfile=. \\
                --import-cache type=registry,ref=${CACHE_REF}:main \\
                ${cacheTo} \\
                --output type=image,name=registry.example.com/app/payments-api:${GIT_COMMIT},push=true
            """
          }
        }
      }
    }
  }
}
```

The rootless image tag, security context and flags are version-dependent. Pin the image by version or digest and check the BuildKit rootless documentation. Registry credentials come from a mounted Docker config secret scoped to the folder; see [[jenkins-controller-and-agent-hardening]].

## Cache poisoning

A shared cache is shared trust. If an attacker (or a careless dependency change) can write a layer to a cache ref that the release build reads, the release image can include their layer. BuildKit checks content digests of what it reuses, but a poisoned **cache entry** maps a build step to attacker-chosen output, and BuildKit will reuse it when the step's inputs match.

Controls, in order of value:

1. **Only protected refs write the shared cache.** The `if` in the job above. Enforce it in the registry permissions too: the pull-only credential given to merge request jobs cannot push to `cache/`.
2. **Fork and merge request jobs read only**, or read nothing from caches written by less trusted refs.
3. **Release builds can skip the cache.** For tagged releases, build with `--no-cache` or read only the cache written by the `main` pipeline you reviewed. This costs time and buys a clean build of what you ship. Reproducibility and pinned inputs matter more here ([[automated-dependency-updates]]).
4. **Separate repositories per project** so one project's compromise does not touch another's cache.
5. Sign and verify the final image rather than the cache ([[image-signing-and-admission-verification]]).

## Size and cleanup

`mode=max` caches grow with every distinct build step. Without cleanup the cache repository eventually costs more than it saves.

- Set retention on the cache repository: delete cache tags not pulled in a number of days you choose, and delete per-branch refs after the branch is gone.
- Artifactory: use cleanup policies on the cache repository ([[0006-artifact-retention-by-cleanup-policies]]). Artifact Registry: use its cleanup policies. Check the current docs for syntax.
- Alert on repository size so growth is a ticket, not a surprise.

## Verify and measure

```bash title="verify the cache is used"
# In the build log, reused layers are marked CACHED
docker buildx build --progress=plain ... 2>&1 | grep -E 'CACHED|importing cache manifest'

# Measure: record build duration for cold, warm-main and warm-branch runs
```

Record three numbers for one representative service: cold build time, build time with only the `main` cache, and with `main` plus branch cache. If the gain is small, remove the complexity. A change in the first layers (base image bump, new apt package) invalidates everything after it; that is expected.

## Rollback

- Stop writing: remove `--cache-to` (or the protected-branch condition's branch). Builds keep working, just colder.
- Stop reading: remove `--cache-from`, or pass `--no-cache` for a one-off clean build.
- Suspect cache content: delete the cache tag (`main` or the branch ref) in the registry; the next protected build rebuilds it.
- If the exporter is rejected by the registry (manifest format errors), check the exporter attributes and attestations in `docker buildx build --help` and the cache backend docs, or fall back to inline cache.

## Related

- [[dockerfile-hardening]]
- [[building-and-shipping-images]]
- [[gitlab-ci-pipeline-structure]]
- [[gitlab-runners-on-gke]]
- [[artifactory-remote-repo-caching-for-ci]]
- [[0015-no-privileged-image-builds-in-ci]]

## Sources

- https://docs.docker.com/build/cache/
- https://docs.docker.com/build/cache/backends/
- https://docs.docker.com/build/cache/backends/registry/
- https://docs.docker.com/build/ci/
