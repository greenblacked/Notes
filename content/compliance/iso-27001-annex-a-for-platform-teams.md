---
title: ISO 27001 Annex A controls for platform teams
description: Which ISO/IEC 27001:2022 Annex A controls a platform team owns, who owns each, and the Git, CI, GKE and Terraform evidence behind them.
type: guide
tags:
  - compliance
  - audit
  - security
  - gcp
  - ci-cd
created: 2026-10-19
modified: 2026-10-19
draft: false
aliases:
  - ISO 27001 Annex A
---

This note helps a platform team work out which ISO/IEC 27001:2022 Annex A controls it is likely to own, and what evidence Git, CI, GKE, GCP and Terraform already give for them. The platform team does not own the information security management system (ISMS): the scope, risk assessment, Statement of Applicability and management review belong to the ISMS owner. The team contributes the technical controls and the proof.

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Not checked against a running system
> The commands are illustrative and were not run for this note. The ISO text is paid and I have not reproduced it. Every control reference below is a pointer to confirm against the standard text, and ISO/IEC 27002 holds the implementation guidance.

## Short answer and scope

ISO/IEC 27001 is a certifiable standard: an accredited certification body audits your ISMS and issues a certificate. The main clauses describe the management system. Annex A is a reference list of controls you consider against your risks and record in the Statement of Applicability (SoA). A platform team mostly owns technological controls and some organisational ones, such as access rights and supplier use of cloud services.

The standard text of 27001 and of 27002 (the guidance document) is sold by ISO and national bodies. Read 27002 for the "what good looks like" detail; it is what your engineers will actually use.

## How the 2022 Annex A is structured

The 2022 edition has 93 controls in four themes: organisational, people, physical and technological. It reduced and reorganised the controls compared with the 2013 edition, and added new ones such as use of cloud services, configuration management, monitoring activities and secure coding. Confirm numbering against ISO/IEC 27001:2022 and 27002:2022 rather than blog posts.

The transition from the 2013 edition ended on 31 October 2025, so certificates based on 2013 are no longer valid. Confirm your own certificate's edition with your certification body.

## Controls a platform team usually owns

The control numbers below are the 2022 numbering as a pointer for engineers; confirm them against the standard text.

| Control area                      | 2022 control numbers (confirm against the text) | Usual owner             | Evidence a platform provides                       |
| --------------------------------- | ----------------------------------------------- | ----------------------- | -------------------------------------------------- |
| Access control, privileged access | 5.15, 5.18, 8.2                                 | Platform lead, security | IAM exports, access review records                 |
| Secure authentication             | 8.5                                             | Security, IT            | IdP settings, MFA enforcement report               |
| Use of cloud services             | 5.23                                            | Platform lead           | Org policy exports, supplier register entry        |
| Configuration management          | 8.9                                             | Platform lead           | Terraform in Git, drift reports, kube-bench output |
| Vulnerability management          | 8.8                                             | Security, platform      | Scan reports, exception register                   |
| Logging and monitoring            | 8.15, 8.16                                      | Platform, SRE           | Cloud Audit Logs config, alert rules               |
| Secure development                | 8.25, 8.28                                      | Engineering leads       | Branch protection, SAST/SBOM jobs, review records  |
| Separation of environments        | 8.31                                            | Platform lead           | Project and network layout, IAM per environment    |
| Change management                 | 8.32                                            | Engineering manager     | MR approvals, deploy records                       |
| Cryptography                      | 8.24                                            | Security, platform      | KMS key inventory, TLS policy exports              |
| Information backup                | 8.13                                            | SRE                     | Backup config, restore test records                |

## Evidence per control

Pick the source that is hardest to fake and cheapest to repeat:

- **Git history and protected branches**: who changed what, who approved, and whether force-push is blocked. See [[compliance/change-management-controls-and-pipeline-evidence]].
- **GitLab and Jenkins logs**: pipeline runs, approvals, job configuration history.
- **Terraform state and plans**: the declared configuration of projects, networks and IAM, with plan output kept per change.
- **Cloud Audit Logs and GKE audit logs**: what was changed in the live system, by whom. See [[patterns/gcp-audit-logs-siem]].
- **kube-bench output**: node and control-plane configuration against the CIS benchmark. See [[compliance/cis-benchmarks-with-kube-bench]].

This example pulls the administrative changes to IAM policies in one project for a month. It is the kind of query that backs an access-control or change-management control.

