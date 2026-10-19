---
title: Kaniko vs BuildKit vs Cloud Build for image builds
description: "Choosing a rootless or managed image builder for GitLab CI, Jenkins and GCP: privilege model, cache, provenance, SBOM and maintenance status."
type: tool
tags:
  - tools
  - docker
  - gcp
  - security
  - supply-chain
  - ci-cd
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Building container images inside CI without handing the job root on a node was once Kaniko's job. Today the field is three options: Kaniko, BuildKit (directly or through `docker buildx`), and Google Cloud Build as a managed builder. They differ most in privilege model, in what attestations they can emit, and in whether anyone is still maintaining them.

> [!info] Not checked against current releases
> Versions, flags, limits, maintenance status and prices were not checked when this note was written. Confirm them in the current documentation and on each project's repository, with a date, before relying on them.

## Criteria

- **Privilege model:** what the build needs from the runner or node.
- **Cache:** how layers survive between ephemeral jobs.
- **Provenance and SBOM:** whether the builder can produce attestations (see [[slsa-build-provenance]] and [[sbom-generation-and-storage]]).
- **Blast radius:** what credentials the build can reach.
- **Maintenance:** whether the project is alive.

## At a glance

| Concern           | Kaniko                                                                   | BuildKit (buildx or `buildctl`)                                               | Cloud Build                                                   |
| ----------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Where it runs     | A container in your CI runner or cluster                                 | A daemon or daemonless process in your CI, or a remote builder                | Google-managed workers, or private pools in your network      |
| Privilege         | No Docker daemon; builds in user space, usually as root in the container | Rootless mode possible; needs user namespaces and relaxed seccomp or AppArmor | Managed; you control the build service account                |
| Cache             | Registry cache repository                                                | Registry, inline or local cache exporters                                     | Registry cache, or a build cache feature; check the docs      |
| Provenance / SBOM | Not built in; generate separately                                        | `--provenance` and `--sbom` attestations, depending on version                | Provenance support exists; check the current docs for formats |
| Multi-platform    | Limited                                                                  | Yes, via buildx                                                               | Via buildx steps or documented patterns                       |
| Maintenance       | Reported archived upstream; verify the repository                        | Active under the Moby project at the time of writing; verify                  | Google-supported service                                      |
| Cost              | Your runner time                                                         | Your runner time                                                              | Per build-minute and machine type; check the pricing page     |

## Privilege model

**Kaniko** executes each Dockerfile instruction in user space and snapshots the filesystem, so it does not need a daemon or `--privileged`. It usually still runs as root inside its container, which means a build that runs untrusted `RUN` steps has root in a container that may share a node with other workloads. Isolation then depends on the node, the runtime sandbox and the network policy around the job.

**BuildKit** can run rootless. That needs the host to allow unprivileged user namespaces, and containers using it often need seccomp and AppArmor adjustments, which is a security trade-off in itself; read the current rootless documentation for the exact requirements. A full working rootless job on GitLab runners, including the `buildctl-daemonless.sh` entry point, is described in [[gitlab-runners-on-gke]]; do not copy it here, link it.

**Cloud Build** moves the problem to Google: each build runs on a managed worker, and the relevant control is the build service account and, for private networks, private pools. A private pool puts workers in a VPC peered with yours, so builds can reach private registries or internal package mirrors without public IPs. Check the current private pools overview for networking requirements and limits.

Whichever you pick, the generic hardening of the image itself is in [[dockerfile-hardening]]. A `RUN` step is arbitrary code: do not build untrusted merge request source on a runner that holds production credentials.

## Cache and registry export

Ephemeral runners start cold, so cache must live somewhere shared.

```bash title="BuildKit registry cache with buildx (verify flags with docker buildx build --help)"
IMAGE=europe-west1-docker.pkg.dev/example-project/apps/api
TAG="${CI_COMMIT_SHORT_SHA:-dev}"

docker buildx build \
  --push \
  --tag "${IMAGE}:${TAG}" \
  --provenance=true \
  --sbom=true \
  --cache-to type=registry,ref=${IMAGE}:buildcache,mode=max \
  --cache-from type=registry,ref=${IMAGE}:buildcache \
  .
```

`mode=max` exports intermediate layers as well and gives better hit rates at the cost of more registry storage. Add a cleanup policy for the cache tag so it does not grow forever (see [[artifactory-vs-nexus-vs-artifact-registry]] for cleanup policies on Artifact Registry).

For Kaniko, the equivalent is `--cache=true --cache-repo=${IMAGE}/cache`. Cache poisoning is a real concern: anyone who can push to the cache repository can influence your builds, so give write access to the build identity only.

## Provenance and SBOM

BuildKit can attach a provenance attestation and an SBOM to the pushed image index. The detail varies with version: what the SBOM scanner covers, and how much information the provenance records about build arguments, so read what is emitted and decide whether it is acceptable to publish. Treat BuildKit's self-reported provenance as useful but lower assurance than provenance generated by a separate, isolated builder; the distinction is explained in [[slsa-build-provenance]].

