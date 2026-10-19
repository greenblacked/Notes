---
title: cert-manager issuance with DNS-01 on Cloud DNS
description: Design cert-manager ClusterIssuers on GKE with a Cloud DNS DNS-01 solver and Workload Identity, staged on the ACME staging endpoint before production.
type: pattern
tags:
  - patterns
  - kubernetes
  - gke
  - gcp
  - security
  - networking
created: 2026-10-19
modified: 2026-10-19
draft: false
---

cert-manager issues and renews TLS certificates inside the cluster. With the DNS-01 challenge it proves domain control by writing a TXT record, which works for wildcard certificates and for services that are not reachable from the internet. On GKE the solver talks to Cloud DNS using [[gke-workload-identity]], so there is no key to store.

> [!info] Not checked against live docs
> Nothing here was run on a cluster. Check the cert-manager docs for the `cloudDNS` solver fields, the Certificate and ClusterIssuer API versions, the Gateway API integration annotations, the metric names and the `cmctl` commands in your installed version. Check the Let's Encrypt pages for rate limits and endpoint URLs; no limits are quoted here on purpose.

Scope: this note is the design and setup. Day-2 failures such as a certificate that did not renew are in the runbook [[tls-certificate-renewal]]. For protocol background see [[http-and-tls]].

## Which certificate system

| Option                       | Strengths                                                        | Limits                                                                        |
| ---------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Google-managed certificates  | No cluster component, Google renews                              | Tied to Google load balancers; wildcard and private use depend on the product |
| Certificate Manager (Google) | Central, supports DNS authorisation and wildcards                | Applies to Google load balancers, not to in-cluster TLS termination           |
| cert-manager                 | Works for any workload, mesh and ingress; any ACME or private CA | You operate it: upgrades, monitoring, IAM                                     |

Use a Google product when the TLS terminates at a Google load balancer and the features fit. Use cert-manager when certificates are needed inside the cluster (mTLS, a mesh, internal services) or the CA is not Google's. Check the current feature comparison in the Google docs; the products change.

## HTTP-01 or DNS-01

- **HTTP-01** needs the domain to be reachable from the internet on port 80. No wildcards. Simple for public ingress.
- **DNS-01** needs only DNS write access. Wildcards work. Private services work. The price is a credential that can edit DNS, which is why the rest of this note is about limiting it.

## Issuers: staging first, then production

Create one `ClusterIssuer` per ACME environment. Always test against the staging endpoint first: its certificates are not trusted by browsers, but its rate limits are much looser, and a wrong solver configuration costs nothing.

```yaml title="clusterissuer-staging.yaml"
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: platform@example.com
    privateKeySecretRef:
      name: letsencrypt-staging-account-key
    solvers:
      - selector:
          dnsZones:
            - example.com
        dns01:
          cloudDNS:
            project: example-dns
```

```yaml title="clusterissuer-production.yaml"
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-production
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: platform@example.com
    privateKeySecretRef:
      name: letsencrypt-production-account-key
    solvers:
      - selector:
          dnsZones:
            - example.com
        dns01:
          cloudDNS:
            project: example-dns
```

Confirm the directory URLs on the Let's Encrypt staging environment page before using them. `privateKeySecretRef` names the Secret that cert-manager creates to hold the ACME account key; back it up or accept that a new account will be registered if it is lost. There is no `serviceAccountSecretRef` here: with Workload Identity the controller's own identity is used. Check the cloudDNS solver docs for the current wording on ambient credentials.

## Limiting blast radius with CNAME delegation

The solver needs write access to a zone to create `_acme-challenge` TXT records. Giving it the zone that holds your production records means a compromised or buggy cert-manager can rewrite them. Delegate instead:

1. Create a dedicated challenge zone, for example `acme.example.net`, in a small project.
2. In the real zone add a CNAME: `_acme-challenge.example.com` pointing to `_acme-challenge.example.com.acme.example.net`.
3. Grant cert-manager DNS write access **only** on the challenge zone.
4. Configure the solver to use the challenge zone's project. Check the docs for the `cname-strategy` option (`Follow`) on the issuer, which is what makes cert-manager follow the CNAME.

Now the worst cert-manager can do to DNS is write TXT records in a zone that contains nothing else. The CNAME is created once, by Terraform, see [[terraform-module-and-state-layout]].

## IAM with Workload Identity

```bash title="bind DNS role to cert-manager"
export CHALLENGE_PROJECT="example-dns"
export CLUSTER_PROJECT_ID="example-prod"
export CLUSTER_PROJECT_NUMBER="123456789012"

PRINCIPAL="principal://iam.googleapis.com/projects/${CLUSTER_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${CLUSTER_PROJECT_ID}.svc.id.goog/subject/ns/cert-manager/sa/cert-manager"

gcloud projects add-iam-policy-binding "${CHALLENGE_PROJECT}" \
  --member="${PRINCIPAL}" \
  --role="roles/dns.admin"
```

`roles/dns.admin` is what the cert-manager Google guide uses. Because the challenge zone's project contains nothing else, the broad role is acceptable there; otherwise use a custom role limited to record set changes. Check the Cloud DNS IAM docs for the role names. If the API call rejects the federated principal, use the service account impersonation method, annotating the cert-manager ServiceAccount, as in [[gke-workload-identity]]. The same kind of binding is used for [[external-dns-on-gke]]; keep the two identities separate.

