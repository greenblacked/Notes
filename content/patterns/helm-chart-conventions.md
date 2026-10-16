---
title: Helm chart conventions
description: Conventions for in-house Helm charts covering layout, values schema, labels, probes, optional PDB and HPA, secrets, versioning, testing and publishing.
type: pattern
tags:
  - patterns
  - helm
  - kubernetes
  - ci-cd
created: 2026-10-16
modified: 2026-10-16
draft: false
---

These are the conventions for charts we write ourselves. The aim is that a chart for any service looks the same, installs safely with defaults, fails fast on bad values, and can be reviewed by someone who has never seen it. The Helm documentation at helm.sh ("Chart Best Practices") is the baseline; this note records the choices on top of it.

For when to use Helm at all versus Kustomize, see [[helm-vs-kustomize]]. For applying charts through Git, see [[0001-gitops-with-argocd]].

## Chart layout

```text
my-service/
  Chart.yaml
  values.yaml
  values.schema.json
  values-staging.yaml        # per-environment overrides, kept small
  values-production.yaml
  .helmignore
  templates/
    _helpers.tpl
    configmap.yaml           # rendered app config; feeds the checksum/config annotation
    deployment.yaml
    service.yaml
    serviceaccount.yaml
    ingress.yaml             # behind ingress.enabled
    hpa.yaml                 # behind autoscaling.enabled
    pdb.yaml                 # behind podDisruptionBudget.enabled and more than one replica
    NOTES.txt
    tests/
      test-connection.yaml
  ci/
    default-values.yaml      # values used by chart-testing
```

One chart per deployable. Avoid umbrella charts that bundle unrelated services; they couple release cadence. Keep subchart dependencies in `Chart.yaml` under `dependencies` and commit `Chart.lock`.

## Chart.yaml and versioning

```yaml title="Chart.yaml"
apiVersion: v2
name: my-service
description: Orders API
type: application
version: 0.7.2
appVersion: "1.14.0"
kubeVersion: ">=1.28.0-0"
```

- `version` is the **chart** version, SemVer. Bump it on every change to the chart's templates or defaults, because registries refuse or overwrite duplicates.
- `appVersion` is the version of the **application** it deploys. It is informational. It does not have to change with the chart, and the chart should not need a new release for every application build.
- Do not bake the image tag into the chart for deployments. CI passes it: `--set image.tag=$CI_COMMIT_SHORT_SHA`, or the GitOps tool updates it. `image.tag` defaults to `appVersion` only as a fallback.
- Set `kubeVersion` to the oldest cluster minor you support, written as a constraint.[^kube]

[^kube]: The trailing `-0` in the constraint lets it match managed-cluster versions such as GKE's `1.28.5-gke.1234`.

## Naming and labels

Use the recommended `app.kubernetes.io/*` labels on every resource and put the logic in helpers so templates stay short:

```yaml title="templates/_helpers.tpl"
{{- define "my-service.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "my-service.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "my-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "my-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "my-service.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "my-service.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
```

- Names are truncated to 63 characters because many Kubernetes names are DNS labels.
- **Selector labels are immutable** on a Deployment. Keep them to `name` and `instance` only. Putting `version` or `helm.sh/chart` in a selector makes every chart upgrade fail.
- Add `app.kubernetes.io/component` and `part-of` when a chart ships more than one workload.
- `helm create` generates a scaffold like this; start from it, then delete what you do not need.

## values.yaml and values.schema.json

Document every key with a comment, keep the tree shallow, and make the defaults safe for a small dev install. Then add a JSON Schema so wrong values fail at `helm lint`, `template`, `install` and `upgrade` time instead of producing a broken manifest.

```yaml title="values.yaml"
replicaCount: 2

image:
  repository: registry.example.com/team/my-service
  tag: "" # defaults to .Chart.AppVersion
  pullPolicy: IfNotPresent

resources:
  requests:
    cpu: 100m
    memory: 256Mi
  limits:
    memory: 256Mi

probes:
  readiness:
    path: /ready
    port: http
    periodSeconds: 5
    timeoutSeconds: 2
  liveness:
    path: /healthz
    port: http
    periodSeconds: 10
    timeoutSeconds: 2
  startup:
    path: /healthz
    port: http
    periodSeconds: 5
    failureThreshold: 30 # up to 150 s to start

# Rollout and shutdown defaults, explained in zero-downtime-deployments-kubernetes
terminationGracePeriodSeconds: 60
preStopSleepSeconds: 15
minReadySeconds: 10
strategy:
  rollingUpdate:
    maxSurge: 25%
    maxUnavailable: 0

autoscaling:
  enabled: false
  minReplicas: 2
  maxReplicas: 6
  targetCPUUtilizationPercentage: 70

# Created only when replicaCount > 1 (or autoscaling.minReplicas > 1)
podDisruptionBudget:
  enabled: true
  minAvailable: 1

existingSecret: "" # name of a Secret created outside the chart
```

