---
title: Responding to a runtime detection alert
description: Triage a Falco, Tetragon or Container Threat Detection finding on GKE in minutes, decide true or false positive, hand real ones to containment and tune the rest in Git.
type: runbook
tags:
  - runbooks
  - security
  - incident-management
  - on-call
  - kubernetes
  - gke
created: 2026-11-24
modified: 2026-11-24
draft: false
---

[[falco-vs-tetragon-vs-gke-threat-detection]] chooses the tool and routes its findings; this runbook is what on-call does when one pages. The goal of the first 15 minutes is a decision, not a fix: real, benign, or unknown. Real and unknown go to [[compromised-cloud-cluster-containment]]. Benign becomes a reviewed exception in Git.

> [!info] Scope and verification
> Nothing here was checked against Falco or Security Command Center documentation on 2026-11-24, because the page fetches failed. Field names and finding categories are as commonly documented and must be checked against one real alert from your setup before you rely on the queries.

## When to use

A page or ticket from a runtime rule: a shell in a container, a binary that is not in the image, writes under `/etc` or `/usr`, an outbound connection to a new address, reading service account tokens, a crypto-miner signature.

Use something else when:

- The alert is about an audit-log event only: [[gcp-audit-logs-siem]].
- It is about a vulnerable image, not runtime behaviour: [[vulnerability-exception-register]].

## Preconditions

- Read access to the alert payload.
- `kubectl` read in the namespace.
- Logs Viewer on the project.
- The quarantine NetworkPolicy already applied per namespace ([[compromised-cloud-cluster-containment#Contain workloads]]).
- The owner map from [[threat-detection-and-response-gcp-gke]].

## Steps

### 1. Acknowledge and copy the alert

- Save the raw JSON (Falco) or the finding JSON (SCC) to the case.
- Note the rule or category, priority, time, cluster, namespace, pod, container, image (repository and digest), process command line and parent, and user.

### 2. Enrich, read-only

```bash
NS="payments"           # change: from the alert
POD="payments-api-7d9c" # change: from the alert
CASE_DIR="$HOME/rt-alert-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$CASE_DIR"; chmod 700 "$CASE_DIR"
kubectl get pod "$POD" -n "$NS" -o yaml > "$CASE_DIR/pod.yaml"
kubectl get pod "$POD" -n "$NS" -o jsonpath='{range .status.containerStatuses[*]}{.name}{"\t"}{.imageID}{"\n"}{end}'
kubectl get events -n "$NS" --field-selector "involvedObject.name=$POD" -o yaml > "$CASE_DIR/events.yaml"
kubectl logs "$POD" -n "$NS" --all-containers --timestamps > "$CASE_DIR/logs.txt"
```

Answer these and write the answers in the channel:

- Is the image digest the one in the deploy record?
- Did a person `kubectl exec` into the pod around that time?

Query for exec activity:

```bash
PROJECT="example-prod" # change
gcloud logging read \
  "protoPayload.methodName=\"io.k8s.core.v1.pods.exec.create\" AND protoPayload.resourceName:\"namespaces/${NS}/pods/${POD}\"" \
  --project="$PROJECT" --freshness=2h --format=json > "$CASE_DIR/exec-audit.json"
jq -r '.[] | [.timestamp, .protoPayload.authenticationInfo.principalEmail] | @tsv' "$CASE_DIR/exec-audit.json"
```

### 3. Decide

| Evidence                                                                                                                                                      | Classification | Next                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------- |
| An exec by a named engineer on a ticket, and the process matches what they ran                                                                                | Benign         | Step 5                                                   |
| A known tool (backup agent, debug image, CI job pod) whose behaviour is documented                                                                            | Benign         | Step 5                                                   |
| Anything else, including "probably fine"                                                                                                                      | Unknown        | Step 4                                                   |
| The image digest does not match the deploy record, a miner signature, outbound to an unknown address, or service account token reads by an unexpected process | Real           | Declare an incident ([[incident-response]]), then step 4 |

Time box: if there is no decision within 15 minutes, treat it as unknown.

### 4. Hand to containment

- Do not delete or restart the pod.
- Run [[compromised-cloud-cluster-containment#Preserve evidence first]], then [[compromised-cloud-cluster-containment#Contain workloads]].
- If the pod belongs to a CI runner, use [[compromised-ci-runner-or-pipeline-identity]].
- Use [[kubernetes-packet-capture]] only if the containment lead asks for it.

> [!danger] Killing the pod destroys the evidence
> Deleting, restarting or scaling the workload loses memory, the container filesystem and `emptyDir` data. Containment there is done by quarantine, not deletion.

### 5. Benign: tune in Git, not in the console

- Add a narrow exception (rule, namespace, image repository and process) to the rules repository by MR, with the alert ID and the reason.
- Never disable the whole rule.
- Roll the change out like a policy ([[policy-rollout-audit-to-enforce]]).
- If the same benign alert fires twice in a week, the exception is overdue. Do not let on-call keep acknowledging it.

### 6. Close

Record the classification, time to decision, and the MR or incident link. Real or unknown cases get a review per [[blameless-postmortems]].

## Validation

- The case directory holds the pod YAML, logs and exec audit.
- The decision and its evidence are written in the ticket.
- For benign: the alert does not recur after the exception rolls out, and the rule still fires in a staging test (trigger it with a test shell in a throwaway pod).
- For real: the containment runbook's validation applies.

## Rollback

Triage is read-only. A rule exception is rolled back by reverting its MR. Containment rollback is in the containment runbook.

## Troubleshooting

| Symptom                           | Fix                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Pod already gone                  | Use node-level evidence and audit logs. Ask why the workload restarted; a crash after an exploit is common. |
| The exec query returns nothing    | Check the method name against one known exec in your audit logs. Data Access logs may be off.               |
| Alert lacks pod fields            | The event was outside a container (node level). Treat the node as suspect.                                  |
| Many identical alerts across pods | A rollout introduced the behaviour. Compare with the latest deploy before calling it an attack.             |

## Not verified

- Falco JSON field names (`output_fields`, `k8s.ns.name`, `k8s.pod.name`, `container.image.repository`, `proc.cmdline`) and SCC finding categories and fields.
- The GKE audit method name `io.k8s.core.v1.pods.exec.create`.
- `gcloud logging read --freshness`.
- Whether exec events are Admin Activity or Data Access.

## Related

- [[falco-vs-tetragon-vs-gke-threat-detection]]
- [[threat-detection-and-response-gcp-gke]]
- [[alert-and-runbook-standard]]
- [[pod-security-admission]]
- [[kubernetes-network-policies]]

## Sources

No page was read on 2026-11-24; see Not verified. To read before relying on the queries:

- [Falco output formatting](https://falco.org/docs/outputs/formatting): to read.
- [Security Command Center, GKE threats](https://docs.cloud.google.com/security-command-center/docs/gke-threats): to read.
- [Security Command Center, Added Binary Executed](https://docs.cloud.google.com/security-command-center/docs/findings/threats/added-binary-executed): to read.
