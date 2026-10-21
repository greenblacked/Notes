---
title: Kubernetes labels, annotations and naming standard
description: Required labels and annotations, object naming, selector immutability, and how cost, ownership and policy tooling rely on them, enforced in CI and admission.
type: standard
tags:
  - standards
  - kubernetes
  - gitops
  - policy-as-code
  - cost
created: 2026-10-19
modified: 2026-10-21
draft: false
---

Labels and names are how everything else finds a Kubernetes object: Services find Pods, dashboards group by team, cost reports allocate spend, policies select workloads and on-call finds an owner. When they are missing or inconsistent, every one of those tools quietly degrades. This standard defines the required labels, what belongs in an annotation instead, the naming rules for common objects, the one label mistake that cannot be undone in place (selector changes), and how we enforce all of it.

## Scope

Applies to every namespaced workload and its supporting objects in clusters we operate, and to the charts and manifests that create them ([[helm-chart-standard]] requires the helpers that emit these labels). Cluster-scoped objects owned by the platform follow the same label set with `part-of: platform`.

> [!info] Check the current docs
> Syntax limits and recommended labels come from the Kubernetes documentation and can be extended. The sources at the end are authoritative; this note quotes them to make rules checkable.

## Required `app.kubernetes.io/*` labels

Use the [recommended labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/) on every workload and on the objects it owns (Service, ConfigMap, ServiceAccount, Ingress or Route, HPA, PDB).

| Label                          | Meaning                                            | Example                  | In selectors?  |
| ------------------------------ | -------------------------------------------------- | ------------------------ | -------------- |
| `app.kubernetes.io/name`       | The application name                               | `orders-api`             | yes            |
| `app.kubernetes.io/instance`   | A unique name for this instance of the application | `orders-api-prod`        | yes            |
| `app.kubernetes.io/version`    | The current version of the application             | `1.14.2`                 | **never**      |
| `app.kubernetes.io/component`  | The component within the architecture              | `api`, `worker`, `cache` | only if stable |
| `app.kubernetes.io/part-of`    | The higher-level application it belongs to         | `orders`                 | no             |
| `app.kubernetes.io/managed-by` | The tool managing the object                       | `Helm`, `argocd`         | no             |

All six are required. `version` changes on every release, so it is a label for humans and dashboards, not for selection.

## Ownership and cost labels

Add three more labels, also required, so that ownership and spend can be answered without asking.

| Label         | Value rule                                                        | Example       |
| ------------- | ----------------------------------------------------------------- | ------------- |
| `team`        | A **team alias**, never a person. It matches the on-call schedule | `team-orders` |
| `cost-center` | The finance code or alias used by the cost reports                | `cc-1042`     |
| `environment` | One of `dev`, `stage`, `prod`                                     | `prod`        |

People change teams; aliases do not. A label with a person's name goes stale in a quarter and becomes a privacy question. These labels are the join key between Kubernetes objects, GKE cost allocation and the guardrails in [[finops-cost-allocation-and-guardrails]].

```yaml title="deployment.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  namespace: orders-prod
  labels:
    app.kubernetes.io/name: orders-api
    app.kubernetes.io/instance: orders-api-prod
    app.kubernetes.io/version: "1.14.2"
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: orders
    app.kubernetes.io/managed-by: Helm
    team: team-orders
    cost-center: cc-1042
    environment: prod
  annotations:
    example.com/runbook: "https://runbooks.example.com/orders-api"
    example.com/owner-channel: "#team-orders"
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: orders-api
      app.kubernetes.io/instance: orders-api-prod
  template:
    metadata:
      labels:
        app.kubernetes.io/name: orders-api
        app.kubernetes.io/instance: orders-api-prod
        app.kubernetes.io/version: "1.14.2"
        app.kubernetes.io/component: api
        app.kubernetes.io/part-of: orders
        team: team-orders
        cost-center: cc-1042
        environment: prod
    spec:
      containers:
        - name: api
          image: registry.example.com/orders/orders-api@sha256:0000000000000000000000000000000000000000000000000000000000000000
```

Labels must also be on the **Pod template**, not only on the Deployment. Cost allocation, network policy and Service selection all read Pod labels. The digest above is a placeholder.

## Labels versus annotations

| Use a label when                                                              | Use an annotation when                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| You need to select, group or filter (`-l`, selectors, policies, cost reports) | The data is descriptive or consumed by one tool                  |
| The value is short and from a small set                                       | The value is long, free text, a URL or JSON                      |
| It identifies who, what or where                                              | It carries a runbook link, a config hint or a controller setting |

Never put **secrets or credential URLs** (a URL with a token or password in it) in either. Labels and annotations are readable by anyone who can read the object, and they appear in events, logs and GitOps diffs. Do not put personal data in them either. Personal contact details belong in the on-call tool, with the object pointing to a team alias.

