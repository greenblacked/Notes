---
title: CycloneDX as the canonical SBOM format
description: Every image digest gets a CycloneDX JSON SBOM attested with cosign, and SPDX is produced only when a customer or licence review asks for it.
type: adr
tags:
  - adr
  - supply-chain
  - compliance
  - docker
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0039
---

> [!warning] Not legal or audit advice
> This record describes an engineering choice. Licence obligations and customer contract terms need review by the people responsible for them.

## Context

A software bill of materials (SBOM) answers "what is inside this image?" quickly, which matters most when a new vulnerability lands and we must find affected images in minutes. Two formats dominate: CycloneDX and SPDX. Producing both for everything doubles storage and tooling, and having none means searching images one by one.

Our scanners, dependency tracking and signing tools all read CycloneDX, and the main driver is vulnerability response rather than licence reporting.

## Decision

**CycloneDX JSON is the canonical SBOM format.**

- One SBOM per image **digest**, generated in CI after the build and before signing (see [[sbom-generation-and-storage]]).
- The SBOM is attached to the image as a signed cosign attestation (see [[0037-keyless-cosign-image-signing]]) and stored next to the artifact in the repository (see [[0005-xray-scanning-gates-promotion]]).
- Scanners consume the SBOM or the image directly. Vulnerability response searches stored SBOMs for the affected component and version.
- Licence review uses the same data (see [[open-source-license-compliance]]).
- **SPDX on demand.** If a customer, regulator or licence review requires SPDX, it is converted or regenerated for that release only. It is not a second stored copy by default.
- Spec and tool versions are pinned in the CI image so output is reproducible.

```bash title="generate-and-attest-sbom.sh"
set -euo pipefail
IMAGE="registry.example.com/payments/api"
DIGEST="sha256:0000000000000000000000000000000000000000000000000000000000000000"

syft "${IMAGE}@${DIGEST}" -o cyclonedx-json > sbom.cdx.json
cosign attest --yes --type cyclonedx --predicate sbom.cdx.json "${IMAGE}@${DIGEST}"
```

```bash title="find-affected-images.sh"
set -euo pipefail
# Which stored SBOMs contain a vulnerable component? Example component name only.
grep -l '"name": "openssl"' sboms/*.cdx.json
```

The digest is a placeholder. Use the digest from your push step.

> [!info] Claims not checked against current docs
> The CycloneDX specification version Syft emits by default, the `cosign attest` flags and predicate type name, and whether the scanner in use ingests CycloneDX attestations directly. Check the Syft, cosign and CycloneDX docs for the installed versions.

## Consequences

Easier:

- One format means one parser, one storage layout and one search.
- Response time to a new advisory drops from hours of image inspection to a search.
- The attestation binds the SBOM to the exact digest, so it cannot drift from the image.

Harder:

- SBOMs from image scanning miss components that are not visible on the filesystem, such as statically linked or vendored code. Where the build system can emit a source-level SBOM, prefer it and merge.
- Stored SBOMs grow; retention follows the artifact retention policy (see [[0006-artifact-retention-by-cleanup-policies]]).
- Some recipients demand SPDX; the on-demand conversion must be tested before it is needed.
- SBOMs can expose internal package names. Treat them as internal, and decide what is shared externally.

## Alternatives considered

- **SPDX as canonical.** Strong on licence data and an ISO standard, which suits some procurement needs. Not chosen because our tooling and vulnerability workflow centre on CycloneDX.
- **Both formats stored for every image.** Doubles cost for rare benefit. Rejected.
- **No SBOM, scan only.** Scans answer today's question for images in the registry, but cannot answer "which deployed images contained X" after a rebuild. Rejected.

## Validation

```bash title="validate-sbom.sh"
set -euo pipefail
IMAGE="registry.example.com/payments/api@sha256:0000000000000000000000000000000000000000000000000000000000000000"

# An attestation exists for the digest
cosign tree "${IMAGE}"

# The SBOM is well-formed JSON and names its format (expected: CycloneDX)
jq -r '.bomFormat, .specVersion' sbom.cdx.json
```

## References

- CycloneDX specification: https://cyclonedx.org/specification/overview/
- SPDX: https://spdx.dev/
- Syft: https://github.com/anchore/syft

Related notes:

- [[sbom-generation-and-storage]]
- [[open-source-license-compliance]]
- [[slsa-build-provenance]]
- [[0005-xray-scanning-gates-promotion]]
- [[0037-keyless-cosign-image-signing]]
