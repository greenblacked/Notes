---
title: Compromised cloud project or cluster containment
description: Contain a suspected compromise of a GCP project, GKE workload, node pool or CI credential while keeping the evidence, then decide between clean-up and rebuild.
type: runbook
tags:
  - runbooks
  - security
  - incident-management
  - gcp
  - gke
created: 2026-10-17
modified: 2026-10-17
draft: false
---

Something in a GCP project, a GKE cluster or a CI system is probably controlled by someone who should not control it. This runbook isolates it without destroying the evidence. The order is fixed: **preserve, contain, investigate, and only then clean up or rebuild**. Deleting the pod, rebooting the node or wiping the service account feels like progress, but it removes the facts you need to know how far the attacker got.

> [!info] Scope and what was not checked
> The commands below use `gcloud` and `kubectl` as known; no vendor page was re-fetched and nothing was run, so the note is not marked `verified`. Check current `gcloud` flags with `--help` before an incident, not during it. General guidance only: legal, regulatory and customer notification duties are decided by your security lead and counsel.

## Triggers

Start this runbook when any of the following is credible, not only when it is proven:

- A Cloud Audit Log entry shows a service account or user acting from an address, region or time you do not recognise, or creating keys, service accounts, VMs, GPU instances or IAM bindings nobody asked for.
- A pod runs an unexpected image or process (a miner, a reverse shell, a shell in a distroless container), or makes outbound connections to addresses it never used.
- A node shows unexplained CPU load, new listening ports or processes outside any container.
- A CI runner, a GitLab token, an Artifactory token or a Workload Identity Federation pool is suspected of abuse. For a single leaked secret with no sign of use, [[leaked-credential-rotation]] is enough; come back here when the audit shows it was used.
- A security alert, a cloud provider notice or an external report says your project is involved in abuse.

If the trigger is only a failing pod with no sign of an attacker, use [[kubernetes-pod-troubleshooting]] instead.

## Preconditions

Settle these before an incident. Each one saves minutes while the clock is running.

- A forensic bucket in a **separate** project, with a retention policy, write access for responders and no access for the workloads under investigation. Evidence stored in the compromised project can be altered by the attacker.
- Responders with the roles to disable keys and service accounts, label pods, create NetworkPolicies, cordon nodes and create disk snapshots. Use break-glass accounts that are audited, not shared admin accounts.
- A cluster that enforces NetworkPolicy (GKE Dataplane V2 or Calico enforcement). Without it the quarantine policy below does nothing, see [[kubernetes-network-policies]].
- Audit logs on and retained long enough: Admin Activity logs are on by default; Data Access logs and Kubernetes audit data need to be enabled and exported, see [[gcp-audit-logs-siem]].
- A written list of what lives in the project, so you can judge the blast radius quickly.

## Roles and comms

Run this as a security incident under [[incident-response]]. Declare it at the severity that matches the reach of the suspected identity, not the size of the first symptom.

- **Incident commander:** owns decisions and the containment log. Does not type commands.
- **Ops lead:** runs the containment commands below, one at a time, and reads each result aloud in the channel.
- **Scribe:** keeps the time-stamped containment log (template at the end of the next section).
- **Security lead:** decides on disclosure, regulators and customers, with counsel.

Communication rules during a compromise:

- Use a channel the attacker cannot read. If the compromise could include chat, email or the CI system, move to an out-of-band channel (phone bridge, a separate workspace).
- Do not paste secrets, tokens or keys into chat, tickets or the log. Reference them by ID.
- Say "suspected compromise" until the security lead says otherwise. Do not discuss the incident outside the response group.
- Do not tell the suspect user or team before containment if an insider is possible. The security lead decides who is told and when.

## Preserve evidence first

Take a copy of what is volatile or easy to overwrite **before** you change anything. This takes minutes, not hours. Set the variables once and keep them in the log.

