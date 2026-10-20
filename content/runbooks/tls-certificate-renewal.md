---
title: TLS certificate renewal
description: Find certificate expiry, renew with cert-manager, debug Certificate, Order and Challenge objects, handle Google-managed GKE certificates, alert before expiry
type: runbook
tags:
  - runbooks
  - security
  - kubernetes
  - gke
  - observability
created: 2026-10-16
modified: 2026-10-20
evidence: source-reviewed
reviewed: 2026-10-20
review-due: 2027-04-20
destructive: true
draft: false
---

Certificates fail quietly until the day they expire. This runbook covers finding what expires and when, forcing and debugging renewal with cert-manager, Google-managed certificates on GKE, and the alerts that stop it happening again.

> [!info] Source-reviewed on 2026-10-20, with the `openssl` helper checks run in a lab
> This note is rated source-reviewed because its main procedures (cert-manager, GKE managed certificates, replacing the Secret) were not run. The `openssl` commands (outside view, expiry check, key and certificate match, chain verification, the Secret decoding pipeline) were run against a throwaway CA and local test servers. The cert-manager, GKE and `gcloud` claims were checked against official documentation and API definitions, not run. No `kubectl`, `cmctl`, cluster, Google Cloud or ACME command was run. The Evidence section at the end lists the sources, what was not verified and the lab output.

> [!warning] Parts of this runbook delete or overwrite a certificate Secret
> Deleting the Secret (step 2) or re-applying one (step 5) replaces the certificate and key the ingress serves, and the Secret backup contains the private key. Back up first, prefer `cmctl renew`, and read the Cleanup and rollback part of the Evidence section before running anything.

## When to use

- A certificate has expired or will within days, or a browser or client reports a TLS error (`certificate has expired`, `unable to verify`, name mismatch).
- cert-manager shows a Certificate that is not `Ready`, or an Order or Challenge stuck.
- A Google-managed certificate is stuck in `Provisioning`, or a domain shows `FailedNotVisible` (`ManagedCertificate`) or `FAILED_NOT_VISIBLE` (Compute Engine API); see step 4.
- You are setting up expiry monitoring.

## Preconditions

- Access to the cluster (`kubectl`), and to DNS for the domain if the ACME challenge needs it.
- For GKE managed certificates: access to the project and to the load balancer configuration.
- Optional but useful: the `cmctl` CLI. It is now developed in its own repository (`cert-manager/cmctl`), separately from cert-manager itself; install the version that matches your cluster's cert-manager and check `cmctl --help`.

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

The commands above print the certificate's dates and names but do not check the host name. Add `-verify_hostname "$HOST"` (and `-CAfile` for a private CA) to the `s_client` call when you want a name check: in the lab a wrong name gave `Verify return code: 62 (hostname mismatch)`. `-checkend` exits 0 if the certificate will still be valid after that many seconds and 1 if it will have expired.

If the certificate served differs from the one in the Secret, the ingress or load balancer is serving a stale one: check which ingress, gateway or load balancer terminates TLS, and whether it reloaded.

To find everything expiring soon in the cluster:

```bash
kubectl get certificate -A -o custom-columns=NS:.metadata.namespace,NAME:.metadata.name,READY:.status.conditions[0].status,EXPIRES:.status.notAfter,RENEWAL:.status.renewalTime
```

### 2. cert-manager: check and force renewal

cert-manager renews a certificate automatically when it reaches the renewal point: by default two thirds of the issued certificate's lifetime, or `spec.renewBefore` (an absolute duration) or `spec.renewBeforePercentage` before expiry when set. The time is written to `status.renewalTime`, and the expiry is in `status.notAfter`. The default `spec.duration` is 90 days; the minimum duration is 1 hour and the minimum effective `renewBefore` is 5 minutes, and `duration` must be larger than `renewBefore`. The objects form a chain: **Certificate** creates a **CertificateRequest**, which for ACME issuers creates an **Order**, which creates one or more **Challenges**.

```bash
kubectl describe certificate "$CERT" -n "$NS"
kubectl get certificaterequest,order,challenge -n "$NS"
```

With `cmctl`:

```bash
cmctl status certificate "$CERT" -n "$NS"
cmctl renew "$CERT" -n "$NS"          # mark the Certificate for renewal now
```

`cmctl renew` is the documented way to trigger a reissue. The cert-manager documentation says that deleting the Secret is not a recommended way to rotate a key. Without `cmctl`, delete the Secret only as a last resort, when the certificate is already expired or unusable and you have a backup; cert-manager then notices the missing Secret and issues a new one (behaviour not run here). Do not use deletion as routine renewal: the ingress serves no or a default certificate until issuance completes.

