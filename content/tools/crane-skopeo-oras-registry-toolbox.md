---
title: crane, skopeo and ORAS registry toolbox
description: "Daemonless registry tools for digests, promotion by copy, mirroring and OCI artifacts: crane, skopeo and ORAS recipes with safety habits."
type: tool
tags:
  - tools
  - docker
  - supply-chain
  - artifactory
  - gcp
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Several decisions in these notes work at the registry level, not the Docker daemon level: deploy by digest ([[0010-deploy-images-by-digest]]), Helm charts as OCI artifacts ([[0008-helm-charts-as-oci-artifacts]]), promotion between repositories ([[artifact-promotion-artifactory]]), SBOMs and signatures stored next to images ([[sbom-generation-and-storage]], [[cosign-vs-notation]]), and a cache fallback when Artifactory is down ([[artifactory-outage-cache-fallback]]). Three small, daemonless tools do that work: **crane** for reading and copying images, **skopeo** for copying and mirroring between registries and formats, and **ORAS** for arbitrary OCI artifacts and their referrers. This note is a working kit in the style of [[k9s-kubectx-stern-toolbox]]: what each is for, the recipes that come up, and the habits that keep them from changing a digest by accident.

> [!info] Flags and versions not checked against current releases
> Written from each project's command documentation in its repository on 2026-10-21; not checked against the published sites, so verify there. Run `--help` for your installed version before scripting. Not verified: Artifact Registry's access-token login flow and IAM role names; Artifact Registry and Artifactory support for the OCI Referrers API and sparse indexes; how cleanup policies treat referrers; ORAS `login` flags; registry rate limits.

## Why daemonless tools

- **No Docker socket in CI.** [[0015-no-privileged-image-builds-in-ci]] rules out privileged builds and socket mounts. crane, skopeo and ORAS talk to the registry API over HTTPS and need neither.
- **Digests and indexes as first-class objects.** `docker pull` resolves a tag to your platform and throws the index away. These tools read and copy the exact manifest or index, so a digest survives the copy.
- **No pull to disk.** Copying between registries streams blobs (and skips blobs the destination already has) instead of pulling, re-tagging and pushing.

| Tool   | Best at                                                           | Watch out for                                                        |
| ------ | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| crane  | Digests, manifests, configs, tags, fast registry-to-registry copy | `mutate`, `append` and `rebase` create new images with new digests   |
| skopeo | Copy and sync between registries and formats; mirroring lists     | Copies only the host platform unless told otherwise                  |
| ORAS   | Pushing and attaching any artifact; listing referrers             | `discover` and recursive copy are marked Preview in the version read |

## Authentication

Keep tokens out of command lines: anything in an argument can appear in shell history, process listings and CI logs. Every tool here can read a secret from stdin.

**Artifact Registry.** `gcloud auth configure-docker` registers gcloud as a Docker credential helper in Docker's config; it writes `credHelpers` entries for the registries you name and overwrites existing entries for those registries. crane uses the Docker config's credential helpers through its default keychain (the go-containerregistry `authn` library behaviour). The standalone `docker-credential-gcr` helper is for machines without gcloud; its README recommends `gcloud auth configure-docker` otherwise.

```bash title="Artifact Registry: credential helper (host form to verify in the Artifact Registry docs)"
REGISTRY="europe-west1-docker.pkg.dev"
gcloud auth configure-docker "${REGISTRY}"
crane ls "${REGISTRY}/example-project/apps/api"
```

In CI with Workload Identity Federation ([[0026-keyless-ci-auth-with-workload-identity-federation]]), a short-lived access token avoids the helper. The `oauth2accesstoken` user name is the documented pattern for Google registries but was not verified for this note:

```bash title="CI: short-lived token through stdin (not verified)"
export DOCKER_CONFIG="$(mktemp -d)"     # throwaway credential store for this job
trap 'rm -rf "${DOCKER_CONFIG}"' EXIT
gcloud auth print-access-token \
  | crane auth login europe-west1-docker.pkg.dev -u oauth2accesstoken --password-stdin
```

**Artifactory.** Use an access token for a scoped CI user, stored in the CI secret store and passed on stdin:

```bash title="Artifactory token without exposing it in argv"
printf '%s' "${ARTIFACTORY_TOKEN}" \
  | crane auth login artifactory.example.com -u ci-promoter --password-stdin
printf '%s' "${ARTIFACTORY_TOKEN}" \
  | skopeo login artifactory.example.com -u ci-promoter --password-stdin
```

skopeo keeps credentials in an auth file: `--authfile`, `--src-authfile`, `--dest-authfile`, or `REGISTRY_AUTH_FILE`; on Linux the default is `${XDG_RUNTIME_DIR}/containers/auth.json`. Avoid `--src-creds` and `--dest-creds`, which put the secret in argv. ORAS has `oras login`; check `oras login --help` for its stdin option.

