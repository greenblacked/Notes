---
title: Shell access to VMs goes through OS Login and IAP, with no metadata SSH keys or external IPs
description: People reach Linux VMs only through IAP TCP forwarding as OS Login users; no metadata SSH keys, no external IPs, no port 22 open to the internet.
type: adr
tags:
  - adr
  - linux
  - gcp
  - security
  - audit
status: accepted
created: 2026-10-21
modified: 2026-10-21
decided: 2026-10-21
draft: false
aliases:
  - ADR-0056
---

## Context

Most workloads run on GKE, but Compute Engine VMs remain: build hosts, appliances, legacy services and the images that [[0041-retire-chef-for-immutable-images|ADR-0041]] still produces. ADR-0041 promises "audited, time-boxed grants" for shell access without naming a mechanism, and [[0025-shared-vpc-host-project-no-default-networks|ADR-0025]] points out that default networks come with SSH open to the internet.

How shell access tends to work without a decision:

- **Metadata SSH keys.** `gcloud compute ssh` makes sure the user's public key is in the **project** metadata, according to its own help text. Keys added that way are not tied to the person's account lifecycle: a leaver's key keeps working on every VM in the project until someone removes it.
- **Shared keys.** A team key pair copied between laptops and CI. Nobody can tell who logged in, and rotating it breaks everyone.
- **Port 22 open to the internet.** The default network's `default-allow-ssh` rule, external IPs on VMs, and constant scanning against them.
- **Sudo for everyone who can log in**, because project-wide keys give the same Linux account on every VM.

Google Cloud has the pieces to replace this. **OS Login** ties Linux accounts and SSH access to Google identities and IAM roles, so access is granted and revoked with group membership. **IAP TCP forwarding** lets a client open a tunnel to a VM's internal address through Google, after an IAM check, so VMs need no external IP and no internet-facing port. [[zero-trust-access-iap-and-vpc-service-controls]] describes the architecture; this record makes it the only path.

## Decision

**People reach VM shells only through IAP TCP forwarding, as OS Login users authorised by IAM group roles. VMs have no external IPs, project and instance metadata SSH keys are not used, and administrator access is granted just in time.**

### Guardrails (organization policy on the environment folders)

| Constraint                        | Setting  | Effect                                                                  |
| --------------------------------- | -------- | ----------------------------------------------------------------------- |
| `compute.requireOsLogin`          | enforced | OS Login is on for every new project and VM; it cannot be switched off. |
| `compute.vmExternalIpAccess`      | deny all | No VM gets an external IP address.                                      |
| `compute.disableSerialPortAccess` | enforced | Interactive serial console access is off by default (see break-glass).  |

Exceptions follow [[policy-exception-and-waiver-process]] with an owner and an expiry. These are the same constraints Google's own Terraform example foundation enforces at the organization level.

### Network path

- **One firewall rule per VPC** allows TCP 22 (and 3389 where Windows VMs exist) **only from the IAP TCP forwarding source range** `35.235.240.0/20`, and only to VMs with the network tag `iap-ssh` (or a target service account). There is no other ingress rule for SSH or RDP.
- The default network and its `default-allow-ssh` rule do not exist ([[0025-shared-vpc-host-project-no-default-networks]]).
- Clients connect with `gcloud compute ssh --tunnel-through-iap`, or an IAP tunnel for other TCP tools.

### Identities and roles

All grants go to **Google groups**, never to individual users, and are managed in Terraform ([[0030-terraform-manages-gcp-infrastructure]]):

| Role                                | Granted to                              | Gives                                                                                              |
| ----------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `roles/iap.tunnelResourceAccessor`  | The team's operators group, per project | Opening an IAP tunnel to the project's VMs.                                                        |
| `roles/compute.osLogin`             | The team's operators group, per project | Logging in as a normal Linux user, without sudo.                                                   |
| `roles/compute.osAdminLogin`        | Nobody standing                         | Logging in with sudo. Only through a just-in-time grant ([[0057-just-in-time-production-access]]). |
| `roles/compute.osLoginExternalUser` | Not granted                             | Login for users outside the organization; not used.                                                |

In non-prod, `roles/compute.osAdminLogin` may be a standing grant for the owning team. In prod it never is.

- **2-step verification** is required for OS Login where the product supports it for our users (check the current OS Login documentation for the setting and its limits).
- **Metadata SSH keys are not used.** No `ssh-keys` entries in project or instance metadata. OS Login being enforced is the primary control; a scheduled check (Validation) finds and removes any metadata keys that appear anyway.
- **Service accounts** that need SSH (for example a deploy job that cannot be replaced by an image rebuild) use OS Login with their own identity and the same IAP path. They never get a shared key.

### Break-glass

