---
title: "Encryption at rest and in transit on GCP: what to prove"
description: "Turn encryption claims on GCP into repeatable evidence: default and CMEK coverage per service, TLS enforcement and org policy, by gcloud."
type: guide
tags:
  - compliance
  - gcp
  - gke
  - security
  - audit
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Questionnaires and audits ask "is data encrypted at rest and in transit?" This note turns that sentence into checks you can run, save and repeat. It covers what Google provides by default, how to inventory customer-managed keys (CMEK) per service, how to check TLS enforcement, and how to collect it all on a schedule. Setting up keys is in [[patterns/cloud-kms-key-management]].

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Not checked against a running system
> CMEK support differs by service and changes over time, and so do gcloud flags, asset field names and org policy constraint names. Treat every command and name below as a starting point and check the current docs.

## Claims auditors ask about

Convert each claim into a check with a saved output:

| Claim                                                 | Check                                                 | Evidence file                           |
| ----------------------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| Data at rest is encrypted                             | Provider default encryption, plus CMEK where required | Provider docs reference, CMEK inventory |
| Sensitive data uses customer-managed keys             | Resources with and without a key                      | `cmek-coverage.json`                    |
| Keys are rotated and not disabled                     | Key and key version state                             | `kms-keys.json`                         |
| External traffic uses modern TLS                      | SSL policy minimum version                            | `ssl-policies.json`                     |
| Database connections require TLS                      | Instance SSL mode                                     | `sql-ssl.json`                          |
| Kubernetes secrets are encrypted at application layer | Cluster database encryption                           | `gke-secrets-encryption.json`           |

## Default encryption at rest

Google Cloud encrypts customer data at rest by default, using Google-managed keys. This is evidence of the provider's control, covered by its own compliance reports, not a control your team operates. State it that way: shared responsibility means you cite Google's documentation and audit reports for the default, and you own the configuration choices on top, such as CMEK and access to keys.

## CMEK coverage is per service

CMEK is not a global switch. Each service has its own support, its own way of specifying a key, and sometimes limits on location or key type. Before claiming "everything is CMEK", list the services you use and compare with Google's compatible-services list. Then inventory two sets:

- Resources that use a customer-managed key (and which key).
- Resources that could and do not, which are either gaps or documented exceptions.

## Collecting CMEK evidence

```bash title="scripts/cmek-evidence.sh"
set -euo pipefail

ORG_ID="123456789012"           # change: your organisation ID
SCOPE="organizations/${ORG_ID}"
OUT="evidence-$(date -u +%Y-%m-%d)"
mkdir -p "${OUT}"

# Cloud Asset Inventory search; check the current field names for kmsKeys.
gcloud asset search-all-resources --scope="${SCOPE}" \
  --asset-types="compute.googleapis.com/Disk,storage.googleapis.com/Bucket,sqladmin.googleapis.com/Instance" \
  --format=json > "${OUT}/resources.json"

# Keys with CMEK in use vs not (adjust the jq path to the fields you see in resources.json).
jq '[.[] | {name, assetType, kmsKeys: (.kmsKeys // [])}]' "${OUT}/resources.json" \
  > "${OUT}/cmek-coverage.json"
jq '[.[] | select((.kmsKeys // []) | length == 0) | .name]' "${OUT}/resources.json" \
  > "${OUT}/resources-without-cmek.json"
```

Key state next, because a disabled or destroyed key version makes the encryption claim hollow:

```bash title="scripts/kms-key-state.sh"
set -euo pipefail

PROJECT_ID="example-kms"        # change: project holding keys
LOCATION="europe-west1"         # change: key ring location
KEYRING="example-keyring"       # change: key ring name

gcloud kms keys list --keyring="${KEYRING}" --location="${LOCATION}" \
  --project="${PROJECT_ID}" \
  --format="json(name,purpose,rotationPeriod,nextRotationTime,primary.state)"
```

GKE application-layer secrets encryption (encrypting Kubernetes Secrets in etcd with a Cloud KMS key) shows up in the cluster description:

```bash title="scripts/gke-secrets-encryption.sh"
set -euo pipefail

PROJECT_ID="example-prod"       # change
CLUSTER="example-gke"           # change
LOCATION="europe-west1"         # change

gcloud container clusters describe "${CLUSTER}" --location="${LOCATION}" \
  --project="${PROJECT_ID}" --format="json(databaseEncryption)"
```

Expect a state such as `ENCRYPTED` with a key name; confirm the exact values in the current GKE docs. Pair this with [[patterns/external-secrets-with-secret-manager]] so secrets are not in Git in the first place.

## In transit

Break it into the hops you operate:

- **External HTTPS load balancers**: an SSL policy sets the minimum TLS version and cipher profile.

