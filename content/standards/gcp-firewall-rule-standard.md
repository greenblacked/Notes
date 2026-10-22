---
title: GCP firewall rule standard
description: Where GCP firewall policies and rules live, how they target, prioritise, name, log and expire, with Terraform, CI checks and audit commands.
type: standard
tags:
  - standards
  - gcp
  - networking
  - security
  - terraform
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Firewall findings on Google Cloud look the same in almost every review: an ingress rule from `0.0.0.0/0` that someone opened for a test, rules that target a network tag any instance editor can add, no logging so nobody knows whether a rule is used, and no owner or end date on anything. Each rule made sense on the day it was written; together they are an attack surface nobody can explain. This standard says where a rule may live, how it selects its targets, which priority band it uses, how it is named and described, when it is logged, how temporary rules expire, and how rules are audited and rolled back. The network topology is in [[shared-vpc-hub-and-spoke]]; this note is the rule book for what goes into it.

## Scope

- **Hierarchical firewall policies** attached to the organization or a folder.
- **Network firewall policies** (global and regional) attached to a VPC network.
- **VPC firewall rules** (the classic per-network rules), which we keep only where a policy cannot do the job.

It does not cover Kubernetes NetworkPolicies inside a cluster ([[kubernetes-network-policies]] and [[0020-default-deny-network-policies]]), Cloud Armor and edge rules ([[edge-waf-rate-limiting]]), or VPC Service Controls perimeters ([[zero-trust-access-iap-and-vpc-service-controls]]). Those are layers next to this one, not replacements for it.

