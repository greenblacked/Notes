---
title: Kubernetes network policies
description: Default-deny NetworkPolicies with DNS, namespace and Google API egress on GKE, plus testing, common mistakes and a safe rollout.
type: pattern
tags:
  - patterns
  - kubernetes
  - gke
  - networking
  - security
created: 2026-10-16
modified: 2026-10-16
draft: false
---

By default every Pod in a Kubernetes cluster can talk to every other Pod, in any namespace. A `NetworkPolicy` narrows that. The target state is **default-deny in every application namespace, plus explicit allows** for what each workload really needs. That limits lateral movement after a compromise and is a common audit requirement.

> [!info] Not checked against live docs
> The GKE documentation was unreachable when this was written. The NetworkPolicy API itself is stable, but GKE-specific points (Dataplane V2 behaviour, policy logging, metadata server addresses) are from memory. Verify them in the GKE "Network policy" and "Dataplane V2" pages for your cluster version.

## Prerequisites on GKE

A NetworkPolicy object does nothing unless the cluster enforces it. On GKE you get enforcement in two ways:

- **GKE Dataplane V2** (`--enable-dataplane-v2` at cluster creation, Cilium-based). Network policy enforcement is built in, and you cannot switch an existing cluster to it in place, so it is chosen at creation. It also provides policy logging.
- **Network policy enforcement with Calico** on the legacy dataplane (`--enable-network-policy`).

Check which you have before writing policies:

```bash
export CLUSTER="platform-1"
export LOCATION="europe-west1"

gcloud container clusters describe "${CLUSTER}" --location="${LOCATION}" \
  --format='value(networkConfig.datapathProvider, networkPolicy.enabled)'
```

An output of `ADVANCED_DATAPATH` means Dataplane V2. Policies are additive: a Pod selected by any policy is denied everything not allowed by the union of the policies that select it. Policies never contain explicit deny rules.

## Step 1: default deny

Apply to each application namespace. An empty `podSelector` selects every Pod.

```yaml title="default-deny.yaml"
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: payments
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

The moment this applies, even DNS stops working, so ship Step 2 in the same change.

## Step 2: allow DNS

```yaml title="allow-dns.yaml"
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: payments
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

