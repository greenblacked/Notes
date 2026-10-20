---
title: Expired admission webhook certificates that block every create
description: "Fix an expired admission webhook certificate that makes the API server reject creates and updates, with a safe temporary bypass and alerts."
type: runbook
tags:
  - runbooks
  - kubernetes
  - security
  - reliability
  - incident-management
created: 2026-10-19
modified: 2026-10-20
evidence: source-reviewed
reviewed: 2026-10-20
review-due: 2027-04-20
destructive: true
draft: false
---

An admission webhook is called by the API server over TLS. If the webhook's serving certificate expires, or the `caBundle` the API server uses to verify it no longer matches, every request that the webhook covers is rejected. When the webhook is set to fail closed, that can mean no Pod, Deployment or ConfigMap can be created or updated anywhere, including by Argo CD and Helm. This runbook is narrow on purpose: it is about webhook certificates, not ingress certificates.

> [!info] Source-reviewed on 2026-10-20
> The Kubernetes webhook fields and defaults, the cert-manager CA injector annotations and the Gatekeeper recovery step were checked against documentation sources. Only the certificate helper steps were run, in a throwaway `openssl` lab on localhost. No cluster, `kubectl`, cert-manager, Argo CD or Helm command was run. Resource names, labels and namespaces below are examples; the webhook you are dealing with will differ. The Evidence section at the end lists the sources, what was not verified and the lab output.

> [!danger] The break-glass steps disable an admission control
> Setting `failurePolicy: Ignore` or deleting a webhook configuration (step 5) lets requests through that the webhook would have rejected, for as long as the change stays. Get approval, back up first, set a time limit (the target below is one hour, and the incident record must name who restores it) and follow the restore steps in Rollback and in the Cleanup and rollback part of the Evidence section.

## When to use

- Deploys and applies fail with errors such as `failed calling webhook "..." : ... x509: certificate has expired or is not yet valid`.
- Errors say `x509: certificate signed by unknown authority`, which means the `caBundle` and the serving certificate no longer match.
- Argo CD syncs fail, Helm upgrades fail, and Pods cannot be created, all at once, with the same webhook named in the error.

Ordinary ingress or load balancer certificates belong in [[tls-certificate-renewal]]. If the policy engine itself needs to be bypassed in a controlled way, see [[policy-rollout-audit-to-enforce]], which already covers that case.

## Preconditions

- Cluster-admin or an equivalent role, with a working kubeconfig. Admission webhooks act on requests that create, update or delete objects, not on reads, so you can still list and read objects. Editing the webhook configuration objects is not blocked by a webhook: the `rules` field documentation of the `admissionregistration.k8s.io/v1` API says admission webhooks are never called on requests for `ValidatingWebhookConfiguration` and `MutatingWebhookConfiguration` objects. RBAC still applies, so you need permission to edit them.
- Knowing whether the certificate is managed by cert-manager, by the webhook's own operator (many policy engines and operators generate their own), or by hand.
- Awareness that this may be a security control. Bypassing it, even briefly, has a security impact that must be recorded.

```bash
WEBHOOK_NS=webhook-system               # namespace of the webhook backend
WEBHOOK_SECRET=webhook-server-cert      # Secret that holds the serving certificate
WEBHOOK_CFG=example-validating-webhook  # name of the ValidatingWebhookConfiguration
```

## Steps

### 1. List the webhooks

```bash
kubectl get validatingwebhookconfigurations,mutatingwebhookconfigurations
```

If the API server returns the same error for all writes, you will not be able to create new objects, but you can still read the webhook configurations and edit them.

### 2. Find the failing webhook

The error message names the webhook and its service. Then read its configuration:

```bash
kubectl get validatingwebhookconfiguration "$WEBHOOK_CFG" -o yaml \
  | grep -E 'name:|failurePolicy|timeoutSeconds|namespaceSelector|objectSelector|service:|namespace:|path:'

kubectl get validatingwebhookconfiguration "$WEBHOOK_CFG" \
  -o jsonpath='{range .webhooks[*]}{.name}{"\t"}{.failurePolicy}{"\t"}{.clientConfig.service.namespace}/{.clientConfig.service.name}{"\n"}{end}'
```

Key fields:

- `failurePolicy` (`Fail` or `Ignore`; the default in `admissionregistration.k8s.io/v1` is `Fail`) says what happens when an error occurs while _calling_ the webhook. The Kubernetes page lists network errors, timeouts and connection failures, a non-2xx or malformed response and similar. `Fail` rejects the request, `Ignore` lets it continue. A TLS verification failure is not named in that list; it fails the call, which is what the `x509` errors in this note show. An explicit rejection by a reachable webhook always denies the request, whatever the policy.
- `timeoutSeconds` is the time the API server waits for the webhook (default 10, allowed 1 to 30); a timeout is handled by `failurePolicy`.
- `namespaceSelector` and `objectSelector` decide which requests the webhook sees; `namespaceSelector` has no effect on cluster-scoped resources other than Namespaces. `matchPolicy` (`Exact` or `Equivalent`, default `Equivalent`) decides whether equivalent API versions of a request are sent. In v1, `sideEffects` must be `None` or `NoneOnDryRun`. Webhooks that cover `kube-system` or their own namespace can create a deadlock when their Pod needs to restart.
- `clientConfig.service` is the Service the API server calls (the serving certificate must be valid for `<service>.<namespace>.svc`); `caBundle` is the PEM-encoded CA bundle (the field value is base64 encoded) the API server uses to verify that call. With `clientConfig.url` and no `caBundle`, the system trust roots are used.

### 3. Check the certificates

Look at the serving certificate in the webhook's Secret and at the `caBundle`.

```bash
# Serving certificate expiry
kubectl -n "$WEBHOOK_NS" get secret "$WEBHOOK_SECRET" -o jsonpath='{.data.tls\.crt}' \
  | base64 -d | openssl x509 -noout -subject -issuer -dates

# caBundle in the webhook configuration (first webhook entry)
kubectl get validatingwebhookconfiguration "$WEBHOOK_CFG" \
  -o jsonpath='{.webhooks[0].clientConfig.caBundle}' \
  | base64 -d | openssl x509 -noout -subject -issuer -dates
```

Interpretation:

| Finding                                             | Meaning                                                         |
| --------------------------------------------------- | --------------------------------------------------------------- |
| Serving certificate `notAfter` in the past          | Expired leaf certificate. Renew it (step 4).                    |
| Serving certificate fine, `caBundle` CA expired     | The CA expired. Rotate the CA and the bundle (step 4).          |
| Both valid, but the CA that signed the leaf differs | `caBundle` is stale. Re-inject the CA (step 4).                 |
| Both valid and matching                             | Not a certificate problem. Check the backend Pod and Service.   |
| `notBefore` in the future                           | Clock skew or a new certificate not yet valid. Check node time. |

Never print the private key (`tls.key`) while debugging.

### 4. Fix the certificate

Choose the path that matches how the certificate is managed.

**cert-manager and the CA injector.** The webhook configuration carries an annotation that tells cert-manager's CA injector where to take the CA from: `cert-manager.io/inject-ca-from: <namespace>/<certificate-name>` for a `Certificate`, or `cert-manager.io/inject-ca-from-secret: <namespace>/<secret-name>` for a Secret (which also needs `cert-manager.io/allow-direct-injection: "true"` on the Secret). The same applies to mutating webhook configurations. Check that the Certificate is ready, renew it, and confirm the injector updated the `caBundle`.

```bash
kubectl -n "$WEBHOOK_NS" get certificate
kubectl -n "$WEBHOOK_NS" describe certificate <name> | sed -n '/Status:/,$p'
kubectl get validatingwebhookconfiguration "$WEBHOOK_CFG" -o jsonpath='{.metadata.annotations}'

# Force a reissue if cmctl is installed (it is a separate project from cert-manager; check its docs for your version).
cmctl renew --namespace "$WEBHOOK_NS" <name>
```

If the issuer itself is broken (expired CA, ACME failures), fix that first; see [[tls-certificate-renewal]]. Then restart the webhook Pods so they load the new certificate if the process does not reload it itself.

**The component's own operator.** Many operators generate and rotate their webhook certificates themselves and write the `caBundle`. Restarting the operator or webhook Pod often triggers regeneration. Check the component's documentation, because some also require deleting the old Secret.

```bash
kubectl -n "$WEBHOOK_NS" rollout restart deployment/<webhook-deployment>
kubectl -n "$WEBHOOK_NS" rollout status deployment/<webhook-deployment>
```

If the webhook deployment itself cannot start because creating its Pod is blocked by the webhook, apply the temporary bypass from step 5 first.

**Manual certificates.** Issue a new certificate for the service DNS names (`<service>.<namespace>.svc`) from your CA, update the Secret and the `caBundle`, and restart the Pods. This is the least desirable path; use the incident to move to cert-manager.