> [!info] Check the current docs
> Field names, priority ranges and defaults below come from the `gcloud` help and the Terraform Google provider documentation, linked in Sources. The evaluation order between hierarchical policies, network policies and VPC rules, the implied rules, the Google source ranges, logging cost and Firewall Insights behaviour were **not verified** against the [firewall documentation](https://cloud.google.com/firewall/docs/firewalls) for this note; each is flagged where it is used. Priority bands, naming patterns and thresholds are **proposed team defaults**.

## Principles

1. **Deny by default, in both directions.** Ingress is denied unless a rule allows it. Egress from production is denied unless a rule allows it, once flow data shows what is needed (see Egress below).
2. **Allow narrowly.** Each allow names a source, a target, a protocol and ports. "All protocols" and "all ports" need an exception.
3. **Target by identity, not by tag.** Rules select instances by service account (or by a resource manager secure tag) rather than by network tag. A network tag is a free-form string on the instance; anyone who can edit the instance can add it and inherit every rule that targets it. Attaching a service account to an instance needs IAM permission on that account, which we already control. (This rationale is the commonly given one; the Google page on [service accounts versus tags](https://cloud.google.com/firewall/docs/firewalls#service-accounts-vs-tags) was not re-read for this note.)
4. **One place per kind of rule.** Guardrails at the organization or folder, workload rules in the network policy of the host project. Nothing ad hoc.
5. **Every rule has an owner and a reason**, and every temporary rule has an end date.
6. **Rules are code.** Terraform in the network repository, through the plan gate in [[0035-terraform-plan-policy-gate-and-ci-only-apply]]. Console changes are incidents.

## Where rules live

| Layer                                  | What goes there                                                                                             | Owner                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Organization hierarchical policy       | Rules that must hold everywhere: deny known-bad ranges, allow IAP to administrative ports, then `goto_next` | Security and platform                     |
| Folder hierarchical policy             | Environment guardrails, for example production cannot accept traffic from non-production ranges             | Platform                                  |
| Network firewall policy (host project) | All workload rules for a Shared VPC: who may reach which service, and the explicit default deny             | Platform, with service teams as reviewers |
| VPC firewall rules                     | Only rules created by Google services (do not edit them) and exceptions a policy cannot express             | Platform                                  |

- **Shared VPC.** The host project owns the networks and the firewall policy, per [[0025-shared-vpc-host-project-no-default-networks]]. Service projects do not get firewall rights on the shared network. A team that needs a new path opens a merge request against the network repository.
- **`goto_next`.** A hierarchical policy rule can `allow`, `deny` or `goto_next`, which hands the decision to the next level. An `allow` at the organization is terminal for every network below it, so organization-level allows stay rare and narrow. `apply_security_profile_group` also exists, for inspection; it is out of scope here.
- **Policies versus VPC rules.** A network has a setting for whether its network firewall policies are evaluated before or after its VPC firewall rules (`network_firewall_policy_enforcement_order`, default `AFTER_CLASSIC_FIREWALL`, alternative `BEFORE_CLASSIC_FIREWALL`, per the Terraform `google_compute_network` docs). With the default, a broad VPC rule can decide a connection before the policy is consulted. That is why hand-written VPC rules are forbidden on policy-managed networks. The complete evaluation order across all levels is not verified here; read the [firewall policies overview](https://cloud.google.com/firewall/docs/firewall-policies-overview) before changing the setting, and test with Connectivity Tests.

> [!warning] Implied rules are not verified
> VPC networks are commonly documented as having an implied "deny all ingress" and "allow all egress" at the lowest priority, which cannot be removed or logged. That was not confirmed for this note. Do not rely on implied rules: every policy ends with an **explicit**, **logged** deny-all ingress rule, and production policies also end with an explicit deny-all egress rule once egress allows are in place. An explicit rule is visible in reviews and in logs; an implied one is not.

## Priority bands

Lower numbers win. In a VPC firewall rule the priority is 0 to 65535, default 1000, and a `DENY` wins over an `ALLOW` at the same priority. In a network or hierarchical policy rule the priority is 0 to 2147483647 and is also the rule's identifier inside the policy, so changing a priority replaces the rule.

| Band (policy rules, proposed default) | Use                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| 100 to 999                            | Emergency rules during an incident (block a source). Removed in the postmortem  |
| 1000 to 9999                          | Platform denies: known-bad ranges, non-production to production, metadata abuse |
| 10000 to 19999                        | Platform allows: load balancer health checks, IAP, monitoring, DNS              |
| 20000 to 899999                       | Service allows, in blocks of 1000 per service so related rules sit together     |
| 900000 to 999999                      | Temporary rules with an expiry                                                  |
| 2000000000                            | Explicit deny-all egress (production), logged                                   |
| 2147483000                            | Explicit deny-all ingress, logged                                               |

Keep the same bands, scaled down, if you must write VPC firewall rules: 100 to 999 emergency, 1000 to 9999 platform, 10000 to 59999 services, 65000 explicit deny all.

## Naming and description

Policy rules have an optional `rule_name` that is not unique and can be changed; VPC firewall rules have a `name` that is 1 to 63 characters, matches `[a-z]([-a-z0-9]*[a-z0-9])?` and cannot be changed. We use one pattern for both:

```text
<env>-<direction>-<action>-<source>-to-<target>-<protocol><ports>

prod-ingress-allow-gclb-hc-to-orders-api-tcp8080
prod-ingress-allow-iap-to-bastion-tcp22
prod-egress-allow-orders-api-to-payments-tcp443
prod-ingress-deny-all
```

The `description` carries machine-readable fields, separated by semicolons, so the audit can parse them:

```text
owner=team-orders; ticket=CHG-1234; reason=GCLB health checks for orders-api; expires=never
```

- `owner` is a team alias, never a person.
- `ticket` is the change or request that justified the rule.
- `expires` is `never` for permanent rules or an ISO date (`2026-11-30`) for temporary ones.

The maximum length of `description` was not verified; keep it under 200 characters. Firewall rules and policy rules cannot carry labels, which is why ownership lives in the description. See [[gcp-resource-naming-and-labels-standard]] for the rest of the naming scheme.

## Required properties

Every rule MUST satisfy the following. The CI check below enforces the first five.

1. **A target.** A policy rule sets `target_service_accounts` or `target_secure_tags`; a VPC rule sets `target_service_accounts`. A rule without a target applies to every instance on the network, which is allowed only for the explicit deny-all rules and platform-wide denies. `target_secure_tags` cannot be combined with `target_service_accounts` in a policy rule, and in a VPC rule service accounts cannot be combined with tags, so the choice is per rule.
2. **No network tags** in new rules (`target_tags`, `source_tags`). Existing tag-based rules are migrated when touched.
3. **No `0.0.0.0/0` (or `::/0`) source on ingress**, except to the serving ports of an external load balancer's backends where the load balancer itself does not proxy, which needs an exception. For proxied Google load balancers, the backends receive connections from Google's proxy and health-check ranges rather than from clients, so allow those ranges instead (check the ranges per load balancer type; not verified here).
4. **Explicit ports.** `ip_protocol = "all"` or a missing `ports` list on an allow rule needs an exception.
5. **Owner, ticket and expiry** in the description, in the format above.
6. **Logging** as in the logging section.
7. **No allow from non-production ranges to production targets.** The folder guardrail denies it; a service rule must not try.

### Google source ranges

Health checks, proxied load balancers and IAP TCP forwarding connect from Google-owned ranges. Existing notes and Google-maintained Terraform modules use `35.191.0.0/16` and `130.211.0.0/22` for health checks and `35.235.240.0/20` for IAP TCP forwarding; the Cloud Foundation Fabric firewall module lists two more health-check ranges (`209.85.152.0/22`, `209.85.204.0/22`) for some load balancer types. These lists differ by load balancer type and can change.

> [!warning] Take the ranges from the documentation
> The ranges above were **not verified** against the [health check documentation](https://cloud.google.com/load-balancing/docs/health-check-concepts#ip-ranges) or the [IAP TCP forwarding documentation](https://cloud.google.com/iap/docs/using-tcp-forwarding) for this note. Keep them in one Terraform variable owned by the platform team, sourced from those pages per load balancer type, and review it every quarter. Never copy a range into a service rule by hand.

## Logging

Firewall rule logging is **off by default** (`gcloud compute firewall-rules create --help`). Logs go to Cloud Logging. Our rules:

| Rule type                                                 | Logging (proposed default)                                |
| --------------------------------------------------------- | --------------------------------------------------------- |
| Explicit deny-all ingress and egress                      | MUST, metadata excluded                                   |
| Platform denies and emergency rules                       | MUST                                                      |
| Allows to targets holding confidential or restricted data | MUST                                                      |
| Temporary rules                                           | MUST, so expiry decisions use evidence                    |
| Other service allows                                      | SHOULD for 30 days after creation, then off unless needed |
| Health check allows                                       | MAY; they are high-volume and rarely informative          |

Logging has a cost in Cloud Logging volume. The trade-off is evidence (is this rule used, who hits this deny) against ingestion volume; size it from your own log volume, not from a guess. The metadata option (`INCLUDE_ALL_METADATA` or `EXCLUDE_ALL_METADATA` for VPC rules, `--logging-metadata` in `gcloud`) changes log size; how much was not verified. `enable_logging` cannot be set on `goto_next` policy rules. Logging pricing and sampling were not verified; see [Firewall Rules Logging](https://cloud.google.com/firewall/docs/firewall-rules-logging). Route the logs with the sinks in [[logging-architecture-gke-and-cloud-logging]].

## Egress

Egress control is where firewall policy meets [[private-gke-and-controlled-egress]]. The order of work:

1. Turn on logging on a temporary "allow all egress" rule (or use VPC Flow Logs on the subnets, `gcloud compute networks subnets update --enable-flow-logs`) for two weeks.
2. Write allows for what is actually needed: Google APIs through Private Google Access, the NAT path for named external services, internal services.
3. Add the explicit deny-all egress rule in a non-production network first, watch for a week, then production.

Egress denies break things quietly (a node cannot reach an API, a job hangs on DNS). Do it per environment with a rollback ready.

## Expiry of temporary rules

There is no native expiry field on a firewall rule. Expiry is our convention: an `expires=` date in the description, checked in two places.

- **In CI,** the plan check fails when a rule's `expires` date is in the past or more than 90 days ahead (proposed default, matching the waiver maximum in [[policy-exception-and-waiver-process]]).
- **Daily,** a scheduled job lists live rules and opens a ticket for each rule that expires within 7 days, and for each that has expired. An expired rule is disabled by the platform team after the owner has been told, and deleted a week later.

## Terraform example

A global network firewall policy in the Shared VPC host project, attached to the production network, with a health-check allow, an IAP allow, a temporary rule and the explicit deny. Values are examples.

```hcl title="network/prod/firewall.tf"
locals {
  host_project = "acme-net-prod"
  network_id   = "projects/acme-net-prod/global/networks/prod-shared-vpc"

  # Owned by the platform team. Take the ranges from the Google documentation for each
  # load balancer type and IAP; the values below are NOT verified for this note.
  gclb_health_check_ranges = ["35.191.0.0/16", "130.211.0.0/22"]
  iap_tcp_forwarding_range = ["35.235.240.0/20"]

  orders_api_sa = "orders-api-runtime@acme-orders-prod.iam.gserviceaccount.com"
  bastion_sa    = "bastion@acme-net-prod.iam.gserviceaccount.com"
}

resource "google_compute_network_firewall_policy" "prod" {
  project     = local.host_project
  name        = "prod-workloads"
  description = "owner=team-platform; ticket=CHG-1000; reason=workload rules for prod-shared-vpc; expires=never"
}

resource "google_compute_network_firewall_policy_association" "prod" {
  project           = local.host_project
  name              = "prod-workloads-on-prod-shared-vpc"
  firewall_policy   = google_compute_network_firewall_policy.prod.id
  attachment_target = local.network_id
}

resource "google_compute_network_firewall_policy_rule" "hc_to_orders_api" {
  project                 = local.host_project
  firewall_policy         = google_compute_network_firewall_policy.prod.name
  priority                = 10100
  rule_name               = "prod-ingress-allow-gclb-hc-to-orders-api-tcp8080"
  description             = "owner=team-orders; ticket=CHG-1234; reason=GCLB health checks and proxies for orders-api; expires=never"
  direction               = "INGRESS"
  action                  = "allow"
  enable_logging          = false
  target_service_accounts = [local.orders_api_sa]

  match {
    src_ip_ranges = local.gclb_health_check_ranges
    layer4_configs {
      ip_protocol = "tcp"
      ports       = ["8080"]
    }
  }
}

resource "google_compute_network_firewall_policy_rule" "iap_to_bastion" {
  project                 = local.host_project
  firewall_policy         = google_compute_network_firewall_policy.prod.name
  priority                = 10200
  rule_name               = "prod-ingress-allow-iap-to-bastion-tcp22"
  description             = "owner=team-platform; ticket=CHG-1001; reason=IAP TCP forwarding to the bastion only; expires=never"
  direction               = "INGRESS"
  action                  = "allow"
  enable_logging          = true
  target_service_accounts = [local.bastion_sa]

  match {
    src_ip_ranges = local.iap_tcp_forwarding_range
    layer4_configs {
      ip_protocol = "tcp"
      ports       = ["22"]
    }
  }
}

# Temporary: a partner range for a migration. Expires and is logged.
resource "google_compute_network_firewall_policy_rule" "partner_migration" {
  project                 = local.host_project
  firewall_policy         = google_compute_network_firewall_policy.prod.name
  priority                = 900100
  rule_name               = "prod-ingress-allow-partner-to-orders-api-tcp8443"
  description             = "owner=team-orders; ticket=CHG-1301; reason=partner data migration; expires=2026-11-30"
  direction               = "INGRESS"
  action                  = "allow"
  enable_logging          = true
  target_service_accounts = [local.orders_api_sa]

  match {
    src_ip_ranges = ["203.0.113.0/28"]
    layer4_configs {
      ip_protocol = "tcp"
      ports       = ["8443"]
    }
  }
}

resource "google_compute_network_firewall_policy_rule" "deny_all_ingress" {
  project         = local.host_project
  firewall_policy = google_compute_network_firewall_policy.prod.name
  priority        = 2147483000
  rule_name       = "prod-ingress-deny-all"
  description     = "owner=team-platform; ticket=CHG-1000; reason=explicit default deny; expires=never"
  direction       = "INGRESS"
  action          = "deny"
  enable_logging  = true

  match {
    src_ip_ranges = ["0.0.0.0/0"]
    layer4_configs {
      ip_protocol = "all"
    }
  }
}
```

> [!warning] Test the deny-all on a non-production network first
> A policy-level deny-all ingress applies to every instance on the network, including GKE nodes. Intra-cluster traffic, control plane to node traffic and health checks must be allowed before it, either by your own allow rules or by firewall rules that GKE manages. Which rules GKE creates, and how they interact with the enforcement order, was not verified for this note. Run Connectivity Tests for node-to-node, control plane to node and load balancer to node paths, and keep the rule disabled (`disabled = true`) until they pass. On dual-stack networks add the same rule for `::/0`.

Check the resource arguments against the provider version you pin: some examples in the provider documentation use the `google-beta` provider for newer match fields. Run `terraform plan` and a Connectivity Test before applying to production.

### CI check on the plan

```bash title="ci/check-firewall-plan.sh"
#!/usr/bin/env bash
set -euo pipefail
PLAN_JSON="${1:-plan.json}"          # terraform show -json tfplan > plan.json
TODAY="$(date -u +%F)"
MAX_EXPIRY="$(date -u -d '+90 days' +%F)"   # GNU date; on macOS: date -u -v+90d +%F

PROBLEMS="$(jq -r --arg today "$TODAY" --arg max "$MAX_EXPIRY" '
  .resource_changes[]
  | select(.type == "google_compute_network_firewall_policy_rule"
        or .type == "google_compute_firewall_policy_rule"
        or .type == "google_compute_firewall")
  | select(.change.actions | index("create") != null or index("update") != null)
  | .address as $addr | .change.after as $r
  | ($r.description // "") as $d
  | ([$d | capture("expires=(?<e>[0-9-]+|never)")? | .e] | first // "") as $exp
  | [
      (if ($d | test("owner=[a-z0-9-]+")) then empty else "no owner= in description" end),
      (if ($d | test("ticket=")) then empty else "no ticket= in description" end),
      (if $exp == "" then "no expires= in description"
       elif $exp == "never" then empty
       elif $exp < $today then "expired on \($exp)"
       elif $exp > $max then "expiry \($exp) is more than 90 days ahead"
       else empty end),
      (if (($r.target_tags // []) | length) > 0 or (($r.source_tags // []) | length) > 0
       then "uses network tags" else empty end),
      (if (($r.direction // "INGRESS") == "INGRESS")
          and ((($r.source_ranges // []) + ([$r.match[]?.src_ip_ranges[]?]))
               | any(. == "0.0.0.0/0" or . == "::/0"))
          and (($r.action // "") != "deny")
          and (($r.deny // []) | length) == 0
       then "allows ingress from anywhere" else empty end)
    ][]
  | "\($addr): \(.)"
' "$PLAN_JSON")"

if [[ -n "$PROBLEMS" ]]; then
  printf '%s\n' "$PROBLEMS" >&2
  exit 1
fi
echo "Firewall rules pass the standard."
```

The check reads the plan JSON, so it sees what Terraform will create, not what the author meant to write. Extend it for the ports rule and the logging table as your rule set grows. A rule that needs an exception (for example an allowed `0.0.0.0/0` to a passthrough load balancer backend) is skipped by an exception list read by the script, never by deleting the check.

## Auditing live rules

```bash title="audit-firewall.sh"
#!/usr/bin/env bash
set -euo pipefail
PROJECT="acme-net-prod"       # host project
POLICY="prod-workloads"       # global network firewall policy
NETWORK="prod-shared-vpc"
TODAY="$(date -u +%F)"

echo "== VPC firewall rules open to the internet (ingress, enabled)"
gcloud compute firewall-rules list --project="$PROJECT" --format=json \
  | jq -r '.[]
      | select((.direction // "INGRESS") == "INGRESS" and (.disabled // false) == false)
      | select((.sourceRanges // []) | any(. == "0.0.0.0/0" or . == "::/0"))
      | [.name, .network, ((.allowed // []) | tostring)] | @tsv'

echo "== VPC firewall rules using network tags or without logging"
gcloud compute firewall-rules list --project="$PROJECT" --format=json \
  | jq -r '.[]
      | select(((.targetTags // []) | length) > 0 or (.logConfig.enable // false) == false)
      | [.name, ((.targetTags // []) | join(",")), (.logConfig.enable // false | tostring)] | @tsv'

echo "== Policy rules that are expired or have no expiry"
gcloud compute network-firewall-policies describe "$POLICY" --global \
  --project="$PROJECT" --format=json \
  | jq -r --arg today "$TODAY" '.rules[]
      | (.description // "") as $d
      | ([$d | capture("expires=(?<e>[0-9-]+|never)")? | .e] | first // "missing") as $exp
      | select($exp == "missing" or ($exp != "never" and $exp < $today))
      | [(.priority | tostring), (.ruleName // ""), $exp] | @tsv'

echo "== Effective firewalls on the network (all levels)"
gcloud compute networks get-effective-firewalls "$NETWORK" --project="$PROJECT" --format=json \
  > "effective-firewalls-${NETWORK}-${TODAY}.json"
echo "Saved effective-firewalls-${NETWORK}-${TODAY}.json"
```

The `gcloud` commands and flags are from the installed `gcloud` help; the JSON field names (`sourceRanges`, `logConfig.enable`, `rules[].ruleName`) follow the Compute Engine API and were not checked against live output for this note. Run the script once by hand and adjust before scheduling it.

Two more tools for the quarterly review:

- **Firewall Insights** in Network Intelligence Center reports rules it considers shadowed, overly permissive or unused. List them with `gcloud recommender insights list --project="$PROJECT" --location=global --insight-type=google.compute.firewall.Insight`. Which insights need rule logging, and over what observation period, was not verified; see the [Firewall Insights overview](https://cloud.google.com/network-intelligence-center/docs/firewall-insights/concepts/overview).
- **Connectivity Tests** answer "would this packet be allowed, and by which rule" before and after a change, without sending traffic:

```bash title="connectivity-test.sh"
gcloud network-management connectivity-tests create orders-api-from-gclb \
  --project="acme-net-prod" \
  --source-ip-address="35.191.0.1" \
  --destination-instance="projects/acme-orders-prod/zones/europe-west1-b/instances/orders-api-1" \
  --protocol=TCP --destination-port=8080
gcloud network-management connectivity-tests describe orders-api-from-gclb --project="acme-net-prod"
```

The flags are from `gcloud network-management connectivity-tests create --help`. For GKE, `--destination-gke-pod` and `--source-gke-pod` exist; check the help for the expected format.

## Change and rollback

Every firewall change goes through [[production-change-checklist]]. Firewall-specific steps:

- **Pre-check.** Run a Connectivity Test for the path you are opening or closing, and save the effective firewalls output.
- **Prefer disable over delete.** A disabled rule is not enforced and traffic behaves as if it did not exist, but the rule and its history stay, so re-enabling is one command:

```bash title="Disable and re-enable"
# VPC firewall rule
gcloud compute firewall-rules update prod-ingress-allow-partner-to-orders-api-tcp8443 \
  --project=acme-net-prod --disabled
gcloud compute firewall-rules update prod-ingress-allow-partner-to-orders-api-tcp8443 \
  --project=acme-net-prod --no-disabled

# Network firewall policy rule (identified by priority)
gcloud compute network-firewall-policies rules update 900100 \
  --firewall-policy=prod-workloads --global-firewall-policy \
  --project=acme-net-prod --disabled
```

- **In Terraform** the same is `disabled = true`, merged and applied; use the `gcloud` form only during an incident, then reconcile Terraform the same day so the next apply does not undo it.
- **Removing an allow** is the risky direction: it can drop live traffic. Disable first, watch error rates and the deny-all log for the rule's sources for a day, then delete.
- **Post-check.** Repeat the Connectivity Test, and check the deny-all ingress log for new hits from expected sources.

## Exceptions

Exceptions (an internet-facing passthrough backend, a vendor appliance that needs network tags, a rule without ports) follow [[policy-exception-and-waiver-process]]: one rule, one reason, an owner and an expiry. The exception id goes in the rule description (`exception=EXC-42`), and the CI check reads the exception list.

## Reviewer checklist

- [ ] The rule is in the right layer: organization or folder guardrail, or the host project's network policy; no new VPC firewall rule without an exception.
- [ ] Targets a service account or secure tag; no network tags.
- [ ] Source is as narrow as possible; no `0.0.0.0/0` ingress without an exception; Google ranges come from the shared variable.
- [ ] Protocol and ports are explicit.
- [ ] Priority is in the right band and does not shadow or get shadowed by an existing rule (check the effective firewalls output).
- [ ] Name follows the pattern; the description has `owner`, `ticket`, `reason` and `expires`.
- [ ] Logging matches the logging table.
- [ ] Temporary rules expire within 90 days.
- [ ] A Connectivity Test result for the new path is in the merge request.
- [ ] The rollback (disable) is written in the change record.

## Sources

- [VPC firewall rules overview](https://cloud.google.com/firewall/docs/firewalls) (implied rules and targeting rationale not verified for this note)
- [Firewall policies overview](https://cloud.google.com/firewall/docs/firewall-policies-overview) and [hierarchical firewall policies](https://cloud.google.com/firewall/docs/firewall-policies) (evaluation order not verified)
- [Firewall Rules Logging](https://cloud.google.com/firewall/docs/firewall-rules-logging) (cost and fields not verified)
- [Health check source ranges](https://cloud.google.com/load-balancing/docs/health-check-concepts#ip-ranges) and [IAP TCP forwarding](https://cloud.google.com/iap/docs/using-tcp-forwarding) (ranges not verified)
- [Firewall Insights overview](https://cloud.google.com/network-intelligence-center/docs/firewall-insights/concepts/overview) (not verified)
- [`gcloud compute firewall-rules update`](https://cloud.google.com/sdk/gcloud/reference/compute/firewall-rules/update): `--disabled`, priority and logging flags
- Terraform Google provider: [`google_compute_firewall`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_firewall), [`google_compute_network_firewall_policy_rule`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_network_firewall_policy_rule), [`google_compute_network`](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_network)
- [Cloud Foundation Fabric `net-vpc-firewall` module](https://github.com/GoogleCloudPlatform/cloud-foundation-fabric/tree/master/modules/net-vpc-firewall): Google-maintained defaults for health-check and IAP ranges, used here only as corroboration

## Related

- [[shared-vpc-hub-and-spoke]] and [[0025-shared-vpc-host-project-no-default-networks]]: the topology and who owns the firewall.
- [[private-gke-and-controlled-egress]]: egress design for GKE.
- [[zero-trust-access-iap-and-vpc-service-controls]]: IAP and service perimeters.
- [[architecture/policy-guardrail-layers-org-to-admission]]: where firewall policy sits among the organisation-to-admission guardrail layers.
- [[kubernetes-network-policies]] and [[0020-default-deny-network-policies]]: the in-cluster layer.
- [[network-troubleshooting-dns-mtu-tls-load-balancers]]: when a path that should work does not.
