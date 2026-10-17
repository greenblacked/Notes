---
title: Kernel and sysctl tuning for Kubernetes nodes
description: The Linux kernel limits that cause intermittent failures on Kubernetes nodes, how to measure each, and where to change it on GKE, self-managed nodes and in a pod.
type: pattern
tags:
  - patterns
  - kubernetes
  - gke
  - linux
  - reliability
created: 2026-10-17
modified: 2026-10-17
draft: false
---

Most node problems are not CPU or memory. A full connection tracking table drops packets at random. A small `inotify` limit makes a log shipper fail to start. A narrow ephemeral port range makes one busy client fail to connect. These limits are kernel parameters (sysctls), the defaults suit a small machine, and the symptoms look like flaky applications. This note lists the parameters that bite most often, how to measure each before changing anything, and who owns the change: the node, the node pool configuration, or the pod.

The rule is the one from performance work in general: measure, change one thing, measure again. A sysctl copied from a blog post into every node is a change nobody can explain later.

> [!warning] Not verified: defaults, supported keys and version-specific lists
> Defaults below are typical upstream Linux values and vary with kernel version, memory size and node image. These items are **not verified**: the safe sysctl list per Kubernetes version, which sysctl keys GKE accepts in node system configuration (and whether a change recreates the nodes), Container-Optimized OS defaults, and the exact `node_exporter` metric names in your version. Read the current GKE and Kubernetes documentation and check on a test node pool before relying on a value.

## Measure before tuning

Get a shell on the node as described in [[node-resource-pressure-triage]], then read the counters. If the counter shows no pressure, the parameter is not your problem and changing it only adds risk.

```bash
# On the node (or in a node debug pod with the host namespaces).
sysctl net.netfilter.nf_conntrack_max net.core.somaxconn net.ipv4.ip_local_port_range \
       fs.inotify.max_user_watches fs.inotify.max_user_instances vm.max_map_count fs.file-max
cat /proc/sys/fs/file-nr          # allocated, unused, maximum file handles
dmesg -T | grep -iE "nf_conntrack: table full|SYN flooding|Too many open files" | tail
```

Keep the "before" values in the ticket or the change description. The table below is the summary; each parameter has a section after it.

| Parameter                                             | Typical default (upstream, **not verified** on COS)                | Symptom when too low                                                                           | Measure                                                         | Safe change                                               | Owner                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| `net.netfilter.nf_conntrack_max`                      | Scales with node memory                                            | Random timeouts and resets, `nf_conntrack: table full, dropping packet`                        | `conntrack -S`, `nf_conntrack_count` against `nf_conntrack_max` | Raise the max in steps; check memory cost                 | Node (GKE node system config or `sysctl.d`)         |
| `net.core.somaxconn`                                  | 4096 on recent kernels, 128 on old ones                            | Connection refusals or SYN retries under bursts, listen queue overflow                         | `nstat -az TcpExtListenOverflows TcpExtListenDrops`, `ss -ltn`  | Raise together with the app's own listen backlog          | Node, or pod if it is a safe sysctl on your version |
| `net.ipv4.tcp_max_syn_backlog`                        | 1024 to a few thousand, scales with memory                         | SYN drops, "possible SYN flooding" in the log                                                  | `dmesg`, `nstat -az TcpExtTCPReqQFullDrop`                      | Raise with `somaxconn`                                    | Node                                                |
| `net.ipv4.ip_local_port_range`                        | 32768 to 60999                                                     | `EADDRNOTAVAIL` or "cannot assign requested address" on outgoing connections                   | `ss -tan` counts per destination, `ss -s`                       | Widen the range, but reuse connections first              | Pod (safe sysctl) or node                           |
| `fs.inotify.max_user_watches` / `max_user_instances`  | Instances often 128, watches scales with memory                    | "too many open files" or "no space left on device" from file watchers, agents failing to start | per-user inotify count (command below)                          | Raise both moderately; each watch costs kernel memory     | Node                                                |
| `vm.max_map_count`                                    | 65530                                                              | Search engines, JVM or mmap-heavy apps fail with "map failed" or out-of-memory with free RAM   | `wc -l /proc/PID/maps`, application error                       | Set to the value the application's documentation asks for | Node                                                |
| File descriptors: `fs.file-max`, per process `nofile` | `file-max` scales with memory; `nofile` set by the runtime or unit | "too many open files" in one process or node-wide                                              | `cat /proc/sys/fs/file-nr`, `ls /proc/PID/fd \| wc -l`          | Raise the `nofile` limit of the service first             | Node and runtime (containerd unit), or app          |

