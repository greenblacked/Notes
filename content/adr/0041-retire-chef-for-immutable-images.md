---
title: Retire Chef for new hosts in favour of immutable images
description: New VMs come from Packer images tested with InSpec in CI and rolled out through managed instance groups; Chef stays only on existing hosts until they migrate.
type: adr
tags:
  - adr
  - chef
  - linux
  - security
  - gcp
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0041
---

## Context

Chef converges long-lived hosts toward a desired state. In practice, hosts drift between runs: someone logs in and edits a file, a converge fails halfway, or a cookbook change applies in a different order on an older node. Patch level differs between hosts that "have the same role". Recovery means converging a new host from scratch, which takes long and can fail on upstream package changes at the worst moment.

Most of our new workload runs in containers on GKE, so the remaining VM fleet is shrinking and well suited to a simpler model: build an image once, test it, replace instances instead of changing them. The host hardening we already do with Chef and InSpec (see [[linux-host-hardening-with-chef-and-inspec]]) carries over as tests.

## Decision

**New hosts are built from immutable images. Chef is not used for new hosts.** Existing Chef-managed hosts stay on Chef until they migrate.

- **Build.** Packer builds a machine image from a golden OS base (see [[0040-golden-base-images-owned-by-platform]]), installing packages and configuration at build time.
- **Test.** InSpec profiles, reused from the existing hardening work, run against a temporary instance in CI. A failing control fails the build. CIS-aligned checks are included (see [[cis-benchmarks-with-kube-bench]] for the Kubernetes counterpart).
- **Publish.** Images go into an image family. Consumers reference the family, and releases are promoted by moving which image the family points to (check current image family semantics in the docs).
- **Roll out.** Managed instance groups use a rolling replace with surge and health checks. Nothing is changed in place; patching means a new image and a replace.
- **No drift.** SSH for configuration changes is disabled by policy. Access for diagnosis is through audited, time-boxed grants.
- **Migration order** follows [[chef-to-immutable-images-migration]]: stateless first, then stateful with a data plan.
- **Chef exceptions** need an owner and an end date.

```hcl title="image.pkr.hcl"
source "googlecompute" "base" {
  project_id          = "example-images"
  zone                = "europe-west4-a"
  source_image_family = "example-golden-debian"
  image_family        = "example-app-host"
  image_name          = "example-app-host-{{timestamp}}"
  ssh_username        = "packer"
}

build {
  sources = ["source.googlecompute.base"]

  provisioner "shell" {
    script = "scripts/install.sh"
  }
  provisioner "shell" {
    inline = ["inspec exec /tmp/profiles/host-baseline --chef-license accept-no-persist"]
  }
}
```

The license flag in the InSpec step depends on the InSpec version in use; check the current InSpec docs.

> [!info] Claims not checked against current docs
> Chef and InSpec licensing terms (they changed over the years, so check them before citing cost as a reason), Packer plugin and builder option names, and the current rolling-update options of managed instance groups.

## Consequences

Easier:

- Every instance of a role is identical, and rollback is pointing the group back at the previous image.
- Hardening is verified before the image exists, not discovered on a live host.
- Scaling out takes minutes because nothing converges at boot.

Harder:

- Every configuration change goes through an image build and rollout. Fast hotfixes need a prepared fast path.
- Stateful hosts need their data on separate disks or managed services before they can be replaced.
- Image sprawl needs cleanup rules: old images are deleted on a schedule, and the previous few are kept for rollback.
- Teams must maintain two models during the migration, and Chef knowledge is still needed.
- Secrets can no longer be handed out by Chef at converge time; they come from the secret store at boot (see [[0036-secret-manager-as-secrets-system-of-record]]).

## Alternatives considered

- **Chef everywhere.** Familiar, but keeps drift and slow recovery. Rejected for new hosts.
- **Ansible at boot or via startup scripts.** Lighter than Chef, but still mutates running hosts and can fail at boot time. Rejected.
- **OS Config only.** Good for patching and inventory, but does not give a tested, versioned image. Useful alongside, not instead.

## Validation

```bash title="validate-immutable-hosts.sh"
set -euo pipefail
PROJECT_ID="example-prod-platform"

# Newest images in the family (expected: recent, with a clear previous one for rollback)
gcloud compute images list --project="${PROJECT_ID}" \
  --filter="family=example-app-host" --sort-by=~creationTimestamp --limit=3

# Instances not created from the family (review: legacy Chef hosts)
gcloud compute instances list --project="${PROJECT_ID}" \
  --format="table(name, disks[0].source.basename(), labels.managed_by)"
```

## References

- Packer: https://developer.hashicorp.com/packer/docs
- Image families best practices: https://cloud.google.com/compute/docs/images/image-families-best-practices
- Chef documentation: https://docs.chef.io/

Related notes:

- [[linux-host-hardening-with-chef-and-inspec]]
- [[chef-to-immutable-images-migration]]
- [[cis-benchmarks-with-kube-bench]]
- [[0040-golden-base-images-owned-by-platform]]
