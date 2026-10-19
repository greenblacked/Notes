---
title: Vendor and licence management for DevOps tools
description: Own, meter and renew Artifactory, SonarQube, GitLab and Jenkins support licences, with usage metering, true-up risk and a tested exit plan.
type: guide
tags:
  - management
  - cost
  - team-process
  - artifactory
  - sonarqube
  - gitlab-ci
  - jenkins
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Licences fail quietly. A renewal email goes to a mailbox nobody reads, usage grows past the licensed metric, and the first sign is an invoice or a locked-down instance. The fix is not clever tooling; it is an owner for every licence, a number that is measured on a schedule, a renewal calendar that starts early, and an exit plan that has been rehearsed.

> [!info] Scope
> The renewal register and the cost lines live in [[engineering-budget-planning]]. This note covers the mechanics around it: metering, true-up risk, negotiation inputs and exit. Whether to buy at all is in [[build-vs-buy-devops-tools]]. Open-source licence obligations of the code you ship are a separate subject, see [[open-source-license-compliance]]; this note is about commercial licences and support contracts for the tools you run.

## Why every licence needs an owner

Name one person, not a team, for each tool. The owner:

- knows the licence metric and the current usage;
- receives vendor communication (use a shared alias that forwards to the owner and a deputy);
- puts the renewal date and decide-by date in the calendar;
- writes the exit plan and checks it is current;
- reports once a quarter, see [[quarterly-engineering-review]].

Without an owner, the vendor sets the agenda, usually at the end of the notice period.

## Inventory: licence unit and metric per tool

List the metric the vendor charges on, because that is what you meter. Metrics differ and change between editions and over time, so treat every cell below as something to confirm in the contract and the vendor's current terms.

