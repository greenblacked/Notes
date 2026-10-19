---
title: Keyless cosign image signing by digest
description: CI signs every release image digest with cosign, keyless from GitLab OIDC and with a Cloud KMS key where keyless is not possible.
type: adr
tags:
  - adr
  - supply-chain
  - security
  - ci-cd
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0037
---

## Context

Admission control can only trust what it can verify. Without signatures, any image that reaches a registry with the right tag is deployable, and a stolen registry credential becomes a production foothold. We want proof that an image digest was produced by our pipeline from a protected ref, checkable by the cluster without sharing long-lived signing keys. See [[image-signing-and-admission-verification]] for the mechanics.

## Decision

Every release image is signed with **cosign, by digest**.

- **Sign digests, not tags.** Tags move; a signature on a digest cannot be redirected. The digest comes from the push step (see [[0010-deploy-images-by-digest]]).
- **GitLab CI signs keylessly.** The job requests a GitLab OIDC token (`id_tokens`), and cosign exchanges it for a short-lived certificate from Fulcio. The verification identity is pinned to the project path and the protected ref, never a wildcard over the instance. Public-good Fulcio accepts only configured OIDC issuers (gitlab.com is one); a self-managed GitLab needs a private Sigstore (Fulcio and Rekor) or the KMS key path. Check the Fulcio issuer list.
- **Jenkins signs with a Cloud KMS key.** Jenkins has no equivalent OIDC identity we trust, so a KMS key with signing-only permission is used, accessed through federation (see [[cloud-kms-key-management]] and [[0026-keyless-ci-auth-with-workload-identity-federation]]).
- **Attestations travel with the image.** The SBOM (see [[0039-cyclonedx-as-canonical-sbom-format]]) and build provenance (see [[slsa-build-provenance]]) are attached as signed attestations.
- **Public transparency log.** Keyless signing records entries in the public Rekor log, so the identity string, which includes the project path, becomes publicly visible. If project paths are sensitive, use the KMS path or a private Sigstore deployment. This is decided per registry and recorded in the platform standard.
- **Verification** happens at admission (see [[0038-kyverno-verifies-image-signatures-at-admission]]).

```yaml title=".gitlab-ci.yml (excerpt)"
sign-image:
  stage: publish
  id_tokens:
    SIGSTORE_ID_TOKEN:
      aud: sigstore
  script:
    - cosign sign --yes "${IMAGE_REPO}@${IMAGE_DIGEST}"
  rules:
    - if: $CI_COMMIT_TAG =~ /^v\d+\.\d+\.\d+$/
```

```bash title="verify-signature.sh"
set -euo pipefail
IMAGE="artifactory.example.com/payments-docker-prod-local/payments/api@sha256:0000000000000000000000000000000000000000000000000000000000000000"

cosign verify "${IMAGE}" \
  --certificate-identity "https://gitlab.example.com/payments/api//.gitlab-ci.yml@refs/tags/v1.2.3" \
  --certificate-oidc-issuer "https://gitlab.example.com"
```

The digest is a placeholder. Use the real digest from your push step.

> [!info] Claims not checked against current docs
> Current cosign flags (`--yes`, identity and issuer flags, key URI syntax for KMS), the GitLab `id_tokens` audience requirements, the exact certificate identity format GitLab produces, and Rekor behaviour. Check the Sigstore and GitLab documents listed below before copying.

## Consequences

Easier:

- No signing key to store, rotate or leak for GitLab pipelines.
- A compromised developer laptop cannot produce an image the cluster will accept.
- Audit questions ("which pipeline built this?") are answered from the certificate.

Harder:

- Signing depends on Sigstore public infrastructure availability for keyless flows. Plan for a pipeline that cannot sign: release waits; it does not bypass.
- Two signing paths (keyless and KMS) double the verification policy surface.
- Identity patterns must be maintained when projects are renamed or moved, or verification fails.
- Public log entries may disclose project names (see above).

## Alternatives considered

- **Long-lived signing keys in CI variables.** Simple, but a theft gives permanent forgery power. Rejected.
- **Notation (Notary Project).** A credible alternative with registry-native signatures. Not chosen because tooling for admission and attestations is weaker in our stack today; check current state before revisiting.
- **No signing, rely on registry access control.** Rejected: it protects the registry, not the chain from build to cluster.

## Validation

```bash title="validate-signing.sh"
set -euo pipefail
IMAGE="artifactory.example.com/payments-docker-prod-local/payments/api@sha256:0000000000000000000000000000000000000000000000000000000000000000"

# A signature exists for the digest (expected: output lists signatures)
cosign tree "${IMAGE}"

# Negative test: an unsigned image must fail verification (expected: non-zero exit)
! cosign verify "artifactory.example.com/payments-docker-prod-local/test/unsigned@sha256:1111111111111111111111111111111111111111111111111111111111111111" \
  --certificate-identity-regexp '.*' --certificate-oidc-issuer "https://gitlab.example.com"
# '.*' is only acceptable here because we expect FAILURE; never use it for positive verification
```

## References

- Cosign signing: https://docs.sigstore.dev/cosign/signing/overview/
- GitLab OIDC for external services: https://docs.gitlab.com/ci/secrets/id_token_authentication/
- Cloud KMS: https://cloud.google.com/kms/docs

Related notes:

- [[image-signing-and-admission-verification]]
- [[slsa-build-provenance]]
- [[cloud-kms-key-management]]
- [[0010-deploy-images-by-digest]]
- [[0038-kyverno-verifies-image-signatures-at-admission]]
