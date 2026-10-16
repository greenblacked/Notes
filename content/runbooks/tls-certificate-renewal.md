---
title: TLS certificate renewal
description: Find certificate expiry, renew with cert-manager, debug Certificate, Order and Challenge objects, handle Google-managed certificates on GKE, and alert before expiry.
type: runbook
tags:
  - runbooks
  - security
  - kubernetes
  - gke
  - observability
created: 2026-10-16
modified: 2026-10-16
draft: false
---

Certificates fail quietly until the day they expire. This runbook covers finding what expires and when, forcing and debugging renewal with cert-manager, Google-managed certificates on GKE, and the alerts that stop it happening again.

> [!info] Scope
> cert-manager object names and commands are from cert-manager.io documentation as known. The GKE managed certificate details need checking: the vendor pages were not re-fetched, so the note is not marked `verified`. Verify the `cmctl` subcommands with `cmctl --help` and the managed certificate fields on cloud.google.com.

## When to use

- A certificate has expired or will within days, or a browser or client reports a TLS error (`certificate has expired`, `unable to verify`, name mismatch).
- cert-manager shows a Certificate that is not `Ready`, or an Order or Challenge stuck.
- A Google-managed certificate is stuck in `Provisioning` or `FAILED_NOT_VISIBLE`.
- You are setting up expiry monitoring.

## Preconditions

- Access to the cluster (`kubectl`), and to DNS for the domain if the ACME challenge needs it.
- For GKE managed certificates: access to the project and to the load balancer configuration.
- Optional but useful: the `cmctl` CLI from the cert-manager project.

```bash
HOST=app.example.com
PORT=443
NS=my-namespace
CERT=app-tls
```

## Steps

### 1. Find the expiry

From outside, exactly as a client sees it. `-servername` is required for SNI, otherwise you may see the default certificate.

```bash
echo | openssl s_client -connect "$HOST:$PORT" -servername "$HOST" 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName

# Exit status 0 if still valid in 14 days (1209600 seconds)
echo | openssl s_client -connect "$HOST:$PORT" -servername "$HOST" 2>/dev/null \
  | openssl x509 -noout -checkend 1209600
```

Inside the cluster, from the Secret:

```bash
kubectl get secret "$CERT" -n "$NS" -o jsonpath='{.data.tls\.crt}' | base64 -d \
  | openssl x509 -noout -subject -issuer -dates
kubectl get certificate -A
```

If the certificate served differs from the one in the Secret, the ingress or load balancer is serving a stale one: check which ingress, gateway or load balancer terminates TLS, and whether it reloaded.

To find everything expiring soon in the cluster:

```bash
kubectl get certificate -A -o custom-columns=NS:.metadata.namespace,NAME:.metadata.name,READY:.status.conditions[0].status,EXPIRES:.status.notAfter,RENEWAL:.status.renewalTime
```

### 2. cert-manager: check and force renewal

cert-manager renews a certificate automatically when it reaches the renewal point (by default two thirds of its lifetime, or as set by `spec.renewBefore`). The objects form a chain: **Certificate** creates a **CertificateRequest**, which for ACME issuers creates an **Order**, which creates one or more **Challenges**.

```bash
kubectl describe certificate "$CERT" -n "$NS"
kubectl get certificaterequest,order,challenge -n "$NS"
```

With `cmctl`:

```bash
cmctl status certificate "$CERT" -n "$NS"
cmctl renew "$CERT" -n "$NS"          # force a new issuance now
```

Without it, delete the Secret (cert-manager reissues) or trigger via annotation-free means such as `kubectl delete secret`:

```bash
kubectl get secret "$CERT" -n "$NS" -o yaml > "$CERT-secret-backup.yaml"   # backup first
kubectl delete secret "$CERT" -n "$NS"
```

Deleting the Secret removes the live certificate until reissue completes; do this only if the current certificate is already expired or unusable, and not as a routine renewal.

### 3. cert-manager: debug a failing issuance

Work down the chain; the failure message sits in the lowest object that has one.

