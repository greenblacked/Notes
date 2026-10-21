---
title: "Kubernetes 11: NetworkPolicy from zero: default deny, allow rules and proving them"
description: Lock down Pod traffic with default-deny NetworkPolicies, allow only needed flows including DNS, avoid the AND/OR trap, and test every rule.
type: guide
tags:
  - learning
  - kubernetes
  - networking
  - security
  - gke
created: 2026-10-21
modified: 2026-10-21
draft: false
---

> [!info] Level: middle | Time: about 3 h | You need: [[learn/kubernetes-services-and-ingress|Kubernetes 03: Services, DNS and Ingress]] and [[learn/load-balancers-firewalls-and-network-troubleshooting|Networking 05: Load balancers, proxies, NAT, firewalls and network troubleshooting]] | Lab: the kind cluster `lab`, if its network plugin enforces NetworkPolicy (exercise 2 checks), otherwise a second kind cluster with Calico

By default every Pod in a Kubernetes cluster can talk to every other Pod, in every namespace, on every port. A compromised web Pod can reach the database, the metadata endpoints and every internal API. **NetworkPolicy** is the firewall that changes that: you select Pods by label and list the traffic they may receive and send. The site's rule is [[adr/0020-default-deny-network-policies|ADR 0020]]: every application namespace starts with **default deny** in both directions, plus explicit allows.

The concepts are small. The traps are not: a policy that silently does nothing because the cluster does not enforce it, an egress deny that breaks DNS and looks like an application bug, and a YAML indent that turns "these Pods in that namespace" into "everything in that namespace". This lesson builds a three-tier app, locks it down one rule at a time, and **proves** each rule with a test, because a policy you have not tested is a guess.

> [!note] Nothing here was run for this page
> The manifests, commands and sample output follow the Kubernetes documentation and are not verified on a running cluster. Output is illustrative. Whether your kind cluster enforces policies depends on your kind version, which is why exercise 2 tests it. GKE specifics not checked against the GKE documentation are marked.

## What you will learn

- Why NetworkPolicy needs a network plugin that enforces it, and how to test that yours does.
- How policies select Pods, how ingress and egress isolation work, and why policies only ever add allowed traffic.
- How to write default deny for both directions and the allow rules a real app needs, including DNS.
- The AND versus OR trap in `from` and `to`, and how to spot it.
- How to prove a policy with a throwaway client, and why a blocked connection times out instead of being refused.

## The model

A NetworkPolicy is a namespaced object with three parts:

```yaml title="anatomy.yaml"
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-allow-from-frontend
  namespace: shop-api
spec:
  podSelector: # 1. which Pods in THIS namespace the policy applies to
    matchLabels:
      app: api
  policyTypes: ["Ingress"] # 2. which directions it isolates
  ingress: # 3. what is allowed in (egress: what is allowed out)
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: shop-web
          podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
```

The rules that matter, all from the Kubernetes "Network Policies" page:

- **Nothing happens without an enforcing plugin.** The API server accepts NetworkPolicy objects on any cluster. Only the network plugin (CNI) enforces them. On a plugin that does not, every policy is silently ignored.
- **Default allow.** A Pod that no policy selects accepts and sends everything.
- **Isolation is per direction.** A Pod becomes isolated for ingress when at least one policy that selects it lists `Ingress` in `policyTypes`; the same for `Egress`. If you leave `policyTypes` out, `Ingress` is always assumed, and `Egress` only if the policy has `egress` rules. Write `policyTypes` explicitly every time.
- **Policies are additive.** Once a Pod is isolated, the allowed traffic is the **union** of everything that all selecting policies allow. There are no deny rules and no order; policies never conflict. To "deny" something, you stop allowing it.
- **Both ends must agree.** A connection from A to B needs A's egress (if A is egress-isolated) and B's ingress (if B is ingress-isolated) to allow it.
- **Replies are allowed.** Policies act on new connections; the return traffic of an allowed connection is implicitly allowed.
- **Pod ports, not Service ports.** Policies see traffic after the Service has translated it to a Pod IP and the Pod's port. If a Service maps port 80 to `targetPort` 8080, the policy must allow **8080**.
- **The node is special.** Traffic from the Pod's own node (kubelet probes, for example) is always allowed, whatever the policies say.
- **Layer 4 only.** Policies match TCP, UDP and SCTP ports. They know nothing about HTTP paths or hostnames; behaviour for ICMP depends on the plugin.

