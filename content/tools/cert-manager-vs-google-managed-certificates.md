---
title: cert-manager vs Google-managed certificates on GKE
description: Choosing between cert-manager with ACME, GKE ManagedCertificate and Certificate Manager with DNS authorization for GKE ingress and load balancers.
type: tool
tags:
  - tools
  - gke
  - kubernetes
  - security
  - networking
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Three mechanisms issue and renew TLS certificates for workloads on GKE: cert-manager running ACME inside the cluster, the GKE `ManagedCertificate` resource, and Google Cloud Certificate Manager with DNS authorization. They overlap enough to confuse, and they fail in different ways. This note is for choosing one per use case, not for the renewal procedure, which is in [[tls-certificate-renewal]].

> [!info] Not checked against current releases
> Versions, limits, rate limits, supported load balancer types and command syntax were not checked when this note was written. Confirm them in the current documentation before relying on them.

## Short answer

- Public hostname on a Google external Application Load Balancer, simple case: **ManagedCertificate** or **Certificate Manager**. Prefer Certificate Manager when you need wildcards, many certificates, or Gateway API.
- Internal names, service mesh, non-Google load balancers, or any certificate that must live as a Kubernetes Secret in the cluster: **cert-manager**.
- Do not run two systems for the same hostname.

## At a glance

| Concern             | GKE ManagedCertificate                              | Certificate Manager (DNS authorization)                  | cert-manager (ACME)                                  |
| ------------------- | --------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| Runs where          | Google-managed, configured by a Kubernetes resource | Google-managed, configured by gcloud, API or Terraform   | Controller in your cluster                           |
| Terminates TLS at   | Google load balancer                                | Google load balancer, via a certificate map              | Pod, ingress controller, mesh gateway, or any proxy  |
| Challenge           | Load balancer based; DNS must already point at it   | DNS authorization: a CNAME you create, no traffic needed | HTTP-01 or DNS-01 (Cloud DNS solver)                 |
| Wildcards           | Check the docs; typically not                       | Supported with DNS authorization; check the docs         | Yes with DNS-01                                      |
| Private key         | Held by Google                                      | Held by Google                                           | In a Kubernetes Secret you control                   |
| Internal-only names | No                                                  | Check the docs for private CA options                    | Yes, with a private issuer                           |
| Kubernetes-native   | Yes                                                 | Partly: Gateway API and `networking.gke.io` integration  | Yes                                                  |
| Limits              | Per-project and per-LB limits; check the docs       | Per-project limits; check the docs                       | Let's Encrypt or CA rate limits; check the CA's docs |

## GKE ManagedCertificate

A `ManagedCertificate` is a Kubernetes custom resource referenced from an Ingress by annotation. Google provisions a certificate and attaches it to the load balancer that the Ingress creates.

```yaml title="managed-cert.yaml"
apiVersion: networking.gke.io/v1
kind: ManagedCertificate
metadata:
  name: example-cert
  namespace: shop
spec:
  domains:
    - shop.example.com
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop
  namespace: shop
  annotations:
    networking.gke.io/managed-certificates: example-cert
    kubernetes.io/ingress.global-static-ip-name: shop-ip
    kubernetes.io/ingress.class: gce
spec:
  defaultBackend:
    service:
      name: shop
      port:
        number: 80
```

The sticking point is ordering: the DNS record for `shop.example.com` must already resolve to the load balancer's IP before provisioning can succeed. A reserved static address makes that predictable. Provisioning can take a while, and the certificate status moves through states such as `Provisioning`, `Active` and `FailedNotVisible`.

```bash title="inspect state"
kubectl describe managedcertificate example-cert -n shop
kubectl get managedcertificate -A
```

`FailedNotVisible` normally means DNS does not point at the load balancer yet, or a firewall or redirect blocks the validation. It is a configuration state, not an outage; fix DNS and wait.

## Certificate Manager with DNS authorization

Certificate Manager separates three things: a DNS authorization (proof you control a domain), a certificate that uses it, and a certificate map that attaches certificates to a load balancer by hostname. Because proof is a DNS CNAME, no traffic has to reach the load balancer first, so you can have the certificate ready before the cutover. That removes the chicken-and-egg problem of ManagedCertificate and is how wildcards are issued.

```bash title="DNS authorization, certificate and map (verify subcommands with --help)"
PROJECT=example-project

gcloud certificate-manager dns-authorizations create shop-example-com \
  --domain="shop.example.com" --project="${PROJECT}"

# Shows the CNAME record to create in your DNS zone
gcloud certificate-manager dns-authorizations describe shop-example-com \
  --project="${PROJECT}" --format='value(dnsResourceRecord)'

gcloud certificate-manager certificates create shop-example-com-cert \
  --domains="shop.example.com" \
  --dns-authorizations=shop-example-com \
  --project="${PROJECT}"

gcloud certificate-manager maps create shop-map --project="${PROJECT}"

gcloud certificate-manager maps entries create shop-entry \
  --map=shop-map --hostname="shop.example.com" \
  --certificates=shop-example-com-cert --project="${PROJECT}"
```

Then create the CNAME the describe command printed, in the zone for `example.com`, and attach the map to the load balancer (the Gateway API integration takes the map by annotation; the exact resource and annotation names are in the current GKE Gateway documentation). Verify the record from outside:

```bash title="check the authorization record"
dig +short CNAME _acme-challenge.shop.example.com
```

Use the Terraform resources for all of this in practice, so the zone record and the authorization are created together; see [[cloud-dns-hybrid-and-multi-project]] for where DNS zones live in a multi-project setup.

## cert-manager with DNS-01 on Cloud DNS

cert-manager is a controller that watches `Certificate` resources and keeps a Secret filled with a valid key pair. Use it where Google-managed certificates cannot reach: internal names under a private CA, mesh gateways (see [[service-mesh-on-gke]]), pods that terminate TLS themselves, or non-Google load balancers.

With DNS-01 on Cloud DNS, the solver writes a TXT record, so it works without public ingress and supports wildcards. Authenticate with Workload Identity rather than a JSON key (the pattern is in [[gke-workload-identity]]): the Google service account needs permission to edit records in the zone only (`roles/dns.admin` on the zone's project is broad, so prefer a narrower custom role or a dedicated project for the zone; check the current cert-manager guide for the minimum).

```yaml title="clusterissuer.yaml"
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-dns
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: platform@example.com
    privateKeySecretRef:
      name: letsencrypt-dns-account-key
    solvers:
      - dns01:
          cloudDNS:
            project: example-project
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: shop-tls
  namespace: shop
spec:
  secretName: shop-tls
  dnsNames:
    - shop.example.com
  issuerRef:
    name: letsencrypt-dns
    kind: ClusterIssuer
```

```bash title="check issuance"
kubectl get certificate -A
kubectl describe certificate shop-tls -n shop
kubectl get certificaterequest,order,challenge -n shop
```

Because the key and certificate live in a Secret, treat that Secret as sensitive: restrict RBAC, enable encryption of Secrets at rest, and avoid copying it between namespaces by hand.

## Failure modes

- **Stuck in Provisioning (ManagedCertificate).** DNS not pointing at the load balancer, a stale record to an old IP, or an HTTP-to-HTTPS redirect or firewall blocking validation. Check with `dig` and `curl -I http://shop.example.com`.
- **CAA records.** A CAA record that does not authorise the issuing CA makes every issuance fail. Check `dig +short CAA example.com` and add the CA your chosen mechanism uses; the correct value is in each product's documentation.
- **ACME rate limits.** Repeated failed attempts against a public CA can lock you out of issuing for a period. Use the CA's staging endpoint while testing, and read the current limits on the CA's documentation page.
- **DNS-01 propagation.** Challenges fail if the TXT record is not visible to the CA yet. cert-manager retries with backoff; look at `kubectl describe challenge`.
- **Workload Identity misconfiguration.** The cert-manager controller cannot write records: `403` in the challenge events. Verify the Kubernetes service account annotation and the IAM binding.
- **Competing controllers.** Two systems managing one hostname, or an Ingress annotated for both, produce confusing results. Pick one per hostname.
- **Certificate Manager map not attached.** The certificate is `ACTIVE` but the load balancer still serves the old one, because the map is not attached to the target proxy. Check the attachment, not only the certificate.

## Monitoring expiry

Do not rely on the issuer to tell you. Alert on the certificate that clients actually see:

- cert-manager exposes `certmanager_certificate_expiration_timestamp_seconds`; alert when fewer than 21 days remain, which leaves time to act well before expiry.
- For Google-managed certificates, alert on the certificate state in Cloud Monitoring where it is exposed, and add a blackbox probe against the public hostname that checks the presented certificate's expiry. The probe catches the failure that every control plane check misses.
- Include the CAA and DNS authorization records in the same review as the certificate, because their removal breaks the next renewal silently.

The runbook for when expiry is near is [[tls-certificate-renewal]]. For TLS fundamentals and how to read a certificate chain see [[http-and-tls]].

## When to choose which

Choose **ManagedCertificate** when you have a handful of public hostnames on a GKE Ingress, DNS you control and can point first, and want zero extra components.

Choose **Certificate Manager** when you need wildcards, many certificates, certificates issued before cutover, Gateway API, or a certificate shared across several load balancers.

Choose **cert-manager** when TLS terminates in the cluster, when names are internal, when you need a private CA, or when you must stay portable across clouds.

## Recommendation

Use Certificate Manager with DNS authorization for public Google load balancers and Gateway API, define it in Terraform, and alert on probed expiry. Use cert-manager for in-cluster termination and internal PKI, with Workload Identity for Cloud DNS and a narrow DNS role. Use ManagedCertificate only for small, simple Ingress setups. Revisit when Google changes limits or supported load balancer types, when you add a mesh, or when a compliance rule requires keys to stay in your control.

## Related

- [[tls-certificate-renewal]]
- [[service-mesh-on-gke]]
- [[cloud-dns-hybrid-and-multi-project]]
- [[http-and-tls]]
- [[gke-workload-identity]]

## Sources

- [cert-manager documentation](https://cert-manager.io/docs/)
- [cert-manager: Google CloudDNS solver](https://cert-manager.io/docs/configuration/acme/dns01/google/)
- [GKE: Google-managed SSL certificates](https://cloud.google.com/kubernetes-engine/docs/how-to/managed-certs)
- [Certificate Manager documentation](https://cloud.google.com/certificate-manager/docs)
