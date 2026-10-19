---
title: NIS2 basics for engineering teams
description: "What the NIS2 Directive asks of engineering teams: Article 21 risk measures and Article 23 reporting, mapped to evidence a platform already has."
type: guide
tags:
  - compliance
  - security
  - supply-chain
  - incident-management
  - audit
created: 2026-10-19
modified: 2026-10-19
draft: false
aliases:
  - NIS2
---

This note explains NIS2 for engineers who run platforms for organisations that may fall under it, or who supply such organisations. It focuses on two parts that land on engineering: the cybersecurity risk-management measures and the incident reporting duty. It maps them to evidence you probably already have. It does not tell you whether you are in scope; that is a legal question.

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Not checked against a running system
> Article numbers and structure follow Directive (EU) 2022/2555 as I understand it, but quote the exact text from EUR-Lex before relying on it. The reporting deadlines are given as a pointer only; national law can add detail.

## What NIS2 is

NIS2 is Directive (EU) 2022/2555, a measure on a high common level of cybersecurity across the Union. A directive is not directly applicable to companies: each member state transposes it into national law, and the national law is what binds you. Transposition status and details such as national authorities, penalties and registration differ by country, so check the law of each member state where you operate.

It applies to entities established in the EU in listed sectors above size thresholds, and it reaches suppliers indirectly, because in-scope entities must manage supply-chain risk and push requirements into contracts.

If your team or company is outside the EU, the directive does not bind you directly. It matters if you have an EU-established entity, or if EU customers in scope ask you to meet their measures by contract. Treat it then as a customer requirement and ask them which controls and which evidence they expect.

## Who is in scope

The directive distinguishes **essential** and **important** entities, with different supervision regimes. Sector lists are in the annexes, and size thresholds apply. Questions to settle with counsel, not in a pipeline:

- Is the organisation in an annex sector, and over the size threshold in the national law?
- Is it essential or important under the national transposition?
- Which national authority or CSIRT receives notifications, and through what channel?
- Which customers pass NIS2 requirements down to us by contract?

## Article 21 risk-management measures as engineering work

Article 21 requires appropriate and proportionate technical, operational and organisational measures, based on an all-hazards approach. It lists minimum areas in paragraph 2. Quote that list from EUR-Lex; the table below is my plain-language mapping, not the legal wording.

| Measure area (check Article 21(2))                      | Platform control                                | Evidence                                         |
| ------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| Risk analysis and security policies                     | Documented policies, review cadence             | Policy repo with history                         |
| Incident handling                                       | On-call, runbooks, severity levels              | [[runbooks/incident-response]], incident records |
| Business continuity, backup, crisis management          | Backups, restore tests, DR tiers                | Restore-test records                             |
| Supply-chain security                                   | SBOMs, provenance, vendor review                | [[compliance/sbom-generation-and-storage]]       |
| Secure acquisition, development, vulnerability handling | Review gates, scanning, patch SLAs              | Scan reports, exception register                 |
| Assessing effectiveness of measures                     | Audits, game days, access reviews               | [[compliance/access-reviews-gcp-and-gke]] output |
| Cyber hygiene and training                              | Onboarding, phishing and secure-coding training | Training records                                 |
| Cryptography and encryption                             | KMS, TLS policy                                 | Key inventory, TLS policy exports                |
| HR security, access control, asset management           | Joiner/mover/leaver, least privilege, inventory | Access review records, asset inventory           |
| Multi-factor authentication, secured communications     | MFA enforcement, emergency channels             | IdP report, out-of-band contact list             |

The point of the mapping is proportionality: you document why each measure is sized as it is, based on your risk.

## Implementing acts

For some categories of digital infrastructure and digital providers, the Commission adopted an implementing regulation that sets technical and methodological requirements. It is Commission Implementing Regulation (EU) 2024/2690; verify the entity types it covers and its dates on EUR-Lex. If your service is, for example, a cloud computing or managed service provider, this is where detailed technical expectations may appear, so read it rather than relying on a summary.

## Article 23 reporting

Article 23 requires notification of significant incidents to the national CSIRT or competent authority. The shape is staged:

1. **Early warning** soon after becoming aware, indicating whether an unlawful or malicious act is suspected and whether there may be cross-border impact.
2. **Incident notification** with an initial assessment: severity, impact and indicators of compromise where available.
3. **Final report** after the incident, with a detailed description, root cause, mitigation and cross-border impact. There are also intermediate or progress reports on request.