## nf_conntrack

Connection tracking (conntrack) records every flow that passes through the node's netfilter: Service NAT (kube-proxy), host ports, masquerading, and many network policy implementations. The table has a fixed maximum. When it is full the kernel drops packets for new flows, silently from the application's point of view.

Measure:

```bash
# Per-CPU counters; look at insert_failed, drop and early_drop.
conntrack -S

# Used entries and the limit.
cat /proc/sys/net/netfilter/nf_conntrack_count
cat /proc/sys/net/netfilter/nf_conntrack_max
cat /proc/sys/net/netfilter/nf_conntrack_buckets 2>/dev/null

# Which source addresses hold the most entries (a few noisy clients or one service is typical).
conntrack -L 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i ~ /^src=/) {print $i; break}}' | sort | uniq -c | sort -rn | head
```

Illustrative `conntrack -S` output; `insert_failed` and `drop` rising means the table is full or racing:

```text
cpu=0  found=0 invalid=312 insert=0 insert_failed=4821 drop=4821 early_drop=0 error=0 search_restart=1190
```

Reading it:

- `nf_conntrack_count` close to `nf_conntrack_max`: the table is full. Raise the limit, but first find why. A single chatty service that opens a connection per request, or a client that never reuses connections, is a cause you should fix at the source.
- Many entries in `TIME_WAIT` or `CLOSE_WAIT` point at connection handling in the app. Lowering the timeouts hides the problem and can break long connections, so do it only as a considered change.
- Memory: each entry costs memory in the kernel. Raising the maximum to a very large number on a small node trades packet loss for memory pressure.
- Which `conntrack` sysctls GKE lets you set, and the node image defaults, are **not verified**. On the GKE versions that expose them, set them through the node system configuration below; do not hand-edit nodes that autoscaling and upgrades will replace.

Alert before it is full. With `node_exporter`'s conntrack collector enabled, the two metrics are `node_nf_conntrack_entries` and `node_nf_conntrack_entries_limit` (names **not verified** for your version; check with `curl -s localhost:9100/metrics | grep conntrack`).

```yaml title="prometheus-rules/node-conntrack.yaml"
groups:
  - name: node-conntrack
    rules:
      - alert: NodeConntrackTableNearlyFull
        # More than 80 percent of the conntrack table in use for 10 minutes.
        expr: node_nf_conntrack_entries / node_nf_conntrack_entries_limit > 0.8
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Conntrack table above 80 percent on {{ $labels.instance }}"
          description: >-
            Packets for new connections are dropped when the table is full.
            Check conntrack -S, find the top talkers, then raise nf_conntrack_max
            or fix the connection pattern. See the node sysctls pattern.
```

Alert thresholds and the burn-rate approach for services are in [[slo-burn-rate-alerting]]; this is a cause alert, not an SLO alert, so keep it at warning severity.

## somaxconn and SYN backlog

A listening socket has two queues: half-open connections (the SYN backlog) and fully established ones waiting for `accept()` (the accept queue). `net.core.somaxconn` caps the accept queue of every listener, and the application's own `listen(backlog)` value is cut down to it. A burst of new connections to a slow-to-accept server overflows the queue and the kernel drops or resets them.

```bash
# Overflow counters since boot. Rising numbers mean the queue is too small or the app accepts too slowly.
nstat -az TcpExtListenOverflows TcpExtListenDrops TcpExtTCPReqQFullDrop

# Per listening socket: Recv-Q is the current accept queue, Send-Q is its maximum.
ss -ltn
```

Raising `somaxconn` only helps if the application also asks for a larger backlog (for example nginx `listen ... backlog=`, or the `server.tomcat.accept-count` family of settings in Java servers). If `Recv-Q` is near `Send-Q` often, the app is the bottleneck and a larger queue only delays the problem. Check the app's own threads and the concurrency limits in [[timeouts-retries-load-shedding]].

## ip_local_port_range

Each outgoing connection to one destination address and port needs a free local port. With the default range of about 28,000 ports, a pod that makes many short connections to one backend (a database proxy, one API) can run out, mostly through ports stuck in `TIME_WAIT`. The error is `EADDRNOTAVAIL`, or "cannot assign requested address".

```bash
# Local ports in use per destination, top ten.
ss -tan | awk 'NR>1 {print $5}' | sort | uniq -c | sort -rn | head
ss -s                                  # totals, including timewait
ss -tan state time-wait | wc -l
```

