---
title: Working with contractors and managed service providers on platform work
description: Scope, access, review, knowledge transfer and exit for contractors and MSPs on platform work, with time-bound GCP and GitLab access and an expiry report.
type: guide
tags:
  - management
  - security
  - team-process
  - audit
  - cost
  - gcp
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Platform teams bring in outside help for good reasons: a migration that needs more hands for six months, a skill the team does not have yet, or round-the-clock operations that a small team cannot staff. The risks are predictable too. Access granted for a project outlives the project, changes land without the same review as the team's own, shared accounts appear "to make things easier", and when the contract ends the knowledge leaves with the vendor. This note covers choosing the engagement model, scoping deliverables so they can be accepted, an access model with expiry built in, the operating interface with a managed service provider (MSP), knowledge transfer, cost control and the exit plan. Licences for tools are a separate subject, see [[devops-vendor-and-licence-management]].

> [!info] Scope and what is not verified
> Not checked against current docs: the exact `gcloud` flags for your command version and resource type (the `--condition` shape below is documented for several resource types; run `--help` for yours), how GitLab enforces membership expiry in your version (whether the member is removed or only loses access, and when), Privileged Access Manager pricing and limits, and the `glab` role names. The access report script was run against a sample policy file only. Nothing here is legal advice: contracts, NDAs, data processing agreements, intellectual property, licences of delivered code and liability are for your legal team.

## Choose the engagement model

The three common models differ in who directs the work, who carries delivery risk and what you need to manage.

| Model               | Who directs the work               | Delivery risk sits with  | Fits                                                         | Main risk                                                                      |
| ------------------- | ---------------------------------- | ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Staff augmentation  | Your team, day to day              | You                      | Extra capacity on work you already know how to do            | Becomes permanent; knowledge stays with the individual                         |
| Fixed-scope project | The vendor, against agreed outputs | Shared, by contract      | A bounded change: a migration, a module set, a cluster build | Scope disputes; delivered work that passes the contract but not your standards |
| Managed service     | The MSP, against service levels    | The MSP, for the service | 24x7 operations of a defined service                         | Your team loses the ability to operate it; slow change; vendor lock-in         |

Questions that settle most choices:

- **Is the work a one-off change or an ongoing service?** One-off changes suit a project; ongoing operations suit a managed service only if you can define the service precisely.
- **Will your team own the result afterwards?** If yes, prefer models that keep your engineers in the review loop and budget time for handover.
- **Is it core to the platform?** Work that defines the platform's security boundary or its golden paths is usually better done by your team with augmentation than handed to a project vendor. See [[build-vs-buy-devops-tools]] for the same reasoning about tools.

## Scope deliverables as code with acceptance criteria

A deliverable that is "a migrated cluster" or "documentation" invites disputes. Define deliverables as artefacts in your repositories that your review can accept or reject.

```markdown title="statement-of-work-deliverables.md"
## Deliverable 3: Terraform modules for the shared VPC

**Artefact:** merge requests to the platform modules repository, one per module.
**Acceptance criteria:**

- [ ] Passes the repository's CI (format, validate, lint, policy checks, plan in the test project).
- [ ] Follows the module standards: pinned providers, documented inputs and outputs, examples.
- [ ] Reviewed and approved by two platform engineers (employees), per CODEOWNERS.
- [ ] Applied to the staging environment by the platform pipeline, not from a laptop.
- [ ] Runbook and README updated; operability checks (alerts, dashboards) in place.
- [ ] A recorded walkthrough for the platform team, plus a Q&A session.
      **Not accepted:** changes applied outside the pipeline, shared credentials, undocumented manual steps.
```

The same structure works for a managed service onboarding: the service is "accepted" when monitoring, runbooks, escalation and access are in place and tested, not when the contract starts.

Agree with legal and procurement how acceptance relates to payment and what happens when a deliverable fails acceptance. That is a contract question; the engineering input is a clear, testable definition.

## Access model

The principle: external people get the minimum access, through the same controls as employees, with an end date set on day one, and no change reaches production without review by an employee.