| Tool                   | Licence metric type (check the vendor's current terms) | Owner | Renewal date | Decide-by date        |
| ---------------------- | ------------------------------------------------------ | ----- | ------------ | --------------------- |
| Artifactory            | Edition or node count, storage or usage                | Name  | YYYY-MM-DD   | Renewal minus 90 days |
| SonarQube              | Lines of code analysed, or edition                     | Name  | YYYY-MM-DD   | Renewal minus 90 days |
| GitLab                 | Seats, tier                                            | Name  | YYYY-MM-DD   | Renewal minus 90 days |
| Jenkins support        | Support contract or distribution subscription, if any  | Name  | YYYY-MM-DD   | Renewal minus 90 days |
| Cloud marketplace item | Usage-based billing through the cloud account          | Name  | Monthly      | Review monthly        |

Keep the register in the repository with the budget data. Include the contract reference, the notice period and where the contract is stored. Do not paste prices, licence keys or contacts' personal details into notes.

## Metering usage

Meter on a schedule (weekly is usually enough) and keep the history so you can show growth at renewal time. The script below collects raw numbers and prints them; send them to your metrics system or a CSV in the real version.

Both endpoints are examples. API paths, response shapes and permissions differ between product versions and editions, so check the current API docs before relying on them. Tokens come from the environment, never from the script, and use read-only credentials where the product allows it.

```bash title="meter-licences.sh"
#!/usr/bin/env bash
# Collect raw licence-related usage numbers. Read-only. Review output before use.
set -euo pipefail

ARTIFACTORY_URL="${ARTIFACTORY_URL:-https://artifacts.example.com}"
SONARQUBE_URL="${SONARQUBE_URL:-https://sonar.example.com}"
OUT_DIR="${OUT_DIR:-./licence-metering}"

# Tokens must be exported in the environment by the caller (CI masked variables).
: "${ARTIFACTORY_TOKEN:?export ARTIFACTORY_TOKEN}"
: "${SONARQUBE_TOKEN:?export SONARQUBE_TOKEN}"

mkdir -p "$OUT_DIR"
stamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Storage summary. Path and required permission: check the current API docs.
curl -fsS \
  -H "Authorization: Bearer ${ARTIFACTORY_TOKEN}" \
  "${ARTIFACTORY_URL}/artifactory/api/storageinfo" \
  >"${OUT_DIR}/artifactory-storageinfo-${stamp}.json"

# Instance status. Path: check the current API docs. This reports
# state and version, not licensed lines of code.
curl -fsS \
  -u "${SONARQUBE_TOKEN}:" \
  "${SONARQUBE_URL}/api/system/status" \
  >"${OUT_DIR}/sonarqube-status-${stamp}.json"

echo "Wrote metering files to ${OUT_DIR} at ${stamp}"
```

For the numbers the vendor actually bills on (for example, lines of code analysed against the licensed amount), use the product's own licence or usage page and its documented API, and record the value with the date. For GitLab seats, use the billable-users view in the admin area or the documented API, and reconcile it against your identity provider so leavers stop consuming seats. In CI, run the script from a scheduled pipeline with masked variables, see [[gitlab-ci-pipeline-structure]].

## Renewal calendar

Work backwards from the notice period in the contract, not from the renewal date.

| When                   | Action                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| Renewal minus 120 days | Owner confirms the metric, the notice period and the decide-by date                            |
| Renewal minus 90 days  | Usage review, growth forecast, alternatives check (is the build vs buy answer still the same?) |
| Renewal minus 60 days  | Draft position agreed with the engineering manager and finance; quotes requested               |
| Renewal minus 30 days  | Decision recorded (renew, resize, replace); procurement raised                                 |
| After renewal          | Update register; set next dates; log the decision in the budget note                           |

If the decide-by date passes, the default becomes renewal on the vendor's terms, which is rarely the best negotiating position.

## True-up and overage risk

A true-up is a charge for usage above what you licensed. Reduce the risk:

1. Know whether your contract uses a hard limit, a soft limit with overage billing, or an audit-and-reconcile clause. Read the clause, and ask the vendor in writing when it is unclear.
2. Alert at a threshold below the limit (for example, when usage passes an internal percentage you choose) rather than at the limit.
3. Reconcile seat-based tools with your identity provider each month; remove inactive users by a written rule.
4. Keep test, staging and developer instances inside the licence terms. A forgotten sandbox may count.
5. Forecast growth from the metering history, and include acquisitions or new teams.

Document who is allowed to commit to additional licences (usually nobody on the platform team; procurement does). A surprise true-up is a governance problem more often than a technical one.

## Negotiation inputs

Bring facts to the renewal:

- metered usage history and the growth forecast;
- actual use of paid features versus available features, to justify a smaller edition or tier;
- incidents and support tickets raised with the vendor, with response times;
- the exit plan and its cost, which shows you have alternatives;
- competing quotes or a cloud-managed alternative, see [[build-vs-buy-devops-tools]];
- the term and payment options that finance prefers.

Do not use this note as a source of prices; vendor pricing changes, so request current quotes.

## Exit plan mechanics

An exit plan that has never been run is a hypothesis. Keep one per tool, short and testable. Taking Artifactory as the example:

1. **Consumer discovery.** Find everything that points at the repository host. Run it against a checkout of all repositories.

```bash title="find-consumers.sh"
#!/usr/bin/env bash
set -euo pipefail

REPO_HOST="artifacts.example.com"
SEARCH_ROOT="${1:?usage: find-consumers.sh <dir-with-repository-checkouts>}"

grep -rIlE "${REPO_HOST//./\\.}" \
  --include='.gitlab-ci.yml' \
  --include='Jenkinsfile*' \
  --include='values*.yaml' \
  --include='*.tf' \
  --include='settings.xml' \
  --include='.npmrc' \
  --include='pip.conf' \
  "${SEARCH_ROOT}" | sort -u
```

2. **Export.** Use the product's documented export or replication mechanism for artifacts and metadata. Time the export on a copy, since duration decides how long a dual-run period lasts.
3. **Checksums.** Record SHA-256 for exported artifacts and compare after import, so you can prove nothing changed.

```bash title="verify-export.sh"
#!/usr/bin/env bash
set -euo pipefail
EXPORT_DIR="${1:?usage: verify-export.sh <export-dir>}"
cd "${EXPORT_DIR}"
find . -type f ! -name 'SHA256SUMS' -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
echo "Wrote $(wc -l < SHA256SUMS) checksums"
# After import into the new system, export again and run: sha256sum -c SHA256SUMS
```

4. **Rehearse.** Once a year, import a sample into the alternative, point one non-critical pipeline at it and time the switch. Record the result in the register.
5. **Rotate.** On final exit, rotate every credential the tool held or issued. See [[leaked-credential-rotation]] for the approach.

SonarQube exit is lighter on artifacts but heavier on history: quality gate definitions, project settings and historical measures. Decide what history you need to keep, see [[sonarqube-quality-gates]]. For retention of what you export, apply [[artifact-retention-policy]].

## Security and access review of vendors

Include vendors in your access reviews:

- who has admin accounts, and are they named individuals with MFA or single sign-on;
- which service accounts and tokens the tool has into your systems, and their scopes;
- where the vendor stores your data (region, subprocessors) and what the contract says on breach notification;
- support access: how a vendor engineer gets into a support session, and who approves it;
- vulnerability handling: how the vendor announces advisories and how fast you can patch.

Run this review at renewal and after any vendor security incident.

## Review cadence

- Weekly: metering job runs; alerts on thresholds.
- Monthly: seat reconciliation against the identity provider.
- Quarterly: owner reports usage, risks and upcoming dates in [[quarterly-engineering-review]]; share outcomes with budget owners using [[stakeholder-communication]].
- Yearly: exit rehearsal and register clean-up.

## Sources

- [JFrog documentation portal](https://jfrog.com/help/): Artifactory administration and REST API. Check the current docs for your edition.
- [SonarQube documentation](https://docs.sonarsource.com/): administration, licensing and web API. Check the current docs for your edition.
- [GitLab documentation](https://docs.gitlab.com/): subscription and user management. Check the current docs.
- [Jenkins LTS downloads and support information](https://www.jenkins.io/download/lts/): release lines. Check the current page.

## Related

- [[engineering-budget-planning]]
- [[artifact-promotion-artifactory]]
- [[artifact-retention-policy]]
- [[sonarqube-quality-gates]]
- [[gitlab-ci-vs-jenkins]]
- [[open-source-license-compliance]]
- [[build-vs-buy-devops-tools]]
- [[stakeholder-communication]]