The better fix is connection reuse: HTTP keep-alive, a connection pool, or a pooler in front of the database ([[postgres-connection-pooling-gke]]). Widening the range is the stop-gap. It is applied per pod, because it only affects that pod's network namespace.

## inotify limits

Agents that watch many files (log shippers, kubelet-adjacent tools, IDE-like dev servers, config reloaders) use `inotify`. The limits are per user ID across the node, and every container running as the same UID shares them. Hitting them gives confusing errors: "too many open files" or "no space left on device" even though neither is true.

```bash
sysctl fs.inotify.max_user_watches fs.inotify.max_user_instances

# inotify instances in use per process, highest first.
for p in /proc/[0-9]*; do
  n=$(find "$p/fd" -lname 'anon_inode:inotify' 2>/dev/null | wc -l)
  [ "$n" -gt 0 ] && echo "$n ${p#/proc/} $(tr '\0' ' ' < "$p/cmdline" | cut -c1-80)"
done | sort -rn | head
```

Raise both limits moderately. The memory cost per watch is small, but a very high value on a node full of watchers adds up. If one workload uses thousands of instances, fix that workload, because one pod can starve every other pod that shares its UID.

## vm.max_map_count

This limits the memory mappings of a process. Elasticsearch and OpenSearch, some JVM and database workloads ask for a higher value (their documentation gives the number). With too low a value they fail at startup or later with "max virtual memory areas vm.max_map_count is too low" or mmap errors, even with plenty of free RAM.

```bash
sysctl vm.max_map_count
wc -l /proc/PID/maps               # mappings of one process
```

This is a node-level setting, and it affects every pod on the node. Put workloads that need it on a dedicated node pool with the setting applied, and use a node selector or taint to keep others off. See [[stateful-workloads-gke]] for where such workloads usually run.

## File descriptors

There are two limits: the node-wide maximum (`fs.file-max`) and the per-process `nofile` limit that a container inherits from the container runtime service. The second is the one that usually bites.

```bash
cat /proc/sys/fs/file-nr                 # allocated  unused  max
ulimit -n                                # soft limit in your shell
cat /proc/PID/limits | grep "open files"
ls /proc/PID/fd | wc -l                  # descriptors in use by one process
```

Fix it where it is set: the application (connection leaks), the container runtime's service limit, or a security context in the pod spec where your runtime allows it. Do not raise `fs.file-max` first; if a single process hits its own limit, the node-wide value is not involved.

## GKE node system config versus self-managed sysctl.d

On GKE Standard, change node sysctls through the node pool's system configuration, not by SSH. The setting is part of the node pool, so it survives upgrades and autoscaling. In Autopilot, you cannot change node-level sysctls; ask for a Standard node pool or use pod-level sysctls where allowed.

```yaml title="node-system-config.yaml"
# Applies to every node in the pool. Keys and value ranges are validated by GKE; supported keys are not verified here.
linuxConfig:
  sysctl:
    net.core.somaxconn: "4096"
    net.ipv4.tcp_max_syn_backlog: "4096"
    net.netfilter.nf_conntrack_max: "524288" # Change: size from your measurements and node memory.
    vm.max_map_count: "262144" # Change: only on pools that run workloads that need it.
```

```bash
POOL="highconn-pool"
CLUSTER="my-cluster"
REGION="europe-west1"

# New pool with the configuration (preferred: roll workloads onto it).
gcloud container node-pools create "$POOL" \
  --cluster "$CLUSTER" --region "$REGION" \
  --system-config-from-file=node-system-config.yaml

# Or update an existing pool. Whether this recreates the nodes is not verified: plan for it.
gcloud container node-pools update "$POOL" \
  --cluster "$CLUSTER" --region "$REGION" \
  --system-config-from-file=node-system-config.yaml
```

Do both in Terraform for real clusters, in the node pool's `node_config.linux_node_config.sysctls` block (check the argument names for your provider version), so the setting is reviewed and repeatable. Use a dedicated node pool for the unusual settings and keep the default pool at the defaults, so a change cannot affect every workload.

For nodes you manage yourself (not GKE-managed, or a Chef-managed host), use a drop-in file, never edit `/etc/sysctl.conf` by hand:

```ini title="/etc/sysctl.d/90-k8s-node.conf"
# Managed by configuration management. Values come from measurements in the change ticket.
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.netfilter.nf_conntrack_max = 524288
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 1024
```

