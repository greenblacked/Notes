---
title: cosign vs Notation for container image signing
description: Comparing Sigstore cosign and Notary Project Notation on signing models, attestations, trust policy, KMS support and admission enforcement on GKE.
type: tool
tags:
  - tools
  - supply-chain
  - security
  - policy-as-code
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Two open-source tools dominate container image signing today: cosign from the Sigstore project and Notation from the Notary Project. Both sign an image by digest and store the signature in the registry next to it. They differ in how trust is established, what else they can attach, and which admission controllers verify them. The end-to-end pipeline and Kyverno enforcement are in [[image-signing-and-admission-verification]]; this note is for choosing the tool.

> [!info] Not checked against current releases
> Versions, command syntax, support matrices and registry compatibility were not checked when this note was written. Confirm them in each project's current documentation before relying on them.

## Short answer

- If you want keyless signing tied to the CI identity, attestations (SLSA provenance, SBOM) and the broadest tooling, use **cosign**.
- If you want a conventional X.509 certificate chain, an explicit trust-policy file and alignment with the Notary Project and Ratify, use **Notation**.
- Whichever you pick, sign by digest and enforce at admission. A signature nobody verifies protects nothing.

## At a glance

| Concern            | cosign                                                                          | Notation                                                           |
| ------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Project            | Sigstore                                                                        | Notary Project                                                     |
| Trust model        | Keyless (OIDC identity, Fulcio certificates, Rekor log) or keys                 | X.509 certificates and a trust store with a trust policy           |
| Key storage        | Local key, KMS (`gcpkms://`), hardware tokens                                   | Plugins for external key stores (check the plugin list)            |
| Attestations       | In-toto attestations (`cosign attest`): provenance, SBOM, others                | Signatures over artefacts; attestation support differs, check docs |
| Verification input | Identity and issuer, or public key                                              | Trust policy JSON: scopes, trust stores, identities                |
| Transparency log   | Rekor in the keyless flow                                                       | Not part of the core model; check the current docs                 |
| Admission          | Kyverno `verifyImages`, policy-controller, Binary Authorization (check support) | Ratify with Gatekeeper, Kyverno support; check the matrix          |
| Air-gapped use     | Possible with a private Sigstore stack or key-based signing                     | Natural fit: own CA, no external service                           |
| Registry storage   | OCI artefacts next to the image                                                 | OCI artefacts via the referrers mechanism                          |

## Signing models

### Keyless with cosign

In the keyless flow, the CI job authenticates with its OIDC token, Fulcio issues a short-lived certificate bound to that identity, the signature is recorded in the Rekor transparency log, and no long-lived key exists to steal. Verification then asks "was this signed by the pipeline workflow I trust".

```bash title="keyless sign and verify (verify flags with cosign --help)"
IMAGE=europe-west1-docker.pkg.dev/example-project/apps/api
DIGEST=sha256:0000000000000000000000000000000000000000000000000000000000000000

# In CI, with an OIDC token available
cosign sign --yes "${IMAGE}@${DIGEST}"

cosign verify \
  --certificate-identity-regexp '^https://gitlab\.example\.com/platform/api//\.gitlab-ci\.yml@refs/heads/main$' \
  --certificate-oidc-issuer 'https://gitlab.example.com' \
  "${IMAGE}@${DIGEST}"
```

The digest above is a placeholder: in a pipeline take it from the build output. Keep the identity regex as tight as you can; a loose one such as `.*` accepts a signature from any project on the issuer. Keyless depends on the public Sigstore services unless you host a private instance; confirm availability and data-publication implications (identities are written to a public log) against your policy.

### KMS keys with cosign

When you want a conventional key under your control, keep it in Cloud KMS. The key never leaves the HSM or KMS, and access is controlled by IAM. Key management practices are in [[cloud-kms-key-management]].

```bash title="sign with a Cloud KMS key (illustrative)"
KEY=gcpkms://projects/example-project/locations/global/keyRings/image-signing/cryptoKeys/cosign/versions/1

cosign sign --key "${KEY}" "${IMAGE}@${DIGEST}"
cosign verify --key "${KEY}" "${IMAGE}@${DIGEST}"
```

Rotation is manual: new key version, new verification config, a period where both are accepted. Plan it before the first signature.

### Notation with certificates

Notation signs with a key and certificate chain you manage, for example from your own CA or a cloud-managed one through a plugin. Verification does not trust "whoever the signature says"; it trusts what the trust policy lists.

```bash title="sign and verify (illustrative; check the plugin for your key store)"
notation sign "${IMAGE}@${DIGEST}" \
  --key example-signing-key

notation verify "${IMAGE}@${DIGEST}"
```

```json title="trustpolicy.json"
{
  "version": "1.0",
  "trustPolicies": [
    {
      "name": "example-production",
      "registryScopes": ["europe-west1-docker.pkg.dev/example-project/apps/api"],
      "signatureVerification": { "level": "strict" },
      "trustStores": ["ca:example-signing-ca"],
      "trustedIdentities": ["x509.subject: CN=ci-signer,O=Example,C=UA"]
    }
  ]
}
```

