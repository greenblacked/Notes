---
title: Dockerfile standard
description: Required and forbidden Dockerfile rules, a hadolint CI gate, a base-image allowlist, OCI labels and tag rules, with a reviewer checklist.
type: standard
tags:
  - standards
  - docker
  - supply-chain
  - security
  - ci-cd
created: 2026-10-19
modified: 2026-10-19
draft: false
---

A Dockerfile is the build recipe for everything we run in production, and most image incidents trace back to a few repeated choices: a base image that moved under us, a secret baked into a layer, a container that ran as root. This standard states the rules, the check that enforces each rule and the failure it prevents. It does not teach the techniques. For the how-to (multi-stage builds, cache mounts, distroless bases, rootless runtimes) see [[dockerfile-hardening]]; this note only says what is required.

## Scope and relation to the hardening pattern

The standard applies to every Dockerfile in a repository we own that produces an image deployed to a shared environment. It does not apply to throwaway images on a laptop. Test images built in CI follow the same rules where they are cheap to follow, and an exception is recorded where they are not.

- This note holds the **rules**, the **gate** and the **exception path**.
- [[dockerfile-hardening]] holds the **examples** and the reasoning behind each technique.
- [[code-review]] says how reviewers treat Dockerfile changes; the checklist at the end of this note is the Dockerfile part of that review.

> [!info] Keywords
> MUST means the CI gate or a reviewer blocks the merge. SHOULD means the author explains a deviation in the merge request. Numbers that are not from vendor documentation are proposed team defaults and are labelled as such.

## Required rules

Every Dockerfile MUST do the following.

1. **Use a multi-stage build** when the image needs a compiler, package manager or build tool that the runtime does not. The final stage contains only what the process needs at run time. Single-stage files are acceptable only for images that install no build tooling, such as a copy of a static binary onto a base.
2. **Pin the base image by digest, from the allowlist.** Write `FROM registry.example.com/base/python:3.12-slim@sha256:<digest>`. The tag stays for humans, the digest is what the build resolves. Every `FROM`, including build stages, is covered. The digest is updated by an automated pull request (see [[dependency-update-policy]] and [[automated-dependency-updates]]), never by hand-editing during an unrelated change.
3. **Run as a non-root user.** Create a user with a fixed numeric UID and set `USER <uid>:<gid>` in the final stage. A numeric ID is required so that Kubernetes `runAsNonRoot` can verify it without a name lookup.
4. **Ship a `.dockerignore`** next to the Dockerfile that excludes `.git`, local environment files, build output, test fixtures and editor folders. The default is to exclude everything and allow what the build needs.
5. **Declare `EXPOSE` and `ENTRYPOINT` in exec form** (a JSON array), so signals reach the process and the container stops within the Kubernetes grace period.
6. **Set `HEALTHCHECK` only where the runtime uses it.** Docker Compose and plain Docker use it. Kubernetes ignores the instruction and relies on liveness, readiness and startup probes defined in the manifest. For an image that only ever runs on Kubernetes, leave `HEALTHCHECK` out and put the probes in the chart; a check baked into the image is a second, unmonitored definition of "healthy" that can drift from the probe.
7. **Set the OCI labels** described in the labels section below, at build time.

```dockerfile title="Dockerfile"
# syntax=docker/dockerfile:1
FROM registry.example.com/base/golang:1.23@sha256:0000000000000000000000000000000000000000000000000000000000000000 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/app ./cmd/app

FROM registry.example.com/base/static:nonroot@sha256:0000000000000000000000000000000000000000000000000000000000000000
COPY --from=build /out/app /app
USER 65532:65532
ENTRYPOINT ["/app"]
```

The digests above are placeholders of all zeros so that a copy-paste fails loudly. Resolve the real digest from the registry (`docker buildx imagetools inspect <image:tag>`) and let the update bot maintain it.

## Forbidden

The following MUST NOT appear. The lint gate catches some of them, reviewers catch the rest.

| Forbidden                                                 | Why                                                                                                          | Use instead                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `FROM image:latest` or no tag                             | The base changes without a commit, builds stop being reproducible, and a rollback rebuilds a different image | A version tag plus digest from the allowlist                                         |
| `ADD https://...` or `ADD` of a remote archive            | Unverified download, no checksum, cache behaviour that surprises                                             | `COPY` a file fetched and verified in CI, or `curl` with a checksum check in a `RUN` |
| Secrets in `ARG` or `ENV`                                 | Both end up in the image history and metadata, readable by anyone who can pull the image                     | BuildKit `RUN --mount=type=secret`, or no secret at build time                       |
| `curl ... \| sh` and `wget -O- ... \| bash`               | Runs unreviewed code with build privileges, and a truncated download can run half a script                   | Download, verify a pinned checksum, then run                                         |
| A root runtime user                                       | A container escape or a writable host mount starts with root inside the container                            | `USER <uid>:<gid>` in the final stage                                                |
| `chmod 777`, `--privileged` guidance, `sudo` in the image | Removes the isolation the other rules rely on                                                                | Fix the ownership of the specific path                                               |
| Unpinned package installs where the ecosystem allows pins | A rebuild on another day installs different code                                                             | Pin versions (`apt-get install pkg=1.2.3-1`, lock files for language packages)       |
| Copying the whole build context into the final stage      | Brings source, `.git` and test data into the runtime image                                                   | `COPY --from=build` of the specific artifacts                                        |

