---
title: CIS Kubernetes benchmarks with kube-bench
description: Run CIS Kubernetes benchmark checks with kube-bench on GKE nodes, read the results, record exceptions and keep versioned evidence.
type: pattern
tags:
  - compliance
  - kubernetes
  - gke
  - security
  - audit
created: 2026-10-17
modified: 2026-10-17
draft: false
aliases:
  - kube-bench
---

This note shows how to run the open-source tool kube-bench against GKE nodes, which results matter on a managed control plane, and how to turn failures into fixes or recorded exceptions. It is for senior DevOps engineers who need repeatable benchmark evidence for a cluster. Pod-level controls are covered in [[patterns/pod-security-admission]] and [[patterns/kubernetes-network-policies]]; host hardening for VM nodes and build agents is in [[patterns/linux-host-hardening-with-chef-and-inspec]].

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Scope and sources
> Written for the Center for Internet Security (CIS) Kubernetes benchmarks as run by the Aqua Security kube-bench tool, on GKE Standard clusters. Based on the kube-bench project documentation, the Kubernetes documentation on Pod security and the GKE hardening guidance on cloud.google.com. No benchmark item numbers are cited: they change between editions.

## What CIS benchmarks are and are not

A CIS benchmark is a consensus list of configuration recommendations for one product version. kube-bench automates the checks that can be tested from a node (kubelet flags and files, file permissions) and marks the rest as manual.

- It is a configuration check, not a vulnerability scan and not a penetration test. It does not look at your images or your application.
- It checks the node it runs on. A passing result on one node pool says nothing about another.
- A fail is a recommendation that does not hold, not an incident. Some recommendations do not fit your design, and that is a legitimate exception when recorded.
- Passing the benchmark is not the same as being compliant with any framework. Auditors usually care that you chose a recognised baseline, ran it on a schedule, and handled the gaps.

On GKE the control plane is run by Google, so checks about API server flags, etcd and controller manager are not testable by you. The worker node checks (kubelet configuration, file permissions) and the policy checks (RBAC, Pod security, network policy, secrets handling) are where your results come from. GKE also has its own posture features, such as security posture scanning and Shielded Nodes, which cover related ground. Treat them as extra signals, not as a replacement for a benchmark run you can version and store.

## Choosing the benchmark

kube-bench ships benchmark definitions for several platforms, including a GKE-specific one. Use the one that matches the platform, because the generic Kubernetes benchmark assumes you control the control plane and will report many failures that cannot apply.

- Pin the benchmark name explicitly with the `--benchmark` flag instead of letting the tool auto-detect from the cluster version. Auto-detection can change between runs when the tool or the cluster version changes, and then the evidence is not comparable.
- Record three things with every result: the kube-bench image tag (or digest), the benchmark identifier, and the GKE node version.
- Change the benchmark deliberately, in a merge request, and re-run both the old and the new version once so you can explain differences.

> [!note] Not verified
> The claims below were written from documentation knowledge and were not checked against a running system or the current docs: the current GKE benchmark name and version identifier accepted by `--benchmark`, the exact manifest of the upstream kube-bench GKE Job, the supported flags of the version you pin, and which checks GKE Autopilot allows (Autopilot may forbid `hostPID` and host path mounts, so this Job may not run there at all). Check them before relying on them.

## Running kube-bench as a Job

The Job needs access to the node's process list and some kubelet files, so it runs with `hostPID: true` and read-only host paths. Run it in its own namespace, on demand, and remove it afterwards.

> [!warning] The scanner's host access is a risk
> `hostPID: true` lets the container see every process on the node, and the host path mounts expose kubelet configuration. Run the Job briefly, from a dedicated namespace with limited access, and delete it when the logs are saved. Do not leave it installed or schedule it from a namespace that developers can write to.

The namespace must allow the privileged Pod Security level, because `hostPID` is rejected by the baseline and restricted levels (see [[patterns/pod-security-admission]]). Keep that exception on this one namespace.