Import the CA certificate into the named trust store (`notation cert add`) and import the policy with `notation policy import trustpolicy.json`. Check the current specification for the exact schema and verification levels; the file above shows the shape, not a verified template.

## Attestations

Signing says "this exact image came from us". Attestations say what we know about it: how it was built, what it contains, what scans it passed.

```bash title="attach SLSA provenance with cosign"
cosign attest --yes --type slsaprovenance \
  --predicate provenance.json "${IMAGE}@${DIGEST}"

cosign verify-attestation --type slsaprovenance \
  --certificate-identity-regexp '^https://gitlab\.example\.com/platform/api//\.gitlab-ci\.yml@refs/heads/main$' \
  --certificate-oidc-issuer 'https://gitlab.example.com' \
  "${IMAGE}@${DIGEST}"
```

cosign's `attest` is designed for in-toto statements and is widely used for provenance and SBOMs; see [[slsa-build-provenance]] for what a provenance statement should contain and what level of assurance it gives, and [[sbom-generation-and-storage]] for SBOM handling. Notation concentrates on signatures; check the current Notary Project documentation for how attestations are represented and verified. If attestations are a hard requirement today, that tilts the choice toward cosign.

## Verification and trust policy

The policy that decides what is accepted matters more than the signing tool:

- **cosign:** the policy is the identity regex, the issuer, or the public key you pass. It lives in your admission policy (Kyverno `verifyImages`, for example) and should be reviewed like code.
- **Notation:** the policy is `trustpolicy.json`, a first-class artefact with registry scopes and trusted identities, which is easier to audit as a single file.

Whatever the tool, verify the digest you deploy. Admission webhooks should resolve a tag to a digest and verify that, and manifests in Git are best pinned by digest from the start. An unsigned image must be rejected in enforcing namespaces, with an audit-first rollout as described in [[policy-rollout-audit-to-enforce]].

## Admission enforcement

How signatures are checked at deploy time on GKE:

- **Kyverno** `verifyImages` rules verify cosign signatures and attestations and can mutate tags to digests. See [[gatekeeper-vs-kyverno]] for the engine trade-offs and the full pipeline in [[image-signing-and-admission-verification]]. Check the current Kyverno documentation for Notation support.
- **Ratify with Gatekeeper** is the Notary Project ecosystem's verifier. It can verify Notation signatures and, via plugins, others. Check the Ratify documentation for the current support matrix.
- **Binary Authorization** is Google's deploy-time control for GKE. It works with attestors and policies. Confirm in the current documentation which signature formats and attestation flows it accepts and how they map to cosign or Notation.

The support matrix between signers and verifiers changes, so test your exact combination in a non-production cluster before committing to it.

## Operating cost and private or air-gapped setups

- **cosign keyless** has the lowest key-management cost but depends on external services (or a private Sigstore deployment, which is real infrastructure).
- **cosign with KMS** costs KMS operations and rotation discipline.
- **Notation** costs running a CA or integrating with a managed one, and certificate lifecycle (expiry, revocation) work. In exchange it needs nothing public, which suits air-gapped or regulated environments.

Registry support matters too: both tools store signatures as OCI artefacts, so confirm that your registry (Artifact Registry, Artifactory) stores and replicates them, and that cleanup policies do not delete signature artefacts as untagged. See [[artifactory-vs-nexus-vs-artifact-registry]].

## When to choose which

Choose **cosign** when your CI has OIDC, you want identity-based verification without key custody, you need attestations, and your admission engine is Kyverno or similar.

Choose **Notation** when policy demands an explicit certificate chain and trust store, when you operate offline, or when Ratify is your verifier.

## Recommendation

Use cosign by default: keyless where your policy accepts public transparency logs, KMS keys otherwise, plus provenance and SBOM attestations, verified by Kyverno with a tight identity regex. Choose Notation when an internal CA and a reviewed trust policy are compliance requirements or you cannot use public services. Sign by digest, verify at admission, and test key or certificate rotation before you need it. Revisit when admission controllers change their support, when Binary Authorization's accepted formats change, or when your registry changes.

## Related

- [[image-signing-and-admission-verification]]
- [[gatekeeper-vs-kyverno]]
- [[slsa-build-provenance]]
- [[cloud-kms-key-management]]
- [[jfrog-xray-vs-trivy-vs-grype]]

## Sources

- [Sigstore cosign documentation](https://docs.sigstore.dev/cosign/)
- [Notary Project documentation](https://notaryproject.dev/docs/)
- [Ratify documentation](https://ratify.dev/docs/)
- [Binary Authorization documentation](https://cloud.google.com/binary-authorization/docs)
- [SLSA](https://slsa.dev/)
