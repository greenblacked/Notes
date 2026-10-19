---
title: One namespace per team service boundary, with quotas and group RBAC
description: Each team service boundary gets namespaces with ResourceQuota, LimitRange and RoleBindings to Google groups, never to individual users.
type: adr
tags:
  - adr
  - kubernetes
  - gke
  - security
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0019
---

## Context

Multiple teams share our GKE clusters ([[gke-platform-topology-and-tenancy]]). Without a convention we have seen:

- Namespaces created by hand with `kubectl create namespace`, with no owner and no record of who to ask when something in them breaks.
- No quotas, so a runaway deployment or a test namespace consumed capacity needed by others.
- Access granted to individual user accounts with a `RoleBinding` per person. People leave teams, and the bindings stay.
- Teams sharing one large namespace, so RBAC, network policy and quotas could not be set per team.

A Kubernetes namespace is not a hard security boundary on its own, but it is the unit to which RBAC, `ResourceQuota`, `LimitRange`, `NetworkPolicy` and Pod Security labels attach. Choosing namespace boundaries well is the cheapest tenancy control we have. The alternative of a cluster per team is stronger isolation at much higher operational cost.

## Decision

We will give **each team service boundary one or more namespaces, created only through GitOps, with a mandatory owner label, a quota, default limits and group-based access**.

- **Creation.** Namespaces are declared in the GitOps repository ([[0001-gitops-with-argocd]]) and nowhere else. A manual namespace is detected and removed.
- **Naming and ownership.** `<team>-<service-or-boundary>-<env>`, for example `payments-api-prod`. Every namespace carries labels `owner` (the team's Google group name, a plain label value) and `cost-center`. Admission rejects a namespace without `owner` (see [[0022-admission-policy-pod-security-vap-and-kyverno]]).
- **Quota and limits.** Every namespace has a `ResourceQuota` (CPU and memory requests, object counts) and a `LimitRange` that sets defaults and a ceiling per container. The quota sizes come from a small set of templates (small, medium, large) chosen at onboarding, and changes are merge requests.
- **Access by group.** `RoleBinding`s name Google groups through Google Groups for RBAC, never individual users. Membership is changed in the identity provider, so joiners and leavers are handled in one place and reviewed by [[access-reviews-gcp-and-gke]]. Check the current GKE docs for how to enable Google Groups for RBAC and its group naming requirements.
- **Default network posture.** Each namespace starts with default-deny policies from [[0020-default-deny-network-policies]], and Pod Security labels from [[0022-admission-policy-pod-security-vap-and-kyverno]].
- **Hierarchical Namespaces** (a controller that propagates policy to child namespaces) are used only if a team needs sub-namespaces with inherited policy. It is not part of the default; check the project's current status before adopting it.
- **Cluster-per-team** is reserved for teams with regulatory isolation needs or different cluster-level components; it is an exception that needs platform approval.

```yaml title="namespace-payments-api-prod.yaml"
apiVersion: v1
kind: Namespace
metadata:
  name: payments-api-prod
  labels:
    owner: payments-team
    cost-center: cc-1042
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: default-quota
  namespace: payments-api-prod
spec:
  hard:
    requests.cpu: "20"
    requests.memory: 40Gi
    pods: "100"
---
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: payments-api-prod
spec:
  limits:
    - type: Container
      defaultRequest:
        cpu: 100m
        memory: 128Mi
      default:
        memory: 256Mi
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: team-edit
  namespace: payments-api-prod
subjects:
  - kind: Group
    name: payments-team@example.com
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: edit
  apiGroup: rbac.authorization.k8s.io
```

The quota numbers and the group are examples; set them from the onboarding template and your identity provider. The `edit` role cannot modify quotas or role bindings, which is intended.

## Consequences

Easier:

- Every namespace has a named owner, a cost centre and a size, so cost allocation ([[finops-cost-allocation-and-guardrails]]) and incident routing work.
- Access changes follow group membership with no cluster change.
- A single team cannot exhaust the cluster, and a noisy namespace is bounded by its quota.
- A uniform baseline (quota, limits, network policy, Pod Security) makes review and audit mechanical.

Harder or newly required:

- Onboarding needs a pull request and a quota choice rather than a command. We provide a template or generator to keep that cheap.
- Quotas need maintenance. Too small and deployments fail on a limit; too generous and they protect nothing. Track usage against quota and review it.
- Namespaces share the node kernel and the control plane. This is soft multi-tenancy: it protects against mistakes and noisy neighbours, not against a determined hostile tenant. Workloads of different trust levels need separate clusters or sandboxing.
- Cluster-scoped resources (CRDs, `ClusterRole`s, webhooks) cannot be delegated per namespace and stay with the platform team.
- Group membership becomes a security-critical control, so the groups need owners and periodic review.

## Alternatives considered

- **Cluster per team.** Strongest isolation and independent upgrades, but each cluster has a fixed operating cost, and the platform scales poorly with the number of teams. Used only as an exception.
- **One shared namespace.** Simple, but nothing can be scoped per team: no quota, no RBAC separation, no network policy boundaries. Rejected.
- **Per-user RoleBindings.** Quick for the first person, an audit problem by the tenth. Rejected.
- **Namespaces on demand by `kubectl`.** Fast, but unowned and untracked. Rejected.

> [!info] Claims not checked against current docs
> The Google Groups for RBAC setup steps and constraints, the current status of Hierarchical Namespaces, and GKE support for quota-related admission behaviour were not verified for this record. Check the current GKE and Kubernetes documentation.

## Validation

```bash
set -o pipefail

# Namespaces with no ResourceQuota (expect only system namespaces)
comm -23 \
  <(kubectl get ns -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | sort) \
  <(kubectl get resourcequota -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"\n"}{end}' | sort -u)

# Namespaces missing the owner label (expect only system namespaces)
kubectl get ns -o json | jq -r '.items[] | select(.metadata.labels.owner == null) | .metadata.name'

# RoleBindings that name individual users (expect no output)
kubectl get rolebindings -A -o json | jq -r '
  .items[] | select(any(.subjects[]?; .kind == "User"))
  | "\(.metadata.namespace)/\(.metadata.name)"'
```

## References

- Resource quotas: https://kubernetes.io/docs/concepts/policy/resource-quotas/
- Google Groups for RBAC on GKE: https://cloud.google.com/kubernetes-engine/docs/how-to/google-groups-rbac
- Related notes: [[gke-platform-topology-and-tenancy]], [[iam-groups-and-ci-workload-identity-federation]], [[access-reviews-gcp-and-gke]]
- Related ADRs: [[0020-default-deny-network-policies]], [[0022-admission-policy-pod-security-vap-and-kyverno]]
