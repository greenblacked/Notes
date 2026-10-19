---
title: One primary and one DR region per environment
description: Proposal to fix a primary and a DR region for each environment, chosen for data residency and service availability, and pin resources to them.
type: adr
tags:
  - adr
  - gcp
  - reliability
  - compliance
status: proposed
created: 2026-10-19
modified: 2026-10-19
draft: false
aliases:
  - ADR-0028
---

## Context

Regions have been picked per project, usually whichever the engineer who created it preferred. The result is production workloads in several regions without a plan, a disaster recovery story that depends on which project you ask about, and no way to answer a customer who asks where their data lives. Not every Google Cloud service or machine shape is available in every region, and cross-region traffic is billed, so scattered placement also costs money.

> [!warning] Not legal or audit advice
> Data residency is a compliance question. This record describes an engineering control. Your legal and compliance functions decide which regions are acceptable for which data.

## Decision

Proposed: each environment has **one primary region and one DR region**, fixed in configuration, and resources are pinned to them.

- **Owner:** the platform team proposes; the compliance function approves the allowed locations.
- **Trigger to close:** the residency requirement is written down (which data classes may live where), and GKE, Cloud SQL and Cloud Storage availability in the candidate pair has been checked. Decide at the next DR review ([[disaster-recovery-tiers-rpo-rto]]).

Proposed shape:

- Regions are Terraform variables per environment, not literals in modules.
- An organization policy restricts resource locations on the environment's folder (`gcp.resourceLocations`, see [[gcp-organization-policy-guardrails]]), so a resource cannot be created elsewhere by accident.
- The DR region pairing is chosen for service availability and network latency, and fits the tier's RPO and RTO.
- Cross-region replication (Cloud SQL replicas, bucket location choices, image replication) is designed per data class, with the egress cost estimated before enabling it.
- Non-production environments may use a single region when their tier allows it; the exception is recorded.

```hcl title="environments/prod/regions.tf"
variable "primary_region" {
  type    = string
  default = "europe-west1"
}

variable "dr_region" {
  type    = string
  default = "europe-west4"
}
```

```hcl title="environments/prod/location-policy.tf"
resource "google_org_policy_policy" "allowed_locations" {
  name   = "folders/345678901234/policies/gcp.resourceLocations"
  parent = "folders/345678901234"

  spec {
    rules {
      values {
        allowed_values = ["in:eu-locations"]
      }
    }
  }
}
```

The region names and the value group above are examples; choose the pair from your own requirements.

> [!info] Claims not checked against current docs
> The `gcp.resourceLocations` constraint name and value-group syntax, which services support location restriction, regional product availability, and inter-region egress pricing. Check the locations page and the resource location restriction documentation.

Open questions that keep this proposed:

- The actual residency requirement and which data classes it covers.
- Whether the DR region is warm (running) or cold (restored on demand), which drives cost.

## Consequences

If accepted:

- Placement becomes a reviewed decision and a policy-enforced one, which also gives a clear answer to residency questions.
- DR exercises ([[0051-backups-proven-by-quarterly-restore-drills]]) target a known region.
- Capacity, quotas and reservations only need to be planned for two regions.

Costs:

- Teams lose free choice of region; a service that needs a product not available in the pair needs an exception.
- The location policy can block legitimate resources (some global services, multi-region buckets) and needs careful scoping.
- Keeping a DR region warm costs money; keeping it cold costs time.

## Alternatives considered

- **Region chosen per project.** The status quo; no DR story and no residency answer.
- **Multi-region active-active.** Strongest availability, much higher complexity and cost; reconsider for tier-1 services only.
- **Single region per environment with backups elsewhere.** Cheaper, acceptable for lower tiers; survives data loss but not a prolonged regional outage.

## Validation

If accepted:

```bash
set -o pipefail
PROJECT_ID="example-prod"
FOLDER_ID="345678901234"

# Location policy in force on the folder
gcloud org-policies describe gcp.resourceLocations --folder="${FOLDER_ID}"

# GKE clusters and Cloud SQL instances by region (review: only primary and DR)
gcloud container clusters list --project="${PROJECT_ID}" --format="table(name, location)"
gcloud sql instances list --project="${PROJECT_ID}" --format="table(name, region)"
```

## References

- Google Cloud locations: https://cloud.google.com/about/locations
- Restricting resource locations: https://cloud.google.com/resource-manager/docs/organization-policy/defining-locations
- Related notes: [[disaster-recovery-tiers-rpo-rto]], [[environment-separation-on-gcp]], [[pci-dss-and-gdpr-for-devops-logs-and-data]]
- Related ADRs: [[0027-cloud-sql-for-production-postgres]], [[0051-backups-proven-by-quarterly-restore-drills]]