```bash
(umask 077; kubectl get secret "$CERT" -n "$NS" -o yaml > "$CERT-secret-backup.yaml")   # backup first
kubectl delete secret "$CERT" -n "$NS"
```

> [!warning] The backup contains the private key
> Create it with `umask 077`, keep it out of git, tickets and chat, and delete it (`shred` or `rm`) once the new certificate is confirmed.

> [!warning] Deleting the Secret removes the served certificate
> If issuance then fails (rate limit, broken issuer, challenge failure), the workload has no valid certificate. Restore with `kubectl apply -f "$CERT-secret-backup.yaml"` (strip `resourceVersion`, `uid` and `creationTimestamp` if the apply complains), which brings back the old certificate only if it is still valid. Delete the Secret during a window when you can watch the Order, and not at all if the old certificate is still valid.

### 3. cert-manager: debug a failing issuance

Work down the chain; the failure message sits in the lowest object that has one.

```bash
kubectl describe certificaterequest -n "$NS"
kubectl describe order -n "$NS"
kubectl describe challenge -n "$NS"
kubectl logs -n cert-manager deploy/cert-manager --tail=100
```

| Where it fails                       | Typical cause                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Certificate: `Issuing`, no request   | Issuer or ClusterIssuer missing or not `Ready` (`kubectl describe clusterissuer`), wrong `issuerRef`.                                                                                                                                                                                                            |
| CertificateRequest `Denied`/`Failed` | Approval policy or issuer rejected it; read the message. Private CA issuers may need the CA Secret.                                                                                                                                                                                                              |
| Order `pending`, Challenge `pending` | The ACME check cannot succeed yet.                                                                                                                                                                                                                                                                               |
| Challenge HTTP-01 fails              | `/.well-known/acme-challenge/<token>` not reachable from the internet: ingress class wrong, a redirect to HTTPS, a NetworkPolicy or WAF blocking, wrong DNS. Test with `curl -v http://$HOST/.well-known/acme-challenge/test`.                                                                                   |
| Challenge DNS-01 fails               | Missing DNS permissions (for Cloud DNS, the cert-manager service account needs DNS admin on the zone, ideally through Workload Identity, see [[gke-workload-identity]]), propagation delay, wrong zone.                                                                                                          |
| `429` / rate limited                 | Let's Encrypt limits for the domain or failed validations. Wait, or use the staging issuer while testing.                                                                                                                                                                                                        |
| Renewal never triggers               | A `renewBefore` larger than or equal to `duration` is rejected when the Certificate is applied (`kubectl apply` fails), and one close to `duration` can cause a renewal loop (see the cert-manager docs). Otherwise the controller is down or not running. Check the cert-manager pods and `status.renewalTime`. |

Fix the cause, then renew again with `cmctl renew`. Failed Orders are retried with back-off, so a fix may need a manual renew to avoid waiting.

### 4. Google-managed certificates on GKE

GKE Ingress and Google Cloud load balancers can use Google-managed certificates, which are provisioned and renewed by Google once the domain's DNS points at the load balancer IP. Two APIs are common: the GKE `ManagedCertificate` resource (referenced from an Ingress annotation) and Certificate Manager certificates attached to a load balancer. The status fields differ between them. The Compute Engine API (classic managed SSL certificates, as printed by `gcloud compute ssl-certificates`) uses upper-case names: certificate `status` is one of `PROVISIONING`, `ACTIVE`, `PROVISIONING_FAILED`, `PROVISIONING_FAILED_PERMANENTLY` or `RENEWAL_FAILED`, and each domain in `domainStatus` is `PROVISIONING`, `ACTIVE`, `FAILED_NOT_VISIBLE`, `FAILED_CAA_CHECKING`, `FAILED_CAA_FORBIDDEN` or `FAILED_RATE_LIMITED`. A Certificate Manager managed certificate has a `state` of `PROVISIONING`, `FAILED` or `ACTIVE`. The `ManagedCertificate` Kubernetes resource exposes `status.certificateStatus` and a list `status.domainStatus`; its values are CamelCase (`Provisioning`, `Active`, `FailedNotVisible`, `FailedCaaChecking`, `ProvisioningFailedPermanently` and others), as the `gke-managed-certs` controller source maps them in `pkg/config/config.go` (checked 2026-10-20). The GKE page was only seen through a search excerpt, so compare with what `kubectl describe` prints and the current GKE documentation.