```bash
kubectl describe certificaterequest -n "$NS"
kubectl describe order -n "$NS"
kubectl describe challenge -n "$NS"
kubectl logs -n cert-manager deploy/cert-manager --tail=100
```

| Where it fails                       | Typical cause                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Certificate: `Issuing`, no request   | Issuer or ClusterIssuer missing or not `Ready` (`kubectl describe clusterissuer`), wrong `issuerRef`.                                                                                                                          |
| CertificateRequest `Denied`/`Failed` | Approval policy or issuer rejected it; read the message. Private CA issuers may need the CA Secret.                                                                                                                            |
| Order `pending`, Challenge `pending` | The ACME check cannot succeed yet.                                                                                                                                                                                             |
| Challenge HTTP-01 fails              | `/.well-known/acme-challenge/<token>` not reachable from the internet: ingress class wrong, a redirect to HTTPS, a NetworkPolicy or WAF blocking, wrong DNS. Test with `curl -v http://$HOST/.well-known/acme-challenge/test`. |
| Challenge DNS-01 fails               | Missing DNS permissions (for Cloud DNS, the cert-manager service account needs DNS admin on the zone, ideally through Workload Identity, see [[gke-workload-identity]]), propagation delay, wrong zone.                        |
| `429` / rate limited                 | Let's Encrypt limits for the domain or failed validations. Wait, or use the staging issuer while testing.                                                                                                                      |
| Renewal never triggers               | `renewBefore` larger than the certificate lifetime, or a controller that is down. Check the cert-manager pods.                                                                                                                 |

Fix the cause, then renew again with `cmctl renew`. Failed Orders are retried with back-off, so a fix may need a manual renew to avoid waiting.

### 4. Google-managed certificates on GKE

GKE Ingress and Google Cloud load balancers can use Google-managed certificates, which are provisioned and renewed by Google once the domain's DNS points at the load balancer IP. Two APIs are common: the GKE `ManagedCertificate` resource (referenced from an Ingress annotation) and Certificate Manager certificates attached to a load balancer. Check the current docs for which one you use, since the status fields differ.

```bash
kubectl get managedcertificate -n "$NS"
kubectl describe managedcertificate "$CERT" -n "$NS"      # Certificate Status, Domain Status

# Certificate Manager / classic SSL certificates (check which applies)
gcloud certificate-manager certificates list
gcloud compute ssl-certificates list --format="table(name,type,managed.status,managed.domainStatus,expireTime)"
gcloud compute ssl-certificates describe CERT_NAME --global
```

Common failure modes:

- The domain's A/AAAA record does not point at the load balancer's IP (or points at the old one). Provisioning cannot complete; fix DNS and wait.
- CAA records block the issuing CA. Allow the CA Google uses (see the docs).
- A domain in `FAILED_NOT_VISIBLE` means Google cannot reach the domain via the load balancer; check DNS and that the frontend uses the right IP and an HTTP(S) forwarding rule.
- Provisioning can take a long time (the docs say up to many minutes to hours; check the current figure) and cannot be sped up.

You cannot renew a Google-managed certificate on demand. If one fails, fix DNS or replace it: create a new certificate, add it to the target proxy or ingress, then remove the old one. Do not delete the old certificate first, since a load balancer needs a valid certificate attached.

### 5. Replace manually (non-managed certificate)

For a certificate you hold yourself (commercial CA, internal CA), issue the new certificate and chain, then update the Secret or load balancer:

```bash
kubectl get secret "$CERT" -n "$NS" -o yaml > "$CERT-secret-backup.yaml"
kubectl create secret tls "$CERT" -n "$NS" --cert=fullchain.pem --key=privkey.pem \
  --dry-run=client -o yaml | kubectl apply -f -
```

Use the full chain (leaf plus intermediates) in `tls.crt`, in order. Check that the key matches the certificate:

```bash
diff <(openssl x509 -noout -modulus -in fullchain.pem | openssl md5) \
     <(openssl rsa -noout -modulus -in privkey.pem | openssl md5) && echo match
```