```yaml title="kube-bench/job.yaml"
apiVersion: v1
kind: Namespace
metadata:
  name: kube-bench
  labels:
    # hostPID is rejected below the privileged level; this namespace is the only exception
    pod-security.kubernetes.io/enforce: privileged
    pod-security.kubernetes.io/audit: privileged
    pod-security.kubernetes.io/warn: privileged
---
apiVersion: batch/v1
kind: Job
metadata:
  name: kube-bench-node
  namespace: kube-bench
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 3600 # the Job is removed an hour after it finishes
  template:
    metadata:
      labels:
        app: kube-bench
    spec:
      hostPID: true
      restartPolicy: Never
      containers:
        - name: kube-bench
          # change: pin a released tag, ideally by digest, and record it with the results
          image: docker.io/aquasec/kube-bench:vX.Y.Z
          command:
            - kube-bench
            - run
            - --targets
            - node
            - --benchmark
            - gke-X.Y.Z # change: the GKE benchmark identifier supported by the pinned version
            - --json
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              memory: 256Mi
          volumeMounts:
            - name: var-lib-kubelet
              mountPath: /var/lib/kubelet
              readOnly: true
            - name: etc-systemd
              mountPath: /etc/systemd
              readOnly: true
            - name: etc-kubernetes
              mountPath: /etc/kubernetes
              readOnly: true
      volumes:
        - name: var-lib-kubelet
          hostPath:
            path: /var/lib/kubelet
        - name: etc-systemd
          hostPath:
            path: /etc/systemd
        - name: etc-kubernetes
          hostPath:
            path: /etc/kubernetes
```

The Job runs on one node, chosen by the scheduler. To check each node pool, add a `nodeSelector` with the pool label (`cloud.google.com/gke-nodepool: <pool>`) and run it once per pool.

```bash
set -euo pipefail

CONTEXT="gke_my-project-prod_europe-west1_prod-1"  # change: kubectl context of the cluster
OUT_DIR="evidence/kube-bench/$(date +%Y-%m-%d)"    # change: where evidence is stored
mkdir -p "${OUT_DIR}"

kubectl --context "${CONTEXT}" apply -f kube-bench/job.yaml
kubectl --context "${CONTEXT}" -n kube-bench wait --for=condition=complete job/kube-bench-node --timeout=300s

# Save the raw result with the image used
kubectl --context "${CONTEXT}" -n kube-bench logs job/kube-bench-node > "${OUT_DIR}/kube-bench-node.json"
kubectl --context "${CONTEXT}" -n kube-bench get job kube-bench-node \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}' > "${OUT_DIR}/image.txt"

# Remove the scanner and its host access
kubectl --context "${CONTEXT}" delete -f kube-bench/job.yaml
```

To run the tool outside a cluster, for example on a node you reach over SSH, the same flags apply: `kube-bench run --targets node --benchmark gke-X.Y.Z --json`. Use the cluster Job for evidence because it records what ran and where.

## Reading results

The JSON output groups checks into sections and gives each a state. Read it by state, not by total score.

- `PASS`: the check passed. Keep it in the evidence.
- `FAIL`: the recommendation does not hold. Each one needs a decision.
- `WARN`: the tool cannot decide, usually a manual check. Someone must look and write down the answer.
- `INFO`: for information only.

Summarise the counts with `jq` so the numbers can be compared between runs.

```bash
set -euo pipefail

RESULT="evidence/kube-bench/2026-10-17/kube-bench-node.json"  # change: the saved result file

# Count of checks per state (the field layout may differ by kube-bench version; check your output)
jq -r '[.. | objects | select(has("state")) | .state] | group_by(.) | map({state: .[0], count: length})' "${RESULT}"

# List failing checks with their ID and description
jq -r '.. | objects | select(.state? == "FAIL") | [.test_number, .test_desc] | @tsv' "${RESULT}"
```

Do the manual items once per release of the benchmark and keep the written answer next to the result.

## Remediation map

Most failures on a GKE cluster fall into a few areas. The table points to the note that holds the control; the benchmark item numbers are left out on purpose.

