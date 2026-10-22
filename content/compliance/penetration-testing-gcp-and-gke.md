---
title: "Penetration tests on GCP and GKE: scope, rules of engagement and retest evidence"
description: Scope, authorise, prepare, run and close a penetration test of a GCP and GKE platform, with time-bound tester access and a retest evidence package.
type: guide
tags:
  - compliance
  - security
  - gcp
  - gke
  - kubernetes
  - audit
created: 2026-10-21
modified: 2026-10-21
draft: false
aliases:
  - pentest
  - rules of engagement
---

PCI DSS, DORA, SOC 2 auditors and enterprise customers all ask for penetration test evidence, and the platform team ends up owning the scope, the access, the fixes and the retest. Tests usually fail in the same three ways: the environment tested is not representative, nobody wrote down who authorised what, and findings are never retested. This guide covers the platform side of a test on GCP and GKE from scoping to the evidence package. Threat modelling, which should drive the scope, is in [[standards/platform-threat-modelling|platform threat modelling]]; fixing what the test finds follows [[standards/vulnerability-management-slas|vulnerability management SLAs]].

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Not checked against a running system
> Nothing here was run. The `gcloud` flags were checked against the installed `gcloud` help on 2026-10-21. **Not verified**: the current wording of Google Cloud's penetration testing policy page, PCI DSS Requirement 11.4 cadence and segmentation testing details, DORA Articles 26 and 27 and the threat-led testing RTS, TIBER-EU details, and the current status of NIST SP 800-115. Check each before quoting it.

## Short answer

- **Scope from risk**, not from a vendor's standard package: name the projects, clusters, hostnames and pipelines, and say which test types apply.
- **Authorise in writing.** A signed rules-of-engagement document from the system owner, consistent with your cloud provider's terms and every SaaS provider's own testing policy.
- **Give testers time-bound, least-privilege access** (IAM conditions or just-in-time grants), allowlist their source addresses, and use synthetic data.
- **Watch the test** with a named contact and a kill switch.
- **Close the loop**: every finding goes into the vulnerability process with an SLA, gets fixed or formally accepted, and is retested. The evidence is the scope letter, the report, the tickets, and the retest letter.
- **Clean up** tester identities, keys, allowlists and test workloads on the last day.

## Test types and what each finds

| Type                            | Starting point                                       | Typically finds                                                                         | Platform preparation                                                             |
| ------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| External (black or grey box)    | The internet, with hostnames in scope                | Exposed services, TLS and header issues, auth flaws, web application vulnerabilities    | Allowlist at the WAF, alerting contact, rate-limit awareness                     |
| Web application and API         | Test accounts in the application                     | Authorisation flaws, injection, business logic (see OWASP WSTG)                         | Test tenants and synthetic data                                                  |
| Assumed breach in GKE           | A pod in a namespace, with a limited service account | Lateral movement, RBAC gaps, metadata and Workload Identity misuse, network policy gaps | A test namespace, limited KSA, logging on                                        |
| Kubernetes configuration review | Read access to the cluster                           | RBAC, admission, Pod Security, node configuration; overlaps the CIS benchmark           | Read-only role, [[compliance/cis-benchmarks-with-kube-bench\|kube-bench]] output |
| Cloud configuration review      | Read-only IAM on the organisation or folders         | IAM sprawl, public buckets, firewall and org policy gaps, key handling                  | Viewer-type roles, time-bound                                                    |
| CI/CD and supply chain          | A developer account, or a runner                     | Secret exposure in jobs, runner escape, pipeline injection, artifact tampering          | A test project and test runners, never shared production runners                 |

Pick the types from the threat model. For most platforms the assumed-breach and CI/CD tests find more than another external scan does.

## Authorisation

Two separate permissions are needed: your organisation's, and the providers'.

**Your own.** The system owner (the person accountable for the systems in scope) signs the rules of engagement. Security and the platform lead co-sign. Legal checks the contract with the testing firm, including liability, data handling and confidentiality of the report.

**Google Cloud.** The Acceptable Use Policy says customers must not use the Services "to test or reverse-engineer the Services in order to find limitations or vulnerabilities, or to evade filtering capabilities, except as expressly permitted in the Agreement", and must not use them to gain unauthorised access to, disrupt, or impair the Services.[^aup] Testing your own workloads is a different activity from testing Google's services, and Google publishes a separate page on penetration testing of your own projects. Check that page's current wording, and your agreement, before the test; do not rely on a paraphrase, including this one.

**Every other provider.** Each SaaS in scope (CDN, identity provider, hosted Git or CI, monitoring) has its own testing policy, and some require notice or forbid certain techniques. List them in the rules of engagement. If a provider forbids testing, the test stops at your side of that boundary.

## Rules of engagement

Keep the rules of engagement in a restricted repository next to the test record. A template:

