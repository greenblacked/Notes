---
title: Kyverno verifies image signatures at admission
description: Clusters admit only images signed by our CI identities, verified by Kyverno and rolled out from audit to enforce, with Binary Authorization as fallback.
type: adr
tags:
  - adr
  - security
  - supply-chain
  - policy-as-code
  - gke
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0038
---

## Context

Signing images ([[0037-keyless-cosign-image-signing]]) only matters if something refuses unsigned ones. The check must run where workloads are created, must understand our signing identities, and should not need a separate engine if one is already in the cluster. Our admission policy decision ([[0022-admission-policy-pod-security-vap-and-kyverno]]) already chose Kyverno as the single webhook engine for mutation, generation and image verification.

## Decision

**Kyverno `verifyImages` rules verify signatures and attestations at admission.**

- Policies match the registries we own and require a cosign signature whose certificate identity and issuer match our pinned CI identity (project path and protected ref for keyless; the KMS public key for Jenkins).
- Verification mutates tags to digests so what runs is what was verified (see [[0010-deploy-images-by-digest]]).
- Rollout follows [[policy-rollout-audit-to-enforce]]: audit first, fix findings, then enforce namespace by namespace.
- System namespaces and cluster add-ons have documented exemptions with an owner. Images from third-party vendors are mirrored and re-signed by our pipeline, or exempted by exact digest, never by broad registry wildcard.
- **Failure mode.** For production application namespaces the webhook fails closed: if Kyverno is unavailable, pod creation is rejected. This protects against bypass but makes Kyverno availability part of deploy availability, so it runs highly available with a PodDisruptionBudget and its own alerts. Kyverno's own namespace is excluded from its webhooks to avoid a deadlock.
- **Fallback.** Binary Authorization remains available as GKE-native enforcement. We enable it if Kyverno proves unreliable, or for clusters where we cannot run an extra webhook.

```yaml title="verify-images.yaml"
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signatures
spec:
  validationFailureAction: Audit # switch to Enforce per rollout plan
  webhookTimeoutSeconds: 15
  rules:
    - name: require-ci-signature
      match:
        any:
          - resources:
              kinds: [Pod]
      verifyImages:
        - imageReferences:
            - "registry.example.com/*"
          mutateDigest: true
          required: true
          attestors:
            - entries:
                - keyless:
                    issuer: "https://gitlab.example.com"
                    subject: "https://gitlab.example.com/payments/*//.gitlab-ci.yml@refs/tags/v*"
```

> [!info] Claims not checked against current docs
> The `ClusterPolicy` schema for `verifyImages` (field names such as `validationFailureAction` have changed across Kyverno releases), the supported subject matching syntax, and the Binary Authorization feature set. Verify against the Kyverno docs for the installed version, and test in a scratch cluster.

## Consequences

Easier:

- An unsigned or foreign image cannot start in an enforced namespace, even with valid cluster credentials.
- One engine, one set of policy tests and one rollout method.
- Digests are pinned at admission, defeating tag mutation after the check.

Harder:

- Admission latency grows with registry round trips; signature lookups are cached but cold starts cost time.
- A fail-closed webhook can block recovery during an incident, so the break-glass procedure (a labelled namespace exemption, approved and time-boxed) must be written and rehearsed.
- Subject patterns are security-critical. A pattern that is too loose accepts images from any project.
- Registry credentials for the webhook to read signatures must be provisioned and rotated.

## Alternatives considered

- **Binary Authorization.** Managed and integrated with GKE, but it is a second policy system with different tooling, and attestation policy is less flexible for our identity model. Kept as a fallback.
- **Gatekeeper with external data.** Possible, but external data providers add custom components. See [[gatekeeper-vs-kyverno]]. Rejected.
- **Ratify.** Plausible with Gatekeeper; adds another component we do not run today. Not chosen.

## Validation

```bash title="validate-admission.sh"
set -euo pipefail
NS="payments"

# Policy is present and in the intended mode
kubectl get clusterpolicy verify-image-signatures \
  -o jsonpath='{.spec.validationFailureAction}{"\n"}'

# Negative test: an unsigned image is rejected in an enforced namespace (expected: denied)
kubectl run unsigned-test --namespace "${NS}" --restart=Never --dry-run=server \
  --image=registry.example.com/test/unsigned@sha256:1111111111111111111111111111111111111111111111111111111111111111

# Kyverno is highly available
kubectl get deploy -n kyverno -o custom-columns=NAME:.metadata.name,READY:.status.readyReplicas
```

## References

- Kyverno image verification: https://kyverno.io/docs/policy-types/cluster-policy/verify-images/
- Binary Authorization: https://cloud.google.com/binary-authorization/docs

Related notes:

- [[image-signing-and-admission-verification]]
- [[gatekeeper-vs-kyverno]]
- [[policy-rollout-audit-to-enforce]]
- [[0022-admission-policy-pod-security-vap-and-kyverno]]
- [[0037-keyless-cosign-image-signing]]
