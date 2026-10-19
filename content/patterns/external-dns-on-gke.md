---
title: ExternalDNS on GKE with Cloud DNS
description: Let ExternalDNS manage Cloud DNS records from Ingress, Service and Gateway resources with Workload Identity, ownership TXT records and a safe sync policy.
type: pattern
tags:
  - patterns
  - kubernetes
  - gke
  - gcp
  - networking
  - gitops
created: 2026-10-19
modified: 2026-10-19
draft: false
---

ExternalDNS watches Kubernetes resources (Ingress, Service, Gateway API routes) and creates matching DNS records in Cloud DNS. A new hostname in a manifest becomes a record without a ticket or a Terraform change, and removing the workload removes the record. That convenience is also the risk: a controller with write access to a zone can overwrite or delete real records, so ownership and policy settings matter more than the install.

> [!info] Not checked against live docs
> Nothing here was run on a cluster. Check the ExternalDNS docs for the chart values, the supported `sources` and annotation names in your version, and flag spellings. Check the Cloud DNS access control page for the exact IAM role and whether it can be bound on a single managed zone. Role and field names below are from memory.

## What it does and does not do

It does: create, update and (optionally) delete A, AAAA, CNAME and TXT records in a zone, driven by cluster resources.

It does not: issue certificates (that is [[cert-manager-dns01-cloud-dns]]), create load balancers or addresses, create the zone, or validate that the target is reachable. It publishes whatever address the Ingress, Service or Gateway status reports, so a record can point to a load balancer that is not ready yet.

Where zones are defined, and what is shared across projects, is covered in [[cloud-dns-hybrid-and-multi-project]]. For the underlying concepts see [[dns-resolution]].

## Ownership: TXT records and owner IDs

ExternalDNS must know which records it may change. For every record it creates, it writes a companion TXT record with an owner ID. It only modifies or deletes records that carry its own ID.

- Set `txtOwnerId` to something unique **per cluster**, for example `gke-prod-euw1`. Two clusters with the same ID will fight over records and delete each other's.
- Set a `txtPrefix` (or suffix) so the TXT record does not collide with a CNAME at the same name, which DNS does not allow.
- Records created by hand or by Terraform have no ownership TXT, so ExternalDNS leaves them alone. That is a feature: static records stay safe in a shared zone.

Multi-cluster on one zone works if each cluster has its own owner ID and its own set of hostnames. Two clusters serving the same hostname is a design problem, not an ExternalDNS setting.

## Least privilege through Workload Identity

ExternalDNS authenticates to Cloud DNS with [[gke-workload-identity]]. No key file.

```bash title="grant DNS access"
export PROJECT_ID="example-dns"          # project that owns the managed zone
export CLUSTER_PROJECT_NUMBER="123456789012"   # project number of the GKE cluster project
export CLUSTER_PROJECT_ID="example-prod"
export NAMESPACE="external-dns"
export KSA="external-dns"

# Principal for the Kubernetes ServiceAccount, direct federation method
PRINCIPAL="principal://iam.googleapis.com/projects/${CLUSTER_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${CLUSTER_PROJECT_ID}.svc.id.goog/subject/ns/${NAMESPACE}/sa/${KSA}"

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="${PRINCIPAL}" \
  --role="roles/dns.admin"
```

`roles/dns.admin` is the role the ExternalDNS tutorial uses, and it is broad: it can edit every zone in the project. Prefer a custom role with only record set create, update, delete, list and get permissions, and a project that contains only the zones ExternalDNS may touch, since IAM on an individual managed zone may not be available for every operation. Check the Cloud DNS access control docs for the current options and role names, and see [[cloud-dns-hybrid-and-multi-project]] for placing zones in a dedicated project.

The ExternalDNS tutorial explains the `principal://` and GSA impersonation options. If an API rejects the federated principal, use the service account method from [[gke-workload-identity]].

## Helm values

```bash title="install"
helm repo add external-dns https://kubernetes-sigs.github.io/external-dns/
helm repo update
helm upgrade --install external-dns external-dns/external-dns \
  --namespace external-dns --create-namespace \
  --values values.yaml
```

Pin the chart version in your GitOps repo rather than taking the latest.

```yaml title="values.yaml"
provider:
  name: google

serviceAccount:
  create: true
  name: external-dns

extraArgs:
  - --google-project=example-dns
  - --zone-id-filter=example-com
  - --txt-owner-id=gke-prod-euw1
  - --txt-prefix=_edns.

domainFilters:
  - apps.example.com

sources:
  - ingress
  - service
  - gateway-httproute

policy: upsert-only
registry: txt
interval: 1m

resources:
  requests:
    cpu: 50m
    memory: 64Mi
  limits:
    memory: 128Mi
```

Notes:

- `domainFilters` restricts the controller to a sub-domain, so a wrong annotation cannot touch `example.com` itself.
- `--zone-id-filter` pins it to one managed zone by name. Check the flag names in your ExternalDNS version with `external-dns --help`.
- `sources` lists what to watch. Names such as `gateway-httproute` depend on the version; check the sources list in the docs.
- Watch only what you need. Fewer sources means fewer surprises and less API traffic.

## Start with upsert-only

