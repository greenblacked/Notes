---
title: Deploy container images by digest, never by a mutable tag
description: Manifests reference image@sha256 digests, so the deployed bytes are exactly the ones that were scanned, signed and promoted.
type: adr
tags:
  - adr
  - docker
  - kubernetes
  - gitops
  - supply-chain
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0010
---

## Context

A tag such as `1.4.2` or `latest` is a pointer, and a pointer can move. If a registry allows a tag to be pushed again, then:

- The image that was scanned and signed is not necessarily the one a node pulls later.
- Two pods of the same Deployment can run different bytes if a node pulled before and another after the tag moved.
- A rollback to "the previous tag" may not go back to the previous bytes.
- An attacker or a mistaken pipeline with push rights can change what production runs without touching Git.

A digest (`sha256:...`) identifies the content itself. Build once and promote ([[0004-build-once-promote-between-repositories]]) only means something if the deployed reference points at exactly those bytes.

## Decision

We will **deploy container images by digest** and never rely on a mutable tag for what runs in a cluster.

- After the image push, CI **resolves the digest** and records it. The GitOps bump commit writes `image: repo@sha256:...` ([[gitops-repo-topology-and-promotion]]). A human-readable tag may be kept in a label, an annotation or a comment so people can still read the version.
- **Tag overwrite is prevented** in production repositories: overwrite is prevented by granting no Delete/Overwrite permission on production repositories except to the promotion identity (check the current Artifactory permission model) ([[0003-artifactory-repository-layout]]).
- **Admission checks the digest and its signature**, see [[0038-kyverno-verifies-image-signatures-at-admission]] and [[0037-keyless-cosign-image-signing]]. A manifest with a bare tag is rejected or at least reported in production namespaces.
- Rollback is a revert to an earlier digest ([[0048-rollback-by-redeploying-previous-digest]]).
- For multi-architecture images, the digest of the **image index** is what is pinned, so each node resolves its own architecture.

```bash title="resolve-digest.sh"
set -euo pipefail
IMAGE="artifactory.example.com/payments-docker-dev-local/api"
TAG="1.4.2"

# Option 1: Docker buildx
DIGEST=$(docker buildx imagetools inspect "${IMAGE}:${TAG}" --format '{{json .Manifest.Digest}}' | tr -d '"')

# Option 2: crane
# DIGEST=$(crane digest "${IMAGE}:${TAG}")

echo "${IMAGE}@${DIGEST}"
```

```yaml title="apps/payments/api/deployment.yaml (excerpt)"
spec:
  template:
    metadata:
      labels:
        app.kubernetes.io/version: "1.4.2" # readable label only
    spec:
      containers:
        - name: api
          image: artifactory.example.com/payments-docker-prod-local/api@sha256:<64-hex-digest>
```

Replace `<64-hex-digest>` with the value printed by the script. It is generated per build and cannot be written in advance.

> [!info] Not checked against current docs
> Not verified for this record: the exact output format flags of `docker buildx imagetools inspect` and `crane digest` in the versions on our runners (the `--format` template in particular), and how each registry reports the index digest for multi-architecture images. Check the Docker CLI reference and your tool's `--help`.

## Consequences

Easier:

- What is scanned, signed, promoted and deployed is provably the same content.
- Rollbacks and incident forensics are exact: a digest names the bytes.
- Node-level caching is safe, since a digest never changes meaning.

Harder or newly required:

- Manifests are less readable. The version label and release notes ([[release-versioning-and-changelog-automation]]) cover the human side.
- Tooling that bumps images must write digests. Automated dependency bots need configuration for digest pinning ([[automated-dependency-updates]]).
- The `imagePullPolicy` default depends on the tag form; with a digest it behaves as IfNotPresent, which is what we want. Review any policy that assumed `:latest` semantics.
- Zero-downtime rollouts still rely on health checks, not digests ([[zero-downtime-deployments-kubernetes]]).

## Alternatives considered

- **Immutable tags only.** Good when the registry enforces immutability, and we do enforce it in production repositories. Still only as safe as the setting, and it cannot be verified from the manifest. We use it as a second layer, not instead of the digest.
- **`tag@digest` form.** Readable and exact: Kubernetes uses the digest and ignores the tag. It is acceptable for teams that want the version visible in the image field, but the tag can then silently disagree with the digest after a re-tag. Allowed, with the digest authoritative.
- **Mutable tags with `imagePullPolicy: Always`.** Fresh pulls every time, but each pod start can pull different bytes. Rejected.

## Validation

Every running container must reference a digest. Set the namespace first; an empty output and exit status 0 mean success.

```bash title="validate-0010.sh"
set -o pipefail
NAMESPACE="payments"

# Containers whose image field has no digest (offenders only)
kubectl get pods --namespace "${NAMESPACE}" -o json \
  | jq -r '.items[] | .metadata.name as $p | .spec.containers[]
           | select(.image | contains("@sha256:") | not)
           | "\($p) \(.name) \(.image)"'

# The running imageID matches the digest in the spec
kubectl get pods --namespace "${NAMESPACE}" \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.containerStatuses[*].imageID}{"\n"}{end}'
```

## References

- Kubernetes, images: https://kubernetes.io/docs/concepts/containers/images/
- Docker buildx imagetools inspect: https://docs.docker.com/reference/cli/docker/buildx/imagetools/inspect/

Related notes:

- [[image-signing-and-admission-verification]]
- [[gitops-repo-topology-and-promotion]]
- [[zero-downtime-deployments-kubernetes]]
- [[0001-gitops-with-argocd]]
- [[0004-build-once-promote-between-repositories]]
- [[0037-keyless-cosign-image-signing]]
- [[0048-rollback-by-redeploying-previous-digest]]
