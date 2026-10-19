---
title: Every container sets requests, memory limit equals request, CPU limits are optional
description: Admission rejects containers without CPU and memory requests; the memory limit equals the request, and CPU limits are set only by exception.
type: adr
tags:
  - adr
  - kubernetes
  - reliability
  - cost
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0021
---

## Context

Resource requests and limits do three different jobs, and teams routinely confuse them:

- **Requests** are what the scheduler reserves. A pod with no request looks free to the scheduler, so nodes get overcommitted and pods are evicted or throttled under pressure.
- **Memory limits** are enforced by killing the container (OOMKill) when it exceeds the limit. Memory cannot be reclaimed by slowing a process down.
- **CPU limits** are enforced by throttling. CPU is compressible, but a limit set below real demand makes latency spike even when the node has idle CPU. Many teams see tail latency problems that come from CPU throttling rather than from the application.

The pod's Quality of Service class follows from these values: `Guaranteed` (requests equal limits for every container), `Burstable` (some requests), and `BestEffort` (none). `BestEffort` pods are the first evicted. On GKE Autopilot ([[0018-gke-autopilot-for-new-clusters]]), billing follows requests, so missing or inflated requests have a direct cost.

We have found pods with no requests in production, pods whose limits were copied from a template and are far from real usage, and CPU limits set low enough to throttle healthy services. We want a rule that is simple enough to enforce at admission and that avoids the throttling trap. The general guidance is in [[kubernetes-resource-requests-and-limits]].

## Decision

We will require that **every container sets CPU and memory requests, sets a memory limit equal to its memory request, and sets a CPU limit only by documented exception**.

- **Requests are mandatory.** Admission rejects a pod whose containers (including init containers) lack CPU or memory requests. The rule is implemented as a built-in ValidatingAdmissionPolicy where the cluster supports it (see [[0022-admission-policy-pod-security-vap-and-kyverno]]), starting in warn and audit mode and moving to deny after the cleanup.
- **Memory limit equals memory request.** This gives predictable behaviour: the pod either has the memory it reserved or is killed at that line, and the node is not overcommitted on memory. The sizing starts from measured usage plus headroom, not from a template.
- **CPU limits are optional and discouraged.** Without a limit a container can use idle CPU on the node, and under contention requests still guarantee a fair share through CPU shares. A CPU limit is set only where isolation matters more than latency, for example batch jobs or untrusted CI workloads ([[0014-gitlab-runners-kubernetes-executor-on-gke]]), and the reason is written next to it.
- **Defaults via LimitRange.** Each namespace's `LimitRange` supplies default requests so a missing value is filled in rather than failing a rollout; the defaults are deliberately small so teams are pushed to set real numbers ([[0019-namespace-per-team-tenancy]]). The default memory limit equals the default memory request, so a container that relies on the defaults still satisfies the memory-limit rule. LimitRange defaults are applied by mutating admission before the ValidatingAdmissionPolicy is evaluated, so in a namespace with defaults the requests rule only catches namespaces without a LimitRange; the memory-limit rule still applies.
- **Right-sizing.** Requests are reviewed against Vertical Pod Autoscaler recommendations (in recommendation mode) monthly and after major load changes ([[kubernetes-autoscaling]]).
- **QoS consequence.** Most workloads will be `Burstable` because CPU has a request but no limit. That is intended. Pods that must be `Guaranteed` (a rare, latency-critical few) set both CPU and memory with equal requests and limits and record why.

```yaml title="vap-require-requests.yaml (excerpt)"
# Example only. Check that ValidatingAdmissionPolicy is GA on your GKE version
# and the API version it uses, then adapt the expressions.
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: require-resource-requests
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
  validations:
    - expression: >-
        object.spec.containers.all(c,
          has(c.resources) && has(c.resources.requests) &&
          'cpu' in c.resources.requests && 'memory' in c.resources.requests)
      message: "Every container must set cpu and memory requests."
    - expression: >-
        object.spec.containers.all(c,
          has(c.resources.limits) && 'memory' in c.resources.limits &&
          c.resources.limits['memory'] == c.resources.requests['memory'])
      message: "Memory limit must equal the memory request."
```

