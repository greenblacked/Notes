---
title: Cloud DNS zones in a platform project
description: Public and private zones are created centrally with delegated child zones and DNS peering, so names are managed in one reviewed place.
type: adr
tags:
  - adr
  - gcp
  - networking
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0029
---

## Context

DNS zones were created in whichever project needed a name. The same domain appeared in several projects, private zones were attached to individual VPCs, and nobody could say who was authoritative for `example.com` or its subdomains. Changes were made in the console, a stale record was once left pointing at a released IP address, and DNSSEC was inconsistent across zones.

DNS is shared infrastructure with a large blast radius: one wrong record can take a service offline, and a dangling record can enable subdomain takeover.

## Decision

Authoritative Cloud DNS zones live in **one platform DNS project**, managed in Terraform, with delegation to child zones where a team needs autonomy.

- The platform DNS project owns the public zone for `example.com` and the private zones used by the Shared VPC ([[0025-shared-vpc-host-project-no-default-networks]]). See [[cloud-dns-hybrid-and-multi-project]] for the multi-project mechanics.
- Teams that need to manage a subdomain receive a **delegated child zone** (NS records in the parent) in their own project, for example `payments.example.com`. Everything else is a record change in the platform repository.
- **Private zones** are bound to the Shared VPC networks; **DNS peering** exposes them to other VPCs where needed, rather than copying zones.
- **DNSSEC** is enabled on public zones. Check the current Cloud DNS documentation for key rotation and the DS record handover to the registrar, which stays a deliberate manual step.
- Record changes go through merge requests with CODEOWNERS review; console edits on managed zones are detected as drift.
- Certificate validation and ExternalDNS: ExternalDNS gets write access only to its delegated child zone, never to the parent ([[tls-certificate-renewal]]).

```hcl title="dns.tf"
resource "google_dns_managed_zone" "public" {
  project  = "example-dns"
  name     = "example-com"
  dns_name = "example.com."

  dnssec_config {
    state = "on"
  }
}

resource "google_dns_record_set" "checkout" {
  project      = "example-dns"
  managed_zone = google_dns_managed_zone.public.name
  name         = "checkout.example.com."
  type         = "A"
  ttl          = 300
  rrdatas      = ["192.0.2.10"]
}
```

> [!info] Claims not checked against current docs
> DNSSEC algorithm and key rotation behaviour on Cloud DNS, the IAM roles needed for delegated zones and ExternalDNS, and zone and record quotas. Check the Cloud DNS documentation.

## Consequences

Easier:

- One place to answer "who is authoritative for this name" and to review a change.
- Dangling-record cleanup and DNSSEC are consistent across zones.
- Delegation gives teams autonomy without handing out access to the parent zone.

Harder or newly required:

- The platform team is a review bottleneck for parent-zone changes; mitigated by delegation and small, templated records.
- Delegation mistakes (wrong NS records) cause outages, so they are validated in CI and after apply.
- Hybrid setups (on-premises resolvers) need explicit forwarding and peering design.
- Low TTLs ease change but increase query volume; choose TTLs per record type.

## Alternatives considered

- **Zones in each project.** Fast for teams, but no single authority and duplicate names. Rejected.
- **An external DNS provider.** Valid, with strong tooling, but it splits identity and audit away from Google Cloud IAM and adds a vendor. Revisit if multi-cloud becomes real.
- **One flat zone with team-wide write access.** Fewer moving parts, but any editor can break any name. Rejected.

## Validation

```bash
set -o pipefail
DNS_PROJECT="example-dns"

# Zones in the platform project, with DNSSEC state
gcloud dns managed-zones list --project="${DNS_PROJECT}" \
  --format="table(name, dnsName, visibility, dnssecConfig.state)"

# Delegation resolves from the root down
dig +trace checkout.example.com

# DNSSEC chain is valid
dig +dnssec example.com SOA

# Zones outside the platform project (review each one)
for p in $(gcloud projects list --format='value(projectId)'); do
  gcloud dns managed-zones list --project="${p}" --format="value(dnsName)" 2>/dev/null \
    | sed "s|^|${p}: |"
done
```

## References

- Cloud DNS zones overview: https://cloud.google.com/dns/docs/zones/zones-overview
- DNSSEC in Cloud DNS: https://cloud.google.com/dns/docs/dnssec
- Related notes: [[cloud-dns-hybrid-and-multi-project]], [[shared-vpc-hub-and-spoke]], [[dns-resolution]]
- Related ADRs: [[0025-shared-vpc-host-project-no-default-networks]]