```bash title="scripts/iso-evidence-iam-changes.sh"
set -euo pipefail

PROJECT_ID="example-prod"        # change: the project in scope
FROM="2026-09-01T00:00:00Z"      # change: start of the review window (UTC)
TO="2026-10-01T00:00:00Z"        # change: end of the review window (UTC)

gcloud logging read \
  "logName=\"projects/${PROJECT_ID}/logs/cloudaudit.googleapis.com%2Factivity\"
   AND protoPayload.methodName:\"SetIamPolicy\"
   AND timestamp>=\"${FROM}\" AND timestamp<\"${TO}\"" \
  --project="${PROJECT_ID}" \
  --format="json(timestamp,protoPayload.authenticationInfo.principalEmail,protoPayload.resourceName,protoPayload.methodName)" \
  > "iam-changes-${PROJECT_ID}-$(date -u +%Y-%m).json"
```

The substring match (`:`) catches service-level methods such as `google.iam.admin.v1.SetIAMPolicy`; bucket IAM changes use `storage.setIamPermissions`, so add that method name to the filter if buckets are in scope. Admin Activity logs are written by default and cannot be turned off; Data Access logs are mostly opt-in. Check the current Cloud Audit Logs documentation for what each log type covers.

## Technological controls in CI/CD

The secure development, configuration and change controls translate to pipeline gates. A reasonable set, each of which leaves a record:

| Gate                                  | What it proves                       | Record                             |
| ------------------------------------- | ------------------------------------ | ---------------------------------- |
| Protected default branch, required MR | Code was reviewed before merge       | Branch settings export, MR history |
| SAST and dependency scan              | Known weakness classes were checked  | Job logs, scan reports             |
| SBOM generation                       | Components are inventoried           | SBOM stored with the artifact      |
| Policy checks on Terraform plans      | Infrastructure changes are validated | Plan output, policy result         |
| Environment approval for production   | Production changes are authorised    | Deployment approval records        |

Keep the gates in shared pipeline templates under CODEOWNERS so product teams cannot silently remove them. A gate that can be bypassed by editing the job is not a control. The vulnerability side is covered by [[vulnerability-exception-register]] and the pipeline side by [[soc2-for-ci-cd-controls]].

## Statement of Applicability entries from engineering

The SoA lists each control, whether it applies, why, and how it is implemented. Engineering supplies the last two columns. A row might look like this:

```yaml title="soa/example-entry.yaml"
control: "8.31" # 2022 numbering, confirm against the standard text
title: "Separation of development, test and production environments"
applicable: true
justification: "Production data and workloads run in separate GCP projects with separate IAM."
implementation: "Projects example-dev, example-stage and example-prod; see architecture/environment-separation-on-gcp."
evidence:
  - "Terraform module for project layout, repository path and commit"
  - "Quarterly IAM export per project"
owner: "platform-lead"
last_reviewed: 2026-10-19
```

See [[architecture/environment-separation-on-gcp]] for the layout behind that example. If a control is marked not applicable, the justification is the part the auditor reads, so make it a statement about your risk, not a shrug.

## Internal audit sampling and review cadence

ISO 27001 requires internal audits and management reviews, so expect an internal auditor to sample your evidence before the certification body does. Practical routine:

- Keep the evidence index (control, evidence, location, owner) in one place, in Git.
- Run the access review and the vulnerability exception review on a fixed calendar, and attach the result to the index.
- Let the internal auditor choose samples from full lists (all production changes, all privileged role grants), not from lists you prepared.

## Gaps and documented exceptions

Nonconformities will appear; the system is judged on how you handle them. Record the gap, the risk, the owner, the date by which it is fixed or accepted, and who accepted it. Use the [[compliance/policy-exception-and-waiver-process]] so exceptions are time-limited and visible. A permanent unreviewed exception is a finding waiting to happen.

## Related

- [[compliance/change-management-controls-and-pipeline-evidence]]: change records.
- [[compliance/access-reviews-gcp-and-gke]]: access recertification.
- [[compliance/policy-exception-and-waiver-process]]: time-boxed exceptions.
- [[compliance/cis-benchmarks-with-kube-bench]]: configuration evidence for nodes.
- [[patterns/gcp-audit-logs-siem]]: audit log routing and retention.
- [[architecture/environment-separation-on-gcp]]: separation of environments.
- [[soc2-for-ci-cd-controls]]: the same evidence for a SOC 2 audit.
- [[vulnerability-exception-register]]: keeping accepted vulnerabilities under control.

## Sources

- ISO, [ISO/IEC 27001](https://www.iso.org/standard/27001).
- ISO, [ISO/IEC 27002:2022](https://www.iso.org/standard/75652.html).
- Google Cloud, [Cloud Audit Logs](https://cloud.google.com/logging/docs/audit).
