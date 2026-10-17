---
title: Splitting, merging and reorganising teams
description: "A checklist runbook for a team reorg: readiness, ownership and on-call re-cut, access moves, communication, a week -2 to week 4 timeline and rollback triggers."
type: guide
tags:
  - management
  - team-process
  - on-call
  - leadership
created: 2026-10-17
modified: 2026-10-17
draft: false
---

Reorgs fail in the gaps. The org chart changes on a Monday, and on Tuesday an alert pages a rotation nobody is in, a merge request waits for a reviewer who moved teams, and a service has two owners or none. This runbook covers the **change event itself**: readiness, transition, communication and the first 30 days. It does not cover whether to reorganise, how to design the teams or how to run the people conversations. For the team design side, start from [[team-charter]]; for the people side, use your HR process.

It applies to three shapes: **splitting** one team into two, **merging** two teams into one, and **moving** a set of services from one team to another. The checklists are the same; only the volume differs.

> [!info] Defaults, not rules
> The timeline values (week -2, 30 days, thresholds in the rollback triggers) are suggested defaults. Adjust them to your team size and to how much operational load the services carry. The CODEOWNERS syntax shown below for GitLab and GitHub is **not verified** against the current documentation of either product. Check before relying on it.

## Readiness assessment

Do this at least two weeks before the change. The goal is a written list of every place where "who owns this" is encoded in a system, because those places will keep pointing at the old structure until someone edits them.

Treat each item as a gate. If you cannot tick it, either fix it or write down who carries the risk until it is fixed.

- [ ] **Service map.** Every service, job, pipeline, Terraform root, Helm chart and dashboard in scope is listed with its current owner and its new owner. Include the quiet ones: cron jobs, certificate renewals, shared buckets, DNS zones and the Chef cookbooks nobody has touched in a year.
- [ ] **Rotation gaps.** For each new on-call rotation, count the people. Check the minimum from [[on-call-health]] and your own page load. List every person who is on a rotation today and changes team, and every rotation that loses people. A rotation with too few people is the most common reorg incident.
- [ ] **Open pull and merge requests.** List open MRs in scope with their reviewers and approvers. Each one either lands before the change, is reassigned, or is closed with a note. Approval rules that name a group the reviewer has left will block silently.
- [ ] **Dashboards and alert routes.** Every alert in scope has a route to the new owner. Check Prometheus alert labels (`team`, `owner`), Alertmanager routes, paging-tool services and escalation policies, and the notification channels. Dashboards carry an owner field or folder.
- [ ] **Runbook owners.** Every runbook in scope has a named owner on the new team. A runbook link in an alert that leads to a page owned by a team that no longer exists is a defect.
- [ ] **IAM group remap.** The cloud and tool groups that grant access follow the new structure, as in [[iam-groups-and-ci-workload-identity-federation]]. List each group, its members today, its members after, and the resources it grants. Remember GKE RBAC bindings, GitLab groups and projects, Artifactory permission targets, Jenkins folders, SonarQube permissions and Cloudflare Access policies.
- [ ] **Escalation paths and contacts.** The escalation chain for each service names real people on the new structure. Check the incident commander pool and the stakeholder contact list (see [[stakeholder-communication]]).
- [ ] **Shared secrets and credentials.** List credentials owned by a person or a group that changes. Rotate or re-assign as needed; see [[leaked-credential-rotation]] for the mechanics.
- [ ] **Planned work.** Commitments, roadmap items and cross-team dependencies are re-assigned to a team, not left with a name. See [[cross-team-dependencies]].

A short worksheet helps. One row per service:

| Service           | Old owner     | New owner     | On-call rotation | Alert route changed | Runbook owner | IAM groups changed |
| ----------------- | ------------- | ------------- | ---------------- | ------------------- | ------------- | ------------------ |
| checkout-api      | payments-team | payments-core | core-primary     | no                  | done          | pending            |
| ledger-exporter   | payments-team | payments-data | data-primary     | pending             | pending       | pending            |
| shared-tf-modules | payments-team | platform      | none (business)  | n/a                 | done          | done               |

The names above are examples. Replace them with your own services and teams.

## Ownership and on-call re-cut

Ownership has to be explicit, singular and recorded in a place systems can read. A service owned by "both teams" is owned by neither.

1. **One owning team per service.** Where a service is genuinely shared, name the team that holds the pager and the team that is a contributor. Write the split in the service's README and in the team charters.
2. **Re-cut the rotations before you re-cut the people.** Decide the rotation membership from the readiness assessment, then schedule it. Do not rely on "we will sort out who is on call after".
3. **Overlap until the end of week 2.** For at least one full rotation cycle, from cutover (week 0) to the end of week 2, the outgoing owner stays as a secondary on services they handed over. This is a deliberate overlap, with an end date, not an open-ended favour.
4. **Handover per service.** The previous owner gives the new owner a short written handover: what breaks, what the noisy alerts are, what is fragile, what was promised to other teams, where the runbooks live. Use the handover template in [[on-call-health]].
5. **Keep scope honest.** If the new team is too small to cover everything with a healthy rotation, narrow the scope (business-hours only for low-impact services, agreed with stakeholders) rather than pretending.
6. **Record it in code.** Ownership lives in `CODEOWNERS`, alert labels, service catalogue entries and the charter. Update them in the same change set. Do not leave it in a slide.