```bash
kubectl get managedcertificate -n "$NS"
kubectl describe managedcertificate "$CERT" -n "$NS"      # status: certificateStatus, domainStatus

# Certificate Manager / classic SSL certificates (check which applies)
gcloud certificate-manager certificates list
gcloud compute ssl-certificates list --format="table(name,type,managed.status,managed.domainStatus,expireTime)"
gcloud compute ssl-certificates describe CERT_NAME --global
```

Common failure modes:

- The domain's A/AAAA record does not point at the load balancer's IP (or points at the old one). Provisioning cannot complete; fix DNS and wait.
- CAA records block the issuing CA. Allow the CA Google uses (see the docs).
- A domain in `FailedNotVisible` (`ManagedCertificate`) or `FAILED_NOT_VISIBLE` (Compute Engine API) means Google found a problem with the DNS or load balancer configuration for that domain; check DNS and that the frontend uses the right IP and an HTTP(S) forwarding rule. A DNS proxy in front of the record (for example a CDN proxy that hides the load balancer IP) can cause it too.
- Certificate status `PROVISIONING_FAILED_PERMANENTLY` is not retried: the Compute Engine API reference says to delete and create a new managed certificate. `RENEWAL_FAILED` means the existing certificate still serves but will expire soon; the same reference says to create a new managed certificate.
- Provisioning can take up to 60 minutes per the GKE page (seen through a search excerpt; check the current docs) and cannot be sped up.

You cannot renew a Google-managed certificate on demand. If one fails, fix DNS or replace it: create a new certificate, add it to the target proxy or ingress, then remove the old one. Do not delete the old certificate first, so the load balancer always has a valid certificate attached (this ordering is conservative advice, not something the pages checked state).

### 5. Replace manually (non-managed certificate)

For a certificate you hold yourself (commercial CA, internal CA), issue the new certificate and chain, then update the Secret or load balancer:

```bash
(umask 077; kubectl get secret "$CERT" -n "$NS" -o yaml > "$CERT-secret-backup.yaml")   # contains the private key, see the warning above
kubectl create secret tls "$CERT" -n "$NS" --cert=fullchain.pem --key=privkey.pem \
  --dry-run=client -o yaml | kubectl apply -f -
```

Use the full chain (leaf plus intermediates) in `tls.crt`, in order. Check that the key matches the certificate:

```bash
diff <(openssl x509 -noout -modulus -in fullchain.pem | openssl md5) \
     <(openssl rsa -noout -modulus -in privkey.pem | openssl md5) && echo match
```

`openssl x509` reads only the first certificate of a file, so this compares the leaf with the key. For ECDSA keys `openssl rsa` fails with `Not an RSA key`; compare public keys instead:

```bash
diff <(openssl x509 -noout -pubkey -in fullchain.pem) <(openssl pkey -pubout -in privkey.pem) && echo match
```

Ingress controllers usually pick up a changed Secret without restart; some need a reload.

### 6. Monitor expiry and alert

Do not depend on email from the CA. Alert from two sources:

1. **cert-manager metrics:** `certmanager_certificate_expiration_timestamp_seconds`, `certmanager_certificate_renewal_timestamp_seconds` and `certmanager_certificate_ready_status` (the names come from the metrics package in the cert-manager source, with labels `name`, `namespace`, `issuer_name`, `issuer_kind`, `issuer_group` and, for the ready status, `condition`). The exact values of the `condition` label were not confirmed, so check the series in your Prometheus before relying on `condition="False"` in the rule below.
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
          route: ticket # to the owning team's queue, with a named owner
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

Because auto-renewal normally happens a third of the way before expiry, an alert at 14 days means renewal has already failed for a long time, so route it to the owning team's queue with an owner within one working day. The `route: ticket` label is an example; match it to your Alertmanager routing, and keep the 7-day probe alert as a page. For burn-rate style alerting on user-visible failures, see [[slo-burn-rate-alerting]], and for the Prometheus side see [[prometheus-vs-cloud-monitoring]].

## Validation

```bash
echo | openssl s_client -connect "$HOST:$PORT" -servername "$HOST" 2>/dev/null | openssl x509 -noout -dates -issuer
echo | openssl s_client -connect "$HOST:$PORT" -servername "$HOST" -verify_return_error 2>&1 | grep -E "Verify return code"
curl -sS "https://$HOST/" -o /dev/null -w '%{http_code} %{ssl_verify_result}\n'
kubectl get certificate "$CERT" -n "$NS"      # READY True
```

