---
title: Pod Security admission and policy enforcement
description: Enforce Pod Security Standards per namespace with warn, audit and enforce labels, and add Kyverno or Gatekeeper policy for what PSS cannot express.
type: pattern
tags:
  - patterns
  - kubernetes
  - gke
  - security
created: 2026-10-16
modified: 2026-10-16
draft: false
---

By default a Pod can ask for almost anything: run as root, mount host paths, add Linux capabilities, share the node's network. One compromised container with those rights is a path to the node. Pod Security admission is the built-in controller that refuses such Pods per namespace, using the Pod Security Standards (PSS). Apply it to every application namespace, and add a policy engine for the rules PSS does not express.

> [!info] Check the details for your cluster version
> The PSS levels and the namespace label names are stable Kubernetes API. Admission behaviour on GKE (especially Autopilot) and the Kyverno field names below should be confirmed in the Kubernetes and GKE documentation for the version you run.

## Pod Security Standards and namespace labels

PSS defines three cumulative levels:

| Level        | Intent                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------- |
| `privileged` | No restrictions. For system namespaces and trusted infrastructure only.                            |
| `baseline`   | Blocks known privilege escalations (host namespaces, privileged containers) and little else.       |
| `restricted` | Current hardening best practice: non-root, no privilege escalation, dropped capabilities, seccomp. |

A namespace opts in through labels. Each mode takes a level, and an optional `-version` label pins the policy version it is evaluated against (a Kubernetes minor version such as `v1.30`, or `latest`):

- `pod-security.kubernetes.io/enforce`: Pods that violate the level are rejected.
- `pod-security.kubernetes.io/audit`: violations are recorded in the audit log; the Pod is admitted.
- `pod-security.kubernetes.io/warn`: the API client gets a warning; the Pod is admitted.
- `pod-security.kubernetes.io/enforce-version`, `audit-version`, `warn-version`: the matching policy versions.

A sensible first state for a namespace is to enforce `baseline` while auditing and warning for `restricted`:

```yaml title="namespace-payments.yaml"
apiVersion: v1
kind: Namespace
metadata:
  name: payments
  labels:
    pod-security.kubernetes.io/enforce: baseline
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

Pin the `-version` labels once you have a tested baseline, so a cluster upgrade does not change what is admitted on the same day. Remember that `enforce` applies to Pods only, so a Deployment is admitted and the failure shows up on its ReplicaSet, which cannot create Pods; `warn` and `audit` also check the Pod templates of workload resources.

## Dry-run before enforcing

Ask the API server what would happen without changing anything. A server-side dry-run of the label shows warnings for existing Pods that violate the level:

```bash
export NS="payments"

kubectl label --dry-run=server --overwrite ns "${NS}" \
  pod-security.kubernetes.io/enforce=restricted
```

Fix the workloads that are listed, then repeat until the output is clean.

## A securityContext that passes restricted

```yaml title="deployment.yaml (excerpt)"
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
            readOnlyRootFilesystem: true # recommended extra, not required by the level
```

The image must actually run as a non-root user, which is built in [[dockerfile-hardening]]. With `readOnlyRootFilesystem`, give the app an `emptyDir` for any path it writes to. Put the block into the chart defaults so every service starts compliant; see [[helm-chart-conventions]].

## What PSS does not cover

PSS looks only at the Pod's security fields. It cannot say which registries are allowed, that images must be referenced by digest or carry a signature, that every workload has resource requests, or that an `ExternalSecret` may only read keys with its namespace's prefix (the rule described in [[external-secrets-with-secret-manager]]). Use a policy engine such as Kyverno or Gatekeeper for those rules. Start in audit mode so you see violations before anything is blocked:

```yaml title="kyverno-allowed-registries.yaml"
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: allowed-registries
spec:
  validationFailureAction: Audit
  background: true
  rules:
    - name: images-from-internal-registry
      match:
        any:
          - resources:
              kinds: ["Pod"]
      validate:
        message: "Images must come from registry.example.com."
        pattern:
          spec:
            containers:
              - image: "registry.example.com/*"
```

> [!info] Check field names for your Kyverno version
> `validationFailureAction` and the rule structure have changed between Kyverno releases. Check the policy reference for the installed version before applying this.

Switch a policy from `Audit` to `Enforce` per namespace, after the audit report is clean.

## GKE notes

GKE Autopilot applies its own built-in security constraints to workloads, on top of anything you configure. Check the GKE documentation for which PSS levels are compatible with Autopilot and which Pod settings it rejects or mutates. On Standard clusters, Pod Security admission is the Kubernetes feature described above, and the namespace labels are yours to manage.

## Exceptions

Some workloads (node agents, CSI drivers, a legacy service) need more than the namespace level allows. Handle them explicitly:

- Put the exception in Git, scoped to the single namespace or policy rule it needs, never a cluster-wide relaxation.
- Record an owner, the reason and an expiry date, and review expiry in the [[production-change-checklist]].
- Prefer moving the privileged workload to its own namespace with its own labels over loosening a shared one.

## Rollout

1. Start with `warn` and `audit` at `restricted` on every application namespace, and read the results for a few days.
2. Fix workloads through the chart defaults, not one Deployment at a time.
3. Turn on `enforce` namespace by namespace, starting with low-risk ones, first at `baseline`, then at `restricted`.
4. Add the policy-engine rules in `Audit` mode, then `Enforce`.
5. Combine with [[kubernetes-network-policies]] so a Pod that is admitted still has limited reach.

## Verify

Create a deliberately privileged Pod in the enforced namespace and expect a rejection:

```bash
export NS="payments"

kubectl apply --namespace "${NS}" -f - <<'YAML'
apiVersion: v1
kind: Pod
metadata:
  name: psa-test
spec:
  restartPolicy: Never
  containers:
    - name: test
      image: busybox:<tested-version>@sha256:<digest> # throwaway test image, pin it like any other
      command: ["sleep", "60"]
      securityContext:
        privileged: true
YAML
```

The API server should answer with a `violates PodSecurity` error naming the failed checks. If the Pod is created, the labels are not applied to that namespace, or enforcement is not active. Delete the test Pod if it exists: `kubectl delete pod psa-test --namespace "${NS}" --ignore-not-found`.

## Rollback

Relabel the namespace to the previous level; the change takes effect for new Pods immediately and does not affect running ones:

```bash
export NS="payments"

kubectl label --overwrite ns "${NS}" pod-security.kubernetes.io/enforce=baseline
```

If the namespace is managed by Argo CD, revert the label change in Git as well, otherwise it is reset on the next sync (see [[0001-gitops-with-argocd]]).

## Related

- [[kubernetes-network-policies]]
- [[dockerfile-hardening]]
- [[helm-chart-conventions]]