### CODEOWNERS diff example

A team splits into a core team and a data team. The change below moves path ownership in one merge request, so the approval rules follow the people on the day of the change. Syntax shown is GitLab style, with sections. See the callout after the example.

```diff title="CODEOWNERS"
-[Payments]
-/services/checkout-api/ @example-org/payments-team
-/services/ledger-exporter/ @example-org/payments-team
-/charts/checkout-api/ @example-org/payments-team
-/terraform/payments/ @example-org/payments-team
+[Payments core]
+/services/checkout-api/ @example-org/payments-core
+/charts/checkout-api/ @example-org/payments-core
+/terraform/payments/ @example-org/payments-core
+
+[Payments data]
+/services/ledger-exporter/ @example-org/payments-data
```

The same change for GitHub, which has no sections. Each line is a path pattern followed by the owners, and the last matching pattern wins:

```diff title=".github/CODEOWNERS"
-/services/checkout-api/ @example-org/payments-team
-/services/ledger-exporter/ @example-org/payments-team
+/services/checkout-api/ @example-org/payments-core
+/services/ledger-exporter/ @example-org/payments-data
```

Rules for this change:

- Make the CODEOWNERS change in its own merge request, reviewed by the **new** owners, and merge it on the cutover day, not before.
- Make sure every group named in the file exists and has members before the merge. A path owned by an empty or missing group can leave merge requests unapprovable.
- Keep a fallback owner for paths no one claims, so nothing is left without a reviewer.

> [!warning] CODEOWNERS syntax is not verified
> The section syntax for GitLab (`[Section]`, optional sections, approval counts, group owners) and the `@org/team` owner format for GitHub are written from memory. Whether group owners need specific access levels, how a missing group behaves, and whether sections need a particular GitLab tier are **not verified**. Check the current documentation of your product, and test the file on a throwaway merge request, before cutover day.

## Access and alert routing moves

Access and alerts are where a reorg turns into an outage or a security gap, so move them in a defined order.

**Access: grant first, remove later.**

1. Create the new groups and add the new members in week -1, as in the timeline (the groups carry no access yet).
2. Grant the new groups the access they need. Do it in code, not by hand, using the same mechanism as the old groups, so it appears in review.
3. Keep the old access for the overlap period (see the timeline). People who handed over a service may still need to help.
4. Remove the old access at the end of the overlap, then run an access review. The method is in [[access-reviews-gcp-and-gke]].
5. Check what each person can no longer reach that they still need, and what they can still reach that they should not.

Least privilege still applies. A reorg is not a reason to hand out broad roles "to be safe". Prefer groups to individual grants.

**Alert routing: new route live before the old one is removed.**

1. Add the new routes (Alertmanager receivers and routes, paging services, escalation policies) alongside the old ones.
2. Send a test alert to every new route and confirm a human received it. Do this per rotation, on the day before cutover.
3. On cutover, switch the primary route and keep the old route as a secondary for the overlap.
4. At the end of the overlap, remove the old route and delete the old paging service, so an alert does not page an empty group.

An example label scheme that makes the move a one-line change, because routes match on the `team` label that ships with each alert:

```yaml title="alertmanager-routes.yaml"
route:
  receiver: default
  routes:
    - matchers:
        - team = "payments-core"
      receiver: payments-core-pager
    - matchers:
        - team = "payments-data"
      receiver: payments-data-pager
receivers:
  - name: default
  - name: payments-core-pager
  - name: payments-data-pager
```

Receiver configuration (the paging integration and its credentials) is left out on purpose. Keep those in your secret store, not in the file.

## Communication sequence

Order matters more than polish. People who learn about a change from a calendar invite or a rumour lose trust in the process.

1. **Decision makers and affected managers.** Everyone who must agree on scope and dates. Agree the one-paragraph rationale.
2. **The people most affected, one to one,** by their manager, before any group message. Cover what changes for them, what does not, and the dates. This follows your HR process and local rules, and may involve legal or employee-representation steps that you must check.
3. **The affected teams together,** the same day or the next. Cover the why, the new structure, the dates, the on-call changes and where to ask questions.
4. **Stakeholders and dependent teams.** Product owners, security, support, and any team that depends on the services. Tell them who owns what from when, and where to escalate. See [[stakeholder-communication]].
5. **The wider organisation,** once the above are done, through your normal channel.
6. **Reminders** at the start of week 1, week 2 and week 4, short and factual.

Rules for every message: say what changes, from when, who to ask, and what stays the same. Do not announce a change before the people most affected know. Do not promise things you do not control.

### FAQ to publish with the announcement

Write answers for your own situation. The questions below are a starting set.

