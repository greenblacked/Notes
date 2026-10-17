---
title: Artifact retention and cleanup policy
description: "Retention rules for CI artifacts, images, packages and caches across GitLab, GCS, Artifact Registry and Artifactory, with cleanup that protects deployed items."
type: standard
tags:
  - standards
  - artifactory
  - ci-cd
  - cost
  - supply-chain
created: 2026-10-17
modified: 2026-10-17
draft: false
---

Registries and artifact stores only grow. Left alone they become a cost problem, a slow-search problem, and eventually an outage when a disk or quota fills. The opposite mistake is worse: a cleanup job that deletes an image a running workload still needs, or a release you must be able to reproduce. This standard sets what is kept for how long, what is never deleted, and how cleanup is run safely. It covers GitLab CI artifacts, container images and packages in Artifactory and Artifact Registry, Cloud Storage buckets, and build caches.

> [!info] Scope
> This standard sets retention periods and the cleanup mechanics. What counts as proof for an auditor, and how long evidence must be kept for a given framework, is covered in [[audit-evidence-collection-and-retention]]. Cost allocation and budgets are in [[finops-cost-allocation-and-guardrails]]. How artifacts move between repositories is in [[artifact-promotion-artifactory]].

> [!warning] Not legal or audit advice
> The periods below are engineering defaults. Legal, contractual and audit retention requirements can be longer, and auditors or counsel decide what satisfies them. Where a requirement is longer than the default, the requirement wins.

## Retention table

| Artifact class                                         | Where it lives                        | Default retention                                      | Why                                                       |
| ------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| CI job artifacts (test reports, build outputs)         | GitLab job artifacts                  | 14 days                                                | Needed to debug a recent pipeline, not later              |
| PR / merge request image tags                          | `docker-dev-local`, Artifact Registry | 30 days after last push                                | Long enough for review cycles, short enough to stay small |
| Main-branch builds not promoted                        | Dev repository                        | 30 days                                                | Anything useful gets promoted                             |
| Release artifacts (versioned images, charts, packages) | Prod repository                       | Indefinite                                             | Reproduce, roll back and answer "what ran on date X"      |
| Promoted staging artifacts                             | Staging repository                    | Keep the last releases plus anything deployed recently | Rollback target and audit trail                           |
| Idle build caches                                      | Runner cache buckets, remote caches   | 7 days                                                 | Caches are rebuilt on a miss                              |
| Terraform plan files and CI logs used as evidence      | Evidence bucket                       | Set by the audit retention note                        | Different purpose, see the audit note                     |

Adjust the numbers to your volume and cost, but keep the shape: short for unpromoted artifacts, indefinite for what shipped. Changing a default needs the same review as any other policy, see [[policy-exception-and-waiver-process]] for one-off exceptions.

## Always keep (releases, promoted, referenced by running workloads)

Three kinds of artifact are never deleted by an automated rule:

1. **Releases.** Every versioned artifact that was published as a release stays in the prod repository. Deleting a release breaks rollback and any later reproduction.
2. **Promoted artifacts.** Anything that carries a promotion marker (for Artifactory, the `prod-promoted` property used below, set by the promotion job in [[artifact-promotion-artifactory]]) is protected in every repository it exists in, including the dev copy.
3. **Anything referenced by a running workload.** An image digest that a Pod in any GKE cluster is running, or that a Helm release, Argo CD application or Terraform state still points to, must exist. A node that restarts will pull it again, and a missing image turns a node replacement into an outage.

The rule for cleanup code: **deny by default for anything with a marker, and check the clusters before you delete.** The check script is in the section on dry runs below.

## Automating cleanup

Prefer the cleanup feature of the store itself, so the policy lives next to the data and runs without a pipeline. Use a scheduled job only where the store has no suitable feature.

### GitLab CI job artifacts

Every job that produces artifacts sets `expire_in`. Do not rely on the instance default, which an administrator can change.

```yaml title=".gitlab-ci.yml"
unit-test:
  script:
    - make test
  artifacts:
    when: always
    expire_in: 14 days # matches the retention table
    paths:
      - reports/
    reports:
      junit: reports/junit.xml

release-build:
  script:
    - make package
  artifacts:
    expire_in: 14 days # the release itself is published to the package registry; this is only the job copy
    paths:
      - dist/
```

A release must not depend on a job artifact: publish it to the prod repository in the pipeline and treat the job artifact as temporary. The project setting that keeps the latest artifacts of each ref can hold artifacts past `expire_in`; check it, because it affects storage.

### Cloud Storage buckets (artifacts and caches)