A policy needs a `ValidatingAdmissionPolicyBinding` with `validationActions: [Warn, Audit]` first and `Deny` after cleanup. The second expression assumes the first passed; test the combined behaviour before enforcing. Init containers need the same treatment and are omitted here for brevity.

## Consequences

Easier:

- The scheduler has real information, so bin-packing and the cluster autoscaler behave predictably, and `BestEffort` surprises disappear.
- Memory behaviour is deterministic, and OOMKills point at an undersized request rather than at a mysterious node condition.
- Removing CPU limits eliminates a whole class of throttling latency, one of the most common hidden causes of p99 problems.
- Cost allocation and Autopilot billing line up with declared requests ([[finops-cost-allocation-and-guardrails]]).

Harder or newly required:

- Teams must measure to set requests. Wrong guesses either waste money (too high) or cause evictions under pressure (too low). The VPA recommendation review is the maintenance cost.
- Without CPU limits, a runaway process can take idle CPU from the node, and under contention only the request share is protected. Noisy-neighbour risk is real for untrusted or batch workloads, which is why they keep limits.
- Memory limit equal to request means no memory burst; JVM and similar runtimes need heap settings aligned with the container limit.
- Existing workloads need a cleanup before enforcement, and the audit phase can be long. Helm charts must expose requests as values ([[helm-chart-conventions]] covers the convention).
- A rule this specific has exceptions (sidecars, jobs, operators). The exception process must be quick, or teams work around the policy.

## Alternatives considered

- **Limits equal to requests everywhere (Guaranteed QoS).** Predictable, and what many guides recommend, but it brings back CPU throttling for every service. Rejected as a blanket rule.
- **No policy, guidance only.** Cheapest to adopt, but we already have pods without requests. Rejected.
- **Only LimitRange defaults, no admission rule.** Fills in missing values but cannot enforce a memory limit equal to the request or catch bad numbers. Used as a complement.
- **Rely on VPA in auto mode.** Automatic right-sizing is attractive, but auto mode restarts pods to apply changes, and it should not fight the HPA on the same metric. We use it in recommendation mode only.

> [!info] Claims not checked against current docs
> ValidatingAdmissionPolicy GA status and API version on your GKE version, the CEL expressions' behaviour for init containers, VPA mode behaviour, and Autopilot request handling (including minimums and adjustments) were not verified for this record. Check the current Kubernetes and GKE documentation.

## Validation

```bash
set -o pipefail

# Pods with a container missing CPU or memory requests (expect no output)
kubectl get pods -A -o json | jq -r '
  .items[]
  | select(any(.spec.containers[]; .resources.requests.cpu == null or .resources.requests.memory == null))
  | "\(.metadata.namespace)/\(.metadata.name)"'

# Containers where the memory limit differs from the request (expect no output)
kubectl get pods -A -o json | jq -r '
  .items[] as $p
  | $p.spec.containers[]
  | select(.resources.limits.memory != .resources.requests.memory)
  | "\($p.metadata.namespace)/\($p.metadata.name)/\(.name)"'

# QoS class distribution (BestEffort should be absent for application namespaces)
kubectl get pods -A -o json | jq -r '.items[] | .status.qosClass' | sort | uniq -c
```

## References

- Managing container resources: https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/
- Pod Quality of Service: https://kubernetes.io/docs/concepts/workloads/pods/pod-qos/
- Related notes: [[kubernetes-resource-requests-and-limits]], [[kubernetes-autoscaling]], [[node-resource-pressure-triage]]
- Related ADRs: [[0018-gke-autopilot-for-new-clusters]], [[0022-admission-policy-pod-security-vap-and-kyverno]]