```yaml title="pentest/2026-q4/rules-of-engagement.yaml"
test_id: PT-2026-Q4
vendor: "Example Security Testing Ltd" # change: the testing firm
type: [external, assumed-breach-gke, ci-cd]
authorised_by:
  system_owner: "head-of-platform" # roles, not names, in shared copies
  security: "security-lead"
signed_on: 2026-10-21
window:
  start: 2026-11-03T08:00:00Z # change
  end: 2026-11-14T18:00:00Z # change
  hours: "08:00-18:00 UTC on working days"
scope:
  projects: [example-pentest-1, example-pentest-ci-1] # change: project IDs
  clusters: ["gke example-pentest-1/europe-west1/pt-1"] # change
  hostnames: [app.pentest.example.com, api.pentest.example.com]
  source_ips: [198.51.100.10/32, 198.51.100.11/32] # change: the tester's egress addresses
out_of_scope:
  - "Google Cloud services themselves, beyond our own configuration"
  - "Production projects and production data"
  - "Third-party SaaS unless listed under providers_permitted"
providers_permitted: [] # change: SaaS whose policy allows testing, with ref
prohibited:
  - "Denial of service or load testing"
  - "Social engineering and phishing"
  - "Physical access"
  - "Destructive actions on data not created by the tester"
  - "Persistence beyond the window"
data_handling:
  - "Synthetic data only; stop and report if real personal data is found"
  - "Report delivered encrypted; no findings in email bodies"
  - "Tester deletes all copies of collected data 30 days after the final report"
stop_conditions:
  - "Service degradation visible in SLO alerts"
  - "Access to data or systems outside scope"
  - "Discovery of an active compromise by a third party"
contacts:
  tester_lead: "pentest-lead@example.com"
  platform_on_call: "platform-oncall@example.com"
  security_on_call: "security-oncall@example.com"
  kill_switch_owner: "platform-oncall"
reporting:
  critical_findings: "Phone the security on-call within the same day"
  draft_report_due: 2026-11-21
  retest_window: "Within 60 days of the final report"
```

## The environment

Test something representative. A test against a cut-down environment proves little about production, and a test against production carries real risk. A practical middle ground:

- A dedicated test project (or a stage environment) built from the **same Terraform modules, org policies, Helm charts and pipelines** as production, with only the data replaced ([[architecture/environment-separation-on-gcp|environment separation]]).
- **Synthetic data**, never a production copy. If testers must touch production (some external tests), restrict them to read-only paths and test accounts.
- Record any differences from production in the report scope, so the auditor and you know what the result does and does not cover.

## Preparing access

### Time-bound IAM for tester identities

Testers get their own identities, never shared accounts, and every grant expires with the window. An IAM condition on `request.time` does this without a cleanup job:

```bash title="scripts/pentest-grant.sh"
set -euo pipefail

PROJECT_ID="example-pentest-1"                  # change: in-scope project
TESTER="user:tester1@example.com"               # change: tester identity in your IdP
ROLE="roles/viewer"                             # change: the least role the test type needs
END="2026-11-14T18:00:00Z"                      # change: end of the window

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="${TESTER}" \
  --role="${ROLE}" \
  --condition="expression=request.time < timestamp(\"${END}\"),title=pentest-PT-2026-Q4,description=Penetration test window"
```

If you use just-in-time elevation, issue tester access through it instead, so approvals and expiry are in the same audit trail as everything else ([[compliance/privileged-access-just-in-time-gcp-gke|just-in-time access]]).

### Allowlisting tester addresses

Without an allowlist, the WAF and rate limits block the tester and the report says "nothing found". With a broad allowlist, you test the application but not the edge. Decide per test type, and write it in the rules of engagement. For a Cloud Armor policy ([[patterns/edge-waf-rate-limiting|edge WAF and rate limiting]]), a high-priority allow rule for the tester's addresses:

```bash title="scripts/pentest-allowlist.sh"
set -euo pipefail

POLICY="example-pentest-edge"            # change: Cloud Armor policy on the in-scope backend
PRIORITY="100"                           # change: higher precedence than your WAF rules
TESTER_RANGES="198.51.100.10/32,198.51.100.11/32"   # change: tester egress addresses

gcloud compute security-policies rules create "${PRIORITY}" \
  --security-policy="${POLICY}" \
  --action=allow \
  --src-ip-ranges="${TESTER_RANGES}" \
  --description="PT-2026-Q4 tester allowlist, remove on 2026-11-14"
```

Test the edge too: run part of the external test without the allowlist, so the WAF itself is in scope.

### Assumed-breach pod on GKE

Give the tester a foothold that matches what an attacker would have after compromising one workload: a pod in an ordinary namespace, running as a Kubernetes service account with the permissions a real application has, under the same Pod Security level and network policies as other workloads.