Article 23(4) sets the time limits: the early warning within 24 hours of becoming aware, the incident notification within 72 hours of becoming aware, and the final report within one month of the incident notification. This is a pointer, not a substitute for the text: confirm it on EUR-Lex, and check national law, which can add detail.

### What the on-call engineer must capture

The legal clock starts at awareness, so record it. Build the timeline while the incident is running, not afterwards from memory.

```yaml title="incident/decision-log-entry.yaml"
incident_id: INC-2026-0042
aware_at_utc: 2026-10-19T08:12:00Z # when the team became aware of the incident
detected_by: "alert example-api-5xx-burn" # detection source
scope_summary: "Unauthorised access to a staging bucket; production not confirmed affected"
services_affected: ["example-api"]
customers_affected: unknown
cross_border: unknown
significant: undecided # yes | no | undecided
significance_decided_by: "" # name and role
significance_decided_at_utc: ""
decisions:
  - at_utc: 2026-10-19T08:40:00Z
    who: "incident-commander"
    decision: "Treat as potentially significant until scope is known"
    reason: "Production access cannot be ruled out yet"
notifications:
  - authority: "national CSIRT (see national law)"
    stage: early-warning
    sent_at_utc: ""
```

Agree "significant" in advance in writing, with counsel, using the criteria in the directive and national law. Deciding it at 3 a.m. with no definition is the most common failure.

### NIS2 and GDPR side by side

A personal-data breach can trigger both regimes at once. They have different recipients and different clocks.

| Aspect    | NIS2 Article 23                            | GDPR Article 33 (and 34)                                               |
| --------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| Trigger   | Significant incident affecting the service | Personal-data breach likely to risk individuals                        |
| Recipient | National CSIRT or competent authority      | Data protection supervisory authority                                  |
| Stages    | Early warning, notification, final report  | Notification to authority, communication to individuals when high risk |
| Clock     | 24 h / 72 h / one month, see Article 23(4) | 72 hours after becoming aware, where feasible (Article 33)             |

See [[compliance/pci-dss-and-gdpr-for-devops-logs-and-data]] for the data side. Run one incident timeline and feed both notifications from it.

## Mapping to existing evidence

| Source           | What it gives NIS2 reporting and measures              |
| ---------------- | ------------------------------------------------------ |
| CI pipelines     | Change history, scan results, who deployed what        |
| Argo CD          | Sync history of what ran in the cluster                |
| Artifactory      | Where artifacts came from, and promotion records       |
| Cloud Audit Logs | Admin actions and access, for the incident time window |
| Incident record  | Timeline, decisions, notifications                     |

Keep logs long enough to cover the time window you may need to reconstruct, and make them structured ([[standards/structured-logging-conventions]]). Storage and retention are in [[compliance/audit-evidence-collection-and-retention]].

## Common mistakes

- **Assuming the law does not apply to a supplier.** Customers in scope will still require your measures by contract.
- **No agreed definition of "significant".** The decision gets made under pressure, late, by whoever is awake.
- **Logs that do not cover the window.** If you cannot say when an attacker arrived, the final report suffers.
- **Evidence only in people's heads.** Write the timeline and decision log as you go.
- **Two timelines.** Separate NIS2 and GDPR timelines drift apart. Keep one.
- **Ignoring national law.** The directive is the floor; the transposing act is what you comply with.

## Related

- [[runbooks/incident-response]]: the incident process this feeds.
- [[compliance/pci-dss-and-gdpr-for-devops-logs-and-data]]: the GDPR side of breaches and logs.
- [[compliance/sbom-generation-and-storage]]: supply-chain inventory.
- [[compliance/access-reviews-gcp-and-gke]]: access-control evidence.
- [[compliance/audit-evidence-collection-and-retention]]: evidence storage.
- [[standards/structured-logging-conventions]]: logs that can build a timeline.
- [[dora-eu-operational-resilience-for-engineers]]: the financial-sector counterpart.

## Sources

- EUR-Lex, [Directive (EU) 2022/2555 (NIS2)](https://eur-lex.europa.eu/eli/dir/2022/2555/oj).
- EUR-Lex, [Commission Implementing Regulation (EU) 2024/2690](https://eur-lex.europa.eu/eli/reg_impl/2024/2690/oj): confirm scope.
- ENISA, NIS2 pages on [enisa.europa.eu](https://www.enisa.europa.eu/): find the current guidance.
- EUR-Lex, [Regulation (EU) 2016/679 (GDPR)](https://eur-lex.europa.eu/eli/reg/2016/679/oj).
