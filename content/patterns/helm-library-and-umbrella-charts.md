---
title: Helm library charts and umbrella charts
description: Share Helm templates through a library chart, decide when an umbrella chart is justified, and version and test both without value collisions.
type: pattern
tags:
  - patterns
  - helm
  - kubernetes
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Two Helm features answer two different problems. A **library chart** removes copy-pasted templates: forty services all need the same Deployment, Service and probes, and the platform team wants one place to fix them. An **umbrella chart** bundles several charts into one release: useful for a tightly coupled stack, risky for everything else. This note covers both, and why [[helm-chart-conventions]] says "one chart per deployable" and warns against umbrellas as a default.

> [!info] Not checked against live docs
> Helm chart dependency semantics, in particular `import-values`, `alias`, `condition` and `tags`, and OCI repository support in `helm dependency` commands, were not checked against the live docs. Check the Helm documentation for your Helm version and verify behaviour with `helm template` before relying on any value-merging rule below.

## Choosing between them

| Need                                                                                                  | Use                                                    |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Same Deployment/Service/HPA shape across many services                                                | Library chart consumed by app charts                   |
| Each service released and rolled back on its own                                                      | One app chart per service (library inside)             |
| One stack that must be installed and upgraded together (app plus its own cache, or a platform bundle) | Umbrella chart                                         |
| Many independent apps deployed from Git to one cluster                                                | Argo CD app-of-apps or ApplicationSet, not an umbrella |
| Third-party chart with small adjustments                                                              | Wrapper chart with the vendor chart as a dependency    |

Rule of thumb: **share templates with a library chart, not by merging services into an umbrella.** An umbrella couples release cadence, blast radius and rollback: one `helm upgrade` touches every subchart, and `helm rollback` rolls them all back together. See the comparison with Argo CD structures in [[0001-gitops-with-argocd]] and [[gitops-repo-topology-and-promotion]].

## Library charts

A library chart has `type: library`. It contains **named templates** (files starting with `_`) and renders no manifests of its own; it cannot be installed.

```yaml title="platform-lib/Chart.yaml"
apiVersion: v2
name: platform-lib
description: Shared templates for platform workloads
type: library
version: 2.1.0
```

```text title="platform-lib layout"
platform-lib/
  Chart.yaml
  templates/
    _deployment.tpl
    _service.tpl
    _helpers.tpl
```

```yaml title="platform-lib/templates/_deployment.tpl"
{{- define "platform-lib.deployment" -}}
{{- $root := . -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "platform-lib.fullname" $root }}
  labels:
    {{- include "platform-lib.labels" $root | nindent 4 }}
spec:
  replicas: {{ $root.Values.replicaCount | default 2 }}
  selector:
    matchLabels:
      {{- include "platform-lib.selectorLabels" $root | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "platform-lib.selectorLabels" $root | nindent 8 }}
    spec:
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: {{ $root.Chart.Name }}
          image: "{{ $root.Values.image.repository }}@{{ $root.Values.image.digest }}"
          ports:
            - name: http
              containerPort: {{ $root.Values.service.targetPort | default 8080 }}
          readinessProbe:
            httpGet: { path: {{ $root.Values.probes.readiness | default "/ready" }}, port: http }
          resources:
            {{- toYaml $root.Values.resources | nindent 12 }}
{{- end -}}
```

Put the secure defaults (non-root, seccomp, resources required, digest pinning) in the library, so every consumer gets them and the policy checks in [[conftest-policy-gate-for-manifests]] rarely fire.

### Consuming it

```yaml title="payments-api/Chart.yaml"
apiVersion: v2
name: payments-api
version: 0.8.3
appVersion: "1.12.0"
dependencies:
  - name: platform-lib
    version: 2.1.0
    repository: oci://artifactory.example.com/helm-internal-local
```

```yaml title="payments-api/templates/deployment.yaml"
{ { include "platform-lib.deployment" . } }
```

```bash title="resolve and lock"
helm registry login artifactory.example.com
helm dependency update ./payments-api   # resolves, writes Chart.lock, downloads to charts/
helm dependency build ./payments-api    # rebuilds charts/ strictly from Chart.lock (use in CI)
```

Commit `Chart.lock`. Use an exact version in `dependencies` (not a range) for application charts, so builds are reproducible; let [[automated-dependency-updates]] propose bumps. Publish the library as an OCI artifact, as decided in [[0008-helm-charts-as-oci-artifacts]]. Whether `helm dependency` accepts your registry layout depends on the Helm version; check the docs.

## Overridable templates and merging

A consumer often needs a small deviation, for example an extra container or annotation. Two techniques keep the library general without forking it:

1. **Merge helper.** Library templates accept an override dictionary and merge it over the defaults.

```yaml title="platform-lib/templates/_helpers.tpl"
{{- define "platform-lib.mergeOverride" -}}
{{- $base := index . 0 -}}
{{- $override := index . 1 | default dict -}}
{{- toYaml (mergeOverwrite $base $override) -}}
{{- end -}}
```

