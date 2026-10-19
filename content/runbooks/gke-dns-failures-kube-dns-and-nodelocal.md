---
title: "DNS failures in GKE: kube-dns and NodeLocal DNSCache"
description: "Diagnose DNS timeouts and SERVFAIL in GKE: kube-dns capacity, ndots amplification, conntrack, NodeLocal DNSCache and Cloud DNS for GKE."
type: runbook
tags:
  - runbooks
  - gke
  - kubernetes
  - networking
  - reliability
created: 2026-10-19
modified: 2026-10-19
draft: false
---

How to find the cause of intermittent or sustained DNS failures inside a GKE cluster: slow lookups, `i/o timeout`, `SERVFAIL`, `no such host` for names that exist, or a latency tax on every outbound call. It goes deeper into the cluster-DNS layers than section 2 of [[network-troubleshooting-dns-mtu-tls-load-balancers]], which covers the generic first checks and is not repeated here.

> [!info] Scope and verification
> The commands were not run against a live cluster and the note is not marked `verified`. Label selectors, ConfigMap names, namespaces and the NodeLocal DNSCache link-local address differ by GKE version and DNS provider. Check each against your cluster and the current GKE DNS documentation before you act on it.

## When to use

- Application logs show `dial tcp: lookup ...: i/o timeout`, `Temporary failure in name resolution` or `getaddrinfo EAI_AGAIN`.
- Latency of calls to external hosts is high and `dig` from a Pod shows the lookup taking most of it.
- Failures come in bursts that match high connection rates or scale-ups.
- Only some Pods or nodes fail, which suggests the node-level cache or conntrack.

Start with the generic checks in [[network-troubleshooting-dns-mtu-tls-load-balancers]] and [[dns-resolution]] if you have not ruled out an application bug or a bad record. Come back here when cluster DNS itself is the suspect.

## Preconditions

- `kubectl` access to `kube-system` for reads, and permission to edit ConfigMaps and scale Deployments there if you will change anything.
- Knowledge of whether any NetworkPolicy or firewall applies; see [[kubernetes-network-policies]].
- A rollback plan and a change record for anything that touches `kube-system`; see [[production-change-checklist]].

```bash
PROJECT=example-project
LOCATION=europe-west1
CLUSTER=prod-1
NS=app                               # namespace of a failing workload
gcloud config set project "$PROJECT"
```

## Steps

### 1. Find which DNS provider and cache the cluster uses

GKE can resolve cluster names through kube-dns (the default), through Cloud DNS for GKE (cluster scope or VPC scope), and can run NodeLocal DNSCache as a per-node cache in front of either. They fail differently.

```bash
gcloud container clusters describe "$CLUSTER" --location "$LOCATION" \
  --format="yaml(dnsConfig,addonsConfig.dnsCacheConfig,networkConfig)"

kubectl -n kube-system get deploy,ds,svc | grep -Ei 'dns|coredns'
kubectl -n kube-system get cm | grep -Ei 'dns'
```

Read the result:

- `dnsConfig.clusterDns` of `CLOUD_DNS` means kube-dns is not the cluster resolver. Skip the kube-dns steps and go to Cloud DNS quotas and logs; see [[cloud-dns-hybrid-and-multi-project]].
- `addonsConfig.dnsCacheConfig.enabled: true`, or a `node-local-dns` DaemonSet in `kube-system`, means a per-node cache sits in front of the upstream.
- A `kube-dns` Deployment with a `kube-dns-autoscaler` indicates the default provider with proportional scaling.

### 2. Reproduce from a Pod, with timing

Use a pinned image and, ideally, a digest rather than `latest`. Replace the example reference with an image your registry mirrors.

```bash
IMG=registry.example.com/tools/dnsutils@sha256:0000000000000000000000000000000000000000000000000000000000000000
kubectl -n "$NS" run dnstest --image="$IMG" --restart=Never --command -- sleep 3600
kubectl -n "$NS" wait --for=condition=Ready pod/dnstest --timeout=60s

# Resolver config the Pod actually has
kubectl -n "$NS" exec dnstest -- cat /etc/resolv.conf

# Repeat to expose intermittency; note query time and status
for i in $(seq 1 20); do
  kubectl -n "$NS" exec dnstest -- dig +tries=1 +time=2 kubernetes.default.svc.cluster.local | grep -E 'status:|Query time'
done
for i in $(seq 1 20); do
  kubectl -n "$NS" exec dnstest -- dig +tries=1 +time=2 example.com | grep -E 'status:|Query time'
done
```