If you run NodeLocal DNSCache, Pods query a link-local address on the node instead, and you must allow that address too (check your cluster's DNS configuration for the IP). Namespaces carry the `kubernetes.io/metadata.name` label automatically on current Kubernetes versions, so you do not need to label them yourself for this selector.

## Step 3: allow what the app needs

Ingress from the ingress controller and from a named client:

```yaml title="api-ingress.yaml"
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-allow-ingress
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: payments-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: checkout
      ports:
        - protocol: TCP
          port: 8080
```

For services behind GKE container-native load balancing (NEGs), health checks and proxied traffic reach the Pods from Google Cloud ranges, not from the ingress controller. Add a second rule to the same policy, or a separate policy, that allows them on the serving port:

```yaml title="api-ingress-gclb.yaml"
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-allow-ingress-gclb
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: payments-api
  policyTypes:
    - Ingress
  ingress:
    # Google Cloud load balancer health-check and proxy ranges;
    # confirm against the current GKE/Cloud Load Balancing docs
    - from:
        - ipBlock:
            cidr: 35.191.0.0/16
        - ipBlock:
            cidr: 130.211.0.0/22
      ports:
        - protocol: TCP
          port: 8080
```

Egress to a database in the same namespace:

```yaml title="api-egress-db.yaml"
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-allow-db-egress
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: payments-api
  policyTypes:
    - Egress
  egress:
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: postgres
      ports:
        - protocol: TCP
          port: 5432
```

Selector semantics are the most common source of mistakes. Inside one `from`/`to` list item, `namespaceSelector` and `podSelector` together mean AND (a pod with this label in a namespace with that label). As separate list items they mean OR. In the ingress example above, the two items are OR, which is what we want; moving `podSelector` under the first item would require both.

Use stable labels such as `app.kubernetes.io/name`, set by the chart conventions in [[helm-chart-conventions]], so that policies do not break when a release is renamed.

## Step 4: egress to Google APIs

NetworkPolicy is IP-based and has no FQDN rule. Google APIs (`*.googleapis.com`) resolve to large, changing address ranges, so allowing them by name is not possible. Options, in order of preference:

1. **Private Google Access with a fixed VIP.** With the DNS records for `private.googleapis.com` (`199.36.153.8/30`) or `restricted.googleapis.com` (`199.36.153.4/30`) configured in a private zone, Google API traffic goes to a small known range, which you can allow:

```yaml title="allow-google-apis.yaml"
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-google-apis-egress
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: payments-api
  policyTypes:
    - Egress
  egress:
    - to:
        - ipBlock:
            cidr: 199.36.153.8/30
      ports:
        - protocol: TCP
          port: 443
```

Option 1 (the restricted VIP) only works when Private Google Access is enabled on the subnet.

2. **Allow 443 to the internet for specific workloads** (`0.0.0.0/0` with `except` for private ranges). Coarse, but honest.
3. **A Cilium FQDN policy** or an egress proxy/firewall that supports names. Dataplane V2 includes FQDN network policy as a GKE feature in recent versions; check availability and the CRD in the docs before depending on it.

Workload Identity also needs the Pod to reach the GKE metadata server on the node. Depending on dataplane and version this is an address such as `169.254.169.254` or a special rule documented for GKE; if token requests time out right after enabling policies, look this up first. See [[gke-workload-identity]] for the failure signature.

Use a rule of this shape, with the address and port taken from the GKE Workload Identity documentation for your dataplane and version. Do not hard-code values from a note:

```yaml title="allow-metadata-server.yaml"
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-metadata-server-egress
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: payments-api
  policyTypes:
    - Egress
  egress:
    - to:
        - ipBlock:
            # METADATA_CIDR and METADATA_PORT: take the values from the GKE Workload
            # Identity docs for your dataplane and version
            cidr: METADATA_CIDR
      ports:
        - protocol: TCP
          port: METADATA_PORT
```

## Testing policies

Test from a Pod that has the same labels as the client you expect to allow:

```bash
export NS="payments"
export TARGET="payments-api.payments.svc.cluster.local"

kubectl run nettest --namespace "${NS}" --rm -it --restart=Never \
  --labels="app.kubernetes.io/name=checkout" \
  --image=busybox:1.36 -- wget -qO- -T 3 "http://${TARGET}:8080/healthz"
```

Also test the negative: a Pod with other labels, and another namespace, must time out. A timeout rather than a refusal is the typical signature of a policy drop (a refused connection means the policy allowed the traffic and nothing is listening). For automated checks, run a small connectivity suite in CI against a kind cluster with a CNI that enforces policy, since the default kind CNI does not.

## Common mistakes

| Mistake                                         | Effect                                                                                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default-deny egress without a DNS rule          | Every outbound call fails with name resolution errors.                                                                                                                                                        |
| Forgetting both directions                      | Allowing ingress on the server while the client's egress is denied still blocks.                                                                                                                              |
| AND vs OR selector confusion                    | Policy far wider or narrower than intended.                                                                                                                                                                   |
| Policies on a cluster without enforcement       | Objects exist, nothing is blocked. Verify enforcement, not YAML.                                                                                                                                              |
| Blocking health checks and webhooks             | Probes from the kubelet are generally allowed, but load balancer health checks and admission webhooks calling from the control plane may need explicit rules, such as the Google Cloud ranges rule in Step 3. |
| Selecting on mutable labels                     | Policy silently stops matching after a rename.                                                                                                                                                                |
| Allowing `0.0.0.0/0` egress and calling it done | No real restriction. Prefer specific destinations.                                                                                                                                                            |
| Forgetting `hostNetwork` Pods                   | Network policies generally do not apply to them.                                                                                                                                                              |

## Rollout strategy: audit first

1. **Inventory flows.** On Dataplane V2, enable network policy logging (configured by a `NetworkLogging` custom resource; confirm the current spec in the GKE docs) and review denied and allowed connections in Cloud Logging. On other setups use flow logs for the VPC or a tool such as Hubble.
2. **Write policies in a staging namespace first**, then compare logs with the intended flows.
3. **Add allow policies before default-deny.** Because policies are additive, allow rules applied while the Pod is still unrestricted are harmless, and make the later deny a non-event.
4. **Enable default-deny namespace by namespace**, starting with low-risk ones, one change per day, each with a rollback as described below.
5. **Keep policies with the chart** so a new service ships with its own, and so [[0001-gitops-with-argocd]] reverts them with the rest of the release.
6. **Alert on denied flows** from production workloads for the first weeks, and review them as part of the [[production-change-checklist]].

Because default-deny is managed by Argo CD (step 5), roll back an incident in one of two ways:

- **Preferred:** revert the policy commit in Git and let Argo CD sync.
- **Break-glass:** disable auto-sync for the application first, then delete the object, then record it and re-enable auto-sync once the fix is in Git.

```bash
export APP="payments"
export NS="payments"

argocd app set "${APP}" --sync-policy none
kubectl delete networkpolicy default-deny-all -n "${NS}"

# after the fix is merged in Git and the change is recorded:
argocd app set "${APP}" --sync-policy automated   # add the self-heal flag you normally use
```

> [!warning] Self-heal undoes a plain delete
> With automated sync and self-heal, Argo CD recreates `default-deny-all` right after a plain `kubectl delete`, so the rollback silently fails. Disable auto-sync first. See [[helm-release-rollback#6. GitOps: Argo CD manages the release]] for the same trap on Helm releases.

If the Application is itself managed by a parent app (app-of-apps) or an ApplicationSet, disable auto-sync on the parent too (or follow your ApplicationSet's override procedure), otherwise the parent restores the child's sync policy from Git and default-deny returns. Confirm with `argocd app get "${APP}"` that `Sync Policy:` shows `Manual` and no longer `Automated` before deleting anything.

Treat the break-glass state as temporary, and record it in the runbook for the namespace.
