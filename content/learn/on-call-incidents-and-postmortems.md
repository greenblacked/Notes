---
title: "Incidents 02: Your first on-call shift, incidents and blameless postmortems"
description: Prepare for a shift, handle a page and run a small incident, then turn the evidence into a timeline, contributing factors and action items without blame.
type: guide
tags:
  - learning
  - on-call
  - incident-management
  - reliability
  - observability
created: 2026-10-17
modified: 2026-10-17
draft: false
---

> [!info] Level: middle | Time: about 6 h | You need: [[learn/troubleshooting-method|Incidents 01: A troubleshooting method]] and [[learn/first-prometheus-alert|Observability 03: Your first Prometheus alert]] | Lab: no cluster needed; Lab A (any shell with `date` and a text editor) from [[learn/lab-setup|Start 01: Set up your lab]]

Being on call means that, for a set time, you are the person the pager reaches when a service breaks. It is a skill, and like any skill it is learned by preparing, by following a calm routine when it happens and by studying what happened afterwards. This lesson covers all three: before the shift, during an incident and after it.

You will use made-up material throughout: a fake page, a fake incident called "cart v2.3" and a raw export of events. None of it is real, so you can practise without risk.

## What you will learn

- What to check and prepare before your first shift, and what a good handover contains.
- What to do in the first five minutes after a page, and how to set a severity before you know the cause.
- How to run a small incident: roles, a channel, regular updates, escalation and mitigation before root cause.
- How to build a timeline from alerts, pipelines, deploy history, Cloud Audit Logs and chat, in UTC, and separate what you observed from what you inferred or believed.
- How to compute time to detect, mitigate and resolve, and how to find contributing factors without blame.
- How to write action items that someone can verify, and how to take part in the review.

## Before your first shift

Do this a few days ahead, not when the pager buzzes. Walk through the list below with a person who has done the shift, and fix every gap.

| Check               | What "ready" means                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Paging app          | Installed, logged in, notifications set to break through "do not disturb", and a **test page** received                  |
| Network access      | VPN or identity-aware proxy works from the place you will be, and from your phone as a fallback                          |
| Cloud console       | You can open the Google Cloud console and see the production projects you support (read access at least)                 |
| Cluster access      | `kubectl` has a context for each production cluster, and `kubectl get pods -n <namespace>` works                         |
| Dashboards and logs | You know the main dashboards, can run a log query, and have them bookmarked                                              |
| Runbooks            | You know where they are, and you have read the ones for the top alerts                                                   |
| Status page         | You can publish to it, or you know who can                                                                               |
| Contacts            | A list of escalation contacts (secondary, team lead, database, security, the manager on call) with working phone numbers |
| Break-glass access  | You know the process for emergency elevated access, and you have **not** used it in anger yet                            |
| Laptop and power    | Charged, with a charger and a way to get online if your home connection fails                                            |

Access that you need during a page must not be requested during a page. If a check fails, raise it now. How much on-call load a team can carry is a team-health question: [[management/on-call-health]] covers it.

> [!warning] Never test access by changing production
> A "can I get in?" check means reading, not changing. A test page, a read-only command and a login are enough.

### Handover

When a shift changes, the outgoing person gives the incoming one a short note. Without it, the new person starts blind.

A good handover has:

- **Open items:** incidents or alerts still being watched, with links and the next step.
- **Silences:** every active silence with its **reason and expiry**. A silence the next person does not know about is a hidden gap.
- **Planned changes:** deploys, migrations, maintenance, certificate renewals in the next shift.
- **Freezes:** any change freeze and why ([[standards/production-change-checklist]] covers the change side).
- **Known noise and quirks:** "the batch job at 02:00 causes a short spike; it recovers alone".
- **Who is unavailable:** people away, so you know whom not to call.

## Receiving a page

A page arrives. Your first job is to **acknowledge it**, so the system and the team know that a human has it. Do it within the time your team agreed (often a few minutes); if you do not, the page escalates to the next person.

Then spend the first five minutes on three questions.

1. **Is it real?** Does the alert match what you see in the dashboard? A flapping or stale alert is a different problem from an outage.
2. **Is it user-facing?** Are customers or calling systems affected right now? A background job that is late is not the same as checkout being down.
3. **Is it getting worse?** Look at the trend. A steady 2% is different from a rate that doubles every few minutes.