Compare internal and external names. Internal names failing points at kube-dns or the cache. Only external names failing points at upstream forwarding, firewall egress or Cloud NAT. Query the resolver in `resolv.conf` directly, then query a kube-dns Pod IP directly (or the `kube-dns-upstream` Service, if your cluster has one) to bypass the node cache. With NodeLocal DNSCache the Pods keep the kube-dns Service IP as nameserver and the node cache intercepts that address, so querying the Service IP cannot separate the cache from the backends:

```bash
KUBE_DNS_POD_IP=$(kubectl -n kube-system get pods -l k8s-app=kube-dns -o jsonpath='{.items[0].status.podIP}')
kubectl -n "$NS" exec dnstest -- dig +tries=1 +time=2 @"$KUBE_DNS_POD_IP" example.com | grep -E 'status:|Query time'
```

If the direct kube-dns Pod query is healthy while the default resolver is not, the problem is the NodeLocal cache or the path to it.

### 3. kube-dns health and capacity

```bash
kubectl -n kube-system get pods -l k8s-app=kube-dns -o wide
kubectl -n kube-system top pod -l k8s-app=kube-dns
kubectl -n kube-system logs -l k8s-app=kube-dns -c kubedns --tail=100
kubectl -n kube-system logs -l k8s-app=kube-dns -c dnsmasq --tail=100 2>/dev/null
kubectl -n kube-system get cm kube-dns-autoscaler -o yaml
```

Look for restarts and OOM kills, CPU at its limit, Pods concentrated on one node, and an autoscaler ladder that is too low for the current node and core count. Container names and the autoscaler ConfigMap differ across versions, so list containers with `kubectl ... get pod -o jsonpath='{.items[0].spec.containers[*].name}'` first.

To scale on demand, the cleanest supported route is to tune the autoscaler parameters rather than the Deployment, since the autoscaler will override a manual replica count:

```bash
kubectl -n kube-system edit cm kube-dns-autoscaler
# adjust the linear parameters (coresPerReplica, nodesPerReplica, min) per the current docs
```

### 4. Query amplification: ndots and search domains

Kubernetes sets `ndots:5` by default, so a name with fewer than five dots such as `api.example.com` is first tried against each search domain, producing several failing queries before the real one. Add AAAA lookups and every call multiplies the load.

```bash
kubectl -n "$NS" exec dnstest -- cat /etc/resolv.conf
```

Fixes, in order of safety:

1. Use fully qualified names with a trailing dot in configuration for external dependencies (`api.example.com.`).
2. Lower `ndots` per workload where the application needs it:

```yaml title="deployment-dnsconfig-snippet.yaml"
spec:
  template:
    spec:
      dnsConfig:
        options:
          - name: ndots
            value: "2"
          - name: single-request-reopen
```

3. Fix chatty clients (no connection reuse, lookups per request) in the application.

Test with a canary Deployment first. Lowering `ndots` means in-cluster names with that many dots or more (`svc.ns.svc`) are first tried as absolute names, which adds a failed query; keep in-cluster calls short (`svc.ns`) or fully qualified with a trailing dot.

### 5. Node level: conntrack and UDP races

Bursts of failures that correlate with high connection rates are a classic sign of conntrack table exhaustion or UDP race conditions in the NAT path. Inspect a node that hosts failing Pods.

```bash
NODE=gke-prod-1-default-pool-abc123-wxyz
ZONE=europe-west1-b
gcloud compute ssh "$NODE" --zone "$ZONE" --tunnel-through-iap -- \
  'sudo sysctl net.netfilter.nf_conntrack_count net.netfilter.nf_conntrack_max; sudo conntrack -S 2>/dev/null | head -5'
```

If the count is near the max, or `insert_failed` or `drop` counters climb, DNS packets are being dropped. NodeLocal DNSCache reduces this because Pods talk to a local cache, and the cache reaches upstream over TCP with connection tracking skipped for the local address. Check the node-level DNS cache Pods:

```bash
kubectl -n kube-system get pods -l k8s-app=node-local-dns -o wide
kubectl -n kube-system logs -l k8s-app=node-local-dns --tail=100
```

A node whose cache Pod is not running will fail lookups from Pods configured to use it. Treat that node like a broken node and see [[gke-node-notready-triage]] if it is wider than DNS. For packet-level evidence, see [[kubernetes-packet-capture]].

### 6. NetworkPolicy and firewall

Default-deny egress policies often forget DNS. The allow rule must cover the resolver the Pod really uses: the kube-dns Pods and, with NodeLocal DNSCache, the node-local address as well.

```bash
kubectl -n "$NS" get networkpolicy
kubectl -n "$NS" get networkpolicy -o yaml | grep -nE 'port: (53|8053)|kube-dns|dns'
```