### 5. Temporary bypass, as break-glass

Use this only when the webhook cannot be repaired quickly and blocking writes is worse than the security gap. Get an explicit approval, write down the time, the person and the reason in the incident record, and set a deadline (target: restore within one hour, and name who restores it).

1. **Back up the configuration:**

```bash
kubectl get validatingwebhookconfiguration "$WEBHOOK_CFG" -o yaml > "webhook-$WEBHOOK_CFG-backup.yaml"
```

2. **Choose the smallest bypass.** Prefer excluding the namespaces the webhook needs to start (its own namespace, `kube-system`) by editing the `namespaceSelector`, over turning the webhook off for the whole cluster. A `namespaceSelector` exclusion works on namespace labels and does not help for cluster-scoped resources. If you need a cluster-wide bypass, set the failure policy to ignore (this makes the webhook fail open for every request it covers):

```bash
kubectl patch validatingwebhookconfiguration "$WEBHOOK_CFG" --type=json \
  -p='[{"op":"replace","path":"/webhooks/0/failurePolicy","value":"Ignore"}]'
```

Repeat for every webhook entry that is failing (the index changes).

3. **Pause GitOps self-heal** so that Argo CD does not revert the change within minutes: disable automated sync or self-heal on the application that owns the webhook, and reverse it when you finish. See [[argocd-sync-failure-and-drift]] for the mechanics.

   Policy engines may rewrite their own webhook configurations (a controller reconciles `failurePolicy` back). Check the engine's documentation and [[gatekeeper-vs-kyverno]] for which behaviours apply, and use the engine's own supported switch where one exists. Gatekeeper's documentation says its validating webhook defaults to `failurePolicy: Ignore` (so an unreachable Gatekeeper normally does not block writes), and its emergency recovery is to delete the validating webhook configuration, by default named `gatekeeper-validating-webhook-configuration`; redeploying that configuration re-enables Gatekeeper. That removes all Gatekeeper admission checks, so it is the same break-glass with the same time limit. For Kyverno and other engines, find the documented procedure for your version; this note did not confirm one.

> [!warning] A bypass disables a security control
> While the webhook is ignored or deleted, requests that it would have rejected are admitted: policy violations, unsigned images, privileged Pods. Keep the window short, increase monitoring on the admission audit logs, and review what was created in that period after the fix. Restore the bypassed fields from the backup (Rollback) as soon as the certificate is repaired, and do not leave the change in place overnight.

### 6. Prevent a recurrence

- Alert on webhook certificate expiry well before the deadline, for example from cert-manager's certificate expiry metric, or from a blackbox probe of the webhook Service. See [[first-prometheus-alert]] for building an alert.
- Set `failurePolicy` deliberately: `Fail` for controls that must hold, `Ignore` for conveniences, and a `namespaceSelector` exclusion for the webhook's own namespace. Exempting `kube-system` is a common starting point, but it does not cover cluster-scoped resources such as nodes or other critical namespaces, so list what your cluster depends on instead of copying a rule.
- Run at least two replicas of each webhook backend with a PodDisruptionBudget, so a node drain does not take it out.
- If the API server is slow or timing out because of webhooks, see [[gke-control-plane-unavailable]].

## Validation

```bash
kubectl create namespace webhook-smoke --dry-run=server -o name
kubectl -n default run webhook-smoke --image=registry.k8s.io/pause --dry-run=server -o name
kubectl get validatingwebhookconfiguration "$WEBHOOK_CFG" \
  -o jsonpath='{.webhooks[*].failurePolicy}{"\n"}'
```

- Server-side dry runs succeed. If the webhook's rules match those requests, that means the API server called it and got an answer; a dry run is not sent to a webhook whose `sideEffects` is not `None` or `NoneOnDryRun`, and then the request fails.
- Both the serving certificate and the `caBundle` show a comfortable expiry date.
- `failurePolicy` and selectors are back to their intended values and match the backup, if you bypassed.
- Argo CD syncs and a Helm upgrade both succeed, and the self-heal setting is restored.
- The webhook rejects something it should reject, which proves the control is working again (a test object in a test namespace).

## Rollback