```json title="values.schema.json"
{
  "$schema": "https://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["image", "resources"],
  "definitions": {
    "probe": {
      "type": "object",
      "required": ["path", "port"],
      "properties": {
        "path": { "type": "string" },
        "port": { "type": ["string", "integer"] }
      }
    }
  },
  "properties": {
    "replicaCount": { "type": "integer", "minimum": 1 },
    "image": {
      "type": "object",
      "required": ["repository"],
      "properties": {
        "repository": { "type": "string", "minLength": 1 },
        "tag": { "type": "string" },
        "pullPolicy": { "enum": ["Always", "IfNotPresent", "Never"] }
      }
    },
    "resources": {
      "type": "object",
      "required": ["requests"],
      "properties": {
        "requests": { "type": "object", "required": ["cpu", "memory"] }
      }
    },
    "probes": {
      "type": "object",
      "properties": {
        "readiness": { "$ref": "#/definitions/probe" },
        "liveness": { "$ref": "#/definitions/probe" },
        "startup": { "$ref": "#/definitions/probe" }
      }
    },
    "terminationGracePeriodSeconds": { "type": "integer", "minimum": 0 },
    "podDisruptionBudget": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean" },
        "minAvailable": { "type": ["integer", "string"] }
      }
    },
    "autoscaling": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean" },
        "minReplicas": { "type": "integer", "minimum": 1 },
        "maxReplicas": { "type": "integer", "minimum": 1 }
      }
    }
  }
}
```

Schema tips: require the keys that have no safe default, constrain enums, and avoid `additionalProperties: false` at the root unless you control every consumer, because subcharts add their own keys.

## Resources, probes, PDB and HPA

- **Resources**: ship defaults, always set requests, and require callers to override per environment. A chart that deploys with no requests produces best-effort Pods. How to size them is in [[kubernetes-resource-requests-and-limits]].
- **Probes**: define readiness and liveness from values; add a startup probe for slow starters. Do not point liveness at a dependency check; see [[zero-downtime-deployments-kubernetes]].
- **PDB and HPA are toggles**, off or on by design. When the HPA is enabled, omit `spec.replicas` from the Deployment, otherwise every `helm upgrade` resets the replica count:

```yaml title="templates/deployment.yaml (excerpt)"
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "my-service.selectorLabels" . | nindent 6 }}
  minReadySeconds: {{ .Values.minReadySeconds }}
  strategy:
    type: RollingUpdate
    rollingUpdate:
      {{- toYaml .Values.strategy.rollingUpdate | nindent 6 }}
  template:
    metadata:
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
      labels:
        {{- include "my-service.labels" . | nindent 8 }}
    spec:
      terminationGracePeriodSeconds: {{ .Values.terminationGracePeriodSeconds }}
      containers:
        - name: {{ .Chart.Name }}
          ports:
            - name: http
              containerPort: 8080
          lifecycle:
            preStop:
              exec:
                command: ["sleep", "{{ .Values.preStopSleepSeconds }}"]
          startupProbe:
            httpGet: { path: {{ .Values.probes.startup.path }}, port: {{ .Values.probes.startup.port }} }
            periodSeconds: {{ .Values.probes.startup.periodSeconds }}
            failureThreshold: {{ .Values.probes.startup.failureThreshold }}
          readinessProbe:
            httpGet: { path: {{ .Values.probes.readiness.path }}, port: {{ .Values.probes.readiness.port }} }
            periodSeconds: {{ .Values.probes.readiness.periodSeconds }}
            timeoutSeconds: {{ .Values.probes.readiness.timeoutSeconds }}
          livenessProbe:
            httpGet: { path: {{ .Values.probes.liveness.path }}, port: {{ .Values.probes.liveness.port }} }
            periodSeconds: {{ .Values.probes.liveness.periodSeconds }}
            timeoutSeconds: {{ .Values.probes.liveness.timeoutSeconds }}
```

