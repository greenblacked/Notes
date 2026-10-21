---
title: TLS and certificate standard
description: Protocol floor, key types, certificate lifetimes, automated issuance, private CAs, mTLS and expiry alerting for every TLS endpoint we run.
type: standard
tags:
  - standards
  - security
  - networking
  - gcp
  - kubernetes
  - observability
created: 2026-10-21
modified: 2026-10-21
draft: false
---

An expired certificate is one of the most predictable outages there is: the date is printed in the certificate. It still happens, usually on the endpoint nobody remembered (an admission webhook, an internal API, a partner integration), and the fix under pressure is often a manual certificate that expires again next year. Weak TLS settings are the other half: a load balancer that still accepts TLS 1.0 because nobody changed the default. This standard sets the minimum protocol, the allowed keys, how certificates are issued and renewed, how long they live, how private CAs and mTLS are used, and how expiry is monitored. The emergency procedure is in [[tls-certificate-renewal]]; the choice between cert-manager and Google-managed certificates is in [[cert-manager-vs-google-managed-certificates]].

## Scope

Every TLS endpoint we operate or depend on:

- **Edge:** Cloudflare zones and other CDNs in front of our services ([[edge-waf-rate-limiting]]).
- **Google Cloud load balancers:** external and internal, including those created by GKE Gateway or Ingress.
- **In-cluster:** service-to-service TLS, service mesh, admission and conversion webhooks.
- **Internal services and tooling:** CI servers, artifact stores, databases that offer TLS.
- **Outbound:** clients we write must validate certificates; disabling verification is forbidden.

> [!info] Check the current docs
> Protocol defaults, certificate lifetime rules and product settings change. The values below are taken from the sources listed at the end and were read on 2026-10-21; Google Cloud load balancer behaviour without an attached SSL policy, Certificate Manager and Certificate Authority Service details, NIST SP 800-52 and some metric names were **not verified** and are marked where used. Thresholds and internal lifetimes are **proposed team defaults**.

## Protocol floor

| Endpoint                           | Minimum                         | Profile                                                |
| ---------------------------------- | ------------------------------- | ------------------------------------------------------ |
| Public, browser or unknown clients | TLS 1.2                         | TLSRef **Intermediate** (TLS 1.2 and 1.3)              |
| Internal, all clients are ours     | TLS 1.2, SHOULD be TLS 1.3 only | TLSRef **Modern** where every client supports TLS 1.3  |
| Partner integrations               | TLS 1.2                         | Intermediate; lower only by exception with an end date |

TLS 1.0 and 1.1 MUST be disabled everywhere. TLS 1.3 MUST be enabled wherever the platform supports it.