```yaml title="pentest/assumed-breach.yaml"
apiVersion: v1
kind: Namespace
metadata:
  name: pentest-foothold
  labels:
    pod-security.kubernetes.io/enforce: restricted
    team: security
    environment: stage
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: foothold
  namespace: pentest-foothold
automountServiceAccountToken: true # an attacker in a real app pod often has a token
---
apiVersion: v1
kind: Pod
metadata:
  name: foothold
  namespace: pentest-foothold
  labels:
    app.kubernetes.io/name: pentest-foothold
spec:
  serviceAccountName: foothold
  securityContext:
    runAsNonRoot: true
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: shell
      # change: the tester's toolbox image, pinned by digest after review
      image: registry.example.com/security/pentest-toolbox@sha256:0000000000000000000000000000000000000000000000000000000000000000
      command: ["sleep", "infinity"]
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
      resources:
        requests: { cpu: 100m, memory: 128Mi }
        limits: { memory: 512Mi }
```

Bind the service account to the same Workload Identity setup a typical application uses, if the test should cover the path from pod to Google APIs. Review the toolbox image before it runs in your cluster, as with any third-party image.

### CI/CD tests

Never point testers at shared production runners. Create a test project with its own runners, a copy of a representative pipeline, and fake secrets with recognisable values, so that leakage is easy to detect in the report and in your logs. If the test should cover runner escape, the runners must be built the same way as production ones.

### Telling the SOC, or not

If the purpose includes detection testing, the SOC is not told the details, and a named white-team contact who knows about the test can stop an escalation. Otherwise, tell the SOC the window and source addresses so alerts are triaged quickly. Either way, the incident commander on call must be able to find out within minutes that an alert is the test ([[runbooks/incident-response|incident response]]).

## During the test

- **Monitoring**: keep SLO dashboards and security alerts visible to the platform contact.
- **A kill switch**: removing the allowlist rule, deleting the IAM bindings and deleting the foothold namespace stops most tests. Script it in advance:

```bash title="scripts/pentest-kill-switch.sh"
set -euo pipefail

PROJECT_ID="example-pentest-1"; POLICY="example-pentest-edge"; PRIORITY="100"   # change
TESTER="user:tester1@example.com"; ROLE="roles/viewer"                          # change
CONTEXT="gke_example-pentest-1_europe-west1_pt-1"                                # change

gcloud compute security-policies rules delete "${PRIORITY}" --security-policy="${POLICY}" --quiet
# --all removes every binding of this role and principal, whatever its condition.
gcloud projects remove-iam-policy-binding "${PROJECT_ID}" --member="${TESTER}" --role="${ROLE}" --all
kubectl --context "${CONTEXT}" delete namespace pentest-foothold --wait=false
```

- **Critical findings** are reported the same day and handled as incidents if they reveal an exploitable path in production.
- **A daily check-in** with the tester lead: what was tested, anything odd, any scope questions.

## After the test

### Triage findings

Every finding becomes a ticket in the normal vulnerability process with a severity and an SLA ([[standards/vulnerability-management-slas|vulnerability management SLAs]]). Re-rate the tester's severity in your own context; record both. A finding you will not fix in the SLA goes to the exception register with an owner and an expiry ([[compliance/vulnerability-exception-register|vulnerability exception register]]), not into a spreadsheet nobody reads.

Look for the class, not only the instance. A missing authorisation check on one endpoint is often a pattern; a GKE RBAC finding often exists in every cluster built from the same module.

### Retest

Ask the testing firm to retest the fixed findings and issue a retest letter or updated report that lists each finding with its status. A finding marked "fixed" by your team but never retested is weaker evidence.

### The evidence package

| Item                                    | Proves                                      |
| --------------------------------------- | ------------------------------------------- |
| Signed rules of engagement and scope    | The test was authorised and what it covered |
| The tester's qualifications statement   | Independence and competence (if required)   |
| Final report                            | What was found                              |
| Tickets with links, dates and owners    | Each finding was triaged and handled        |
| Exception records for accepted findings | Accepted risk is owned and time-boxed       |
| Retest letter                           | Fixes were confirmed independently          |
| Cleanup record                          | Access was removed                          |

Store it in the evidence store with restricted access; the report is a map of your weaknesses ([[compliance/audit-evidence-collection-and-retention|audit evidence]]).

## Framework requirements (check the current text)

