---
title: Container images are built in CI without privileged Docker-in-Docker
description: Image builds use a rootless builder or a managed build service, and privileged Docker-in-Docker is not allowed on shared runners.
type: adr
tags:
  - adr
  - docker
  - ci-cd
  - security
  - supply-chain
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0015
---

## Context

Building a container image in CI needs something that can run the build steps. The easy answers are the ones with the worst security properties:

- **Docker-in-Docker (DinD)** runs a Docker daemon in a privileged container. A privileged container has nearly the capabilities of root on the node, so a malicious or compromised job can escape to the host and, on a shared runner, to other jobs and to anything the node's identity can reach.
- **Mounting the host Docker socket** gives the job control of the node's daemon: it can start any container, mount the host filesystem and read other jobs' images and layers. It is equivalent to root on the node.

Our runners run as pods on GKE ([[0014-gitlab-runners-kubernetes-executor-on-gke]]) and the namespaces are meant to enforce Pod Security restricted ([[pod-security-admission]]). Privileged pods cannot be admitted there. Separately, supply-chain requirements want every image to carry an SBOM and provenance, which a build step must produce.

We need a build method that works without `privileged: true` and without a host socket, produces reproducible images, and can attach attestations.

## Decision

We will build images in CI with **rootless BuildKit or a managed build service (Cloud Build)**, and we will not allow privileged Docker-in-Docker or the host Docker socket on shared runners.

- **Preferred:** BuildKit running rootless, either inside the job pod or as a remote `buildkitd` that jobs reach over an authenticated endpoint. Check the current BuildKit and Docker rootless documentation for the Linux kernel, seccomp and user namespace requirements on GKE nodes; some settings cannot run under Pod Security restricted and need a documented exception on a dedicated build namespace.
- **Alternative:** Cloud Build for builds that need nothing from our network, or where an isolated managed builder is simpler than operating one. The build runs outside our cluster and authenticates with a dedicated service account.
- **Runner policy:** the runner configuration rejects `privileged = true` and does not mount `/var/run/docker.sock`. A CI check fails when either appears.
- **Output:** every build emits an SBOM and build provenance. Images are pushed by digest and handed to the signing step in [[0037-keyless-cosign-image-signing]].
- **Base images** come from the platform-owned catalogue ([[0040-golden-base-images-owned-by-platform]]) and Dockerfiles follow [[dockerfile-hardening]].

```yaml title=".gitlab-ci.yml (excerpt)"
# Example only. Check the BuildKit docs for the exact image, flags and rootless requirements.
build-image:
  stage: build
  image: moby/buildkit:rootless
  variables:
    BUILDKITD_FLAGS: --oci-worker-no-process-sandbox
  script:
    - |
      buildctl-daemonless.sh build \
        --frontend dockerfile.v0 \
        --local context=. \
        --local dockerfile=. \
        --output type=image,name=${IMAGE_REPO}:${CI_COMMIT_SHA},push=true \
        --opt attest:sbom= \
        --opt attest:provenance=mode=max
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

Treat the snippet as a starting point: pin the builder image by digest, confirm the attestation options against your BuildKit version, and set `IMAGE_REPO` to your registry path.

> [!warning] kaniko status
> The kaniko project's maintenance status changed, and the upstream repository was archived. Check its current status, and whether a maintained fork fits your risk appetite, before choosing it. It is not our default.

## Consequences

Easier:

- A compromised build job no longer holds the node. The namespace can enforce Pod Security restricted or a near-restricted profile.
- Builds are isolated per pod, so layer caches and credentials do not leak between jobs.
- SBOM and provenance generation is built into the same step, so attestations are not an afterthought.
- The policy is checkable: one grep on runner config and one admission rule.

Harder or newly required:

- Rootless builds are slower for some workloads and do not support every Dockerfile feature (for example, certain `RUN --mount` and network modes). Teams may have to adjust Dockerfiles.
- Rootless operation often needs user namespace or seccomp settings that restricted Pod Security does not allow by default. We keep a dedicated build namespace with the minimum documented exception, and we own that exception explicitly.
- A remote BuildKit daemon is a service to run, scale, secure (mutual TLS, authentication) and keep patched. Cloud Build avoids that but adds a second platform, a cost line, and an egress path to our private artifact store that must be allowed.
- Layer caching across jobs needs a registry or object-storage cache. Cache poisoning between trusted and untrusted jobs is a risk; caches are scoped per trust level as in [[0014-gitlab-runners-kubernetes-executor-on-gke]].
- Builders that previously used `docker build` in scripts need migration.

## Alternatives considered

- **Privileged Docker-in-Docker.** Works with every Dockerfile and every existing script, but gives each job a path to the node. Rejected on shared runners.
- **Mounting the host Docker socket.** Fast and cache-friendly, but equivalent to host root and shares images across jobs. Rejected.
- **kaniko.** Daemonless and was widely used in GitLab on Kubernetes, but its maintenance status changed (see the warning above). Not chosen as default; revisit if a maintained successor is adopted.
- **Dedicated privileged builder VMs.** Isolates the risk to a separate machine, at the cost of another fleet to run and patch. Reasonable for legacy builds that cannot move, but not the standard.

> [!info] Claims not checked against current docs
> BuildKit rootless prerequisites on GKE, the `attest:` option syntax for your BuildKit version, kaniko's present status and forks, Cloud Build pricing and limits, and Pod Security behaviour for user namespaces were not verified for this record. Check the current documentation.

## Validation

```bash
set -o pipefail
NAMESPACE="ci-untrusted"

# Runner namespace labels enforce Pod Security (expect enforce=restricted or the documented build-namespace profile)
kubectl get namespace "${NAMESPACE}" --show-labels | tr ',' '\n' | grep pod-security

# No pod in the namespace requests privileged mode or mounts the Docker socket (expect no output)
kubectl get pods -n "${NAMESPACE}" -o json | jq -r '
  .items[]
  | select(
      any(.spec.containers[]; .securityContext.privileged == true)
      or any(.spec.volumes[]?; .hostPath.path == "/var/run/docker.sock")
    )
  | .metadata.name'

# Runner config rejects privileged mode (expect "ok")
grep -R "privileged = true" ./runner-config/ && echo "VIOLATION" || echo "ok"
```

## References

- GitLab, building Docker images in CI: https://docs.gitlab.com/ci/docker/
- Docker rootless mode: https://docs.docker.com/engine/security/rootless/
- BuildKit: https://github.com/moby/buildkit
- Related notes: [[dockerfile-hardening]], [[gitlab-runners-on-gke]], [[pod-security-admission]]
- Related ADRs: [[0014-gitlab-runners-kubernetes-executor-on-gke]], [[0037-keyless-cosign-image-signing]], [[0040-golden-base-images-owned-by-platform]]