- **Restore the bypassed fields** (undo `failurePolicy: Ignore` or a changed `namespaceSelector`) within the time limit set in step 5. Do not re-apply the whole backup file after the certificate was fixed: it was taken during the incident, so its `clientConfig.caBundle` is the stale or expired CA, and applying it would overwrite the new bundle and make a `failurePolicy: Fail` webhook reject writes again. Read the original values from the backup and patch only those fields back (index `0` is the first webhook entry; repeat for each entry you changed):

```bash
kubectl get validatingwebhookconfiguration "$WEBHOOK_CFG" -o jsonpath='{.webhooks[0].failurePolicy}{"\n"}'   # current value
grep -n -E 'failurePolicy|namespaceSelector' "webhook-$WEBHOOK_CFG-backup.yaml"                             # original values
kubectl patch validatingwebhookconfiguration "$WEBHOOK_CFG" --type=json \
  -p='[{"op":"replace","path":"/webhooks/0/failurePolicy","value":"Fail"}]'
```

Use the value the backup shows (it may not be `Fail`), and restore `namespaceSelector` the same way with a JSON patch built from the backup. If the whole configuration was deleted and must be re-created from the backup file, first replace `clientConfig.caBundle` in the file with the current CA (or remove it so the CA injector or the operator sets it), and remove server-populated fields such as `resourceVersion`, `uid` and `creationTimestamp`. After any restore, repeat the `caBundle` check from step 3 and confirm it matches the CA that signed the current serving certificate.

- **Certificate renewal made things worse:** reissue from the previous known-good issuer, or restore the previous Secret from your backup, and restart the Pods.
- **Re-enable GitOps self-heal** and confirm the application is in sync.
- **Review the bypass window:** list objects created in that period and check them against the policy before closing the incident.

## Troubleshooting

| Symptom                                                | Cause and fix                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `x509: certificate has expired` naming one webhook     | Expired serving certificate. Renew (step 4).                                                |
| `x509: certificate signed by unknown authority`        | `caBundle` mismatch. Re-inject the CA or restart the owning operator.                       |
| `context deadline exceeded` calling the webhook        | Backend down or unreachable (NetworkPolicy, private cluster firewall for the webhook port). |
| Webhook Pod cannot start because the webhook blocks it | Deadlock. Exclude its namespace in `namespaceSelector` as a bypass (step 5).                |
| Bypass reverts after a few minutes                     | Argo CD self-heal or the policy engine reconciled it. Pause it first.                       |
| cert-manager Certificate stuck `Issuing`               | Issuer problem or a CA expiry. Describe the Certificate and its CertificateRequest.         |
| Renewed certificate not served                         | The Pod holds the old one in memory. Restart the Deployment.                                |

## Related

- [[tls-certificate-renewal]] for ordinary certificate lifecycles.
- [[policy-rollout-audit-to-enforce]] for working with policy engine webhooks and bypassing them safely.
- [[gatekeeper-vs-kyverno]] for how the two engines manage their webhooks.
- [[gke-control-plane-unavailable]] when the API server itself is slow or failing.
- [[incident-response]] for roles and communication.

## Evidence

Source-reviewed on 2026-10-20. Only the certificate helper steps were run, in a disposable lab on localhost; no cluster was touched. Read this section before using the note.

### Sources checked

Each bullet gives the page, the claims it backs and the check date. The documentation sites could not be fetched directly from the review environment, so the claims were checked against the source files of the official documentation repositories; re-read the linked pages before relying on exact wording.

