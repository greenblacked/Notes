---
title: Packet capture in Kubernetes with ephemeral debug containers
description: Capture traffic in a pod network namespace or on a node without restarting the workload, read the pcap with tshark, and handle the file safely.
type: runbook
tags:
  - runbooks
  - kubernetes
  - networking
  - security
created: 2026-10-17
modified: 2026-10-17
draft: false
---

Logs and metrics say that a connection failed. A packet capture says why: who sent the reset, whether a SYN got an answer, where retransmissions start. This runbook captures traffic in a pod's network namespace with an ephemeral debug container, or on the node with `nsenter`, without changing or restarting the workload. It then covers reading the capture with `tshark` and the rules for handling the file, because a pcap can hold credentials and personal data.

It is the evidence-gathering step for [[network-troubleshooting-dns-mtu-tls-load-balancers]]; decide what the capture should prove there first. For pods that do not start, use [[kubernetes-pod-troubleshooting]]. The rules for data inside captures follow [[pci-dss-and-gdpr-for-devops-logs-and-data]] and are not repeated here.

> [!warning] Not verified: versions, images and interface names
> Ephemeral container availability and the `kubectl debug` profiles depend on the Kubernetes and `kubectl` versions (ephemeral containers have been stable for some time, but check your cluster and client versions and the flags below with `kubectl debug --help`). Whether the `netshoot` image is still maintained, and which digest to pin, is **not verified**. Interface names for Calico, Cilium and GKE Dataplane V2 are **not verified** and differ by version and configuration. All sample output is illustrative and uses documentation addresses.

## When to use

- Intermittent resets, timeouts or retransmissions between two workloads, or between a workload and an external service, that logs cannot explain.
- You need to see the DNS queries, TLS handshake or HTTP exchange as it was on the wire.
- A load balancer, mesh sidecar or network policy is suspected of dropping or rewriting traffic.

Do not capture just to look: a capture is a data-handling event. Have a question, a filter that answers it, and a ticket number.

## Preconditions

- A ticket or incident reference. Captures are tied to one, and the file is stored under it.
- `kubectl` access, with `update` on `pods/ephemeralcontainers` for a pod capture, and rights to run a privileged pod for a node capture. In many clusters this is limited to a break-glass role; use it and record it.
- An approved debug image, pinned by digest and mirrored into your own registry (Artifactory or Artifact Registry). Pulling `latest` from a public registry during an incident is a supply chain risk. `nicolaka/netshoot` is a common choice that has `tcpdump`, `tshark`, `ss` and `ip`; resolve its digest once and mirror it.
- Disk space where the capture is written, and a time limit. Know the traffic rate before you start.
- The variables below, set once per shell.

```bash
NS="payments"                      # namespace of the pod
POD="my-service-7d9f6c9b8-abcde"   # the pod to capture
CONTAINER="app"                    # a container in that pod, for --target
# Change: your mirrored copy, pinned by digest (placeholder shown, not a real digest).
IMAGE="registry.example.com/debug/netshoot@sha256:<digest>"
TICKET="INC-1234"                  # reference used in file names
kubectl config current-context
kubectl get pod "$POD" -n "$NS" -o wide
```

## Steps

### 1. Choose where to capture

Capture at the narrowest point that can answer the question. A wide capture is slower to read and holds more data than you need.

| Where                                       | Use when                                                                                 | Cost and risk                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Pod network namespace (ephemeral container) | The question is about one pod's traffic. Default choice.                                 | Needs `NET_RAW`; sees traffic as the pod sees it, including plain text after a sidecar decrypts it. |
| Node, `nsenter` into the pod namespace      | The pod has no ephemeral container support, or the debug container is blocked by policy. | Needs a privileged node debug pod and host PID visibility.                                          |
| Node, host namespace, a pod's veth          | Compare what leaves the pod with what arrives at the node (drops in between).            | Privileged. Shows traffic of other pods if you do not filter.                                       |
| Node, the physical NIC                      | Encapsulation, node-to-node paths, NAT, MTU, load balancer health checks.                | Highest volume, most data, privileged. Filter hard.                                                 |

Capture on both sides of a suspected drop (the pod and the node veth, or the client and the server pod) and compare timestamps. Node clocks are normally synchronised; the difference between hosts is small but not zero.

### 2. Pod capture with `kubectl debug --target`