> [!warning] Removing a secret in a later layer does not remove it
> A secret written in one layer and deleted in the next is still in the earlier layer. Anyone with pull access can extract it. If a secret reached an image, rotate it first, then rebuild; deleting the tag is not enough.

Package pinning has limits. Pin exact versions for system packages when the distribution keeps old versions available. When it does not (a rolling repository drops old versions), pin the base image digest and rebuild on a schedule instead, and record that choice in the merge request.

## Base-image allowlist and who owns it

Base images come from a short allowlist in one place, not from whatever a developer finds on a public registry.

- The allowlist is a file in the platform repository, with one entry per approved image: name, source, allowed tags, owner, and the date of the last review.
- The platform team owns it, consistent with the golden image model in [[dockerfile-hardening]]. Adding an entry is a reviewed merge request. A team that needs a new base proposes it with a reason and a named owner for patching.
- Approved bases are mirrored or proxied into our registry, so builds do not depend on a public registry being reachable and so that the digests we pin are the digests we store. The repository layout is in [[artifactory-artifact-naming-and-versioning]].
- Images on the allowlist are rebuilt on a schedule and when a critical vulnerability lands, following [[vulnerability-management-slas]]. An entry whose owner stops patching it is removed, and services using it get a deadline to move.

The gate checks `FROM` lines against the allowlist. A minimal check is a script that extracts every image reference and fails if its repository path is not a prefix in the list; it does not need to be clever.

```bash title="scripts/check-base-images.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

ALLOWLIST="${ALLOWLIST:-platform/base-images.txt}"
status=0

while IFS= read -r -d '' file; do
  while read -r image; do
    [[ "$image" == "scratch" ]] && continue
    if [[ "$image" != *@sha256:* ]]; then
      echo "$file: $image is not pinned by digest" >&2
      status=1
    fi
    if ! grep -qxF -- "${image%%[:@]*}" "$ALLOWLIST"; then
      echo "$file: ${image%%[:@]*} is not in the allowlist" >&2
      status=1
    fi
  done < <(awk 'toupper($1)=="FROM" { for (i=2;i<=NF;i++) if ($i !~ /^--/) { print $i; break } }' "$file")
done < <(find . -name 'Dockerfile*' -not -path './node_modules/*' -print0)

exit "$status"
```

A multi-stage file that uses `FROM build AS final` references an earlier stage, not an image; extend the script to skip names that match a previous `AS` alias before relying on it. Test it against a few real Dockerfiles first.

## Lint gate