```bash title="scripts/tls-evidence.sh"
set -euo pipefail

PROJECT_ID="example-prod"       # change

gcloud compute ssl-policies list --project="${PROJECT_ID}" \
  --format="json(name,profile,minTlsVersion)"

# Which policy each HTTPS proxy uses (empty means the default policy):
gcloud compute target-https-proxies list --project="${PROJECT_ID}" \
  --format="json(name,sslPolicy)"
```

- **Cloud SQL**: the instance's SSL mode setting (under IP configuration) controls whether connections must use TLS. Describe the instance and save the field; check the current docs for allowed values.
- **GKE ingress and Gateway**: TLS certificates and policies on the Ingress, Gateway or backing load balancer. Certificate lifecycle is in [[runbooks/tls-certificate-renewal]].
- **Inside the cluster**: pod-to-pod encryption is not default for every path. A service mesh with mTLS or network-level encryption is a design choice; treat it as a pointer here, not a claim.
- **Between Google data centres**: Google describes protection of data in transit within its network in its whitepaper. Cite that for provider-side claims, again as shared responsibility.

## Org policy guardrails as preventive evidence

Detective evidence shows the state today; preventive controls show it cannot drift. Org policy can require CMEK for chosen services and restrict which projects hold keys. Constraint names I believe exist are `constraints/gcp.restrictNonCmekServices` and `constraints/gcp.restrictCmekCryptoKeyProjects`; there is also a constraint for minimum TLS version. Verify every name and its behaviour in the current docs before enforcing, because a wrong constraint can block deployments. The pattern for rolling them out safely (dry run, then enforce) is in [[compliance/gcp-organization-policy-guardrails]].

A Terraform plan check can also reject new resources that omit a key; see [[patterns/terraform-plan-policy-checks]] for how to write such a check in CI.

## Collecting evidence per project on a schedule

Run the collectors from a scheduled pipeline with a read-only identity, and write the output to the evidence bucket with a date.

```bash title="scripts/encryption-evidence-collector.sh"
set -euo pipefail

PROJECTS=("example-prod" "example-stage")      # change: projects in scope
EVIDENCE_BUCKET="gs://example-org-evidence"    # change: locked evidence bucket
STAMP="$(date -u +%Y-%m-%d)"
WORK="$(mktemp -d)"

for P in "${PROJECTS[@]}"; do
  gcloud compute ssl-policies list --project="${P}" --format=json > "${WORK}/${P}-ssl-policies.json"
  gcloud compute target-https-proxies list --project="${P}" --format=json > "${WORK}/${P}-https-proxies.json"
  gcloud container clusters list --project="${P}" \
    --format="json(name,location,databaseEncryption)" > "${WORK}/${P}-gke-encryption.json"
  gcloud sql instances list --project="${P}" \
    --format="json(name,settings.ipConfiguration)" > "${WORK}/${P}-sql-ip-config.json"
done

gcloud storage cp "${WORK}"/*.json "${EVIDENCE_BUCKET}/encryption/${STAMP}/"
rm -rf "${WORK}"
```

If one project fails, the script stops and the run is visibly failed; do not swallow errors, because a partial evidence set looks complete.

## Exceptions and gaps

Not every service can use CMEK, and not every workload needs it. Record each gap with the reason (service lacks support, data not sensitive, cost), the compensating control, an owner and a review date, using [[compliance/policy-exception-and-waiver-process]]. An undocumented "we use defaults" is weaker than a documented decision.

## Related

- [[patterns/cloud-kms-key-management]]: how keys and rings are set up.
- [[compliance/gcp-organization-policy-guardrails]]: preventive constraints.
- [[patterns/external-secrets-with-secret-manager]]: keeping secrets out of Git.
- [[patterns/terraform-plan-policy-checks]]: blocking unencrypted resources before apply.
- [[compliance/audit-evidence-collection-and-retention]]: storage of the output.
- [[runbooks/tls-certificate-renewal]]: certificate lifecycle for TLS endpoints.

## Sources

- Google Cloud, [Default encryption at rest](https://cloud.google.com/docs/security/encryption/default-encryption).
- Google Cloud, [Encryption in transit](https://cloud.google.com/docs/security/encryption-in-transit).
- Google Cloud, [CMEK compatible services](https://cloud.google.com/kms/docs/compatible-services).
- Google Cloud, [Searching resources with Asset Inventory](https://cloud.google.com/asset-inventory/docs/searching-resources).
- Google Cloud, [SSL policies](https://cloud.google.com/load-balancing/docs/ssl-policies-concepts).
- Google Cloud SQL, SSL/TLS configuration: find the current page under [cloud.google.com/sql/docs](https://cloud.google.com/sql/docs).