A lifecycle rule deletes objects by age, scoped to a prefix so one bucket can hold different classes.

```json title="lifecycle.json"
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": { "age": 14, "matchesPrefix": ["ci-artifacts/"] }
    },
    {
      "action": { "type": "Delete" },
      "condition": { "age": 7, "matchesPrefix": ["runner-cache/"] }
    }
  ]
}
```

```bash
BUCKET=gs://example-ci-artifacts # change: your bucket
gcloud storage buckets update "$BUCKET" --lifecycle-file=lifecycle.json
gcloud storage buckets describe "$BUCKET" --format="yaml(lifecycle_config)"
```

`age` counts days from object creation, so this expires a cache 7 days after it was written, not 7 days after it was last used. For a true idle rule you need a custom-time based condition and a job that updates the time on use, which is more machinery than most caches deserve. Do not put objects that the retention table says to keep indefinitely in a bucket with an age rule; use a separate bucket (or a prefix not matched) and, for evidence, a retention policy per the audit note.

### Artifact Registry

Artifact Registry cleanup policies delete or keep versions by tag state, tag prefix, age and count. Define KEEP rules for what must survive and a DELETE rule for the rest, and run the policy in dry-run mode first.

```json title="ar-cleanup-policy.json"
[
  {
    "name": "keep-releases",
    "action": { "type": "Keep" },
    "condition": { "tagState": "TAGGED", "tagPrefixes": ["v", "release-"] }
  },
  {
    "name": "keep-recent-versions",
    "action": { "type": "Keep" },
    "mostRecentVersions": { "keepCount": 10 }
  },
  {
    "name": "delete-old-pr-images",
    "action": { "type": "Delete" },
    "condition": { "tagState": "ANY", "tagPrefixes": ["pr-"], "olderThan": "2592000s" }
  },
  {
    "name": "delete-old-untagged",
    "action": { "type": "Delete" },
    "condition": { "tagState": "UNTAGGED", "olderThan": "2592000s" }
  }
]
```

```bash
PROJECT=example-prod-project # change
LOCATION=europe-west1 # change
REPO=containers # change

# Dry run: records what would be deleted without deleting it.
gcloud artifacts repositories set-cleanup-policies "$REPO" \
  --project="$PROJECT" --location="$LOCATION" \
  --policy=ar-cleanup-policy.json --dry-run

# After reviewing the audit log of the dry run, apply for real.
gcloud artifacts repositories set-cleanup-policies "$REPO" \
  --project="$PROJECT" --location="$LOCATION" \
  --policy=ar-cleanup-policy.json --no-dry-run
```

The 30-day value is `2592000s`. The tag prefixes `v` and `release-`, and `pr-`, are conventions in this example; change them to your tagging scheme. Remember that a policy only protects what its Keep rules describe, so a running image whose tag matches no Keep rule (for example a digest-only deployment of a main-branch build) can be deleted. Protect those by promoting them to a release tag, or by adding a rule, before you apply.

> [!warning] Artifact Registry syntax and dry-run behaviour are not verified
> The JSON field names, the interaction between Keep and Delete rules, the `--dry-run` flag and where dry-run results are reported were written from memory of the Artifact Registry cleanup policy feature and were not checked against current documentation. Read the current reference, and test on a scratch repository, before you apply a policy to a repository that holds anything you care about.

### Artifactory

Artifactory dev repositories need a cleanup too, with one hard rule: never delete an item that has the `prod-promoted` property. The promotion job sets that property on the artifact in every repository it was copied from, so cleanup of the dev copy cannot remove something that reached production.

```bash
# In the promote-prod job, after build-promote succeeds. Marks the dev and staging copies.
# change: "docker-*-local/" is the repository pattern that holds the dev and staging copies.
jf rt set-props "docker-*-local/" "prod-promoted=true" \
  --build="${JFROG_CLI_BUILD_NAME}/${JFROG_CLI_BUILD_NUMBER}"
```

A scheduled cleanup then selects only unmarked, old items. Keep the query in a file in version control.

```json title="cleanup-dev.aql.json"
{
  "files": [
    {
      "aql": {
        "items.find": {
          "repo": "docker-dev-local",
          "type": "file",
          "created": { "$before": "30d" },
          "$and": [{ "@prod-promoted": { "$nmatch": "*" } }]
        }
      }
    }
  ]
}
```

```bash
export JFROG_URL="https://artifactory.example.com"
# JFROG_ACCESS_TOKEN comes from a masked, protected CI variable with delete rights on the dev repo only.

# Dry run: lists what would be deleted.
jf rt del --spec=cleanup-dev.aql.json --dry-run
```