Send a first message within about five minutes, even if all it says is "I have the page and I am looking". Silence makes other people worry and duplicate your work. Then use the method from [[learn/troubleshooting-method|Incidents 01]]: precise symptom, stabilise, hypotheses, bisect, verify.

### Severity levels

A **severity** says how bad the situation is. It sets how many people join, how often you update and who must be told. Set it **early**, from what you know now, and change it later when you learn more. Waiting for the cause before you pick a severity delays help; a wrong severity costs little because it can be corrected in one message.

The table below is an example. Your organisation will have its own; learn it before your shift.

| Level | Example                                                                    | Response                                                       | Updates      |
| ----- | -------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------ |
| SEV1  | The product is down for most users, or data is being lost or exposed       | Incident lead plus several responders at once; leadership told | Every 15 min |
| SEV2  | A major feature is broken or slow for many users; there is no workaround   | Incident lead and the owning team; page the experts            | Every 15 min |
| SEV3  | A minor feature or a small share of users is affected; a workaround exists | The on-call engineer works it in working hours or in the shift | On change    |

A suspected **security** incident (credentials exposed, unexpected access) is handled by its own process and people from the first minute; read [[runbooks/leaked-credential-rotation]] and tell the security contact at once.

## Running an incident

For anything above the smallest, treat it as an incident with a little structure.

- **A channel.** One chat channel per incident (for example `#inc-cart`), so the record and the discussion are in one place. Pin the symptom, the severity and the current owner.
- **Roles.** One person is the **incident lead** (coordinates, decides, does not dig), one or more **responders** investigate, and one person is the **communicator** who writes the updates. On a small team the same person does two jobs, but you should still know which hat you are wearing.
- **Updates every 15 minutes.** Even "no change, still investigating X" counts. Regular updates stop people interrupting you for news.
- **Never work in silence.** Say what you are about to do before you do a risky thing: "I am going to restart the cart deployment now". Someone may know a reason not to.
- **Write as you go.** Use the timestamped notes from the last lesson. They are the raw material for the timeline later.

### Mitigate before root cause

The goal during the incident is to **stop the harm**, not to find the cause. The cause can wait; the users cannot. Roll back, turn off a feature, fail over, scale out, shift traffic, then investigate with less pressure. [[runbooks/incident-response]] is the team's full procedure.

### Escalation

Escalate when:

- You have no new evidence after your time-box (15 to 30 minutes).
- The impact is bigger than your severity or your authority.
- You need access or knowledge you do not have (a database, a network team, security).
- You are unsure. Unsure is a reason to ask, not to wait.

Escalating is **never** a failure and nobody gets blamed for it; being unreachable or hiding a problem is the failure. Give the person you are calling what they need so they can start at once: the symptom sentence, the severity, what you have checked and ruled out, what you have done, and exactly what you need from them.

### Closing the incident

Stop only when the symptom is gone and stayed gone, the metrics are at baseline, and the temporary measures are noted. Then:

1. Post the all-clear in the channel and the status page.
2. Write the **handover note**: what happened, what you did, anything still temporary (a silence, a manual scale-up), and the follow-ups.
3. Make sure a postmortem is scheduled for severity levels that need one. Put the date in the channel.
4. Note the times for the timeline: when it started, when it was detected, mitigated and resolved.

### Message templates

Short, factual messages help everyone. Fill in the angle-bracket parts.

```text title="First response"
I have the page for <alert name> and I am looking now.
Impact so far: <what users see, or "not yet known">.
Severity: <SEV level> (provisional). Next update by <time UTC>.
```

```text title="Update"
Update <time UTC>:
Status: <investigating | mitigating | monitoring>.
What we know: <one or two facts>. What we have done: <actions>.
What we are doing next: <next step and who>. Next update by <time UTC>.
```

```text title="Escalation"
<Name>, I need your help with <service>. Severity <level>, started <time UTC>.
Symptom: <one sentence>. Checked: <list>. Ruled out: <list>. Done so far: <list>.
What I need: <access | a decision | an expert to look at X>. I am in <channel>.
```

```text title="All clear"
Resolved <time UTC>. <Service> is back to normal: <metric at baseline for N minutes>.
Cause (as understood now): <one sentence, or "under investigation">.
Temporary measures still in place: <list or "none">.
Postmortem: <date>, owner <name>. Thanks to <people>.
```