```bash
PROJECT=my-project                          # project under investigation
FORENSIC_BUCKET=gs://example-forensics-eu   # bucket in a separate project, with retention
INCIDENT=inc-20261017-suspected-compromise  # same name as the incident channel
CLUSTER=platform-1
LOCATION=europe-west1
NS=payments
POD=payments-api-7c9d8b6f5-abcde

mkdir -p "$INCIDENT" && cd "$INCIDENT"
```

Capture the Kubernetes view of the suspect workload:

```bash
kubectl get pod "$POD" -n "$NS" -o yaml > pod.yaml
kubectl describe pod "$POD" -n "$NS" > pod-describe.txt
kubectl logs "$POD" -n "$NS" --all-containers --timestamps > pod-logs.txt
kubectl logs "$POD" -n "$NS" --all-containers --previous --timestamps > pod-logs-previous.txt 2>/dev/null || true
kubectl get events -n "$NS" --sort-by=.lastTimestamp > events.txt
kubectl get networkpolicy,serviceaccount,rolebinding -n "$NS" -o yaml > ns-objects.yaml
```

Capture the cloud-side view of the identities involved, then upload with checksums:

```bash
gcloud projects get-iam-policy "$PROJECT" --format=json > iam-policy.json
gcloud iam service-accounts list --project "$PROJECT" --format=json > service-accounts.json

sha256sum ./* > SHA256SUMS
gcloud storage cp ./* "$FORENSIC_BUCKET/$INCIDENT/"
```

Rules of evidence:

- Record who collected each item, when (UTC) and with which command. Keep the originals unmodified and work on copies.
- Do not restart, delete or exec into the suspect pod to "have a look" yet. A process list and network connections from inside the container are valuable, but each action changes state. If you must look, use an ephemeral debug container and write down every command, and use an image pinned by digest from your own registry (for example `DEBUG_IMAGE=registry.example.com/tools/debug@sha256:<digest>`, as in [[node-resource-pressure-triage]]): `kubectl debug -it "$POD" -n "$NS" --image="$DEBUG_IMAGE" --target=<container>`. Whether the target container shares its process namespace for your image and runtime is not verified; test it in a lab first.
- Memory contents and running processes disappear on reboot. A disk snapshot (next sections) does not capture them. Decide with the security lead whether live memory capture is worth it for this incident; it needs tooling prepared in advance.

A time-stamped containment log lets you reconstruct what was done and by whom, and it is the first thing the postmortem needs. Keep it append-only (a shared document with edit history, or a file in the forensic bucket):

```text
CONTAINMENT LOG  incident: inc-20261017-suspected-compromise
Times are UTC. One line per action. Record the result, not just the command.

2026-10-17T09:12Z  scribe=<name>   Incident declared, severity SEV1 (provisional). Commander=<name>.
2026-10-17T09:15Z  ops=<name>      Evidence copied to <bucket>/<incident>/ . SHA256SUMS present: yes/no.
2026-10-17T09:21Z  ops=<name>      Disabled key <KEY_ID> on <SA>. Result: <ok / error text>.
2026-10-17T09:24Z  ops=<name>      Labelled pod <POD> quarantine=true. Policy applied: yes. Egress test from pod: blocked.
2026-10-17T09:30Z  ops=<name>      Cordoned node <NODE>. No drain. Autoscaler scale-down disabled on node: yes/no.
2026-10-17T09:41Z  ops=<name>      Snapshot <NAME> of disk <DISK> created, status READY at 09:48Z.
2026-10-17T09:55Z  commander=<name> Decision: <rebuild / clean>. Reason: <text>. Approved by: <name>.

Open questions:
- <what we do not yet know>
```

## Contain identities

Identities are usually the fastest route for an attacker and the fastest thing to cut. Work from the most powerful identity down, and do it before touching workloads, because a running attacker can re-create what you delete.

**1. Disable (not delete) service account keys.** Disabling is reversible and keeps the key record for the investigation.

```bash
SA=ci-deployer@my-project.iam.gserviceaccount.com

gcloud iam service-accounts keys list --iam-account "$SA" --managed-by=user \
  --format="table(name.basename(),validAfterTime,validBeforeTime,disabled)"

KEY_ID=0123456789abcdef   # each user-managed key found; repeat for every one
gcloud iam service-accounts keys disable "$KEY_ID" --iam-account "$SA"
```

