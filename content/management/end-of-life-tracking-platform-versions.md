---
title: Tracking end-of-life dates for platform software
description: One owned end-of-life calendar for GKE, Kubernetes, Terraform, Jenkins, Chef and other platform tools, with automated checks and an upgrade budget.
type: guide
tags:
  - management
  - reliability
  - kubernetes
  - gke
  - terraform
  - jenkins
  - chef
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Every component in the platform has a date after which it stops receiving security fixes. Kubernetes minor versions, GKE versions, Terraform and provider versions, Jenkins LTS lines, Chef releases, base images and operating systems all expire. When the date is known, upgrading is planned work. When the date is discovered during an incident or an audit, it is an emergency with a deadline someone else chose. This note describes a single calendar, owned and automated, that turns end-of-life into a routine input to planning.

> [!info] No dates in this note
> End-of-life dates change and vary by edition and vendor. This note deliberately contains none. Always take dates from the sources listed in the register and check the current docs.

## Why EOL is a risk

- **Security:** unsupported software stops getting fixes. Known vulnerabilities become permanent.
- **Support:** vendors and cloud providers may refuse support, and managed services may upgrade you automatically.
- **Forced upgrades:** a managed platform (such as GKE) can move clusters to a supported version at its own schedule if you do not. The timing may not suit your release calendar.
- **Compatibility:** skipped versions make the eventual jump larger, and deprecated APIs get removed. Large jumps are the main cause of failed upgrades.
- **Audit:** running unsupported software is a finding in most security reviews, see [[audit-evidence-collection-and-retention]].
- **Cost:** extended support, where it exists, tends to cost more than keeping up. Check the vendor's current terms.

## The EOL register

One table, in one place, with one owner. If it lives in five places it is out of date in five ways.

| Field          | Meaning                                                       |
| -------------- | ------------------------------------------------------------- |
| Component      | Name and role, for example "GKE cluster `prod-eu`"            |
| Version in use | Exactly what runs, and where (cluster, image, pipeline)       |
| EOL date       | From the authoritative source, with the date you last checked |
| Source URL     | The page that states the date                                 |
| Owner          | One named person                                              |
| Upgrade plan   | Target version, window, runbook link                          |
| Status         | ok / planned / at risk (EOL within 90 days) / expired         |

Keep it as a file in the repository (Markdown, YAML or CSV) so changes are reviewed, and render the at-risk rows in the quarterly review, see [[quarterly-engineering-review]].

```yaml title="eol-register.yaml"
- component: GKE cluster prod-eu
  product: kubernetes # slug on endoflife.date; check the exact slug
  cycle: "<minor version in use>"
  eol_source: https://cloud.google.com/kubernetes-engine/docs/release-schedule
  owner: platform-sre
  plan: runbooks/gke-cluster-upgrade
  status: planned
- component: Terraform in CI images
  product: terraform
  cycle: "<minor version in use>"
  eol_source: https://endoflife.date/terraform
  owner: platform-iac
  plan: renovate update, then pipeline rollout
  status: ok
```

## Sources of truth for each tool

Never copy dates from memory or from old tickets. Use the vendor's own pages as the authority, and a community aggregator as a convenience for automation.

| Component                 | Authoritative source                           | Notes                                                                                          |
| ------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Kubernetes                | The upstream release page                      | Upstream support windows differ from managed-service windows.                                  |
| GKE                       | The GKE release schedule page for your channel | Release channels and maintenance policies affect when upgrades happen. Check the current docs. |
| Terraform and providers   | Vendor and provider release notes              | Providers have their own version support; check each.                                          |
| Jenkins                   | The LTS download page and the release lines    | Also track the Java version requirement and plugin compatibility.                              |
| Chef                      | Vendor documentation                           | Check the current support policy for your edition.                                             |
| Operating systems, images | The distribution's lifecycle page              | Include base images in container builds.                                                       |

For GKE specifically, use release channels (rapid, regular, stable) as a policy decision, and note which channel each cluster uses in the register. Which channel suits which environment is a decision for an ADR, not for this note. Plan the work using [[gke-cluster-upgrade]].

## Automating the check

Humans forget; schedules do not. An aggregator such as endoflife.date exposes a JSON API per product. The response shape and product slugs can change, so check the current API documentation before relying on this.

