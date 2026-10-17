---
title: Image signing with cosign and verification at admission
description: Sign image digests in GitLab CI or Jenkins, define an identity policy per repository, and enforce it at admission with Kyverno or Binary Authorization.
type: pattern
tags:
  - patterns
  - supply-chain
  - security
  - kubernetes
  - gke
created: 2026-10-17
modified: 2026-10-17
draft: false
---

This pattern covers signing container image digests in CI, deciding which identity may sign images for which repository, and enforcing that policy when pods are admitted to a GKE cluster. It is written for senior DevOps engineers. Basic signing is introduced in [[patterns/dockerfile-hardening]]; this note adds the identity policy and the enforcement. For the choice between policy engines see [[tools/gatekeeper-vs-kyverno]], for the audit-then-enforce procedure see [[runbooks/policy-rollout-audit-to-enforce]], and for how CI authenticates to Google Cloud see [[architecture/iam-groups-and-ci-workload-identity-federation]].

> [!info] Scope and sources
> Written against cosign from the Sigstore project ([sigstore.dev](https://sigstore.dev)), Kyverno image verification ([kyverno.io](https://kyverno.io)), and GKE Binary Authorization ([cloud.google.com](https://cloud.google.com/binary-authorization/docs)). Examples assume GitLab CI with OIDC and Jenkins with Cloud KMS.

> [!note] Not verified
> The claims below were written from documentation knowledge and were not checked against a running system or the current docs: cosign major version flags, the GitLab id_token claims used in the certificate identity, the Kyverno verifyImages schema, Binary Authorization support for Sigstore signatures, and Rekor behaviour for private images. Check them before relying on them.

## Threat model

Signing answers one question at deploy time: did an identity I trust produce this exact image digest? It defends against:

- an image pushed to the registry by a compromised developer account or a stolen registry credential;
- an image built outside the pipeline, for example from a laptop, and deployed by tag;
- a tag that was overwritten after review.

It does not tell you the image is free of vulnerabilities or that the code in it is good. A signed image from a trusted pipeline can still contain a vulnerable library; pair signing with scanning and an SBOM (see [[compliance/sbom-generation-and-storage]]).

The signature must be bound to the digest. A policy that verifies a tag proves nothing, because the tag can point somewhere else a second later.

## Keyless versus KMS keys

| Concern               | Keyless (OIDC identity)                                | Cloud KMS key                                |
| --------------------- | ------------------------------------------------------ | -------------------------------------------- |
| Key management        | None; short-lived certificate per signing              | Key ring, rotation and IAM you own           |
| What you trust        | The CI identity and the Sigstore public infrastructure | The KMS key and who may use it               |
| Policy expressed as   | Certificate identity and issuer                        | Public key                                   |
| Fits                  | GitLab CI with `id_tokens`                             | Jenkins, or any system without an OIDC token |
| Transparency log      | Entries recorded by default                            | Uploaded to public Rekor unless disabled     |
| Air-gapped or private | Needs a private Sigstore deployment                    | Works with Google Cloud only                 |

Use keyless for GitLab CI when public transparency log entries are acceptable. Use a KMS key where they are not, or where the build system cannot produce an OIDC token, as with Jenkins. A KMS key alone does not keep entries out of the log: cosign uploads to the public Rekor log by default even with `--key`, so disable the upload explicitly (see the Jenkins section) or run a private Rekor.

> [!warning] Not verified: which issuers public Fulcio accepts
> Public Fulcio issues certificates only for OIDC issuers in its own configuration, and `https://gitlab.com` is one of them. A self-managed GitLab issuer such as the `https://gitlab.example.com` used in the examples below is normally not accepted, so keyless signing from it fails unless you run a private Sigstore deployment (Fulcio and Rekor, with `--fulcio-url` and `--rekor-url`, and a trust root that verifiers share) or use a KMS key. The examples assume a private Fulcio that trusts the issuer; if you use SaaS GitLab, use `https://gitlab.com` as the issuer instead. Check the current Fulcio issuer list.

## Signing in GitLab CI

The job requests an OIDC token with audience `sigstore`. Cosign exchanges it for a short-lived certificate whose identity is derived from the job's pipeline definition.

```yaml title=".gitlab-ci.yml"
sign-image:
  stage: sign
  image: registry.example.com/ci-tools/supply-chain:1.0.0 # change: your internal image with cosign; pin by digest
  needs:
    - job: build-image
      artifacts: true
  id_tokens:
    SIGSTORE_ID_TOKEN:
      aud: sigstore
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - cosign sign --yes "${IMAGE_REPO}@${IMAGE_DIGEST}"
```

This assumes Fulcio trusts your GitLab issuer; see the callout under the comparison table.

Restrict the job to protected branches or tags. If any branch can sign, the identity policy cannot tell reviewed code from an experiment.

## Signing in Jenkins with Cloud KMS

Jenkins signs with a Cloud KMS key. The agent authenticates through Workload Identity, so there is no key file and no stored credential. Grant the agent's Google service account only `roles/cloudkms.signerVerifier` on this one key.

```groovy title="Jenkinsfile"
stage('Sign image') {
  environment {
    IMAGE_REPO = 'europe-docker.pkg.dev/my-project/my-repo/my-app' // change: your image repository
    KMS_KEY    = 'gcpkms://projects/my-project/locations/europe-west1/keyRings/ci/cryptoKeys/image-signing' // change: your KMS key path
  }
  steps {
    sh '''
      set -euo pipefail
      # --tlog-upload=false keeps the entry out of public Rekor (flag name: check for your pinned cosign version)
      cosign sign --yes --tlog-upload=false --key "${KMS_KEY}" "${IMAGE_REPO}@${IMAGE_DIGEST}"
    '''
  }
}
```

Without the log entry, verification must skip the transparency log check: `cosign verify --key gcpkms://... --insecure-ignore-tlog=true`, or `rekor: {ignoreTlog: true}` on a Kyverno `keys` attestor. Check both option names against your versions.

Keep signing in a stage or an agent pool that ordinary builds cannot influence, as discussed in [[compliance/slsa-build-provenance]].

## Identity policy

The policy is the list of who may sign what. Write it down per repository, then encode it in the verification step.

| Repository                                            | Expected identity (anchored regex)                                                  | Issuer                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------- |
| `europe-docker.pkg.dev/my-project/my-repo/my-app`     | `^https://gitlab\.example\.com/my-group/my-app//\.gitlab-ci\.yml@refs/heads/main$`  | `https://gitlab.example.com` |
| `europe-docker.pkg.dev/my-project/my-repo/my-worker`  | `^https://gitlab\.example\.com/my-group/my-worker//\.gitlab-ci\.yml@refs/tags/v.*$` | `https://gitlab.example.com` |
| `europe-docker.pkg.dev/my-project/legacy/*` (Jenkins) | Not applicable: verify with the KMS public key                                      | Not applicable               |

Verification on a workstation or in a release gate looks like this:

```bash
set -euo pipefail

IMAGE="europe-docker.pkg.dev/my-project/my-repo/my-app"  # change: your image repository
DIGEST="sha256:0000000000000000000000000000000000000000000000000000000000000000"  # change: digest to verify
ISSUER="https://gitlab.example.com"  # change: your GitLab OIDC issuer
IDENTITY_RE='^https://gitlab\.example\.com/my-group/my-app//\.gitlab-ci\.yml@refs/heads/main$'  # change: anchored to your project path and ref

cosign verify \
  --certificate-identity-regexp "${IDENTITY_RE}" \
  --certificate-oidc-issuer "${ISSUER}" \
  "${IMAGE}@${DIGEST}"
```

Anchor the regex at both ends and include the project path. A pattern such as `.*gitlab.example.com.*` accepts every project on that GitLab, including one an attacker created.

## Enforcing with Kyverno

Kyverno's `verifyImages` rule verifies signatures at admission and can rewrite tags to digests. Start in audit mode; the rollout procedure is in [[runbooks/policy-rollout-audit-to-enforce]].

```yaml title="verify-image-signatures.yaml"
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signatures
spec:
  validationFailureAction: Audit # change to Enforce after the audit period, together with mutateDigest below
  webhookTimeoutSeconds: 30
  rules:
    - name: verify-my-app-keyless
      match:
        any:
          - resources:
              kinds:
                - Pod
              namespaces:
                - production
      verifyImages:
        - imageReferences:
            - "europe-docker.pkg.dev/my-project/my-repo/my-app*"
          mutateDigest: false # change to true when you switch to Enforce; check your Kyverno version, mutation may be rejected or ignored in Audit mode
          required: true
          attestors:
            - entries:
                - keyless:
                    issuer: "https://gitlab.example.com"
                    subject: "https://gitlab.example.com/my-group/my-app//.gitlab-ci.yml@refs/heads/main"
```

The `subject` here is an exact match, which is the safest form. Newer Kyverno versions may support regular expressions and may place the failure action elsewhere in the schema; check your installed version. Keep policies in Git and deliver them like any other manifest (see [[patterns/helm-chart-ci-quality-gates]] for chart checks that can validate them before merge).

## Enforcing with Binary Authorization

Binary Authorization is the Google-managed alternative on GKE. It evaluates a policy at admission and requires attestations from named attestors. Its native attestations are Container Analysis attestations, not cosign signatures. Whether Sigstore signatures are accepted directly in your version is not verified; the safe route is a separate attestation step that signs with a KMS key.

```hcl title="binauthz.tf"
variable "project_id" {
  type    = string
  default = "my-project" # change: your project ID
}

data "google_kms_crypto_key_version" "attestor" {
  crypto_key = "projects/my-project/locations/europe-west1/keyRings/ci/cryptoKeys/attestor" # change: your KMS key
}

resource "google_container_analysis_note" "prod" {
  project = var.project_id
  name    = "prod-release-note"

  attestation_authority {
    hint {
      human_readable_name = "Production release attestor"
    }
  }
}

resource "google_binary_authorization_attestor" "prod" {
  project = var.project_id
  name    = "prod-release"

  attestation_authority_note {
    note_reference = google_container_analysis_note.prod.name

    public_keys {
      id = data.google_kms_crypto_key_version.attestor.id

      pkix_public_key {
        public_key_pem      = data.google_kms_crypto_key_version.attestor.public_key[0].pem
        signature_algorithm = data.google_kms_crypto_key_version.attestor.public_key[0].algorithm
      }
    }
  }
}

resource "google_binary_authorization_policy" "policy" {
  project                       = var.project_id
  global_policy_evaluation_mode = "ENABLE"

  default_admission_rule {
    # ALWAYS_ALLOW is not secure by default: any cluster without its own rule accepts unsigned images.
    # Use ALWAYS_DENY or REQUIRE_ATTESTATION plus admission_whitelist_patterns for system images once every cluster has a rule.
    evaluation_mode  = "ALWAYS_ALLOW"
    enforcement_mode = "ENFORCED_BLOCK_AND_AUDIT_LOG"
  }

  cluster_admission_rules {
    cluster                 = "europe-west1.prod-cluster" # change: location.cluster-name
    evaluation_mode         = "REQUIRE_ATTESTATION"
    enforcement_mode        = "DRYRUN_AUDIT_LOG_ONLY" # change to ENFORCED_BLOCK_AND_AUDIT_LOG after the dry run
    require_attestations_by = [google_binary_authorization_attestor.prod.name]
  }
}
```

The CI job that creates the attestation uses `gcloud container binauthz attestations sign-and-create` with the same KMS key version. The cluster must also have Binary Authorization enabled; that setting lives in the cluster definition (see [[patterns/terraform-module-and-state-layout]] for where to keep it).

## Rollout and break-glass

1. **Inventory.** List the registries and namespaces that must pass, and the third-party images that cannot be signed by you.
2. **Sign everything new.** Add the signing job to every pipeline before enabling any policy.
3. **Audit.** Run Kyverno in `Audit` or Binary Authorization in dry-run for at least one release cycle. Read the violation reports and fix the pipelines or add exceptions.
4. **Enforce per namespace.** Start with one low-risk namespace, then production.
5. **Keep an exit.** Exclude `kube-system` and other system namespaces explicitly, and keep a documented, logged, time-limited break-glass path for an emergency deploy. In Kyverno that is a policy exception object or a temporary namespace exclusion; in Binary Authorization it is a break-glass annotation on the pod, which writes an audit log entry. Both mechanisms and their exact names should be checked in the current docs. Every use needs a ticket and a follow-up, as in [[standards/production-change-checklist]].

## Pitfalls

- **Loose identity regex.** An unanchored pattern or one without the project path trusts more than intended.
- **Public transparency log metadata.** Cosign uploads signature entries to the public Rekor log by default, with a keyless certificate or a KMS key. For private images this can expose repository and project names. Decide this before rollout; disable the upload (and ignore the log when verifying) or use a private Sigstore instance if it is unacceptable.
- **Tags instead of digests.** Sign and verify digests. Use `mutateDigest` or deploy by digest so the verified image is the one that runs.
- **Signing on every branch.** If feature branches can sign, the identity policy cannot distinguish them from release builds.
- **Policy outage.** A failing admission webhook can block all deployments. Set a sensible timeout and decide the failure behaviour (fail open or closed) per namespace on purpose.
- **Forgotten init containers and sidecars.** They are images too; the policy must cover them.
- **Unverified third-party images.** Mirror them into your registry and sign them with a dedicated identity after review, or exempt them explicitly.

## Verify

1. A signed image deploys; an unsigned image in the same namespace is reported (audit) or rejected (enforce). Test with `kubectl run test --image=...@sha256:... -n production --dry-run=server`.
2. `cosign verify` with your identity regex succeeds for the right project and fails for a different project path.
3. The policy report lists the expected number of passing resources: `kubectl get policyreport -A`.
4. A break-glass deploy is possible, logged and visible in the audit log.

## Rollback

Set the Kyverno policy back to `Audit` (or delete the `ClusterPolicy`), or set the Binary Authorization rule to `DRYRUN_AUDIT_LOG_ONLY`. Keep the signing jobs running; they are harmless and make the next attempt easier.

## Related

- [[patterns/dockerfile-hardening]]: smaller images give signatures less to cover.
- [[tools/gatekeeper-vs-kyverno]]: choose the policy engine that enforces this.
- [[runbooks/policy-rollout-audit-to-enforce]]: the staged rollout used here.
- [[compliance/slsa-build-provenance]]: signed provenance builds on the same identities.
- [[architecture/iam-groups-and-ci-workload-identity-federation]]: how CI gets access to KMS and the registry without keys.
- [[compliance/sbom-generation-and-storage]]: attach SBOMs as attestations signed the same way.
