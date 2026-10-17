---
title: Conftest policy gate for rendered Kubernetes manifests
description: Run OPA Conftest in GitLab CI and Jenkins on helm template output so policy violations stop the merge request before Argo CD sees them.
type: pattern
tags:
  - patterns
  - policy-as-code
  - gitlab-ci
  - jenkins
  - helm
created: 2026-10-17
modified: 2026-10-17
draft: false
---

Admission control refuses bad manifests at the last moment, when Argo CD is already trying to sync them. A Conftest gate in CI refuses the same manifests in the merge request, where the author is still looking at the change. This note is for senior DevOps engineers and covers rendering charts per environment, writing and unit-testing Rego policies, wiring the gate into GitLab CI and Jenkins, and versioning the policies. It does not choose the in-cluster engine ([[tools/gatekeeper-vs-kyverno]]) or cover Terraform ([[patterns/terraform-plan-policy-checks]]).

> [!info] Scope and sources
> Written for Conftest and OPA with Rego v1 syntax, Helm 3 and the GitLab CI and Jenkins Kubernetes plugin pipelines described in [[patterns/gitlab-ci-pipeline-structure]] and [[patterns/jenkins-shared-libraries]]. Based on the [Conftest docs](https://www.conftest.dev/) and the [OPA policy testing docs](https://www.openpolicyagent.org/docs/policy-testing).

> [!note] Not verified
> The claims below were written from documentation knowledge and were not checked against a running system or the current docs: Conftest flags and output formats, OPA flags (`opa fmt --fail`, `opa check --strict`), the need for a v1 compatibility flag on older OPA releases, and OCI bundle push support in Artifactory. Check them before relying on them.

## Why test rendered output

The chart and its `values.yaml` files are not what the cluster receives. Templates, per-environment values and `--set` overrides decide the final YAML, and a policy that reads the chart source misses all of that. Conftest evaluates the result of `helm template` (or `kustomize build`) for each environment, so the check sees what Argo CD would apply.

This is a shift-left complement to admission, not a replacement. CI only sees what goes through your pipeline; someone with `kubectl` access, a controller that creates objects, or a chart pulled from elsewhere is only caught by admission. Write each rule once in Rego and, where you use Gatekeeper, run it in both places.

## Repository layout

Keep policies next to nothing else: in their own repository if several services share them (see the versioning section), or in a `policy/` folder at the root of a service repository while you start.

```text
policy/
  k8s/
    deployment.rego
    deployment_test.rego
chart/
  Chart.yaml
  values.yaml
  templates/
environments/
  dev/values.yaml
  stage/values.yaml
  prod/values.yaml
.gitlab-ci.yml
```

## Policies

Conftest runs rules named `deny` (fail), `violation` (fail) and `warn` (pass with a message) in a package you select with `--namespace`. Without `--namespace` it evaluates only the `main` package, which is the most common reason a policy "passes" without checking anything.

```rego title="policy/k8s/deployment.rego"
package k8s.required

import rego.v1

# Kinds that carry a Pod template.
workloads := {"Deployment", "StatefulSet", "DaemonSet"}

# change: your Artifactory host and Docker repository.
allowed_registries := {"artifactory.example.com/docker-prod/"}

pod_spec := input.spec.template.spec if input.kind in workloads

containers contains c if some c in pod_spec.containers

containers contains c if some c in object.get(pod_spec, "initContainers", [])

run_as_non_root(c) if c.securityContext.runAsNonRoot == true

run_as_non_root(_) if pod_spec.securityContext.runAsNonRoot == true

registry_allowed(image) if {
  some prefix in allowed_registries
  startswith(image, prefix)
}

deny contains msg if {
  some c in containers
  not run_as_non_root(c)
  msg := sprintf("%s/%s: container %q must set runAsNonRoot: true", [input.kind, input.metadata.name, c.name])
}

deny contains msg if {
  some c in containers
  not c.resources.limits.memory
  msg := sprintf("%s/%s: container %q has no resources.limits.memory", [input.kind, input.metadata.name, c.name])
}

deny contains msg if {
  some c in containers
  not registry_allowed(c.image)
  msg := sprintf("%s/%s: image %q is not from an allowed registry", [input.kind, input.metadata.name, c.image])
}
```

The memory limit rule follows [[patterns/kubernetes-resource-requests-and-limits]]. Messages name the object and container so a failing job points to the line to fix.

## Testing policies

Policies are code. A rule that never fires looks identical to a rule that works, so every rule gets one accepted and one rejected fixture.

```rego title="policy/k8s/deployment_test.rego"
package k8s.required_test

import rego.v1

import data.k8s.required

good := {
  "kind": "Deployment",
  "metadata": {"name": "api"},
  "spec": {"template": {"spec": {"containers": [{
    "name": "api",
    "image": "artifactory.example.com/docker-prod/api:1.4.2",
    "securityContext": {"runAsNonRoot": true},
    "resources": {"limits": {"memory": "256Mi"}},
  }]}}},
}

bad := {
  "kind": "Deployment",
  "metadata": {"name": "api"},
  "spec": {"template": {"spec": {"containers": [{
    "name": "api",
    "image": "docker.io/library/nginx:latest",
  }]}}},
}

test_good_deployment_is_accepted if {
  count(required.deny) == 0 with input as good
}

test_bad_deployment_is_rejected_three_times if {
  count(required.deny) == 3 with input as bad
}

test_non_workload_is_ignored if {
  count(required.deny) == 0 with input as {"kind": "ConfigMap", "metadata": {"name": "settings"}}
}
```

Run the tests locally with the same command as CI:

```bash
set -euo pipefail

opa test policy --verbose
opa fmt --fail policy
opa check --strict policy
```

`opa fmt --fail` and `opa check --strict` turn formatting drift and unused variables into failures; confirm the flag names for your OPA version. On older OPA releases that default to Rego v0 you may need a v1 compatibility flag for `import rego.v1` files. The example policies use compact one-line rules and nested object literals, so they are only `opa fmt` clean if you format them: run `opa fmt --write policy` on `deployment.rego` and `deployment_test.rego` before committing, or the gate fails on its own policies.

## GitLab job

Render in an image that has Helm, evaluate in an image that has Conftest. Passing the rendered files as artifacts keeps both images small and the policy job independent of the chart toolchain.

```yaml title=".gitlab-ci.yml"
stages:
  - test
  - render
  - policy

variables:
  HELM_IMAGE: "alpine/helm:X.Y.Z" # change: pin an explicit Helm image tag, mirror it in Artifactory
  CONFTEST_IMAGE: "openpolicyagent/conftest:vX.Y.Z" # change: pin an explicit Conftest tag, mirror it in Artifactory
  # change: pin an explicit OPA tag, mirror it in Artifactory. The standard OPA image is static and has no shell,
  # which a GitLab script needs; the -debug variant ships a busybox shell (check the tag name), or use an internal tools image with opa
  OPA_IMAGE: "openpolicyagent/opa:X.Y.Z-debug"
  CHART_NAME: "api" # change: your release name

policy:unit-tests:
  stage: test
  image:
    name: ${OPA_IMAGE}
    entrypoint:
      - ""
  script:
    - opa test policy --verbose
    - opa fmt --fail policy
    - opa check --strict policy

render:manifests:
  stage: render
  image:
    name: ${HELM_IMAGE}
    entrypoint:
      - ""
  parallel:
    matrix:
      - ENVIRONMENT:
          - dev
          - stage
          - prod
  script:
    - mkdir -p rendered
    - >
      helm template "${CHART_NAME}" ./chart
      --namespace "${CHART_NAME}"
      --values chart/values.yaml
      --values "environments/${ENVIRONMENT}/values.yaml"
      > "rendered/${ENVIRONMENT}.yaml"
  artifacts:
    paths:
      - rendered/
    expire_in: 1 day

policy:conftest:
  stage: policy
  image:
    name: ${CONFTEST_IMAGE}
    entrypoint:
      - ""
  script:
    - conftest test rendered/*.yaml --policy policy --namespace k8s.required
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

Rendered manifests contain no secrets when secrets come from a store such as [[patterns/external-secrets-with-secret-manager]], which is one more reason to keep them out of values files. Make `policy:conftest` a required check on the target branch so it cannot be skipped.

## Jenkins stage

The equivalent in a declarative pipeline with the Kubernetes plugin. Both tools run as containers in one agent Pod, sharing the workspace.

```groovy title="Jenkinsfile"
pipeline {
  agent {
    kubernetes {
      yaml '''
        apiVersion: v1
        kind: Pod
        spec:
          containers:
            - name: helm
              image: alpine/helm:X.Y.Z  # change: pin an explicit tag, mirror in Artifactory
              command: ["cat"]
              tty: true
              securityContext:
                allowPrivilegeEscalation: false
                capabilities:
                  drop: ["ALL"]
            - name: conftest
              image: openpolicyagent/conftest:vX.Y.Z  # change: pin an explicit tag, mirror in Artifactory
              command: ["cat"]
              tty: true
              securityContext:
                allowPrivilegeEscalation: false
                capabilities:
                  drop: ["ALL"]
      '''
    }
  }
  environment {
    CHART_NAME = 'api'  // change: your release name
  }
  stages {
    stage('Render') {
      steps {
        container('helm') {
          sh '''
            set -euo pipefail
            mkdir -p rendered
            for env in dev stage prod; do
              helm template "$CHART_NAME" ./chart --namespace "$CHART_NAME" \
                --values chart/values.yaml \
                --values "environments/${env}/values.yaml" > "rendered/${env}.yaml"
            done
          '''
        }
      }
    }
    stage('Policy') {
      steps {
        container('conftest') {
          sh 'conftest test rendered/*.yaml --policy policy --namespace k8s.required'
        }
      }
    }
  }
}
```

The `sh` blocks use `bash`-only options such as `pipefail`; if the images ship only `sh`, drop that option or install bash. Move the two stages into a shared library step ([[patterns/jenkins-shared-libraries]]) once a second repository needs them.

### Exit codes

```bash
set -euo pipefail

# 0  no failures (warn rules do not change the exit code by default)
# 1  at least one deny or violation, the job fails
# The warn rules can be made blocking with the fail-on-warn flag; check the flag name in your Conftest version.
status=0
conftest test rendered/*.yaml --policy policy --namespace k8s.required || status=$?
echo "conftest exit code: ${status}"
exit "${status}"
```

## Versioning and sharing policies

A policy copied into ten repositories drifts in ten ways. Treat policies as a versioned product:

- One repository (for example `platform/policies`) with the `policy/` tree, its tests, and the CI job above. Merge requests need a review from the platform team.
- Release with semantic version tags. A new `deny` rule can break the pipelines of consumers who pin, which is a breaking change: ship a new rule as `warn` in a minor release and promote it to `deny` in the next major release (or document the convention your team chooses and announce it).
- Consumers pin a version and update it by merge request, the same way they update dependencies ([[patterns/automated-dependency-updates]]).
- Distribute either by cloning the tag in CI, or as an OCI artifact. Conftest can publish and pull policy bundles from an OCI registry; whether your Artifactory repository accepts them needs confirming before you design around it.

```bash
set -euo pipefail

POLICY_REGISTRY="artifactory.example.com/docker-policy"  # change: your OCI-capable repository path
POLICY_VERSION="1.4.0"                                   # change: the released policy version

# Publish (in the policy repository's release job)
conftest push "${POLICY_REGISTRY}/k8s-policy:${POLICY_VERSION}" policy

# Consume (in a service pipeline); check the pull syntax in your Conftest version
conftest pull "oci://${POLICY_REGISTRY}/k8s-policy:${POLICY_VERSION}"
conftest test rendered/*.yaml --policy policy --namespace k8s.required
```

Credentials for the registry belong in CI variables, never in the repository.

## Pitfalls

- Missing `--namespace`: only `main` is evaluated, so every custom package silently passes.
- Rendering with the wrong values: run every environment, not just `dev`, because production values are where limits and registries differ.
- CRDs and unknown kinds: rules must ignore kinds they do not understand, as the `pod_spec` guard does; otherwise a `ServiceMonitor` crashes the rule.
- Blocking without an escape: a hard `deny` with no waiver route trains people to disable the job. Define the route first ([[compliance/policy-exception-and-waiver-process]]) and use `warn` for new rules.
- Chart tests overlap: lint and schema checks belong in [[patterns/helm-chart-ci-quality-gates]]; keep Conftest for organisational policy.
- Different logic in CI and in the cluster: if a rule exists in both, the tests here should be the source and the cluster copy generated or reviewed against them ([[tools/gatekeeper-vs-kyverno]]).

## Verify

```bash
set -euo pipefail

# A known bad fixture must fail the gate
conftest test policy/testdata/bad-deployment.yaml --policy policy --namespace k8s.required && {
  echo "gate did not fail on a bad manifest"
  exit 1
}

# The real chart must pass for every environment
for env in dev stage prod; do
  helm template api ./chart --values chart/values.yaml --values "environments/${env}/values.yaml" |
    conftest test - --policy policy --namespace k8s.required
done
```

Create `policy/testdata/bad-deployment.yaml` from the `bad` fixture in the test file. Reading from standard input with `-` is supported by Conftest, but confirm it for your version.

## Related

- [[tools/gatekeeper-vs-kyverno]]: the in-cluster counterpart to this CI gate.
- [[patterns/helm-chart-conventions]]: the values layout this pipeline renders.
- [[patterns/helm-chart-ci-quality-gates]]: lint and schema checks that run alongside this gate.
- [[patterns/gitlab-ci-pipeline-structure]]: where the jobs fit in the pipeline stages.
- [[patterns/jenkins-shared-libraries]]: packaging the Jenkins stages as a shared step.
- [[compliance/policy-exception-and-waiver-process]]: how a violation is waived with an owner and an expiry.