**2. Disable the service account itself** when keys are not the only route, or you cannot list what it did. This stops it authenticating by any means, including impersonation by other principals.

```bash
gcloud iam service-accounts disable "$SA"
```

Short-lived access tokens that were already issued may keep working until they expire. How long this takes for your token type is not verified; assume up to an hour and keep watching the audit log after disabling.

**3. Review the attacker's persistence in IAM.** Compare the IAM policy you saved with the last known good one (from Terraform state or version control). Look for bindings you did not create, new service accounts, new keys and changes to `iam.serviceAccountTokenCreator` or `iam.serviceAccountUser` on powerful accounts. Revert only after the evidence is saved. Reverting through Terraform is fine; leave the unauthorised resources in place (disabled) until they are documented.

**4. Cut CI trust paths.** If a CI credential is suspected:

- Revoke GitLab and Artifactory tokens as described in [[leaked-credential-rotation]], and rotate the runner registration token.
- If the runner authenticated to GCP through Workload Identity Federation, disable the pool provider so no new tokens can be exchanged. The flag below is not verified, check `--help`:

```bash
POOL=gitlab-ci
PROVIDER=gitlab-oidc
gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" \
  --workload-identity-pool="$POOL" --location=global --project "$PROJECT" --disabled
```

- Pause pipelines that deploy to the affected project and treat recent artifacts as untrusted until you re-verify them, see [[artifact-promotion-artifactory]].

**5. Human accounts.** Suspend the user in the identity provider, revoke their sessions and tokens, and reset credentials. Keep the account for the investigation; do not delete it.

Do not hand out new broad credentials to "help the response". Responders use their own audited identities.

## Contain workloads

Quarantine the suspect pods without killing them. A quarantine label selects a deny-all NetworkPolicy, and the pod's other labels are changed so no allow policy still selects it. The process keeps running (and its memory and filesystem stay intact) but it cannot reach the network. `kubectl exec` and `kubectl logs` still work because they go through the API server and kubelet, not the pod network.

> [!warning] A NetworkPolicy cannot override another policy's allow
> NetworkPolicies are allow-only and additive. If any other policy in the namespace (for example an `app=payments` allow) also selects the pod, its allows still apply, and the quarantine policy blocks nothing. In a namespace that already has policies this gives false containment. So isolation needs a check, then one of two methods. First list every policy that selects the pod: `kubectl get networkpolicy -n "$NS" -o yaml` and compare each `podSelector` (including an empty `podSelector: {}`, which selects every pod in the namespace and cannot be escaped by relabelling, and `matchExpressions` with `NotIn` or `DoesNotExist`, which can start selecting the pod once its labels are removed and so add an allow) with the pod's full label set (`kubectl get pod "$POD" -n "$NS" --show-labels`). Then either (a) strip every label that any policy or Service selects, keeping only `quarantine=true`, which works only if no policy selects all pods; or (b) use a priority deny that is evaluated before the allows, for example a Calico `GlobalNetworkPolicy` with a low `order` and `action: Deny`, or a Cilium deny policy. Option (b) depends on the CNI, and whether it is available on GKE Dataplane V2 is not verified. The pod counts as contained only after the connectivity probe below proves both directions blocked.

Apply the policy once per affected namespace. It does nothing until a pod carries the label:

```yaml title="quarantine-deny-all.yaml"
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: quarantine-deny-all
  namespace: payments # change to the namespace of the suspect pod
spec:
  podSelector:
    matchLabels:
      quarantine: "true"
  policyTypes:
    - Ingress
    - Egress
```

```bash
kubectl apply -f quarantine-deny-all.yaml
kubectl label pod "$POD" -n "$NS" quarantine=true
# (a) List the policies in the namespace and the pod's full label set, then check which policies select it.
kubectl get networkpolicy -n "$NS" -o yaml
kubectl get pod "$POD" -n "$NS" --show-labels
# Strip every label that a policy or Service selects (example keys: app, tier); keep only quarantine=true.
# Removing the controller's selector label also orphans the pod (see "Replacement pods").
kubectl label pod "$POD" -n "$NS" app- tier-
```

