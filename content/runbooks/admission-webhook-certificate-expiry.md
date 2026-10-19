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
modified: 2026-10-19
draft: false
---

An admission webhook is called by the API server over TLS. If the webhook's serving certificate expires, or the `caBundle` the API server uses to verify it no longer matches, every request that the webhook covers is rejected. When the webhook is set to fail closed, that can mean no Pod, Deployment or ConfigMap can be created or updated anywhere, including by Argo CD and Helm. This runbook is narrow on purpose: it is about webhook certificates, not ingress certificates.

> [!info] Scope and verification
> The commands were not run against a live cluster when this note was written, and the note is not marked `verified`. Resource names, labels and namespaces below are examples; the webhook you are dealing with will differ. Check the Kubernetes admission controller documentation and the documentation of the component that owns the webhook before changing anything.

## When to use

- Deploys and applies fail with errors such as `failed calling webhook "..." : ... x509: certificate has expired or is not yet valid`.
- Errors say `x509: certificate signed by unknown authority`, which means the `caBundle` and the serving certificate no longer match.
- Argo CD syncs fail, Helm upgrades fail, and Pods cannot be created, all at once, with the same webhook named in the error.

Ordinary ingress or load balancer certificates belong in [[tls-certificate-renewal]]. If the policy engine itself needs to be bypassed in a controlled way, see [[policy-rollout-audit-to-enforce]], which already covers that case.

## Preconditions

- Cluster-admin or an equivalent role, with a working kubeconfig. Admission webhooks do not block reads, and the API server never calls webhooks for requests on webhook configuration objects, so you can always edit them.
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

If the API server returns the same error for all writes, you will not be able to create new objects, but you can still read and edit the webhook configurations themselves,.

### 2. Find the failing webhook

The error message names the webhook and its service. Then read its configuration:

```bash
kubectl get validatingwebhookconfiguration "$WEBHOOK_CFG" -o yaml \
  | grep -E 'name:|failurePolicy|timeoutSeconds|namespaceSelector|objectSelector|service:|namespace:|path:'

kubectl get validatingwebhookconfiguration "$WEBHOOK_CFG" \
  -o jsonpath='{range .webhooks[*]}{.name}{"\t"}{.failurePolicy}{"\t"}{.clientConfig.service.namespace}/{.clientConfig.service.name}{"\n"}{end}'
```

Key fields:

- `failurePolicy: Fail` blocks requests when the webhook cannot be called or verified. `Ignore` lets them through.
- `namespaceSelector` and `objectSelector` decide which requests the webhook sees. Webhooks that cover `kube-system` or their own namespace can create a deadlock when their Pod needs to restart.
- `clientConfig.service` is the Service the API server calls; `caBundle` is the CA it trusts for that call.

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

**cert-manager and the CA injector.** The webhook configuration carries an annotation that tells cert-manager's CA injector which `Certificate` to take the CA from. Check that the Certificate is ready, renew it, and confirm the injector updated the `caBundle`.

```bash
kubectl -n "$WEBHOOK_NS" get certificate
kubectl -n "$WEBHOOK_NS" describe certificate <name> | sed -n '/Status:/,$p'
kubectl get validatingwebhookconfiguration "$WEBHOOK_CFG" -o jsonpath='{.metadata.annotations}'

# Force a reissue if your cert-manager tooling is installed (cmctl); check the docs for your version.
cmctl renew -n "$WEBHOOK_NS" <name>
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

Use this only when the webhook cannot be repaired quickly and blocking writes is worse than the security gap. Get an explicit approval, and write down the time, the person and the reason in the incident record.

1. **Back up the configuration:**

```bash
kubectl get validatingwebhookconfiguration "$WEBHOOK_CFG" -o yaml > "webhook-$WEBHOOK_CFG-backup.yaml"
```

2. **Choose the smallest bypass.** Prefer excluding the namespaces the webhook needs to start (its own namespace, `kube-system`) by editing the `namespaceSelector`, over turning the webhook off for the whole cluster. If you need a cluster-wide bypass, set the failure policy to ignore:

```bash
kubectl patch validatingwebhookconfiguration "$WEBHOOK_CFG" --type=json \
  -p='[{"op":"replace","path":"/webhooks/0/failurePolicy","value":"Ignore"}]'
```

Repeat for every webhook entry that is failing (the index changes).

3. **Pause GitOps self-heal** so that Argo CD does not revert the change within minutes: disable automated sync or self-heal on the application that owns the webhook, and reverse it when you finish. See [[argocd-sync-failure-and-drift]] for the mechanics.

   Policy engines may rewrite their own webhook configurations (a controller reconciles `failurePolicy` back). Check the engine's documentation and [[gatekeeper-vs-kyverno]] for which behaviours apply, and use the engine's own supported switch where one exists.

> [!warning] A bypass disables a security control
> While the webhook is ignored, requests that it would have rejected are admitted: policy violations, unsigned images, privileged Pods. Keep the window short, increase monitoring on the admission audit logs, and review what was created in that period after the fix.

### 6. Prevent a recurrence

- Alert on webhook certificate expiry well before the deadline, for example from cert-manager's certificate expiry metric, or from a blackbox probe of the webhook Service. See [[first-prometheus-alert]] for building an alert.
- Set `failurePolicy` deliberately: `Fail` for controls that must hold, `Ignore` for conveniences, and always `namespaceSelector` exclusions for the webhook's own namespace and `kube-system`.
- Run at least two replicas of each webhook backend with a PodDisruptionBudget, so a node drain does not take it out.
- If the API server is slow or timing out because of webhooks, see [[gke-control-plane-unavailable]].

## Validation

```bash
kubectl create namespace webhook-smoke --dry-run=server -o name
kubectl -n default run webhook-smoke --image=registry.k8s.io/pause --dry-run=server -o name
kubectl get validatingwebhookconfiguration "$WEBHOOK_CFG" \
  -o jsonpath='{.webhooks[*].failurePolicy}{"\n"}'
```

- Server-side dry runs succeed: the API server called the webhook and got an answer.
- Both the serving certificate and the `caBundle` show a comfortable expiry date.
- `failurePolicy` and selectors are back to their intended values and match the backup, if you bypassed.
- Argo CD syncs and a Helm upgrade both succeed, and the self-heal setting is restored.
- The webhook rejects something it should reject, which proves the control is working again (a test object in a test namespace).

## Rollback

- **Restore the webhook configuration** from the backup file:

```bash
kubectl apply -f "webhook-$WEBHOOK_CFG-backup.yaml"
```

Remove server-populated fields such as `resourceVersion` from the file if the apply complains.

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

## Sources

- [Kubernetes: dynamic admission control](https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/)
- [cert-manager: CA injector](https://cert-manager.io/docs/concepts/ca-injector/)
- [Kubernetes: manage TLS certificates in a cluster](https://kubernetes.io/docs/tasks/tls/managing-tls-in-a-cluster/)