An ephemeral container joins the running pod. With `--target` it shares the process namespace of that container; the network namespace is shared by the whole pod either way. Nothing restarts.

```bash
kubectl debug -it "$POD" -n "$NS" \
  --image="$IMAGE" \
  --target="$CONTAINER" \
  --container=capture \
  --profile=netadmin \
  -- tcpdump -nni any -s 128 -w "/tmp/${TICKET}-${POD}.pcap" 'host 192.0.2.50 and tcp port 5432'
```

What the flags do:

- `-nn` turns off name and port lookups, which would add DNS traffic to your capture. `-i any` captures on all interfaces of the pod, in "cooked" format. It hides which interface a packet used; name `-i eth0` when it matters.
- `-s 128` is the snapshot length. It keeps the headers and the first part of the payload. For a header-only question use a smaller value; see the data handling step.
- `-w` writes a file. Without it `tcpdump` prints to the terminal, which is fine for a quick look but cannot be reread.
- The BPF filter at the end limits what is stored. Filter by host and port at capture time, not after. Examples: `port 53`, `tcp[tcpflags] & (tcp-syn|tcp-rst) != 0`, `host 198.51.100.10 and not port 22`.
- `--profile=netadmin` asks `kubectl` to add the network capabilities the tool needs. The profile names and what they add depend on the `kubectl` version (**not verified**); without it the debug container may lack `NET_RAW` and `tcpdump` will fail with "Operation not permitted".

Stop the capture with Ctrl-C when you have reproduced the problem, or bound it with `timeout`:

```bash
kubectl debug -it "$POD" -n "$NS" --image="$IMAGE" --target="$CONTAINER" --container=capture --profile=netadmin \
  -- timeout 120 tcpdump -nni any -s 128 -w "/tmp/${TICKET}-${POD}.pcap" 'host 192.0.2.50'
```

Copy the file out. An ephemeral container stays in the pod (it cannot be removed), but its process ends when `tcpdump` exits, and a stopped ephemeral container's filesystem may not be readable with `kubectl cp`, so copy while it is running, or stream from the start:

```bash
# Option 1: keep the container alive with a sleep, capture in the background, then cat the file out.
kubectl debug "$POD" -n "$NS" --image="$IMAGE" --target="$CONTAINER" --container=capture --profile=netadmin \
  -- sh -c "tcpdump -nni any -s 128 -w /tmp/cap.pcap -c 100000 'host 192.0.2.50' & sleep 300"
kubectl exec "$POD" -n "$NS" -c capture -- cat /tmp/cap.pcap > "${TICKET}-${POD}.pcap"

# Option 2: stream the capture to your terminal's stdout (no file in the pod). -U flushes each packet.
kubectl debug "$POD" -n "$NS" -q --image="$IMAGE" --target="$CONTAINER" --container=capture --profile=netadmin \
  --attach -- tcpdump -U -nni any -s 128 -w - 'host 192.0.2.50' > "${TICKET}-${POD}.pcap"
```

Whether `kubectl exec` and `--attach` behave as shown for ephemeral containers on your versions is **not verified**; test on a non-production pod first. Stream mode writes a pcap on your machine, so apply the same handling rules there.

If the pod cannot be touched, copy it: `kubectl debug "$POD" -n "$NS" --copy-to="${POD}-debug" --image="$IMAGE" --share-processes -- sleep 3600`. A copy shows the same configuration but not the live connections, so it does not help with a problem that exists only in the running pod.

### 3. Node capture and veth mapping

Use the node when the pod cannot take an ephemeral container (admission policy, an old cluster) or when you need the node side of the path.

```bash
NODE="$(kubectl get pod "$POD" -n "$NS" -o jsonpath='{.spec.nodeName}')"

# A privileged debug pod on the node; the host filesystem is at /host.
kubectl debug node/"$NODE" -it --image="$IMAGE" --profile=sysadmin
```

Inside the node debug pod, find the pod's process and enter its network namespace. First get the container ID from the pod, then ask the runtime for its PID.

```bash
# On your machine: the container ID of the target container (strip the containerd:// prefix).
kubectl get pod "$POD" -n "$NS" \
  -o jsonpath="{.status.containerStatuses[?(@.name=='${CONTAINER}')].containerID}{'\n'}"
```

