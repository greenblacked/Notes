---
title: Quarterly engineering review and roadmap
description: A one-page quarterly review for engineering managers covering commitments, DORA and incidents, capacity split, risks, a Now/Next/Later roadmap and blameless reporting.
type: guide
tags:
  - management
  - delivery
  - team-process
  - leadership
created: 2026-10-17
modified: 2026-10-17
draft: false
---

The quarterly engineering review is the ritual where a team says what it promised, what it delivered, what it learned and what it will do next, in a form that leadership can act on. It is also the main report an engineering manager is judged on, so it deserves a fixed format. This note defines the artifact, the cycle and the audience. How work is chosen (capacity, RICE, saying no) stays in [[planning-and-prioritization]].

## Purpose and audience

The review exists to produce **decisions**, not to prove that the team was busy. A good review lets a reader answer four questions in five minutes:

1. Did you do what you said you would do, and if not, why?
2. Is delivery and reliability getting better or worse?
3. Where is your time going: roadmap, running the platform or debt?
4. What do you need from me?

Audiences and what each wants:

| Reader                           | Wants                                                   | Give them                                                       |
| -------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| Your manager and directors       | Outcomes, risks, decisions, budget impact               | The one-page summary                                            |
| Product and partner teams        | What is coming, what slipped and what it means for them | Shipped/slipped table and the roadmap                           |
| The team itself                  | An honest picture and a say in priorities               | The full review, discussed together                             |
| Finance and security (as needed) | Spend against plan, open risks                          | The cost and risk sections; see [[engineering-budget-planning]] |

Write for the reader who skims. Put the decisions needed at the top. Keep the detail in appendices or linked dashboards.

## One-page template

Copy this into a doc or a wiki page each quarter. Fill every field, even if the answer is "none".

```text title="Quarterly engineering review template"
Team / quarter: <team> / <year Qn>        Author: <name>        Date: <date>

1. Summary (three sentences)
   <What went well, what did not, the one thing you need.>

2. Decisions needed (top of page on purpose)
   - <decision, who decides, by when, what happens if no decision>

3. Key results: actual versus target
   | Objective / KR            | Baseline | Target | Actual | Status (on track / at risk / missed) |
   |---------------------------|----------|--------|--------|--------------------------------------|
   | <KR>                      |          |        |        |                                      |

4. Shipped / slipped / dropped
   | Item                | Outcome   | Reason (one line)          | New date or decision |
   |---------------------|-----------|----------------------------|----------------------|
   | <commitment>        | Shipped   |                            |                      |
   | <commitment>        | Slipped   | <cause, no blame>          | <date>               |
   | <commitment>        | Dropped   | <what replaced it>         | n/a                  |

5. Delivery metrics (DORA), this quarter against the last four
   | Metric                       | Q-4 | Q-3 | Q-2 | Q-1 | This quarter | Trend |
   |------------------------------|-----|-----|-----|-----|--------------|-------|
   | <metric from dora-metrics>   |     |     |     |     |              |       |

6. Incidents
   Count by severity: <S1: n, S2: n, S3: n>
   Total customer-impact time: <hours>        Error budget left: <%, per service>
   Top themes: <two or three, each with the follow-up and its status>

7. Capacity split: planned versus actual
   | Bucket                  | Planned % | Actual % | Note                    |
   |-------------------------|-----------|----------|-------------------------|
   | Roadmap                 |           |          |                         |
   | Run (KTLO, interrupts)  |           |          |                         |
   | Debt and toil reduction |           |          |                         |

8. Top risks (three to five)
   | Risk | Likelihood | Impact | Mitigation | Owner | Needs from others |

9. Next-quarter roadmap: Now / Next / Later with a cut line
   <see the table in the roadmap section>

10. Team health (optional, one line)
    <on-call load, attrition risk, hiring status>
```

The numbers in each section should come from sources you can name: the tracker for commitments, your CI and incident data for delivery metrics, and the incident system for incident counts. Link to them.

