---
title: Error budget policy and release gating
description: A written policy that turns SLO error budgets into tiers, approvals, an exception flow, a CI release gate and a quarterly review.
type: standard
tags:
  - standards
  - reliability
  - delivery
  - gitlab-ci
  - prometheus
created: 2026-10-17
modified: 2026-10-17
draft: false
---

[[slo-burn-rate-alerting]] tells you when the budget is burning. This standard says what the team does about it. Without a written policy, the budget is a graph, and every release decision becomes an argument between the product owner and the person on call. With one, the rule is agreed in advance, when nobody is under pressure.

> [!info] What is and is not checked
> The tier thresholds, approver roles and the CI job below are proposed defaults for you to tune. They are not a regulatory or vendor requirement. The tier wording of the SRE Workbook error budget policy example (its Appendix B) and its URL are not verified here. Compare your policy with the Workbook before you say it follows it. The CI job was not run against a live Prometheus. Prometheus API response shape and your metric names need a test in your own environment.

## Why a written policy

- It moves the decision from "who shouts loudest" to "what the data says".
- It gives the engineering manager a rule to point to when saying no to a launch.
- It protects the team from the opposite failure: freezing everything for a tiny miss.
- It makes reliability work visible in planning (see [[planning-and-prioritization]]).

Both sides must sign it: engineering, product and the director who breaks ties. A policy only the SRE team signed is advice.

## Tiers

The tiers are based on how much of the budget remains in the rolling window. The window is the same one as the SLO, normally 30 days.

| Budget remaining    | Tier      | Allowed changes                                                                     | Approver                                                                                               |
| ------------------- | --------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 25% or more         | Healthy   | All changes, normal release cadence                                                 | Normal code review                                                                                     |
| Under 25%, above 0% | At risk   | Feature releases continue with a canary and a named watcher; risky changes wait     | Service owner for each release                                                                         |
| 0% or less          | Exhausted | Reliability fixes, approved security fixes, rollbacks and incident mitigations only | Service owner and engineering manager for any exception; director only for revenue or contract changes |

"Risky" means High under [[production-change-checklist]]. In the at-risk tier, the team spends the next sprint's first slice on the biggest cause of burn from the last incident reviews (see [[blameless-postmortems]]).

Tier changes are announced in the team channel when the budget crosses a line. Do not rely on someone reading the dashboard.

## Allowed changes and approvals per tier

- **Healthy**: nothing special. The normal rules in [[production-change-checklist]] apply.
- **At risk**: the owner of the service signs off each release in the MR. A canary stage is mandatory (see [[progressive-delivery-argo-rollouts]]). The owner may choose to delay a feature, with a reason in the MR.
- **Exhausted**: the pipeline blocks deploys that are not reliability or security changes. The following still go out:
  - fixes that reduce the cause of burn;
  - security fixes for actively exploited or critical issues, approved by the security lead or on-call lead before the deploy (the review may run in parallel), as in the fast path in [[change-freezes-and-maintenance-windows]]; routine dependency updates wait;
  - rollbacks;
  - mitigations during an active incident, which skip the gate but not the log.

The exhausted tier is not a punishment, and the team does not stop working. It redirects the work.

## Worked example

A service has a 99.9% availability SLO over 30 days.

```text
window            = 30 days x 24 h x 60 min = 43,200 minutes
allowed bad time  = 43,200 x (1 - 0.999)    = 43.2 minutes
incident          = 20 minutes of full outage
budget used       = 20 / 43.2               = 0.463, about 46%
budget remaining  = 100% - 46% = about 54%
```

One 20-minute outage uses about 46% of the budget. The service stays in the healthy tier (54% remaining), but a second similar incident in the same window would take it to about 7%, in the at-risk tier. A third 20-minute outage would overspend it and move the service to exhausted. The numbers assume full outage. A partial outage burns less: if half the requests fail for 20 minutes, the burn is about half.

The budget in "minutes" is a simplification that only works for total outage. Real services are measured in request ratios, which is what the query below does.

## Remaining budget in PromQL