```bash
# Inside the node debug pod. CID is the ID from above (without the containerd:// prefix).
CID="<container-id>"

# crictl lives on the node; the debug pod sees the host under /host. Path to crictl varies by node image.
chroot /host crictl inspect --output go-template --template '{{.info.pid}}' "$CID"
PID="<pid-from-previous-command>"

# Confirm the process is visible, then capture inside the pod's network namespace.
ls /proc/"$PID"/ns/net
nsenter -t "$PID" -n tcpdump -nni any -s 128 -w "/tmp/${TICKET}-node.pcap" 'host 192.0.2.50'
```

`nsenter -t PID -n` runs the command, here the debug image's own `tcpdump`, in the target's network namespace. The PID is only valid while the container runs; after a restart, look it up again. Whether the node debug pod sees host PIDs, and the `crictl` path on your node image (Container-Optimized OS or Ubuntu), is **not verified**.

To capture on the node side of the pod's link, map the pod's `eth0` to its host-side interface. The two ends of a veth pair know each other's index.

```bash
# Inside the pod namespace: the index of the peer interface.
nsenter -t "$PID" -n cat /sys/class/net/eth0/iflink
# Illustrative output: 47

# In the host namespace: which interface has that index.
ip -o link | awk -F': ' '$1 == 47 {print $2}'
# Illustrative output: cali5e2f8a91b3c@if3
```

Then capture on that interface in the host namespace:

```bash
tcpdump -nni cali5e2f8a91b3c -s 128 -w "/tmp/${TICKET}-veth.pcap" 'host 192.0.2.50'
```

Interface naming depends on the CNI. Treat this table as a starting point and confirm with `ip -o link` on the node.

| CNI / dataplane                        | Pod-side interface | Host-side interface of a pod (typical)                             | Other interfaces worth knowing                                        |
| -------------------------------------- | ------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Calico                                 | `eth0`             | `cali` + a hash of the pod                                         | `tunl0` or `vxlan.calico` when encapsulation is on                    |
| Cilium                                 | `eth0`             | `lxc` + a hash of the endpoint                                     | `cilium_host`, `cilium_net`, `cilium_vxlan` (tunnel mode)             |
| GKE Dataplane V2 (Cilium based)        | `eth0`             | A generated name, often `gke` + a hash (**not verified**)          | Cilium interfaces may be present under the same names; check the node |
| GKE default (no network policy engine) | `eth0`             | `veth` + a hash, attached to a bridge or routed (**not verified**) | `cbr0` on some node images                                            |

The host-side name is only a label. The `iflink` method above works for every CNI that uses veth pairs, so prefer it over guessing the pattern. A CNI that does not use veth pairs (some cloud-native ones) will not show a peer; read its documentation.

### 4. Filters and rotation

A capture without a limit fills a disk. Always bound it, either by time, by packets or by rotating files.

```bash
# Ring buffer: files of 100 million bytes (-C 100 means 100 * 1,000,000), keep the last 5 (-W 5).
# The oldest file is overwritten. Use it when waiting for an intermittent event.
tcpdump -nni any -s 128 -C 100 -W 5 -w "/tmp/${TICKET}.pcap" 'host 192.0.2.50 and tcp port 5432'

# Stop after N packets.
tcpdump -nni any -s 128 -c 50000 -w "/tmp/${TICKET}.pcap" 'port 53'

# Rotate every 60 seconds and keep the last 10 files.
tcpdump -nni any -s 128 -G 60 -W 10 -w "/tmp/${TICKET}-%H%M%S.pcap" 'host 192.0.2.50'
```

When the file is rotating, stop the capture soon after the event, or the ring will overwrite it. Note the exact time of the failure from your logs (in UTC) so you can find the right file.

Useful filters (BPF syntax, used by `tcpdump` and by `tshark -f`):

| Question                           | Filter                                             |
| ---------------------------------- | -------------------------------------------------- |
| Traffic to one peer and port       | `host 192.0.2.50 and tcp port 5432`                |
| Connection setup and teardown only | `tcp[tcpflags] & (tcp-syn\|tcp-fin\|tcp-rst) != 0` |
| Resets only                        | `tcp[tcpflags] & tcp-rst != 0`                     |
| DNS                                | `port 53`                                          |
| Exclude noise                      | `not (port 22 or port 9100)`                       |
| Large packets (MTU problems)       | `greater 1400`                                     |

### 5. Reading with `tshark`