## After the incident: the timeline

A **timeline** is the factual sequence of what happened, with times. It is the most useful part of a postmortem because the analysis is built on it. Collect the events from many places, because no single tool has the whole story.

| Source                        | What it gives you                                                            |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Alerts and the paging app     | When the system noticed, when a human acknowledged                           |
| CI pipelines                  | When a build or deploy ran, and who or what triggered it                     |
| Deploy history (Helm, GitOps) | What version was running when                                                |
| Cloud Audit Logs              | Who changed what in Google Cloud and the Kubernetes API, with a precise time |
| Metrics and dashboards        | When the symptom began and ended                                             |
| Chat                          | What people saw, believed and decided, and when                              |

Google Cloud **Admin Activity** audit logs record changes to resources, and Kubernetes API changes on GKE clusters appear in Cloud Audit Logs too. A query to list them for the window looks like this (replace `PROJECT_ID` and the times):

```bash
gcloud logging read \
  'logName="projects/PROJECT_ID/logs/cloudaudit.googleapis.com%2Factivity" AND timestamp>="2026-09-08T14:00:00Z" AND timestamp<="2026-09-08T15:15:00Z"' \
  --project=PROJECT_ID \
  --format='table(timestamp, protoPayload.authenticationInfo.principalEmail, protoPayload.methodName)' \
  --limit=50
```

> [!warning] Check before relying on this
> This command was **not run** for this page (no project was available). The log name, the filter fields and the method names (such as `io.k8s.apps.v1.deployments.update`) depend on your project's audit configuration and on the GKE version; check them in the "Cloud Audit Logs" documentation and in your own Logs Explorer before you build a procedure on them. Reading audit logs needs a permission that you must have been granted before the incident.

### Rules for a good timeline

- **All times in UTC.** Chat in local time and a pipeline in UTC give a wrong order. Convert every time and write `Z` or `UTC`. Check clocks: a laptop with a wrong clock produces nonsense.
- **One row per event**, with the source, so a reader can find the original.
- **Mark the kind of statement.** Three different things look alike in a log:
  - **Observed:** a system recorded it (an alert fired at 14:25:03Z, an audit log entry).
  - **Inferred:** worked out afterwards from data (the errors started at 14:12 because that is where the graph rises).
  - **Believed at the time:** what a person thought during the incident, which may turn out wrong ("I think the new query is slow").
- **Keep what people believed.** A wrong belief is not an embarrassment; it is the most useful evidence about how the system misled them.

### Time to detect, mitigate and resolve

Three numbers from the timeline let you compare incidents and see whether you are improving. Define them once and use them the same way.

| Measure                | From           | To                                |
| ---------------------- | -------------- | --------------------------------- |
| Time to detect (TTD)   | Impact started | Alert fired (or a human noticed)  |
| Time to mitigate (TTM) | Detection      | Harm stopped (e.g. rollback done) |
| Time to resolve (TTR)  | Impact started | Everything back to normal         |

Some teams measure each from the start of impact. The important rule is to choose one definition and write it in the postmortem.

### Contributing factors, not one root cause

"Root cause" suggests there is one thing, usually a person's action. Real incidents come from several conditions that were all needed. List **contributing factors**: things that, if different, would have prevented the incident or made it smaller. For each, ask "why was that possible?" until you reach a system property you can change, such as a missing test, a missing alert, a risky default or a gap in the process.

### Blameless wording

A **blameless** postmortem assumes people acted sensibly with the information they had at the time; it asks what in the system made the action look right, or let a mistake do damage. It is not "nobody is responsible"; it is "we fix systems because blame teaches people to hide". Rewrite blame as a system fact:

| Blame                            | Blameless                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| "Bo deployed without checking."  | "The deploy process had no check of database load, so the change reached production."                 |
| "The on-call was too slow."      | "The page was acknowledged within one minute; the alert's window and `for:` set the detection delay." |
| "Human error caused the outage." | "A manual step with no validation allowed a wrong value; the pipeline did not catch it."              |

"Human error" is never a finding. It is where the investigation starts: why was the error easy to make, and why did nothing catch it? The team's standard is in [[standards/blameless-postmortems]].

### Action items that can be verified

An action item is a change to the system or process. It must have:

- A **type**: **prevent** (stop it happening), **detect** (see it sooner), **mitigate** (make it smaller or faster to fix) or **process** (how people work).
- An **owner**: one named person, not a team.
- A **date**.
- A **verifiable done**: a check that anyone can run to see whether it is finished.

"Be more careful with database changes" is not verifiable. "Add a CI job that fails when `EXPLAIN` shows a sequential scan on the three hottest `cart` queries; done when a seeded bad query fails the job" is.

### Taking part in the review

A postmortem review is a meeting where the team reads the document and improves the actions. As a participant:

- Read the document beforehand. Come with questions, not with verdicts.
- Ask "how" and "what" questions, not "who" or "why did you".
- Say what you saw and what you believed at the time, honestly. The review only works if people feel safe to do so.
- Challenge actions that cannot be verified, and offer to own one.
- Notice what went **well** too: the good rollback, the quick escalation. Keep those.

## Hands-on exercises

1. **Acknowledge a fake page with a first update in five minutes.** Pretend this page arrived at 14:25:03 UTC: `ApiHighErrorRatio{service="cart"} firing, 12% 5xx over 5m`. Set a five-minute timer. In that time, write (a) the three first-five-minute answers from "Is it real, is it user-facing, is it getting worse" as if you had looked at a dashboard (invent plausible answers), and (b) a first response message from the template, filled in.

   Expected: a message like this, written inside five minutes:

   ```text
   I have the page for ApiHighErrorRatio (cart) and I am looking now.
   Impact so far: about 12% of cart requests return 5xx; checkout is affected.
   Severity: SEV2 (provisional). Next update by 14:43 UTC.
   ```

   If you see something else: if your message has a cause in it, remove it; you do not know it yet. If it has no time for the next update, add one, because "next update by" is what stops people asking for news.

2. **Write a three-row severity table and review it with a senior.** For a service you know (or your lab), write a table of three levels with a one-line example, the response and the update rhythm, like the one above but in your words. Ask a more experienced colleague to review it.

   Expected: a table with three rows, an example that you can recognise from your service in every row, and a note from the reviewer on at least one row.
   If you see something else: if two rows look the same to the reviewer, the boundary between them is unclear. Rewrite it using users and impact ("many users", "no workaround"), not technology.

3. **Write an escalation message for a database you cannot access.** Scenario: you suspect the `cart-db` Cloud SQL instance is the bottleneck but you have no access to its query tools. Fill in the escalation template.

   Expected:

   ```text
   Dana, I need your help with cart-db. Severity SEV2, started 14:12 UTC.
   Symptom: 12% of cart requests return 5xx since 14:12 UTC; Cloud SQL CPU above 90% since 14:20 UTC.
   Checked: cart deploy history (v2.3 rolled out 14:09 UTC), dashboards, Pod status.
   Ruled out: node capacity, other services on the same database (healthy).
   Done so far: nothing changed yet.
   What I need: someone to look at the slowest queries on cart-db in the last 30 minutes. I am in #inc-cart.
   ```

   If you see something else: if your message says only "the DB is slow, can you check?", the person has to ask five questions before starting. Add the symptom, the times, what you tried and the exact ask.

4. **Write a handover note.** Scenario: your shift ends at 18:00 UTC with one open item (a ticket-level alert you are watching), one silence and a deploy planned for tomorrow.

   Expected:

   ```text
   Handover 18:00 UTC, from <you> to <next person>
   Open: ticket alert DiskFillingSoon on node pool "batch" (watching; the disk fills about 2% a day; ticket linked).
   Silences: DiskFillingSoon for "batch" until 2026-09-09 12:00 UTC, reason: ticket already open, owner <you>.
   Planned: cart v2.3 deploy tomorrow 10:00 UTC; rollback is `helm rollback cart` to the previous revision.
   Freezes: none.
   Quirks: the nightly report job at 02:00 UTC causes a short CPU spike; it recovers on its own.
   ```

   If you see something else: a silence without an expiry or a reason is a bug in the note. Add both.