| Example check area                           | Typical control                                                 | Where to read                                          |
| -------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| Privileged or host-level Pods are admitted   | Pod Security admission at baseline or restricted                | [[patterns/pod-security-admission]]                    |
| Namespaces without network policy            | Default deny plus explicit allows                               | [[patterns/kubernetes-network-policies]]               |
| Service account tokens and key files in Pods | Workload Identity Federation instead of keys                    | [[patterns/gke-workload-identity]]                     |
| Broad cluster-admin and wildcard RBAC        | Group-based, namespaced roles and a regular review              | [[compliance/access-reviews-gcp-and-gke]]              |
| Kubelet file permissions and flags           | Use the GKE node image defaults; check, do not edit by hand     | Node pool configuration in Terraform                   |
| Secrets stored in manifests or env vars      | Secret Manager with an operator                                 | [[patterns/external-secrets-with-secret-manager]]      |
| Node operating system settings               | Hardened images or configuration management on VM-based tooling | [[patterns/linux-host-hardening-with-chef-and-inspec]] |

Fix through code (Terraform for node pool settings, Git for manifests), then re-run the benchmark. A fix made by hand on a node is lost at the next node upgrade or auto-repair.

## Exceptions register

Some checks will keep failing for good reasons: a managed component cannot be changed, a control is met another way, or the change would break a workload. Record these, do not hide them.

For each exception keep: the check ID and the benchmark identifier, the node pool or cluster it applies to, the reason, the compensating control (what covers the risk instead), an owner, a review-by date and the person who accepted it. Store the register in Git next to the benchmark results, and review it every time you run the benchmark. An exception with no review date is an unmanaged risk.

```yaml title="compliance/kube-bench-exceptions.yaml"
benchmark: gke-X.Y.Z # change: identifier of the pinned benchmark
exceptions:
  - check: "X.Y.Z" # change: the check ID from the result
    scope: "cluster prod-1, all node pools"
    reason: "Managed by GKE; the setting cannot be changed by customers."
    compensating_control: "GKE-managed control; verified in the product documentation."
    owner: "platform-lead"
    accepted_by: "security-lead"
    accepted_on: "2026-10-17"
    review_by: "2027-01-17"
```

## Evidence export

Per run, store: the raw JSON, the image tag or digest, the benchmark identifier, the cluster and node pool names, the node version, the run time and who ran it, the exceptions register at that date, and the list of fixes made since the last run. Put these in the evidence store described in [[compliance/audit-evidence-collection-and-retention]], with a retention period your auditor agrees with. Run the benchmark on a schedule (quarterly is a common starting point) and after node pool upgrades, not only before an audit.

## Pitfalls

- **Running the Job in a namespace others can write to.** The `hostPID` Pod is a powerful foothold. Use a locked-down namespace and delete the Job.
- **Using the generic Kubernetes benchmark on GKE.** The result is mostly noise from control plane checks you cannot fix.
- **Auto-detected benchmark versions.** Results change when the tool changes, and you can no longer compare quarters.
- **Floating image tags.** `latest` means the evidence cannot be reproduced.
- **Treating the percentage as a goal.** Fixing the easy items to raise the score while leaving real risks is not the point.
- **Editing nodes by hand.** The change vanishes at the next upgrade; change the node pool definition instead.
- **Assuming Autopilot works the same.** Host access may be refused there, so a different approach is needed.

## Verify

After the Job is deleted, confirm nothing is left behind and the evidence is complete.

```bash
set -euo pipefail

CONTEXT="gke_my-project-prod_europe-west1_prod-1"  # change: kubectl context of the cluster

kubectl --context "${CONTEXT}" get ns kube-bench 2>&1 || true   # expected: NotFound after the namespace is removed
ls -l evidence/kube-bench/*/ | head
```

Expected: no `kube-bench` Pods running, and the evidence folder holds the JSON result and the image file for the run.

## Rollback

The scan changes nothing on the nodes, so there is nothing to roll back from the run itself. Remove the Job and the namespace. Remediation changes follow their own rollback: revert the Terraform or Git change that tightened the setting, and re-run the benchmark to confirm the previous state.

## Related

- [[patterns/pod-security-admission]]: the admission controls behind several benchmark areas.
- [[patterns/kubernetes-network-policies]]: default deny and explicit allows for namespaces.
- [[patterns/gke-workload-identity]]: removes the need for key files in Pods.
- [[compliance/access-reviews-gcp-and-gke]]: the review that covers RBAC findings.
- [[patterns/linux-host-hardening-with-chef-and-inspec]]: the same idea for VM hosts and build agents.
- [[compliance/audit-evidence-collection-and-retention]]: where to keep the results.
