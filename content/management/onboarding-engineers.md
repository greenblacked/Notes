---
title: Onboarding a DevOps or platform engineer
description: Access checklist, 30/60/90 plan with concrete milestones, buddy system and measures for onboarding a new DevOps or platform engineer.
type: guide
tags:
  - management
  - leadership
  - team-process
  - hiring
created: 2026-10-16
modified: 2026-10-16
draft: false
---

A platform engineer's first weeks are mostly waiting on access and learning where things are. Good onboarding removes the waiting before day one, gives a clear sequence of small wins, and ends with the person safely on the pager. This guide assumes a GCP, Kubernetes, GitLab and Artifactory stack.

## Before day one

Raise access requests at least a week ahead. Most delays come from approval chains, and a new joiner with no access for three days has already formed an opinion of the team.

| Area            | Access                                                                              | Notes                                                                                       |
| --------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Identity        | Company SSO, group mailbox, chat, calendar                                          | Add to team and on-call groups, not individuals.                                            |
| GCP             | Group-based IAM (e.g. viewer on all projects, editor or specific roles on non-prod) | Grant through a group in Terraform, not by hand. No prod write access at the start.         |
| GitLab          | Developer role on the platform group, access to the CI runners' configuration repo  | Protected branch rules stay in force; the new joiner needs merge approval like anyone else. |
| Artifactory     | Read access to all repos, deploy rights to the team's own                           | Check the permission target, not just the user.                                             |
| Kubernetes      | Read-only cluster role in all clusters, namespace admin in dev                      | Bind through a Google group so removal is automatic.                                        |
| Observability   | Dashboards, alerting, log search                                                    | Read-only first.                                                                            |
| On-call tooling | Account in the paging tool, but not scheduled                                       | Check the phone number, notification rules and test page.                                   |
| Secrets         | Access to the secret manager only for non-prod                                      | See [[external-secrets-with-secret-manager]] for how secrets reach workloads.               |
| Hardware        | Laptop, 2FA key, VPN                                                                | Test the VPN and kubectl auth before day one.                                               |

Validate access the day before, with the joiner's real account where possible:

```bash
# Variables
PROJECT="my-dev-project"
CLUSTER="dev-cluster"
REGION="europe-west1"
NAMESPACE="platform-dev"

gcloud auth list
gcloud container clusters get-credentials "$CLUSTER" --region "$REGION" --project "$PROJECT"
kubectl auth can-i get pods -n "$NAMESPACE"
kubectl auth can-i delete pods -n "$NAMESPACE"
kubectl auth can-i get secrets -n "$NAMESPACE"
```

Also prepare: a starter ticket, a buddy, the first-week calendar, and a welcome message that tells them where to be and when.

> [!warning] Do not hand out prod write access on day one
> Least privilege applies to new joiners too. Grant production access in steps as milestones below are completed, and record each grant in the same Terraform change that creates the IAM binding.

## Buddy

Assign a buddy who is not the manager, has been on the team more than six months and has time. Expect two to four hours a week for the first month.

- Daily 15-minute check-in for week one, then twice a week.
- The buddy answers "stupid" questions, explains conventions that are not written down, and flags when the joiner looks stuck.
- Rotate the role. It is useful development for the buddy and prevents one person from becoming the bottleneck.
- Review the buddy's workload; it is real work and should be reflected in planning.

## Week one

- Day one: meet the team, set up the laptop, get the first merge request started (a docs or tooling fix).
- Walk through the architecture diagram, the CI pipelines (see [[gitlab-ci-pipeline-structure]]) and the repository map.
- Read the on-call runbooks index and [[incident-response]] end to end.
- 1:1 with the manager at the end of the week using the format in [[one-on-ones]], plus a written expectations document for the 30, 60 and 90 days.

## 30/60/90 plan

The plan is a conversation, not a contract. Adjust to the person's experience, but keep concrete outputs.

### Days 1 to 30: learn the system

- First merged MR in the main infra repo within the first week or two. The content matters less than going through review, CI, deploy and verification.
- Deploy a change to dev by themselves.
- Read three recent post-incident reviews ([[blameless-postmortems]]) and explain one in their own words.
- Shadow a full on-call week passively, joining handovers.
- Complete a short tour of each area: Terraform layout ([[terraform-module-and-state-layout]]), Helm conventions ([[helm-chart-conventions]]) and cluster basics.

### Days 31 to 60: contribute

- First shadow on-call: on the secondary rotation, receive pages with the primary beside them, and write up what they would have done.
- First runbook improvement: pick a runbook from the last incident, run it in a non-prod environment, and fix what is wrong or missing.
- Own a small, well-scoped task end to end (a Helm chart upgrade, a CI template change) including rollout and verification.
- Pair on a non-prod change that touches Terraform state, with review from the buddy.

### Days 61 to 90: own

- Take a defined area of ownership, such as one service's pipeline or one cluster add-on, with a named backup (see [[delegation-and-ownership]]).
- First primary on-call shift with a safety net: the buddy or another senior is secondary and available.
- Present a short write-up of something they would change, with evidence, to the team.
- Prod change access, granted through the normal process after at least one reviewed prod change under supervision. Reference [[production-change-checklist]].
- Review against goals with the manager; set the next quarter's objectives and a first look at [[career-ladder-devops]].

## Measuring whether onboarding worked

Use signals, not impressions.

| Signal                                      | Target to aim for                  | How to check              |
| ------------------------------------------- | ---------------------------------- | ------------------------- |
| Time to first merged MR                     | Within the first two weeks         | GitLab                    |
| Time to first independent dev deploy        | Within the first month             | Pipeline history          |
| Access gaps raised after day one            | Zero blockers in week one          | Tickets the joiner opened |
| Shadow on-call completed                    | By day 60                          | On-call schedule          |
| Runbook changes                             | At least one merged                | Runbook repo              |
| Confidence self-rating (1 to 5) at 30/60/90 | Rising; no one at 1 or 2 at day 90 | Short survey at 1:1       |
| Buddy and manager feedback                  | Consistent picture                 | 1:1 notes                 |

Ask the joiner at day 30 and day 90: "What was missing from the onboarding docs?" Fix those documents the same week. The best onboarding checklist is edited by the last three hires.

Treat a slow start as a system signal first. If three joiners in a row struggle with the same access step or document, the problem is the process. If it is one person, handle it through feedback as described in [[performance-feedback]].

## Related

- [[hiring-devops-engineers]] sets the expectations that onboarding must then deliver.
- [[on-call-health]] explains why the shadow period matters.