5. **Build a timeline of 12 or more rows from a raw export.** The following export is made up (the "cart v2.3" incident, 8 September 2026). Save it as `incident-export.txt`. It mixes UTC and local time (chat is in UTC+02:00) on purpose.

   ```text title="incident-export.txt"
   [chat #inc-cart tz=UTC+02:00] 16:35 chen: approved. go ahead with the rollback to v2.2.4
   [ci] 2026-09-08T13:58:11Z pipeline 4821 (cart v2.3): build and tests passed
   [alert] 2026-09-08T14:25:03Z ApiHighErrorRatio{service="cart"} firing, page sent to oncall-page
   [deploy] 2026-09-08 14:09:30 UTC deployment/cart: rollout complete, 6/6 ready, image tag v2.3
   [chat #inc-cart tz=UTC+02:00] 16:28 bo: SEV2 declared. Cart checkout errors, about 12% of requests (estimate). Investigating. Next update 16:43.
   [metrics] 14:12 UTC cart 5xx ratio first above 1% (read from the graph after the incident)
   [paging-app] 2026-09-08T14:26:10Z bo acknowledged
   [ci] 2026-09-08T14:02:40Z pipeline 4821: job deploy-production started
   [chat #inc-cart tz=UTC+02:00] 16:31 bo: Cloud SQL CPU is at 95% since about 16:20. I believe the new cart query is slow.
   [metrics] 14:20 UTC Cloud SQL instance cart-db CPU above 90% (read from the graph after the incident)
   [chat #inc-cart tz=UTC+02:00] 16:33 bo: paging dana (DBA) to read the query plan
   [audit] 2026-09-08T14:36:12Z method=io.k8s.apps.v1.deployments.update principal=ci-deployer@example-project.iam.gserviceaccount.com resource=deployments/cart
   [deploy] 2026-09-08 14:39:00 UTC deployment/cart: rollout complete, 6/6 ready, image tag v2.2.4
   [chat #inc-cart tz=UTC+02:00] 16:43 bo: update: rollback done, errors falling, database recovering. Next update 16:58.
   [metrics] 14:52 UTC cart-db CPU below 50%. cart p95 latency still above baseline (cache cold)
   [chat #inc-cart tz=UTC+02:00] 16:58 bo: update: error ratio at baseline, latency still high. Next update 17:13.
   [chat #inc-cart tz=UTC+02:00] 17:09 bo: error ratio and p95 back to baseline for 10 minutes. Closing SEV2. All clear.
   ```

   Convert every chat time to UTC (subtract two hours) and check one with `date`:

   ```bash
   date -u -d '2026-09-08 16:28 +02:00' +%H:%MZ
   ```

   Expected: `14:28Z`. Then write the sorted table with columns Time (UTC), Source, Event, and Kind (observed, inferred or believed). The result has 17 rows. These are its first rows and last rows; fill in the middle yourself, then compare:

   ```text
   13:58:11  ci        pipeline 4821 (cart v2.3) build and tests passed       observed
   14:02:40  ci        deploy-production job started                           observed
   14:09:30  deploy    cart v2.3 rollout complete, 6/6 ready                   observed
   14:12     metrics   cart 5xx ratio first above 1%                           inferred (from the graph, afterwards)
   14:20     metrics   cart-db CPU above 90%                                   inferred
   14:25:03  alert     ApiHighErrorRatio firing, page sent                      observed
   ...
   14:58     chat      update: error ratio at baseline, latency still high      observed
   15:09     chat      error ratio and p95 at baseline for 10 min; all clear    observed
   ```

   Rows for 14:31 ("I believe the new cart query is slow") are **believed at the time**, and 14:28 ("about 12% of requests (estimate)") is an estimate. If you convert 16:28 to 14:28 and put the 14:31 row after it, your order is right.
   If you see something else: if the order differs, you left a chat time in local time. If you have fewer than 17 rows, you merged two events; keep one row per event.

6. **Compute the times.** Use the timeline: impact started at 14:12Z, the alert fired at 14:25Z, the rollback completed at 14:39Z and all was normal at 15:09Z. Compute TTD, TTM and TTR as defined above with a small script, so you do not make arithmetic mistakes:

   ```bash
   t() { date -u -d "$1" +%s; }
   mins() { echo "$(( ($(t "$2") - $(t "$1")) / 60 ))"; }
   START=2026-09-08T14:12:00Z
   ALERT=2026-09-08T14:25:00Z
   MITIGATED=2026-09-08T14:39:00Z
   RESOLVED=2026-09-08T15:09:00Z
   echo "time to detect:   $(mins $START $ALERT) min"
   echo "time to mitigate: $(mins $ALERT $MITIGATED) min"
   echo "time to resolve:  $(mins $START $RESOLVED) min"
   ```

   Expected:

   ```text
   time to detect:   13 min
   time to mitigate: 14 min
   time to resolve:  57 min
   ```

   If you see something else: `date: invalid date` means this is not GNU `date` (macOS `date` has different options; run it in Lab A). A different number means a time was mistyped. The 13 minutes of detection delay match an alert that looks at a 5-minute window and waits `for: 10m`, as in [[learn/first-prometheus-alert|Observability 03]], and that is worth a note in the postmortem.