- **Identities.** Each person has their own identity. No shared accounts, no "vendor admin" login used by a team. If your identity provider supports guest or federated identities for the vendor, use them so that the vendor's own leaver process also cuts access; confirm the setup with your identity team.
- **Dedicated groups.** External people go into dedicated groups (for example `vendor-migration@example.com`) that hold only external members. Grant roles to the group, never to individuals, and never add externals to employee groups. Group design is in [[iam-groups-and-ci-workload-identity-federation]].
- **Expiry on every grant.** Every role binding for an external group carries an IAM Condition that ends it at the contract end date. GitLab memberships carry an expiry date.
- **Privileged access just in time.** Standing access is read-only or limited to non-production. Production write access is requested per task through Privileged Access Manager or your equivalent, with approval by an employee and a short duration. See [[privileged-access-just-in-time-gcp-gke]].
- **No service account keys.** Contractors do not receive keys. Automation they build runs in your CI, which authenticates with workload identity federation, as in [[iam-groups-and-ci-workload-identity-federation]].
- **Separation of duties.** An external engineer can author a change; an employee approves it, and the pipeline deploys it. The same rules as in [[separation-of-duties-in-deployments]], applied without exceptions for "trusted" vendors.
- **Onboarding through the same path.** Use the employee onboarding checklist, minus what does not apply, see [[onboarding-engineers]]. It ensures the security basics are read and signed off.

### Time-bound GCP access with an IAM Condition

Google Cloud supports temporary access through an IAM Condition on the role binding, using `request.time` and a UTC timestamp in RFC 3339 format. A conditional binding only limits itself: if the same principal also has an **unconditional** binding of the same role, the unconditional one still applies. Check for existing bindings first.

```bash title="grant-vendor-access.sh"
#!/usr/bin/env bash
# Grants a role to an external group until the contract end date.
# Check the flags with: gcloud projects add-iam-policy-binding --help
set -euo pipefail

PROJECT_ID="example-migration-staging"
VENDOR_GROUP="vendor-migration@example.com"
ROLE="roles/container.developer"          # least privilege for the task; never a basic role
CONTRACT_END="2026-12-31T23:59:59Z"       # UTC, RFC 3339

# 1. Existing bindings for the group: an unconditional binding of the same role defeats the expiry.
gcloud projects get-iam-policy "$PROJECT_ID" \
  --flatten="bindings[].members" \
  --filter="bindings.members:group:${VENDOR_GROUP}" \
  --format="table(bindings.role, bindings.condition.title, bindings.condition.expression)"

# 2. Add the time-bound binding. The condition fields are separated by commas,
#    so the description must not contain a comma.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="group:${VENDOR_GROUP}" \
  --role="$ROLE" \
  --condition="expression=request.time < timestamp(\"${CONTRACT_END}\"),title=vendor-contract-end,description=Access ends with the statement of work"

# 3. Verify.
gcloud projects get-iam-policy "$PROJECT_ID" \
  --flatten="bindings[].members" \
  --filter="bindings.members:group:${VENDOR_GROUP}" \
  --format="table(bindings.role, bindings.condition.expression)"
```

If you manage the policy as a file and apply it with `set-iam-policy`, set the policy `version` to 3: operations on conditional bindings must use policy version 3. In Terraform, the same binding takes a `condition` block; manage IAM for a project in one way only, so a manual binding and a Terraform binding do not fight.

When the date passes, the binding stops granting access but stays in the policy. Remove it as part of the exit (below) and in the regular access review.

### Expiring GitLab membership

GitLab's members API takes an optional `expires_at` date (`YYYY-MM-DD`) when you add or update a project or group member. Access levels are numeric (for example 30 is Developer, 40 is Maintainer; check the API page for the full list in your version).

```bash title="add-vendor-gitlab-member.sh"
#!/usr/bin/env bash
# Adds an external user to a project as Developer, with an expiry date.
set -euo pipefail

GITLAB_URL="https://gitlab.example.com"
PROJECT="platform/network-modules"        # full path or numeric ID
VENDOR_USER_ID="4321"                     # the external user's GitLab user ID
ACCESS_LEVEL=30                           # Developer; protected branch rules decide what they may merge
EXPIRES_AT="2026-12-31"                   # YYYY-MM-DD, the contract end date
: "${GITLAB_TOKEN:?export GITLAB_TOKEN with permission to manage members}"

project_enc="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$PROJECT")"

curl --fail --silent --show-error --request POST \
  --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
  --data "user_id=${VENDOR_USER_ID}" \
  --data "access_level=${ACCESS_LEVEL}" \
  --data "expires_at=${EXPIRES_AT}" \
  "${GITLAB_URL}/api/v4/projects/${project_enc}/members"
```