Read the file on your own machine or in the debug image, not by opening it in a shared tool. `tshark` uses Wireshark's display filters with `-Y`.

```bash
PCAP="${TICKET}-${POD}.pcap"

# Overview: conversations by bytes and by packets, per TCP stream.
tshark -r "$PCAP" -q -z conv,tcp

# Retransmissions, with timestamps and streams.
tshark -r "$PCAP" -Y 'tcp.analysis.retransmission || tcp.analysis.fast_retransmission' \
  -T fields -e frame.time_relative -e ip.src -e ip.dst -e tcp.srcport -e tcp.dstport -e tcp.stream

# Resets: who sent them and when.
tshark -r "$PCAP" -Y 'tcp.flags.reset == 1' \
  -T fields -e frame.time_relative -e ip.src -e ip.dst -e tcp.stream

# Throughput and packet counts in 1 second buckets (find the moment it stalls).
tshark -r "$PCAP" -q -z io,stat,1

# Wireshark's own list of problems (retransmissions, zero windows, resets).
tshark -r "$PCAP" -q -z expert

# One stream in full, to follow a single failing connection (stream number from the commands above).
tshark -r "$PCAP" -Y 'tcp.stream == 12'
```

Illustrative `io,stat` output, where the gap shows a stall of about five seconds:

```text
| Interval  | Frames | Bytes |
| 0  <> 1   |   1480 | 1.9M  |
| 1  <> 2   |   1502 | 2.0M  |
| 2  <> 3   |      4 | 312   |
| 3  <> 4   |      0 | 0     |
| 7  <> 8   |   1430 | 1.8M  |
```

How to read what you see:

- **SYN with no SYN-ACK:** the packet did not reach the peer, or the reply was dropped. Check the other side of the path (a network policy, a firewall rule, a load balancer).
- **SYN-ACK then RST from the client:** the client does not accept the connection; look at the client's side (a source port reused, an application bug).
- **RST from the server mid-stream:** the application or a middlebox closed it. Compare with idle times; an RST after a long idle gap points at an idle timeout, covered in [[network-troubleshooting-dns-mtu-tls-load-balancers]].
- **Retransmissions in one direction, with large frames missing their ACK, while small packets work:** a path MTU problem. Check DF and the MSS in the SYN.
- **A TLS ClientHello with no ServerHello:** the server or a device in between does not answer; the content is encrypted, so the capture shows only that, and the cause is somewhere else.

### 6. Pod Security Admission and capability constraints

A capture tool needs raw socket access (`NET_RAW`), sometimes `NET_ADMIN`, and a node capture needs a privileged pod. These collide with pod security settings.

- Pod Security Admission restricts what a pod may ask for. A namespace at the `restricted` level refuses privileged pods and extra capabilities; the node debug pod runs in the namespace you give it, so use a namespace that allows it for the shortest time you can, and a dedicated one if you do this often. The admission levels and which capabilities each allows are in [[pod-security-admission]]. Whether an ephemeral container is checked against the pod's namespace level on your version is **not verified**: test it.
- Do not weaken a namespace level permanently to make this work. Use a labelled debug namespace, an audited break-glass role, or a policy exception with an expiry that follows your exception process.
- Admission policies that require signed images or approved registries apply to the debug image too, which is another reason to mirror and pin it.
- A pod with `readOnlyRootFilesystem` and no writable volume is not a problem for an ephemeral container, which has its own filesystem, but `/tmp` in that container is limited by node ephemeral storage. Keep captures small.
- Service meshes: with a sidecar, traffic between the app and the sidecar is plain text on the pod's loopback, and the mesh traffic leaving the pod is encrypted. Choose the interface with that in mind, and see [[service-mesh-on-gke]].

### 7. Data handling

A pcap can contain passwords, tokens, session cookies, personal data and card data, even when the connection is encrypted, because the unencrypted parts (DNS names, SNI, headers on plain HTTP, traffic inside a mesh sidecar) are in it. Treat every capture as sensitive from the first packet.