Points that matter:

- **Replacement pods.** Removing the labels in the quarantine step (`app` and `tier` are examples; remove every label a policy or Service selects) changes the label the ReplicaSet selects on, so the pod is orphaned but keeps running, and the ReplicaSet starts a replacement. Before you relabel, scale or pause the Deployment if the replacement could run the same compromised image or credentials.
- **Service traffic.** The quarantined pod is cut off by the policy; also remove it from Service endpoints (removing the selected labels above does that) so users stop hitting it.
- **Existing connections.** Whether a policy terminates connections that are already established depends on the dataplane; this is not verified. Test it in a lab. If it matters, assume an established session may survive and rely on cutting the credentials in the previous section.
- **Policy enforcement (mandatory).** Confirm the quarantine works in both directions: exec into a different pod in the namespace and check that the quarantined pod's IP is unreachable (ingress), and test egress from the pod with a debug container. Do not treat the pod as contained until both probes fail to connect. Record the result in the log.
- **Scale to zero is not containment.** `kubectl scale --replicas=0` deletes the pods and their state. Do it only after evidence is saved.
- **Namespace-wide compromise.** Apply a deny-all policy to the whole namespace and keep only the allows you need for the response, see [[kubernetes-network-policies]]. Also review the namespace for pods that run privileged or with host access, see [[pod-security-admission]].
- Workload Identity bindings: remove the binding that lets the Kubernetes service account impersonate the Google service account, see [[gke-workload-identity]]. This cuts cloud access even if the pod keeps running.

## Contain nodes

When the pod is not the whole story (container escape suspected, unexpected processes on the node, node credentials abused), act on the node.

**Cordon, do not drain.**

```bash
NODE=gke-platform-1-default-pool-5b6c7d8e-xyz1

kubectl cordon "$NODE"
```

