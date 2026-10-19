---
title: Xray scanning gates promotion between repositories
description: Artifacts are scanned through build info, and promotion to stage or prod is blocked on a policy violation.
type: adr
tags:
  - adr
  - artifactory
  - security
  - supply-chain
  - ci-cd
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0005
---

## Context

Images and packages were scanned, when at all, by whichever tool a team chose, at whichever step they remembered. Results lived in CI logs. Nothing stopped a vulnerable artifact from being promoted, and a CVE published after a build was invisible until someone happened to rescan.

We need scanning to be enforced where artifacts are stored and promoted ([[0004-build-once-promote-between-repositories]]), continuous so that new advisories reach artifacts already stored, and decided by policy rather than by whoever reads the report.

## Decision

We will use **JFrog Xray as the gate in the artifact store**: promotion from one stage repository to the next is blocked when a policy is violated.

- **Watches** cover the stage and prod local repositories and the build info of released builds. Dev repositories are scanned for feedback but never block developers from iterating.
- **Policies** are defined on severity (and on licence rules where [[open-source-license-compliance]] requires it). For prod, a violation sets "fail build" and "block download"; for stage it fails the promotion job but does not block download. The promotion job runs `jf build-scan` first and promotes only on exit code 0, because `jf rt build-promote` itself does not consult Xray (an alternative is Release Bundles v2 with an Xray block-promotion action; check the current JFrog docs).
- The **remediation timelines** (how fast each severity must be fixed) are not repeated here: they live in [[vulnerability-management-slas]]. This record only decides where the gate is and what it blocks.
- **Exceptions are time-boxed and owned.** A waiver names the CVE, the artifact scope, an owner, a reason and an expiry, and goes through [[policy-exception-and-waiver-process]]. No permanent ignore rules.
- **Break-glass:** a new advisory can block an urgent release. A named release owner may approve a time-limited waiver for a specific build, and the use is reviewed afterwards. The path is documented so that nobody disables the policy under pressure.
- Scanning needs a bill of materials: the SBOM produced per [[0039-cyclonedx-as-canonical-sbom-format]] is stored next to the artifact, see [[sbom-generation-and-storage]].
- A cheap scan in CI (Trivy or Grype) still runs before the push for fast developer feedback; it informs, while Xray gates.

> [!info] Not checked against current docs
> Not verified for this record: which Xray features and policy actions (build fail, block download, scanning of build info, indexing of Docker layers) exist on our current JFrog subscription tier, and their exact names. Check the current tier and the Xray documentation before configuring. Severity scoring follows CVSS; see the FIRST specification linked below.

## Consequences

Easier:

- One enforced gate with one audit trail, in the place every artifact passes through.
- Continuous rescans surface new CVEs in artifacts that are already stored and deployed.
- Teams see violations on the build, not in a separate tool.

Harder or newly required:

- A new CVE can block a release at an inconvenient time. The break-glass path above is the answer; without it the gate would be bypassed informally.
- False positives and unreachable-code findings cost triage time. Keep waivers specific and short, and review them monthly.
- Xray indexing adds load and delay to promotion. Measure the added time and set a pipeline timeout so a slow scan fails clearly rather than hanging.
- Licence and feature differences between subscription tiers can change what the gate can do. Record the tier in the platform documentation.

## Alternatives considered

- **Artifact Analysis in Artifact Registry.** Works well for images in Google Cloud and is native to GKE-oriented tooling, but it does not gate promotion across our non-image artifacts or our stage repositories. It may complement Xray for images that live in Artifact Registry (see [[0009-container-images-artifactory-or-artifact-registry]]).
- **Trivy or Grype in CI only.** Free and fast, and kept as a pre-push check. Without a gate in the store it can be skipped, results are not tied to the stored artifact, and nothing rescans after the build. Rejected as the sole control. See [[jfrog-xray-vs-trivy-vs-grype]] for the comparison.
- **Manual review of scan reports.** Does not scale and is not enforceable. Rejected.

## Validation

Prove the gate works by promoting a known-vulnerable test image, which must be refused, and by checking that a clean image is promoted. Set the variables first. The CLI flags are an assumption; confirm them with `jf build-scan --help` for your version.

```bash title="validate-0005.sh"
set -o pipefail
AF_URL="https://artifactory.example.com"
BUILD_NAME="gate-test-vulnerable"
BUILD_NUMBER="1"

# Expected: non-zero exit and a policy violation message from the scan,
# so the promotion job (which runs only after a clean scan) stops here
if jf build-scan "${BUILD_NAME}" "${BUILD_NUMBER}"; then
  echo "FAIL: vulnerable build passed the scan"; exit 1
else
  echo "OK: scan failed, promotion job stops here"
fi
```

List active waivers and their expiries; every one must have an owner and an end date:

```bash title="review-waivers.sh"
# Your waiver register is the source of truth; this example reads a CSV exported from it.
awk -F, 'NR>1 && ($3=="" || $4=="") {print "MISSING owner or expiry: " $0}' waivers.csv
```

## References

- JFrog Xray documentation: https://jfrog.com/help/r/jfrog-xray-documentation (verify the policy and watch pages for your version)
- FIRST, CVSS specification: https://www.first.org/cvss/

Related notes:

- [[vulnerability-management-slas]]
- [[policy-exception-and-waiver-process]]
- [[sbom-generation-and-storage]]
- [[jfrog-xray-vs-trivy-vs-grype]]
- [[0004-build-once-promote-between-repositories]]
- [[0039-cyclonedx-as-canonical-sbom-format]]
