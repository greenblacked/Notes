---
title: Secret Manager as the secrets system of record
description: Google Secret Manager holds secrets with CMEK, External Secrets Operator syncs them to clusters, and Vault is not adopted.
type: adr
tags:
  - adr
  - security
  - gcp
  - gke
  - kubernetes
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0036
---

## Context

Secrets had several homes: CI variables, Kubernetes Secrets applied by hand, values in Helm release history and the occasional file in Git. Rotation was ad hoc, nobody could list who could read what, and a leaked CI variable meant guessing where else the value lived (see [[leaked-credential-rotation]]).

GitOps (see [[0001-gitops-with-argocd]]) requires that Git never contains plain-text secrets, so clusters need a reference-based mechanism. We already run on Google Cloud with Workload Identity, so a cloud-native store has the smallest operating cost.

## Decision

**Google Secret Manager is the system of record for application and platform secrets.** HashiCorp Vault is not adopted.

- **Storage.** Secrets are encrypted with customer-managed keys where policy requires it (see [[cloud-kms-key-management]]). Access is granted per secret with IAM, never at project level for application identities.
- **Delivery to clusters.** External Secrets Operator reads Secret Manager through Workload Identity and creates Kubernetes Secrets. Git holds only `ExternalSecret` references (see [[external-secrets-with-secret-manager]]).
- **Terraform creates containers, not values.** Terraform manages the secret resource and its IAM, while versions are written by an owner or a rotation job outside Terraform. This keeps values out of state (see [[0032-terraform-state-in-gcs-per-environment]]). Variables and outputs that carry sensitive data are marked `sensitive`, which hides them in output but does not remove them from state.
- **Ownership and age.** Every secret has an `owner` label and a maximum age. Rotation notifications go to Pub/Sub, and an alert fires on secrets past their age.
- **Auditing.** Data Access audit logs are enabled for Secret Manager and routed per [[0044-central-log-sinks-and-retention-tiers]].
- **CI.** CI authenticates through federation, not stored keys (see [[0026-keyless-ci-auth-with-workload-identity-federation]]), and secret scanning runs before merge (see [[secret-scanning-pre-commit-and-ci]]).

```hcl title="secrets.tf"
resource "google_secret_manager_secret" "db_password" {
  project   = "example-prod-payments"
  secret_id = "payments-db-password"

  labels = {
    owner = "payments"
  }

  replication {
    auto {}
  }

  rotation {
    next_rotation_time = "2027-01-19T00:00:00Z"
    rotation_period    = "7776000s"
  }
  topics {
    name = "projects/example-prod-payments/topics/secret-rotation"
  }
}
```

```yaml title="external-secret.yaml"
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: payments-db
  namespace: payments
spec:
  refreshInterval: 1h
  secretStoreRef:
    kind: ClusterSecretStore
    name: gcp-secret-manager
  target:
    name: payments-db
  data:
    - secretKey: password
      remoteRef:
        key: payments-db-password
```

> [!info] Claims not checked against current docs
> The Terraform `rotation` and `replication` block shapes, the `ExternalSecret` API version, Vault's current licence, and the status of the OpenBao fork. Check each before relying on the comparison with Vault.

## Consequences

Easier:

- One place to answer "who can read this secret", through IAM and audit logs.
- No new service to run, patch or recover.
- Pods never hold cloud credentials for secrets: the operator does, scoped by Workload Identity.

Harder:

- Kubernetes Secrets still exist in etcd on the clusters, so cluster encryption and RBAC on Secrets matter.
- We have no dynamic secrets (per-request database credentials) as Vault offers. If that need appears, reopen the decision.
- The operator is a dependency: if it is down, new or rotated secrets do not arrive, though running pods keep their last value.
- Tying secrets to Google Cloud increases lock-in for multi-cloud work.

## Alternatives considered

- **HashiCorp Vault or OpenBao.** Strong for dynamic secrets and multi-cloud, but a stateful tier-1 service to operate, back up and unseal. Not justified by current needs.
- **Sealed Secrets.** Encrypted secrets in Git are simple, but rotation, access reporting and key custody are weaker. Rejected as the system of record.
- **SOPS with Cloud KMS.** Reasonable for bootstrap material and small teams. Not chosen as the main path because per-secret IAM and audit are stronger in Secret Manager.

## Validation

```bash title="validate-secrets.sh"
set -euo pipefail
PROJECT_ID="example-prod-payments"

# Secrets without an owner label (expected: no output)
gcloud secrets list --project="${PROJECT_ID}" --format=json \
  | jq -r '.[] | select((.labels.owner // "") == "") | .name'

# Project-level secret access for any member (review; expected: none for apps)
gcloud projects get-iam-policy "${PROJECT_ID}" --format=json \
  | jq -r '.bindings[] | select(.role|test("secretmanager")) | "\(.role) \(.members|join(","))"'

# External secrets reconcile successfully
kubectl get externalsecrets -A \
  -o custom-columns=NS:.metadata.namespace,NAME:.metadata.name,READY:.status.conditions[0].status
```

## References

- Secret Manager: https://cloud.google.com/secret-manager/docs
- External Secrets Operator: https://external-secrets.io/latest/
- Sensitive data in Terraform state: https://developer.hashicorp.com/terraform/language/state/sensitive-data

Related notes:

- [[external-secrets-with-secret-manager]]
- [[cloud-kms-key-management]]
- [[secret-scanning-pre-commit-and-ci]]
- [[leaked-credential-rotation]]
- [[0026-keyless-ci-auth-with-workload-identity-federation]]
- [[0032-terraform-state-in-gcs-per-environment]]