`cordon` marks the node unschedulable, so no new pods land on it, and leaves everything running. `drain` evicts the pods, which kills processes, loses memory contents, `emptyDir` data and container filesystems, and moves the workload (and possibly the attacker's foothold) to healthy nodes. Evict only after evidence is captured and the decision to rebuild is made.

Stop the platform from "helping" by removing the node:

```bash
# Prevent the cluster autoscaler from removing the node when it looks underused.
kubectl annotate node "$NODE" cluster-autoscaler.kubernetes.io/scale-down-disabled=true
```

Node auto-repair and auto-upgrade can also recreate a node and delete its disk. Check the node pool settings and, with the security lead's agreement, turn them off for the pool while the investigation runs (flag names are not verified, check `--help`):

```bash
POOL_NAME=default-pool
gcloud container node-pools describe "$POOL_NAME" --cluster "$CLUSTER" --location "$LOCATION" \
  --format="value(management.autoRepair,management.autoUpgrade)"
gcloud container node-pools update "$POOL_NAME" --cluster "$CLUSTER" --location "$LOCATION" \
  --no-enable-autorepair
```

**Snapshot the disks before anything is deleted.** Find the node's VM and its disks, then snapshot them:

```bash
ZONE=europe-west1-b

gcloud compute instances describe "$NODE" --zone "$ZONE" --project "$PROJECT" \
  --format="value(disks[].source.basename())"

DISK=gke-platform-1-default-pool-5b6c7d8e-xyz1   # boot disk name from the command above
# GCE names: 63 characters or fewer, lowercase, starting with a letter. Keep incident and node in --description.
SNAP="ir-20261017-${NODE: -12}-boot"
echo "${#SNAP} characters"   # must be 63 or fewer
gcloud compute disks snapshot "$DISK" --zone "$ZONE" --project "$PROJECT" \
  --snapshot-names "$SNAP" \
  --description "incident ${INCIDENT}, node ${NODE}, boot disk" \
  --storage-location europe-west1

gcloud compute snapshots describe "$SNAP" --project "$PROJECT" \
  --format="value(status)"   # wait for READY
```

Repeat for every persistent disk attached to workloads you are investigating (`kubectl get pv` shows the disk names). Snapshots live in the same project as the source disk, so the attacker can delete them if they still have project access: finish the identity containment first, then limit who can delete snapshots, or copy the data into the forensic project.

> [!warning] Snapshots capture disk, not memory
> Do not stop or reboot the VM to make the snapshot "cleaner". A running-process view disappears with it. Whether a snapshot of a node's disk is useful for your node image (for example Container-Optimized OS with a read-only root, where most state is in `/var` and container layers) is not verified; confirm with your security team which paths hold evidence in your image.

**Network containment of the VM.** If the node itself is controlled, a firewall rule or a network tag that denies egress is the node-level equivalent of the pod quarantine. Prefer a rule that denies egress from the node tag over deleting the VM. Keep the rule's name and time in the log.

## Logs to pull

Pull logs for every identity and workload in scope, for the last 7 days at minimum, longer if the first sign was older. Export to the forensic bucket; do not rely on the 30-day default retention of the `_Default` log bucket if the attack is older (retention is configurable, check yours).

Everything an identity did over 7 days, oldest first:

```bash
PRINCIPAL=ci-deployer@my-project.iam.gserviceaccount.com

gcloud logging read \
  "protoPayload.authenticationInfo.principalEmail=\"$PRINCIPAL\"" \
  --project "$PROJECT" --freshness=7d --order=asc --format=json \
  > "audit-${PRINCIPAL%%@*}.json"
```

Narrow the view to the high-signal calls:

```bash
gcloud logging read \
  "protoPayload.authenticationInfo.principalEmail=\"$PRINCIPAL\" AND (
     protoPayload.methodName:\"CreateServiceAccountKey\" OR
     protoPayload.methodName:\"SetIamPolicy\" OR
     protoPayload.methodName:\"CreateServiceAccount\" OR
     protoPayload.methodName:\"compute.instances.insert\" OR
     protoPayload.methodName:\"UpdateSink\")" \
  --project "$PROJECT" --freshness=7d --order=asc \
  --format="table(timestamp,protoPayload.methodName,protoPayload.resourceName,protoPayload.requestMetadata.callerIp)"
```

Kubernetes API activity (exec, secrets reads, new bindings):

```bash
gcloud logging read \
  'resource.type="k8s_cluster" AND resource.labels.cluster_name="'"$CLUSTER"'" AND (
     protoPayload.methodName:"pods.exec" OR
     protoPayload.methodName:"secrets.get" OR
     protoPayload.methodName:"rolebindings.create" OR
     protoPayload.methodName:"clusterrolebindings.create")' \
  --project "$PROJECT" --freshness=7d --order=asc --format=json > k8s-audit.json
```

Method names such as `pods.exec` and the availability of `secrets.get` events depend on which audit log types are enabled and on your cluster version; this is not verified. If a log type was off, say so in the findings: absence of entries is then not evidence of absence.

Also collect:

- VPC Flow Logs and firewall logs for the node and pod ranges, if enabled, to find outbound connections and data volume.
- Cloud DNS query logs, if enabled, for lookups of unusual domains.
- GitLab audit events, runner job logs and Artifactory access logs for the CI side.
- Cloud Storage and BigQuery data access logs for the buckets and datasets the identity could read.
- Billing or quota spikes, which are often the first sign of abuse (new VMs or GPUs).

For ready-made queries over a long period, route logs to a SIEM, see [[gcp-audit-logs-siem]].

Indicators to search for: callers from unfamiliar IPs or regions; activity at odd hours for the identity; first-ever use of an API by that identity; `SetIamPolicy`, key creation, new sinks or sink changes (an attacker hiding their trail); deletion of logs or snapshots; reads from many buckets; calls that succeed from a user-agent you do not use.

## Rebuild versus clean decision

Decide explicitly, in writing, with the security lead. The default for anything that ran attacker code with real credentials is **rebuild**.

| Question                                                                | Points to rebuild                          | Points to clean                              |
| ----------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------- |
| Did the attacker have code execution on a node or as cluster admin?     | Yes                                        | No, only a leaked key that was cut off early |
| Can you list everything they changed, with high confidence?             | No: logs missing or gaps                   | Yes: full audit trail, nothing unexplained   |
| Did they reach secrets, signing keys or the registry?                   | Yes or unknown                             | Verified no                                  |
| Is the infrastructure code-defined (Terraform, Helm, images in a repo)? | Yes, rebuild is cheap and repeatable       | No, state lives in hand-edited resources     |
| Did they touch CI, runners or image build and promotion?                | Yes: treat all recent artifacts as tainted | No                                           |
| Cost of downtime versus cost of a missed backdoor                       | Backdoor risk dominates for sensitive data | Downtime would be severe and risk is low     |

If you rebuild:

- Build a new node pool or cluster from code, from known-good images rebuilt from source, not from the compromised registry. Rotate **all** secrets the old environment could read, including database passwords, API keys and signing keys. Rotation is covered in [[leaked-credential-rotation]].
- Move traffic over, then retire the old environment after the evidence is safe in the forensic bucket and the security lead agrees.
- Re-verify anything restored from backups for tampering.

If you clean:

- Remove only what you can fully explain, and keep monitoring for the same indicators for at least as long as the attacker was present. Write down the evidence that supports "clean".

Whichever you choose, keep the decision, the reason and who approved it in the log.

## Hand-off to recovery and postmortem

- **Hand-off.** The incident commander hands the environment to the owning team with a written list: what was disabled and must stay disabled, what was snapshotted and where, what stays quarantined, and which credentials were rotated. Nothing is re-enabled without the security lead's agreement.
- **Evidence.** The forensic bucket keeps its retention policy. Record where each item lives and who may access it. Keep it as long as your policy and counsel require; the period is not stated here.
- **Notification.** The security lead, with counsel, decides on notifying customers, partners and regulators. Some regimes set deadlines; ask your security or legal contact, this note does not state them.
- **Postmortem.** Hold a [[blameless-postmortems|blameless postmortem]] that asks which control was missing: long-lived keys, no deny-all policy, missing audit logs, too-broad roles. Turn each answer into a tracked action. Feed the findings into the threat register in [[platform-threat-modelling]].
- **Process review.** Compare what you did against a published incident handling guide such as NIST SP 800-61. Its current revision and date are not verified here; check the NIST site for the latest.
- **Prevention.** Replace service account keys with [[gke-workload-identity|Workload Identity]] and federation, block key creation with an organisation policy, alert on key creation and IAM policy changes, and apply default-deny network policies.

## Validation

Containment is real only when you have checked it:

```bash
gcloud iam service-accounts keys list --iam-account "$SA" --managed-by=user \
  --format="table(name.basename(),disabled)"                        # every key disabled
gcloud iam service-accounts describe "$SA" --format="value(disabled)"   # True if the account is disabled
kubectl get pod "$POD" -n "$NS" --show-labels                       # quarantine=true present
kubectl get node "$NODE"                                            # SchedulingDisabled
gcloud logging read "protoPayload.authenticationInfo.principalEmail=\"$SA\" AND timestamp>=\"$(date -u -d '-15 min' +%FT%TZ)\"" \
  --project "$PROJECT" --limit=10                                   # no new activity
```

Success looks like: no new audit entries for the contained identities after the token lifetime has passed, no outbound traffic from the quarantined pod, and every snapshot in `READY` state.

## Rollback and reversibility

- Disabled keys and disabled service accounts can be re-enabled (`keys enable`, `service-accounts enable`). Do that only on the security lead's instruction, never to "see if it fixes the outage".
- Removing the quarantine label (`kubectl label pod "$POD" -n "$NS" quarantine-`) restores the pod's network access. Do it only after the pod is deleted or cleared.
- `kubectl uncordon "$NODE"` returns the node to scheduling. Re-enable node auto-repair afterwards.
- Deleted keys, deleted snapshots and drained pods cannot be recovered, which is why this runbook disables, labels and cordons instead.