Expected: `notAfter` in the future (and later than before), `Verify return code: 0 (ok)`, `ssl_verify_result` 0. With a certificate from a private CA the client needs that CA: without it `s_client` prints `Verify return code: 20 (unable to get local issuer certificate)` and `curl` reports `ssl_verify_result` 20 (observed in the lab); pass `-CAfile ca.pem` and `--cacert ca.pem`. Test every load balancer or region, since each may serve its own copy, and check an old client or a pinned-certificate integration if you have one.

## Rollback

- Keep the previous Secret YAML from the backup. Re-applying it restores the old certificate, which helps only if it is not expired and the new one is wrong (wrong chain, wrong SAN).
- cert-manager: set the previous `Certificate` spec back and renew. A changed key algorithm or `duration` can break clients; revert the spec in Git.
- Google-managed or load balancer: re-attach the old certificate to the proxy before removing the new one.
- An expired certificate cannot be rolled back to; the way forward is issuance.

## Troubleshooting

| Symptom                                                          | Cause and fix                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Clients still see the old certificate after renewal              | Ingress or proxy has not reloaded, a CDN or second load balancer serves another copy, or SNI selects another cert. |
| `unable to get local issuer certificate`                         | Missing intermediate in the chain. Use the full chain in `tls.crt`.                                                |
| Name mismatch                                                    | The SAN list lacks the host. Fix `dnsNames` in the Certificate and reissue.                                        |
| Certificate `Ready` but ingress serves a fake cert               | Ingress references the wrong Secret name or namespace, or uses the controller's default certificate.               |
| HTTP-01 challenge works in staging, not in prod                  | A production WAF, redirect or NetworkPolicy blocks the solver pod; see [[kubernetes-network-policies]].            |
| `FailedNotVisible` / `FAILED_NOT_VISIBLE` on managed certificate | DNS does not point to the load balancer. Fix DNS and wait for retry.                                               |
| Expiry alert fires for a decommissioned host                     | Remove the probe target or the Certificate, rather than silencing the alert.                                       |

If an expired certificate caused customer impact, run it as an incident with [[incident-response]] and ask in the review why the 14 day alert did not lead to action.

## Evidence

Source-reviewed on 2026-10-20. The `openssl` and `curl` inspection and verification helpers were also run in a lab (see Lab run), but the main procedures (cert-manager renewal, Google-managed certificates, replacing the Secret) were not, so the level is not lab-tested. Read this section before using the note.

### Sources checked

Each bullet gives the page, the claims it backs and the check date. The documentation sites below could not be fetched directly from the review environment, so the claims were checked against the official documentation source repositories and API definitions that back those pages; re-read the linked pages before relying on exact wording.

