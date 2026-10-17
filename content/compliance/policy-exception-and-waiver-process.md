---
title: Policy exception and waiver process
description: Request, approve, time-box, record and enforce policy exceptions in code, so a waiver expires by default instead of becoming permanent.
type: standard
tags:
  - compliance
  - policy-as-code
  - audit
  - security
created: 2026-10-17
modified: 2026-10-17
draft: false
aliases:
  - policy waivers
---

This standard describes how the team grants an exception to a policy check: a Conftest rule, an admission policy, an organization policy or a benchmark item. It is for engineers and engineering managers who run policy gates and need exceptions to stay rare, visible and temporary. The rollout of the policies themselves is in [[runbooks/policy-rollout-audit-to-enforce]].

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation. Agree the wording of your exception rules with them before you rely on it as evidence.

## Scope

A waiver is a recorded, approved, time-boxed permission to break one policy for one named thing. This note covers requesting, approving, time-boxing, recording and enforcing exceptions in code. It does not cover emergency access to production (that is break-glass, see [[compliance/separation-of-duties-in-deployments]]) or security incidents (see [[runbooks/incident-response]]).

## Rules

- **One waiver, one policy, one scope.** A waiver names the policy and the exact namespace, kind and object. No wildcards across teams.
- **Every waiver expires.** The longest allowed period is 90 days. Renewal is a new request with a fresh approval, not an edit of the date by the owner.
- **The requester cannot approve.** The approver is the policy owner or a security reviewer, never the person who benefits.
- **A ticket is mandatory.** The reason and the plan to remove the need live in the ticket; the record links to it.
- **Waivers live in Git.** The file is changed by merge request only, so history is the audit trail.
- **Expired means denied.** CI fails on an expired waiver, so nobody has to remember to clean up.

## Waiver record

Keep all waivers in one file in the policy repository, so a single query shows what is excused today.

```yaml title="policy/waivers.yaml"
waivers:
  - id: W-0007
    policy: require-non-root
    scope:
      namespace: legacy-reports
      kind: Deployment
      name: report-renderer
    owner: team-reporting
    ticket: PLAT-1234 # change: the ticket with the reason and the removal plan
    reason: Vendor image runs as root until version 4 ships.
    approved_by: security-lead
    expires: "2026-12-31T00:00:00Z"
```

## Enforcing expiry in CI

Evaluate the waiver file with Conftest in the same pipeline that checks manifests (see [[patterns/conftest-policy-gate-for-manifests]]). The rule below denies any waiver whose `expires` timestamp has passed.

```rego title="policy/waivers/expiry.rego"
package waivers

import rego.v1

deny contains msg if {
	some w in input.waivers
	time.parse_rfc3339_ns(w.expires) < time.now_ns()
	msg := sprintf("waiver %s for policy %s expired on %s", [w.id, w.policy, w.expires])
}

deny contains msg if {
	some w in input.waivers
	not w.approved_by
	msg := sprintf("waiver %s has no approver", [w.id])
}

deny contains msg if {
	some w in input.waivers
	w.approved_by == w.owner
	msg := sprintf("waiver %s is approved by its owner", [w.id])
}
```

A test keeps the rule honest.

```rego title="policy/waivers/expiry_test.rego"
package waivers_test

import rego.v1

import data.waivers

test_expired_waiver_is_denied if {
	result := waivers.deny with input as {"waivers": [{
		"id": "W-1",
		"policy": "p",
		"owner": "a",
		"approved_by": "b",
		"expires": "2020-01-01T00:00:00Z",
	}]}
	count(result) == 1
}

test_valid_waiver_is_allowed if {
	result := waivers.deny with input as {"waivers": [{
		"id": "W-2",
		"policy": "p",
		"owner": "a",
		"approved_by": "b",
		"expires": "2999-01-01T00:00:00Z",
	}]}
	count(result) == 0
}
```

```bash
set -euo pipefail

# Run the rule tests, then check the real waiver file (Conftest reads YAML natively)
opa test policy/waivers/ -v
conftest test policy/waivers.yaml --policy policy/waivers --namespace waivers
```

