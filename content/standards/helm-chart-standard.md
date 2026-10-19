---
title: "Helm chart standard: required rules, versioning and exceptions"
description: Enforceable MUST and SHOULD rules for in-house Helm charts, chart version bump rules, values deprecation, CI enforcement and the exception path.
type: standard
tags:
  - standards
  - helm
  - kubernetes
  - ci-cd
  - delivery
created: 2026-10-19
modified: 2026-10-19
draft: false
---

An in-house Helm chart is an API: other teams set its values, and a change to its defaults changes what runs in their clusters. This standard lists the rules every chart we publish must follow, how the chart version moves when the chart changes, how a value is retired, and which CI check enforces each rule. It states rules only. The how-to (helpers, library charts, hooks, OCI publishing) stays in [[helm-chart-conventions]].

## Scope

Applies to charts we write and publish for internal consumers, whether they live in a monorepo or one repository per chart. It does not apply to third-party charts we consume as dependencies; for those the dependency rules below apply, and updates follow [[dependency-update-policy]].

> [!info] Helm versions
> Behaviour differs between Helm major versions in places (plugin handling, some flags, OCI features). Check the current Helm docs for the major version you run before relying on an exact flag or output in this note.

## MUST rules

A chart that breaks a MUST rule does not merge. Each rule has a check in the enforcement section.