The same field exists on group members (`/groups/:id/members`) and invitations. With the GitLab CLI, `glab repo members add` takes `--expires-at`; check `glab repo members add --help` for the role names in your version. Do not give externals Maintainer or Owner on repositories where protected branches and approval rules are the control that enforces review.

### Report what is about to expire, and what never will

Expiry only helps if someone looks before and after the date. The script below reads a project's allow policy and lists every binding that involves external principals: permanent ones (no expiry), expired ones still in the policy, ones expiring soon, and basic roles. Run it in a scheduled pipeline for each project that external people touch.

```python title="vendor_access_report.py"
#!/usr/bin/env python3
"""Report IAM bindings that involve external principals, with their expiry. Standard library only.

Input: an allow policy as JSON (gcloud ... get-iam-policy --format=json) on stdin or as a file.
Flags permanent bindings, expired bindings still in the policy, expiries within WARN_DAYS,
and basic roles. Exit 1 when anything is flagged, so it can run in a scheduled pipeline.
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone

EXTERNAL = ("@vendor.example", "@partner.example")  # domains of contractor and MSP identities
EXTERNAL_GROUPS = ("vendor-",)  # internal groups that hold only external members, by prefix
BASIC_ROLES = {"roles/owner", "roles/editor", "roles/viewer"}
WARN_DAYS = 14
EXPIRY_RE = re.compile(r'request\.time\s*<\s*timestamp\("([^"]+)"\)')


def is_external(member):
    _, _, ident = member.partition(":")
    return ident.endswith(EXTERNAL) or ident.startswith(EXTERNAL_GROUPS)


def expiry_of(binding):
    match = EXPIRY_RE.search((binding.get("condition") or {}).get("expression", ""))
    return datetime.fromisoformat(match.group(1).replace("Z", "+00:00")) if match else None


def main():
    source = open(sys.argv[1], encoding="utf-8") if len(sys.argv) > 1 else sys.stdin
    policy = json.load(source)
    now = datetime.now(timezone.utc)
    flagged = 0
    for binding in policy.get("bindings", []):
        role = binding["role"]
        expiry = expiry_of(binding)
        for member in binding.get("members", []):
            if not is_external(member):
                continue
            problems = []
            if expiry is None:
                problems.append("PERMANENT (no request.time expiry)")
            elif expiry <= now:
                problems.append("EXPIRED but still in the policy: remove it")
            elif expiry - now <= timedelta(days=WARN_DAYS):
                problems.append(f"expires within {WARN_DAYS} days: renew or let it lapse on purpose")
            if role in BASIC_ROLES:
                problems.append("BASIC ROLE: use a predefined or custom role")
            flagged += bool(problems)
            when = expiry.isoformat() if expiry else "never"
            print(f"{member:<45} {role:<35} expires {when:<26} {'; '.join(problems) or 'ok'}")
    print(f"{flagged} binding(s) flagged")
    sys.exit(1 if flagged else 0)


if __name__ == "__main__":
    main()
```

```bash title="run-vendor-access-report.sh"
#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="example-migration-staging"

gcloud projects get-iam-policy "$PROJECT_ID" --format=json \
  | python3 vendor_access_report.py
```

Output against a sample policy (illustrative):

```text
group:vendor-migration@example.com            roles/container.developer           expires 2026-12-31T23:59:59+00:00  ok
group:vendor-migration@example.com            roles/logging.viewer                expires never                      PERMANENT (no request.time expiry)
user:dev1@vendor.example                      roles/editor                        expires never                      PERMANENT (no request.time expiry); BASIC ROLE: use a predefined or custom role
user:dev2@partner.example                     roles/compute.viewer                expires 2026-10-01T00:00:00+00:00  EXPIRED but still in the policy: remove it
3 binding(s) flagged
```

It reads one project's policy only. Bindings at folder or organisation level, and conditions written in other forms, are not covered; the regular access review in [[access-reviews-gcp-and-gke]] is the backstop.

## Operating interface with an MSP

A managed service works when the boundary is written down and rehearsed. Agree, in an operations annex to the contract that engineering writes with procurement and legal:

| Activity                             | MSP         | Platform team | Notes                                                   |
| ------------------------------------ | ----------- | ------------- | ------------------------------------------------------- |
| First response to alerts (24x7)      | Responsible | Informed      | Alerts, runbooks and severity definitions come from you |
| Escalation for SEV1 and SEV2         | Responsible | Accountable   | Your incident commander leads major incidents           |
| Routine changes (standard catalogue) | Responsible | Accountable   | Through your pipeline and change process, never by hand |
| Non-standard changes                 | Consulted   | Responsible   | Your review and approval                                |
| Postmortems                          | Contributes | Accountable   | Your format and review, shared action items             |
| Capacity, cost and upgrades          | Consulted   | Accountable   | Your roadmap, their input                               |
| Access requests                      | Requests    | Approves      | Just-in-time, recorded, reviewed                        |

Points to settle explicitly:

- **Service levels.** Response and resolution targets per severity, how they are measured (from your paging tool, not their ticket system) and reported. What happens when they are missed is a contract matter; ask legal.
- **Escalation path.** Named roles and contact routes on both sides, tested in a drill. Include how the MSP reaches your on-call and how you reach their duty manager.
- **Runbooks and alerts stay yours.** The MSP follows and improves them by merge request. If the MSP's own runbooks live only in their system, you cannot operate the service if the contract ends.
- **Incidents and postmortems.** Your incident process applies, see [[incident-response]]. The MSP contributes timelines and actions; you own the review.
- **Access-log review.** Review what the MSP's identities did, monthly. Cloud Audit Logs record Admin Activity and System Event logs always; Data Access logs are off by default (except for BigQuery) and must be enabled for the services where you need read audit, at a log-volume cost.
- **Regulated entities.** If your organisation falls under EU DORA (the regulation, not the delivery metrics) or similar rules, third-party ICT provider requirements may apply to the MSP contract. That needs legal and compliance review; see [[dora-eu-operational-resilience-for-engineers]] for the engineering side.

A query to start the monthly review, for one project:

```bash title="review-vendor-activity.sh"
#!/usr/bin/env bash
# Lists Admin Activity audit entries made by external identities in the last 30 days.
# Check the filter syntax and flags with: gcloud logging read --help
set -euo pipefail

PROJECT_ID="example-migration-staging"
VENDOR_DOMAIN="vendor.example"

gcloud logging read \
  "logName=\"projects/${PROJECT_ID}/logs/cloudaudit.googleapis.com%2Factivity\" AND protoPayload.authenticationInfo.principalEmail:\"@${VENDOR_DOMAIN}\"" \
  --project="$PROJECT_ID" \
  --freshness=30d \
  --format="table(timestamp, protoPayload.authenticationInfo.principalEmail, protoPayload.methodName, protoPayload.resourceName)"
```

Activity performed through a group membership still shows the individual principal, which is one more reason for individual identities. Keep the review output as evidence, see [[audit-evidence-collection-and-retention]].

## Knowledge-transfer obligations

Write knowledge transfer into the scope from the start, with time budgeted on both sides. A handover squeezed into the last week does not happen.

- **Everything in your repositories.** Code, configuration, runbooks, diagrams and decisions live in your systems from day one, not in the vendor's wiki or a personal drive.
- **Decisions as ADRs.** Significant design choices made during the engagement are recorded as ADRs and reviewed by your team.
- **Pairing.** At least one employee pairs on each major workstream throughout, not just at the end. Track coverage the way [[bus-factor-and-knowledge-transfer]] describes.
- **Walkthroughs.** Recorded sessions per deliverable, plus a Q&A, as acceptance criteria.
- **Operate before exit.** Before the contract ends, your team runs the service or the migrated system for a period (for example two on-call rotations, example value) with the vendor available as backup.

## Security and compliance

- **Contracts, NDAs, data processing and IP.** Ask legal. Engineering's input is which data the vendor will see, which systems they touch and from where.
- **Licences of delivered code.** Code the vendor delivers may include third-party open-source components. Run the same licence checks as for your own code, see [[open-source-license-compliance]]. Ownership of the code itself is a contract question.
- **Devices and networks.** Agree how external people connect (managed devices, your access proxy) with your security team.
- **Audit evidence.** Keep the grant records, approvals, access reviews and removal evidence, see [[audit-evidence-collection-and-retention]].

## Cost control