The profiles are from [TLSRef's server-side TLS guidelines](https://docs.tlsref.org/server-side-tls.html), the community continuation of Mozilla's Server Side TLS recommendations, which moved out of Mozilla (the archived Mozilla configurator repository now redirects to TLSRef; both read on 2026-10-21). Intermediate is "the recommended configuration for the vast majority of services": TLS 1.2 and 1.3, AEAD cipher suites only (AES-GCM and ChaCha20-Poly1305 with ECDHE), ECDSA P-256 or RSA 2048 certificates. Modern is TLS 1.3 only. Generate server configuration with the [TLSRef configurator](https://configurator.tlsref.org/) (formerly Mozilla's SSL Configuration Generator) rather than copying cipher strings from an old note; the lists change. US federal guidance is [NIST SP 800-52 Rev. 2](https://csrc.nist.gov/pubs/sp/800/52/r2/final), which was not re-read for this note.

### Google Cloud load balancers

The protocol floor on a Google Cloud load balancer is set by an **SSL policy** attached to the target HTTPS or SSL proxy. A new SSL policy defaults to profile `COMPATIBLE` and minimum version `TLS_1_0` (Terraform `google_compute_ssl_policy` and `gcloud compute ssl-policies create --help`), so the defaults do not meet this standard. Every proxy MUST have an explicit SSL policy with `min_tls_version = "TLS_1_2"` and profile `MODERN` (or `RESTRICTED`). A minimum of `TLS_1_3` requires profile `RESTRICTED` (Terraform `google_compute_ssl_policy` docs, read 2026-10-21).

What a load balancer accepts when **no** SSL policy is attached, which load balancer types support SSL policies, and the cipher list of each profile were not verified; see [SSL policies](https://cloud.google.com/load-balancing/docs/ssl-policies-concepts). Assume nothing: attach a policy.

```hcl title="lb/ssl-policy.tf"
# Excerpt: the URL map and the certificate map are defined elsewhere in the stack.
resource "google_compute_ssl_policy" "tls12_modern" {
  name            = "tls12-modern"
  description     = "owner=team-platform; TLS 1.2 minimum, MODERN profile"
  profile         = "MODERN"
  min_tls_version = "TLS_1_2"
}

resource "google_compute_target_https_proxy" "orders" {
  name             = "orders-https-proxy"
  url_map          = google_compute_url_map.orders.id
  ssl_policy       = google_compute_ssl_policy.tls12_modern.id
  certificate_map  = "//certificatemanager.googleapis.com/${google_certificate_manager_certificate_map.orders.id}"
}
```

The `certificate_map` reference format follows the provider examples for Certificate Manager; check it against your provider version. For an existing proxy: `gcloud compute ssl-policies create tls12-modern --global --profile=MODERN --min-tls-version=1.2`, then `gcloud compute target-https-proxies update PROXY --ssl-policy=tls12-modern --global-ssl-policy --global`. For GKE Gateway and Ingress, the SSL policy is attached through the GKE-specific policy resources; check the current GKE documentation for your Gateway class ([[0023-gateway-api-for-north-south-traffic]]).

### Cloudflare

Cloudflare's [Minimum TLS Version](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/minimum-tls/) setting defaults to TLS 1.0 for zones using certificate-based encryption ([protocols reference](https://developers.cloudflare.com/ssl/reference/protocols/)). Every zone MUST set it to `1.2`. It is a zone setting (`min_tls_version`), set in Terraform or through the zone settings API:

```bash title="Set and check minimum TLS on a zone"
ZONE_ID="0123456789abcdef0123456789abcdef"   # zone ID from the dashboard or API
# CLOUDFLARE_API_TOKEN comes from the environment, never from shell history.
curl -sS -X PATCH "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/min_tls_version" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"value":"1.2"}'

curl -sS "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/min_tls_version" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | jq -r '.result.value'
```

Per-hostname minimums need Advanced Certificate Manager. The setting does not apply to Cloudflare Pages hostnames or to R2 custom domains, which have their own settings. Origin connections (Cloudflare to our load balancer) are governed by the zone's SSL/TLS encryption mode and by our load balancer's SSL policy; the origin MUST present a valid certificate and the mode MUST validate it.

## Keys

- **Algorithm.** ECDSA P-256 is preferred; RSA 2048 bits is the minimum for RSA. Ed25519 is allowed for internal certificates where every client supports it.
- **Generated where used.** The private key is generated by the issuer or the controller that uses it (cert-manager, the Google-managed certificate service, the CA service), never on a laptop.
- **Never in Git, images or Terraform state.** A private key MUST NOT be committed, baked into an image, passed on a command line or stored in Terraform state. For self-managed certificates in Google Cloud Certificate Manager, the provider stores `pem_private_key` in state as plain text; use the write-only `pem_private_key_wo` argument where your provider version offers it (write-only arguments need a recent Terraform release; check your provider and Terraform versions), or better, a Google-managed certificate.
- **Stored as secrets.** In Kubernetes the key lives in a `kubernetes.io/tls` Secret written by cert-manager or synced from Secret Manager with [[external-secrets-with-secret-manager]], with RBAC limited to the workload. CA keys live in Certificate Authority Service or Cloud KMS ([[cloud-kms-key-management]]), never in a Secret.
- **Rotated on renewal.** cert-manager's `privateKey.rotationPolicy` default changed in v1.18.0 from `Never` to `Always`. Set `rotationPolicy: Always` explicitly so behaviour does not depend on the installed version.

## Issuance: automated only

Every certificate MUST be issued and renewed by a machine:

| Endpoint                               | Issuer                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Google Cloud external load balancers   | Google-managed certificates through Certificate Manager                                                  |
| GKE workloads and in-cluster endpoints | cert-manager with ACME DNS-01 on Cloud DNS ([[cert-manager-dns01-cloud-dns]]) or a private CA issuer     |
| Cloudflare edge                        | Cloudflare edge certificates (universal or advanced)                                                     |
| Internal service-to-service            | Private CA (Certificate Authority Service, or a cert-manager CA issuer backed by it) or the service mesh |
| Webhooks                               | cert-manager with `cainjector`, or the controller's own rotation                                         |

A manually requested certificate (bought, uploaded, emailed) needs an exception with an owner and a calendar entry, and is the first candidate for automation. Certificate Manager and Certificate Authority Service behaviour (managed renewal timing, authorization, tiers, maximum lifetimes) was not verified for this note; see the [Certificate Manager](https://cloud.google.com/certificate-manager/docs/overview) and [Certificate Authority Service](https://cloud.google.com/certificate-authority-service/docs) documentation.

A compliant cert-manager `Certificate`:

```yaml title="certificate.yaml"
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: orders-api-example-com
  namespace: orders-prod
spec:
  secretName: orders-api-example-com-tls
  dnsNames:
    - orders.example.com
  issuerRef:
    kind: ClusterIssuer
    name: letsencrypt-dns01
  duration: 2160h # 90 days; the issuer may impose its own duration
  # No renewBefore: renewal happens at 2/3 of the issued lifetime by default.
  privateKey:
    algorithm: ECDSA
    size: 256
    rotationPolicy: Always # explicit: the default changed in cert-manager v1.18.0
  usages:
    - server auth
```

From the [cert-manager Certificate documentation](https://cert-manager.io/docs/usage/certificate/): `duration` defaults to 90 days (minimum 1 hour), renewal defaults to two thirds of the lifetime, and `renewBefore` (absolute) or `renewBeforePercentage` can change that; `duration` must be greater than `renewBefore`. Prefer `renewBeforePercentage` over `renewBefore` when you need to change the renewal point, because the issuer may shorten the duration and an absolute `renewBefore` longer than the real lifetime causes renewal loops.

## Lifetimes

**Public certificates** follow the CA/Browser Forum Baseline Requirements. Version 2.3.1 (dated 2026-10-04, read 2026-10-21), section 6.3.2, caps the validity of publicly trusted TLS server certificates by issue date:

| Issued                             | Maximum validity |
| ---------------------------------- | ---------------- |
| Before 2026-03-15                  | 398 days         |
| From 2026-03-15, before 2027-03-15 | 200 days         |
| From 2027-03-15, before 2029-03-15 | 100 days         |
| From 2029-03-15                    | 47 days          |

The reuse period for domain validation data shrinks on the same dates (200, 100, then 10 days from 2029-03-15), so even renewals will need fresh domain validation more often. Check the [current Baseline Requirements](https://cabforum.org/working-groups/server/baseline-requirements/) before relying on the dates. The practical consequence: anything that is not automated today will break, and the 47-day horizon means renewal must work without a human every few weeks. TLSRef recommends 90 days as the maximum certificate lifespan to encourage automation, and we adopt that now for public certificates.

**Private certificates** are not bound by those rules, which is no reason to make them long-lived:

| Certificate                              | Lifetime (proposed default)                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Workload leaf (service-to-service, mesh) | 30 days or less, renewed automatically                                                      |
| Webhook serving certificate              | 90 days or less, renewed by cert-manager or the controller                                  |
| Intermediate (issuing) CA                | 1 to 3 years, rotated with overlap                                                          |
| Root CA                                  | Long-lived, key in Certificate Authority Service or an HSM, used only to sign intermediates |

## Private CA and trust distribution

- **One private CA hierarchy per environment boundary.** Production and non-production do not share an issuing CA, so a non-production key cannot mint certificates production trusts.
- **Issuing CAs are managed.** Use Certificate Authority Service, or a cert-manager CA issuer whose CA is issued by it. A CA key in a Kubernetes Secret is allowed only for non-production with an exception.
- **Trust bundles are distributed as code.** The CA bundle is published from one source (a ConfigMap generated by a controller such as cert-manager's trust-manager, see [[patterns/private-ca-and-egress-proxy-trust]], or baked into the golden base image per [[0040-golden-base-images-owned-by-platform]]) and rotated with an overlap: the new CA is added to bundles before any certificate it signs is deployed, and the old one is removed after its last certificate expires.
- **Never disable verification** to work around a missing bundle (`curl -k`, `InsecureSkipVerify`, `verify=False`). It is a review blocker and a finding in [[code-review]].

## Mutual TLS

The rules below are our design choices, not taken from a vendor standard.

- **Service-to-service authentication in GKE** uses the service mesh's mTLS where a mesh is deployed ([[service-mesh-on-gke]]), with strict mode in production namespaces once all clients are in the mesh. Application-level mTLS is reserved for services outside the mesh.
- **Identity in the certificate** is a workload identity (a SPIFFE-style URI SAN or the service account), not a hostname alone. Authorization decisions use that identity.
- **Client certificates for partners** are issued from a separate CA per partner or partner class, with a lifetime of 90 days or less and a revocation path that is tested.
- **mTLS is not a replacement for authorization.** It proves who is calling, not what they may do.

## Expiry monitoring

Automation fails silently: a DNS-01 permission removed, a rate limit hit, a webhook down. Monitoring is how we find out before users do. Every certificate MUST be covered by at least one of:

1. **External probe.** The Prometheus [blackbox exporter](https://github.com/prometheus/blackbox_exporter) probes every public and internal HTTPS endpoint and exposes `probe_ssl_earliest_cert_expiry`, the earliest `NotAfter` of the presented chain as a Unix timestamp. This catches certificates from every issuer, including the ones we forgot.
2. **Issuer metrics.** cert-manager exports certificate expiry, renewal and readiness metrics. From the source, the names appear to be `certmanager_certificate_expiration_timestamp_seconds`, `certmanager_certificate_renewal_timestamp_seconds` and `certmanager_certificate_ready_status`; they are **not verified** against a running install, so check with `curl` on the controller's metrics endpoint before writing rules ([cert-manager Prometheus metrics](https://cert-manager.io/docs/devops-tips/prometheus-metrics/)).

Alert thresholds (proposed defaults, for certificates of 90 days; revisit as public lifetimes shrink):

| Condition                                       | Severity                  | Why                                                                                    |
| ----------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------- |
| Expires in less than 21 days                    | `ticket`                  | Automated renewal should have happened at 30 days left                                 |
| cert-manager Certificate not Ready for 1 hour   | `ticket`                  | Renewal is failing; there is time to fix it                                            |
| Expires in less than 7 days                     | `ticket`, raised priority | Renewal has failed repeatedly                                                          |
| Production endpoint expires in less than 2 days | `page`                    | Imminent user impact; a documented exception under [[0045-page-only-on-slo-burn-rate]] |

Certificate expiry is a cause alert, so under ADR 0045 it normally opens a ticket. The two-day page is the written exception that ADR allows: it predicts imminent, total failure that no burn-rate alert would catch in time.

```yaml title="rules/certificates.yaml"
groups:
  - name: certificates
    rules:
      - alert: TlsCertificateExpiresIn21Days
        expr: (probe_ssl_earliest_cert_expiry - time()) < 21 * 86400
        for: 1h
        labels:
          severity: ticket
          team: team-platform
        annotations:
          summary: "Certificate for {{ $labels.instance }} expires in less than 21 days"
          description: "Automated renewal has not happened. Expires in {{ $value | humanizeDuration }}."
          runbook_url: "https://runbooks.example.com/tls/certificate-expiry"

      - alert: TlsCertificateExpiresIn2DaysProd
        expr: (probe_ssl_earliest_cert_expiry{environment="prod"} - time()) < 2 * 86400
        for: 10m
        labels:
          severity: page
          team: team-platform
        annotations:
          summary: "Production certificate for {{ $labels.instance }} expires within 2 days"
          description: "Follow the emergency renewal runbook now. Expires in {{ $value | humanizeDuration }}."
          runbook_url: "https://runbooks.example.com/tls/certificate-expiry"

      # Metric name not verified: confirm on your cert-manager version first.
      - alert: CertManagerCertificateNotReady
        expr: max by (namespace, name) (certmanager_certificate_ready_status{condition="False"}) == 1
        for: 1h
        labels:
          severity: ticket
          team: team-platform
        annotations:
          summary: "cert-manager Certificate {{ $labels.namespace }}/{{ $labels.name }} is not Ready"
          description: "Check the CertificateRequest and Order events: kubectl describe certificate -n {{ $labels.namespace }} {{ $labels.name }}"
          runbook_url: "https://runbooks.example.com/tls/cert-manager-not-ready"
```

The `environment` label on the probe target and the `team` routing follow [[alert-and-runbook-standard]]. Test the rules with `promtool test rules` as that standard requires.

## Inventory and validation commands

Run these before a change, after a change and in the quarterly review. They were checked against the local help of OpenSSL 3.0.13 and curl 8.5.0, not run against a live endpoint for this note.

```bash title="tls-check.sh"
#!/usr/bin/env bash
# Diagnostic script: each check prints its own result, so it does not stop on the first failure.
set -u
HOST="orders.example.com"
PORT=443

# 1. What certificate is served (subject, issuer, dates, SANs)?
echo | openssl s_client -connect "${HOST}:${PORT}" -servername "${HOST}" 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName

# 2. Does it expire within 21 days? Exit status 1 means yes.
echo | openssl s_client -connect "${HOST}:${PORT}" -servername "${HOST}" 2>/dev/null \
  | openssl x509 -noout -checkend $((21 * 86400)) && echo "OK: more than 21 days left"

# 3. Is the chain valid for a normal client?
echo | openssl s_client -connect "${HOST}:${PORT}" -servername "${HOST}" \
  -verify_return_error 2>&1 | grep -E "Verify return code"

# 4. TLS 1.2 and 1.3 must succeed.
echo | openssl s_client -connect "${HOST}:${PORT}" -servername "${HOST}" -tls1_2 -brief 2>&1 | head -3
echo | openssl s_client -connect "${HOST}:${PORT}" -servername "${HOST}" -tls1_3 -brief 2>&1 | head -3

# 5. TLS 1.1 must fail. OpenSSL 3 refuses TLS 1.1 at its default security level,
#    so lower the level for this test only, or the check proves nothing about the server.
if echo | openssl s_client -connect "${HOST}:${PORT}" -servername "${HOST}" \
     -tls1_1 -cipher 'DEFAULT@SECLEVEL=0' >/dev/null 2>&1; then
  echo "FAIL: server accepted TLS 1.1"
else
  echo "OK: TLS 1.1 refused"
fi

# 6. The same from curl's point of view (status code and verify result).
curl -sS --tlsv1.2 "https://${HOST}/" -o /dev/null -w '%{http_code} %{ssl_verify_result}\n'
```

For Google Cloud inventories: `gcloud certificate-manager certificates list --location=global` and `gcloud compute ssl-certificates list --global` list certificates the load balancers use; `gcloud compute ssl-policies list` shows the policies. For Kubernetes: `kubectl get certificates -A` lists cert-manager certificates with their Ready state.

## Webhooks and internal CAs

Admission and conversion webhooks are the most common forgotten certificates: when the serving certificate expires, the API server cannot call the webhook, and depending on `failurePolicy` every matching create or update is rejected. Every webhook MUST either get its certificate from cert-manager with the CA bundle injected by `cainjector`, or document the controller's own rotation, and MUST be covered by an expiry alert through the issuer metrics, because the blackbox exporter does not usually reach webhook services. The recovery procedure is [[admission-webhook-certificate-expiry]].

## Exceptions and expiry

Exceptions follow [[policy-exception-and-waiver-process]]. Typical cases: a partner that cannot do TLS 1.2 yet (time-boxed, separate endpoint, extra logging), a vendor appliance with a manually installed certificate (owner, calendar entry, expiry alert), a legacy client without TLS 1.3. Disabling certificate verification in a client is not an exception we grant.

## Reviewer checklist

- [ ] Every load balancer proxy has an explicit SSL policy with TLS 1.2 minimum and `MODERN` or `RESTRICTED`.
- [ ] Every Cloudflare zone has minimum TLS 1.2; origin certificates are validated.
- [ ] Certificates are issued automatically (Google-managed, cert-manager or the mesh); manual ones have an exception.
- [ ] Keys are ECDSA P-256 or RSA 2048 or larger; `rotationPolicy: Always` is explicit.
- [ ] No private key in Git, an image, a command line or Terraform state.
- [ ] Public certificates last 90 days or less; private leaf certificates 30 days or less.
- [ ] Private CAs are separate for production; trust bundles are distributed as code with overlap.
- [ ] No client disables certificate verification.
- [ ] The endpoint is covered by a blackbox probe or issuer metric, with the alert thresholds above.
- [ ] Webhook certificates are rotated automatically and monitored.

## Sources

- [CA/Browser Forum TLS Baseline Requirements](https://cabforum.org/working-groups/server/baseline-requirements/), version 2.3.1, section 6.3.2 (validity periods)
- [TLSRef server-side TLS guidelines](https://docs.tlsref.org/server-side-tls.html) and [configurator](https://configurator.tlsref.org/), read 2026-10-21 from their [source repository](https://github.com/tlsref/docs); the [archived Mozilla configurator repository](https://github.com/mozilla/ssl-config-generator) records the move
- Terraform [`google_compute_ssl_policy`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_ssl_policy) and [`google_certificate_manager_certificate`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/certificate_manager_certificate)
- [Google Cloud SSL policies](https://cloud.google.com/load-balancing/docs/ssl-policies-concepts) (not verified for this note)
- [Certificate Manager](https://cloud.google.com/certificate-manager/docs/overview) and [Certificate Authority Service](https://cloud.google.com/certificate-authority-service/docs) (not verified for this note)
- [Cloudflare Minimum TLS Version](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/minimum-tls/) and [TLS protocols](https://developers.cloudflare.com/ssl/reference/protocols/)
- [cert-manager Certificate resource](https://cert-manager.io/docs/usage/certificate/) and [Prometheus metrics](https://cert-manager.io/docs/devops-tips/prometheus-metrics/)
- [Prometheus blackbox exporter](https://github.com/prometheus/blackbox_exporter)
- [NIST SP 800-52 Rev. 2](https://csrc.nist.gov/pubs/sp/800/52/r2/final) (not verified for this note)

## Related

- [[tls-certificate-renewal]]: the emergency renewal runbook.
- [[cert-manager-dns01-cloud-dns]] and [[cert-manager-vs-google-managed-certificates]]: issuance in practice.
- [[admission-webhook-certificate-expiry]]: when a webhook certificate has already expired.
- [[encryption-at-rest-and-in-transit-evidence-gcp]]: evidence for auditors.
- [[http-and-tls]]: the protocol basics.
- [[cloud-kms-key-management]] and [[external-secrets-with-secret-manager]]: where keys and secrets live.
- [[edge-waf-rate-limiting]]: the edge in front of the load balancer.
- [[alert-and-runbook-standard]]: alert labels, routing and tests.
- [[network-troubleshooting-dns-mtu-tls-load-balancers]]: TLS failures in the network path.
- [[patterns/private-ca-and-egress-proxy-trust]]: private CAs, trust-manager bundles and egress proxy trust.