> [!note] Not verified
> The waiver file is passed as `input` (not as data, which would collide with the `waivers` package). The Conftest flags were written from documentation knowledge and not run. Check them against the Conftest version you pin.

## Applying waivers at admission

The waiver file is the source of truth; the admission controller gets a matching exclusion generated from it. Do not hand-edit exclusions in the cluster.

- **Kyverno:** a `PolicyException` resource, or an `exclude` block in the policy, that names the policy, rule and the exact resource.
- **Gatekeeper:** a `match` block with `excludedNamespaces` on the constraint, or a narrower `match` on the object.

> [!note] Not verified
> The field names of Kyverno `PolicyException` and the Gatekeeper `match` and `excludedNamespaces` fields were not verified against the versions you run. Read the current reference for each tool, and see [[tools/gatekeeper-vs-kyverno]] for how they differ.

Generate these objects in CI from `policy/waivers.yaml`, so removing a waiver from the file removes the exclusion at the next sync. Prefer excluding one object over excluding a namespace.

## Ownership

Changes to the file need the policy owner's review. Enforce that with a code owners rule.

```text title="CODEOWNERS"
/policy/waivers.yaml  @example-org/security-reviewers
```

The requester opens the merge request, the ticket holds the discussion, and the security reviewer approves. Branch protection must require code owner approval (see [[compliance/separation-of-duties-in-deployments]]).

## Reporting active waivers

Report weekly so the number is visible to the team and to the engineering manager.

```bash
set -euo pipefail

FILE="policy/waivers.yaml"  # change: path to the waiver file

# Count of active waivers by expiry month
yq -r '.waivers[].expires | .[0:7]' "${FILE}" | sort | uniq -c

# Waivers that expire in the next 30 days (needs GNU date)
LIMIT="$(date -u -d '+30 days' +%Y-%m-%dT%H:%M:%SZ)"
yq -o=json "${FILE}" | jq -r --arg limit "${LIMIT}" '.waivers[] | select(.expires < $limit) | "\(.id)\t\(.policy)\t\(.expires)"'
```

A growing count, or many waivers for one policy, means the policy is wrong or the migration is stalled. Treat both as signals, not as noise.

## Review cadence

Review the full list during quarterly planning (see [[management/tech-debt-management]]). For each waiver the owner either removes the need, renews with a new approval, or the policy changes. Ownership of the removal work belongs to the team that asked, as described in [[management/delegation-and-ownership]]. Keep the review notes as audit evidence (see [[compliance/audit-evidence-collection-and-retention]]).

## Checklist

- [ ] Waiver names one policy and one exact scope.
- [ ] Ticket linked, with a reason and a removal plan.
- [ ] Approver is not the requester.
- [ ] Expiry is at most 90 days away.
- [ ] CI denies expired waivers, and the test passes.
- [ ] Admission exclusions are generated from the file, not edited by hand.
- [ ] The waiver count is reported and reviewed every quarter.

## Pitfalls

- **Renewing by editing the date.** Without a new approval the waiver becomes permanent. Make renewal a new record.
- **Namespace-wide exclusions.** One waived Deployment becomes a hole for every new workload. Match the object.
- **Waivers kept in tickets only.** The cluster and the pipeline cannot read a ticket, so the exception drifts from the record.
- **No owner.** An exception nobody owns is never removed.
- **Hidden defaults.** An exclusion in the controller that is not in the file is an undocumented waiver.

## Related

- [[runbooks/policy-rollout-audit-to-enforce]]: how a policy moves from audit to enforcement.
- [[tools/gatekeeper-vs-kyverno]]: how each engine expresses exclusions.
- [[compliance/gcp-organization-policy-guardrails]]: exceptions for organization policy constraints.
- [[management/tech-debt-management]]: tracking the removal work.
- [[management/delegation-and-ownership]]: who owns the fix.
- [[compliance/cis-benchmarks-with-kube-bench]]: benchmark exceptions follow the same rules.
