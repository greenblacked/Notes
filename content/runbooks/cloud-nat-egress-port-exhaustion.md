---
title: Cloud NAT egress failures and port exhaustion
description: Prove outbound timeouts come from Cloud NAT, read port allocation and drops, and fix port exhaustion with port settings, NAT IPs and connection reuse.
type: runbook
tags:
  - runbooks
  - gcp
  - gke
  - networking
  - reliability
created: 2026-10-21
modified: 2026-10-21
draft: false
---

How to find and fix outbound connection failures from private VMs and private GKE nodes that egress through Cloud NAT. The classic signature is intermittent: most calls to a third-party API work, some time out or get reset, it gets worse under load or when traffic concentrates on one destination, and nothing is wrong at the destination. Behind it is usually NAT source port exhaustion: each VM gets a fixed or bounded allocation of NAT ports, and once a node's Pods hold them all in open or `TIME_WAIT` connections, new connections from that node cannot be translated and are dropped.

> [!info] Scope and verification
> The commands were not run against a live project and the note is not marked `verified`. Command names, flags, defaults and the Terraform field names were checked against the `gcloud` help (SDK 570.0.0), the Compute Engine API reference and the Terraform google provider documentation sources on 2026-10-21. No Google Cloud documentation page could be read. Cloud NAT log field names, drop reason values, metric names and port-per-IP figures are marked **not verified**; check the current Cloud NAT documentation before building alerts on them.

## When to use

- Outbound calls from private nodes to the internet (SaaS APIs, package mirrors, webhooks, external registries) time out or reset intermittently, while the same call from elsewhere works.
- Failures cluster on a few nodes, rise with traffic, or appear when one destination (a single API host, a single IP) receives most calls.
- Image pulls or package installs from external registries fail only under load; see also [[gke-image-pull-registry-failures]].
- Connection pools to an external database or service churn and fail to reconnect; see [[postgres-connection-pooling-gke]].

If failures are total rather than intermittent, or affect name resolution, start with [[network-troubleshooting-dns-mtu-tls-load-balancers]] and [[gke-dns-failures-kube-dns-and-nodelocal]] instead: a missing route, a firewall rule or DNS is more likely than ports.

## Preconditions

- Read access to the router and NAT (`roles/compute.networkViewer` covers it) and to logs; `roles/compute.networkAdmin` on the host project to change them. In a Shared VPC the router and NAT live in the host project; see [[shared-vpc-hub-and-spoke]].
- The NAT is managed in Terraform (`google_compute_router_nat`). Emergency `gcloud` changes are written back to Terraform the same day.
- A list of external partners that allowlist your egress IPs, with contacts. Adding NAT IPs changes the source addresses they see (step 6).

```bash title="variables"
PROJECT=example-host-project     # the project that owns the router (host project for Shared VPC)
REGION=europe-west1
ROUTER=nat-router-euw1
NAT=nat-euw1
gcloud config set project "$PROJECT"
```

## Steps

### 1. Prove the traffic goes through Cloud NAT

A VM without an external IP, in a subnet the NAT covers, egresses through Cloud NAT. A VM with an external IP does not, so port exhaustion cannot be the cause there.

```bash
# Does the node or VM have an external IP?
gcloud compute instances list --filter="name~gke-prod" \
  --format="table(name,zone.basename(),networkInterfaces[0].networkIP,networkInterfaces[0].accessConfigs[0].natIP)"

# Which subnets and ranges does the NAT cover, and with which settings?
gcloud compute routers nats describe "$NAT" --router "$ROUTER" --region "$REGION"

# Runtime view: NAT IPs in use and whether more are needed
gcloud compute routers get-status "$ROUTER" --region "$REGION" --format="yaml(result.natStatus)"
```

In the `nats describe` output, note: `sourceSubnetworkIpRangesToNat` (and `subnetworks` with `secondaryIpRangeNames` if only some ranges are covered), `natIpAllocateOption` (`AUTO_ONLY` or `MANUAL_ONLY`), `natIps`, `minPortsPerVm`, `maxPortsPerVm`, `enableDynamicPortAllocation`, `enableEndpointIndependentMapping`, `logConfig` and the timeout fields. A field that is absent is at its default.

