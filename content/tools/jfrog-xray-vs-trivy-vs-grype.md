---
title: JFrog Xray vs Trivy vs Grype for image and artefact scanning
description: Where repository scanning, CI image scanning and open-source scanners fit, with gating, SBOM, database caching and false-positive trade-offs.
type: tool
tags:
  - tools
  - artifactory
  - security
  - supply-chain
  - ci-cd
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Vulnerability scanning is not one decision but three: where you scan, what blocks a release, and who owns the findings. JFrog Xray scans inside the artefact repository; Trivy and Grype scan wherever you run them, usually in CI. They complement each other more than they compete.

> [!info] Not checked against current releases
> Scanner versions, flags, licences and prices were not checked when this note was written. Verify flags with `--help` for the version you pin, and check the current docs for licensing.

## Short answer

Scan in CI with an open-source scanner so a build fails early and developers see the result in the merge request. If you run Artifactory, add Xray (or an equivalent) on the repositories so that what is stored and what is pulled is rescanned as the vulnerability database changes. Use SBOMs to connect the two. Do not rely on a single scan at build time: new CVEs appear for images that have not changed.

## Scan points: push, pull, deploy and continuous rescans

| Scan point              | What it catches                                    | Typical tool                        |
| ----------------------- | -------------------------------------------------- | ----------------------------------- |
| Pre-merge / build in CI | Known vulnerabilities in the image you just built  | Trivy, Grype                        |
| On push to the registry | Anything that bypassed CI; consistent policy       | Xray, registry scanner              |
| Continuous rescan       | New CVEs against images already stored or deployed | Xray, scheduled Trivy/Grype on SBOM |
| At pull / deploy        | Blocking a known-bad image from running            | Xray policy, admission controller   |

A CI scan answers "is this build acceptable now". A continuous rescan answers "is anything we run affected today". You need both for long-lived images.

## At a glance

| Concern           | Xray                                         | Trivy                                  | Grype (with Syft)                   |
| ----------------- | -------------------------------------------- | -------------------------------------- | ----------------------------------- |
| Where it runs     | Alongside Artifactory                        | CLI, CI job, Kubernetes operator       | CLI, CI job                         |
| Input             | Repository contents, builds, release bundles | Images, filesystems, repos, SBOMs, IaC | Images, directories, SBOMs          |
| Continuous rescan | Yes, a core feature                          | By re-running, or via an operator      | By re-running against a stored SBOM |
| Policy            | Policies and watches in the UI/API           | Flags, ignore files, Rego policies     | Flags, ignore rules in config       |
| SBOM              | Can export and consume                       | Generates and scans                    | Syft generates, Grype scans         |
| Licence / cost    | Commercial; check the current docs           | Open source; check the licence         | Open source; check the licence      |

## Xray policies and watches on repositories

Xray works with three objects: a **policy** (rules and actions, for example "fail on critical with a fix"), a **watch** (which repositories or builds to apply policies to), and **violations** (the findings). Layout recommendations:

- One watch per maturity level (`docker-dev-local`, `docker-prod-local`) and one for the remote cache, using the naming from [[artifactory-repository-design]].
- Strict policy and a blocking action on production repositories; informative on dev.
- Enable licence checks if you also need [[open-source-license-compliance]] data.
- Route violations to your ticket or chat system, with an owner per repository, or the list will rot.

Xray can block downloads of artefacts with violations; test that on a non-critical repository first, because a blocked base image stops every build that uses it.

## Trivy and Grype in CI (GitLab job and Jenkins stage)

Scan by **digest**, never by a mutable tag. A tag can move between the scan and the deploy, so you would not have scanned what you ship.

```bash title="scan-trivy.sh"
set -euo pipefail
IMAGE="registry.example.com/team/app"
DIGEST="sha256:0000000000000000000000000000000000000000000000000000000000000000" # from the build output

trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 "$IMAGE@$DIGEST"
```

```bash title="scan-grype.sh"
set -euo pipefail
IMAGE="registry.example.com/team/app"
DIGEST="sha256:0000000000000000000000000000000000000000000000000000000000000000"

# Generate the SBOM once, scan the SBOM many times
syft "$IMAGE@$DIGEST" -o cyclonedx-json > sbom.json
grype sbom:./sbom.json --fail-on high
# Or scan the image directly:
grype "$IMAGE@$DIGEST" --fail-on high
```

GitLab CI job:

```yaml title=".gitlab-ci.yml"
scan-image:
  stage: test
  image:
    name: aquasec/trivy:0.0.0 # pin a real version or digest after checking the current release
    entrypoint: [""]
  variables:
    TRIVY_CACHE_DIR: .trivycache
    IMAGE_DIGEST: $CI_REGISTRY_IMAGE@$BUILD_DIGEST # passed from the build job
  cache:
    key: trivy-db
    paths: [.trivycache/]
  script:
    - trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 "$IMAGE_DIGEST"
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

Jenkins stage:

```groovy title="Jenkinsfile"
stage('Scan image') {
  steps {
    sh '''
      set -euo pipefail
      trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 "${IMAGE}@${DIGEST}"
    '''
  }
}
```

The `0.0.0` version above is a placeholder: pin the version you have tested. Pipeline structure conventions are in [[gitlab-ci-pipeline-structure]].

## Vulnerability DB caching, offline mirrors and DB age checks

Scanners download a vulnerability database before every run unless you cache it. At scale that causes slow jobs and, for registries that rate-limit database downloads, failures.

- Cache the database directory between jobs (as in the GitLab `cache` above) and refresh it on a schedule rather than on every job.
- For restricted networks, mirror the database to an internal registry or object store and point the scanner at it. Verify the relevant flags and environment variables (database repository, skip-update, cache directory) with `trivy image --help` and the Grype documentation for your pinned version, as they have changed.
- **Check database age.** A scanner that ran with a three-month-old database reports a clean image that is not clean. Fail the job when the database is older than a threshold (for example a few days), or at least print the age. Grype exposes this through its database status command; check the current docs for the exact subcommand.

## Gating policy and dated exceptions (`.trivyignore`, Grype ignore rules)

Gate on what you can act on: high and critical, with a fix available (`--ignore-unfixed`). Everything else is reported, not blocking.

```text title=".trivyignore"
# CVE-0000-00000 (example id): not reachable, base image fix pending. Owner: team-a. Expires 2026-12-01.
CVE-0000-00000
```

```yaml title=".grype.yaml"
ignore:
  # Example id. Owner: team-a. Expires 2026-12-01. Waiver: WAIVER-123
  - vulnerability: CVE-0000-00000
    package:
      name: example-lib
```

Rules for exceptions:

- Every entry has an owner, a reason, an expiry date and a link to the waiver ticket, following [[policy-exception-and-waiver-process]].
- A scheduled job fails when an expiry date has passed, so exceptions cannot become permanent.
- Prefer fixing the base image over ignoring; most findings disappear with a rebuild.

## Failure modes

- **Scanned a tag, shipped a different image.** Pass the digest from the build job, and verify the same digest is deployed.
- **Stale database, false confidence.** Add the age check.
- **Database download fails.** Rate limiting or blocked egress; use a mirror and a cache.
- **Different scanners disagree.** Each uses different data sources and matching rules. Pick one as the gate, use the other for comparison, and do not fail builds on the union.
- **False positives from OS package backports.** Distributions patch without bumping upstream versions; use scanners' distro-aware data and VEX statements where supported (check the docs).
- **Alert fatigue.** Hundreds of findings with no owner. Gate narrowly and report the rest on a dashboard.

## Licensing and cost (check the current docs)

Trivy and Grype/Syft are open source; check the current licences and any commercial offerings built on them. Xray is a commercial product bundled or priced by JFrog's plans; confirm which plan includes it and any limits on scanned artefacts. The hidden cost of every option is triage time, which usually exceeds licence cost.

## When to choose which

- **Trivy**: one tool for images, filesystems, IaC and SBOMs with a wide ecosystem; a common default for CI.
- **Grype with Syft**: when SBOM-first is the workflow and you want to scan stored SBOMs repeatedly without re-pulling images.
- **Xray**: when Artifactory is your registry and you need continuous rescans, policy at the repository and download-blocking, with one place to see violations.

## Recommendation

Gate in CI with Trivy or Grype using digests, a cached and age-checked database, and dated exceptions. Generate an SBOM at build time and store it with the image (see [[sbom-generation-and-storage]]). If you run Artifactory, enable Xray watches on production repositories for continuous rescanning, and keep its blocking policy narrower than the CI gate until you have measured the impact. Revisit this if you leave Artifactory, or if the cost of Xray exceeds the value of its continuous view; then schedule SBOM rescans with Grype instead. Static code analysis is a separate layer, covered in [[sonarqube-vs-semgrep-vs-codeql]].

## Related

- [[sbom-generation-and-storage]]
- [[policy-exception-and-waiver-process]]
- [[artifactory-repository-design]]
- [[gitlab-ci-pipeline-structure]]
- [[sonarqube-vs-semgrep-vs-codeql]]

## Sources

- [Trivy documentation](https://trivy.dev/) (confirm the current docs home)
- [Grype](https://github.com/anchore/grype)
- [Syft](https://github.com/anchore/syft)
- [JFrog security documentation](https://jfrog.com/help/r/jfrog-security-documentation) (verify the Xray page)