## crane

crane (from go-containerregistry) is the quickest way to answer "what exactly is this tag?".

```bash title="read-only crane commands"
IMG="europe-west1-docker.pkg.dev/example-project/apps/api"

crane digest "${IMG}:1.42.0"                  # digest of the tag (index digest for multi-arch)
crane digest --full-ref "${IMG}:1.42.0"       # repo@sha256:... ready for a manifest
crane manifest "${IMG}:1.42.0" | jq .         # raw manifest or index
crane config "${IMG}:1.42.0" | jq .config     # image config: entrypoint, env, labels
crane ls "${IMG}"                             # tags in the repository
crane ls -O "${IMG}"                          # omit sha256-... digest tags (signatures, attestations)
```

Copy and tag:

```bash
crane copy "${IMG}@sha256:<digest>" "${DEST}:1.42.0"   # keeps the digest; whole index by default
crane copy -n "${SRC}:1.42.0" "${DEST}:1.42.0"         # --no-clobber: fail rather than overwrite a tag
crane tag "${IMG}@sha256:<digest>" prod                # add a tag in place, no layer checks
```

- `crane copy` is documented as copying "while retaining the digest value". The global `--platform` flag defaults to `all`, so a copy keeps the full multi-arch index unless you pass `--platform`, which produces a different digest.
- `crane tag` is slightly faster than `copy` because it skips layer existence checks; use it inside one repository.
- `-a/--all-tags` copies every tag; `-j` sets concurrency.

> [!warning] mutate, append and rebase produce new digests
> `crane mutate` (labels, annotations, env, entrypoint, user, platform) and `crane append` (extra layers) write a new manifest to the registry; without `-t/--tag`, `mutate` pushes by digest to the original repository. The result is a new image that was never scanned or signed. In a deploy-by-digest pipeline, never mutate a promoted image; rebuild instead.

`crane index append -m REF -m REF -t TAG` assembles an index from per-architecture images; useful when platform images were built on separate runners.

## skopeo

skopeo copies between transports: registries (`docker://`), OCI layouts (`oci:`), directories (`dir:`), Docker archives (`docker-archive:`) and local container storage.

```bash title="inspect"
skopeo inspect --raw docker://europe-west1-docker.pkg.dev/example-project/apps/api:1.42.0 | jq .mediaType
skopeo inspect --config docker://europe-west1-docker.pkg.dev/example-project/apps/api:1.42.0 | jq .config.Labels
skopeo inspect --no-tags docker://europe-west1-docker.pkg.dev/example-project/apps/api:1.42.0
```

`--raw` shows the manifest exactly as stored, including its media type; `--no-tags` skips listing every tag in large repositories.

> [!warning] skopeo copies only your platform by default
> `skopeo copy` and `skopeo sync` default to `--multi-arch=system`: from a multi-architecture image they copy only the image matching the host's OS and architecture. The destination gets a single-platform manifest with a **different digest**, and arm64 nodes fail to pull. Pass `--all` (or `--multi-arch=all`) and `--preserve-digests` together; the man page notes that `--preserve-digests` "does not change what will be copied".

```bash title="digest-preserving copy"
skopeo copy --all --preserve-digests \
  --digestfile /tmp/copied.digest \
  docker://artifactory.example.com/docker-stage/apps/api@sha256:<digest> \
  docker://artifactory.example.com/docker-prod/apps/api:1.42.0
```

- `--preserve-digests` fails the copy if the digest cannot be kept, which is what you want in promotion.
- `--format oci|v2s1|v2s2` converts the manifest type and therefore changes the digest; never use it in promotion.
- `--remove-signatures` is needed when copying a signed image to a destination that cannot store its signatures; that drops the signatures, so verify policy afterwards.
- `--src-tls-verify=false` exists. Do not use it against production registries.

`skopeo sync` mirrors whole repositories or a YAML list of images, which is the tool for keeping a fallback registry warm:

```yaml title="mirror/base-images.yaml (names illustrative)"
artifactory.example.com:
  images:
    docker-remote/library/python:
      - "3.12-slim"
    docker-remote/library/nginx:
      - "1.27-alpine"
  images-by-semver:
    docker-remote/library/alpine: ">= 3.20.0"
```

```bash title="sync into Artifact Registry; dry run first"
skopeo sync --src yaml --dest docker --all --preserve-digests --dry-run \
  mirror/base-images.yaml europe-west1-docker.pkg.dev/example-project/base-mirror
skopeo sync --src yaml --dest docker --all --preserve-digests \
  mirror/base-images.yaml europe-west1-docker.pkg.dev/example-project/base-mirror
```

The YAML format can also hold credentials; do not put them there, use the auth file. Without `--scoped`, the destination keeps only the last path component (`base-mirror/python`, as the man page examples show); `--scoped` prefixes destination paths with the source path so images with the same name from different registries do not collide.