For GKE, check whether Pod traffic is translated by Cloud NAT directly (the Pod secondary range is in the NAT's covered ranges) or first masqueraded to the node IP on the node. Either way the ports come out of the node VM's allocation, so every Pod on a node competes for the same ports. See [[private-gke-and-controlled-egress]] for the egress design.

Then see the actual allocation per VM:

```bash
gcloud compute routers get-nat-mapping-info "$ROUTER" --region "$REGION" --nat-name "$NAT" --format=json > nat-mapping.json
jq -r '.[] | .instanceName as $vm | .interfaceNatMappings[]? |
  [$vm, .sourceVirtualIp, (.numTotalNatPorts // 0), (.natIpPortRanges | join(" "))] | @tsv' nat-mapping.json | head -20
```

The JSON field names inside the mapping output come from the API reference and were not run here; if the `jq` paths return nothing, look at `nat-mapping.json` directly.

### 2. Turn on NAT logging and look for dropped connections

NAT logging is off by default. Turn it on with errors only, which records failed translations without the volume of logging every connection:

```bash
gcloud compute routers nats update "$NAT" --router "$ROUTER" --region "$REGION" \
  --enable-logging --log-filter=ERRORS_ONLY
```

`ERRORS_ONLY` logs connection failures, `TRANSLATIONS_ONLY` logs successful connections and `ALL` logs both. Logging costs money at high volume; use `ERRORS_ONLY` for diagnosis and keep it on only if you alert on it.

> [!warning] Not verified: log resource type, fields and drop reasons
> The resource type, field paths and reason values below (for example a reason that means "out of resources", that is, out of ports, and one for an endpoint-independent mapping conflict) were not confirmed against current documentation. If the query returns nothing, open Logs Explorer, choose the Cloud NAT gateway resource, and copy the field names from a real entry.

```bash
gcloud logging read \
  "resource.type=\"nat_gateway\" AND jsonPayload.allocation_status!=\"OK\"" \
  --freshness=1h --limit=200 --format=json > nat-drops.json

jq -r '.[] | [.timestamp, .jsonPayload.allocation_status, .jsonPayload.connection.src_ip, .jsonPayload.connection.dest_ip, .jsonPayload.connection.dest_port] | @tsv' \
  nat-drops.json | head -50

# Which VMs and destinations account for the drops
jq -r '.[] | .jsonPayload.connection.src_ip' nat-drops.json | sort | uniq -c | sort -rn | head
jq -r '.[] | "\(.jsonPayload.connection.dest_ip):\(.jsonPayload.connection.dest_port)"' nat-drops.json | sort | uniq -c | sort -rn | head
```

Drops concentrated on a few source VMs point to busy nodes running out of their own allocation. Drops concentrated on one destination IP and port point to connection churn to that destination, since a NAT source port is reused across different destinations far more easily than to the same one (the exact reuse rules are **not verified**).

### 3. Read the NAT metrics

Cloud Monitoring has Cloud NAT gateway metrics for dropped packets and for allocated and used ports per VM. Look for these in Metrics Explorer under the NAT gateway resource; the metric names are **not verified** here, so pick them from the list rather than typing them.

What to look at:

- **Dropped sent packets, by reason.** A rise that matches the application errors confirms the diagnosis.
- **Port usage per VM against allocated ports per VM.** VMs at or near their allocation are the ones dropping. Group by VM to see whether it is a few hot nodes or all of them.
- **Open connections or new connections per second by destination**, if available, to find the churn.

Build an alert on dropped packets due to exhausted resources once you know the metric name, routed to the team that owns egress.

### 4. Fix the cause

Match the fix to what steps 1 to 3 showed.

| Finding                                                         | Fix                                                                                                                                                                                |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A few busy VMs at their allocation, static allocation (DPA off) | Raise `minPortsPerVm`, or turn on **dynamic port allocation** so busy VMs grow from `minPortsPerVm` up to `maxPortsPerVm` and idle ones stay small.                                |
| All VMs high, NAT IPs fully allocated                           | Add NAT IPs (manual) or let auto-allocation add them, after updating partner allowlists (step 6). `minExtraNatIpsNeeded` in `get-status` says how many more manual IPs are needed. |
| Drops tied to endpoint-independent mapping conflicts            | Turn EIM off unless something needs it. EIM and dynamic port allocation are mutually exclusive.                                                                                    |
| One destination, many short-lived connections                   | Reuse connections: HTTP keep-alive, connection pools, HTTP/2. This is the lasting fix; port settings only raise the ceiling.                                                       |
| Many sockets in `TIME_WAIT` on the NAT side                     | Lower `tcpTimeWaitTimeoutSec` (default 120 seconds per the provider docs) with care: too low risks port reuse while late packets are still in flight.                              |
| Long-idle connections held open by clients                      | Close idle connections in the client, or lower `tcpEstablishedIdleTimeoutSec` (default 1200 seconds) so NAT frees ports sooner. Clients must handle the resulting resets.          |

Defaults and rules from the `gcloud` help and the API reference (SDK 570.0.0):

| Setting                                 | Default and constraint                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Dynamic port allocation                 | Off.                                                                                                                         |
| Endpoint-independent mapping            | Off. Cannot be on together with dynamic port allocation.                                                                     |
| `minPortsPerVm`                         | 64 with DPA off, 32 with DPA on. Rounded up to a power of 2 (50 becomes 64). With DPA: a power of 2, at least 32, below max. |
| `maxPortsPerVm`                         | Only with DPA. Default 65536. A power of 2 greater than `minPortsPerVm`, at most 65536.                                      |
| UDP, ICMP, TCP transitory idle timeouts | 30 seconds each.                                                                                                             |
| TCP established idle timeout            | 1200 seconds.                                                                                                                |
| TCP `TIME_WAIT` timeout                 | 120 seconds per the Terraform provider; the API reports the effective value (`effectiveTcpTimeWaitTimeoutSec`).              |

**Sizing.** Each NAT IP has a fixed number of usable source ports (look the figure up in the Cloud NAT documentation; it is **not verified** here). With static allocation, the number of VMs one NAT IP can serve is that figure divided by `minPortsPerVm`, so raising the minimum on a fixed set of manual IPs can leave new nodes without NAT. `minExtraNatIpsNeeded` in `get-status` is the safe check: with manual IPs, it must stay 0 after the change, including at the node pool's maximum size.

### 5. Apply the change through Terraform

```hcl title="network/nat.tf"
resource "google_compute_address" "nat" {
  count  = 4 # was 2; partners updated in CHG-1234 before apply
  name   = "nat-euw1-${count.index}"
  region = "europe-west1"

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_router_nat" "euw1" {
  name   = "nat-euw1"
  router = google_compute_router.euw1.name
  region = "europe-west1"

  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = google_compute_address.nat[*].self_link
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  enable_dynamic_port_allocation      = true
  enable_endpoint_independent_mapping = false
  min_ports_per_vm                    = 128
  max_ports_per_vm                    = 4096

  tcp_established_idle_timeout_sec = 1200
  tcp_transitory_idle_timeout_sec  = 30
  tcp_time_wait_timeout_sec        = 120

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
```

The values are an example for a cluster whose busiest nodes need a few thousand concurrent connections; derive yours from the port usage metrics and the node pool's maximum size. The provider documentation recommends `create_before_destroy` on counted address resources used in `nat_ips`. `ALL_SUBNETWORKS_ALL_IP_RANGES` means no other NAT on any router may cover this network in this region; use `LIST_OF_SUBNETWORKS` with `subnetwork` blocks if you need finer control.

Run `terraform plan` and check that it updates the NAT in place and creates addresses; a plan that replaces the NAT itself drops all translations while it is recreated.

Emergency equivalent with `gcloud`, then write it back to Terraform:

```bash
gcloud compute addresses create nat-euw1-2 nat-euw1-3 --region "$REGION"

gcloud compute routers nats update "$NAT" --router "$ROUTER" --region "$REGION" \
  --nat-external-ip-pool=nat-euw1-0,nat-euw1-1,nat-euw1-2,nat-euw1-3 \
  --no-enable-endpoint-independent-mapping \
  --enable-dynamic-port-allocation \
  --min-ports-per-vm=128 --max-ports-per-vm=4096
```

Whether changing port settings disturbs existing connections is **not verified**; make the change in a quiet period where possible and watch error rates during it.

### 6. New NAT IPs change your source addresses

Every NAT IP can be the source address of any connection. Before adding IPs (or switching from manual to auto-allocated IPs, which you do not control):

1. Reserve the addresses first (`gcloud compute addresses create`, or Terraform), so you know them in advance.
2. Send them to every partner that allowlists your egress, and wait for confirmation.
3. Only then add them to the NAT.

To retire a NAT IP, `--nat-external-drain-ip-pool` (Terraform `drain_nat_ips`) marks it as draining. How existing connections on a draining IP behave is **not verified**; keep the address reserved and allowlisted until traffic on it has stopped.

## Validation

```bash
gcloud compute routers nats describe "$NAT" --router "$ROUTER" --region "$REGION" \
  --format="yaml(enableDynamicPortAllocation,enableEndpointIndependentMapping,minPortsPerVm,maxPortsPerVm,natIps,logConfig)"
gcloud compute routers get-status "$ROUTER" --region "$REGION" --format="yaml(result.natStatus)"   # minExtraNatIpsNeeded is 0
gcloud logging read "resource.type=\"nat_gateway\" AND jsonPayload.allocation_status!=\"OK\"" --freshness=30m --limit=10
```

Then from the application side:

- Error rates for outbound calls return to baseline during the next traffic peak, not only in a quiet period.
- The dropped packets metric stays at zero, and port usage per VM has headroom below the allocation on the busiest nodes.
- A test call from a Pod on a busy node succeeds: `kubectl -n app exec deploy/api -- curl -sS -o /dev/null -w '%{http_code} %{time_connect}\n' https://api.example.com/health`.
- Partners confirm traffic from the new IPs is accepted.

## Rollback

- Revert the Terraform change and apply. Port setting changes are reversible.
- Keep added NAT IPs **reserved** even if you remove them from the NAT, until partners have dropped them from allowlists; a released address can go to another customer, and you cannot get it back.
- If you turned logging on only for the investigation, set the filter back or disable it (`--no-enable-logging`) to stop the cost.
- Turning EIM back on requires turning dynamic port allocation off first.

## Troubleshooting

| Symptom                                                 | Likely cause and fix                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| No NAT log entries at all                               | Logging is off, or the filter in the query does not match your log entries. Copy the fields from a real entry in Logs Explorer.                  |
| Drops only from a few nodes                             | Hot nodes running out of their own ports. Dynamic port allocation, or spread the workload across more nodes.                                     |
| Drops to one destination only                           | Connection churn to one IP and port. Fix keep-alive and pooling in the client; see [[timeouts-retries-load-shedding]].                           |
| New nodes have no internet access after a port increase | Manual NAT IPs cannot cover all VMs at the new minimum. `minExtraNatIpsNeeded` is above 0: add IPs or lower the minimum.                         |
| Partner rejects some calls after the change             | New NAT IPs are not on their allowlist. Get them added; meanwhile, remove the new IPs from the NAT pool only if the old ones can carry the load. |
| `terraform plan` wants to replace the NAT               | A force-new field changed (for example the name or router). Change the plan, not the NAT; replacing it drops all translations.                   |
| Calls to Google APIs fail but not to other hosts        | Probably not NAT. Check Private Google Access and DNS for `googleapis.com`; whether that traffic goes through Cloud NAT is **not verified**.     |
| Errors look like NAT but logs show no drops             | Look at MTU, TLS and DNS; see [[network-troubleshooting-dns-mtu-tls-load-balancers]].                                                            |

## Related

- [[private-gke-and-controlled-egress]] for the egress design this runbook supports.
- [[network-troubleshooting-dns-mtu-tls-load-balancers]] and [[load-balancers-firewalls-and-network-troubleshooting]] for other network failure modes.
- [[shared-vpc-hub-and-spoke]] for where routers and NAT live in a Shared VPC.
- [[gke-image-pull-registry-failures]] for an egress-adjacent GKE failure.
- [[postgres-connection-pooling-gke]] for connection reuse on the client side.
- [[ip-addressing-and-subnets]] and [[terraform-basics-on-gcp]] for the address plan and the Terraform workflow.

## Sources

- `gcloud` built-in help, SDK 570.0.0, 2026-10-21: `compute routers nats describe|update|create`, `compute routers get-status`, `compute routers get-nat-mapping-info`, `compute addresses create`. Defaults for ports, timeouts, DPA, EIM and log filters.
- Compute Engine API reference (discovery document) for `routers`, 2026-10-21: `RouterNat` fields and constraints, `RouterStatusNatStatus.minExtraNatIpsNeeded`, `effectiveTcpTimeWaitTimeoutSec`.
- [Terraform google provider: google_compute_router_nat](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/compute_router_nat): field names, defaults and the `create_before_destroy` advice (read from the provider source, 2026-10-21).
- See also, not read for this note: [Cloud NAT overview](https://cloud.google.com/nat/docs/overview), [Cloud NAT ports and addresses](https://cloud.google.com/nat/docs/ports-and-addresses), [Cloud NAT logging](https://cloud.google.com/nat/docs/monitoring), and the [Routers REST reference](https://cloud.google.com/compute/docs/reference/rest/v1/routers/).