The `policy` flag decides what it may do:

| Policy        | Creates and updates | Deletes | Use when                                              |
| ------------- | ------------------- | ------- | ----------------------------------------------------- |
| `upsert-only` | yes                 | no      | Start here. Stale records are possible but harmless.  |
| `sync`        | yes                 | yes     | Only on a dedicated zone that ExternalDNS fully owns. |
| `create-only` | yes (new only)      | no      | Records must never change after creation.             |

Move to `sync` only when:

1. The zone (or sub-zone) contains nothing but records ExternalDNS created.
2. Each cluster has a unique owner ID.
3. The `domainFilters` are tight.
4. You have a backup (see [Backup before rollout](#backup-before-rollout)).

Under `sync`, deleting a Service or Ingress deletes its record within an interval. That is correct for an outage-free blue-green cutover and dangerous when someone deletes the wrong namespace. See [[gke-blue-green-releases]] for how a cutover interacts with record targets.

## Resources, annotations and sources

On an Ingress, the hostnames in `spec.rules` are used. On a Service of type `LoadBalancer`, set the hostname with an annotation:

```yaml title="service.yaml"
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: shop
  annotations:
    external-dns.alpha.kubernetes.io/hostname: api.apps.example.com
    external-dns.alpha.kubernetes.io/ttl: "300"
spec:
  type: LoadBalancer
  selector:
    app.kubernetes.io/name: api
  ports:
    - port: 443
      targetPort: 8443
```

With the Gateway API, ExternalDNS reads hostnames from the route. The platform's north-south traffic choice is recorded in [[0023-gateway-api-for-north-south-traffic]]. Check the ExternalDNS docs for which Gateway API kinds and annotations your version supports, since support was added gradually.

## Public and private zones

Cloud DNS has public and private zones. A private zone is visible only to the VPC networks it is attached to. ExternalDNS can manage either, and with the Google provider you choose by zone visibility; check the flag name (a zone visibility filter) in the docs for your version.

For split-horizon setups, run two instances with different owner IDs and zone filters: one for the public zone fed by internet-facing routes, one for the private zone fed by internal ones. Otherwise internal hostnames leak into the public zone. Hybrid and peering questions belong in [[private-gke-and-controlled-egress]].

## Backup before rollout

Export the zone first. It is the only reliable rollback.

```bash title="export zone records"
gcloud dns record-sets export "zone-backup-$(date +%Y%m%d).yaml" \
  --zone=example-com --project=example-dns --zone-file-format=false
```

Check `gcloud dns record-sets export --help` for the supported formats. Store the file somewhere access-controlled; zones can contain internal host names.

## Failure modes

| Symptom                                   | Cause                                                        | Fix                                                                      |
| ----------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Records disappear                         | `sync` with the wrong namespace deleted, or two owners       | `upsert-only`, unique `txtOwnerId`, restore from export                  |
| Two clusters flip a record back and forth | Same hostname in both, same or different owner IDs           | One owner per hostname; fix the routing design                           |
| `Permission denied` in controller logs    | Missing IAM, wrong project, federated principal not accepted | Check the binding on the zone project, try the GSA method                |
| Record not created                        | Hostname outside `domainFilters`, or source not enabled      | Check the controller logs, which print skipped records                   |
| Old DNS answer served after change        | TTL and resolver caches                                      | Lower the TTL before cutovers, wait for the old TTL                      |
| API rate errors                           | Short `interval`, many sources, large zones                  | Increase the interval, use event-based triggering if your version has it |
| CNAME and TXT conflict                    | No TXT prefix                                                | Set `--txt-prefix`                                                       |

## Verify

```bash title="checks"
kubectl -n external-dns logs deploy/external-dns --tail=50

gcloud dns record-sets list --zone=example-com --project=example-dns \
  --filter="name~api.apps.example.com"

dig +short api.apps.example.com @ns-cloud-a1.googledomains.com
```

Use the real name servers of your zone; `gcloud dns managed-zones describe example-com` lists them. Test with a dry run first: ExternalDNS has a `--dry-run` flag (check your version) that logs what it would do.

Monitor the controller's error logs and its metrics endpoint. Alert when it has produced errors for several consecutive intervals; stale DNS fails quietly.

## Rollback

1. Set `policy: upsert-only` (or scale the Deployment to zero) so nothing else is removed. In a GitOps flow, commit the change. See [[gitops-repo-topology-and-promotion]].
2. Restore records from the export: `gcloud dns record-sets import` with the backup file (check flags such as `--delete-all-existing`, which is destructive, and avoid it unless you intend a full restore).
3. Remove the ownership TXT records only if you are retiring ExternalDNS.
4. Lower the TTL ahead of risky changes, restore it after.

## Related

- [[gke-workload-identity]]
- [[cloud-dns-hybrid-and-multi-project]]
- [[cert-manager-dns01-cloud-dns]]
- [[private-gke-and-controlled-egress]]
- [[dns-resolution]]
- [[gke-blue-green-releases]]

## Sources

- https://kubernetes-sigs.github.io/external-dns/latest/
- https://kubernetes-sigs.github.io/external-dns/latest/docs/tutorials/gke/
- https://cloud.google.com/dns/docs/access-control