## ORAS

ORAS pushes any file as an OCI artifact and attaches artifacts to existing images through the `subject` field, which is how SBOMs, signatures and attestations stay linked to an image digest.

```bash title="push, attach, discover (artifact types are examples)"
REPO="europe-west1-docker.pkg.dev/example-project/apps/api"
DIGEST="sha256:<digest>"

# Push a standalone artifact with an explicit artifact type
oras push --artifact-type application/vnd.example.runbook+markdown \
  "${REPO}-docs:1.42.0" runbook.md:text/markdown

# Attach an SBOM to the image index by digest
oras attach --artifact-type application/spdx+json \
  "${REPO}@${DIGEST}" sbom.spdx.json:application/spdx+json

# List what refers to the image
oras discover --format tree "${REPO}@${DIGEST}"
oras discover --artifact-type application/spdx+json --format json "${REPO}@${DIGEST}"
```

- Attach by digest, never by tag: a tag can move after you attach.
- `--platform linux/amd64` on `attach` targets one image inside an index instead of the index itself. Decide which one your consumers query and be consistent.
- `--distribution-spec v1.1-referrers-api` or `v1.1-referrers-tag` forces the referrers method; useful when a registry's support is unclear.
- `oras cp -r` copies an artifact with its referrers (Preview in the version read); `oras cp --platform` copies selected platforms and, when it keeps fewer index entries, produces a different index digest.
- For signing, use cosign or Notation ([[cosign-vs-notation]]); they use the same referrer mechanism.

### How referrers work

The OCI distribution spec defines `GET /v2/<name>/referrers/<digest>`, which returns an index of manifests whose `subject` is that digest, optionally filtered by `artifactType`. A registry that supports it returns an empty list rather than 404 when nothing refers to the digest. When a registry lacks the API, clients fall back to the **referrers tag schema**: an index stored under a tag derived from the digest (the `sha256-...` tags that `crane ls -O` hides), which the client updates on push and delete. Whether Artifact Registry and your Artifactory version support the API was not verified; `oras discover --distribution-spec v1.1-referrers-api` against a test image tells you.

## Recipes

### Resolve a tag to a digest for a deploy

```bash title="ci/resolve-digest.sh"
#!/usr/bin/env bash
set -euo pipefail
IMAGE="europe-west1-docker.pkg.dev/example-project/apps/api"
TAG="${1:?usage: resolve-digest.sh TAG}"

REF="$(crane digest --full-ref "${IMAGE}:${TAG}")"
case "${REF}" in
  *@sha256:*) echo "${REF}" ;;
  *) echo "unexpected reference: ${REF}" >&2; exit 1 ;;
esac
```

For multi-arch images this returns the **index** digest, which is what [[0010-deploy-images-by-digest]] pins so each node resolves its own architecture.

### Promote by copy and prove the digest did not change

```bash title="ci/promote.sh"
#!/usr/bin/env bash
set -euo pipefail
SRC="artifactory.example.com/docker-stage/apps/api"
DST="artifactory.example.com/docker-prod/apps/api"
DIGEST="${1:?usage: promote.sh sha256:DIGEST VERSION}"
VERSION="${2:?usage: promote.sh sha256:DIGEST VERSION}"

# A retry after a copy that already landed must pass the check below, not trip -n.
if GOT="$(crane digest "${DST}:${VERSION}" 2>/dev/null)"; then
  echo "${DST}:${VERSION} already exists; checking its digest"
else
  crane copy -n "${SRC}@${DIGEST}" "${DST}:${VERSION}"
  GOT="$(crane digest "${DST}:${VERSION}")"
fi
if [ "${GOT}" != "${DIGEST}" ]; then
  echo "${DST}:${VERSION} is ${GOT}, expected ${DIGEST}" >&2
  exit 1
fi
echo "promoted ${DST}@${DIGEST} as ${VERSION}"
```