1. **`apiVersion: v2`** in `Chart.yaml`. It is the chart API used by Helm 3 and later and is required for `Chart.lock` and the `dependencies` field.
2. **A `values.schema.json` on every chart.** The schema validates user-supplied values at `helm lint`, `template`, `install` and `upgrade`. It types every value, marks required values, and sets `additionalProperties: false` at the top level so a misspelled key is an error, not a silent no-op. See [Schema files](https://helm.sh/docs/topics/charts/#schema-files).
3. **`app.kubernetes.io/*` labels through helpers.** Every object gets `app.kubernetes.io/name`, `instance`, `version`, `component`, `part-of` and `managed-by` from one helper template, never typed per manifest. The label set is defined in [[kubernetes-labels-and-annotations-standard]].
4. **Selectors use only stable labels** (`name` and `instance`). A version label in a selector is a defect, because selectors are immutable (see bump rules).
5. **No secrets in values or defaults.** `values.yaml` holds no password, token, key or credential URL. Secrets arrive by reference: an existing Secret name, an external-secrets resource, or a CSI mount. A default that looks like a real secret is a finding.
6. **Dependencies pinned to exact versions with a committed `Chart.lock`.** In `Chart.yaml` use `version: 1.2.3`, not `~1.2` or `*`. Commit `Chart.lock` and make CI run `helm dependency build`, which fails if the lock and `Chart.yaml` disagree.
7. **Resources and probes are set** for every workload container, with values that the chart exposes. Requests are mandatory (see ADR [[adr/0021-mandatory-resource-requests]]). Readiness probes are required for anything behind a Service; liveness and startup probes where the process can wedge or starts slowly.
8. **No cluster-scoped objects unless declared.** A chart that creates a `ClusterRole`, `ClusterRoleBinding`, `CustomResourceDefinition`, `Namespace`, `PriorityClass` or webhook configuration says so in `Chart.yaml` annotations and in the README, and the exception is approved. Namespaced charts are the default.
9. **Namespaced, deterministic names.** Names come from a helper with a length cap that respects the 63-character limit on labels and the DNS limits on resource names.
10. **A rendered-output test.** The chart has `ci/*-values.yaml` files that render the supported configurations, and each is validated in CI.

## SHOULD rules

A SHOULD rule needs a sentence of explanation in the merge request when it is not followed.

- Security context defaults: `runAsNonRoot: true`, `readOnlyRootFilesystem: true`, `allowPrivilegeEscalation: false`, capabilities dropped. Allow overrides, but default to the safe value.
- A `PodDisruptionBudget` and a sensible `topologySpreadConstraints` default for workloads with more than one replica.
- A `NOTES.txt` that says what was installed and the first command to verify it.
- A `README.md` generated from the schema and values comments (for example with helm-docs), so documentation does not drift.
- Images referenced by digest where the chart consumer can supply one, with the tag as a fallback in `values.yaml`.
- `values.yaml` comments for every key, including the unit and whether it is safe to change after install.
- Keep templates free of logic that needs a Kubernetes API lookup (`lookup`) unless the chart documents that it is incompatible with `helm template` and GitOps renderers.

```yaml title="Chart.yaml"
apiVersion: v2
name: orders-api
description: Orders API deployment
type: application
version: 3.2.0
appVersion: "1.14.2"
kubeVersion: ">=1.29.0-0"
dependencies:
  - name: common
    version: 2.4.1
    repository: oci://registry.example.com/helm
annotations:
  example.com/owner: team-orders
  example.com/cluster-scoped: "false"
```

The `kubeVersion` constraint is an example. Set it from the cluster versions you actually support, and check the current GKE release schedule rather than copying a number.

## Chart version, appVersion and bump rules

Two version fields exist, and they mean different things.

- **`version`** is the chart's own SemVer. It changes whenever anything in the chart changes: templates, defaults, schema, dependencies. It is the number consumers pin.
- **`appVersion`** is the version of the application the chart deploys by default. It is informational; it does not drive the chart's compatibility.

Bumping `appVersion` alone still requires a chart `version` bump, because the packaged chart differs. Use [SemVer](https://semver.org/) rules on the chart's public interface, which is the set of values, the objects it renders and their names.

| Change                                                                      | Bump           |
| --------------------------------------------------------------------------- | -------------- |
| Typo in a comment or README; no rendered difference                         | patch          |
| Default `appVersion` bump with no template change                           | patch          |
| New optional value with a default that leaves the rendered output unchanged | minor          |
| New optional resource, off by default                                       | minor          |
| Dependency minor or patch update with no rendered change to our objects     | patch or minor |
| **Renamed or removed value**                                                | major          |
| **Changed default that changes the rendered output** of an existing install | major          |
| **Changed selector or `matchLabels`**                                       | major          |
| Renamed rendered object (a Deployment, Service, ConfigMap name)             | major          |
| Raised `kubeVersion` floor                                                  | major          |
| Dependency major update                                                     | major          |

**Selector changes are always a major bump with a migration note.** A Deployment or StatefulSet selector is immutable, so `helm upgrade` fails with `field is immutable`. Consumers must delete and recreate the workload (with the downtime or orphaning that implies) or move to a new object name. The migration note in the changelog states the exact steps and the expected downtime. The rollback options are in [[helm-release-rollback]].

A changed default is breaking even when no value was renamed: a consumer who never set the value gets different behaviour on upgrade. When in doubt, render the chart before and after with the consumer's values and compare.

## Deprecating a value

Never remove a value without a deprecation window. The process:

1. **Add the replacement** and keep the old value working. Mark the old key in `values.yaml` and the schema as deprecated, with the replacement named.
2. **Warn.** Print a line in `NOTES.txt` when the old key is set, or `fail` in a template when the old and new keys conflict:

```yaml title="templates/_deprecations.tpl"
{{- define "orders-api.deprecations" -}}
{{- if .Values.replicas }}
{{- if .Values.replicaCount }}
{{- fail "values: 'replicas' is deprecated and conflicts with 'replicaCount'. Remove 'replicas'." }}
{{- end }}
{{- end }}
{{- end }}
```

A named template runs only when something includes it. Include it from a file that always renders, such as the top of `templates/NOTES.txt` (`NOTES.txt` is rendered on every install and upgrade; check the current Helm docs for how `helm template` treats it):

```yaml title="templates/NOTES.txt"
{{ include "orders-api.deprecations" . }}
orders-api installed. Verify with: kubectl -n {{ .Release.Namespace }} rollout status deploy/{{ .Release.Name }}
```

3. **Release** the deprecation as a minor version, with a changelog line.
4. **Remove** the old value in the next major version, and **no sooner than one minor release after the warning shipped**. The one-minor window is a proposed team default, labelled as such; a longer window is better when consumers are many.
5. Update the schema in the removing release so the old key is rejected with a clear message, because `additionalProperties: false` turns a leftover key into an error at lint time rather than a silent no-op.

## Upgrade test from the last published release

A chart that installs cleanly can still fail to upgrade. CI installs the **last published** chart version into a test namespace, then upgrades to the merge request's version with the same values.

```bash title="scripts/chart-upgrade-test.sh"
#!/usr/bin/env bash
set -Eeuo pipefail

CHART="oci://registry.example.com/helm/orders-api"
NS="chart-test-${CI_JOB_ID:-local}"
LAST="$(helm show chart "$CHART" | awk '/^version:/ {print $2}')"

kubectl create namespace "$NS"
trap 'kubectl delete namespace "$NS" --wait=false' EXIT

helm install orders "$CHART" --version "$LAST" -n "$NS" -f ci/default-values.yaml --wait
helm upgrade --install orders ./charts/orders-api -n "$NS" -f ci/default-values.yaml --dry-run
helm upgrade orders ./charts/orders-api -n "$NS" -f ci/default-values.yaml --wait --atomic
```

The first command in the version lookup assumes the registry returns the newest chart when no version is given; confirm that behaviour for your registry, or resolve the latest tag explicitly. The `--dry-run` line validates the upgrade against the live release without changing it.

For a readable change summary during review, `helm diff upgrade` shows what would change in the cluster. It is a plugin; check its current install source and the project's maintenance status before adding it to a CI image.

```bash title="Review-time diff"
helm diff upgrade orders ./charts/orders-api -n "$NS" -f ci/default-values.yaml
```

## Enforcement in CI

Every rule maps to a check. Rules without a check are enforced in review and listed in the checklist.

| Rule                                        | Check                                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apiVersion: v2`, chart metadata            | `helm lint --strict`                                                                                              |
| Values valid against schema                 | `for f in ci/*-values.yaml; do helm lint --strict . -f "$f"; done` (the schema runs as part of lint and template) |
| Rendered manifests are valid Kubernetes     | `helm template ... \| kubeconform -strict -summary`                                                               |
| Labels, probes, resources, no cluster-scope | `conftest test` on rendered output ([[conftest-policy-gate-for-manifests]])                                       |
| Dependencies pinned and lock in sync        | `helm dependency build` in CI; a diff check that `Chart.lock` has no changes                                      |
| Upgrade works from last release             | `helm upgrade --install --dry-run` and the upgrade test above                                                     |
| Version bumped when the chart changed       | A script comparing `Chart.yaml` `version` with the target branch                                                  |
| No secret-like values                       | Secret scanning ([[secret-scanning-pre-commit-and-ci]])                                                           |

```bash title="CI commands"
helm dependency build charts/orders-api
helm lint --strict charts/orders-api -f charts/orders-api/ci/default-values.yaml
helm template orders charts/orders-api -f charts/orders-api/ci/default-values.yaml \
  | kubeconform -strict -summary -kubernetes-version 1.30.0
helm template orders charts/orders-api -f charts/orders-api/ci/default-values.yaml \
  | conftest test --policy policy/ -
```

Use the Kubernetes version your clusters run for `-kubernetes-version`; `1.30.0` is only an example. Details of the gates, including CRD schemas for kubeconform, are in [[helm-chart-ci-quality-gates]]. `kubeconform` does not know custom resources unless you give it their schemas; see its README at [github.com/yannh/kubeconform](https://github.com/yannh/kubeconform).

## Exceptions and expiry

A chart that must break a MUST rule (for example a chart that installs a CRD and a `ClusterRole` for an operator) records the exception in the chart's README and in the exception register: the rule, the reason, the compensating control, the approver, and an expiry date. The default maximum is 180 days (a proposed team default), after which the record is re-approved or the chart is fixed. A CI job fails on an expired record. Cluster-scoped charts additionally need approval from the platform owners, since they can affect every tenant.

## Reviewer checklist

- [ ] `Chart.yaml` has `apiVersion: v2`, pinned dependencies and a committed `Chart.lock`.
- [ ] `values.schema.json` exists, is strict, and matches `values.yaml`.
- [ ] Labels come from the helper; selectors contain no `version` label.
- [ ] No secret-like default; secrets come in by reference.
- [ ] Resources, probes and security context are set and overridable.
- [ ] No cluster-scoped object, or an approved exception exists.
- [ ] The `version` bump matches the table: a renamed value, changed rendered default or changed selector is a major.
- [ ] A deprecated value has a warning, a replacement and a removal release.
- [ ] A migration note exists for every major bump.
- [ ] The upgrade test from the last release passed.

## Sources

- [Helm: Charts](https://helm.sh/docs/topics/charts/)
- [Helm: Chart best practices](https://helm.sh/docs/chart_best_practices/)
- [Helm: Schema files](https://helm.sh/docs/topics/charts/#schema-files)
- [Semantic Versioning](https://semver.org/)
- [kubeconform](https://github.com/yannh/kubeconform)

## Related

- [[helm-chart-conventions]]: how to build a chart that follows these rules.
- [[helm-chart-ci-quality-gates]]: the CI jobs in detail.
- [[helm-release-rollback]]: rollback when an upgrade fails.
- [[conftest-policy-gate-for-manifests]]: policy checks on rendered output.
- [[code-review]]: review practice for infrastructure code.
- [[release-versioning-and-changelog-automation]]: producing the version and the changelog.
- [[kubernetes-labels-and-annotations-standard]]: the label set the helpers must emit.
