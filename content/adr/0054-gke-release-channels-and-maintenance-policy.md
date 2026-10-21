---
title: GKE clusters follow a release channel per environment, with maintenance windows and exclusions
description: Non-prod clusters run on a faster GKE release channel than prod, upgrades happen in business-hours windows, and exclusions are used only for declared freezes.
type: adr
tags:
  - adr
  - gke
  - kubernetes
  - reliability
status: accepted
created: 2026-10-21
modified: 2026-10-21
decided: 2026-10-21
draft: false
aliases:
  - ADR-0054
---

## Context

GKE upgrades control planes and nodes automatically. We have a runbook for the mechanics ([[gke-cluster-upgrade]]) and a pattern for node pool strategies ([[gke-node-pool-upgrade-strategies]]), but no decision on **which pace each cluster follows, when upgrades may happen and how a freeze stops them**. Without that decision the same failures recur:

- **Surprise upgrades.** A cluster with no maintenance window can be upgraded at any hour, including a weekend night, and the first sign is a paging alert from a workload that had no PodDisruptionBudget.
- **The same pace everywhere.** When staging and production follow the same channel, both receive a new minor version within days of each other and staging gives no warning.
- **Freezes that GKE does not know about.** The release freeze in [[change-freezes-and-maintenance-windows]] stops our deploys, but not Google's upgrades.
- **Removed APIs found in production.** A minor upgrade removes a beta API that an old Helm chart still uses, and the failure shows up on the next deploy.
- **Clusters left behind.** A cluster pinned to a static version drifts towards end of support and then has to jump under time pressure.

GKE gives us the controls for all of this: **release channels** (Rapid, Regular, Stable, and Extended, plus the option of none), **recurring maintenance windows**, **maintenance exclusions** with scopes, **upgrade notifications** to Pub/Sub, and **deprecation insights**. The decision is how we use them together.

## Decision

**Every GKE cluster is enrolled in a release channel chosen by environment, upgrades run only in a weekday business-hours window of the owning team, maintenance exclusions are used only for declared freezes and stay inside the documented limits, and every minor upgrade is preceded by a deprecated-API check.**

### Channels

| Environment                           | Channel  | Why                                                                                                   |
| ------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| Dev and stage (non-prod)              | Regular  | Gets new versions before prod, so non-prod is the canary. Regular is also GKE's default channel.      |
| Production                            | Stable   | Receives versions after the faster channels, at the slowest standard pace.                            |
| Sandboxes for testing future versions | Rapid    | Optional and never for anything users depend on: Rapid versions carry no SLA.                         |
| Any cluster that cannot keep pace     | Extended | Only by exception with an owner and an end date. It costs extra during extended support; see pricing. |

- **No cluster is unenrolled** ("no channel"). GKE recommends enrolling every cluster in a release channel (see the release channels page for its current wording on unenrolled clusters), and clusters outside a channel cannot use exclusion scopes other than "no upgrades".
- The canary works only because environments run on separate clusters ([[0053-production-and-non-production-never-share-a-cluster]]). A prod upgrade target that has not yet run in any non-prod cluster of the same fleet is treated as a risk, not blocked automatically: the platform on-call reviews it from the upgrade notification.
- Autopilot clusters ([[0018-gke-autopilot-for-new-clusters]]) follow the same table.

### Maintenance windows

- Every cluster has a **recurring window** inside the owning team's business hours, **Tuesday to Thursday**, so an upgrade problem is seen by people who are at work and not on a Friday. Times are written in UTC, and the `BYDAY` days of the recurrence rule are evaluated in UTC, so teams far from UTC shift the days as well as the hours.
- Non-prod windows come **before** the prod window in the week, so a node upgrade that goes wrong in stage is visible before prod's window opens.
- Windows are long enough to satisfy GKE's minimum availability requirement (see the callout); a window that is too short is rejected by the API.

### Maintenance exclusions

| Situation                                    | Scope                       | Rule                                                                                                  |
| -------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Declared release freeze (peak season, audit) | `no_minor_or_node_upgrades` | Control plane patches still apply. Lasts as long as the freeze, start and end from the freeze notice. |
| A minor version we are not ready for         | `no_minor_upgrades`         | Patches still apply. Tracks a dated plan to fix the blocker; kept short.                              |
| Incident or critical event in progress       | `no_upgrades`               | Blocks everything including security patches. Days, not weeks; never past the documented maximum.     |

- An exclusion is a change: it is added through Terraform with the freeze or incident reference in its name, and removed when the freeze ends.
- `no_upgrades` longer than a few weeks needs the platform lead's approval, because it holds back security patches. GKE's documentation recommends keeping it short and caps it.
- Exclusions do not stop upgrades forever. At the end of support GKE upgrades the cluster regardless, so an exclusion never replaces doing the upgrade.

### Before each minor upgrade

