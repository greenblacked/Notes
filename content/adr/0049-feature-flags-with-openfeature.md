---
title: OpenFeature is the feature-flag API, and the provider is still open
description: Code calls the vendor-neutral OpenFeature SDK; the backing provider, self-hosted flagd or a managed vendor, is not yet chosen.
type: adr
tags:
  - adr
  - delivery
  - reliability
  - kubernetes
status: proposed
created: 2026-10-19
modified: 2026-10-19
draft: false
aliases:
  - ADR-0049
---

## Context

Teams want to separate deploying code from releasing behaviour: ship dark, turn on for a small group, turn off in seconds when something goes wrong. Today this is done with environment variables and config maps, which need a deployment or a pod restart to change, and with a few home-grown toggles in databases that nobody owns.

Feature flags are also a risk. Flags that are never removed become permanent branches in the code and untested combinations in production. A flag service that is down must not take the application with it.

The standards and tooling in this space move quickly, so this record fixes the part we are confident about (the application-facing API and the lifecycle rules) and leaves the backing provider open.

## Decision

Proposed: we will use the **OpenFeature SDK** as the only flag API in application code, and we will choose the **provider** (self-hosted flagd or a managed vendor) after evaluation.

Proposed rules for new code:

- Application code calls OpenFeature, never a vendor SDK directly. The provider is configured in one place at start-up, so replacing it does not touch business code.
- Every flag has an owner, a type (release, experiment, ops or permission) and, for temporary flags, an expiry date. A release flag that is fully on is removed from the code within an agreed time. Expired flags raise a ticket automatically.
- Every flag evaluation has a safe default in code. If the provider is unreachable, the application runs with defaults and does not fail requests.
- Evaluation is local where possible (the provider syncs rules and evaluates in-process or in a sidecar), so a request does not make a network call to a flag service.
- Tier-1 paths get kill switches: ops flags that turn off a non-essential dependency or an expensive feature under load. They are exercised in game days ([[game-day-chaos-gke]]).
- Flag changes in production are audited: who, when, old and new value.
- Flags complement, and do not replace, progressive delivery ([[progressive-delivery-argo-rollouts]]) and the rollback method in [[0048-rollback-by-redeploying-previous-digest]].

Open part:

- **Options.** A: flagd, the OpenFeature reference daemon, with flag definitions in Git delivered as Kubernetes resources or files, reconciled by Argo CD. B: a managed commercial flag service with an OpenFeature provider. C: a hybrid, with flagd for ops flags and a managed service for product experiments.
- **Decision owner.** The platform lead, with a product representative for experiment needs.
- **Criteria to close.** Whether product teams need percentage rollouts by user attributes with a UI for non-engineers; audit and approval workflow for flag changes; availability and failure behaviour of the provider; data protection (user attributes sent to a vendor); total cost; operational load of self-hosting.
- **Trigger.** Decide after a time-boxed evaluation of A and B on one service, or when the first request for non-engineer flag management arrives, whichever is first.

```typescript title="flags.ts"
import { OpenFeature } from "@openfeature/server-sdk"

const client = OpenFeature.getClient("checkout")

export async function newPricingEnabled(userId: string): Promise<boolean> {
  // The default (false) is used if the provider is unavailable.
  return client.getBooleanValue("new-pricing", false, { targetingKey: userId })
}
```

```yaml title="flag-definition.yaml"
# Example flagd-style definition kept in Git. Verify the schema for your version.
flags:
  new-pricing:
    state: ENABLED
    variants:
      "on": true
      "off": false
    defaultVariant: "off"
```

> [!info] Claims not checked against current docs
> OpenFeature and flagd project maturity and CNCF status, the SDK package names and APIs, and the flagd definition schema were not verified. Check the OpenFeature and flagd documentation before adopting any of them.

## Consequences

Easier (the accepted part):

- No vendor lock-in at the code level: switching provider is configuration plus a provider package.
- A common flag vocabulary and lifecycle across languages and teams.
- Safe defaults make the flag system a non-critical dependency.

Harder or newly required:

- Teams must write the cleanup, not only the flag. A flag lifecycle process needs an owner or it decays.
- Every flag doubles the test matrix for the code it guards. Keep flags short-lived and few.
- Until the provider is chosen, teams use a minimal in-memory or file-based provider, which lacks audit and a UI. This is acknowledged and temporary.
- A change in flags is a production change. Without approvals and audit it bypasses the release process in [[0047-semver-release-tags-and-protected-production-deploys]], so the provider choice must support them.

## Alternatives considered

- **Environment variables and ConfigMaps.** Simple, but slow to change and not per-user. Fine for static configuration, not for flags.
- **A vendor SDK in code.** Fastest to start, but couples code to a vendor. Rejected.
- **Homegrown flag table.** Cheap at first, then needs UI, audit and targeting. Rejected.

## Validation

```bash
set -o pipefail
REPO_DIR="."

# No direct vendor flag SDK imports outside the provider setup file (adjust the package names)
grep -rEn "launchdarkly|unleash-client|split.io" "${REPO_DIR}/src" || echo "no direct vendor SDK usage"

# Every flag definition has an owner and, for temporary flags, an expiry (adapt to your metadata format)
yq -r '.flags | to_entries[] | select(.value.metadata.owner == null) | .key' flags/*.yaml
```

## References

- OpenFeature: https://openfeature.dev/docs/
- flagd: https://flagd.dev/
- Related notes: [[progressive-delivery-argo-rollouts]], [[zero-downtime-deployments-kubernetes]], [[error-budget-policy]], [[tech-debt-management]]
- Related ADRs: [[0017-argo-cd-and-rollouts-not-spinnaker]], [[0048-rollback-by-redeploying-previous-digest]]