## Syntax limits

Limits come from the [labels docs](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/); verify them in the current documentation.

- A label key has an optional **prefix** (a DNS subdomain, up to 253 characters, followed by `/`) and a **name** (up to 63 characters).
- The name and the value (up to 63 characters) must start and end with an alphanumeric character and may contain `-`, `_` and `.` between. A value may be empty.
- The prefixes `kubernetes.io/` and `k8s.io/` are reserved for Kubernetes core. Use our own domain prefix (`example.com/`) for custom keys beyond the short ones above.
- Annotation keys follow the same key syntax, but values are arbitrary strings. The total size of all annotations on one object is limited: check the current docs for the number, and keep large payloads in a ConfigMap instead.

A common mistake is a version such as `1.14.2+build.5` as a label value: the `+` is not allowed. Strip or replace it in the helper.

## Object naming

Names are identifiers other systems store. Renaming one is a migration, not an edit.

- **Two name syntaxes exist.** Many objects need a **DNS-1123 label** (lowercase alphanumeric and `-`, up to 63 characters, starting and ending with an alphanumeric). Others, such as most namespaced resource names, accept a **DNS-1123 subdomain** (up to 253 characters, dots allowed). The [object names docs](https://kubernetes.io/docs/concepts/overview/working-with-objects/names/) list which kind needs which; Services, namespaces and Pod hostnames are the usual label cases.
- **Namespace pattern**: `<team-or-product>-<environment>`, for example `orders-prod`. Namespaces follow the tenancy model in ADR [[adr/0019-namespace-per-team-tenancy]]. Do not put the cluster name in the namespace; it is not portable.
- **Workload and Service names** are the application name, the same as `app.kubernetes.io/name`, plus a component suffix only when there are several (`orders-api`, `orders-worker`). Do not put the environment or the version in the name; those are labels and namespaces.
- **ConfigMaps and Secrets** are named `<app>-<purpose>` (`orders-api-config`). A rolling config change uses a hash suffix generated by the tool, not a hand-written version.
- **ServiceAccounts** are named after the workload that uses them (`orders-api`), one per workload, never `default`. Workload Identity bindings key on the namespace and the ServiceAccount name, so a rename breaks cloud access.
- **Why renames break clients.** A Service name is a DNS name that other workloads hard-code; a ConfigMap or Secret name is referenced by Pod specs; a ServiceAccount name appears in IAM bindings and RBAC subjects. Plan a rename as a new object, a migration of clients, then a removal.

## Selector immutability

A Deployment, StatefulSet or DaemonSet `spec.selector` is **immutable** after creation. A Service selector can change, but doing so re-points traffic and is just as dangerous in practice.

- Selectors contain only `app.kubernetes.io/name` and `app.kubernetes.io/instance` (plus `component` when it is stable). **Never put `version`, `release`, a hash or a date in a selector.**
- The Pod template labels must be a superset of the selector.

If a change to the selector is applied, the API server rejects it:

```text title="Failure mode"
The Deployment "orders-api" is invalid: spec.selector: Invalid value:
v1.LabelSelector{MatchLabels:map[string]string{...}}: field is immutable
```

Recovery paths, from safest to riskiest:

1. **Create a new object with a new name** and the new selector, move traffic (Service selector, route weight), then delete the old object. No downtime if you run both during the move. This is the default.
2. **Delete and recreate** the Deployment with `kubectl delete deploy orders-api` then apply. The Pods are terminated, so this is an outage unless another replica set serves traffic. Schedule a window.
3. **Delete with `--cascade=orphan`** and recreate: `kubectl delete deploy orders-api --cascade=orphan`. The ReplicaSets and Pods stay running without an owner, and the recreated Deployment with the new selector adopts only ReplicaSets whose labels match the new selector, so with a changed selector you end up with orphaned Pods that nobody manages and that still receive traffic through any Service that selects them. Use this only with a plan to remove the orphans after the new Deployment is ready, and verify with `kubectl get rs,pods -l <old selector>`.

In Helm, a selector change is a major chart version with a migration note ([[helm-chart-standard]]). Rollback options are in [[helm-release-rollback]].

## GCP labels are a separate system

Google Cloud resource labels (on a project, a node pool, a disk) are not Kubernetes labels. They have **stricter rules**: lowercase letters, digits, underscores and hyphens, with length and count limits, and they cannot contain `/` or `.`, so a key such as `app.kubernetes.io/name` is not valid there. See [Labels overview](https://cloud.google.com/resource-manager/docs/labels-overview) and check the current limits.

For cost reporting, GKE cost allocation can break down cluster spend by Kubernetes namespace and by Kubernetes labels you choose, which appear in the billing export. Enable it on the cluster and decide which keys to export (check the [GKE cost allocation docs](https://cloud.google.com/kubernetes-engine/docs/how-to/cost-allocations) for the current setup and how label keys are mapped). Use short, lowercase keys (`team`, `cost-center`, `environment`) for the Kubernetes cost labels because they are valid in both systems. On the GCP resources (projects, buckets, disks), apply the same `team` and `cost-center` keys through Terraform, with `env` (not `environment`) as the environment key, per [[gcp-resource-naming-and-labels-standard]]; map `environment` to `env` in the billing report query.

## Enforcement

Check in CI first, then at admission. The rollout from audit to enforce follows [[policy-rollout-audit-to-enforce]].

**CI: conftest on rendered manifests** ([[conftest-policy-gate-for-manifests]]).

```rego title="policy/labels.rego"
package main

required_labels := {
  "app.kubernetes.io/name",
  "app.kubernetes.io/instance",
  "app.kubernetes.io/version",
  "app.kubernetes.io/component",
  "app.kubernetes.io/part-of",
  "app.kubernetes.io/managed-by",
  "team",
  "cost-center",
  "environment",
}

workload_kinds := {"Deployment", "StatefulSet", "DaemonSet", "CronJob"}

deny contains msg if {
  workload_kinds[input.kind]
  missing := required_labels - {k | input.metadata.labels[k]}
  count(missing) > 0
  msg := sprintf("%s/%s is missing labels: %v", [input.kind, input.metadata.name, missing])
}

deny contains msg if {
  input.kind in {"Deployment", "StatefulSet", "DaemonSet"}
  input.spec.selector.matchLabels["app.kubernetes.io/version"]
  msg := sprintf("%s/%s: 'version' must not be in the selector (selectors are immutable)", [input.kind, input.metadata.name])
}
```

This uses the Rego v1 syntax (`contains`, `if`). Check the conftest and OPA versions you run, as older versions need the `import rego.v1` form.

**Cluster: Gatekeeper or Kyverno.** Express the same rule as an admission policy, starting in audit (log only), then warn, then enforce. The choice of engine is in [[gatekeeper-vs-kyverno]]. Exempt system namespaces explicitly rather than by omission.

**Finding gaps in a live cluster:**

```bash title="Find workloads with missing labels"
kubectl get deploy,sts,ds -A \
  -L app.kubernetes.io/name,team,cost-center,environment
```

Rows with empty cells are the gaps. To list only objects missing `team`:

```bash
kubectl get deploy,sts,ds -A -l '!team' \
  -o custom-columns=NS:.metadata.namespace,KIND:.kind,NAME:.metadata.name
```

## Migrating existing workloads

1. **Inventory** with the commands above and export the gaps by namespace owner.
2. **Add the metadata labels first** (object `metadata.labels`, annotations), which does not touch selectors or Pods.
3. **Add Pod template labels** in the next rollout. This restarts the Pods, so batch it with a normal release. It does not change the selector, so it is not blocked by immutability.
4. **Leave existing selectors alone.** If an old selector contains `version` or a hash, plan the new-object migration above and do it as its own change, not as part of the labelling work.
5. **Turn on admission in audit mode**, read the violations for a release cycle, then warn and enforce per namespace, with a dated exception for anything that cannot comply.
6. **Report progress** as the share of workloads with all required labels, and cost allocated to a team versus unallocated; see [[gitops-repo-topology-and-promotion]] for where the manifests live.

## Sources

- [Kubernetes: Labels and selectors](https://kubernetes.io/docs/concepts/overview/working-with-objects/labels/)
- [Kubernetes: Recommended labels](https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/)
- [Kubernetes: Annotations](https://kubernetes.io/docs/concepts/overview/working-with-objects/annotations/)
- [Kubernetes: Object names and IDs](https://kubernetes.io/docs/concepts/overview/working-with-objects/names/)
- [Google Cloud: Labels overview](https://cloud.google.com/resource-manager/docs/labels-overview)
- [GKE: Cost allocations](https://cloud.google.com/kubernetes-engine/docs/how-to/cost-allocations)

## Related

- [[helm-chart-conventions]]: the helpers that emit these labels.
- [[conftest-policy-gate-for-manifests]]: running the Rego policy in CI.
- [[gatekeeper-vs-kyverno]]: picking an admission engine.
- [[finops-cost-allocation-and-guardrails]]: how the cost labels are used.
- [[gitops-repo-topology-and-promotion]]: where manifests live and how they are promoted.
- [[policy-rollout-audit-to-enforce]]: introducing the policy safely.
- [[helm-chart-standard]]: chart rules that depend on this label set.