Lint every Dockerfile in CI with [hadolint](https://github.com/hadolint/hadolint). It parses the Dockerfile and applies Dockerfile and shell rules, and it is quick enough to run on every merge request.

```bash title="Local and CI command"
hadolint --failure-threshold warning Dockerfile
```

`--failure-threshold warning` makes warnings and errors fail the job, while info and style findings are printed but do not block. Check the current hadolint README for the exact option names and severity levels in the version you pin.

Ignored rules live in a repository-level config, and each ignore carries a reason and an owner. An ignore without a reason is a review finding.

```yaml title=".hadolint.yaml"
failure-threshold: warning
ignored:
  # DL3008: pin versions in apt-get install. Ignored for the debug image only,
  # which is rebuilt weekly from a digest-pinned base. Owner: team-platform.
  # Expires 2027-01-31 (tracked in the exception register).
  - DL3008
trustedRegistries:
  - registry.example.com
```

The rule IDs here (`DL3008` and the like) are examples. Rule numbers and meanings can change between releases, so check them in the README of the hadolint version you run. The `trustedRegistries` option makes hadolint flag images from other registries, which backs up the allowlist check.

```yaml title=".gitlab-ci.yml"
dockerfile-lint:
  stage: lint
  image:
    name: registry.example.com/ci/hadolint:2.12.0@sha256:0000000000000000000000000000000000000000000000000000000000000000
    entrypoint: [""]
  timeout: 5 minutes
  rules:
    - changes:
        - "**/Dockerfile*"
        - ".hadolint.yaml"
        - ".dockerignore"
  script:
    - find . -name 'Dockerfile*' -not -path './node_modules/*' -print0 | xargs -0 -n1 hadolint --failure-threshold warning
    - ./scripts/check-base-images.sh
```

The version and digest in the job image are examples; pin the release you have approved. Job image pinning is part of [[ci-pipeline-standard]]. A scanner for the built image (Trivy or similar) is a separate gate; see [[vulnerability-management-slas]].

## Labels and build metadata

Labels let someone holding an image find its source commit and owner without asking anyone. Set the [OCI image annotations](https://github.com/opencontainers/image-spec/blob/main/annotations.md) at build time, from CI variables, not hard-coded in the file.

```dockerfile title="Dockerfile"
ARG VERSION
ARG REVISION
ARG CREATED
LABEL org.opencontainers.image.source="https://gitlab.example.com/team/service" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.created="${CREATED}" \
      org.opencontainers.image.licenses="Apache-2.0"
```

```bash title="Build command"
docker buildx build \
  --build-arg VERSION="1.4.2" \
  --build-arg REVISION="$(git rev-parse HEAD)" \
  --build-arg CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --sbom=true --provenance=mode=max \
  --tag registry.example.com/team/service:1.4.2-3f9a1c2 \
  --push .
```

`--sbom=true` and `--provenance=mode=max` ask BuildKit to attach an SBOM and a provenance attestation to the pushed image. Option names, the available modes and what each mode records change between releases, so check the current Docker build attestation docs before you rely on the exact output. How we generate, store and sign these is in [[sbom-generation-and-storage]] and [[image-signing-and-admission-verification]].

The `ARG` values above are non-secret metadata, which is the only kind of `ARG` allowed. A version string and a commit SHA are public information.

**Tag rule.** Every pushed tag is `<semver>` for a release or `<semver>-<shortsha>` for a build from a branch. `latest` is not pushed, and no tag is moved after it is published. **Deploys use the digest**: the manifest or chart references `image@sha256:...`, and the tag in the same field is informational. The retention side of this is in [[artifact-retention-policy]].

## Exceptions and expiry

Some images cannot meet every rule, for example a vendor image that must run as root, or a debug image with unpinned tools.

- An exception is a short record in the exception register: the rule, the Dockerfile, the reason, the compensating control, an owner and an **expiry date**. The default maximum is 90 days (a proposed team default), renewable once with a reason.
- The `.hadolint.yaml` ignore comment points at the record. When the date passes, the CI job for the register fails the pipeline, so exceptions expire rather than accumulate.
- A root runtime user always needs a compensating control: a read-only root filesystem, dropped capabilities, and a runtime policy that restricts the pod.

## Failure modes the rules prevent

| Rule                         | Failure it prevents                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| No secrets in `ARG` or `ENV` | A token passed with `--build-arg` appears in `docker history` and in image metadata. Anyone who can pull the image reads it             |
| Digest pin, no `latest`      | The base moves on a Tuesday, an unrelated rebuild picks up a new libc, and a rollback rebuilds an image that is not the one that worked |
| Non-root `USER`              | A remote code execution bug in the app, combined with a writable mount or a runtime flaw, gives the attacker root on the node           |
| Multi-stage                  | Compilers, package caches and source code ship to production, enlarging the attack surface and the vulnerability report                 |
| `curl \| sh` banned          | A compromised or truncated download executes during the build with the build's credentials                                              |
| Allowlist                    | A typo-squatted or abandoned public image becomes part of the production supply chain                                                   |
| Labels and attestations      | During an incident nobody can say which commit built the running image                                                                  |
| Deploy by digest             | A tag overwritten in the registry changes what a restart pulls                                                                          |

## Reviewer checklist

- [ ] Every `FROM` is on the allowlist and pinned by digest; no `latest`.
- [ ] Final stage sets a numeric `USER`, and the process does not need root.
- [ ] No secret in `ARG`, `ENV`, `COPY` or a `RUN` argument; secrets use BuildKit secret mounts.
- [ ] No `ADD <url>` and no `curl | sh`; downloads are verified with a checksum.
- [ ] `.dockerignore` exists and excludes `.git` and environment files.
- [ ] Multi-stage where build tools are involved; the final stage copies only artifacts.
- [ ] `ENTRYPOINT` and `CMD` in exec form; no `HEALTHCHECK` for Kubernetes-only images.
- [ ] OCI labels set from build arguments; the tag is `<semver>` or `<semver>-<shortsha>`.
- [ ] `hadolint` passes at `warning`; every ignored rule has a reason, an owner and an expiry.
- [ ] The build produces an SBOM and provenance, and the deploy references the digest.

## Sources

- [Dockerfile reference](https://docs.docker.com/reference/dockerfile/)
- [Docker build best practices](https://docs.docker.com/build/building/best-practices/)
- [OCI image spec: pre-defined annotation keys](https://github.com/opencontainers/image-spec/blob/main/annotations.md)
- [hadolint](https://github.com/hadolint/hadolint)
- [Docker build attestations](https://docs.docker.com/build/metadata/attestations/)

## Related

- [[dockerfile-hardening]]: the how-to behind these rules.
- [[code-review]]: how reviewers use the checklist.
- [[vulnerability-management-slas]]: image scanning and remediation deadlines.
- [[artifact-retention-policy]]: how long tags and digests are kept.
- [[image-signing-and-admission-verification]]: signing the digest and verifying it at admission.
- [[sbom-generation-and-storage]]: what to do with the SBOM from the build.
- [[artifactory-artifact-naming-and-versioning]]: where images live and how they are named.
- [[ci-pipeline-standard]]: pinning and timeouts for the lint job.