### Selecting peers in `from` and `to`

| Peer                                                       | Matches                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `podSelector` alone                                        | Pods with those labels **in the policy's own namespace**.                                      |
| `namespaceSelector` alone                                  | **All** Pods in namespaces with those labels.                                                  |
| `namespaceSelector` and `podSelector` in **one** list item | Pods with those labels **inside** namespaces with those labels (AND).                          |
| `ipBlock` (`cidr`, optional `except`)                      | IP ranges. Meant for addresses outside the cluster; Pod IPs change, so do not use it for Pods. |

Every namespace carries the immutable label `kubernetes.io/metadata.name=<name>`, so you can select a namespace by name without labelling it yourself.

### The AND versus OR trap

These two snippets differ by one dash and mean very different things:

```yaml
# AND: Pods labelled app=frontend, in namespace shop-web. One peer.
ingress:
  - from:
      - namespaceSelector:
          matchLabels:
            kubernetes.io/metadata.name: shop-web
        podSelector:
          matchLabels:
            app: frontend
```

```yaml
# OR: ANY Pod in namespace shop-web, OR Pods labelled app=frontend in THIS namespace. Two peers.
ingress:
  - from:
      - namespaceSelector:
          matchLabels:
            kubernetes.io/metadata.name: shop-web
      - podSelector:
          matchLabels:
            app: frontend
```

In the second one, the `-` in front of `podSelector` starts a new list item, so the peers are ORed. It still "works" in a happy-path test (the frontend gets through), which is why it survives review. Exercise 6 shows the stranger it lets in. When you review a policy, read every `-` under `from` and `to` as "or".

## Default deny, and DNS

The baseline from ADR 0020, one policy per namespace:

```yaml title="default-deny.yaml"
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
spec:
  podSelector: {} # every Pod in the namespace
  policyTypes: ["Ingress", "Egress"]
```

The empty `podSelector` selects every Pod, and listing both types with no rules isolates them in both directions with nothing allowed.

> [!warning] Default-deny egress also blocks DNS
> The Kubernetes documentation calls this out: a default-deny egress policy stops Pods from reaching the cluster DNS service. Every connection by name then fails with a resolution error after a timeout, which looks like an application or DNS bug. Allow DNS in the same change as the deny.

```yaml title="allow-dns.yaml"
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
spec:
  podSelector: {}
  policyTypes: ["Egress"]
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns # the label CoreDNS keeps for compatibility
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53 # DNS falls back to TCP for large answers
```

The rule allows the DNS Pods, not the DNS Service IP: policies see the Pod IP after the Service translation. Check the label on your cluster with `kubectl -n kube-system get pods -l k8s-app=kube-dns`. On GKE, NodeLocal DNSCache changes where DNS queries go and may need a different rule; [[runbooks/gke-dns-failures-kube-dns-and-nodelocal]] covers the failure signature, and the exact rule must come from the GKE docs for your setup.

## Egress to the outside: `ipBlock`

```yaml title="api-egress-partner.yaml"
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-egress-partner
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes: ["Egress"]
  egress:
    - to:
        - ipBlock:
            cidr: 203.0.113.0/24 # a partner range (documentation range in this example)
            except:
              - 203.0.113.128/25
      ports:
        - protocol: TCP
          port: 443
```

`ipBlock` works on IP addresses only. For "allow `api.partner.example`" you need either a stable IP range from the partner, an egress proxy, or a plugin-specific FQDN policy; the options are compared in [[patterns/kubernetes-network-policies]]. How `ipBlock` interacts with load balancer and Service address rewriting differs between plugins.