(For ECDSA keys compare public keys with `openssl pkey -pubout` instead.) Ingress controllers usually pick up a changed Secret without restart; some need a reload.

### 6. Monitor expiry and alert

Do not depend on email from the CA. Alert from two sources:

1. **cert-manager metrics:** `certmanager_certificate_expiration_timestamp_seconds` and `certmanager_certificate_ready_status`.
2. **Blackbox probes** of public endpoints: `probe_ssl_earliest_cert_expiry` from the Prometheus blackbox exporter, which catches certificates cert-manager does not know about.

```yaml title="cert-alerts.yaml"
groups:
  - name: certificates
    rules:
      - alert: CertificateExpiringSoon
        expr: (certmanager_certificate_expiration_timestamp_seconds - time()) < 14 * 24 * 3600
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "Certificate {{ $labels.namespace }}/{{ $labels.name }} expires in under 14 days"
      - alert: CertificateNotReady
        expr: certmanager_certificate_ready_status{condition="False"} == 1
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "Certificate {{ $labels.namespace }}/{{ $labels.name }} is not Ready"
      - alert: EndpointCertificateExpiring
        expr: (probe_ssl_earliest_cert_expiry - time()) < 7 * 24 * 3600
        for: 30m
        labels:
          severity: critical
        annotations:
          summary: "TLS certificate for {{ $labels.instance }} expires in under 7 days"
```

Because auto-renewal normally happens a third of the way before expiry, an alert at 14 days means renewal has already failed for a long time, so route it to a person. For burn-rate style alerting on user-visible failures, see [[slo-burn-rate-alerting]], and for the Prometheus side see [[prometheus-vs-cloud-monitoring]].

## Validation

```bash
echo | openssl s_client -connect "$HOST:$PORT" -servername "$HOST" 2>/dev/null | openssl x509 -noout -dates -issuer
echo | openssl s_client -connect "$HOST:$PORT" -servername "$HOST" -verify_return_error 2>&1 | grep -E "Verify return code"
curl -sSI "https://$HOST/" -o /dev/null -w '%{http_code} %{ssl_verify_result}\n'
kubectl get certificate "$CERT" -n "$NS"      # READY True
```

Expected: `notAfter` in the future (and later than before), `Verify return code: 0 (ok)`, `ssl_verify_result` 0. Test every load balancer or region, since each may serve its own copy, and check an old client or a pinned-certificate integration if you have one.

## Rollback

- Keep the previous Secret YAML from the backup. Re-applying it restores the old certificate, which helps only if it is not expired and the new one is wrong (wrong chain, wrong SAN).
- cert-manager: set the previous `Certificate` spec back and renew. A changed key algorithm or `duration` can break clients; revert the spec in Git.
- Google-managed or load balancer: re-attach the old certificate to the proxy before removing the new one.
- An expired certificate cannot be rolled back to; the way forward is issuance.

## Troubleshooting

| Symptom                                             | Cause and fix                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Clients still see the old certificate after renewal | Ingress or proxy has not reloaded, a CDN or second load balancer serves another copy, or SNI selects another cert. |
| `unable to get local issuer certificate`            | Missing intermediate in the chain. Use the full chain in `tls.crt`.                                                |
| Name mismatch                                       | The SAN list lacks the host. Fix `dnsNames` in the Certificate and reissue.                                        |
| Certificate `Ready` but ingress serves a fake cert  | Ingress references the wrong Secret name or namespace, or uses the controller's default certificate.               |
| HTTP-01 challenge works in staging, not in prod     | A production WAF, redirect or NetworkPolicy blocks the solver pod; see [[kubernetes-network-policies]].            |
| `FAILED_NOT_VISIBLE` on managed certificate         | DNS does not point to the load balancer. Fix DNS and wait for retry.                                               |
| Expiry alert fires for a decommissioned host        | Remove the probe target or the Certificate, rather than silencing the alert.                                       |

If an expired certificate caused customer impact, run it as an incident with [[incident-response]] and ask in the review why the 14 day alert did not lead to action.
