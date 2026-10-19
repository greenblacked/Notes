---
title: Golden base images owned by the platform team
description: A small catalogue of hardened, digest-pinned base images is rebuilt on a schedule, and application images must build on them.
type: adr
tags:
  - adr
  - docker
  - security
  - supply-chain
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0040
---

## Context

Each team picked its own base image: full OS images with shells and package managers, different distributions, and tags that move underneath. The result was many versions of the same libraries, inconsistent users and file permissions, and a CVE response that meant asking every team to rebuild. Hardening guidance in [[dockerfile-hardening]] is only effective if the starting point is the same for everyone.

## Decision

The platform team **owns a small catalogue of golden base images**, and application Dockerfiles must start from them.

- **Catalogue.** A minimal or distroless image for static binaries, and one image per supported runtime (for example a JVM and a Python runtime). Adding an image needs a named owner and a reason. The aim is single digits.
- **Hardening.** Non-root default user, no shell or package manager in runtime images, read-only friendly file layout, pinned package sources, and labels for source repository and build ID.
- **Pinned by digest.** Consumers reference `FROM registry.example.com/base/runtime@sha256:...`, not a tag (see [[0010-deploy-images-by-digest]]).
- **Rebuilt on a schedule.** Images are rebuilt weekly and on critical advisories. Each rebuild is scanned, signed and promoted like any artifact (see [[0004-build-once-promote-between-repositories]] and [[0037-keyless-cosign-image-signing]]).
- **Bumps are automated.** A bot opens a merge request in each consuming repository when a new digest is published (see [[automated-dependency-updates]]).
- **Enforced.** CI lints the `FROM` line against an allowlist, and admission policy can reject images whose base is not on the list (via image labels or provenance).
- **Lifecycle.** Each image has a published support window. A deprecated image gets a warning period and a removal date; consumers are notified through the bump MR.
- **Builds** use unprivileged builders (see [[0015-no-privileged-image-builds-in-ci]]).

```dockerfile title="Dockerfile"
FROM registry.example.com/base/jre-17@sha256:0000000000000000000000000000000000000000000000000000000000000000
COPY --chown=10001:10001 app.jar /app/app.jar
USER 10001
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

```bash title="lint-from-lines.sh"
set -euo pipefail
# Fail if any Dockerfile uses a FROM outside the golden registry path (scratch is allowed)
grep -rIn --include='Dockerfile*' -E '^FROM ' . \
  | grep -v 'registry.example.com/base/' \
  | grep -v -E 'FROM +scratch' && exit 1 || exit 0
```

> [!info] Claims not checked against current docs
> The licence and redistribution terms of vendor-minimal or hardened base images (check the current terms before choosing a source), the support windows of any runtime version in the catalogue, and the distroless image names and tags. Verify against the upstream project pages below.

## Consequences

Easier:

- A base-image CVE is fixed once, then rolled out by bot MRs to every consumer.
- Consistent user IDs, paths and labels make policy and runtime security simpler.
- Smaller images pull faster and expose fewer binaries to attackers.

Harder:

- The platform team takes on a service with on-call implications: a broken base image breaks every build that bumps to it. Canary the new digest on a few repositories first.
- Debugging without a shell requires ephemeral debug containers or a separate debug variant, which is not deployed to production.
- Teams with unusual needs (native libraries, GPUs) need an exception path or a new catalogue entry.
- Weekly rebuilds create merge-request volume. Group bumps where tooling allows.

## Alternatives considered

- **Unmodified Docker Official Images.** Convenient and well maintained, but they carry a shell and package manager, and tags move. Acceptable as inputs to our build, not as the runtime base.
- **Team-chosen images.** Maximum freedom, but no central CVE response. Rejected.
- **A single universal base.** Simple, but forces large runtime images on static binaries. Rejected for the catalogue approach.

## Validation

```bash title="validate-base-images.sh"
set -euo pipefail
NS="payments"

# Running images not from the golden registry path (review exceptions)
kubectl get pods -n "${NS}" -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}' \
  | tr ' ' '\n' | sort -u | grep -v 'registry.example.com/' || true

# Images run as non-root (expected: no pod with runAsNonRoot unset)
kubectl get pods -n "${NS}" \
  -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.securityContext.runAsNonRoot}{"\n"}{end}'
```

## References

- Distroless images: https://github.com/GoogleContainerTools/distroless
- Dockerfile best practices: https://docs.docker.com/build/building/best-practices/

Related notes:

- [[dockerfile-hardening]]
- [[automated-dependency-updates]]
- [[artifact-promotion-artifactory]]
- [[0015-no-privileged-image-builds-in-ci]]
- [[0041-retire-chef-for-immutable-images]]