- **Time and materials** pays for effort. It suits work you direct (augmentation) and uncertain scope, but the cost is open-ended: track burn against budget every week.
- **Fixed price** pays for outcomes. It suits well-defined deliverables, but scope changes become change requests, and a vendor under price pressure may cut corners that your acceptance criteria must catch.
- **Managed service fees** are usually recurring. Compare them over several years against the cost of hiring and running the service yourself, including on-call.
- **Weekly burn report.** Hours or spend to date, forecast to completion, and deliverables accepted, against the budget line in [[engineering-budget-planning]]. Flag early when burn runs ahead of acceptance.
- **Your own time counts.** Reviews, pairing, onboarding and management of the vendor cost your team time. Put it in the plan, or it comes out of other work silently.

## Exit plan

Plan the exit when you plan the start, and rehearse the parts you can.

1. **Before the end date:** confirm all deliverables are accepted and knowledge transfer is complete; your team has operated the service.
2. **On the end date:** expiries take effect. Remove external members from the dedicated groups in your identity provider; remove expired IAM bindings and GitLab memberships; revoke any just-in-time entitlements; disable the vendor's identities if you host them.
3. **Rotate what they knew.** Any shared secret, break-glass credential or token the vendor could see is rotated, prioritised by risk. Use [[leaked-credential-rotation]] as the procedure.
4. **Transfer assets.** Repositories, documentation, dashboards, alert routes, tickets and on-call schedules move to your ownership. Pipeline schedules or bots owned by external accounts get new owners.
5. **Verify.** Re-run the access report: no external bindings. Re-run the audit log query for any activity after the end date. Keep both outputs as evidence.
6. **Retrospective.** What worked, what to change in the next engagement.

The steps mirror the leaver process for employees in [[offboarding-platform-engineers]]; reuse that checklist rather than maintaining two.

## Common mistakes

- **Access without an end date.** The project ends and the access does not. Set expiry on day one, everywhere.
- **Shared vendor accounts.** No individual accountability, no clean exit. One identity per person.
- **Externals in employee groups.** They inherit every future grant to that group. Use dedicated groups.
- **An unconditional binding next to the conditional one.** The expiry has no effect. Check existing bindings first.
- **Vendor-owned runbooks and tooling.** When the contract ends, so does your ability to operate. Everything lives in your repositories.
- **Accepting deliverables by date, not by criteria.** Define acceptance as reviewable artefacts.
- **The MSP as a black box.** No access-log review, no shared postmortems, no drills. You still own the outcome.
- **Handover in the last week.** Budget knowledge transfer from the start.

## Sources

- [Google Cloud IAM: configuring temporary access](https://docs.cloud.google.com/iam/docs/configuring-temporary-access): `request.time` conditions and the `--condition` shape.
- [Google Cloud IAM Conditions overview](https://cloud.google.com/iam/docs/conditions-overview): conditional and unconditional bindings of the same role.
- [Google Cloud IAM: managing conditional role bindings](https://docs.cloud.google.com/iam/docs/managing-conditional-role-bindings): policy version 3.
- [Privileged Access Manager overview](https://docs.cloud.google.com/iam/docs/pam-overview): entitlements, time-boxed grants, approvals; check pricing and limits.
- [GitLab project members API](https://docs.gitlab.com/api/project_members/) and [group members API](https://docs.gitlab.com/api/group_members/): `expires_at` and access levels.
- [GitLab CLI: glab repo members add](https://docs.gitlab.com/cli/repo/members/add/): `--expires-at`.
- [Cloud Audit Logs](https://docs.cloud.google.com/logging/docs/audit): which audit logs are always on and which must be enabled.

## Related

- [[offboarding-platform-engineers]] and [[onboarding-engineers]]: the joiner and leaver checklists to reuse.
- [[access-reviews-gcp-and-gke]] and [[privileged-access-just-in-time-gcp-gke]]: reviewing and elevating access.
- [[separation-of-duties-in-deployments]]: author, approver and deployer.
- [[iam-groups-and-ci-workload-identity-federation]]: groups and keyless CI.
- [[devops-vendor-and-licence-management]] and [[build-vs-buy-devops-tools]]: the tool side of vendors.
- [[engineering-budget-planning]]: where the engagement's budget line lives.
- [[open-source-license-compliance]] and [[audit-evidence-collection-and-retention]]: compliance obligations.
- [[dora-eu-operational-resilience-for-engineers]]: the EU regulation's engineering side.