## Certificates

For a wildcard and its apex:

```yaml title="certificate.yaml"
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: wildcard-example-com
  namespace: istio-ingress
spec:
  secretName: wildcard-example-com-tls
  issuerRef:
    name: letsencrypt-production
    kind: ClusterIssuer
  dnsNames:
    - example.com
    - "*.example.com"
  duration: 2160h
  renewBefore: 720h
  privateKey:
    algorithm: ECDSA
    size: 256
    rotationPolicy: Always
```

- `renewBefore` leaves a long window for retries. A CA decides the actual lifetime, so check what the issuer returns before relying on `duration`.
- `rotationPolicy: Always` generates a new private key on every renewal. The default keeps the old key. Check the docs for the default in your version.
- The Secret lives in the namespace of the `Certificate`. Reuse across namespaces needs a copy mechanism; prefer one Certificate per namespace that needs it, or terminate TLS once at a shared gateway.

## Ingress and Gateway API

For an Ingress, the annotation `cert-manager.io/cluster-issuer: letsencrypt-production` plus a `tls:` section lets cert-manager create the Certificate itself.

For the Gateway API (see [[0023-gateway-api-for-north-south-traffic]]), cert-manager can read a Gateway listener and create the Certificate. This integration may need to be enabled in the controller configuration. Check the cert-manager Gateway usage page for the feature flag and annotations in your version.

## Staged rollout

1. Install cert-manager with Helm, pinned chart version, CRDs managed deliberately. Check the install docs for the CRD flag.
2. Apply the staging issuer and a staging `Certificate` for a test name.
3. Verify (below). Fix IAM and the delegation here, at no risk.
4. Switch `issuerRef` to production, one environment at a time.
5. Add monitoring before the first production certificate nears expiry.

## Monitoring

Alert before expiry, not after. The controller exports a per-certificate expiry timestamp metric. Check the metric names for your version; the one below is the commonly documented name.

```yaml title="prometheusrule.yaml"
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: cert-manager-expiry
  namespace: monitoring
spec:
  groups:
    - name: cert-manager
      rules:
        - alert: CertificateExpiresSoon
          expr: (certmanager_certificate_expiration_timestamp_seconds - time()) < 14 * 24 * 3600
          for: 1h
          labels:
            severity: ticket
          annotations:
            summary: "Certificate {{ $labels.name }} in {{ $labels.namespace }} expires in under 14 days"
            runbook: "tls-certificate-renewal"
        - alert: CertificateNotReady
          expr: certmanager_certificate_ready_status{condition="False"} == 1
          for: 30m
          labels:
            severity: ticket
```

With `renewBefore` at 30 days, an alert at 14 days means a renewal has been failing for more than two weeks: that is the signal. Page only if the certificate is close to expiry, in line with [[slo-burn-rate-alerting]].

## Failure modes

| Symptom                                    | Cause                                                         | Fix                                                                         |
| ------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Challenge stays `pending`                  | TXT record not created: IAM denied, wrong project, wrong zone | `kubectl describe challenge`, check controller logs and the zone            |
| Challenge created, ACME says invalid       | DNS propagation or CNAME not followed                         | `dig TXT _acme-challenge.example.com`, check the CNAME and `cname-strategy` |
| `dnsZones` selector does not match         | Solver chosen for another domain, or none                     | Fix the selector, check the order and specificity of solvers                |
| Rate limit errors                          | Repeated failed production attempts                           | Use staging until it works; read the rate limit page                        |
| Wrong zone edited                          | Solver project set to the production DNS project              | Use the delegated challenge zone                                            |
| Certificate renewed but app serves old one | Pod caches the cert at start                                  | Reload on change, or restart; see [[secret-rotation-without-downtime]]      |

## Verify

```bash title="verification"
kubectl get clusterissuer
kubectl -n istio-ingress get certificate,certificaterequest,order,challenge
cmctl status certificate wildcard-example-com -n istio-ingress

kubectl -n istio-ingress get secret wildcard-example-com-tls \
  -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -noout -issuer -dates -ext subjectAltName
```

Check `cmctl --help` for the commands in your installed version. A staging certificate shows a staging issuer and is not trusted by clients.

## Rollback

1. Point `issuerRef` back to the previous issuer, or to staging while you debug. The Certificate re-issues.
2. cert-manager keeps the last good Secret until a new one is issued successfully, so a failed renewal does not delete the working certificate. Verify this behaviour in your version before relying on it.
3. If the controller itself is the problem, a rolled-back Helm release restores the previous version. CRDs are not removed by a Helm uninstall by default; do not delete them, since doing so deletes every Certificate.
4. Revoke the DNS binding if cert-manager is retired.

## Related

- [[tls-certificate-renewal]]
- [[gke-workload-identity]]
- [[external-dns-on-gke]]
- [[slo-burn-rate-alerting]]
- [[http-and-tls]]
- [[cloud-dns-hybrid-and-multi-project]]

## Sources

- https://cert-manager.io/docs/configuration/acme/dns01/google/
- https://cert-manager.io/docs/usage/certificate/
- https://cert-manager.io/docs/usage/gateway/
- https://letsencrypt.org/docs/rate-limits/
- https://letsencrypt.org/docs/staging-environment/