1. **Deprecated APIs.** Check the cluster's deprecation insights in the console or Recommender, and scan rendered manifests in CI against the APIs removed in the target version ([[api-deprecation-policy]]). GKE derives insights from observed API calls, so a chart that is installed rarely can be missed: the insight is a signal, the CI scan is the gate.
2. **Disruption readiness.** Every production Deployment with more than one replica has a PodDisruptionBudget ([[pod-disruption-budgets-for-stateless-services]]), and no PDB allows zero disruptions, which would stall node drains.
3. **Node pool strategy.** Standard node pools use **surge** upgrades for stateless pools and **blue-green** for pools whose workloads need a soak or a quick rollback, as described in [[gke-node-pool-upgrade-strategies]].
4. **Notifications.** Every cluster publishes upgrade notifications to a Pub/Sub topic in its project, routed to the owning team's channel and the platform on-call.

### Configuration

Clusters are configured in Terraform. The block below is the production shape:

```hcl title="gke-maintenance.tf"
resource "google_container_cluster" "apps" {
  # ... name, location, networking as elsewhere ...

  release_channel {
    channel = "STABLE" # "REGULAR" in non-prod
  }

  maintenance_policy {
    recurring_window {
      # Tue-Thu 08:00-14:00 UTC. Dates only anchor the time and duration.
      start_time = "2026-01-06T08:00:00Z"
      end_time   = "2026-01-06T14:00:00Z"
      recurrence = "FREQ=WEEKLY;BYDAY=TU,WE,TH"
    }

    maintenance_exclusion {
      exclusion_name = "freeze-2026-q4-peak"
      start_time     = "2026-11-20T00:00:00Z"
      end_time       = "2026-12-02T00:00:00Z"
      exclusion_options {
        scope = "NO_MINOR_OR_NODE_UPGRADES"
      }
    }
  }

  notification_config {
    pubsub {
      enabled = true
      topic   = google_pubsub_topic.gke_upgrades.id
    }
  }
}
```

The same settings with `gcloud`, for evaluation or an emergency exclusion. `clusters update` accepts one of these groups per command, so they are separate calls:

```bash title="gke-maintenance.sh"
set -o pipefail
PROJECT_ID="app-prod"
CLUSTER="apps-prod-01"
LOCATION="europe-west1"
TOPIC="projects/${PROJECT_ID}/topics/gke-upgrades"   # must be in the cluster's project

gcloud container clusters update "${CLUSTER}" --location "${LOCATION}" --project "${PROJECT_ID}" \
  --release-channel=stable

gcloud container clusters update "${CLUSTER}" --location "${LOCATION}" --project "${PROJECT_ID}" \
  --maintenance-window-start=2026-01-06T08:00:00Z \
  --maintenance-window-end=2026-01-06T14:00:00Z \
  --maintenance-window-recurrence='FREQ=WEEKLY;BYDAY=TU,WE,TH'

gcloud container clusters update "${CLUSTER}" --location "${LOCATION}" --project "${PROJECT_ID}" \
  --add-maintenance-exclusion-name=freeze-2026-q4-peak \
  --add-maintenance-exclusion-start=2026-11-20T00:00:00Z \
  --add-maintenance-exclusion-end=2026-12-02T00:00:00Z \
  --add-maintenance-exclusion-scope=no_minor_or_node_upgrades

gcloud container clusters update "${CLUSTER}" --location "${LOCATION}" --project "${PROJECT_ID}" \
  --notification-config="pubsub=ENABLED,pubsub-topic=${TOPIC}"
```

A cluster managed by Terraform must not be changed with `gcloud` for longer than an emergency: the next apply reverts it. Put the emergency exclusion into code the same day. `gcloud container clusters create-auto` does not take the maintenance window flags, so Autopilot clusters get their window from Terraform or a follow-up `update`.

