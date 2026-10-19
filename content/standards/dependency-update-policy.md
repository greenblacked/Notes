---
title: Dependency update and end-of-life policy
description: Update classes, deadlines, auto-merge limits, ownership of majors and end-of-life tracking for base images, CI tools, charts, providers, runtimes and GKE.
type: standard
tags:
  - standards
  - supply-chain
  - security
  - ci-cd
  - reliability
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Dependencies rot in two ways. Known vulnerabilities pile up in versions we have not touched, and whole components pass their end of life while nobody is looking, which turns a routine upgrade into an emergency. This policy sets how fast each kind of update must land, what may merge without a human, who owns a major upgrade, and how we track end-of-life dates for the things we run. The tooling configuration is in [[automated-dependency-updates]]; this note is the policy that configuration implements.

## Scope

Everything our repositories pull in or run on, including:

- container base images and the images used by CI jobs;
- language packages and lock files;
- CI tools, runners, shared templates and pipeline libraries;
- Helm charts (our own dependencies and third-party charts);
- Terraform providers and shared modules ([[terraform-module-standard]]);
- runtimes and operating systems on VMs and nodes;
- GKE control planes and node pools, and the add-ons on them.

## Update classes

| Class         | Definition                                                                            | Example                                            |
| ------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Security fix  | An update that fixes a known vulnerability in something we run                        | A patched base image after a critical CVE          |
| Digest or pin | The same tag now points to a new digest, or a pinned SHA moves with no version change | Rebuilt base image, pinned action SHA              |
| Patch         | `x.y.Z` update                                                                        | A library bug-fix release                          |
| Minor         | `x.Y.0` update                                                                        | A provider minor release with new resources        |
| Major         | `X.0.0` update, or any update documented as breaking                                  | A Helm chart major, a runtime major                |
| EOL-driven    | An update forced because the current version leaves vendor support                    | A runtime or Kubernetes minor reaching end of life |

An update can fall in two classes; the stricter deadline applies. A patch that fixes a critical vulnerability is a security fix.

## Deadlines per class

Security deadlines follow [[vulnerability-management-slas]]; do not restate or shorten them here. The remaining deadlines are **proposed team defaults**, labelled as such, to be tuned after a quarter of measurements.

| Class         | Deadline to merge and deploy (from the update being available)                               |
| ------------- | -------------------------------------------------------------------------------------------- |
| Security fix  | Per the SLA matrix in [[vulnerability-management-slas]]                                      |
| Digest or pin | Within 7 days, automatically (proposed default)                                              |
| Patch         | Within 14 days (proposed default)                                                            |
| Minor         | Within 30 days (proposed default)                                                            |
| Major         | Planned: a decision and an owner within 30 days; delivery by the plan, before EOL (proposed) |
| EOL-driven    | Per the EOL tracking section: plan at 6 months before EOL, act at 3 months (proposed)        |

A missed deadline is visible on the measurement dashboard and is escalated to the owning team's lead. It is not a reason to disable the update bot.

## Auto-merge rules