```bash title="eol-check.sh"
#!/usr/bin/env bash
# Fail if any tracked product cycle reaches end-of-life within WARN_DAYS.
# Input lines: "<product-slug> <cycle>", for example "kubernetes 1.30".
# The slugs and cycle strings are examples. Check the API docs for the real ones.
set -euo pipefail

WARN_DAYS="${WARN_DAYS:-90}"
INPUT="${1:?usage: eol-check.sh <tracked.txt>}"
today_s="$(date -u +%s)"
fail=0

while read -r product cycle; do
  [ -z "${product}" ] && continue
  eol="$(curl -fsS "https://endoflife.date/api/${product}.json" \
    | jq -r --arg c "${cycle}" '.[] | select(.cycle == $c) | .eol')"
  if [ -z "${eol}" ] || [ "${eol}" = "null" ]; then
    echo "WARN ${product} ${cycle}: no EOL data found, check the slug and cycle"
    continue
  fi
  if [ "${eol}" = "false" ]; then
    echo "OK   ${product} ${cycle}: no EOL date published"
    continue
  fi
  eol_s="$(date -u -d "${eol}" +%s)"   # GNU date; on macOS use: date -j -f %Y-%m-%d
  days=$(( (eol_s - today_s) / 86400 ))
  if [ "${days}" -le "${WARN_DAYS}" ]; then
    echo "FAIL ${product} ${cycle}: EOL ${eol} (${days} days)"
    fail=1
  else
    echo "OK   ${product} ${cycle}: EOL ${eol} (${days} days)"
  fi
done < "${INPUT}"

exit "${fail}"
```

Run it on a schedule in GitLab CI. A failing scheduled job is visible, and the pipeline failure notification goes to the owner.

```yaml title=".gitlab-ci.yml (excerpt)"
eol-check:
  stage: test
  image: alpine:3.20 # pin a version you have checked; add curl, jq, bash, coreutils
  rules:
    - if: '$CI_PIPELINE_SOURCE == "schedule" && $EOL_CHECK == "true"'
  before_script:
    - apk add --no-cache bash curl jq coreutils
  script:
    - bash ci/eol-check.sh ci/tracked-eol.txt
  allow_failure: false
```

Create the pipeline schedule with a weekly interval and the variable `EOL_CHECK=true`. Pair this with automated update pull requests, see [[automated-dependency-updates]], so that routine version bumps arrive without effort. The automation covers products with published data; keep manual rows for anything it does not know.

## Scheduling upgrades and budgeting capacity

An EOL date is a deadline, and deadlines need capacity. Do the maths once a quarter.

1. List everything with an EOL in the next 12 months, sorted by date.
2. Estimate effort per item: the last upgrade's actual hours is a better estimate than a guess.
3. Add a buffer: upgrades slip when a dependency (a plugin, a provider, an API removal) needs fixing first.
4. Place the work on the roadmap with the EOL date as a fixed constraint, see [[platform-roadmap-multi-quarter]].
5. Reserve an upgrade band in the capacity plan so that routine upgrades do not compete with feature work every time, see [[planning-and-prioritization]].

Treat every upgrade as a production change: pre-checks, a window, post-checks and a rollback, following [[production-change-checklist]]. For cluster upgrades the procedure is in [[gke-cluster-upgrade]].

## Escalation when a date is missed

A missed upgrade date should move through a short, pre-agreed path, not an argument.

- **At 90 days:** the register marks the row at risk; the owner confirms the plan.
- **At 60 days:** if there is no scheduled window, the item goes to the engineering manager.
- **At 30 days:** the risk is reported to stakeholders with the consequence (for example, a forced managed upgrade or a security finding), see [[stakeholder-communication]].
- **After the date:** a documented risk acceptance, signed by an accountable person with an expiry, plus compensating controls such as network isolation. Do not leave an expired component without an owner.

If product teams hold the date up, the dependencies note [[cross-team-dependencies]] describes how to negotiate windows.

## Reporting in the quarterly review

Put a one-slide summary in [[quarterly-engineering-review]]: components at risk within 90 days, components expired with an accepted risk, upgrades completed since last time, and the capacity committed. Trend the count of expired components; it should be zero. The debt behind long-running exceptions belongs in [[tech-debt-management]].

## Failure modes

- **A register nobody owns.** Dates decay. Give it an owner and a quarterly review.
- **Trusting a single aggregator.** Cross-check important dates with the vendor page.
- **Tracking only the headline product.** Plugins, providers, node images and Java runtimes expire too.
- **Planning the upgrade after the date.** Start 90 days ahead.
- **Skipping versions to save effort.** Large jumps fail more often than small ones.
- **No test environment of the same shape.** Rehearse upgrades somewhere that resembles production.
- **Automation that fails silently.** Make the scheduled job fail loudly and route it to the owner.

## Sources

- [endoflife.date](https://endoflife.date/): aggregated lifecycle data and API. Check the current API documentation for the response format and product slugs.
- [Kubernetes releases](https://kubernetes.io/releases/): supported versions upstream. Check the current page.
- [GKE release schedule](https://cloud.google.com/kubernetes-engine/docs/release-schedule): versions and release channels. Check the current docs.
- [Jenkins LTS](https://www.jenkins.io/download/lts/): LTS lines and requirements. Check the current page.
- [Chef documentation](https://docs.chef.io/): product support policy. Check the current docs.

## Related

- [[tech-debt-management]]
- [[gke-cluster-upgrade]]
- [[automated-dependency-updates]]
- [[production-change-checklist]]
- [[planning-and-prioritization]]
- [[quarterly-engineering-review]]
- [[platform-roadmap-multi-quarter]]