7. **Rewrite three blame sentences.** Rewrite each in a blameless way. (a) "Bo pushed v2.3 without testing it with real data." (b) "Nobody looked at the dashboards before the deploy." (c) "The cause of the outage was a stupid mistake in the SQL query."

   Expected (one possible answer):

   ```text
   (a) The pre-production test environment holds a small fraction of production data, so a slow query could pass every test.
   (b) The deploy process has no step that shows the key dashboards, and no automated check of error ratio after a rollout.
   (c) A query that scans the whole table was easy to write and nothing in review or CI detected it.
   ```

   If you see something else: if the sentence still contains a person or an adjective about a person ("stupid", "careless"), keep rewriting. The test is: could the same thing happen to a different, equally skilled engineer tomorrow? If yes, the fix belongs in the system.

8. **Write three verifiable action items.** One each of prevent, detect and mitigate types, for the cart incident.

   Expected (a possible answer):

   ```text
   Prevent: CI job runs EXPLAIN on the three hottest cart queries against a production-sized test database and fails on a sequential scan.
     Owner: <named engineer>, due 2026-10-01. Done when: a seeded bad query fails the job and the job is required for merge.
   Detect: a canary step sends 10% of traffic to a new cart version for 10 minutes and aborts on a 5xx ratio above 2%.
     Owner: <named engineer>, due 2026-10-15. Done when: a deliberately broken build is rolled back automatically in a staging drill.
   Mitigate: the rollback command is in the cart runbook, and someone who did not write it runs it in staging in under 5 minutes.
     Owner: <named engineer>, due 2026-09-22. Done when: the drill is recorded in the runbook page.
   ```

   If you see something else: if an item reads "improve" or "be more careful", ask what a reviewer could check to say it is finished, and rewrite until you can name the check. See [[patterns/progressive-delivery-argo-rollouts]] for the canary idea.

9. **Write a postmortem from the timeline with three contributing factors.** Use the exercise 5 table. Keep it to one page: summary, impact, timeline (link or paste), three contributing factors, what went well, what went badly, what was lucky and the action items from exercise 8. Use the blameless wording.

   Expected (shape, not wording):

   ```text
   Summary: cart v2.3 shipped at 14:09 UTC and caused 5xx on about 12% of cart requests until a rollback at 14:39 UTC. Back to baseline 15:09 UTC.
   Impact: checkout errors for 57 minutes (14:12 to 15:09 UTC). Severity SEV2.
   Times: detect 13 min, mitigate 14 min, resolve 57 min.
   Contributing factors:
     1. The v2.3 query scanned the whole items table, which is slow at production size.
     2. Test environments hold a small share of production data, so no test showed the slow query.
     3. The rollout moved to 100% of Pods with no canary or automated check; detection depended on a 5-minute window plus a 10-minute `for:`.
   Went well: page acknowledged in 1 minute; rollback decision and execution in 9 minutes; regular updates.
   Went badly: 13 minutes passed before the first alert, and the rollout had already reached every Pod.
   Lucky: the incident happened in office hours with the DBA available.
   Actions: the three from exercise 8.
   ```

   If you see something else: if you have one "root cause", split it: ask "what else had to be true for this to happen?". If a factor names a person, apply exercise 7.

10. **Clean up.**

    ```bash
    rm -f incident-export.txt
    ```

    Expected: nothing printed. If you wrote files elsewhere, delete or file them; none of the material is real, so nothing needs to be kept private.

## Common mistakes