Automation merges what is cheap to verify and cheap to reverse, and never what changes production behaviour without a person looking at the diff. See the [Renovate automerge concepts](https://docs.renovatebot.com/key-concepts/automerge/).

**May auto-merge after all required checks are green** (all of these must hold):

- patch and digest updates for development dependencies and test tooling;
- patch updates for libraries with a good test suite, in repositories with a required test gate;
- lock-file-only maintenance that does not change a rendered artifact in production.

**Never auto-merge:**

- **majors**, in any ecosystem;
- anything that **changes a Terraform plan** in a production root module, including provider bumps ([[terraform-plan-policy-checks]]), or a rendered production manifest;
- **CI templates, shared libraries and pipeline images**, because they change what every pipeline does;
- **base images of production services**, and golden images, which are rebuilt on a schedule and promoted by the platform;
- GKE versions, node image channels and add-ons;
- anything the update bot marks as a security-sensitive package it cannot classify.

Auto-merge also requires a **minimum release age** so that a release which is yanked or found malicious within days is not adopted instantly, and the age is shorter for security fixes, which are time-critical. The age value is a proposed team default (for example 3 days for ordinary updates); check the current Renovate docs for the option and its behaviour.

```json title="renovate.json (excerpt)"
{
  "extends": ["config:recommended"],
  "minimumReleaseAge": "3 days",
  "packageRules": [
    {
      "matchUpdateTypes": ["patch", "digest"],
      "matchDepTypes": ["devDependencies"],
      "automerge": true
    },
    {
      "matchUpdateTypes": ["major"],
      "automerge": false,
      "addLabels": ["major-update", "needs-owner"]
    },
    {
      "matchManagers": ["terraform", "helmv3", "gitlabci"],
      "automerge": false
    },
    {
      "matchPackageNames": ["registry.example.com/base/**"],
      "automerge": false,
      "addLabels": ["base-image"]
    },
    {
      "vulnerabilityAlerts": { "labels": ["security"], "minimumReleaseAge": null }
    }
  ]
}
```

This excerpt only shows how each policy line maps to a rule. The full configuration (schedules, grouping, presets, runner setup) stays in [[automated-dependency-updates]]. Option names such as `minimumReleaseAge`, `matchManagers` and `vulnerabilityAlerts` change between releases; check the current Renovate docs ([configuration options](https://docs.renovatebot.com/configuration-options/)) before copying.

## Ownership and approval of majors

A major update is a project, not a merge click.

- **Every major gets a named owner** within the decision window: a person or team that will do the upgrade, who is accountable for the date. The `needs-owner` label above surfaces ones without.
- **Approval** comes from the service owner and, where the dependency is shared (a base image, a CI template, a Terraform module), from the platform owner. A shared component gets a deprecation notice for consumers following [[api-deprecation-policy]].
- **The plan** states the target version, the breaking changes found in the release notes, a test plan, the rollout order (dev, stage, prod) and the rollback. For production-affecting majors, use the [[production-change-checklist]].
- **A major that is not worth doing yet** is deferred explicitly: record the reason, the date to revisit and the EOL date, and check it against the tracked list. A silent ignore is how a component reaches EOL unnoticed.

## End-of-life tracking

Keep **one tracked list** in the platform repository of everything with a vendor lifecycle that we run, with the item, our version, the EOL date, the source of that date and an owner.

```yaml title="platform/eol.yaml"
# Review monthly. 'source' is the vendor page; endoflife.date is only a cross-check.
items:
  - item: gke-control-plane
    scope: prod-eu, prod-us
    version: "<current minor, from the cluster>"
    eol: "<date from the GKE release schedule>"
    source: https://cloud.google.com/kubernetes-engine/docs/release-schedule
    owner: team-platform
    plan_by: "<eol minus 6 months>"
    act_by: "<eol minus 3 months>"
    status: on-track
  - item: python-runtime
    scope: orders-api, billing-worker
    version: "3.11"
    eol: "<date from the python.org release page>"
    source: https://devguide.python.org/versions/
    owner: team-orders
    plan_by: "<eol minus 6 months>"
    act_by: "<eol minus 3 months>"
    status: planned
  - item: base-image-debian
    scope: golden images
    version: "<current release>"
    eol: "<date from the Debian release page>"
    source: https://www.debian.org/releases/
    owner: team-platform
    plan_by: "<eol minus 6 months>"
    act_by: "<eol minus 3 months>"
    status: on-track
```

The placeholders are intentional: this note does not state real versions or dates because they change. Fill each entry from the vendor page at the time you add it, and write the date you checked.

- **Plan at 6 months before EOL, act at 3 months.** These thresholds are proposed team defaults. For GKE, node pools and control planes follow the release channel's schedule, and the checks that gate an upgrade are in [[gke-cluster-upgrade]]; version skew rules are in the [Kubernetes version skew policy](https://kubernetes.io/releases/version-skew-policy/) and the [Kubernetes release history](https://kubernetes.io/releases/). Link, do not restate them.
- **[endoflife.date](https://endoflife.date/) is one input, not the source of truth.** It is a convenient aggregator and a good way to find items we forgot, but it can lag or differ from the vendor. **The vendor's page wins.** Record the vendor URL in `source`, and treat any difference as a reason to check the vendor again.
- **Cross-check with the SBOMs.** Component inventories from [[sbom-generation-and-storage]] show what actually ships, so items missing from the list can be found. Vulnerability data from [OSV](https://osv.dev/) helps rank which EOL item is also exposed to known issues.
- **Licence changes are lifecycle events too.** A dependency that changes licence is reviewed under [[open-source-license-compliance]].
- A CI job fails when an item's `act_by` date has passed and its status is not `in-progress` or `done`, and posts a reminder at the `plan_by` date. Review the whole list in the monthly platform review. Overdue items feed the planning in [[tech-debt-management]].

## Measurement

Report monthly to the platform and team leads (all four are proposed measures; adjust after the first quarter):

1. **Open update merge requests and their age**, by class. The median age of patch and minor updates should stay below their deadlines.
2. **Failed updates**: updates that opened and failed CI, grouped by cause. A repeated failure for the same package is a sign the tests or the pin are wrong.
3. **Items within 90 days of EOL**, from `eol.yaml`, with owner and status.
4. **Time from advisory to deployed fix** for security updates, compared with the SLA.

## Exceptions with expiry

An update that cannot meet its deadline (a breaking change with no migration path, a vendor patch not yet released) gets a dated exception: the item, the reason, the compensating control (a network restriction, a WAF rule, a feature flag), the owner and an expiry date. The default maximum is 90 days (a proposed team default), renewable once with a plan. Holding a dependency at an old version or ignoring an update in the bot config requires an exception and a link to it in the config comment. Exceptions for security findings follow [[vulnerability-management-slas]].

## Sources

- [Renovate: Configuration options](https://docs.renovatebot.com/configuration-options/)
- [Renovate: Automerge](https://docs.renovatebot.com/key-concepts/automerge/)
- [endoflife.date](https://endoflife.date/)
- [Kubernetes releases](https://kubernetes.io/releases/)
- [Kubernetes version skew policy](https://kubernetes.io/releases/version-skew-policy/)
- [GKE release schedule](https://cloud.google.com/kubernetes-engine/docs/release-schedule)
- [OSV](https://osv.dev/)

## Related

- [[automated-dependency-updates]]: the Renovate configuration behind this policy.
- [[vulnerability-management-slas]]: deadlines for security fixes.
- [[sbom-generation-and-storage]]: knowing what ships.
- [[open-source-license-compliance]]: licence changes in updates.
- [[gke-cluster-upgrade]]: the upgrade procedure and its checks.
- [[tech-debt-management]]: planning overdue upgrades.
- [[terraform-module-standard]]: provider and module version rules.