| Question                                                  | What a good answer contains                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Who owns service X now?                                   | A link to the service map and to CODEOWNERS, not a name in a chat message.                         |
| Who is on call for X, and since when?                     | The rotation name, the first date, and where the schedule is.                                      |
| What happens to my open MRs and reviews?                  | The rule: land, reassign or close by a date, and who to ask.                                       |
| Do I lose access to what I worked on?                     | The overlap period, the end date and how to request access if needed.                              |
| Where do I send requests that used to go to the old team? | The new intake channel, and how long the old one forwards.                                         |
| Who is my manager, and what happens to my one to ones?    | Answered by each manager directly. See [[one-on-ones]].                                            |
| What do I do if an alert pages the wrong team?            | Page the secondary on the overlap rota, then fix the route and report it in the transition thread. |
| Who decides if something is not covered here?             | One named person for the transition, and where to reach them.                                      |

Keep a single transition thread or channel for questions and fixes. It doubles as the log for the 30-day check.

## Timeline from week -2 to week 4

Suggested defaults, not rules. Shorten for a small move, lengthen for a large one.

| When    | What happens                                                                                                                                               | Owner                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Week -2 | Readiness assessment finished. Service map, rotation gaps and IAM remap drafted. Decision makers aligned.                                                  | Engineering manager        |
| Week -1 | One to ones held. Teams told. Test alerts sent to new routes. New groups created. CODEOWNERS and routing merge requests open and reviewed.                 | Managers, leads            |
| Week 0  | Cutover day: CODEOWNERS merged, primary alert routes switched, rotations start, new access granted. Old routes and access stay as secondary.               | Engineering manager        |
| Week 1  | Overlap (weeks 0 to 2): outgoing owners are secondary on handed-over services. Daily check of the transition thread. Fix routing and access gaps same day. | Leads                      |
| Week 2  | First on-call review of the new rotations: pages per shift, missed or misrouted alerts. Handover gaps fixed. Open MRs all resolved.                        | Leads, engineering manager |
| Week 3  | Overlap ends: old alert routes and old access removed. Access review run on the new groups.                                                                | Leads, security            |
| Week 4  | 30-day check preparation: collect numbers, run a short retrospective, update the charters and runbooks.                                                    | Engineering manager        |

The cutover day is best chosen away from release freezes and busy periods. See [[change-freezes-and-maintenance-windows]].

## Rollback triggers

Define these before the change, agree them with the decision makers, and write them in the transition thread. A trigger that is only decided after things go wrong is an argument, not a trigger.

A rollback here means **restoring the previous ownership and routing for the affected services**, not undoing the whole reorg. Because the old routes and access stay in place during the overlap, this is a quick change: revert the CODEOWNERS merge request and switch the primary route back.

Suggested triggers, to adjust to your context:

- **A page goes unacknowledged.** Any page for a production service in scope is not acknowledged within the agreed time, because it reached the wrong or an empty rotation. One occurrence on a customer-facing service is enough to roll that service back.
- **A rotation is not viable.** A new rotation has fewer people than its agreed minimum for longer than a day, with no named cover.
- **Access blocks an incident.** A responder cannot reach a system they need during an incident, and the fix is not available within the incident.
- **Merge requests cannot be approved.** Changes to a service in scope cannot be approved by any listed owner, and the fix is not trivial.
- **Load limit breached.** The out-of-hours pages per person in the first two weeks exceed the limit you set in advance. Compare with the numbers from [[on-call-health]].

When a trigger fires: roll back the affected service, not the whole change; record what happened in the transition thread; fix the cause; and set a new date for that service. A rollback is a normal part of a controlled change, not a failure of the plan.

## 30-day check

At about 30 days, review whether the change did what it was meant to do. Keep it short and factual.

- **Ownership.** Every service in scope has exactly one owning team in CODEOWNERS, the service catalogue and the alert labels. Run a script or query to find the exceptions.
- **On-call.** Page counts per shift, out-of-hours load per person, misrouted pages, and the number of pages that needed the old owners.
- **Access.** The old access is gone. The access review found no unexplained grants. No one needed emergency access that the design should have covered.
- **Delivery.** Compare lead time, review time and deployment frequency for the affected teams with the period before, using the same method (see [[dora-metrics]]). Expect a dip; look for a trend, not a snapshot.
- **People.** Check in one to one with each affected person. Ask what is unclear, what is slower, and what they would change. Watch for the burnout signals in [[on-call-health]].
- **Documents.** Charters, runbook owners and the service map are updated. New people get the right introduction through [[onboarding-engineers]].
- **Decisions.** Write down what you would change next time and add it to this runbook.

Close the transition thread with a short summary to the same audience that received the announcement.

## Related

- [[team-charter]] for the operating contract each resulting team writes.
- [[on-call-health]] for rotation design, handover and load metrics.
- [[stakeholder-communication]] for telling the people who depend on the services.
- [[onboarding-engineers]] for bringing movers and new joiners up to speed.
- [[iam-groups-and-ci-workload-identity-federation]] for the group model behind the access remap.
- [[access-reviews-gcp-and-gke]] for the review after access is moved.
- [[cross-team-dependencies]] for commitments that cross the new team boundaries.
