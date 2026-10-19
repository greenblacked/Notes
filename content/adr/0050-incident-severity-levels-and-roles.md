---
title: Incidents use SEV1 to SEV4 with fixed commander, comms and scribe roles
description: One severity scale tied to user impact decides paging, escalation and communication, and every SEV1 or SEV2 has a named incident commander.
type: adr
tags:
  - adr
  - incident-management
  - on-call
  - reliability
status: accepted
created: 2026-10-19
modified: 2026-10-19
decided: 2026-10-19
draft: false
aliases:
  - ADR-0050
---

## Context

Each team describes incidents in its own words. "Major", "critical", "P1" and "urgent" mean different things in different channels, so a page from one team can mean a total outage and from another a slow report. During a serious incident several people debug at once, nobody is sure who decides, updates to stakeholders are irregular, and the person who understands the system best is also the one writing status messages.

We want a shared scale that answers three questions quickly: how bad is this, who is in charge, and who needs to be told. The practices are covered in [[incident-response]]; this record fixes the scale and the roles so every team uses the same ones.

## Decision

We will use **four severity levels, SEV1 to SEV4, defined by user and business impact**, and **fixed roles for SEV1 and SEV2**: incident commander, communications lead and scribe.

| Severity | Impact (examples)                                                   | Response                                      |
| -------- | ------------------------------------------------------------------- | --------------------------------------------- |
| SEV1     | Core service down or data at risk for most users; security incident | Page immediately, all roles, executive notice |
| SEV2     | Major feature degraded or a large customer group affected           | Page immediately, all roles                   |
| SEV3     | Limited impact, workaround exists, error budget burning slowly      | Ticket, fix in working hours, owner assigned  |
| SEV4     | Minor defect or internal tool problem, no user impact               | Backlog                                       |

- Severity follows impact, not cause or effort. It is set by the first responder on a best estimate and is changed up or down as facts arrive. Over-declaring is cheaper than under-declaring; nobody is blamed for raising it.
- **Incident commander (IC).** Owns the incident, assigns work, decides priorities and the end of the incident. The IC does not debug. At handover, the outgoing IC states the current status aloud and the new IC confirms.
- **Communications lead.** Writes status updates to the status page, support and stakeholders at a fixed cadence (for example every 30 minutes for SEV1, set per organisation), even when there is nothing new.
- **Scribe.** Keeps a timestamped log in the incident channel: decisions, commands run, hypotheses. It becomes the postmortem timeline.
- Technical responders are named by the IC. A SEV1 or SEV2 always has a named IC; if nobody else is available, the first responder takes the role until relieved.
- A blameless postmortem is mandatory for SEV1 and SEV2 and happens within a set number of working days ([[blameless-postmortems]]). SEV3 postmortems are optional but encouraged when they teach something.
- Paging alerts carry the severity label, aligned with [[0045-page-only-on-slo-burn-rate]]; the alert's runbook says how to confirm and re-grade it.
- Security incidents also follow the security response procedure and may involve legal and compliance contacts. This record does not replace those.

```yaml title="alert-severity-labels.yaml"
labels:
  severity: page # maps to SEV1 or SEV2 after triage
  team: payments
annotations:
  runbook_url: "https://runbooks.example.com/checkout/sev-triage"
```

> [!info] Claims not checked against current docs
> The impact thresholds and communication cadences in the table are examples to adapt to your organisation, not an industry standard. Check the referenced incident-management guides and adjust them to your contracts and customer commitments.

## Consequences

Easier:

- A shared vocabulary: one word tells everyone how to react.
- Clear command during an incident, and responders can focus on the technical work.
- Predictable updates reduce stakeholder interruptions in the incident channel.
- Postmortems start from a complete log.

Harder or newly required:

- People must be trained for the IC, communications and scribe roles, and they must practise them in game days. An untrained IC is worse than none.
- Four levels are a simplification. Edge cases (partial regional outage, an unknown number of affected users) need judgement and a bias towards the higher level.
- Rotas must cover IC availability, not only responders. This is an extra on-call load and affects [[on-call-health]].
- Severity inflation can dilute the scale. The quarterly incident review compares declared severity with measured impact.
- Customer-facing contracts may define their own severity terms, which must be mapped to ours, not replace them.

## Alternatives considered

- **No formal scale.** Zero process cost, but inconsistent response and communication. Rejected.
- **Vendor default scales.** Quick to adopt, but tied to a paging product and not to our impact language. Rejected.
- **Five or more levels.** More precision than anyone remembers at 3 a.m. Rejected.

## Validation

```bash
set -o pipefail
RUNBOOK_DIR="./runbooks"
RULES_DIR="./monitoring/rules"

# Every paging alert has a runbook_url (prints offenders; empty is good)
yq -r '.groups[].rules[] | select(.labels.severity == "page") | select(.annotations.runbook_url == null) | .alert' "${RULES_DIR}"/*.yaml

# The severity definitions are present in the incident runbook
grep -n "SEV1" "${RUNBOOK_DIR}/incident-response.md"

# Review: list incidents of the last quarter with declared severity (from your incident tracker export)
echo "Compare declared severity with measured user impact in the quarterly review"
```

## References

- Managing incidents: https://sre.google/sre-book/managing-incidents/
- Incident response practices: https://response.pagerduty.com/
- Related notes: [[incident-response]], [[blameless-postmortems]], [[on-call-incidents-and-postmortems]], [[on-call-health]]
- Related ADRs: [[0045-page-only-on-slo-burn-rate]], [[0051-backups-proven-by-quarterly-restore-drills]]
