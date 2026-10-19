---
title: Dashboards and alert rules are managed as code in Git
description: Dashboards and alert rules live in the GitOps repo, are reviewed by merge request and applied by Argo CD, and UI edits are exported back.
type: adr
tags:
  - adr
  - observability
  - gitops
  - prometheus
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0046
---

## Context

Dashboards are built by clicking in Grafana and alert rules are edited in whichever UI a team prefers. This leads to predictable problems:

- Nobody can say who changed an alert threshold or why. A paging rule that stopped working has no history.
- Dashboards exist in one environment and not another, and rebuilding a lost Grafana means rebuilding by hand.
- Alert rules are not tested, so syntax errors and bad expressions are found when an incident needs them.
- Teams copy dashboards from each other and drift.

We already deliver cluster state through [[0001-gitops-with-argocd]]. Observability configuration should follow the same path: reviewed in Git, tested in CI, applied by the reconciler.

## Decision

We will **manage dashboards and alert rules as code in the GitOps repository**, reviewed by merge request, validated in CI and applied by Argo CD. The UI is for exploration, not for the source of truth.

- Alert and recording rules are Kubernetes resources: `PrometheusRule` where a Prometheus operator is in use, or the Managed Service for Prometheus `Rules` resource on GKE ([[0042-managed-prometheus-for-application-metrics]]). They sit next to the service's other manifests and are owned by the service team.
- Dashboards are JSON (or generated from a library such as Grafonnet or a similar templating tool) stored in Git and loaded through Grafana provisioning, for example a ConfigMap picked up by a sidecar. The provisioning folder is set to disallow UI edits where practical.
- CI runs `promtool check rules` and a unit test for rules that page (`promtool test rules`), lints dashboard JSON, and runs the manifest policy gate from [[conftest-policy-gate-for-manifests]]. A paging rule without `severity`, `team` and `runbook_url` fails the build, matching [[0045-page-only-on-slo-burn-rate]].
- A person may edit a dashboard in the UI to experiment. To keep the change, they export the JSON and open a merge request. Unexported UI edits are overwritten on the next sync, and that is intended.
- Argo CD reports drift on these resources like any other, and the same rollback applies: revert the commit.
- Shared dashboards (platform overview, SLO views) have named owners and live in a common path. Service dashboards live with the service.

```yaml title="prometheusrule.yaml"
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: checkout-rules
  namespace: payments
  labels:
    team: payments
spec:
  groups:
    - name: checkout-recording
      rules:
        - record: service:http_requests:rate5m
          expr: sum by (service) (rate(http_requests_total[5m]))
```

```yaml title="dashboard-configmap.yaml"
apiVersion: v1
kind: ConfigMap
metadata:
  name: checkout-dashboard
  namespace: payments
  labels:
    grafana_dashboard: "1"
data:
  checkout.json: |
    {"title": "Checkout", "uid": "checkout-overview", "schemaVersion": 39, "panels": []}
```

> [!info] Claims not checked against current docs
> CRD API versions for `PrometheusRule` and the GMP `Rules` resource, the sidecar label convention for Grafana dashboards, the Grafana dashboard `schemaVersion`, and the exact provisioning options for blocking UI edits were not verified. Check the current documentation for the versions you deploy.

## Consequences

Easier:

- Every threshold and panel change has an author, a reviewer and a reason in history.
- Rebuilding Grafana or adding an environment is a sync, not a project.
- Broken rules are caught in CI, before they fail silently in production.
- Reviewers see the alert next to the code it observes.

Harder or newly required:

- Editing dashboards through Git is slower than clicking. The export step has to be easy and documented, or people will keep unmanaged copies.
- Two rule CRDs may exist (operator and GMP). Pick one per cluster and document the mapping.
- Dashboard JSON diffs are noisy. Use stable ordering and small, focused dashboards, and review the rendered result in a preview where possible.
- Drift between a UI-edited dashboard and Git can confuse people who expect their change to persist. Say so in the onboarding material.
- Rule changes are now a deployment: a bad rule merged to the main branch reaches production. Staging environments run the same rules first.

## Alternatives considered

- **UI-managed dashboards and rules.** Fastest to start and what we have, but unreviewed and not reproducible. Rejected.
- **Terraform for dashboards and rules.** Workable through the Grafana provider, but it splits observability from the GitOps path and the review tooling. Kept in mind for Grafana settings and data sources, not for rules.
- **One Grafana per team.** Maximum freedom, little consistency and duplicated operations. Rejected.

## Validation

```bash
set -o pipefail
REPO_DIR="./gitops"

# Rule files parse and pass promtool (extract the spec.groups first if wrapped in a CRD)
for f in $(grep -rl "kind: PrometheusRule" "${REPO_DIR}"); do
  yq '{"groups": .spec.groups}' "$f" > /tmp/rules-check.yaml
  promtool check rules /tmp/rules-check.yaml
done

# Argo CD shows the observability applications Synced and Healthy
argocd app list -o json \
  | jq -r '.[] | select(.metadata.name | test("observability|monitoring")) | "\(.metadata.name) \(.status.sync.status) \(.status.health.status)"'

# Dashboards loaded in the cluster come from ConfigMaps in Git, not from manual edits
kubectl get configmap --all-namespaces -l grafana_dashboard=1
```

## References

- Grafana provisioning: https://grafana.com/docs/grafana/latest/administration/provisioning/
- Prometheus recording and alerting rules: https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/
- Related notes: [[observability-signals-and-dashboards]], [[conftest-policy-gate-for-manifests]]
- Related ADRs: [[0001-gitops-with-argocd]], [[0042-managed-prometheus-for-application-metrics]], [[0045-page-only-on-slo-burn-rate]]
