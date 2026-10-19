---
title: Recover from an expired or disabled service account key
description: "Restore a workload broken by an expired or disabled GCP service account key, then move it to keyless auth and retire the key."
type: runbook
tags:
  - runbooks
  - gcp
  - security
  - reliability
  - incident-management
created: 2026-10-19
modified: 2026-10-19
draft: false
---

A service that used to authenticate to Google Cloud with a downloaded JSON key suddenly gets `invalid_grant`, `invalid_client` or `401` errors. Nothing was deployed. The cause is usually the key: it expired, someone disabled it, or an automatic rotation job removed it. The goal here is outage-shaped: restore access, understand why it broke, and use the incident to remove the key rather than to renew it.

> [!info] Scope and verification
> The commands and organisation policy names were not checked against live documentation when this note was written, and the note is not marked `verified`. Constraint names, flags and defaults change; verify each name below in the current Google Cloud IAM and Organization Policy documentation before relying on it.

## When to use

- A workload, CI job or external system fails to authenticate as a service account, and the failure began at a specific time with no code change.
- The consumer error mentions an invalid, expired, disabled or deleted key, or the key ID.
- A scheduled secret rotation or a policy rollout happened shortly before.

If the key may have leaked (appears in a repository, a log or a public bucket, or the service account is being used from unexpected places), do not follow this runbook. Use [[leaked-credential-rotation]]: containment and revocation come first, and re-enabling a key would be the wrong move. For a wider incident, run [[incident-response]] in parallel.

## Preconditions

- Permission to view and manage keys on the service account (`roles/iam.serviceAccountKeyAdmin` or equivalent), and to read audit logs.
- The service account email and the consumer that uses it (name, location of the stored key).
- Confirmation that there is no sign of misuse in the audit logs for the last few days (step 1).

```bash
PROJECT=example-project
SA=ci-deployer@example-project.iam.gserviceaccount.com
gcloud config set project "$PROJECT"
```

## Steps

### 1. Confirm the cause

```bash
gcloud iam service-accounts keys list --iam-account "$SA" \
  --format="table(name.basename(),keyType,validAfterTime,validBeforeTime,disabled)"
```

Read the output:

- A key whose `validBeforeTime` is in the past has expired. User-managed keys do not expire by default, so an expiry date means something set one (step 2).
- `disabled: true` means someone or something disabled it.
- A missing key ID means it was deleted.
- Keys with `keyType` `SYSTEM_MANAGED` are managed by Google and are not relevant here.

Match the key ID to the one the consumer uses. The key ID is in the JSON file as `private_key_id`; do not print the private key itself.

```bash
jq -r '.private_key_id' key.json
```

Then confirm in the audit logs who or what changed the key, and whether anything used it from unexpected places:

```bash
gcloud logging read \
  'protoPayload.serviceName="iam.googleapis.com" AND protoPayload.resourceName:"'"$SA"'" AND (protoPayload.methodName:"DisableServiceAccountKey" OR protoPayload.methodName:"DeleteServiceAccountKey" OR protoPayload.methodName:"EnableServiceAccountKey")' \
  --freshness=7d --format="table(timestamp,protoPayload.authenticationInfo.principalEmail,protoPayload.methodName)"
```

Admin Activity audit logs are on by default; check the Cloud Audit Logs documentation for the retention you have. If the log shows an unknown principal, stop and switch to [[leaked-credential-rotation]].

### 2. Find why it happened

Common causes:

- **Organisation policy.** An organisation policy constraint can limit the lifetime of user-managed keys. I believe the constraint is `iam.serviceAccountKeyExpiryHours`, but verify the name, whether it exists in your environment and how it applies in the current Organization Policy documentation. Check which policies apply to the project:

```bash
gcloud resource-manager org-policies list --project "$PROJECT"
```

The related constraint `iam.disableServiceAccountKeyCreation` blocks the creation of new user-managed keys altogether; confirm the exact name in the documentation. If it is on, step 3's replacement key cannot be created and you must go straight to step 4. Both are described in [[gcp-organization-policy-guardrails]].

- **An external rotation job** that deleted or disabled old keys but whose consumer never picked up the new one. Find the job's identity in the audit log from step 1.
- **A human or a clean-up script** that disabled "unused" keys. Key usage insights may show the last authentication time for a key; check the current documentation for how to read it.

### 3. Emergency restore

Choose the least risky option that restores service:

1. **Re-enable the key** if it was disabled for the wrong reason and the audit logs show no misuse:

```bash
KEY_ID=0123456789abcdef0123456789abcdef01234567      # from step 1; not a secret
gcloud iam service-accounts keys enable "$KEY_ID" --iam-account "$SA"
```

An expired key cannot be re-enabled; expiry is permanent.

