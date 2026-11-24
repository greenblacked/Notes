---
title: DAST and application security testing in CI
description: Run ZAP passive scans on every merge request's review app and active scans on a schedule against staging, gate on agreed rules and handle false positives in Git.
type: pattern
tags:
  - patterns
  - security
  - ci-cd
  - gitlab-ci
created: 2026-11-24
modified: 2026-11-24
draft: false
aliases:
  - DAST
---

SAST reads code ([[sonarqube-quality-gates]], [[sonarqube-vs-semgrep-vs-codeql]]) and image scanning reads packages ([[jfrog-xray-vs-trivy-vs-grype]]). Neither sees the running application: missing headers, cookie flags, an exposed debug endpoint, a reflected parameter. DAST tests the deployed app over HTTP. This pattern uses OWASP ZAP's packaged scans, because they are free, scriptable and run from a container.

> [!info] Scope and verification
> ZAP's baseline scan options, exit codes, config format and image names were checked on 2026-11-24 (see Sources). The full and API scan scripts, the rule IDs in the example config and the GitLab job were not run.

## Where each scan runs

| Scan                  | Target                                                      | When                          | Gate                              |
| --------------------- | ----------------------------------------------------------- | ----------------------------- | --------------------------------- |
| Baseline (passive)    | The MR's review app ([[gitlab-review-environments-on-gke]]) | Every MR, after deploy        | Fails the MR on `FAIL` rules only |
| API scan              | The review app's OpenAPI definition                         | Every MR that changes the API | Same rule file                    |
| Full (active attacks) | A dedicated staging environment with test data              | Nightly, and before a release | Opens issues, does not block MRs  |
| Production            | Baseline only, if at all                                    | Weekly                        | Report only                       |

The baseline scan spiders for one minute by default, then runs passive checks only. ZAP's documentation says it runs no active attacks and is meant for CI.

> [!warning] Active scans attack the target
> The full scan sends attack payloads, submits forms and can create, change or delete data. Run it only against an environment you own, with test data and written approval, never against production or a shared environment. Tell the WAF owner first, so [[edge-waf-rate-limiting]] rules do not block the scan or trigger incident alerts.

## The rule file

- Generate the starting file with `-g`, which writes every rule at WARN. The rule IDs then match your ZAP version.
- Promote a few rules to FAIL.
- Every IGNORE line carries a reason and an owner in Git.

The file is rule ID, a tab, then `WARN`, `IGNORE` or `FAIL`. Keep the literal tabs.

```text title=".zap/baseline.conf"
# rule-id	level	(name) -- generated with zap-baseline.py -g, then edited; reasons live in MR history
10020	FAIL	(Missing Anti-clickjacking Header)
10021	FAIL	(X-Content-Type-Options Header Missing)
10035	FAIL	(Strict-Transport-Security Header Not Set)
10038	WARN	(Content Security Policy (CSP) Header Not Set)
10096	IGNORE	(Timestamp Disclosure - Unix)
```

The IDs above are examples; take the real ones from your generated file. Long-lived ignores of real findings go to [[vulnerability-exception-register]], not only to this file.

## GitLab CI job

- The deploy job writes the review URL to a dotenv artifact.
- The scan job reads it.
- The ZAP API is not exposed: the job runs the packaged script inside its own container. ZAP's Docker guide warns that the packaged scans expose the unauthenticated ZAP API to the host they run on, so do not run them on a shared host with open ports.

