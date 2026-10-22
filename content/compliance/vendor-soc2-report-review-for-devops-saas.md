---
title: Reviewing a vendor SOC 2 report for DevOps SaaS tools
description: How to read a SaaS vendor's SOC 2 report as a platform engineer, covering scope, opinion, exceptions, CUECs and carve-outs, and how to record the review.
type: guide
tags:
  - compliance
  - audit
  - supply-chain
  - security
created: 2026-10-21
modified: 2026-10-21
draft: false
aliases:
  - vendor SOC 2 review
  - third-party assurance review
---

A platform depends on SaaS: hosted Git and CI, an artifact SaaS, monitoring, paging, a CDN, a secrets or identity provider. Auditors, NIS2 and DORA all ask how you know those suppliers are controlled, and the usual answer is the supplier's SOC 2 report. Sooner or later an engineer gets a long PDF and the question "is this vendor OK?". This note is about reading someone else's report. Being audited yourself is covered in [[compliance/soc2-for-ci-cd-controls|SOC 2 controls for CI/CD pipelines]], and buying and renewing the tool in [[management/devops-vendor-and-licence-management|vendor and licence management]].

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Not checked against a running system
> The structure of a SOC 2 report, the terms CUEC and CSOC, the carve-out and inclusive methods, the opinion types and SOC 3 are described here from general practice and were **not verified** against the AICPA's current pages. The DORA and NIS2 article references were also not checked against EUR-Lex. Check them before quoting them to an auditor. No real vendor's report is described here.

## Short answer

Before you read the controls, check five things. Most reports that turn out unusable fail on one of them.

1. **Type and period.** A Type II report covers design and operating effectiveness over a period; a Type I report covers design at a point in time.[^google-soc2] Note the period end date: how old is it today?
2. **Scope.** Does the system description name the product, edition, deployment model and region you actually use? A report on the vendor's flagship product says nothing about the add-on you bought.
3. **Opinion.** Is the auditor's opinion unqualified (clean) or modified (qualified, adverse, or a disclaimer)? Read the paragraph that explains any modification.
4. **Exceptions.** In the test results, which controls had deviations, and what did management answer?
5. **Your side of the deal.** List the complementary user entity controls (CUECs) and the subservice organisations, and whether each subservice organisation is carved out or included.

If all five are acceptable, the review is mostly mapping CUECs to your own controls and writing it down. If one is not, you escalate before anyone signs.

## Where the report comes from

Ask for the report through the vendor's account team or trust portal. Most vendors share SOC 2 reports only under an NDA or the confidentiality terms of your contract, because the report describes their controls in detail. Treat it accordingly:

- Store it in the restricted evidence location, not in a team wiki ([[compliance/audit-evidence-collection-and-retention|audit evidence collection and retention]]).
- Check the confidentiality terms before you forward it to your own auditor or a customer. Google Cloud, for example, publishes its reports through Compliance Reports Manager; some items there are marked confidential, shared under the customer agreement, and need permission before they are shared outside your organisation.[^crm]
- Write down which version you received and when, so the next review knows what changed.

## Anatomy of a SOC 2 report

The usual order is below (general practice; check the AICPA guidance for the current form). Read it in this order, not front to back.

| Section                              | What it tells you                                                              | Read for                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Independent service auditor's report | The opinion, the period, the criteria covered, any modification                | Type, period, opinion, which Trust Services Criteria apply |
| Management's assertion               | What the vendor's management claims about the system and controls              | That it matches the scope you expect                       |
| System description                   | Services in scope, infrastructure, people, processes, subservice organisations | Scope, carve-outs, CUECs, data flows, regions              |
| Controls, tests and results          | Each control, the auditor's test and the result, including exceptions          | Exceptions and management responses                        |
| Other information (if present)       | Information the auditor did not test, such as future plans or responses        | Context only; it carries no assurance                      |

The Trust Services Criteria are security, availability, processing integrity, confidentiality and privacy.[^google-soc2] Security is always in a SOC 2 report; the others are optional. If you rely on the vendor for uptime, check that availability is in scope; if they hold your source code or secrets, confidentiality matters.

## Review checklist

Use this as the working sheet. Every "no" needs a written explanation or an escalation.

