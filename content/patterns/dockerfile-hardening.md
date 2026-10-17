---
title: Dockerfile hardening
description: Build small, reproducible, non-root container images with multi-stage builds, digest pinning, BuildKit secrets, scanning and signing.
type: pattern
tags:
  - patterns
  - docker
  - security
  - ci-cd
created: 2026-10-16
modified: 2026-10-17
draft: false
---

A hardened image has fewer packages to patch, runs as an unprivileged user, builds the same way twice, and carries no secrets in its layers. Most of this costs nothing at build time. The checks belong in CI ([[gitlab-ci-pipeline-structure]]), and the resulting image is the artefact you promote ([[artifact-promotion-artifactory]]).

> [!info] Not checked against live docs
> Flags and syntax below are stable Docker/BuildKit and Trivy features, but I did not re-verify them against the current documentation on the day of writing. Run each command once locally before putting it in a pipeline.

## Principles

1. Ship only what runs: compiler, package manager and shell stay in the build stage.
2. Run as a non-root user with a numeric UID.
3. Pin the base image by digest so a rebuild is deliberate.
4. Never put a secret in a layer, even if a later layer deletes it.
5. Scan on every build and on a schedule, because new CVEs appear against old images.

## Multi-stage builds

A multi-stage build compiles in a full toolchain image and copies only the artefact into a small runtime image. The final stage defines what ships; earlier stages are discarded.

Benefits: smaller pull time, fewer CVEs reported by scanners, no build tools for an attacker to use. Name stages (`AS build`) and use `COPY --from=build` rather than numeric indices.

## Choosing a base image

| Base                                             | Size and attack surface                 | Debuggability                                         | Use for                                                        |
| ------------------------------------------------ | --------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| `scratch`                                        | Minimal                                 | None                                                  | Static Go binaries; you must add CA certs and tzdata yourself. |
| Distroless (`static`, `base`, language variants) | Very small, no shell or package manager | `:debug` tags include busybox; or use `kubectl debug` | Go, Java, Node, Python services. Default choice.               |
| Alpine                                           | Small, has shell                        | Good                                                  | When you need a shell; note musl libc differences.             |
| Debian/Ubuntu slim                               | Larger                                  | Best                                                  | glibc-only software, native dependencies.                      |

Distroless has a `nonroot` variant with UID 65532. For debugging a shell-less container in Kubernetes, attach an ephemeral container instead of baking tools in:

```bash
kubectl debug -it POD_NAME --image=busybox --target=app
```

## Pin base images by digest

Tags are mutable. A digest is not. Resolve it once, store it in the Dockerfile arguments or a renovate-managed file, and let a bot propose updates.

```bash
export IMAGE="gcr.io/distroless/static-debian12:nonroot"
docker buildx imagetools inspect "${IMAGE}" --format '{{json .Manifest.Digest}}'
```

Write the reference as `repo:tag@sha256:...`. Docker uses the digest and ignores the tag, but keeping the tag documents intent. Without automated updates, pinning turns into never patching, so pair it with Renovate or Dependabot and a scheduled rebuild.

## Non-root user

Use a numeric UID so Kubernetes can verify `runAsNonRoot` (it cannot map a name to a UID). In the manifest, enforce it as well, since the Dockerfile is a default, not a control:

```yaml title="deployment-securitycontext.yaml"
securityContext:
  runAsNonRoot: true
  runAsUser: 65532
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
  seccompProfile:
    type: RuntimeDefault
```

A read-only root filesystem needs an `emptyDir` for any path the app writes, such as `/tmp`.

## .dockerignore

Everything in the build context is sent to the builder and can be copied by a careless `COPY . .`. Exclude by default:

```text title=".dockerignore"
.git
.gitignore
.gitlab-ci.yml
Jenkinsfile
Dockerfile*
README.md
docs
tests
node_modules
dist
coverage
*.md
.env
.env.*
*.pem
*.key
terraform
.terraform
```

Adjust it so it does not hide files the build needs. Prefer an allow-list (`*` then `!src`, `!go.mod`) for sensitive repositories.

## No secrets in layers

`ARG` and `ENV` values are visible in `docker history` and in image metadata. A file added in one layer and removed in the next is still in the earlier layer. Use BuildKit secret mounts, which exist only during the `RUN` step:

```dockerfile title="Dockerfile (fragment)"
# syntax=docker/dockerfile:1
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    npm ci --omit=dev
```

```bash
export DOCKER_BUILDKIT=1
docker build --secret id=npmrc,src="$HOME/.npmrc" -t app:dev .
```

