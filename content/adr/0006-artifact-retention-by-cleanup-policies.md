---
title: Artifact retention is enforced by repository cleanup policies
description: Dev and snapshot artifacts expire automatically by age and last download, and released or promoted artifacts are kept.
type: adr
tags:
  - adr
  - artifactory
  - cost
  - supply-chain
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0006
---

## Context

Artifact storage only grows. Every merge request pipeline pushes snapshots, images and build info, and nobody deletes them. The effects are predictable: storage cost climbs, scans spend time on artifacts that will never be deployed, and repository listings become too large to browse.

Manual cleanup has been tried and fails in two ways. It is done rarely and in a rush, and it sometimes deletes something a running release still needs. We want retention to be automatic, predictable and safe by construction.

## Decision

We will enforce retention with **automated cleanup policies per repository class**, with explicit exclusions that protect anything released.

| Repository class                     | Rule                               | Notes                                         |
| ------------------------------------ | ---------------------------------- | --------------------------------------------- |
| `*-dev-local`, snapshot repositories | Delete by age and by last download | Short retention, run frequently               |
| `*-stage-local`                      | Delete by age, longer than dev     | Keep the last N promoted versions per project |
| `*-prod-local`                       | **Never auto-deleted**             | Removal is a reviewed, manual operation       |
| Remote (cache) repositories          | Evict by last download             | Cache can always be refilled from upstream    |

The numbers (days, versions to keep) live in [[artifact-retention-policy]], not here, so they can change without a new decision.

Safety rules that hold regardless of the numbers:

- **Never delete** anything in `prod-local`, anything referenced by a live release or a GitOps manifest, or build info that is still referenced by a retained artifact.
- **Dry run first.** Every new or changed policy is enabled in a mode that only reports candidates, and a human reviews the candidate list before deletion is switched on.
- **Deletions are logged.** The policy run history is retained and exported to the central log pipeline ([[0044-central-log-sinks-and-retention-tiers]]).
- The retention numbers account for how long rollbacks must remain possible: images behind the previous digests in [[0048-rollback-by-redeploying-previous-digest]] must outlive the rollback window.
- Cost effect is tracked together with other storage in [[finops-cost-allocation-and-guardrails]].

> [!info] Not checked against current docs
> Not verified for this record: the exact cleanup policy features, conditions and dry-run behaviour in our Artifactory version, and the AQL syntax in the validation block. Check the JFrog cleanup policies documentation and test on a copy of a repository first.

## Consequences

Easier:

- Storage and scan cost stay bounded without anyone remembering to clean up.
- Repositories stay browsable, and listings stay fast.
- The policy is reviewable code or configuration with a history, not tribal knowledge.

Harder or newly required:

- An old dev build can no longer be reproduced from the store. To rebuild, check out the tag and build again; pipelines must therefore stay reproducible, with pinned dependencies resolved through the store ([[0007-language-packages-resolve-through-artifactory]]).
- Someone must own the policy configuration and review the dry-run output when it changes.
- A misconfigured policy can delete data. The dry run, the exclusions and the backup of the store ([[0011-artifactory-hosting-saas-or-self-managed]]) are the mitigations; test restores matter.
- Teams that depend on keeping a stage artifact longer must ask for an exception rather than relying on luck.

## Alternatives considered

- **Manual cleanup.** Rejected: irregular, error-prone and unowned.
- **Keep everything.** The safest for reproducibility and the worst for cost and scan time. Rejected, except for `prod-local`, which is kept deliberately.
- **A custom script that deletes via the API.** Flexible, but it is code we would have to secure, schedule and monitor, and it duplicates a built-in feature. Acceptable only for a rule the product cannot express.

## Validation

List the candidates a dev-repository rule would delete before enabling it. Set the variables first. The AQL below is a sketch of the query shape; confirm the field names against the AQL reference for your version.

```bash title="dry-run-candidates.sh"
set -o pipefail
AF_URL="https://artifactory.example.com"
AF_TOKEN="${AF_TOKEN:?set a read token}"

curl -fsS -X POST \
  -H "Authorization: Bearer ${AF_TOKEN}" \
  -H "Content-Type: text/plain" \
  "${AF_URL}/artifactory/api/search/aql" \
  -d 'items.find({
        "repo": "payments-docker-dev-local",
        "created": {"$before": "30d"},
        "stat.downloaded": {"$before": "30d"}
      }).include("repo","path","name","size")' \
  | jq -r '.results[] | "\(.repo)/\(.path)/\(.name)\t\(.size)"' | head -50
```

Confirm nothing in prod is a candidate. The same query against `payments-docker-prod-local` must not be wired to any delete job:

```bash title="list-prod-repositories.sh"
# Lists the prod repositories. Compare them by hand against the cleanup policy list:
# no policy may include a *-prod-local repository (query the cleanup-policy API for your version to automate this).
curl -fsS -H "Authorization: Bearer ${AF_TOKEN}" \
  "${AF_URL}/artifactory/api/repositories" | jq -r '.[].key' | grep -- '-prod-local$'
```

## References

- JFrog cleanup policies documentation: https://jfrog.com/help/r/jfrog-artifactory-documentation (verify the cleanup policies page for your version)

Related notes:

- [[artifact-retention-policy]]
- [[finops-cost-allocation-and-guardrails]]
- [[0004-build-once-promote-between-repositories]]
- [[0010-deploy-images-by-digest]]
