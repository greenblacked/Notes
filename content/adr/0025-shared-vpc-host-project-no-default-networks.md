---
title: Shared VPC host project and no default networks
description: A platform-owned host project holds VPCs and firewall policy, service projects use shared subnets, and organization policy blocks default networks.
type: adr
tags:
  - adr
  - gcp
  - networking
  - security
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0025
---

## Context

New projects arrive with a `default` network containing auto-mode subnets in every region and permissive firewall rules (for example SSH and RDP from anywhere, depending on how the project was created). The default Compute Engine and App Engine service accounts can also receive broad project roles automatically. Teams built their own VPCs and peered them ad hoc, which produced overlapping address ranges, firewall rules nobody owned, and no single place to see which flows were allowed.

We want one team accountable for address space and firewall policy, and application teams that can deploy into it without owning network infrastructure.

## Decision

All networks come from a **Shared VPC host project** owned by the platform team. Service projects attach to it and use shared subnets. Projects do not get a default network.

- The host project owns the VPCs, subnets, secondary ranges for GKE Pods and Services, Cloud NAT, routes and firewall policies. See [[shared-vpc-hub-and-spoke]] for the topology.
- Service projects receive **subnet-level** `roles/compute.networkUser` for the identities that need it: the project's deployers and the GKE service agents. Project-level grants on the host are not used.
- Firewall rules are written as firewall policies in the host project, in Terraform ([[0030-terraform-manages-gcp-infrastructure]]).
- Organization policy, set on the folders from [[0024-gcp-folders-by-policy-boundary]]:
  - `compute.skipDefaultNetworkCreation` so new projects have no default network.
  - `iam.automaticIamGrantsForDefaultServiceAccounts` so default service accounts do not get automatic editor-style roles.
- GKE clusters are private with controlled egress ([[private-gke-and-controlled-egress]]); IP ranges are allocated from a central plan, for example blocks of `10.0.0.0/8` assigned per environment.

```hcl title="org-policy.tf"
resource "google_org_policy_policy" "skip_default_network" {
  name   = "organizations/123456789012/policies/compute.skipDefaultNetworkCreation"
  parent = "organizations/123456789012"

  spec {
    rules {
      enforce = "TRUE"
    }
  }
}
```

> [!info] Claims not checked against current docs
> The constraint names above and whether they are current, the exact role names and service agent identities required for GKE on Shared VPC, and per-host-project quotas. Check the organization policy constraints list and the GKE Shared VPC guide.

## Consequences

Easier:

- One reviewed place for address planning and firewall policy; overlapping ranges stop happening.
- New projects start safe: no open default rules and no default network to forget.
- Network access for a team is a subnet-level grant that can be audited.

Harder or newly required:

- IAM is granted per subnet, which is more bookkeeping than project-wide roles; Terraform modules absorb it.
- Quotas and limits for networking resources concentrate on the host project and must be monitored.
- The host project is a high-value target and a shared failure domain; changes there follow the strictest review.
- Existing projects with default networks need a migration plan, not an overnight delete.

## Alternatives considered

- **A VPC per project with peering.** Maximum isolation, but peering does not scale operationally (non-transitive routing, overlapping ranges, scattered firewall policy). Rejected.
- **One flat network for everything.** Simple, but no blast-radius separation between environments. Rejected.
- **Default networks with tightened firewall rules.** Leaves auto-mode subnets and relies on every project staying disciplined. Rejected.

## Validation

```bash
set -o pipefail
HOST_PROJECT="example-net-host"
ORG_ID="123456789012"

# Projects attached to the host (expect only known service projects)
gcloud compute shared-vpc associated-projects list "${HOST_PROJECT}"

# Projects that still have a default network (review; none is good)
for p in $(gcloud projects list --format='value(projectId)'); do
  gcloud compute networks list --project="${p}" --filter='name=default' \
    --format="value(name)" 2>/dev/null | sed "s/^/${p}: /"
done

# Policy is enforced at the organization
gcloud org-policies describe compute.skipDefaultNetworkCreation --organization="${ORG_ID}"
```

## References

- Shared VPC: https://cloud.google.com/vpc/docs/shared-vpc
- GKE with Shared VPC: https://cloud.google.com/kubernetes-engine/docs/how-to/cluster-shared-vpc
- Organization policy constraints: https://cloud.google.com/resource-manager/docs/organization-policy/org-policy-constraints
- Related notes: [[shared-vpc-hub-and-spoke]], [[private-gke-and-controlled-egress]], [[gcp-organization-policy-guardrails]]
- Related ADRs: [[0024-gcp-folders-by-policy-boundary]], [[0029-cloud-dns-zones-in-a-platform-project]]