- [cert-manager: Certificate resources](https://cert-manager.io/docs/usage/certificate/) (read from its source in the `cert-manager/website` repository): renewal at two thirds of the lifetime by default, `spec.renewBefore` and `spec.renewBeforePercentage`, `status.renewalTime`, default `duration` 90 days, minimum `duration` 1 hour and `renewBefore` 5 minutes, `cmctl renew` to trigger a reissue, deleting the Secret is not recommended. Checked 2026-10-20.
- [cert-manager: cmctl](https://cert-manager.io/docs/reference/cmctl/) (same source): `cmctl renew`, `cmctl status certificate`, and the notice that the CLI moved to its own repository. Checked 2026-10-20.
- [cert-manager: Prometheus metrics](https://cert-manager.io/docs/devops-tips/prometheus-metrics/) and the metrics package in the [cert-manager source](https://github.com/cert-manager/cert-manager/blob/master/pkg/metrics/metrics.go): metric names `certmanager_certificate_expiration_timestamp_seconds`, `certmanager_certificate_renewal_timestamp_seconds`, `certmanager_certificate_ready_status` and their labels (the metrics page itself does not list them). Checked 2026-10-20.
- Compute Engine API discovery document (`https://compute.googleapis.com/$discovery/rest?version=v1`), `SslCertificate` and `SslCertificateManagedSslCertificate`: `managed.status` and `managed.domainStatus` value names and meanings, `type` of `MANAGED` or `SELF_MANAGED`, `expireTime`. Certificate Manager API discovery document (`https://certificatemanager.googleapis.com/$discovery/rest?version=v1`): managed certificate `state` of `PROVISIONING`, `FAILED` or `ACTIVE`. Checked 2026-10-20.
- [GKE: Google-managed SSL certificates](https://cloud.google.com/kubernetes-engine/docs/how-to/managed-certs): not reachable from the review environment; only the archived [gke-managed-certs README](https://github.com/GoogleCloudPlatform/gke-managed-certs) and its type definition were read (fields `certificateStatus`, `domainStatus`, `certificateName`, `expireTime`; the README says the feature moved into GKE) and `pkg/config/config.go` (CamelCase status values such as `FailedNotVisible`). The "up to 60 minutes" provisioning figure was seen only in a search excerpt of the GKE page. Checked 2026-10-20.
- [`gcloud certificate-manager certificates list`](https://cloud.google.com/sdk/gcloud/reference/certificate-manager/certificates/list) and [`gcloud compute ssl-certificates`](https://cloud.google.com/sdk/gcloud/reference/compute/ssl-certificates): command names and the `--global` flag, read from the installed `gcloud` 570.0.0 help. Checked 2026-10-20.
- [Prometheus blackbox exporter](https://github.com/prometheus/blackbox_exporter): `probe_ssl_earliest_cert_expiry` is set in `prober/tls.go`. Checked 2026-10-20.
- [OpenSSL 3.0 manual: openssl-x509, openssl-s_client](https://docs.openssl.org/3.0/man1/openssl-x509/): behaviour of `-checkend`, `-ext`, `-verify_hostname` and `-verify_return_error` was confirmed by running them (see Lab run). Checked 2026-10-20.

### Not verified

- Any `kubectl`, `cmctl`, cluster, cert-manager, ACME, Google Cloud or `gcloud` command (`kubectl` is not installed in the lab; `gcloud` was used only to read help text). The `kubectl get certificate -o custom-columns` and `jsonpath` expressions are untested.
- The Certificate to CertificateRequest to Order to Challenge chain and the troubleshooting table are from the cert-manager model and were not exercised.
- That deleting the Secret makes cert-manager reissue, and how long the ingress serves a stale or default certificate meanwhile.
- The exact field layout printed by `kubectl describe managedcertificate` and the CAA issuer to allow. The CamelCase status values come from the controller source and the 60 minute figure from a search excerpt of the GKE page; neither was run.
- The Prometheus rules in `cert-alerts.yaml` were not loaded into Prometheus or run through `promtool`; the `condition` label values of `certmanager_certificate_ready_status` and Alertmanager routing are unconfirmed.
- Chain order: only a missing intermediate (verify code 20) and a correctly supplied one were tested; the claim that the chain must be in order was not tested. Some servers also need the chain in a separate file.
- Behaviour on OpenSSL 1.1.1, LibreSSL (macOS) and other versions; `base64 -d` on macOS (`-D` on old versions).
- Ingress controller reload behaviour and CDN or second-load-balancer effects.

### Environment

- Commands assume bash or zsh on Linux or macOS, `openssl` (lab: 3.0.13), `curl`, `kubectl` and, optionally, `cmctl` and `gcloud`. The process substitution `diff <(...)` needs bash or zsh.
- cert-manager and cmctl versions are not pinned: use the cmctl version that matches your cluster's cert-manager, and a current GKE version for `ManagedCertificate`.
- Lab host: see the Lab run below.

### Prerequisites

See Preconditions. Also: `get` and `describe` rights on Certificates, Orders, Challenges and Secrets in the namespace, and `delete` and `create` on Secrets only if you take the deletion or manual path.

### Expected results

See Validation. After a successful renewal `notAfter` is later than before, the Certificate is `Ready`, `status.renewalTime` has moved forward and the served certificate matches the Secret. With a private CA the verify code is 0 only when the client trusts that CA.

### Failure conditions

See Troubleshooting. Stop and escalate if: an Order stays `pending` after the cause is fixed; the Secret was deleted and no new certificate appears; the served certificate stays the old one on some load balancers; the key does not match the certificate; or a Google-managed certificate reports `PROVISIONING_FAILED_PERMANENTLY` or `RENEWAL_FAILED` (replace it, see step 4).

### Cleanup and rollback

See Rollback. Re-apply the Secret backup to restore the previous certificate if it is still valid; an expired certificate cannot be rolled back to, so issue a new one. Delete `$CERT-secret-backup.yaml` (it holds the private key) and any lab keys once the new certificate is confirmed. The lab below used only a temporary directory, which the script removed.

### Lab run

Date: 2026-10-20. Host: `Linux 6.18.44-fc-v139`. Tools as printed: `OpenSSL 3.0.13 30 Jan 2024 (Library: OpenSSL 3.0.13 30 Jan 2024)`, `GNU bash, version 5.2.21(1)-release`, `curl 8.5.0`. `kubectl` was not installed. Everything ran on 127.0.0.1 with throwaway keys in a temporary directory; no network access was used. A root CA, an intermediate CA and three leaf certificates for `test.example.com` with a SAN (RSA 90 days, ECDSA P-256 90 days, RSA 1 day) were created, and each was served with `openssl s_server`.

Setup (abridged to the commands that matter):

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 30 -subj "/CN=Lab Root CA" \
  -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign,cRLSign
# intermediate: req + x509 -req -CA ca.crt ... -extfile int.ext (CA:TRUE), then per leaf:
openssl req -newkey rsa:2048 -nodes -keyout rsa90.key -out rsa90.csr -subj "/CN=test.example.com"
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out ec90.key
openssl x509 -req -in rsa90.csr -CA int.crt -CAkey int.key -CAcreateserial -days 90 -extfile leaf.ext -out rsa90.crt
#   (leaf.ext: subjectAltName=DNS:test.example.com; the 1-day leaf uses -days 1)
openssl s_server -accept 127.0.0.1:18443 -cert rsa90.crt -key rsa90.key -cert_chain int.crt -quiet &
```

Client side, the note's own commands with `-connect 127.0.0.1:18443 -servername test.example.com`:

```bash
echo | openssl s_client -connect 127.0.0.1:18443 -servername test.example.com 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
echo | openssl s_client ... | openssl x509 -noout -checkend 1209600; echo "exit $?"
echo | openssl s_client ... -verify_return_error [-CAfile ca.crt] [-verify_hostname test.example.com] | grep "Verify return code"
diff <(openssl x509 -noout -modulus -in rsa90-chain.pem | openssl md5) <(openssl rsa -noout -modulus -in rsa90.key | openssl md5) && echo match
diff <(openssl x509 -noout -pubkey -in ec90.crt) <(openssl pkey -pubout -in ec90.key) && echo match
base64 -w0 < rsa90.crt | base64 -d | openssl x509 -noout -subject -issuer -dates     # stands in for the Secret field; kubectl was not run
curl -m 10 --noproxy '*' -sS --resolve test.example.com:18445:127.0.0.1 --cacert ca.crt https://test.example.com:18445/ -o /dev/null -w '%{http_code} %{ssl_verify_result}\n'
```

Observed output (abridged):

```text
# RSA 90 days, served with the intermediate
subject=CN = test.example.com
issuer=CN = Lab Intermediate CA
notBefore=Oct 20 08:24:05 2026 GMT
notAfter=Jan 18 08:24:05 2027 GMT
X509v3 Subject Alternative Name:
    DNS:test.example.com
Certificate will not expire          [checkend 1209600 exit 0]
# ECDSA 90 days: identical dates and SAN, checkend 1209600 exit 0
# RSA 1 day
notAfter=Oct 21 08:24:05 2026 GMT
Certificate will expire              [checkend 1209600 exit 1]
Certificate will not expire          [checkend 0 exit 0]
# verification (RSA 90 days)
no CA, default store:                Verify return code: 20 (unable to get local issuer certificate)
-CAfile ca.crt:                      Verify return code: 0 (ok)
-CAfile ca.crt -verify_hostname wrong.example.com:   Verify return code: 62 (hostname mismatch)
leaf only, no intermediate sent:     Verify return code: 20 (unable to get local issuer certificate)
intermediate sent via -cert_chain:   Verify return code: 0 (ok), 2 certificates in -showcerts
# key and certificate match
RSA modulus, matching pair:          match [exit 0]
RSA modulus, mismatched pair:        two different MD5 lines [exit 1]
openssl rsa on the ECDSA key:        Not an RSA key [exit 1]
pkey -pubout, ECDSA and RSA pairs:   match [exit 0]
pkey -pubout, ECDSA cert vs RSA key: mismatch
x509 on a leaf+intermediate file:    prints the leaf subject only
# Secret stand-in pipeline:          subject, issuer and dates of the leaf printed
# curl with --cacert:                200 0
# curl without --cacert:             curl: (60) SSL certificate problem: unable to get local issuer certificate / 000 20
```

Two lab notes. The sandbox sets an HTTPS proxy, so `curl` needed `--noproxy '*'` to reach 127.0.0.1 by name. `openssl s_server -cert` loads only the first certificate of a multi-certificate file, so the intermediate had to be passed with `-cert_chain`.