## Delivery against commitments

Commitments are the key results and the named deliverables you agreed at the start of the quarter. Report each one as **shipped**, **slipped** or **dropped**, with a reason in one line.

- **Shipped** means it is in use and the outcome is measurable, not that a merge request closed.
- **Slipped** means it will still be done, with a new date and the cause.
- **Dropped** means it was a deliberate choice, with what replaced it and who agreed. A dropped item reported honestly is a sign of good planning.

Report **outcomes** next to deliverables. "Migrated 12 pipelines" is a deliverable. "Median build time fell from a stated baseline to a stated target" is an outcome. If you cannot show the outcome yet, say when you will.

## Metrics and incidents

Show a trend, not one number. A quarter of data hides noise, so show at least the last four quarters, and write one sentence on what moved and why.

- **DORA metrics.** Use the set defined in [[dora-metrics]] and keep the definitions fixed across quarters, so trends mean something. Report medians as well as averages where distributions are skewed. Do not set the metrics as individual targets; they are team-level signals and are easy to game.
- **Incidents.** Summarise counts by severity, total customer-impact time and the two or three themes behind them. Link the postmortems ([[blameless-postmortems]]) and state the status of the follow-up actions: how many are done, in progress or overdue. Overdue follow-ups are a stronger signal than the incident count.
- **Reliability against objectives.** Show the error budget remaining for the services that matter and what you did when a budget ran low (see [[error-budget-policy]]).
- **On-call load.** Pages per shift and out-of-hours pages, from [[on-call-health]]. If the load is rising, say what it costs the roadmap.

> [!warning] Check before relying on this
> Not verified: the current DORA metric set. The classic set is deployment frequency, lead time for changes, change failure rate and time to restore service, and recent DORA research may have renamed some of them or added a fifth, reliability-related measure. Check the current DORA material and update [[dora-metrics]] and your template together, so definitions do not change silently between quarters.

## Capacity split

Show where the team's time went against the plan from [[planning-and-prioritization]]. Three buckets keep this readable:

| Bucket                  | Includes                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Roadmap                 | New capability that serves product or platform goals                                   |
| Run                     | Upgrades, patching, certificates, support requests, on-call, incidents                 |
| Debt and toil reduction | Automation, cleanup, migrations that remove old systems (see [[tech-debt-management]]) |

Take the numbers from the tracker, by labelling issues, or from time estimates the team already makes. Do not ask engineers to log hours just for this. An approximate split with the method stated is more honest than false precision.

If "run" took more than planned, say so and show what it displaced. This is the clearest way to argue for more people, or for investing in toil reduction, without sounding like a complaint. Pair it with the budget view in [[engineering-budget-planning]].

## Risks and decisions needed

List three to five risks that you cannot resolve alone. For each, give the likelihood, the impact, the mitigation under way, an owner and what you need from others. Typical examples are an end-of-life platform version, a single point of failure in a person or a system, a vendor renewal with a short decision window, or a dependency on another team ([[cross-team-dependencies]]).

Then list the **decisions needed**, in a form that can be answered:

```text title="Decision request"
Decision:     Approve one extra engineer for the cluster upgrade programme.
Needed by:    <date>, because <consequence of waiting>.
Options:      A) hire (cost: see budget note); B) cut the observability migration;
              C) accept a later upgrade date and the support risk.
Recommend:    <A, B or C, and why>.
If no answer: We continue with C by default from <date>.
```

State a default. A decision with no default stalls, and leadership learns that your reviews do not need answers. Use the writing habits from [[stakeholder-communication]].

## Next-quarter roadmap with a cut line

Present the roadmap as **Now / Next / Later**, with a **cut line** drawn where your capacity ends. Everything above the line is committed; everything below is a candidate that will happen only if something above it finishes early or is dropped.