- **PCI DSS** requires internal and external penetration testing and segmentation testing in Requirement 11.4. It is commonly understood as at least every 12 months and after significant changes, with more frequent segmentation testing for some entities. Do not plan to these intervals without checking Requirement 11.4 in the current PCI DSS version and with your QSA ([[compliance/pci-dss-and-gdpr-for-devops-logs-and-data|PCI DSS for DevOps]]).
- **DORA** requires a digital operational resilience testing programme and, for entities the competent authority designates, threat-led penetration testing (TLPT), believed to be at least every three years under Articles 26 and 27 and a regulatory technical standard (not verified). Most organisations are not designated; check Articles 26 and 27 and the RTS, and your own designation status ([[compliance/dora-eu-operational-resilience-for-engineers|DORA for engineering teams]]).
- **TIBER-EU** is a European framework for threat-intelligence-based ethical red teaming; check the ECB page for how it relates to DORA TLPT in your jurisdiction.
- **SOC 2 and ISO 27001** do not prescribe a test in the same way; auditors look at whether your testing matches your risk and whether findings are handled.
- **Methodology**: the OWASP Web Security Testing Guide is a guide to testing the security of web applications and web services, and NIST SP 800-115 is a technical guide to information security testing and assessment (check its current status). Ask the testing firm which methodology it follows and record it.

## Cleanup

On the last day of the window (or the morning after):

```bash title="scripts/pentest-cleanup-check.sh"
set -euo pipefail

PROJECT_ID="example-pentest-1"; POLICY="example-pentest-edge"   # change
TESTER_DOMAIN="example.com"                                      # change: the tester's identity domain

# No bindings for tester identities remain (expired conditional bindings still show
# in the policy until removed; remove them to keep the policy clean).
gcloud projects get-iam-policy "${PROJECT_ID}" --flatten="bindings[].members" \
  --format="table(bindings.role,bindings.members,bindings.condition.title)" \
  | grep -i "${TESTER_DOMAIN}" || echo "no tester bindings"

# No allowlist rule left in the Cloud Armor policy.
gcloud compute security-policies describe "${POLICY}" \
  --format="table(rules[].priority,rules[].description)"
```

Also remove: service account keys created for the test, tester accounts in your IdP and in each SaaS ([[compliance/leaver-credential-revocation-devops-tools|leaver credential revocation]] has the list of places), the foothold namespace, test runners, and fake secrets. Ask the testing firm to confirm deletion of collected data on the date in the rules of engagement.

## Pitfalls

- **The wrong environment.** A stage built by hand, not from the production modules, gives a clean report and no assurance.
- **Only an external scan.** The interesting paths on a Kubernetes platform start inside: one compromised pod, one leaked CI token.
- **Allowlisting everything.** The WAF is part of the defence; test with and without it.
- **No authorisation for a SaaS in the path.** Testing a provider's service without permission can breach its terms.
- **Standing tester access.** Grants without expiry outlive the test; use conditions or JIT.
- **Findings without retest.** Auditors and customers ask for the retest letter.
- **Fixing the instance, not the class.** One fixed endpoint, ten unfixed ones built the same way.
- **Report in email.** Treat the report as restricted data.

## Related

- [[standards/platform-threat-modelling]]: where scope comes from.
- [[standards/vulnerability-management-slas]]: SLAs for findings.
- [[compliance/vulnerability-exception-register]]: accepted findings.
- [[compliance/privileged-access-just-in-time-gcp-gke]]: time-bound tester access.
- [[compliance/cis-benchmarks-with-kube-bench]]: configuration baseline before the test.
- [[patterns/edge-waf-rate-limiting]]: the edge testers meet.
- [[architecture/zero-trust-access-iap-and-vpc-service-controls]]: access paths and perimeters to test.
- [[compliance/vendor-soc2-report-review-for-devops-saas]]: reading a vendor's test summary.

## Sources

- Google Cloud, [Acceptable Use Policy](https://cloud.google.com/terms/aup), read 2026-10-21.
- Google Cloud, [penetration testing policy](https://support.google.com/cloud/answer/6262505): Google's terms for testing your own projects; check the current page.
- PCI Security Standards Council, [document library](https://www.pcisecuritystandards.org/document_library/): PCI DSS Requirement 11.4.
- EUR-Lex, [Regulation (EU) 2022/2554 (DORA)](https://eur-lex.europa.eu/eli/reg/2022/2554/oj): the testing articles, believed to be Articles 24 to 27 (check).
- European Central Bank, [TIBER-EU](https://www.ecb.europa.eu/paym/cyber-resilience/tiber-eu/html/index.en.html).
- OWASP, [Web Security Testing Guide](https://owasp.org/www-project-web-security-testing-guide/) and its [repository](https://github.com/OWASP/wstg).
- NIST, [SP 800-115](https://csrc.nist.gov/pubs/sp/800/115/final).
- Google Cloud SDK reference: `gcloud compute security-policies rules create --help` and `gcloud projects add-iam-policy-binding --help` (installed `gcloud`, read 2026-10-21) for the allowlist and condition flags.

[^aup]: Quoted from the Google Cloud Acceptable Use Policy as read on 2026-10-21. The exception "as expressly permitted in the Agreement" is why your agreement and Google's penetration testing page both matter.