The `sleep` preStop needs a `sleep` binary in the image; see [[zero-downtime-deployments-kubernetes]] for distroless alternatives.

- The `checksum/config` annotation rolls the Pods when a ConfigMap rendered by the chart changes.
- A PDB with `minAvailable: 1` on a single-replica Deployment blocks node drains forever. Template it so it is only created when replicas (or `minReplicas`) is greater than one:

```yaml title="templates/pdb.yaml"
{{- if and .Values.podDisruptionBudget.enabled (gt (int (ternary .Values.autoscaling.minReplicas .Values.replicaCount .Values.autoscaling.enabled)) 1) }}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "my-service.fullname" . }}
  labels:
    {{- include "my-service.labels" . | nindent 4 }}
spec:
  minAvailable: {{ .Values.podDisruptionBudget.minAvailable }}
  selector:
    matchLabels:
      {{- include "my-service.selectorLabels" . | nindent 6 }}
{{- end }}
```

## Secrets

Never put secret values in `values.yaml`, `--set`, or CI variables that end up in a release record. Helm stores the rendered values and manifests of each release in a Secret in the cluster, so anything passed in is readable by anyone who can read release Secrets and persists in release history.

- Reference secrets that already exist: `existingSecret` plus `secretKeyRef` or `envFrom`.
- Create them out of band with an operator that syncs from a secret manager; see [[external-secrets-with-secret-manager]].
- If the chart must create a Secret, make it opt-in and for development only.
- Add the check to code review: `grep -ri password values*.yaml` should find nothing real.

## Linting and testing

```bash
CHART=helm/my-service
KUBE_VERSION=1.30.0
VALUES=${CHART}/ci/default-values.yaml

helm lint "${CHART}" --strict -f "${VALUES}"

helm template my-service "${CHART}" -f "${VALUES}" \
  | kubeconform -strict -summary -kubernetes-version "${KUBE_VERSION}"

# chart-testing: lints changed charts, checks version bumps, installs in a cluster
ct lint --config ct.yaml
ct install --config ct.yaml
```

- `helm lint --strict` turns warnings into errors. `helm template` plus `kubeconform` validates the rendered YAML against Kubernetes schemas for the version you target; add a CRD schema source if you ship custom resources.
- Render with each environment's values file in CI so a bad override is found before deploy.
- `ct lint` enforces that `Chart.yaml` `version` is bumped when the chart changes, which stops silent republishing.
- `ct install` and `helm test` need a cluster; use a throwaway kind cluster in CI.
- `helm diff upgrade` (a plugin) shows what a deploy will change; run it in the merge request.

## Publishing

Package once per version and push to a registry. Both options below work with Artifactory; confirm your Artifactory version supports OCI-based Helm repositories before choosing.

```bash
CHART=helm/my-service
REGISTRY=artifactory.example.com
REPO=helm-local
REG_USER="${REG_USER:?}" # supplied by masked CI variables
REG_PASS="${REG_PASS:?}"
VERSION=$(helm show chart "${CHART}" | awk '/^version:/ {print $2}')

helm package "${CHART}" --destination dist/

# OCI
helm registry login "${REGISTRY}" --username "${REG_USER}" --password-stdin <<< "${REG_PASS}"
helm push "dist/my-service-${VERSION}.tgz" "oci://${REGISTRY}/${REPO}"

# Classic HTTP repository (Artifactory Helm repo, upload by PUT)
# the config on stdin keeps the password out of argv
curl --fail --config - <<< "user = \"${REG_USER}:${REG_PASS}\"" \
  -T "dist/my-service-${VERSION}.tgz" \
  "https://${REGISTRY}/artifactory/${REPO}/my-service-${VERSION}.tgz"
```

Treat published chart versions as immutable and disable overwrite on the repository. Consumers then install with `helm install my-service oci://.../my-service --version 0.7.2`, which is the reproducible form. For promotion across repositories, see [[artifact-promotion-artifactory]].

## Verify

- `helm template` renders with the defaults and with a single replica, and in the single-replica case no PDB is produced.
- `ct install` passes against a throwaway cluster.

## Rollback

For a failed release, see [[helm-release-rollback]].

## Checklist

- Selector labels contain only `name` and `instance`.
- `values.schema.json` exists and `helm lint --strict` passes.
- Requests are set; memory limit is set; probes are defined.
- No secret values in the chart; `existingSecret` is supported.
- Chart `version` bumped; `appVersion` correct; changelog line added.
- Rendered with every environment's values and validated with kubeconform.
