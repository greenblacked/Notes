---
title: Default-deny NetworkPolicy in every application namespace
description: Every application namespace starts with default-deny ingress and egress, plus explicit allows for DNS and the flows each service needs.
type: adr
tags:
  - adr
  - kubernetes
  - networking
  - security
  - gke
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0020
---

## Context

By default, every pod in a Kubernetes cluster can talk to every other pod, in any namespace, and to anything the node network allows outward. That default makes sense for a demo and is wrong for a shared production cluster:

- A single compromised pod can scan and reach every service, including databases, internal admin endpoints and the metadata server.
- A misconfigured test workload can call production dependencies without anyone noticing.
- Auditors and our own threat model ask "which workloads can reach the payment database?", and with no policy the honest answer is "all of them".

A `NetworkPolicy` selects pods and allows listed traffic. Once any policy selects a pod for a direction (ingress or egress), traffic in that direction that is not allowed by some policy is denied. A namespace-wide empty selector with no rules therefore gives default-deny. Enforcement needs a network plugin that implements policies; on GKE that is a configuration choice of the cluster.

This record fixes the baseline. How to write the individual policies is in [[kubernetes-network-policies]].

## Decision

We will apply **default-deny ingress and egress to every application namespace**, with explicit allow policies for DNS and for each flow a service needs.

- **Baseline policies**, present in every application namespace from creation:
  - `default-deny-all`: selects all pods, denies ingress and egress.
  - `allow-dns`: allows egress to the cluster DNS pods on UDP and TCP port 53.
- **Per-service allows** are written next to the service's manifests: ingress from the gateway or named callers, egress to named dependencies by namespace and pod labels, or by CIDR for out-of-cluster targets.
- **Generated, not hand-copied.** The baseline is created for each new namespace by a Kyverno `generate` rule, using the policy engine chosen in [[0022-admission-policy-pod-security-vap-and-kyverno]], so a namespace cannot exist without it. The generated policies are owned by the platform team.
- **Enforcement.** The cluster must enforce NetworkPolicy. GKE Dataplane V2 enforces network policy by design; for other configurations the network policy add-on must be enabled. Check the current GKE docs for which is the default for the cluster mode and version you run, and do not assume.
- **Internet egress** is never "allow all". It goes through the controlled egress path in [[private-gke-and-controlled-egress]], so only listed destinations are reachable, and the allow is by egress gateway or proxy address.
- **Exemptions** are limited to system namespaces and are listed in the policy repository with a reason.

```yaml title="network-baseline.yaml"
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: payments-api-prod
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: payments-api-prod
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
```

The `k8s-app: kube-dns` label matches the standard cluster DNS pods; some GKE configurations (for example Cloud DNS for GKE or NodeLocal DNSCache) route DNS differently. Verify the label and the DNS path on your cluster before applying, or lookups will fail silently for every pod in the namespace.

```yaml title="allow-gateway-to-api.yaml"
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-gateway-to-api
  namespace: payments-api-prod
spec:
  podSelector:
    matchLabels:
      app: payments-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: gateway
      ports:
        - protocol: TCP
          port: 8080
```

## Consequences

Easier:

- A compromised or misbehaving pod can reach only what its policies allow, which limits lateral movement and accidental cross-environment calls.
- The answer to "who can talk to this service?" is readable from the policies in Git, which helps audits and design reviews.
- New namespaces are safe by default, with no onboarding checklist item to forget.

Harder or newly required:

- Every new dependency needs a policy change. Teams will meet failures that look like timeouts rather than errors, because denied traffic is dropped, not refused. This is the main source of friction.
- Debugging needs the steps in [[network-troubleshooting-dns-mtu-tls-load-balancers]]: check DNS first, then the policies, then the path. Policy logging (where the dataplane supports it) helps; check the current docs.
- Egress by CIDR is brittle for services whose addresses change. Prefer a proxy or egress gateway with a stable address, or FQDN-aware policies if the dataplane offers them (check the current docs).
- Health checks and webhooks from the control plane or node must still reach pods. Test probes and admission webhooks after enabling, because mistakes here cause outages that look unrelated.
- NetworkPolicy is layer 3 and 4 only. It is not a replacement for authentication between services.

## Alternatives considered

- **Allow-all with service mesh authorisation only.** Gives identity-aware layer 7 rules, but the mesh is one more system to run, and traffic from outside the mesh (or when the sidecar is bypassed) is not covered. We may add mesh policy later ([[service-mesh-on-gke]]), on top of default-deny, not instead of it.
- **Deny ingress only.** Easier to adopt, but a compromised pod can still call out to anything, including the internet and the metadata server. Rejected as the baseline; allowed as a first rollout step for a legacy namespace with a dated plan to add egress.
- **Cloud firewall rules only.** Works at node or subnet level, but cannot distinguish pods that share nodes. Used in addition, not as a substitute.

> [!info] Claims not checked against current docs
> Whether Dataplane V2 is the default for new clusters in your mode and version, the DNS pod labels for your DNS configuration, policy logging support, and FQDN-based policy availability were not verified for this record. Check the current GKE network policy documentation.

## Validation

```bash
set -o pipefail

# Application namespaces without a default-deny policy (expect no output; skip system namespaces)
for ns in $(kubectl get ns -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | grep -vE '^(kube-|gke-|default$)'); do
  kubectl get networkpolicy default-deny-all -n "${ns}" >/dev/null 2>&1 || echo "missing default-deny-all: ${ns}"
done

# DNS still works from a pod in a namespace with the baseline (expect an address)
kubectl run dns-test --rm -i --restart=Never -n payments-api-prod \
  --image=busybox:1.36 -- nslookup kubernetes.default.svc.cluster.local

# Traffic that should be denied is denied (expect a timeout)
kubectl run deny-test --rm -i --restart=Never -n payments-api-prod \
  --image=busybox:1.36 -- wget -T 3 -qO- http://example.com
```

The test pods need a policy that allows them to start and, for the DNS test, the DNS allow; run them with a label that your policies cover, or expect them to be denied entirely and note the result.

## References

- Kubernetes network policies: https://kubernetes.io/docs/concepts/services-networking/network-policies/
- GKE network policy: https://cloud.google.com/kubernetes-engine/docs/how-to/network-policy
- Related notes: [[kubernetes-network-policies]], [[private-gke-and-controlled-egress]], [[network-troubleshooting-dns-mtu-tls-load-balancers]]
- Related ADRs: [[0019-namespace-per-team-tenancy]], [[0022-admission-policy-pod-security-vap-and-kyverno]]