> [!info] Claims not checked against current docs
> The `gcloud` flags and values above were read from `gcloud --help` (Google Cloud SDK 570.0.0) and the Terraform arguments from the Google provider's resource documentation; Google's online documentation pages could not be opened, so the behaviour below comes from search excerpts of the official pages. Check before relying on: the minimum window availability and the maximum duration of each exclusion scope (no figures are given here on purpose; the current values are on the [maintenance windows and exclusions](https://cloud.google.com/kubernetes-engine/docs/concepts/maintenance-windows-and-exclusions) page); how GKE currently describes clusters outside a release channel; the documented maximum number of exclusions per cluster (sources disagree, so no number is given here); standard and extended support periods and the Extended channel fee; how Autopilot handles windows and exclusions; and the claim that GKE pauses automatic upgrades when it detects use of a removed API.

## Consequences

Easier:

- Upgrades happen when people are at work and in a known order: non-prod, then prod.
- Freezes cover Google's changes too, and every exclusion has a reason and an end date in code.
- Removed APIs are caught in CI before the upgrade rather than in production after it.
- No cluster ends up on an unsupported version by neglect; the channel keeps all of them moving.

Harder or newly required:

- **Prod lags non-prod**, so a fix we want in prod may arrive later. Moving a single cluster to a faster channel for a fix is a change with a review, and it moves back afterwards.
- **The canary is imperfect.** Channels receive versions at different times, so prod may receive a patch version that non-prod never ran. The upgrade notification review is where a human compares them.
- **Window length and frequency are a trade-off.** A narrow window means slow node pool upgrades on large pools; a long one means more hours of possible disruption. Teams with large pools need surge or blue-green settings that fit the window.
- **Exclusions are capped and recommended to stay short.** A long freeze cannot simply block all upgrades; it uses a narrower scope that still lets patches through.

## Alternatives considered

- **No release channel, versions pinned and upgraded by hand.** Full control, but not recommended by GKE, limits exclusion scopes, and in practice leads to clusters drifting towards end of support. Rejected.
- **The same channel everywhere.** Simple, but non-prod and prod receive versions almost together, so there is no canary. Rejected.
- **Extended channel by default.** Longer time on a minor version, but extra cost during extended support, security fixes only in that period, and bigger jumps when the upgrade finally happens. Kept as a per-cluster exception.
- **Rapid for non-prod.** An earlier warning, but no SLA, and versions there may have unresolved issues; teams would spend time on problems prod never sees. Allowed only for dedicated version-testing sandboxes.

## Validation

```bash title="validate-gke-maintenance.sh"
set -o pipefail
PROJECT_ID="app-prod"

# 1. Every cluster, its channel and its maintenance policy. Expected: a channel on every
#    line (STABLE in prod projects, REGULAR in non-prod), and a recurringWindow.
#    Field names are as used in the gke-cluster-upgrade runbook; confirm with --format=json.
gcloud container clusters list --project "${PROJECT_ID}" \
  --format="table(name, location, currentMasterVersion, releaseChannel.channel)"

for c in $(gcloud container clusters list --project "${PROJECT_ID}" --format='value(name,location)' | tr '\t' ','); do
  name="${c%%,*}"; loc="${c##*,}"
  echo "== ${name} (${loc})"
  gcloud container clusters describe "${name}" --location "${loc}" --project "${PROJECT_ID}" \
    --format="yaml(maintenancePolicy, notificationConfig)"
done

# 2. Upgrade status, targets and end-of-support dates for one cluster.
gcloud container clusters get-upgrade-info apps-prod-01 --location europe-west1 --project "${PROJECT_ID}"

# 3. Versions currently offered per channel in a location.
gcloud container get-server-config --location europe-west1 --project "${PROJECT_ID}" --format="yaml(channels)"
```

Also check:

- **Notifications arrive.** A subscription on the topic receives messages; an empty subscription after a known upgrade means the notification config or the topic is wrong.
- **Deprecation insights.** In the console, the cluster's insights list no calls to APIs removed in the next minor version, and the CI manifest scan for that version is green.
- **Exclusions are current.** No exclusion has an end date in the past or a name without a freeze or incident reference.

Troubleshooting: an `update` that fails with a window validation error means the window gives too little maintenance time; widen it rather than splitting it into many short blocks. An upgrade that happened during an exclusion was usually a patch allowed by a narrower scope, or an end-of-support upgrade; check `get-upgrade-info` and the cluster's operations (`gcloud container operations list`).

## References

- Release channels: https://docs.cloud.google.com/kubernetes-engine/docs/concepts/release-channels
- Using release channels: https://docs.cloud.google.com/kubernetes-engine/docs/how-to/release-channels
- About maintenance windows and exclusions: https://docs.cloud.google.com/kubernetes-engine/docs/concepts/maintenance-windows-and-exclusions
- Configure maintenance windows and exclusions: https://docs.cloud.google.com/kubernetes-engine/docs/how-to/maintenance-windows-and-exclusions
- Best practices for upgrading clusters: https://docs.cloud.google.com/kubernetes-engine/docs/best-practices/upgrading-clusters
- Deprecated APIs and deprecation insights: https://docs.cloud.google.com/kubernetes-engine/docs/deprecations
- GKE release schedule: https://docs.cloud.google.com/kubernetes-engine/docs/release-schedule
- GKE versioning and support: https://docs.cloud.google.com/kubernetes-engine/versioning
- Troubleshooting upgrades: https://docs.cloud.google.com/kubernetes-engine/docs/troubleshooting/upgrades
- GKE pricing (Extended channel fee): https://cloud.google.com/kubernetes-engine/pricing

Related notes: [[gke-cluster-upgrade]], [[gke-node-pool-upgrade-strategies]], [[change-freezes-and-maintenance-windows]], [[api-deprecation-policy]], [[pod-disruption-budgets-for-stateless-services]]

Related ADRs: [[0018-gke-autopilot-for-new-clusters]], [[0030-terraform-manages-gcp-infrastructure]], [[0053-production-and-non-production-never-share-a-cluster]]