- **Learning your access during the page.** Why it bites: minutes are lost with an outage running. Fix: do the access checklist days earlier and send a test page.
- **Waiting to know the cause before declaring severity.** Why it bites: help arrives late. Fix: set it from the impact you see, say it is provisional, change it later.
- **Hunting the root cause while users suffer.** Why it bites: the outage lasts longer. Fix: mitigate first (rollback, feature off, scale out), investigate afterwards.
- **Silent working.** Why it bites: others duplicate work, managers interrupt, and you lose your own record. Fix: update every 15 minutes and narrate risky actions.
- **Not escalating.** Why it bites: hours are lost to pride or politeness. Fix: set a time-box and escalate with a full summary; it is expected.
- **A silence with no expiry.** Why it bites: the real problem is hidden for weeks. Fix: always set an end time, reason and owner, and list silences in the handover.
- **A timeline in mixed time zones.** Why it bites: causes appear after their effects. Fix: UTC everywhere and a source for every row.
- **Mixing what you saw with what you thought.** Why it bites: a guess becomes a "fact" in the report. Fix: label rows observed, inferred or believed.
- **"Human error" as the finding.** Why it bites: nothing in the system changes, so it happens again. Fix: ask why the error was easy to make and why nothing caught it.
- **Action items nobody can check.** Why it bites: the list is long and nothing is finished. Fix: type, owner, date and a verifiable done.

## Check your understanding

1. When should you escalate during an incident?
2. Why declare a severity before you know the cause?
3. What is the difference between an event that was observed, one that is inferred and one that was believed at the time?
4. Why is "human error" not a finding?
5. In the cart timeline, what are the time to detect, to mitigate and to resolve, and where does each interval start and end?
6. What makes an action item verifiable?

> [!question]- Answers
>
> 1. When you have no new evidence after your time-box, when the impact is bigger than your severity or authority, when you need access or knowledge you do not have, or whenever you are unsure. Escalating early is expected and never blamed.
> 2. Severity decides how many people join, how often you update and who is told, and you cannot wait for the cause for that. It can be wrong at first because one message changes it; a late severity delays help.
> 3. Observed: a system recorded it (an alert, an audit log, a deploy record). Inferred: worked out later from data (the errors began where the graph rises). Believed: what a person thought during the incident, which may be wrong. A timeline that keeps them apart does not turn guesses into facts.
> 4. It describes the last step, not the reason. The useful question is why the error was easy to make and why no check caught it. The answer is a change to the system, which is what the postmortem should produce.
> 5. Time to detect 13 minutes (14:12Z impact started to 14:25Z alert), time to mitigate 14 minutes (14:25Z alert to 14:39Z rollback done) and time to resolve 57 minutes (14:12Z impact started to 15:09Z all normal).
> 6. It has a type, a single named owner, a date and a check anyone can run to decide whether it is done, such as "a seeded bad query fails the CI job".

## Next steps

Next lesson: [[learn/becoming-a-middle-devops-engineer|Career 01: Becoming a middle DevOps engineer]]. Previous lesson: [[learn/troubleshooting-method|Incidents 01: A troubleshooting method]].

To go deeper:

- [[runbooks/incident-response]] is the team procedure for running an incident.
- [[standards/blameless-postmortems]] sets the postmortem standard and template.
- [[management/on-call-health]] covers load, rotas and burnout.
- [[ai/ai-assisted-incident-response]] shows where an AI assistant can help (drafting updates, summarising logs) and where it must not; the owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com). Never paste secrets, customer data or internal configuration into a tool your organisation has not approved.
- The whole path is mapped in [[learn/index|the learning path]].

Related: [ai.szolotov.com](https://ai.szolotov.com) (AI skills catalogue).

## Sources

- Google SRE book, "Being On-Call" (https://sre.google/sre-book/being-on-call/), "Emergency Response" (https://sre.google/sre-book/emergency-response/) and "Postmortem Culture: Learning from Failure" (https://sre.google/sre-book/postmortem-culture/).
- Google SRE Workbook, "Incident Response" and "Postmortem Culture" (https://sre.google/workbook/table-of-contents/).
- PagerDuty Incident Response documentation (https://response.pagerduty.com/).
- Google Cloud documentation, "Cloud Audit Logs overview" (https://cloud.google.com/logging/docs/audit).
- Run for this page: the `date` conversions and the time-to-detect, mitigate and resolve script, on Ubuntu 24.04.5 LTS (GNU `date`).
- Not verified: the `gcloud logging read` command and the audit log method names, the severity levels and roles (they are examples; use your organisation's), and every fact about the "cart v2.3" incident, which is invented for teaching.