In GitLab CI, write the token to a temporary file in the job and pass `src=` to it, or use `--secret id=token,env=TOKEN` where your Docker version supports the `env` source (check `docker build --help`). For SSH access to private repositories use `--mount=type=ssh`. If a secret was ever baked into an image, treat it as leaked and follow [[leaked-credential-rotation]].

## HEALTHCHECK in Kubernetes

Docker's `HEALTHCHECK` instruction is ignored by Kubernetes. The kubelet uses `livenessProbe`, `readinessProbe` and `startupProbe` from the Pod spec. Do not add a `HEALTHCHECK` that needs `curl` just to satisfy a linter, since it pulls a shell and network tooling into a distroless image. Implement probes as HTTP or gRPC probes against the app, and see [[zero-downtime-deployments-kubernetes]] for how readiness and termination interact. Keep `HEALTHCHECK` only if the same image also runs under plain Docker or Compose.

## Example: hardened Go service

Pass the base images as build arguments so digests are managed in one place.

```dockerfile title="Dockerfile"
# syntax=docker/dockerfile:1
ARG GO_IMAGE
ARG RUNTIME_IMAGE

FROM ${GO_IMAGE} AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/app ./cmd/app

FROM ${RUNTIME_IMAGE}
COPY --from=build /out/app /app
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/app"]
```

Build with resolved digests. Go supports the two most recent major releases, so pick one of those that your `go.mod` allows and set `GO_VERSION` to it:

```bash
export GO_VERSION="${GO_VERSION:?set to a Go release that is still supported, see https://go.dev/doc/devel/release}"
export GO_TAG="golang:${GO_VERSION}-bookworm"
export RUNTIME_TAG="gcr.io/distroless/static-debian12:nonroot"
export IMAGE="europe-west1-docker.pkg.dev/my-project/apps/app"
export VERSION="$(git rev-parse --short HEAD)"

GO_IMAGE="${GO_TAG}@$(docker buildx imagetools inspect "${GO_TAG}" --format '{{.Manifest.Digest}}')"
RUNTIME_IMAGE="${RUNTIME_TAG}@$(docker buildx imagetools inspect "${RUNTIME_TAG}" --format '{{.Manifest.Digest}}')"

docker build \
  --build-arg GO_IMAGE="${GO_IMAGE}" \
  --build-arg RUNTIME_IMAGE="${RUNTIME_IMAGE}" \
  -t "${IMAGE}:${VERSION}" .
```

For Node, keep the same structure: a build stage running `npm ci` and the build, then a runtime stage on a distroless Node image with `COPY --from=build /src/dist` and production `node_modules` only, `USER 65532:65532` and `CMD ["dist/server.js"]`.

## Scanning

Scan in CI and fail on fixable high and critical findings. Two common scanners are Trivy and Grype:

```bash
export IMAGE="europe-west1-docker.pkg.dev/my-project/apps/app:abc1234"

trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 "${IMAGE}"
grype "${IMAGE}" --fail-on high
```

Also scan the Dockerfile and manifests (`trivy config .`). Keep an explicit, reviewed ignore file with expiry dates rather than lowering the severity threshold. Rescan images already in the registry on a schedule: a clean build in March says nothing about September. Artifactory with Xray, or Artifact Registry's scanning, can do the continuous part.

## SBOM and signing

Generate a software bill of materials so you can answer "are we affected?" without pulling images:

```bash
syft "${IMAGE}" -o spdx-json > sbom.spdx.json
```

Sign the image by digest so deployment can verify it came from your pipeline:

```bash
export DIGEST_REF="europe-west1-docker.pkg.dev/my-project/apps/app@sha256:REPLACE_WITH_DIGEST"
cosign sign --key cosign.key "${DIGEST_REF}"
cosign verify --key cosign.pub "${DIGEST_REF}"
```

Keyless signing with the CI provider's OIDC identity avoids key management; see the cosign documentation for the current flags. Enforcement happens at admission (Binary Authorization on GKE, or a policy controller), and is worth adding only once signing is reliable in the pipeline. Details: [[patterns/image-signing-and-admission-verification]] for signing and verification, and [[compliance/sbom-generation-and-storage]] for keeping the SBOM.

## Checklist

- Multi-stage, final stage distroless or equivalent.
- Numeric non-root `USER`, plus matching `securityContext` in the chart.
- Base images pinned by digest and updated by a bot.
- `.dockerignore` present; BuildKit secrets for credentials.
- Scan gate in CI and a scheduled rescan; SBOM stored with the image.
- Signature created on the digest that is promoted, not on a tag.