## Testing: timeout, not refused

A policy drop is silent: the plugin discards the packet, the client waits, and the connection **times out**. "Connection refused" means a packet reached a host that answered with a reset, usually because nothing listens on the port. That difference, from [[learn/network-layers-tcp-and-udp|Networking 01]], is your first clue:

| What the client prints                        | Likely meaning                                                     |
| --------------------------------------------- | ------------------------------------------------------------------ |
| A response                                    | Allowed.                                                           |
| `download timed out` / `Connection timed out` | Dropped: a NetworkPolicy (or a firewall) on one of the two ends.   |
| `Connection refused`                          | Delivered, but nothing listens on that port. Not a policy problem. |
| `bad address` / `Could not resolve host`      | DNS failed: often a missing DNS egress rule after default deny.    |

Test from a throwaway client Pod with the **labels** of the real client, because policies match labels. Keep timeouts short (`-T 3` for BusyBox `wget`, `--max-time 3` for `curl`) so a drop shows up in seconds. And always test both sides: the allowed flow must work, and a similar flow that should be blocked must fail. When a test does not behave, capture packets as in [[runbooks/kubernetes-packet-capture]].

## NetworkPolicy on GKE

> [!info] Not checked against live docs
> Not checked against the GKE documentation for this page. The points below match the existing site notes, which are also marked as from memory; verify them in the GKE "Network policy" and "GKE Dataplane V2" pages for your version.

On GKE, enforcement comes either from **GKE Dataplane V2** (Cilium-based, chosen when the cluster is created, with enforcement built in and optional network policy logging) or from network policy enforcement on the older dataplane. `gcloud container clusters describe CLUSTER --location=LOCATION --format='value(networkConfig.datapathProvider)'` printing `ADVANCED_DATAPATH` indicates Dataplane V2. Workload Identity Pods also need egress to the GKE metadata server, whose address and port depend on the dataplane; the rollout procedure (audit first, then enforce) and those GKE-specific rules are in [[patterns/kubernetes-network-policies]].

## Hands-on exercises

> [!warning] Exercises are not verified
> The commands and outputs were written from the Kubernetes documentation and were not run for this page. Output is illustrative: Pod names, addresses and message wording differ. Image tags are examples; pin the ones you use. Read the "If you see something else" lines first.

The app: a `frontend` (and a `stranger` that should get nowhere) in `k11-web`, an `api` in `k11-api`, a `db` in `k11-db`. The API and DB are unprivileged nginx containers listening on 8080; the DB Service exposes 5432 so it looks like a database. Allowed flows at the end: frontend to api, api to db, and DNS.

1. **Build the app and test the default (everything allowed).**

   ```bash
   mkdir -p ~/k8s11 && cd ~/k8s11
   kubectl config current-context   # expect kind-lab
   kubectl create namespace k11-web
   kubectl create namespace k11-api
   kubectl create namespace k11-db
   for ns in k11-api k11-db; do
     app=${ns#k11-}
     kubectl -n "$ns" create deployment "$app" --image=nginxinc/nginx-unprivileged:1.27-alpine --port=8080
   done
   kubectl -n k11-api expose deployment api --port=80 --target-port=8080
   kubectl -n k11-db expose deployment db --port=5432 --target-port=8080
   kubectl -n k11-web run frontend --image=busybox:1.36 --labels=app=frontend --command -- sleep 36000
   kubectl -n k11-web run stranger --image=busybox:1.36 --labels=app=stranger --command -- sleep 36000
   kubectl -n k11-api rollout status deployment/api --timeout=120s
   kubectl -n k11-db rollout status deployment/db --timeout=120s
   kubectl -n k11-web wait --for=condition=Ready pod/frontend pod/stranger --timeout=60s
   ```

   Save this helper; every later test uses it. It prints `OK`, or the error line:

   ```bash title="probe.sh"
   # usage: probe NAMESPACE POD URL
   probe() {
     kubectl -n "$1" exec "$2" -- wget -q -O /dev/null -T 3 "$3" 2>&1 && echo "OK   $2 -> $3" || echo "FAIL $2 -> $3"
   }
   ```

   ```bash
   source ./probe.sh
   probe k11-web frontend http://api.k11-api
   probe k11-web stranger http://db.k11-db:5432
   API_POD_IP=$(kubectl -n k11-api get pod -l app=api -o jsonpath='{.items[0].status.podIP}')
   probe k11-web frontend "http://$API_POD_IP:9999"
   ```

   Expected: the first two print `OK` (default allow: even the stranger reaches the database). The third fails quickly with `Connection refused`, because nothing listens on 9999. Remember how fast that was.
   If you see something else: `bad address` means DNS does not work in the cluster yet; check `kubectl -n kube-system get pods -l k8s-app=kube-dns`. If `kubectl create deployment` complains about `--port`, drop the flag; it only documents the port.