This assumes a counter `http_requests_total` with a `code` label and a `job` label, as in [[slo-burn-rate-alerting]]. Change the job name and the SLO target (0.999) for your service.

```yaml title="slo-budget-rules.yaml"
groups:
  - name: slo-orders-api-budget
    rules:
      # Fraction of the error budget still unspent over 30 days.
      # 1 means untouched, 0 means exhausted, below 0 means overspent.
      - record: slo:error_budget_remaining:ratio30d
        expr: |
          1 - (
            (
              sum(increase(http_requests_total{job="orders-api",code=~"5.."}[30d]))
              /
              sum(increase(http_requests_total{job="orders-api"}[30d]))
            )
            / (1 - 0.999)
          )
        labels: { service: orders-api }
```

A 30-day `increase` over raw metrics is expensive. Compute it from the recorded ratios in [[slo-burn-rate-alerting]] or pre-aggregate if your Prometheus is slow, and check retention covers 30 days. Counter resets are handled by `increase`, but gaps in scraping make the number optimistic.

Show the value on the service dashboard with the two tier lines at 0.25 and 0.

## Exception flow

An exception lets a non-reliability change ship in the exhausted tier. It is rare, written and has an expiry.

1. The requester files the record below in the MR or the change ticket.
2. The service owner and the engineering manager approve. For a change that affects revenue or a contract date, the director approves.
3. The exception is time-limited, normally one release or seven days.
4. The pipeline gets the exception id (see the gate job), and the id is kept in the pipeline log.
5. After expiry, the risk owner reports in the next review whether the budget was hurt.

```markdown title="error-budget-exception.md"
### Error budget exception

- Service:
- Tier at request time and budget remaining:
- Change requested (MR link):
- Reason it cannot wait:
- Risk owner (one named person):
- Approvers (owner, manager, director if needed):
- Expiry (date and time, UTC):
- Rollback plan and stop condition:
- Result (filled in after expiry):
```

An exception that needs renewing twice means the policy, the SLO or the team's capacity is wrong. Raise it in the quarterly review.

## Budget reset and window

Use a rolling window, not a calendar month. A calendar reset invites "wait until the 1st", and a service with a bad end of month gets a free pass for the same fault.

- Budget recovers as old bad minutes leave the window. Do not reset it by hand.
- If an incident was caused by a dependency outside the SLO scope, decide the rules for exclusions in advance (for example, a planned provider maintenance). Write the exclusion list in the policy. Do not exclude after the fact.
- If the SLO itself is changed, record the date and why in the policy history. Changing the SLO to leave the exhausted tier is a visible smell.

## Release gate in CI

The gate is a job that reads the remaining budget and fails a deploy in the exhausted tier, unless the change is marked as a reliability or security fix or has an approved exception. It runs before the deploy job in a GitLab pipeline (see [[gitlab-ci-pipeline-structure]] for the stages).