Delete only after the output has been reviewed (see the next section). Use a token that can delete in the dev repository and nowhere else, so a bug in the query cannot reach prod.

> [!warning] Artifactory features and defaults are not verified
> Cleanup and retention policies, the AQL property match operators, `jf rt set-props --build` and the `--dry-run` flag depend on your Artifactory version and license. Instance defaults for retention were not checked either. Confirm each on a test repository, and read the version of the JFrog documentation that matches your instance.

## Dry run before deletion

Every new or changed cleanup rule runs in dry-run mode first, and a person reads the result. Look for three things: the count is in the range you expected, no release or promoted item is in the list, and nothing the clusters run is in the list.

The last check compares the image digests that are actually running with what exists in the registry. It must pass before cleanup is enabled, and it is worth running on a schedule as a canary for accidental deletion.

```bash
#!/usr/bin/env bash
set -euo pipefail

# Contexts of the clusters to check. Change to your contexts.
CONTEXTS=("gke_example-prod-project_europe-west1_prod-eu")
REGISTRY_PREFIX="europe-west1-docker.pkg.dev/example-prod-project/containers" # change

missing=0
for ctx in "${CONTEXTS[@]}"; do
  # Unique image digests of all containers (including init containers) in all namespaces.
  mapfile -t refs < <(
    kubectl --context "$ctx" get pods -A -o json |
      jq -r '.. | .imageID? // empty' |
      sed -E 's#^(docker-pullable|containerd)://##' |
      { grep -F "$REGISTRY_PREFIX" || true; } | sort -u
  )
  for ref in "${refs[@]}"; do
    if ! gcloud artifacts docker images describe "$ref" >/dev/null 2>&1; then
      echo "MISSING: $ref (running in $ctx)" >&2
      missing=1
    fi
  done
done

if [[ "$missing" -ne 0 ]]; then
  echo "Some running images no longer exist in the registry. Stop cleanup." >&2
  exit 1
fi
echo "OK: every running digest under ${REGISTRY_PREFIX} exists"
```

Run it before enabling a policy and after every change to one. For images in Artifactory, replace the `gcloud` call with a `jf rt search` or an HTTP HEAD request on the manifest. The script checks images in the running Pods only. Images that a Helm release, a CronJob that is currently scaled to zero, or a rollback target refer to also matter; include them from your GitOps repository if you can list them.

## Auditing deletions

Deletions must leave a trail so that "why is this image gone" has an answer.

- Keep cleanup rules in Git, reviewed like other infrastructure code (see [[code-review]]), so every change to a retention period has an author and a reason.
- Turn on audit logging for the stores that support it. Cloud Audit Logs Admin Activity covers Artifact Registry and bucket configuration changes; object deletions made by users and jobs in Cloud Storage need Data Access logs enabled, which cost money, so enable them on the artifact buckets deliberately. Deletions made by a bucket lifecycle rule are not recorded in Cloud Audit Logs (not verified for your version; check the lifecycle documentation). Use Pub/Sub notifications for Cloud Storage (`OBJECT_DELETE` events) or usage logs if you need a record of lifecycle deletions. Artifactory records deletions in its own audit and request logs.
- Have each scheduled cleanup job write its list of deleted items (the dry-run output with a timestamp) to the evidence location. Retention for that list follows [[audit-evidence-collection-and-retention]].
- Alert on a delete count far above the normal range, for example ten times the weekly average, so a bad query is caught after one run and not after ten.

## Exceptions

Some artifacts need to stay beyond the default: a customer-reported bug that needs a reproduction, an artifact under legal hold, a base image that a long-lived branch still builds from.

- Mark the artifact so cleanup skips it (an Artifactory property such as `retain-until=2027-03-31`, or a tag in Artifact Registry that a Keep rule matches), with the owner and reason recorded in the ticket.
- Every exception has an expiry date. An exception without one is a permanent decision made without a review.
- Legal holds override this standard and are managed by the people who own the hold, not by the platform team. The platform team's job is to make the marker honoured by every cleanup rule.
- Record exceptions using [[policy-exception-and-waiver-process]].

## Related notes

- [[artifact-promotion-artifactory]]: how artifacts move between repositories and get the promotion marker.
- [[gitlab-ci-pipeline-structure]]: where `artifacts:expire_in` and the promotion jobs fit in a pipeline.
- [[audit-evidence-collection-and-retention]]: retention and proof requirements for audit evidence.
- [[finops-cost-allocation-and-guardrails]]: tracking storage cost and reviewing it monthly.