| Check                                                                                           | Why it matters                                                                     |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Type II, not Type I (or Type I only for a first-year vendor, with a plan for Type II)           | Type I shows design, not that controls actually ran                                |
| Period ended recently enough that the gap to today is covered (bridge letter if needed)         | An old report says nothing about this year                                         |
| The product, edition and hosting model you use are in the system description                    | Out-of-scope services carry no assurance                                           |
| The region or data location you use is in scope                                                 | Some vendors run separate stacks per region                                        |
| Opinion is unqualified, or every modification is understood and accepted                        | A modified opinion means the auditor could not conclude on part of the system      |
| The criteria you rely on (security, plus availability or confidentiality) are covered           | Missing criteria mean missing assurance                                            |
| Each exception has a management response and the risk to you is assessed                        | An exception in access removal is a different risk from one in a reporting control |
| Every CUEC is mapped to an owned control on your side                                           | Unmet CUECs mean the vendor's controls may not work for you                        |
| Every subservice organisation is listed, with carve-out or inclusive noted                      | Carved-out providers need their own assurance                                      |
| Controls you care about most are present: access, change, encryption, logging, incident, backup | A report can be clean and still not cover what you care about                      |

## Exceptions: reading the test results

Exceptions are deviations the auditor found when testing a control: a sampled leaver whose access was removed late, a change deployed without approval, a missed access review. A clean opinion with exceptions is common, because the auditor judged the deviation not severe enough to modify the opinion. That is the auditor's judgement about the vendor's whole system. Yours is about your use of it.

For each exception, write down:

- Which control failed and how many samples deviated.
- Whether it touches your data or your access path. A deviation in the vendor's HR onboarding control matters less to you than one in production access removal or change management.
- The management response, and whether it says the issue was fixed, when, and how they know.
- Whether you need a compensating control. For example, if the vendor's access-removal control had exceptions, you might ask for an attestation that their staff access to your tenant is logged, and review your own audit log export.

## CUECs: the vendor's controls assume yours

Complementary user entity controls are the controls the vendor says its customers must run for the vendor's controls to achieve their objectives (general practice; check the AICPA definition). They are the most useful part of the report for a platform team, because they are your to-do list. Typical CUECs for a DevOps SaaS, and the control on your side that meets each one:

| Typical CUEC (paraphrased, generic)                                     | Your control                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Customers configure SSO and MFA for their users                         | SSO enforced through your IdP, local accounts disabled or break-glass only                                           |
| Customers review user access in their tenant periodically               | Your quarterly access review ([[compliance/access-reviews-gcp-and-gke\|access reviews]]) extended to the SaaS tenant |
| Customers remove access for leavers promptly                            | Leaver offboarding ([[compliance/leaver-credential-revocation-devops-tools\|leaver credential revocation]])          |
| Customers protect API tokens and credentials they create                | Token inventory, short-lived tokens, secret scanning, rotation                                                       |
| Customers configure retention, backup or export of their own data       | An export or backup job and a restore test, owned by a named team                                                    |
| Customers notify the vendor of security incidents involving the tenant  | An entry in your incident runbook with the vendor's security contact                                                 |
| Customers are responsible for the content and permissions of their data | Classification and least-privilege project or repository permissions                                                 |

Put each CUEC in your control register next to the control that meets it. If you run a common control set across frameworks ([[compliance/common-control-framework-for-platform-teams|common control framework]]), the CUEC becomes one more requirement mapped onto an existing control, not a new process.

> [!tip] An unmet CUEC is your finding, not the vendor's
> If the report says customers must enforce MFA and you have not, the vendor's report gives you no assurance on that path, and your own auditor will see it as your gap.

## Subservice organisations: carve-out or inclusive

Most SaaS vendors run on a cloud provider and use other suppliers (email, support tooling, payments). The report describes these subservice organisations and how they were treated (general practice; check the AICPA guidance):

- **Inclusive method**: the subservice organisation's relevant controls are included in the description and tested. Rare for large cloud providers.
- **Carve-out method**: the subservice organisation's controls are excluded. The report typically lists complementary subservice organisation controls (CSOCs) the vendor expects the subservice organisation to operate, and says the vendor monitors that provider.

A carved-out cloud provider means part of the assurance you need sits in that provider's report. In practice:

1. Note which provider and which services are carved out.
2. Check that the vendor describes how it monitors the provider (for example, by reviewing the provider's own SOC 2 report each year).
3. Obtain the provider's report yourself if your risk needs it. Large cloud providers publish theirs to customers; Google Cloud's SOC 2 page lists the services in its scope, and some products get separate reports, which is a reminder that every report covers a defined set of services, not the whole company.[^google-soc2]

## Period gaps and bridge letters

A Type II report covers a fixed period that ended some months before you read it. A bridge letter (sometimes called a gap letter) is a statement from the vendor's management covering the time from the period end to a later date. Google Cloud describes bridge letters as attestations by the service provider's management that summarise material changes or issues after the report's period end, and makes them available for its SOC 1 and SOC 2 reports.[^google-soc2]

Two points to keep straight:

- A bridge letter is written by the vendor's management, not by the auditor. It carries less assurance than the report.
- If the gap is long, or the bridge letter mentions material changes (a new platform, an acquisition, a major incident), ask for the next report or more detail before you rely on it.

Typical Type II periods and how long a gap is acceptable are matters of practice and of your auditor's expectations, not a fixed rule; agree a threshold with your compliance lead and write it in the review record.

## SOC 2 compared with other assurance

| Artefact                  | What it is (hedged where not verified)                                                                                                         | How much it tells you                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| SOC 2 Type II             | An independent auditor's opinion on design and operating effectiveness over a period, with tests and results                                   | Most: you see the controls, the tests and the exceptions                                                          |
| SOC 2 Type I              | The same, for design at a point in time                                                                                                        | Design only; no evidence the controls ran                                                                         |
| SOC 3                     | A general-use summary report without the detailed tests and results (general practice, check the AICPA description)                            | Useful for marketing and a first screen; not enough to map CUECs or read exceptions                               |
| ISO/IEC 27001 certificate | A certificate that an information security management system was certified for a scope, with a Statement of Applicability (check the ISO page) | Shows a managed ISMS for a scope; does not show that specific controls operated well. Ask for scope and SoA       |
| CSA STAR entry            | A Cloud Security Alliance registry entry, from self-assessment to third-party levels (check the current programme description)                 | Depends on the level; a self-assessment is the vendor's own answers                                               |
| Penetration test summary  | A letter or summary from a testing firm                                                                                                        | Point-in-time, narrow; see [[compliance/penetration-testing-gcp-and-gke\|penetration tests]] for what to look for |

Ask for the ISO certificate's scope statement and the Statement of Applicability, not just the certificate. For how ISO controls map to platform work, see [[compliance/iso-27001-annex-a-for-platform-teams|ISO 27001 Annex A for platform teams]].

## Why regulators care

- **NIS2** lists supply chain security among the minimum risk-management measures, including the security aspects of relationships with direct suppliers and service providers. This is believed to be Article 21(2)(d); check the current text. See [[compliance/nis2-basics-for-engineering-teams|NIS2 basics]].
- **DORA** requires financial entities to manage ICT third-party risk and to keep a register of information on contractual arrangements with ICT providers. The register is believed to be set in Article 28; check the current text. See [[compliance/dora-eu-operational-resilience-for-engineers|DORA for engineering teams]].

A vendor review record is the engineering input to both: it shows which assurance you obtained, what you found and what you do on your side.

## The review record

Keep one record per vendor and service, in a restricted repository or the evidence store, and re-review at least once a year or when a new report arrives. Do not paste report contents into it: reference the document and summarise your conclusions.

```yaml title="vendor-reviews/example-ci-saas.yaml"
vendor: "Example CI SaaS" # change: vendor name
service_in_use: "Hosted CI runners, EU region, enterprise tier" # change: exactly what you use
data_classes: [internal, confidential] # change: the classes the service holds
criticality: high # change: your own scheme
report:
  type: "SOC 2 Type II"
  criteria: [security, availability, confidentiality]
  period_start: 2025-10-01 # change: from the report
  period_end: 2026-09-30 # change: from the report
  received: 2026-10-20
  stored_at: "evidence/vendors/example-ci-saas/2026/" # change: restricted location
  opinion: unqualified
  scope_covers_our_service: true
  bridge_letter: { needed: false, received: null }
exceptions:
  - control: "Logical access removal for terminated vendor staff"
    deviations: "1 of 25 samples" # change: from the report
    relevance_to_us: medium
    vendor_response: "Fixed process; automated removal since period month 7"
    our_action: "Accept; review our own tenant audit log export quarterly"
subservice_organisations:
  - name: "Example Cloud Provider"
    method: carve-out
    their_assurance_obtained: true
cuecs:
  - cuec: "Customer enforces SSO and MFA"
    our_control: "SSO enforced via IdP; local logins disabled"
    owner: platform-team
    evidence: "IdP app config export, quarterly"
  - cuec: "Customer reviews user access periodically"
    our_control: "Quarterly access review includes the CI SaaS tenant"
    owner: platform-team
    evidence: "Access review record"
  - cuec: "Customer removes leavers promptly"
    our_control: "Leaver runbook step for the CI SaaS"
    owner: platform-team
    evidence: "Leaver tickets"
decision: accepted # accepted | accepted-with-conditions | rejected | escalated
conditions: []
reviewer: "platform-security-reviewer" # a role, not a person's name
reviewed_on: 2026-10-21
next_review: 2027-10-21
```

Validate the records in CI so that a missing CUEC owner or an overdue review is visible. A minimal check, using only Python's standard library and a JSON copy of the records, might be:

```python title="scripts/check_vendor_reviews.py"
"""Flag vendor reviews that are overdue or have CUECs without an owner.

Expects vendor-reviews/*.json (convert YAML to JSON in an earlier CI step
with the tool your pipeline already uses).
"""
import datetime
import glob
import json
import sys

today = datetime.date.today()
problems = []

for path in sorted(glob.glob("vendor-reviews/*.json")):
    with open(path, encoding="utf-8") as fh:
        rec = json.load(fh)
    due = datetime.date.fromisoformat(rec["next_review"])
    if due < today:
        problems.append(f"{path}: review overdue since {due}")
    for c in rec.get("cuecs", []):
        if not c.get("owner") or not c.get("our_control"):
            problems.append(f"{path}: CUEC without owner or control: {c.get('cuec')}")
    if rec.get("report", {}).get("opinion") != "unqualified" and rec.get("decision") == "accepted":
        problems.append(f"{path}: modified opinion accepted without conditions")

for p in problems:
    print(p)
sys.exit(1 if problems else 0)
```

Run it on a schedule as well as on change, because a record goes overdue without anyone editing it.

## Red flags

- The report covers a different product or edition, or "the platform" without naming the service you use.
- Only a Type I report after several years of operation.
- A period that ended long ago, and no bridge letter or next report date.
- A modified opinion, or exceptions in access removal, change management or logging without a credible fix.
- A long CUEC list that shifts core security to the customer (for example, "customers are responsible for encrypting data").
- A carved-out subservice organisation that holds your data, with no description of how the vendor monitors it.
- The vendor refuses to share the report at all, even under NDA, and offers only a SOC 3 or a marketing page.
- The report is described as "available soon" for longer than one audit cycle.

None of these means "reject" by itself. Each means escalate, ask the vendor, add a compensating control, or record a time-boxed exception through [[compliance/policy-exception-and-waiver-process|the policy exception process]].

## Pitfalls

- **Reviewing the PDF, not the service.** The team's real exposure is how the tool is configured: SSO, token lifetimes, permissions, log export. A clean report does not fix a tenant with shared admin accounts.
- **Ignoring CUECs.** They are the part you are responsible for, and auditors increasingly ask for the mapping.
- **One review, never repeated.** Reports are annual or more frequent; tie re-review to renewal in the [[management/devops-vendor-and-licence-management|renewal calendar]].
- **No owner for the decision.** The engineer reviews; a named risk owner accepts. Write both down.
- **Treating the build-or-buy decision as separate from assurance.** If a vendor cannot provide assurance you need, that belongs in the [[management/build-vs-buy-devops-tools|build versus buy]] decision, not after the contract is signed.
- **Forwarding confidential reports.** Check the terms before sending a vendor's report to anyone outside your organisation.

## Related

- [[compliance/soc2-for-ci-cd-controls]]: being audited yourself; the reverse view of this note.
- [[compliance/common-control-framework-for-platform-teams]]: where CUECs land as requirements.
- [[compliance/access-reviews-gcp-and-gke]]: the access review that meets the typical access CUEC.
- [[compliance/leaver-credential-revocation-devops-tools]]: the leaver control that meets the offboarding CUEC.
- [[compliance/iso-27001-annex-a-for-platform-teams]]: ISO controls and certificates.
- [[compliance/nis2-basics-for-engineering-teams]] and [[compliance/dora-eu-operational-resilience-for-engineers]]: why third-party assurance is required.
- [[compliance/gcp-provider-access-controls-and-data-residency]]: controls on your cloud provider's own access.

## Sources

- AICPA and CIMA, [aicpa-cima.com](https://www.aicpa-cima.com): SOC 2 and the Trust Services Criteria; search for the current text and definitions.
- Google Cloud, [SOC 2 compliance page](https://cloud.google.com/security/compliance/soc-2): Type I and Type II, Trust Services Criteria, bridge letters, services in scope.
- Google Cloud, [Compliance Reports Manager](https://cloud.google.com/security/compliance/compliance-reports-manager): obtaining reports and confidentiality.
- Cloud Security Alliance, [STAR programme](https://cloudsecurityalliance.org/star).
- ISO, [ISO/IEC 27001](https://www.iso.org/standard/27001).
- EUR-Lex, [Regulation (EU) 2022/2554 (DORA)](https://eur-lex.europa.eu/eli/reg/2022/2554/oj).
- EUR-Lex, [Directive (EU) 2022/2555 (NIS2)](https://eur-lex.europa.eu/eli/dir/2022/2555/oj).

[^google-soc2]: Google Cloud's SOC 2 page, read on 2026-10-21, defines Type I as design at a point in time and Type II as design and operating effectiveness over a period, and lists the five Trust Services Criteria.

[^crm]: Compliance Reports Manager page, read on 2026-10-21. Some resources need a sign-in, and older reports are requested through support.