```yaml title=".gitlab-ci.yml (excerpt)"
variables:
  SERVICE: orders-api
  # Change: your Prometheus API address and the recording rule name.
  PROMETHEUS_URL: https://prometheus.example.com
  BUDGET_QUERY: 'slo:error_budget_remaining:ratio30d{service="orders-api"}'
  # Change: pin an image that has bash, curl, jq and awk, ideally by digest.
  TOOLS_IMAGE: registry.example.com/ci/tools:pinned
  # If the metrics API is unreachable, allow the deploy and warn loudly.
  # Set to "false" if your policy prefers to fail closed.
  ALLOW_ON_GATE_ERROR: "true"

error-budget-gate:
  stage: gate
  image: $TOOLS_IMAGE
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - |
      set -euo pipefail

      # Reliability and rollback commits pass the gate. A security commit passes only
      # with the approval id of the security lead or on-call lead (set through a
      # protected environment approval or a restricted variable). An approved
      # exception passes it too, by id. GitLab revert commits are titled Revert "...".
      case "$CI_COMMIT_TITLE" in
        reliability:*|revert:*|Revert*) echo "Change type allowed in every tier."; exit 0 ;;
        security:*)
          if [ -n "${SECURITY_FIX_APPROVAL_ID:-}" ]; then
            echo "Security fix approval ${SECURITY_FIX_APPROVAL_ID} recorded for this pipeline."
            exit 0
          fi
          echo "Security commit without SECURITY_FIX_APPROVAL_ID: the budget check applies." ;;
      esac
      if [ -n "${ERROR_BUDGET_EXCEPTION_ID:-}" ]; then
        echo "Error budget exception ${ERROR_BUDGET_EXCEPTION_ID} recorded for this pipeline."
        exit 0
      fi

      response="$(curl --silent --show-error --fail --max-time 10 \
        --get "$PROMETHEUS_URL/api/v1/query" \
        --data-urlencode "query=$BUDGET_QUERY")" || response=""
      remaining="$(printf '%s' "$response" | jq -r '.data.result[0].value[1] // empty' 2>/dev/null)" || remaining=""

      if [ -z "$remaining" ]; then
        echo "WARNING: could not read the error budget for $SERVICE."
        [ "$ALLOW_ON_GATE_ERROR" = "true" ] && exit 0
        exit 1
      fi

      echo "Error budget remaining for $SERVICE: $remaining (1 = untouched, 0 = exhausted)"
      if awk -v r="$remaining" 'BEGIN { exit !(r <= 0) }'; then
        echo "Budget exhausted. Only reliability:, approved security: and revert: changes deploy."
        echo "Need an exception? Follow the exception flow and set ERROR_BUDGET_EXCEPTION_ID."
        exit 1
      fi
      if awk -v r="$remaining" 'BEGIN { exit !(r < 0.25) }'; then
        echo "WARNING: at-risk tier. The service owner must sign off this release."
      fi

deploy-production:
  stage: deploy
  needs: [error-budget-gate]
  # ... the real deploy script
```

Know the limits of this gate:

- A commit prefix is a convention, not a proof. Anyone can write `reliability:`. The control is the review: protect the default branch, require an approval, and have the approver check the claim (see [[code-review]]).
- `SECURITY_FIX_APPROVAL_ID` records the security lead's or on-call lead's approval for an actively exploited or critical fix. Set it the same restricted way (or replace it with a protected-environment approval), and keep it in the incident or ticket record.
- `ERROR_BUDGET_EXCEPTION_ID` should be set only by people allowed to run pipelines with variables. Restrict who can do that in GitLab and keep the id in the exception record.
- Fail open or closed is a policy choice. Failing open means a broken monitoring stack does not stop a fix. Failing closed means a monitoring outage blocks every deploy. Write the choice down.
- Check that your `stage: gate` exists in the `stages:` list, and the variable names against your GitLab version.

## Quarterly review

Once a quarter, the owner, product owner and engineering manager meet for 45 minutes:

- budget spent per service and the top causes;
- time spent in each tier, and which releases were blocked or delayed;
- exceptions granted, their results, and any renewals;
- whether each SLO still matches what users need (see [[dora-metrics]] for delivery data to read alongside);
- changes to the policy, with a dated history.

If a service never leaves the healthy tier, its SLO may be too loose. If it lives in the exhausted tier, either the SLO is unrealistic or the team needs reliability capacity. Both are management decisions, and the data is now on the table.

## Relation to change freezes and change management

Two rules decide whether a change can go out: the calendar and the budget.

- [[change-freezes-and-maintenance-windows]] blocks changes by **time** (holidays, launches, maintenance windows). The budget policy blocks by **service health**.
- Both can apply at once. The stricter one wins.
- Both leave the same fast path: security fixes for actively exploited or critical issues (approved by the security lead or on-call lead before the deploy, with the review allowed to run in parallel), rollbacks and incident mitigations go through with a log entry and a review afterwards. If one policy blocked what the other allows, a person would have to guess. They must not contradict each other, so review both when you change either.
- The pipeline evidence for the gate result, exceptions and approvers is useful for audit. See [[change-management-controls-and-pipeline-evidence]].

## Related notes

- [[slo-burn-rate-alerting]] for the alerts that feed this policy.
- [[production-change-checklist]] for risk classes.
- [[dora-metrics]] for delivery metrics.
- [[production-readiness-review]] for the launch gate that sets the first SLO.