```yaml title="allow-dns-egress.yaml"
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: app
spec:
  podSelector: {}
  policyTypes: ["Egress"]
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
      ports:
        - { protocol: UDP, port: 53 }
        - { protocol: TCP, port: 53 }
    # NodeLocal DNSCache: check the link-local address your cluster uses (docs), then allow it
    - to:
        - ipBlock:
            cidr: 169.254.20.10/32
      ports:
        - { protocol: UDP, port: 53 }
        - { protocol: TCP, port: 53 }
```

The `169.254.20.10` address is the value commonly documented for NodeLocal DNSCache. Confirm it against your cluster and the docs before using it. Also check VPC firewall rules and Cloud NAT if only external names fail.

### 7. Apply the fix

| Finding                              | Fix                                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| kube-dns saturated                   | Tune the autoscaler, raise limits, spread Pods across nodes.                                               |
| Query amplification                  | Fully qualified names, lower `ndots` per workload.                                                         |
| Conntrack pressure or UDP drops      | Enable NodeLocal DNSCache.                                                                                 |
| Policy blocks DNS                    | Add the egress allow rule above.                                                                           |
| Upstream or external names only fail | Check Cloud NAT, firewall egress and the upstream resolver; for Cloud DNS provider, check quotas and logs. |

> [!warning] Enabling NodeLocal DNSCache can recreate nodes
> Turning on the NodeLocal DNSCache add-on for an existing cluster may roll your nodes. Check the current GKE documentation for how the change is applied, run it first in staging, make sure PDBs and surge settings are sane, and schedule it in a window.

```bash
# Command shape; confirm in the current docs before running in production
gcloud container clusters update "$CLUSTER" --location "$LOCATION" \
  --update-addons=NodeLocalDNS=ENABLED
```

## Validation

```bash
for i in $(seq 1 50); do
  kubectl -n "$NS" exec dnstest -- dig +tries=1 +time=2 example.com | grep -E 'status:'
done | sort | uniq -c            # expect only NOERROR

kubectl -n kube-system get pods -l k8s-app=kube-dns
kubectl -n kube-system get pods -l k8s-app=node-local-dns
kubectl -n "$NS" delete pod dnstest
```

Then watch application error rates and DNS latency over a full traffic peak. If you export DNS metrics (kube-dns and node-local-dns expose Prometheus metrics), alert on rising SERVFAIL ratio and request latency.

## Rollback

- ConfigMap or `dnsConfig` changes: revert the manifest or `kubectl rollout undo deployment/<name>`; restore the saved ConfigMap with `kubectl apply -f kube-dns-autoscaler-backup.yaml`.
- Added NetworkPolicy: delete it, remembering this restores the earlier restriction.
- NodeLocal DNSCache: disable the add-on with the matching `--update-addons=NodeLocalDNS=DISABLED`, which may also roll nodes. Check the docs.
- Remove the test Pod: `kubectl -n "$NS" delete pod dnstest`.

Back up before editing: `kubectl -n kube-system get cm kube-dns-autoscaler -o yaml > kube-dns-autoscaler-backup.yaml`.

## Troubleshooting

| Symptom                                               | Likely cause and fix                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `dig @<kube-dns Pod IP>` fine, default resolver fails | NodeLocal cache Pod down on that node, or NetworkPolicy blocks the cache address.                 |
| Every external lookup is slow, in-cluster is fast     | `ndots` amplification or a slow upstream. Use FQDN with trailing dot; check upstream latency.     |
| Intermittent timeouts under load                      | Conntrack exhaustion or kube-dns saturation. Check node counters and kube-dns CPU.                |
| `SERVFAIL` for one private zone only                  | Forwarding or peering for that zone. See [[cloud-dns-hybrid-and-multi-project]].                  |
| Fix works then regresses after node upgrade           | Settings applied by hand were overwritten. Move them into Terraform or the managed add-on config. |
| NodeLocal enable made nodes recreate                  | Expected side effect in some cases. Plan the window and PDBs.                                     |

## Related

- [[network-troubleshooting-dns-mtu-tls-load-balancers]] for the generic first-line checks.
- [[dns-resolution]] for how resolution works end to end.
- [[kubernetes-network-policies]] for egress policy design.
- [[cloud-dns-hybrid-and-multi-project]] for private zones, forwarding and peering.
- [[kubernetes-packet-capture]] for capturing DNS traffic.

## Sources

- [Kubernetes: DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/)
- [Kubernetes: Using NodeLocal DNSCache](https://kubernetes.io/docs/tasks/administer-cluster/nodelocaldns/)
- [GKE: Set up NodeLocal DNSCache](https://cloud.google.com/kubernetes-engine/docs/how-to/nodelocal-dns-cache)
- [GKE: Cloud DNS for GKE](https://cloud.google.com/kubernetes-engine/docs/how-to/cloud-dns)