Artifactory also has its own server-side promotion; [[artifact-promotion-artifactory]] covers when to use it. Whichever copies, the digest check at the end is the proof. Signatures and SBOMs stored as referrers are separate manifests: copy them too (`oras cp -r`, or the signing tool's copy command) or re-attach them in the destination, and verify the signature there.

### Mirror base images during an Artifactory outage

When Artifactory is down, builds and node image pulls fail ([[gke-image-pull-registry-failures]]). With the `skopeo sync` job above running on a schedule into an Artifact Registry repository, the fallback in [[artifactory-outage-cache-fallback]] is a configuration switch instead of an emergency copy. During the incident:

```bash
# Confirm the mirror has the exact digest builds expect
crane digest artifactory.example.com/docker-remote/library/python:3.12-slim 2>/dev/null || echo "source unavailable"
crane digest europe-west1-docker.pkg.dev/example-project/base-mirror/python:3.12-slim
```

If the source is reachable from another network path, `skopeo copy --all --preserve-digests` a single image instead of re-running the whole sync. Repository layout guidance is in [[artifactory-repository-design]] and the registry comparison in [[artifactory-vs-nexus-vs-artifact-registry]].

### Inspect a Helm chart stored as OCI

```bash
CHART="europe-west1-docker.pkg.dev/example-project/charts/api"
crane ls "${CHART}"
crane manifest "${CHART}:1.8.0" | jq '{mediaType, config: .config.mediaType, layers: [.layers[].mediaType]}'
```

A chart pushed by `helm push` has a Helm-specific config media type; an image tag pushed to the chart repository by mistake shows an image config type instead.

## Validation

- **Digest equality** is the only proof a copy preserved the image: `crane digest SRC` equals `crane digest DST`.
- **Media types** tell you what was copied: `skopeo inspect --raw docker://REF | jq -r .mediaType` shows an image index (`application/vnd.oci.image.index.v1+json` or the Docker manifest list type) or a single manifest. The field is optional in OCI manifests, so an empty result means read the whole document.
- **Platforms in an index**: `crane manifest REF | jq -r '.manifests[]?.platform | "\(.os)/\(.architecture)"'` should list every platform the source had.
- **Referrers present**: `oras discover --format json REF` lists the SBOM and signatures you expect.

## Failure modes

- **Single-platform copy.** skopeo without `--all`, or crane or ORAS with `--platform`, writes a different digest. Admission rejects it (wrong digest or no signature), or arm64 nodes cannot pull. Fix: re-copy with `--all --preserve-digests`.
- **Format conversion.** Copying between registries with different manifest support, or with `--format`, converts Docker and OCI media types and changes the digest. Use `--preserve-digests` so the copy fails instead.
- **Registries without the Referrers API.** Tools fall back to `sha256-...` tags. Retention jobs that delete untagged manifests, or tags matching `sha256-*`, can delete signatures and SBOMs, and stale tag-schema indexes can remain after the subject is gone. This is an inference from the spec, so test your cleanup policy against an image with referrers.
- **Rate limits.** Pulling from public registries during a big sync hits their limits; mirror through Artifactory or Artifact Registry remote repositories and check each registry's own limit page.
- **Sparse indexes rejected.** Copying a subset of platforms leaves index entries pointing at missing images; some registries reject that. skopeo's `--strip-removed-platforms` rewrites the index (new digest, signatures must be removed).
- **Credentials leaking into logs.** `-p`, `--src-creds` or a token in a URL ends up in CI logs. Use stdin and throwaway auth files.

## Safety habits

- **Read before write.** Run `crane digest` and `crane manifest` on source and destination before any copy that overwrites a tag; use `-n` to refuse overwrites.
- **No deletes without a retention review.** `crane delete` removes a reference from the registry, and anything deployed by that digest fails its next pull. Deletion belongs in a reviewed retention policy, not an ad hoc command; check what still runs by that digest first.
- **No mutate on promoted images.** Rebuild through the pipeline so the new image is scanned and signed.
- **Pin and verify the tools.** Install pinned versions; crane publishes release provenance that `slsa-verifier` can check, and the ORAS image is published with version tags. Pin by digest in CI images.
- **Explicit references in scripts.** Full registry host, repository and digest in every command; no reliance on a default registry or `latest`.

## Related

- [[0010-deploy-images-by-digest]]
- [[0008-helm-charts-as-oci-artifacts]]
- [[0015-no-privileged-image-builds-in-ci]]
- [[artifact-promotion-artifactory]]
- [[artifactory-repository-design]]
- [[gke-image-pull-registry-failures]]
- [[sbom-generation-and-storage]]
- [[cosign-vs-notation]]

## Sources

- [crane command reference](https://github.com/google/go-containerregistry/blob/main/cmd/crane/doc/crane.md)
- [go-containerregistry authn package](https://github.com/google/go-containerregistry/tree/main/pkg/authn)
- [skopeo copy](https://github.com/containers/skopeo/blob/main/docs/skopeo-copy.1.md)
- [skopeo sync](https://github.com/containers/skopeo/blob/main/docs/skopeo-sync.1.md)
- [skopeo inspect](https://github.com/containers/skopeo/blob/main/docs/skopeo-inspect.1.md)
- [ORAS documentation](https://oras.land/docs/)
- [OCI distribution specification](https://github.com/opencontainers/distribution-spec/blob/main/spec.md)
- [Artifact Registry: Docker authentication](https://cloud.google.com/artifact-registry/docs/docker/authentication)
- [gcloud auth configure-docker](https://cloud.google.com/sdk/gcloud/reference/auth/configure-docker)
- [docker-credential-gcr](https://github.com/GoogleCloudPlatform/docker-credential-gcr)
