---
title: Verifying AI model supply chains
description: Establish model artifact identity, provenance, integrity, and controlled promotion instead of trusting a model name or download page.
type: guide
tags:
  - ai
  - security
  - supply-chain
created: 2026-10-26
modified: 2026-10-26
draft: false
---

An AI model is a supply-chain artifact with a publisher, source repository, files, tokenizer or configuration, dependencies, conversion steps, and deployment process. A friendly model name is not a stable identity. Files may be updated, mirrored, converted, or served by a different account than expected. This note defines a verification workflow for model artifacts, not a claim that signatures or provenance can establish model behavior. It complements [[ai/model-artifacts-in-artifactory]] and [[ai/model-version-pinning-and-upgrade-evals]].

## Identify exactly what is being trusted

Record the model provider or publisher, repository or service identifier, immutable revision or version, file manifest, cryptographic digests, tokenizer and configuration versions, license, intended use, and evaluation evidence. For hosted APIs, record the provider, endpoint, region, model identifier, request settings, and date checked; provider aliases and service terms can change. Ask the provider what identity and version data is actually exposed rather than assuming an API label maps permanently to immutable weights.

For self-hosted weights, enumerate all files used at runtime, including configuration, tokenizer, adapters, quantization, custom code, plugins, and dependencies. A checksum proves that a later file matches a recorded digest; it does not prove who published it or whether it is safe. Keep a signed or otherwise protected manifest that binds the approved digests to the intended source and review decision. Store approved artifacts in a controlled registry or object store with access logging and immutable retention where appropriate.

## Verify provenance and integrity

Obtain artifacts from approved channels and verify the publisher identity and file digests before promotion. Where a repository provides signed tags, signatures, or attestations, verify the exact expected identity and issuer, not just that a cryptographic object exists. Sigstore’s Cosign documentation describes signature and attestation verification workflows; configure trusted identities carefully and keep verification policy under change control. SLSA provenance can describe how an artifact was built and its source inputs, but the assurance depends on the producer and the level achieved.

Use a promotion pipeline: fetch into quarantine, scan and inspect, verify metadata and hashes, review license and intended use, evaluate in an isolated environment, then promote the approved immutable artifact. Prevent inference runtimes from downloading arbitrary code or model components at startup. Disable custom model code unless required and reviewed. Pin the deployment to a digest or immutable revision where the platform supports it, and alert if the runtime resolves to a different artifact than the approved manifest.

## Inspect components and dependencies

Check file types, sizes, unexpected executables, custom loader behavior, remote-code requirements, and dependencies. Model formats may have different deserialization risks; use safe formats and loading modes supported by the framework, and keep parsers current. Do not execute repository scripts just to inspect weights. Process untrusted artifacts in an isolated analysis environment with no credentials and limited network access.

Model cards can document intended use, limitations, training information, and evaluations, but they are publisher-supplied claims and may be incomplete or outdated. Compare them to the artifact revision and independent evaluation evidence. Do not treat a model card, popularity count, download count, or checksum as a security approval. For behavior and governance concerns in open weights, see [[ai/open-weight-model-risk-assessment]].

## Control promotion and runtime drift

Separate permissions for artifact publishing, evaluation, approval, and production deployment. A model uploader should not also have unilateral production rollout authority. Require independent review for new sources, changed licenses, custom code, or major runtime dependencies. Record the approving owner, source revision, digests, test result, deployment target, and rollback artifact. Avoid embedding model files in opaque containers without an inventory linking the image digest to the model digest.

Monitor runtime resolution and artifacts loaded after startup. A cache, mirror, sidecar, or plugin may introduce a second source path. Keep egress restricted so an inference process cannot fetch unexpected files. If a deployment uses a managed provider, assess the provider’s documented supply-chain and change-notification controls, but do not overstate what is visible to the customer. Review provider details periodically because they change.

## Failure handling

Reject promotion when a digest is missing, metadata does not match, signature identity is unexpected, provenance cannot be verified under policy, or a runtime loads undeclared files. A failed verification should not silently fall back to an unpinned “latest” model. For an emergency rollback, deploy a previously approved immutable artifact rather than downloading a replacement during an outage.

If a model artifact is suspected compromised, suspend further promotion, preserve the artifact, hashes, source metadata, signature/attestation, acquisition logs, and deployed image reference. Identify all environments using the same digest and assess whether data or control decisions were affected. Revoke publisher or registry access only through a coordinated incident process; preserve necessary evidence first.

## Review checklist

- Is each model tied to an immutable source revision and digest manifest?
- Are signatures and attestations checked against expected identities and policy?
- Are provenance and model-card claims treated as evidence to review, not guarantees?
- Are custom code and runtime downloads disabled or separately approved?
- Is promotion separated from production release authority?
- Does the running service load only approved artifacts?
- Are provider model identifiers and terms rechecked for hosted services?
- Is there a known-good rollback artifact and incident preservation process?

## Sources

- [SLSA specification v1.1](https://slsa.dev/spec/v1.1/): supply-chain levels and provenance concepts.
- [Sigstore Cosign: Verifying signatures](https://docs.sigstore.dev/cosign/verifying/verify/): verification of signatures and attestations.
- [Hugging Face Hub model cards](https://huggingface.co/docs/hub/en/model-cards): model card structure and expected descriptive information; publisher claims still require review.
- [NIST AI 600-1, Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf): risk management context for GenAI components.
- [Owner’s AI skills catalogue](https://ai.szolotov.com): reusable AI skills and workflows.