Kaniko does not emit these. You can generate an SBOM after the push with a separate scanner and sign the image by digest afterwards (see [[image-signing-and-admission-verification]]). Cloud Build has provenance features for builds it runs; check the current documentation for which formats and SLSA levels are described.

In every case, attest and sign by digest, not by tag.

## Pipeline snippets

### GitLab CI with Kaniko

```yaml title=".gitlab-ci.yml (Kaniko)"
build-kaniko:
  stage: build
  image:
    name: gcr.io/kaniko-project/executor:vX.Y.Z-debug@sha256:0000000000000000000000000000000000000000000000000000000000000000 # placeholder: pin a tag and digest, not a moving tag
    entrypoint: [""]
  script:
    - mkdir -p /kaniko/.docker
    - |
      printf '{"credHelpers":{"europe-west1-docker.pkg.dev":"gcr"}}' \
        > /kaniko/.docker/config.json
    - >
      /kaniko/executor
      --context "$CI_PROJECT_DIR"
      --dockerfile "$CI_PROJECT_DIR/Dockerfile"
      --destination "europe-west1-docker.pkg.dev/example-project/apps/api:$CI_COMMIT_SHORT_SHA"
      --cache=true
      --digest-file /tmp/digest
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

Pin the executor image by digest in a real pipeline, and see the maintenance status below before starting a new project on it. Authentication to Artifact Registry should come from workload identity federation, not a stored key; see [[iam-groups-and-ci-workload-identity-federation]].

### Cloud Build

```yaml title="cloudbuild.yaml"
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - --tag=europe-west1-docker.pkg.dev/example-project/apps/api:$SHORT_SHA
      - .
images:
  - europe-west1-docker.pkg.dev/example-project/apps/api:$SHORT_SHA
serviceAccount: projects/example-project/serviceAccounts/builder@example-project.iam.gserviceaccount.com
options:
  logging: CLOUD_LOGGING_ONLY
  pool:
    name: projects/example-project/locations/europe-west1/workerPools/private-pool
```

```bash title="submit with a user-specified service account"
gcloud builds submit --config cloudbuild.yaml \
  --project=example-project --region=europe-west1 .
```

`$SHORT_SHA` is populated for builds started from a trigger, not for manual `gcloud builds submit`; pass `--substitutions=SHORT_SHA=...` for manual runs. Private pools are optional. Omit the `pool` block to use the default workers.

### Jenkins

Jenkins agents can run BuildKit in rootless mode on a dedicated agent or call `gcloud builds submit` from a pipeline stage, which keeps Docker access off the controller. See [[jenkins-controller-and-agent-hardening]] for agent isolation.

## Build service account scope and what the build can reach

A build is code execution with credentials. Reduce what those credentials can do:

- A dedicated service account per pipeline, not the default Compute or Cloud Build account (their default roles can be broad; check the current defaults).
- Grant `roles/artifactregistry.writer` on the one repository, not on the project.
- No access to production clusters or secrets from the build. Deployment is a separate job with its own identity.
- With Cloud Build, set `logging` and log bucket permissions deliberately: build logs can contain secrets if a step prints them.
- Egress: where practical, build from a private pool or runner network that reaches only your package mirrors.

## Maintenance status

Kaniko has been reported as archived on GitHub by its original owner, with community forks continuing. This is a fact that changes over time: open the repository, check the archive banner, the date of the last release and open security issues, and write the date you checked next to your decision. An unmaintained builder will not receive fixes for its base image or Go dependencies, and a build tool is high-value to attackers. For new pipelines, prefer BuildKit or Cloud Build; for existing Kaniko pipelines, plan a migration rather than an emergency.

## When to choose which

Choose **Cloud Build** when you are on GCP, want no build infrastructure, and are comfortable with Google-run workers, with private pools where network isolation is needed.

Choose **BuildKit** when you run your own runners (GitLab, Jenkins), want the best cache and attestation support, and can allow rootless prerequisites on a dedicated node pool.

Choose **Kaniko** only for an existing pipeline you cannot move yet, after checking the upstream status.

## Recommendation

Use BuildKit for self-hosted runners, in rootless mode on an isolated node pool, with registry cache and attestations pushed alongside the image. Use Cloud Build with a dedicated service account (and a private pool for private dependencies) where a managed builder is acceptable. Sign and scan by digest after the build. Keep Kaniko only as a time-boxed legacy path. Revisit if the rootless prerequisites become unacceptable on your nodes, if Cloud Build limits or pricing change, or if the Kaniko project's status changes.

## Related

- [[gitlab-runners-on-gke]]
- [[dockerfile-hardening]]
- [[slsa-build-provenance]]
- [[sbom-generation-and-storage]]
- [[building-and-shipping-images]]

## Sources

- [BuildKit](https://github.com/moby/buildkit)
- [Docker Build documentation](https://docs.docker.com/build/)
- [Cloud Build documentation](https://cloud.google.com/build/docs)
- [Cloud Build private pools overview](https://cloud.google.com/build/docs/private-pools/private-pools-overview)
- [Kaniko repository](https://github.com/GoogleContainerTools/kaniko)
