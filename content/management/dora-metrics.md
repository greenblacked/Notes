---
title: DORA metrics for a platform team
description: Definitions of the DORA software delivery metrics, how to measure them from GitLab CI, Jenkins and incident data, and how to avoid gaming them.
type: guide
tags:
  - management
  - delivery
  - ci-cd
  - reliability
created: 2026-10-16
modified: 2026-10-16
draft: false
---

The DORA metrics are the most widely used set of software delivery measures. They are useful for a platform team because they show whether the paths you build make delivery faster and safer. They are harmful when used to rank teams or set targets. This note covers definitions, a practical way to collect them, and the traps.

> [!info] Scope and sources
> Metric names and definitions follow the DORA site pages on [the four keys](https://dora.dev/guides/dora-metrics-four-keys/) and [the history of the metrics](https://dora.dev/insights/dora-metrics-history/). This note is not marked verified and quotes no benchmark numbers. Read the current report for those.

## Definitions

DORA has changed its metric set over time, so check which version a vendor dashboard implements.

- The original four, from 2014: deployment frequency, lead time for changes, mean time to recover, change failure rate.
- In 2023 mean time to recover was renamed and redefined as **failed deployment recovery time**.
- A fifth metric, **reliability**, was introduced in earlier reports as an operational measure alongside the four.
- In 2024 DORA added **deployment rework rate**, the share of deployments that are unplanned and result from a production incident, after finding that change failure rate was acting as a proxy for rework.

| Metric                          | Definition                                                                        | Group       |
| ------------------------------- | --------------------------------------------------------------------------------- | ----------- |
| Deployment frequency            | How often changes are deployed to production                                      | Throughput  |
| Change lead time                | Time from a change being committed to version control to it running in production | Throughput  |
| Failed deployment recovery time | Time to recover from a deployment that fails and needs immediate intervention     | Throughput  |
| Change failure rate             | Share of deployments that need immediate intervention afterwards                  | Instability |
| Deployment rework rate          | Share of deployments that are unplanned and caused by a production incident       | Instability |
| Reliability                     | How well the service meets its stated reliability targets, usually via SLOs       | Operational |

The pairing is the point: speed measures and stability measures together. Optimising only throughput raises failures, and optimising only stability slows delivery.

## Decide the unit first

Before you measure, fix three definitions in writing. Different answers give incomparable numbers.

1. **What is a deployment?** A production release of a service. Pick one event per service per release and ignore staging.
2. **What is a service?** The unit a team owns and deploys independently, usually one repository or one Argo CD application (see [[0001-gitops-with-argocd]]).
3. **What is a failure?** A production deployment followed by a rollback, hotfix, or incident attributed to that change. Make the attribution rule explicit.

## Measuring from GitLab CI

GitLab records deployments for jobs that declare an `environment` with an action. Use that rather than guessing from pipeline names.

```yaml title=".gitlab-ci.yml (deploy job fragment)"
deploy-production:
  stage: deploy
  environment:
    name: production
    deployment_tier: production
  script:
    - ./deploy.sh
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

The deployments API can then list them for a project. Set the variables at the top.

```bash title="Deployment frequency from the GitLab API"
GITLAB_URL="https://gitlab.example.com"
PROJECT_ID="1234"
TOKEN="${GITLAB_TOKEN:?set GITLAB_TOKEN}"
SINCE="2026-09-01T00:00:00Z"
PER_PAGE=100

set -euo pipefail
HEADERS="$(mktemp)"
trap 'rm -f "${HEADERS}"' EXIT

# check the deployments API docs for your GitLab version for filter and ordering requirements on updated_after
page=1
while [ -n "${page}" ]; do
  curl --silent --show-error --fail --header "PRIVATE-TOKEN: ${TOKEN}" \
    --dump-header "${HEADERS}" \
    "${GITLAB_URL}/api/v4/projects/${PROJECT_ID}/deployments?environment=production&status=success&updated_after=${SINCE}&per_page=${PER_PAGE}&page=${page}" \
    | jq -r '.[] | [.id, .created_at, .deployable.commit.id] | @tsv'
  page="$(awk -F': ' 'tolower($1)=="x-next-page" {print $2}' "${HEADERS}" | tr -d '\r')"
done
```

Lead time is the difference between the commit timestamp and the successful deployment timestamp for that commit. GitLab also offers DORA metrics in its analytics, which depend on your edition and settings, so check the current documentation for what is available to you. For pipeline layout that makes events reliable see [[gitlab-ci-pipeline-structure]].

## Measuring from Jenkins

Jenkins does not model deployments natively. Add an explicit event at the end of a successful production job, for example from a shared library step (see [[jenkins-shared-libraries]]) that posts to a metrics store.

```bash title="Emit a deployment event (Jenkins post step)"
EVENTS_URL="https://metrics.example.com/events"
SERVICE="payments-api"
COMMIT_SHA="${GIT_COMMIT:?}"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

curl --silent --fail --header "Content-Type: application/json" \
  --data "{\"type\":\"deployment\",\"service\":\"${SERVICE}\",\"sha\":\"${COMMIT_SHA}\",\"at\":\"${DEPLOYED_AT}\",\"environment\":\"production\"}" \
  "${EVENTS_URL}"
```

Whichever CI you use, send the same event shape to one place (a database or BigQuery table). Then every pipeline, old and new, is measured the same way during a migration (see [[gitlab-ci-vs-jenkins]]).

## Failures and recovery from incident data

Deployment frequency and change lead time come from CI. Change failure rate and deployment rework rate come from incident data. Failed deployment recovery time is grouped with throughput in the table above, but it is measured from incident or failed-deployment records.

- Record in each incident ticket the **service** and the **triggering change** (commit or deployment ID), if there was one.
- Failure rate for a period is deployments linked to an incident, rollback or hotfix, divided by all deployments.
- Recovery time is from the start of customer impact (or the failed deploy) to restored service. Pick one start definition and keep it.
- Make the link part of your process, for example a required field in the postmortem template. See [[blameless-postmortems]] and [[incident-response]].
- Reliability comes from SLOs and error budgets, see [[slo-burn-rate-alerting]].

## Benchmarks

Past annual DORA reports grouped teams into performance tiers (elite, high, medium, low). The groupings, thresholds and even the report format have changed between editions, including in recent years, so check the current report at [dora.dev](https://dora.dev/) before quoting it. The clusters are derived from that year's survey. So:

- Quote the report and year, never a bare number. Read the current one at [dora.dev](https://dora.dev/).
- Use the tiers as a rough compass for direction, not a target to hit.
- Compare a team with its own past, not with another team.
- Survey respondents report their own numbers, and your telemetry will differ in definition.

## Pitfalls (Goodhart's law)

When a measure becomes a target it ceases to be a good measure. Known failure patterns:

- **Splitting deployments** to inflate frequency, for example deploying empty commits.
- **Reclassifying failures** so that change failure rate falls. Protect attribution by having someone outside the team spot-check.
- **Lead time gaming** through moving the start timestamp (squash and re-commit).
- **Ranking teams** against each other, which punishes teams with older systems and encourages hiding incidents.
- **Averages** that hide a long tail. Use medians and percentiles, and look at the distribution.
- **Dashboards without action.** If nothing changes as a result, stop collecting.

Guard rails: measure at team level, use the numbers to start conversations, review them with the team before sharing upward, and keep them out of individual performance reviews. See [[performance-feedback]] for what to use instead.

## Pair with SPACE and DevEx

The metrics above describe the delivery system. They do not describe the people in it.

- **SPACE** (satisfaction and well-being, performance, activity, communication and collaboration, efficiency and flow) says to use several dimensions and never a single metric.
- **DevEx** research focuses on feedback loops, cognitive load and flow state, which are the things a platform team changes.
- Combine DORA numbers with a short developer survey and with on-call load from [[on-call-health]]. A team with excellent frequency and a burned-out on-call rota is not healthy.

Use all of this to inform the platform roadmap in [[platform-team-operating-model]] and the quarterly plan in [[planning-and-prioritization]].