When IAP or OS Login is unavailable and a VM must be reached, the serial console is the break-glass path: the platform on-call enables serial port access for that one VM or project through an expedited exception, uses it, and disables it again. The use is announced in the incident channel and reviewed afterwards ([[0050-incident-severity-levels-and-roles]]). This is a process control; check the Compute Engine documentation for how serial console access is granted and logged before relying on it.

### Configuration

```hcl title="vm-access-policies.tf"
variable "env_folder_id" {
  type        = string
  description = "Numeric ID of the environment folder, for example 123456789012."
}

resource "google_org_policy_policy" "require_os_login" {
  name   = "folders/${var.env_folder_id}/policies/compute.requireOsLogin"
  parent = "folders/${var.env_folder_id}"
  spec {
    rules {
      enforce = "TRUE"
    }
  }
}

resource "google_org_policy_policy" "no_vm_external_ip" {
  name   = "folders/${var.env_folder_id}/policies/compute.vmExternalIpAccess"
  parent = "folders/${var.env_folder_id}"
  spec {
    rules {
      deny_all = "TRUE"
    }
  }
}

resource "google_org_policy_policy" "no_serial_port" {
  name   = "folders/${var.env_folder_id}/policies/compute.disableSerialPortAccess"
  parent = "folders/${var.env_folder_id}"
  spec {
    rules {
      enforce = "TRUE"
    }
  }
}
```

A new policy can be previewed first with the resource's `dry_run_spec` block, which records what would be denied without enforcing it ([[policy-rollout-audit-to-enforce]]).

```bash title="iap-ssh.sh"
set -o pipefail
PROJECT_ID="app-prod"
HOST_PROJECT="net-prod-host"
NETWORK="vpc-prod"
OPERATORS="group:app-operators@example.com"

# Firewall: SSH only from the IAP TCP forwarding range, only to tagged VMs.
gcloud compute firewall-rules create allow-ssh-from-iap \
  --project "${HOST_PROJECT}" --network "${NETWORK}" \
  --direction INGRESS --priority 1000 \
  --allow tcp:22 \
  --source-ranges 35.235.240.0/20 \
  --target-tags iap-ssh

# Standing roles for the operators group (no admin login).
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member "${OPERATORS}" --role roles/iap.tunnelResourceAccessor --condition=None
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member "${OPERATORS}" --role roles/compute.osLogin --condition=None

# Connecting: the SSH user is the OS Login user derived from the Google identity.
gcloud compute ssh build-01 --project "${PROJECT_ID}" --zone europe-west1-b \
  --tunnel-through-iap --command 'id && sudo -n true 2>/dev/null && echo "sudo: yes" || echo "sudo: no"'
```

Always pass `--source-ranges`: without it, `firewall-rules create` defaults the source to `0.0.0.0/0`. New VMs are created with `--no-address` and the `iap-ssh` tag in their instance template.

> [!info] Claims not checked against current docs
> The `gcloud` flags were read from `gcloud --help` (Google Cloud SDK 570.0.0); the role names, the IAP source range `35.235.240.0/20` and the policy shapes come from Google-maintained Terraform modules and the Google provider's resource documentation. Google's online documentation could not be opened when this record was written. Check before relying on: the current IAP TCP forwarding source range and required permissions; the OS Login 2-step verification setting and which users and platforms it covers; whether OS Login ignores metadata SSH keys on every image or a `block-project-ssh-keys` setting is still needed; how serial console access is granted and logged; which IAP and OS Login events appear in Cloud Audit Logs; and the current flow for Windows VMs.

## Consequences

Easier:

- Access follows group membership: a leaver loses SSH on every VM when their account is suspended, with no key hunt.
- No VM is reachable from the internet, and every tunnel is an IAM decision that can be audited ([[gcp-audit-logs-siem]], [[0044-central-log-sinks-and-retention-tiers]]).
- Linux accounts are per person, so `sudo` logs and shell history name a person ([[linux-users-permissions-sudo-and-ssh]]).
- Admin access in prod is time-boxed and approved, which is what ADR-0041 promised.

Harder or newly required:

- **Image builds and bootstrap change.** Packer builds that SSH into a temporary VM need an IAP path or a builder with its own OS Login identity, and images must keep the guest environment that OS Login depends on. Hardening baselines ([[linux-host-hardening-with-chef-and-inspec]]) must not remove it.
- **Tools that expect a static key** (some configuration management and backup agents) need IAP and OS Login support or a replacement.
- **Windows needs a different flow.** RDP goes through an IAP tunnel to port 3389; SSH to Windows follows Google's separate Windows SSH guide. Credentials for Windows accounts are not covered by OS Login in the same way, so Windows VMs need their own decision if they grow in number.
- **IAP becomes a dependency** for shell access. The break-glass path above covers its outage.
- **First connections are slower**, and file transfer goes through the same tunnel (`gcloud compute scp --tunnel-through-iap`).