```bash
sudo sysctl --system                    # reload all drop-in files
sysctl net.core.somaxconn               # confirm the live value
```

With Chef, use the built-in `sysctl` resource so that the value is also applied at runtime and converges on every run, and check the attributes against your Chef version:

```ruby title="cookbooks/node_tuning/recipes/default.rb"
{
  'net.core.somaxconn' => 4096,
  'net.netfilter.nf_conntrack_max' => 524_288,
}.each do |name, setting|
  sysctl name do
    value setting
  end
end
```

Avoid privileged DaemonSets that write sysctls on every node. They run with host-level rights, they race the workloads at node start, and they are hard to audit. They are a last resort for a platform that gives you no other way, and they need review under [[pod-security-admission]].

## Pod-level safe and unsafe sysctls

Some sysctls are namespaced, which means a pod can set them for its own network or IPC namespace without affecting the node. Kubernetes splits them into **safe** and **unsafe**. Safe ones can be set in a pod spec with no node configuration. Unsafe ones are refused unless the cluster admin allows them on the kubelet, which on GKE means a node pool setting, so ask the platform team.

The safe list has changed between Kubernetes versions (for example, some network and keepalive settings were added over time), so read the list for your cluster version (**not verified** here). `net.ipv4.ip_local_port_range` is in the safe list on recent versions.

```yaml title="deployment.yaml (excerpt)"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-client
  namespace: payments
spec:
  selector:
    matchLabels:
      app: api-client
  template:
    metadata:
      labels:
        app: api-client
    spec:
      securityContext:
        runAsNonRoot: true
        sysctls:
          - name: net.ipv4.ip_local_port_range
            value: "1024 65000" # Change: pick from measurement; keep clear of ports the pod listens on.
      containers:
        - name: app
          image: registry.example.com/payments/api-client:1.4.2 # Change: your image, pinned.
          resources:
            requests: { cpu: 250m, memory: 256Mi }
            limits: { memory: 256Mi }
```

Notes:

- The range must not include ports that the pod itself listens on, or clients can take a port the server needs.
- A pod that sets unsafe sysctls on a node that does not allow them fails to start with `SysctlForbidden`. Check `kubectl describe pod` events, then follow [[kubernetes-pod-troubleshooting]].
- Pod Security Admission baseline and restricted levels allow only the safe set, so a request for an unsafe one is rejected at admission; see [[pod-security-admission]]. A pod with `hostNetwork: true` shares the node's network namespace and must not set network sysctls at all, since they would change the node.
- Do not put per-pod tuning behind a mutating policy for all pods. Set it on the workloads that show the symptom.

## Idle-timeout resets (pointer only)

Long-lived connections that sit idle (database connections, WebSockets, gRPC streams) can be dropped silently by something in the path: a load balancer, a NAT gateway, a firewall, or the conntrack table's own timeout. The next write fails with a reset or hangs until a timeout. This looks like a sysctl problem but usually is a mismatch between idle timeouts along the path and the application's keepalive settings. The full diagnosis belongs to [[network-troubleshooting-dns-mtu-tls-load-balancers]], and the retry and timeout design to [[timeouts-retries-load-shedding]]. Before changing any `tcp_keepalive_*` or conntrack timeout sysctl, read those, and confirm with a packet capture ([[kubernetes-packet-capture]]) that a reset arrives after an idle gap.

## Rollout and rollback

1. Measure and write down the "before" numbers and the symptom.
2. Change one parameter on a test node pool or one node, in the form you will use in production (node system config, `sysctl.d` or pod spec).
3. Reproduce the load, compare the counters, and keep the change only if the symptom goes away.
4. Roll it to the pool through the normal change process. Node system config changes can recreate nodes (**not verified**), so use the same care as a [[gke-cluster-upgrade]]: surge settings, pod disruption budgets, off-peak hours.
5. Rollback: remove the key from the configuration and apply it, or recreate the pool from the previous configuration. Live values set by hand with `sysctl -w` return to the default only after a reboot or when you write the old value back, so record the old value first.

## Related

- [[node-resource-pressure-triage]] for finding which node resource is short.
- [[kubernetes-resource-requests-and-limits]] for the memory and CPU side of the same node.
- [[network-troubleshooting-dns-mtu-tls-load-balancers]] for network symptoms that are not sysctls.
- [[kubernetes-packet-capture]] to confirm resets, retransmissions and queue overflows on the wire.
- [[postgres-connection-pooling-gke]] and [[timeouts-retries-load-shedding]] for fixing connection patterns at the source.