- **Capture the minimum.** Use a filter that names the peer and port, and a snapshot length that stops at the headers when the payload is not needed (`-s 96` is enough for TCP and IP headers in many cases; the right value depends on the options in use, which is **not verified**). Never capture a whole node's traffic "to be safe".
- **Say why.** Record the ticket, the person, the time range and the filter. Without that you cannot show later why the data was collected.
- **Keep the file in one controlled place.** Upload it to a restricted bucket or the incident folder, then delete every other copy: the ephemeral container's file (it goes when the pod is replaced), the node's `/tmp`, your laptop.
  ```bash
  gcloud storage cp "${TICKET}-${POD}.pcap" "gs://my-incident-evidence-bucket/${TICKET}/" # Change: your restricted bucket.
  shred -u "${TICKET}-${POD}.pcap" 2>/dev/null || rm -f "${TICKET}-${POD}.pcap"
  ```
- **Limit access.** Give read access to the people on the ticket only, through a group, with audit logging on the bucket. Do not attach a pcap to a ticket, a chat or an email.
- **Set a retention date.** Delete the capture when the investigation closes. The period and the rules for cardholder or personal data come from your compliance process and [[pci-dss-and-gdpr-for-devops-logs-and-data]]; follow them instead of choosing a number here. A bucket lifecycle rule enforces it so that it does not depend on memory.
- **Share derived output, not the file.** A `tshark` summary or the retransmission list usually answers the question without exposing the payload.

## Validation

- The capture contains the event you were after. Check by time: `tshark -r "$PCAP" -Y 'frame.time >= "2026-10-17 10:15:00"' -c 5` (use the time of the failure in your logs, same time zone).
- The pcap opens with `tshark -r "$PCAP" -q -z io,stat,0` without errors, and its packet count is not at the limit you set (a count at the limit means the event might be cut off).
- The pod is unchanged: same containers except the added ephemeral one, no new restarts.
  ```bash
  kubectl get pod "$POD" -n "$NS" -o jsonpath='{.status.containerStatuses[*].restartCount}{"\n"}'
  ```
- The file is in the evidence location and removed everywhere else.

## Rollback

A capture changes nothing in the workload, so rollback means cleaning up.

- An ephemeral container cannot be removed from a running pod. Its process has ended, and it disappears when the pod is replaced. Plan the next rollout or restart, and do not leave a privileged debug container running; use `timeout` to be sure.
- Delete debug pods and copies:
  ```bash
  kubectl delete pod "${POD}-debug" -n "$NS" --ignore-not-found
  kubectl get pods -A | grep node-debugger   # node debug pods are named node-debugger-<node>-<suffix>
  ```
  The node debug pod normally stays after you exit. Delete it, because it is privileged.
- Restore any namespace label, policy exception or role binding you changed for the capture, and note it in the ticket.
- Remove files from nodes (`/tmp` in the debug pod disappears with it) and from your machine.

## Troubleshooting

| Symptom                                                                  | Cause and fix                                                                                                                                  |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `tcpdump: Operation not permitted` or `You don't have permission`        | The debug container lacks `NET_RAW`. Use a debug profile that adds it, or a policy that allows the capability for this container.              |
| `kubectl debug` says ephemeral containers are not supported or forbidden | Old cluster, or no RBAC on `pods/ephemeralcontainers`. Use the node method or a pod copy.                                                      |
| Admission denies the debug pod                                           | Pod Security Admission, a policy engine or an image allow list. See [[pod-security-admission]]; use the approved image and namespace.          |
| `ImagePullBackOff` on the debug container                                | The digest is wrong or the registry needs a pull secret in that namespace. See [[kubernetes-pod-troubleshooting]].                             |
| Capture is empty                                                         | Wrong interface, or the filter excludes the traffic (NAT or a mesh rewrote the address). Try `-i any` with a broader filter for a few seconds. |
| Only one direction of traffic appears                                    | Asymmetric path, or you captured on an interface that sees one direction. Capture on `any` or on both ends.                                    |
| `tcpdump` reports "packets dropped by kernel"                            | The rate is too high for the buffer. Add a tighter filter, lower the snapshot length, or write to a faster location (`-B` raises the buffer).  |
| Timestamps do not line up with the logs                                  | Logs in local time versus UTC in the pcap, or clock offset between hosts. Compare in UTC and allow for a small offset.                         |
| PID not found or `nsenter` fails                                         | The container restarted (new PID), or the node debug pod cannot see host PIDs. Look up the PID again; check how the debug pod was created.     |
| The node's resources are strained during the capture                     | Stop it. Capture on a veth with a filter instead of the NIC, or use the pod method. Check [[node-resource-pressure-triage]].                   |