```yaml title=".gitlab-ci.yml (excerpt)"
stages: [build, deploy, dast]

deploy-review:
  stage: deploy
  # ... your existing review deploy ...
  script:
    - ./deploy-review.sh # change: your deploy; it must print the URL it deployed
    - echo "REVIEW_URL=https://${CI_COMMIT_REF_SLUG}.review.example.com" > deploy.env # change: your review host pattern
  artifacts:
    reports:
      dotenv: deploy.env
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"

dast-baseline:
  stage: dast
  image:
    name: ghcr.io/zaproxy/zaproxy:<tested-version>@sha256:<digest> # pin a tested stable tag by digest
    entrypoint: [""]
  needs: ["deploy-review"]
  variables:
    GIT_DEPTH: "1"
  script:
    - |
      set -u
      mkdir -p /zap/wrk
      cp "$CI_PROJECT_DIR/.zap/baseline.conf" /zap/wrk/baseline.conf
      rc=0
      zap-baseline.py -t "$REVIEW_URL" -c baseline.conf -I -m 2 \
        -r zap-baseline.html -J zap-baseline.json || rc=$?
      cp /zap/wrk/zap-baseline.html /zap/wrk/zap-baseline.json "$CI_PROJECT_DIR/" || true
      # 0 pass, 1 a FAIL rule hit, 2 warnings only (not returned with -I), 3 scan error
      exit "$rc"
  artifacts:
    when: always
    expire_in: 30 days
    paths:
      - zap-baseline.html
      - zap-baseline.json
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

- `-I` stops warnings from failing the job, so only FAIL rules (exit 1) and scan errors (exit 3) block.
- The image runs as the `zap` user. If `cp` into `$CI_PROJECT_DIR` fails with permission denied, see Troubleshooting.

## Authenticated scans

- Use a dedicated test user that has no production data access, and rotate its password.
- Pass the credentials through a masked, protected CI/CD variable read inside a ZAP context file (`-n`) and `-U`. Never put them in the command line or the rule file.
- For review apps behind Cloudflare Access, give the scan a service token ([[cloudflare-access-service-tokens]]), added as a header via the context. Do not open the app to the internet.
- Check the ZAP authentication docs for your version: they were not read for this note.

## False positives and triage

- Triage owner: the service team. AppSec reviews new FAIL promotions.
- A false positive goes to IGNORE with a reason in the MR description.
- A real finding that cannot be fixed now goes to [[vulnerability-exception-register]] with an expiry.
- Use `OUTOFSCOPE` lines for URL paths you never want scanned (for example `/logout`).
- Re-read the full scan report weekly, deduplicated by rule and URL pattern.

## Enforcement

Make the job required with [[gitlab-compliance-frameworks-and-security-policies]], so a project cannot delete it. Report findings alongside the other gates in [[gitlab-ci-pipeline-structure]].

## Verify it works

Deploy a review app that deliberately omits `X-Content-Type-Options`. The job must fail with exit 1 and name rule 10021, or whatever ID your generated file uses. Revert, and the job must pass.

## Troubleshooting

| Symptom                                           | Cause and fix                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Exit 3 immediately                                | Target unreachable from the runner (DNS, Access, NetworkPolicy). Curl the URL from the same job image first.                               |
| Report missing from artifacts                     | `cp` into the project dir was denied for the `zap` user. Run the job with the project dir writable by uid 1000, or copy with `cat > file`. |
| Scan hits the WAF or rate limit                   | Add a skip rule for the scanner's source only in review and staging ([[edge-waf-rate-limiting]]).                                          |
| Same finding on every MR, unrelated to the change | It is a platform default (ingress headers). Fix it once at the ingress, not per app.                                                       |

## Rollback

- Set `allow_failure: true` on `dast-baseline` while a broken rule is fixed. Record it as a waiver in [[policy-exception-and-waiver-process]] with an expiry.
- Removing the job entirely needs the same waiver.

## Not verified

- The `zap-full-scan.py` and `zap-api-scan.py` options.
- ZAP authentication via context files.
- The rule IDs and names in the example.
- Whether `/zap/wrk` exists and is writable in the image when no volume is mounted.
- GitLab dotenv behaviour with `needs`.
- GitLab's own DAST analyser, as an alternative: not compared.

## Related

- [[penetration-testing-gcp-and-gke]]: DAST does not replace it.
- [[secret-scanning-pre-commit-and-ci]]
- [[load-and-performance-testing]]

## Sources

- [ZAP baseline scan](https://zaproxy.org/docs/docker/baseline-scan/): options, one-minute spider, passive only, exit codes 0 to 3, config file format, `ghcr.io/zaproxy/zaproxy:stable`. Read 2026-11-24.
- [ZAP Docker user guide](https://www.zaproxy.org/docs/docker/about/): image names, the `/zap/wrk` mount convention and the warning about the exposed ZAP API. Read 2026-11-24.