| Horizon                                  | Item                                         | Outcome                                    | Size (eng-weeks) | Committed? |
| ---------------------------------------- | -------------------------------------------- | ------------------------------------------ | ---------------- | ---------- |
| Now                                      | Cluster upgrade to a supported minor version | Production on a supported version          | 6                | Yes        |
| Now                                      | Service template v2                          | New services deploy without our help       | 8                | Yes        |
| Now                                      | Pager noise reduction                        | Pages per shift under the agreed target    | 4                | Yes        |
| Next                                     | Artifact retention clean-up                  | Storage cost down; policy enforced         | 3                | Yes        |
| **--- cut line: capacity ends here ---** |                                              |                                            |                  |            |
| Next                                     | Self-service preview environments            | Faster feedback for product teams          | 10               | No         |
| Later                                    | Multi-region failover design                 | Recovery objective met for tier-1 services | 12               | No         |

Rules:

- Add up the sizes above the line and compare with the capacity you calculated. If they do not match, the line is in the wrong place.
- Say what is below the line **and why**: it is not forgotten, it is not funded. Stakeholders can then argue for moving the line, which is a useful conversation.
- Keep reserve for interrupts and incidents, as in the planning note. A roadmap at 100% of capacity will slip.
- Items under "Later" are intentions, not promises. Say so.
- Review the line during the quarter if something large arrives (see re-planning after incidents in [[planning-and-prioritization]]).

## Review calendar

Spread the work over four weeks so the review is mostly a summary of things already discussed.

| Week | Activity                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Pull data: key results, DORA metrics, incidents, capacity split, spend. Draft the shipped/slipped/dropped table.                                              |
| 2    | Team retrospective on the quarter; agree the risks and the themes. Share the draft with your manager and one stakeholder for early comments.                  |
| 3    | Draft next quarter: candidates, sizes, capacity, the cut line. Check with product partners and finance. Finish the one-page review.                           |
| 4    | Hold the review meeting (30 to 45 minutes, decisions first). Send the written version before it, and the decisions and actions after it. Publish the roadmap. |

Between quarters, keep a running notes file: each week add the shipped items, the incidents and any slip. It saves a day of reconstructing at the end. A mid-quarter check at about six weeks lets you move the cut line before it is a surprise.

## Reporting slips without blame

A slip reported late is a bigger problem than the slip. Report it when you know, in the same format, with the cause stated as a fact about the system or the plan, not about a person.

Principles, in line with [[blameless-postmortems]]:

- State what happened, the effect and the new date or decision. Do not hide a slip in a long paragraph.
- Name causes that can be fixed: an unclear dependency, an estimate that missed a migration step, an interrupt load higher than planned, a vendor delay.
- Say what you are changing so it is less likely next time.
- Never name an individual as the cause. If a person was a bottleneck, the cause is a single point of failure, which is a risk to list.

Example wording:

```text title="Slipped commitment (illustrative)"
Commitment:  Move all production services to the new ingress by end of Q3.
Status:      Slipped. 14 of 20 services are migrated; the rest move by the
             end of November.
Cause:       Six services depend on a legacy rewrite rule that was not in our
             inventory. We found it in week 7 when the first of them failed
             in staging. Pager load was also higher than planned, which took
             about three engineer-weeks from the project.
Impact:      Product team B's launch is not affected. The old ingress runs
             for two more months, costing about two extra months of its
             hosting bill.
Change:      We added a traffic-based inventory step to the migration
             checklist, and we now plan 20% of capacity for interrupts.
Ask:         None. Tell us if November conflicts with a launch freeze.
```

Compare with the wording to avoid: "The migration was delayed because the team underestimated the work." It names nobody, but it also gives no cause, no impact and no change.

## Related

- [[planning-and-prioritization]]
- [[dora-metrics]]
- [[tech-debt-management]]
- [[stakeholder-communication]]
- [[engineering-budget-planning]]
- [[blameless-postmortems]]
- [[error-budget-policy]]
- [[on-call-health]]
- [[cross-team-dependencies]]
