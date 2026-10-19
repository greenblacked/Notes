---
title: Terraform or OpenTofu
description: Proposal on which IaC binary to standardise on after the 2023 licence change, with one tool per state and a clear trigger for re-deciding.
type: adr
tags:
  - adr
  - terraform
  - tools
status: proposed
created: 2026-10-19
modified: 2026-10-19
draft: false
aliases:
  - ADR-0031
---

## Context

In 2023 HashiCorp changed the licence of Terraform from MPL to the Business Source License. The community responded with OpenTofu, a fork now hosted by the Linux Foundation. Both read the same configuration language for the features we use, and both are actively developed, but they have started to diverge in features and release cadence. Check the current licence terms and release notes for both before relying on any statement here.

Our Terraform estate is large and healthy, so there is no pressure to change tools in a hurry. The question is which binary to pin for new work and what would make us switch for existing work. The existing recommendation is in [[terraform-vs-opentofu]]: OpenTofu is a reasonable default for new work, and there is no urgency to move an existing estate.

## Decision

Proposed: the platform standard is **one IaC binary, pinned in CI, with exactly one tool per state**. The choice between Terraform and OpenTofu is not yet closed.

- **Owner:** the platform team lead decides, with security and legal consulted on licensing.
- **Trigger to close:** the next tooling upgrade cycle for the CI base image, or an earlier forcing event (a licence change affecting us, a feature we need that exists in only one tool, or a support requirement).

Criteria for the choice:

| Criterion                     | Question                                                                 |
| ----------------------------- | ------------------------------------------------------------------------ |
| HCP Terraform, Sentinel       | Do we use or plan to use either? They tie us to HashiCorp's products.    |
| Support contracts             | Does any team require vendor support for the binary?                     |
| State encryption              | Do we need client-side state encryption that only one tool offers today? |
| Licence review                | Does legal accept the current terms of the binary we run?                |
| Provider and module ecosystem | Do all our providers and modules work with both? Test, do not assume.    |

Rules that hold whatever is chosen:

- The binary and its version are pinned in the CI image and in `required_version` ([[0034-terraform-modules-versioned-by-git-tag]]).
- **One tool per state.** After a state is written by one tool, do not run the other against it without a deliberate, tested migration; state and lock files can become incompatible across versions.
- Migration, if chosen, is one root module at a time, starting with a low-risk environment, with a state backup first ([[terraform-state-recovery]]).

```yaml title=".gitlab-ci.yml"
variables:
  IAC_IMAGE: registry.example.com/platform/iac:pinned

plan:
  image: ${IAC_IMAGE}
  script:
    - terraform version
    - terraform init -input=false
    - terraform plan -out=tfplan -input=false
```

If the tool is later changed to OpenTofu, the CI command becomes `tofu` and the image changes; keep the command name in one variable so the switch is one edit.

> [!info] Claims not checked against current docs
> The current licence terms of Terraform and OpenTofu, feature differences between them (for example state encryption), provider and registry compatibility, and the HCP Terraform offering. Check the OpenTofu docs, the Terraform docs and the HashiCorp licence FAQ.

## Consequences

Whichever tool is chosen:

- Pinning makes upgrades deliberate and reproducible.
- A written trigger stops the decision from being re-argued every quarter.

If OpenTofu is chosen: a fully open governance model and features such as client-side state encryption, at the cost of retraining, new CI images, and fewer vendor integrations.

If Terraform is kept: no migration work and full compatibility with HashiCorp's commercial products, at the cost of living under the BSL and depending on one vendor's licence decisions.

## Alternatives considered

- **Terraform everywhere, no review.** Zero effort now, but leaves licence risk unexamined.
- **OpenTofu everywhere immediately.** Clean story, but a migration with real risk for no immediate benefit on an existing estate.
- **A mixed estate chosen per team.** Rejected: it multiplies CI images, module compatibility testing and on-call knowledge.

## Validation

```bash
set -o pipefail

# Which binary and version CI uses (record it in the pipeline output)
terraform version 2>/dev/null || tofu version

# Every root module pins required_version (review; none missing is good)
grep -rL 'required_version' --include=versions.tf environments/

# State was last written by which version (look at the "terraform_version" field)
terraform state pull | jq -r '.terraform_version'
```

## References

- OpenTofu documentation: https://opentofu.org/docs/
- Terraform documentation: https://developer.hashicorp.com/terraform/docs
- HashiCorp licence FAQ: https://www.hashicorp.com/license-faq
- Related notes: [[terraform-vs-opentofu]], [[terraform-module-and-state-layout]], [[terraform-state-recovery]]
- Related ADRs: [[0030-terraform-manages-gcp-infrastructure]], [[0034-terraform-modules-versioned-by-git-tag]]
