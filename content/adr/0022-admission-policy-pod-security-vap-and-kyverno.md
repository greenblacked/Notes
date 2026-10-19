---
title: Admission control with Pod Security, VAP and Kyverno
description: App namespaces enforce Pod Security restricted, simple checks use built-in VAP, Kyverno handles mutation and image verification; Gatekeeper is not used.
type: adr
tags:
  - adr
  - kubernetes
  - policy-as-code
  - security
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0022
---

## Context

Clusters accepted almost any manifest. Privileged pods, `hostPath` mounts, containers running as root and images from arbitrary registries were all admitted, and the only control was code review of the GitOps repository. PodSecurityPolicy was removed in Kubernetes 1.25, so the old guardrails (where they existed) are gone.

Three built-in or add-on mechanisms now overlap:

- **Pod Security admission** (built in): three profiles, applied per namespace by label.
- **ValidatingAdmissionPolicy (VAP)** (built in, CEL expressions): in-process validation with no webhook to run.
- **Policy engines** such as Kyverno and Gatekeeper: webhooks that can also mutate, generate resources and verify image signatures.

Running two webhook engines doubles the failure modes (timeouts, certificate rotation, `failurePolicy` choices) for little gain. See [[gatekeeper-vs-kyverno]] for the comparison this decision builds on.

## Decision

We layer admission control from the cheapest, most reliable mechanism up:

1. **Pod Security admission, `restricted`, on every application namespace.** Namespaces carry `pod-security.kubernetes.io/enforce`, `audit` and `warn` labels set to `restricted`. `baseline` is allowed only for system namespaces that need it, and the reason is written next to the label in Git.
2. **Built-in ValidatingAdmissionPolicy for simple, stateless checks** (required labels, no `latest` tags, resource requests as in [[0021-mandatory-resource-requests]]). Every policy ships with `validationActions: [Warn, Audit]` first and moves to `Deny` only after the audit period.
3. **Kyverno for what VAP cannot do:** mutation, resource generation (for example the default-deny policy in [[0020-default-deny-network-policies]]) and image signature verification ([[0038-kyverno-verifies-image-signatures-at-admission]]).
4. **One webhook engine: Kyverno.** Gatekeeper is not installed.

```yaml title="namespace.yaml"
apiVersion: v1
kind: Namespace
metadata:
  name: payments-prod
  labels:
    owner: payments
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

```yaml title="vap-no-latest-tag.yaml"
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: disallow-latest-tag
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: ["apps"]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["deployments"]
  validations:
    - expression: >-
        object.spec.template.spec.containers.all(c,
        c.image.contains('@sha256:') ||
        (c.image.split('/')[size(c.image.split('/'))-1].contains(':') &&
        !c.image.endsWith(':latest')))
      message: "Images must use a digest or an explicit non-latest tag."
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: disallow-latest-tag
spec:
  policyName: disallow-latest-tag
  validationActions: [Warn, Audit]
```

Rollout follows [[policy-rollout-audit-to-enforce]]: warn and audit, read the audit annotations and Kyverno reports, fix or exempt, then enforce namespace by namespace. Exemptions are explicit in Git and time-boxed.

> [!info] Claims not checked against current docs
> That VAP is generally available on the GKE version we run, the exact CEL syntax above, and which Pod Security `restricted` rules changed in recent Kubernetes releases. Check the current Kubernetes and GKE release notes before relying on them.

## Consequences

Easier:

- The common failure modes (privileged pods, root containers, host namespaces) are blocked by a built-in feature with no extra component to run.
- Simple policies run in the API server, so they cannot be broken by a dead webhook.
- One engine to upgrade, monitor and explain to teams.

Harder or newly required:

- Kyverno becomes critical for mutation and verification; its `failurePolicy` is a per-policy trade-off between safety (fail closed) and availability (fail open) and must be chosen deliberately.
- Policies are written in two languages (CEL and Kyverno YAML); the rule of thumb is CEL first.
- Some third-party charts do not run under `restricted` and need an exemption or a patched chart.

## Alternatives considered

- **Gatekeeper (OPA).** Mature and expressive, but Rego is another language to maintain and it would duplicate Kyverno's webhook footprint. Rejected as a second engine.
- **Kyverno for everything.** Works, but moves simple checks onto a webhook that VAP evaluates in-process. Rejected for the simple cases.
- **Reviews only, no admission.** The status quo; it does not stop manual `kubectl` changes or a mistaken merge.

## Validation

```bash
set -o pipefail
NS="payments-prod"

# Pod Security labels present on the namespace (expect: restricted)
kubectl get namespace "${NS}" -o jsonpath='{.metadata.labels.pod-security\.kubernetes\.io/enforce}{"\n"}'

# Application namespaces missing the enforce label (no output is good)
kubectl get namespaces -o json \
  | jq -r '.items[] | select(.metadata.labels.owner != null and .metadata.labels["pod-security.kubernetes.io/enforce"] == null) | .metadata.name'

# VAP bindings and their actions
kubectl get validatingadmissionpolicybindings -o custom-columns=NAME:.metadata.name,ACTIONS:.spec.validationActions

# A privileged pod must be rejected (server-side dry run)
kubectl --namespace "${NS}" run probe --image=registry.example.com/probe:1.0 \
  --privileged --dry-run=server
```

## References

- Pod Security admission: https://kubernetes.io/docs/concepts/security/pod-security-admission/
- ValidatingAdmissionPolicy: https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/
- Kyverno documentation: https://kyverno.io/docs/
- Related notes: [[gatekeeper-vs-kyverno]], [[pod-security-admission]], [[policy-rollout-audit-to-enforce]], [[conftest-policy-gate-for-manifests]]
- Related ADRs: [[0038-kyverno-verifies-image-signatures-at-admission]], [[0020-default-deny-network-policies]], [[0021-mandatory-resource-requests]]