2. **Does this cluster enforce NetworkPolicy?** Deny all ingress to the DB namespace and try again.

   ```bash
   kubectl -n k11-db apply -f - <<'EOF'
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: default-deny-all
   spec:
     podSelector: {}
     policyTypes: ["Ingress", "Egress"]
   EOF
   sleep 5
   time probe k11-web stranger http://db.k11-db:5432
   ```

   Expected on an enforcing cluster: `wget: download timed out` and `FAIL`, after about three seconds. Continue with exercise 3.

   If you see something else: if it still prints `OK`, your cluster does **not** enforce policies, and every result in this lesson would be meaningless. Recent kind releases ship a default network plugin that appears to support NetworkPolicy, but this was not confirmed in the kind documentation, and older releases did not. In that case create a second cluster without the default plugin and install Calico:

   ```yaml title="kind-np.yaml"
   kind: Cluster
   apiVersion: kind.x-k8s.io/v1alpha4
   networking:
     disableDefaultCNI: true # kind installs no CNI; nodes stay NotReady until you add one
     # podSubnet: set the value the Calico kind guide asks for
   nodes:
     - role: control-plane
     - role: worker
     - role: worker
   ```

   Then `kind create cluster --name np --config kind-np.yaml`, follow the current official Calico guide for kind (https://docs.tigera.io/calico/latest/getting-started/kubernetes/kind) with a Calico version you pin, wait until `kubectl get nodes` shows `Ready`, and repeat exercises 1 and 2 against `kind-np`. The Calico manifest URL and the `podSubnet` value are deliberately not printed here: take them from that guide.

3. **Default deny in the API namespace, and see the timeout.**

   ```bash
   kubectl -n k11-api apply -f - <<'EOF'
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: default-deny-all
   spec:
     podSelector: {}
     policyTypes: ["Ingress", "Egress"]
   EOF
   sleep 5
   time probe k11-web frontend http://api.k11-api
   kubectl get networkpolicy -A
   ```

   Expected: `FAIL` after about three seconds with `download timed out`, compared with the instant `Connection refused` in exercise 1. Two policies listed, one in each locked namespace.
   If you see something else: an instant `Connection refused` means the request reached the Pod; check the policy is in `k11-api` (`kubectl -n k11-api get netpol`).

4. **Allow frontend to API (the AND form).**

   ```yaml title="k11-api-allow-frontend.yaml"
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: allow-from-frontend
     namespace: k11-api
   spec:
     podSelector:
       matchLabels:
         app: api
     policyTypes: ["Ingress"]
     ingress:
       - from:
           - namespaceSelector:
               matchLabels:
                 kubernetes.io/metadata.name: k11-web
             podSelector:
               matchLabels:
                 app: frontend
         ports:
           - protocol: TCP
             port: 8080 # the Pod port, not the Service port 80
   ```

   ```bash
   kubectl apply -f k11-api-allow-frontend.yaml
   sleep 5
   probe k11-web frontend http://api.k11-api
   probe k11-web stranger http://api.k11-api
   ```

   Expected: `OK` for the frontend, `FAIL` (timeout) for the stranger.
   If you see something else: if the frontend also fails, check the port (8080, not 80) and that `kubectl -n k11-web get pod frontend --show-labels` shows `app=frontend`. `kubectl create deployment` labels its Pods `app=api`; confirm with `kubectl -n k11-api get pods --show-labels`.

5. **Allow API to DB, and meet the DNS trap.** The API namespace denies egress, so the API needs an egress rule to the DB, and the DB needs an ingress rule from the API.

   ```yaml title="k11-api-to-db.yaml"
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: allow-egress-to-db
     namespace: k11-api
   spec:
     podSelector:
       matchLabels:
         app: api
     policyTypes: ["Egress"]
     egress:
       - to:
           - namespaceSelector:
               matchLabels:
                 kubernetes.io/metadata.name: k11-db
             podSelector:
               matchLabels:
                 app: db
         ports:
           - protocol: TCP
             port: 8080
   ---
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: allow-from-api
     namespace: k11-db
   spec:
     podSelector:
       matchLabels:
         app: db
     policyTypes: ["Ingress"]
     ingress:
       - from:
           - namespaceSelector:
               matchLabels:
                 kubernetes.io/metadata.name: k11-api
             podSelector:
               matchLabels:
                 app: api
         ports:
           - protocol: TCP
             port: 8080
   ```

   ```bash
   kubectl apply -f k11-api-to-db.yaml
   sleep 5
   API_POD=$(kubectl -n k11-api get pod -l app=api -o jsonpath='{.items[0].metadata.name}')
   probe k11-api "$API_POD" http://db.k11-db:5432
   DB_IP=$(kubectl -n k11-db get svc db -o jsonpath='{.spec.clusterIP}')
   probe k11-api "$API_POD" "http://$DB_IP:5432"
   ```

   Expected: by name it fails with `bad address 'db.k11-db'` (after a pause): the API cannot reach DNS. By Service IP it prints `OK`, which proves the DB rules are right and only DNS is missing. Now allow DNS for both locked namespaces:

   ```bash
   for ns in k11-api k11-db; do
     kubectl -n "$ns" apply -f - <<'EOF'
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: allow-dns
   spec:
     podSelector: {}
     policyTypes: ["Egress"]
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
   EOF
   done
   sleep 5
   probe k11-api "$API_POD" http://db.k11-db:5432
   probe k11-web stranger http://db.k11-db:5432
   ```

   Expected: `OK` for the API by name, `FAIL` for the stranger.
   If you see something else: if the name still does not resolve, check the DNS Pod labels and port with `kubectl -n kube-system get pods -l k8s-app=kube-dns -o wide` and `kubectl -n kube-system get svc kube-dns -o yaml | grep -A3 ports`. If the image's `wget` reports a different error format, the meaning is the same.

6. **The AND versus OR mistake.** Replace the frontend rule with the OR form (one extra dash) and test the stranger again.

   ```bash
   kubectl -n k11-api apply -f - <<'EOF'
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: allow-from-frontend
   spec:
     podSelector:
       matchLabels:
         app: api
     policyTypes: ["Ingress"]
     ingress:
       - from:
           - namespaceSelector:
               matchLabels:
                 kubernetes.io/metadata.name: k11-web
           - podSelector:
               matchLabels:
                 app: frontend
         ports:
           - protocol: TCP
             port: 8080
   EOF
   sleep 5
   probe k11-web frontend http://api.k11-api
   probe k11-web stranger http://api.k11-api
   kubectl -n k11-api describe networkpolicy allow-from-frontend | sed -n '/Allowing ingress/,/Not affecting/p'
   ```

   Expected: **both** print `OK`. The `describe` output lists two separate peers under `From:`, a namespace selector and a pod selector, instead of one combined peer. That visual check catches the mistake in review. Restore the AND form:

   ```bash
   kubectl apply -f k11-api-allow-frontend.yaml
   sleep 5
   probe k11-web stranger http://api.k11-api
   ```

   Expected: `FAIL` again.
   If you see something else: if the stranger was blocked under the OR form, the old policy may not have been replaced; `kubectl -n k11-api get netpol allow-from-frontend -o yaml` shows what is live.

7. **Egress to the outside is blocked too.** The API may resolve names (DNS is allowed) but may not connect anywhere it was not allowed.

   ```bash
   probe k11-api "$API_POD" http://example.com
   kubectl -n k11-api apply --dry-run=server -f - <<'EOF'
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: api-egress-partner
   spec:
     podSelector:
       matchLabels:
         app: api
     policyTypes: ["Egress"]
     egress:
       - to:
           - ipBlock:
               cidr: 203.0.113.0/24
               except:
                 - 203.0.113.128/25
         ports:
           - protocol: TCP
             port: 443
   EOF
   ```

   Expected: the first command fails with a **timeout** (not a DNS error: the name resolves, the connection is dropped). The dry run prints `networkpolicy.networking.k8s.io/api-egress-partner created (server dry run)`: the `ipBlock` policy is valid. It is not applied, and it could not be tested for real because 203.0.113.0/24 is a documentation range that routes nowhere; with a real partner range you would apply it and probe an address inside and one inside the `except`.
   If you see something else: if `example.com` answers, the API's egress is not isolated; check `kubectl -n k11-api get netpol default-deny-all -o yaml`. If your lab has no internet access at all, the timeout proves nothing; skip that line.

8. **Clean up.**

   ```bash
   kubectl delete namespace k11-web k11-api k11-db
   ```

   Expected: the namespaces and everything in them, policies included, are deleted. If you created the `np` cluster, also run `kind delete cluster --name np`.

## Common mistakes

- **Writing policies on a cluster that does not enforce them.** Why it bites: everything looks applied and nothing is protected. Fix: an enforcement test (exercise 2) on every new cluster type, and a check in the platform's acceptance tests.
- **Default-deny egress without a DNS rule.** Why it bites: every name lookup fails after a timeout and the outage looks like an application bug. Fix: ship the DNS allow in the same change as the deny.
- **Allowing the Service port instead of the Pod port.** Why it bites: policies see traffic after the Service translation, so allowing 80 when the Pod listens on 8080 allows nothing. Fix: use the `targetPort`, or a named port.
- **The extra dash (OR instead of AND).** Why it bites: a whole namespace, or same-named Pods in the wrong namespace, gets access, and the happy-path test still passes. Fix: read `kubectl describe networkpolicy` and always test a negative case.
- **Opening only one end.** Why it bites: with both namespaces locked, the client's egress and the server's ingress must both allow the flow. Fix: write the pair together, as in exercise 5.
- **Expecting a "deny" rule to win.** Why it bites: there are no deny rules; another policy that selects the same Pods can quietly allow more. Fix: list all policies that select a Pod (`kubectl get netpol -n NS` and compare selectors) when reviewing.
- **Using `ipBlock` for Pod IPs.** Why it bites: Pod IPs change on every restart. Fix: select Pods and namespaces by label; keep `ipBlock` for addresses outside the cluster.
- **Testing with the wrong client labels.** Why it bites: a debug Pod without the real labels is blocked when the real client would not be, or the other way round. Fix: give the test Pod the labels of the client you are simulating.

## Check your understanding

1. You apply a correct default-deny policy and all traffic still flows. What are the two likely explanations, and how do you tell them apart?
2. A namespace has default deny in both directions. Which policies does a web Pod need to call `http://api.other-ns` by name?
3. What is the difference between `- namespaceSelector: ... podSelector: ...` in one list item and in two list items?
4. A policy allows port 80 to an `api` Pod behind a Service with `port: 80` and `targetPort: 8080`. Callers time out. Why?
5. Two policies select the same Pod: one allows ingress from `frontend`, the other allows ingress from `monitoring`. What traffic reaches the Pod?
6. A test from a client Pod prints `Connection refused` immediately. Is this a NetworkPolicy problem?

> [!question]- Answers
>
> 1. Either the cluster's network plugin does not enforce NetworkPolicy, or the policy does not select the Pods (wrong namespace, a `podSelector` that matches nothing, a missing `policyTypes`). Check `kubectl get netpol -n NS -o yaml` and the selectors first; then run an enforcement test with a known-good default deny in a test namespace. If that does not block, the plugin does not enforce.
> 2. In the web Pod's namespace: an egress rule to DNS (kube-dns Pods on UDP and TCP 53) and an egress rule to the API Pods on the API's Pod port. In the API's namespace, if it is ingress-isolated: an ingress rule from the web Pods on that port.
> 3. In one item they form one peer: Pods with those labels inside namespaces with those labels (AND). In two items they are two peers: all Pods in matching namespaces, or matching Pods in the policy's own namespace (OR), which usually allows much more.
> 4. Policies match the traffic after the Service has translated it to the Pod IP and the Pod port, 8080. Port 80 is never seen at the Pod, so nothing is allowed. Allow 8080, or a named port.
> 5. The union: traffic from `frontend` and traffic from `monitoring` (on the ports each rule lists). Policies are additive and never conflict.
> 6. Almost certainly not. A refusal means the packet reached the destination and nothing listened on the port. A policy drop shows up as a timeout. Check the port, the Service's `targetPort` and whether the application is listening.

## Next steps

Next lesson: [[learn/kubernetes-jobs-and-cronjobs|Kubernetes 12: Jobs and CronJobs]]. Previous lesson: [[learn/kubernetes-scheduling-affinity-taints-and-draining|Kubernetes 10: Scheduling]].

To go deeper:

- [[patterns/kubernetes-network-policies]] for the production rollout on GKE: inventory flows, logging, metadata server and FQDN egress.
- [[adr/0020-default-deny-network-policies]] for why every application namespace starts with default deny.
- [[runbooks/policy-rollout-audit-to-enforce]] for rolling out any policy safely.
- [[runbooks/kubernetes-packet-capture]] when a test does not behave and you need to see the packets.
- [[runbooks/gke-dns-failures-kube-dns-and-nodelocal]] for DNS failures, including the ones a policy causes.
- [[learn/dns-resolution|Networking 03]] for how Pods resolve names in the first place.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- Kubernetes documentation, "Network Policies" (https://kubernetes.io/docs/concepts/services-networking/network-policies/), for the plugin requirement, isolation rules, `policyTypes` defaults, additivity, the AND and OR selector forms, `ipBlock`, the default-deny examples, the DNS caution, `endPort` (stable since 1.25) and the layer 4 scope.
- Kubernetes documentation, "Declare Network Policy" (https://kubernetes.io/docs/tasks/administer-cluster/declare-network-policy/), for the BusyBox `wget` test and the timeout on a blocked connection.
- Kubernetes documentation, "Namespaces" (https://kubernetes.io/docs/concepts/overview/working-with-objects/namespaces/), for the `kubernetes.io/metadata.name` label.
- Kubernetes documentation, "Debugging DNS Resolution" (https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/), for the `k8s-app=kube-dns` label on CoreDNS.
- kind documentation, "Configuration" (https://kind.sigs.k8s.io/docs/user/configuration/), for `disableDefaultCNI`.
- Calico documentation, kind quickstart (https://docs.tigera.io/calico/latest/getting-started/kubernetes/kind): not opened for this page; follow it for the current manifest and settings.
- Not checked against a running cluster for this page. Not verified: all output and error wording; whether your kind version's default network plugin enforces NetworkPolicy; the Calico steps and `podSubnet` value; GKE Dataplane V2 behaviour, policy logging and NodeLocal DNSCache rules (not checked against the GKE documentation for this page; verify there). Check the current docs.