## Alternatives considered

- **A bastion host.** One hardened VM with an external IP, and SSH onwards from it. Adds a machine to patch and protect, concentrates keys on it, and still needs identity-based access. Rejected; IAP is the bastion.
- **Public SSH with keys and an IP allow list.** Leaves port 22 on the internet and keeps the key lifecycle problem. Rejected.
- **A third-party privileged access management tool.** Can record sessions and broker credentials, but adds cost, an agent or gateway to run, and a second identity system. Reconsider only if session recording becomes a compliance requirement that Google's tools do not meet.
- **No shell access at all.** The goal for immutable images ([[0041-retire-chef-for-immutable-images]]), and the reason admin login is not standing. Not achievable for every VM today.

## Validation

```bash title="validate-vm-access.sh"
set -o pipefail
PROJECT_ID="app-prod"

# 1. Effective organization policy on the project. Expected: enforced / deny all.
for c in compute.requireOsLogin compute.vmExternalIpAccess compute.disableSerialPortAccess; do
  echo "== ${c}"
  gcloud resource-manager org-policies describe "${c}" --project "${PROJECT_ID}" --effective
done

# 2. VMs with an external IP. Expected: no output.
gcloud compute instances list --project "${PROJECT_ID}" --format=json \
  | jq -r '.[] | select([.networkInterfaces[]?.accessConfigs[]?.natIP] | map(select(. != null)) | length > 0) | .name'

# 3. Metadata SSH keys on the project and on instances. Expected: no output.
gcloud compute project-info describe --project "${PROJECT_ID}" --format=json \
  | jq -r '(.commonInstanceMetadata.items // [])[] | select(.key == "ssh-keys" or .key == "sshKeys") | "project: \(.key)"'
gcloud compute instances list --project "${PROJECT_ID}" --format=json \
  | jq -r '.[] | .name as $n | (.metadata.items // [])[] | select(.key == "ssh-keys" or .key == "sshKeys") | "instance \($n): \(.key)"'

# 4. Firewall rules that open SSH or RDP to anything but the IAP range. Expected: no output.
gcloud compute firewall-rules list --project "${PROJECT_ID}" --format=json \
  | jq -r '.[] | select(.direction == "INGRESS")
      | select([.allowed[]? | .ports[]?] | any(. == "22" or . == "3389"))
      | select((.sourceRanges // []) | any(. != "35.235.240.0/20"))
      | "\(.name)\t\(.sourceRanges)"'

# 5. Your own OS Login profile (the POSIX username you will get).
gcloud compute os-login describe-profile
```

For a Shared VPC, run check 4 against the host project, where the firewall rules live. Check 4 matches exact ports only: also review by hand any ingress rule that allows all ports (no `ports` list) or a port range, and any rule in a network firewall policy. The metadata field names are Compute Engine API names; confirm them once with `--format=json` if a check prints nothing on a project where you expect a finding.

End-to-end test, run by a member of the operators group: `gcloud compute ssh VM --tunnel-through-iap --command id` succeeds and `sudo -n true` fails; the same command without `--tunnel-through-iap` fails, because the VM has no external IP.

Troubleshooting: a tunnel that fails before authentication usually means the firewall rule is missing or the VM lacks the target tag; a `permission denied` at login with a working tunnel usually means the OS Login role is missing, or the VM's image lacks the guest environment. Check the IAM grants before touching the VM.

## References

- OS Login: https://cloud.google.com/compute/docs/oslogin
- IAP TCP forwarding overview: https://cloud.google.com/iap/docs/tcp-forwarding-overview
- Using IAP for TCP forwarding: https://cloud.google.com/iap/docs/using-tcp-forwarding
- Managing instance access: https://cloud.google.com/compute/docs/instances/managing-instance-access
- Connecting to Windows VMs with SSH: https://cloud.google.com/compute/docs/connect/windows-ssh
- Google's Terraform example foundation (organization policies): https://github.com/terraform-google-modules/terraform-example-foundation
- Google's bastion host module, IAP tunnelling submodule: https://github.com/terraform-google-modules/terraform-google-bastion-host

Related notes: [[linux-users-permissions-sudo-and-ssh]], [[linux-host-hardening-with-chef-and-inspec]], [[zero-trust-access-iap-and-vpc-service-controls]], [[gcp-organization-policy-guardrails]], [[gcp-audit-logs-siem]]

Related ADRs: [[0025-shared-vpc-host-project-no-default-networks]], [[0041-retire-chef-for-immutable-images]], [[0044-central-log-sinks-and-retention-tiers]], [[0055-private-gke-control-plane-and-egress]], [[0057-just-in-time-production-access]]