2. **Explicit values switches.** The library template reads documented values such as `extraContainers`, `podAnnotations` and `extraEnv`, and renders them when set. Go templates cannot test whether a consumer defined a named template, so a values key is the contract. Keep this surface small; a library with many switches becomes a second templating language.

## Umbrella charts

An umbrella chart has no templates of its own (or only glue) and lists subcharts under `dependencies`.

```yaml title="shop-stack/Chart.yaml"
apiVersion: v2
name: shop-stack
version: 1.4.0
dependencies:
  - name: payments-api
    version: 0.8.3
    repository: oci://artifactory.example.com/helm-internal-local
    condition: payments-api.enabled
    tags: [backend]
  - name: orders-api
    version: 0.5.1
    repository: oci://artifactory.example.com/helm-internal-local
    condition: orders-api.enabled
    tags: [backend]
  - name: cache
    alias: orders-cache
    version: 1.3.0
    repository: oci://artifactory.example.com/helm-internal-local
    condition: orders-cache.enabled
```

- `condition` enables a subchart from a values path. `tags` turns several on or off together.
- `alias` lets the same chart appear twice with different values (two caches).
- `import-values` pulls selected values from a subchart into the parent. Its parent/child semantics are easy to get wrong; check the docs and test with `helm template`.
- Values for subcharts live under the subchart's name (or alias) key in the parent's `values.yaml`. `global:` values are visible to all subcharts, which is convenient and a common source of collisions.

When an umbrella is justified: the pieces are always deployed together at one version, owned by one team, and have no independent rollback story. When it is not: the pieces have different owners, release rhythms or SLOs. Then use an Argo CD ApplicationSet (one Application per service, as in [[0001-gitops-with-argocd]]) and keep the chart per deployable.

## Testing

Test the library through its consumers, since a library chart renders nothing alone.

```bash title="CI for the library repo"
set -euo pipefail
for c in tests/consumers/*; do
  helm dependency build "$c"
  helm lint "$c" --strict
  helm template test "$c" -f "$c/ci/values.yaml" > "/tmp/$(basename "$c").yaml"
  kubeconform -strict -summary "/tmp/$(basename "$c").yaml"
done
helm unittest tests/consumers/*   # helm-unittest plugin
```

- Keep a few **fixture consumers** that cover the variants: minimal, with HPA, with extra container, with ingress.
- Golden-file snapshots (helm-unittest `matchSnapshot`) make a library change that alters rendered output visible in review.
- Run the same gates as for application charts. See [[helm-chart-ci-quality-gates]].

For an umbrella, additionally render with every `condition` and `tags` combination you support, and test that two subcharts do not emit the same resource name.

## Versioning and upgrade path

- Semver the library. A change in rendered output for existing consumers is breaking (major), including changed defaults, labels and selectors. **Selector labels are immutable on a Deployment**, so changing them in the library forces a delete and recreate.
- Publish the new version, bump consumers through bot merge requests, and review each rendered diff (`helm template` before and after, or `helm diff upgrade`).
- Support the previous major for a stated period. Do not force a flag-day across all services.
- Keep a migration note per major with the exact values that change.

## Failure modes

- **Version drift.** Services pin different library versions, and a bug fix reaches half of them. Track versions per service and automate bumps.
- **Value key collisions.** In an umbrella, a `global.image.tag` or a parent key shadows a subchart default. Namespace your values and avoid `global` for anything non-trivial.
- **Silent re-render of every app.** A library change alters labels, ports or probes and the next release of every consumer shows it. Review diffs on a canary service first.
- **Duplicate resource names** across subcharts (two subcharts both render a ConfigMap `config`). Use `fullname` helpers with the release name.
- **Stale `charts/`.** Local `charts/` out of sync with `Chart.lock`; CI uses `helm dependency build` to prevent it.
- **Hidden coupling.** Consumers override the library's internals through values keys that were never documented. Document the supported interface.

## Rollback

- Per service: `helm rollback <release> <revision>`, then pin the previous library version in `Chart.yaml` and re-lock. See [[helm-release-rollback]].
- Umbrella: a rollback reverts all enabled subcharts together. If one subchart is the problem, disable it with its `condition` and upgrade, or roll back the entire release to a known-good revision.
- Library: do not delete published versions. Publish a fixed patch and bump consumers; consumers pinned to the old version keep working.
- Selector-label changes cannot be rolled back in place; the release must be reinstalled or the Deployment recreated. Avoid such changes in the library.

## Related

- [[helm-chart-conventions]]
- [[helm-chart-ci-quality-gates]]
- [[helm-vs-kustomize]]
- [[helm-release-rollback]]
- [[0001-gitops-with-argocd]]
- [[0008-helm-charts-as-oci-artifacts]]
- [[gitops-repo-topology-and-promotion]]

## Sources

- https://helm.sh/docs/topics/library_charts/
- https://helm.sh/docs/topics/charts/#chart-dependencies
- https://helm.sh/docs/helm/helm_dependency/
