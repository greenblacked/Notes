---
title: "DORA (EU regulation) for engineering teams: ICT operational resilience"
description: What the EU DORA regulation asks of ICT engineering at financial entities and their ICT providers, kept separate from DORA delivery metrics.
type: guide
tags:
  - compliance
  - audit
  - reliability
  - incident-management
created: 2026-10-19
modified: 2026-10-19
draft: false
aliases:
  - Digital Operational Resilience Act
---

This note is about the EU Digital Operational Resilience Act, for engineers at financial entities or at companies that supply ICT services to them. It covers what the regulation asks of engineering in practical terms and what evidence to keep. It is not about the delivery-performance research of the same name.

> [!note] Two different DORAs
> This note is about the EU regulation. For deployment frequency, lead time and the other delivery metrics, see [[management/dora-metrics]].

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Not checked against a running system
> I am working from my understanding of Regulation (EU) 2022/2554 and have not reproduced its text. Reporting deadlines and templates are set in technical standards (RTS and ITS) and are deliberately not stated here; read the official texts.

## What DORA is

DORA is Regulation (EU) 2022/2554 on digital operational resilience for the financial sector. Unlike a directive, a regulation applies directly in member states. It started applying in January 2025; confirm the date on EUR-Lex. Details are filled in by regulatory and implementing technical standards (RTS and ITS) and supervisory guidance from the European supervisory authorities.

## Who is in scope

- **Financial entities** across many categories (banks, insurers, investment firms, payment and crypto-asset service providers, and others). The list is in the regulation.
- **ICT third-party service providers**, which are reached through the contracts that financial entities must have with them. Some providers can be designated critical and come under direct oversight.

If your team or company is outside the EU, including in Ukraine, the regulation does not bind you directly. It matters if you serve EU financial entities, who will require contract terms, evidence, audit rights and exit plans from you. Ask your customers which parts they expect and treat the answer as a contractual requirement.

## The pillars in engineering terms

| Pillar                                 | In engineering terms                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| ICT risk management                    | Asset inventory, protection, detection, response and recovery, governed by management    |
| Incident management and reporting      | Classify incidents, report major ones to authorities, keep records                       |
| Digital operational resilience testing | Regular testing, including scenario tests; advanced threat-led testing for some entities |
| ICT third-party risk                   | Register of providers, contract terms, concentration risk, exit plans                    |
| Information sharing                    | Voluntary exchange of cyber threat information                                           |

## Backup, restore and resilience testing evidence

"We have backups" does not satisfy a resilience requirement. Keep records that show recovery works and meets targets. The structures are in [[architecture/backup-architecture-gke-cloud-sql-gcs]] and [[architecture/disaster-recovery-tiers-rpo-rto]]; game days are in [[runbooks/game-day-chaos-gke]].

```yaml title="resilience/restore-test-2026-q4.yaml"
test_id: RT-2026-Q4-001
system: example-payments-db
type: restore-from-backup
performed_at_utc: 2026-10-19T09:00:00Z
performed_by: sre-oncall
backup_used: "backup-2026-10-18T02:00:00Z"
target_rto_minutes: 60
achieved_rto_minutes: 47
target_rpo_minutes: 15
achieved_rpo_minutes: 12
data_integrity_check: passed
issues:
  - "Restore runbook step 4 referenced an old bucket name; fixed in MR"
next_test_due: 2027-01-19
evidence_links:
  - "Pipeline run and logs of the restore job"
```

Threat-led penetration testing (TLPT) applies to certain entities only, under specific rules and frequency. Whether it applies to your customer is for them and their supervisor to say; check the regulation and the RTS.

## ICT incident classification and reporting inputs

Engineering's part is to record the facts the classification needs, as they happen. The classification criteria and thresholds, and the timelines and templates for initial, intermediate and final reports, come from the RTS and ITS. I do not state hours here; take them from the official texts.

Fields to capture in the incident record:

| Field                             | Why it matters                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| Detection time (UTC)              | Start of reporting clocks is defined from detection or classification; check the text |
| Services and functions affected   | Critical or important functions are treated differently                               |
| Clients and transactions affected | Used in classification thresholds                                                     |
| Duration and downtime             | Used in classification thresholds                                                     |
| Geographical spread               | Cross-border impact                                                                   |
| Data losses                       | Availability, integrity, confidentiality                                              |
| Root cause and mitigation         | Needed for the final report                                                           |
| Third party involved              | Links to the provider register                                                        |

Build the incident record on [[runbooks/incident-response]], with the same timeline and decision log you would keep for the sibling regime in [[nis2-basics-for-engineering-teams]].

## Register of information on ICT third-party services

Financial entities keep a register of contractual arrangements with ICT providers, in a format set by an ITS (check the current template). If you are a provider, expect to supply data for your customer's register. A row in your own working copy might look like this:

```yaml title="registers/ict-third-party.yaml"
- provider: "Example Cloud Provider"
  service: "Managed Kubernetes and object storage"
  function_supported: "Customer payment API"
  criticality: critical # critical | important | other (use the entity's own scheme)
  data_location: "EU"
  contract_owner: "head-of-engineering"
  subcontractors_known: true
  exit_plan: "Documented; last tested 2026-06-30"
  concentration_notes: "Single cloud for primary and backup; DR in second region"
```

The exit plan is the part teams skip. It should say how you would move or wind down, and ideally it has been exercised once.

## Mapping to platform controls already on this site

| DORA area                      | Where the platform evidence lives                                     |
| ------------------------------ | --------------------------------------------------------------------- |
| Backup and recovery            | [[architecture/backup-architecture-gke-cloud-sql-gcs]], restore tests |
| Recovery objectives            | [[architecture/disaster-recovery-tiers-rpo-rto]]                      |
| Resilience testing             | [[runbooks/game-day-chaos-gke]]                                       |
| Incident handling              | [[runbooks/incident-response]]                                        |
| Exceptions and risk acceptance | [[compliance/policy-exception-and-waiver-process]]                    |

## Not the same as DORA metrics

DORA metrics (deployment frequency, lead time for changes, change failure rate, time to restore) measure software delivery performance. The regulation is a legal framework for operational resilience. They overlap in vocabulary (recovery time, incidents) but not in purpose, owner or audience. Do not report one as the other, and do not use delivery metrics as evidence of regulatory compliance. See [[management/dora-metrics]].

## Related

- [[management/dora-metrics]]: the delivery metrics, a different subject.
- [[architecture/disaster-recovery-tiers-rpo-rto]]: recovery tiers and targets.
- [[architecture/backup-architecture-gke-cloud-sql-gcs]]: backup design.
- [[runbooks/game-day-chaos-gke]]: practising failure.
- [[runbooks/incident-response]]: the incident process.
- [[compliance/policy-exception-and-waiver-process]]: managing accepted risk.
- [[nis2-basics-for-engineering-teams]]: the cross-sector directive.

## Sources

- EUR-Lex, [Regulation (EU) 2022/2554 (DORA)](https://eur-lex.europa.eu/eli/reg/2022/2554/oj).
- European Banking Authority, EIOPA and ESMA: DORA pages for the RTS and ITS; find the current pages on [eba.europa.eu](https://www.eba.europa.eu/), [eiopa.europa.eu](https://www.eiopa.europa.eu/) and [esma.europa.eu](https://www.esma.europa.eu/).