- [Kubernetes: dynamic admission control](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/) (read from `kubernetes/website`): `admissionregistration.k8s.io/v1` `failurePolicy` values `Ignore` and `Fail` with default `Fail`; which errors the policy applies to and that an explicit rejection always denies; `timeoutSeconds` default 10 and range 1 to 30, a timeout handled by the failure policy; `matchPolicy` default `Equivalent`; `sideEffects` values `None` and `NoneOnDryRun`, and dry-run behaviour; `namespaceSelector` has no effect on cluster-scoped resources other than Namespaces; `clientConfig.caBundle` is a PEM-encoded CA bundle, base64 encoded; the service certificate must be valid for `<svc>.<ns>.svc`; `clientConfig.url` without `caBundle` uses system trust roots; virtual review resources are excluded from webhooks. Checked 2026-10-20.
- [Kubernetes API reference: ValidatingWebhookConfiguration v1](https://kubernetes.io/docs/reference/kubernetes-api/extend-resources/validating-webhook-configuration-v1/) and the `rules` field comment in [`k8s.io/api` `admissionregistration/v1/types.go`](https://github.com/kubernetes/api/blob/master/admissionregistration/v1/types.go): admission webhooks are never called on requests for webhook configuration objects. Checked 2026-10-20 (the source file was read; the reference page was not fetched).
- [cert-manager: CA injector](https://cert-manager.io/docs/concepts/ca-injector/) (read from `cert-manager/website`): annotations `cert-manager.io/inject-ca-from` (value `<namespace>/<certificate>`), `cert-manager.io/inject-ca-from-secret`, `cert-manager.io/inject-apiserver-ca`, and `cert-manager.io/allow-direct-injection: "true"` on a source Secret; works for validating and mutating webhook configurations. Checked 2026-10-20.
- [cert-manager: Certificate resources](https://cert-manager.io/docs/usage/certificate/) and [cmctl](https://cert-manager.io/docs/reference/cmctl/): `cmctl renew <name> --namespace <ns>` triggers a reissue; the CLI now lives in its own repository. Checked 2026-10-20.
- Gatekeeper documentation, "Failing Closed" and "Emergency Recovery" (read as `website/docs/failing-closed.md` and `website/docs/emergency.md` in the `open-policy-agent/gatekeeper` repository; the published page URLs were not fetched): default `failurePolicy: Ignore`, the `admission.gatekeeper.sh/ignore` namespace label, the default configuration name `gatekeeper-validating-webhook-configuration`, delete it to disable and redeploy it to re-enable, and the caution that exempting `kube-system` is only a starting point. Checked 2026-10-20.
- [OpenSSL 3.0 manual](https://docs.openssl.org/3.0/man1/openssl-ca/): `openssl ca -startdate/-enddate` and `s_client` verify codes were confirmed by running them (see Lab run). Checked 2026-10-20.

### Not verified

- Any `kubectl`, `cmctl`, cert-manager, Argo CD, Helm or cluster behaviour: how the API server reports a handshake failure in a real cluster, the exact error strings in When to use, and that a webhook Pod deadlock resolves as described. No cluster was available.
- Kyverno, cert-manager's own webhook and any operator-specific certificate rotation or recovery procedure; only Gatekeeper's was read.
- How a policy engine reconciles `failurePolicy` back, and Argo CD self-heal and sync settings (see [[argocd-sync-failure-and-drift]]).
- The `kubectl patch` JSON path index and the `grep` filter on live output, the `--dry-run=server` validation commands, and the `registry.k8s.io/pause` image reference.
- Real certificate rotation timing, clock skew effects and the PodDisruptionBudget advice.

### Environment

- Kubernetes with `admissionregistration.k8s.io/v1` webhook configurations (check your cluster's version), `kubectl` with cluster-admin, and optionally cert-manager with its CA injector and `cmctl`. The shell lines assume bash or zsh on Linux or macOS.
- Lab: OpenSSL 3.0.13, GNU bash 5.2.21 and GNU coreutils 9.4 on Linux, see the Lab run below. Note that `base64 -w0` is GNU syntax; on macOS use `base64 | tr -d '\n'`.

### Prerequisites

See Preconditions. Also: an approval and an incident record for any bypass, a working backup file of the webhook configuration, and the name of the person who will restore it.

### Expected results

See Validation. After the fix the serving certificate and the `caBundle` both show a comfortable expiry and chain to the same CA, server-side dry runs succeed, and the webhook rejects a deliberately bad test object again. In the lab, `openssl s_client` returned verify code 10 for the expired certificate, 20 for the wrong CA and 0 for the good one.

### Failure conditions

See Troubleshooting. Stop and escalate if: the webhook configuration cannot be edited because it is itself blocked; the bypass reverts within minutes (a GitOps tool or the policy engine reconciles it); the time limit passes with the bypass still in place; the restore fails to apply; or the review of objects admitted during the bypass finds violations.

### Cleanup and rollback

The backup file holds the original `failurePolicy` and selectors: patch those fields back as described in Rollback, rather than re-applying the whole file, because its `caBundle` is the stale one from the incident. A deleted configuration is re-created from the file only after its `caBundle` is replaced (a deleted Gatekeeper configuration can also be redeployed from its manifest or chart). Re-enable GitOps self-heal, confirm the application is in sync, then delete the backup and any private key copies. If the restored webhook fails again, suspect first a stale `caBundle` (for example one restored from the backup), then the serving certificate; fix it with step 4 rather than leaving the bypass. The lab used only a temporary directory, removed by the script.

### Lab run

Date: 2026-10-20. Host: `Linux 6.18.44-fc-v139`. Tools as printed: `OpenSSL 3.0.13 30 Jan 2024 (Library: OpenSSL 3.0.13 30 Jan 2024)`, `GNU bash, version 5.2.21(1)-release`, `sha256sum (GNU coreutils) 9.4`. No cluster, `kubectl` or network was used; everything ran on 127.0.0.1 with throwaway keys. Only the certificate helper steps (expiry, SAN, `caBundle` encoding and TLS verification outcomes) were run; the webhook behaviour itself was not.

On OpenSSL 3.0.13, `openssl x509` and `openssl req` have no `-not_before` or `-not_after` option, so an expired certificate was made with `openssl ca -startdate/-enddate` (an expired window of 2026-09-01 to 2026-10-01).

```bash
SVC=webhook-svc; NS=webhook-system; H=$SVC.$NS.svc
openssl x509 -help 2>&1 | grep -ciE 'not_before|not_after'            # 0
openssl ca -help 2>&1 | grep -E 'startdate|enddate'
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 30 -subj "/CN=Webhook Lab CA" \
  -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign
# a second CA, other.crt, for the wrong-CA case
openssl req -newkey rsa:2048 -nodes -keyout srv.key -out srv.csr -subj "/CN=$H" -addext "subjectAltName=DNS:$H"
openssl ca -batch -config ca.cnf -cert ca.crt -keyfile ca.key -in srv.csr -out expired.crt \
  -startdate 20260901000000Z -enddate 20261001000000Z -notext          # ca.cnf: minimal config, copy_extensions=copy
openssl x509 -req -in srv.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 1 -copy_extensions copy -out good.crt
for c in expired good; do openssl x509 -in $c.crt -noout -subject -issuer -dates -ext subjectAltName; openssl x509 -in $c.crt -noout -checkend 0; echo "exit $?"; done
B=$(base64 -w0 < ca.crt); printf '%s' "$B" | base64 -d > ca.decoded.crt; sha256sum ca.crt ca.decoded.crt; cmp ca.crt ca.decoded.crt
openssl s_server -accept 127.0.0.1:18446 -cert expired.crt -key srv.key -quiet &     # later good.crt
echo | openssl s_client -connect 127.0.0.1:18446 -servername $H -CAfile ca.crt -verify_return_error 2>&1 | grep -E "Verify return code|verify error"
```

Observed output (abridged):

```text
expired.crt  subject=CN = webhook-svc.webhook-system.svc  issuer=CN = Webhook Lab CA
             notBefore=Sep  1 00:00:00 2026 GMT  notAfter=Oct  1 00:00:00 2026 GMT
             DNS:webhook-svc.webhook-system.svc
             Certificate will expire                [checkend 0 exit 1]
good.crt     notBefore=Oct 20 08:24:32 2026 GMT  notAfter=Oct 21 08:24:32 2026 GMT
             Certificate will not expire            [checkend 0 exit 0]
caBundle     base64 length 1532, no newline; sha256 of ca.crt and the decoded copy are both
             337d9ff870466a24507cbce5299485476999ff03162e7c27f23a27f7d17ae84d; cmp: identical
s_client, expired cert, right CA:     verify error:num=10:certificate has expired / Verify return code: 10
s_client, expired cert, wrong CA:     verify error:num=20:unable to get local issuer certificate / Verify return code: 20
s_client, good cert, right CA:        Verify return code: 0 (ok)
s_client, good cert, wrong CA:        Verify return code: 20 (unable to get local issuer certificate)
s_client, good cert, CAs both in file: Verify return code: 0 (ok)
s_client, -verify_hostname webhook-svc.webhook-system.svc: 0 (ok); other.ns.svc: 62 (hostname mismatch)
```

Without `-verify_return_error` the same error and code were printed and the handshake was allowed to continue. A `caBundle` that holds both the old and the new CA (the "CAs both in file" case) verified a certificate from either, which is why a rotation can overlap the two.

## Sources

- [Kubernetes: dynamic admission control](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/)
- [cert-manager: CA injector](https://cert-manager.io/docs/concepts/ca-injector/)
- [Kubernetes: manage TLS certificates in a cluster](https://kubernetes.io/docs/tasks/tls/managing-tls-in-a-cluster/)
- [Gatekeeper repository](https://github.com/open-policy-agent/gatekeeper): `website/docs/emergency.md` and `website/docs/failing-closed.md`