2. **Create a short-lived replacement** only if policy allows user-managed keys at all, and only as a bridge:

```bash
gcloud iam service-accounts keys create /dev/stdout --iam-account "$SA" \
  | gcloud secrets versions add ci-deployer-key --data-file=-
```

Store it directly in Secret Manager as above so it never touches disk or a terminal history, then point the consumer at the new secret version. Delivery to the consumer should be through your secret manager integration, see [[external-secrets-with-secret-manager]]. Never commit the key to a repository, and never paste it into chat or a ticket.

3. If neither is possible, go directly to step 4; that is the real fix anyway.

### 4. Move to keyless authentication

Keys are the long-lived credentials that cause this class of incident. Replace them:

- **Workloads on GKE:** use Workload Identity, so Pods receive short-lived tokens for a Google service account with no key. See [[gke-workload-identity]].
- **CI and external workloads** (GitLab CI, GitHub Actions, other clouds, on-premises): use Workload Identity Federation, exchanging the platform's own OIDC token for short-lived Google credentials. See [[iam-groups-and-ci-workload-identity-federation]].
- **Other Google Cloud compute:** attach the service account to the resource and use the metadata server.

Roll out in a lower environment first. After the change, the consumer should have no JSON key in its configuration at all. Application code using Application Default Credentials usually needs no change, only the environment.

### 5. Retire the old key

Disable before delete, and wait.

```bash
gcloud iam service-accounts keys disable "$KEY_ID" --iam-account "$SA"
# Watch logs and error rates for the agreed grace period, then:
gcloud iam service-accounts keys delete "$KEY_ID" --iam-account "$SA"
```

Choose a grace period that covers your slowest consumer (a monthly batch job needs more than a day). Deleting is irreversible. Also remove the old secret versions and any copies of the key (CI variables, laptops, backups), and add a policy or a check that prevents new keys from appearing: consider enforcing the creation constraint from step 2 across the project once nothing needs keys.

## Validation

```bash
gcloud iam service-accounts keys list --iam-account "$SA" --format="table(name.basename(),disabled,validBeforeTime)"
gcloud auth list                                        # in the consumer's environment, shows the active principal
```

- The consumer authenticates and completes a real operation (a deployment, a bucket read, an API call), checked in its own logs.
- The audit log shows calls from the service account with the expected authentication method (token from federation or Workload Identity, not a key ID).
- No user-managed keys remain on the service account, or each remaining one has an owner and a documented reason.
- An alert exists for key creation and for key age, so this is detected before an outage.

## Rollback

- **Re-enabled key caused concern:** disable it again. If the audit log later shows misuse, switch to [[leaked-credential-rotation]].
- **Keyless migration broke the consumer:** during the grace period, the old key is only disabled, not deleted. Re-enable it with `keys enable`, if it is not expired, to restore service, then fix the new setup. This is why you disable before deleting.
- **Replacement key in Secret Manager:** disable the version (`gcloud secrets versions disable`) rather than deleting it when you roll back, and remove it after the incident review.
- **Policy change made during the incident:** revert it via the infrastructure-as-code change that introduced it, and record the exception and its expiry.

## Troubleshooting

| Symptom                                                    | Likely cause and fix                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `keys create` fails with a policy violation                | Key creation is blocked by an organisation policy. Use keyless auth (step 4).                                         |
| Key re-enabled but the consumer still fails                | The consumer cached the old credential, or the key had expired. Restart it; check `validBeforeTime`.                  |
| New key works, fails again after a fixed interval          | A key expiry policy applies to new keys too. Stop issuing keys and migrate (step 4).                                  |
| Federation fails with `invalid_target` or audience errors  | The provider configuration or the attribute condition does not match the token. Check the pool and provider settings. |
| Workload Identity fails with `403` on the service account  | The binding between the Kubernetes service account and the Google service account is missing or wrong.                |
| Old key deleted, an unknown job now fails                  | A consumer you did not know about. Restore the dependency with a keyless identity, not a new key.                     |
| Audit log shows the disable came from an unknown principal | Treat as a possible compromise: [[leaked-credential-rotation]] and [[incident-response]].                             |

## Related

- [[leaked-credential-rotation]] when the key may be exposed.
- [[gke-workload-identity]] and [[iam-groups-and-ci-workload-identity-federation]] for keyless authentication.
- [[gcp-organization-policy-guardrails]] for the constraints that govern keys.
- [[external-secrets-with-secret-manager]] for delivering secrets without committing them.
- [[incident-response]] for roles and updates.

## Sources

- [Best practices for managing service account keys](https://cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys)
- [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation)
- [Restricting service accounts with organization policy](https://cloud.google.com/resource-manager/docs/organization-policy/restricting-service-accounts)
