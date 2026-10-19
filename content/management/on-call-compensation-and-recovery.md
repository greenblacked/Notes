---
title: On-call compensation, incident fatigue and recovery time
description: "Design an auditable on-call compensation policy and fatigue rules for long incidents: shift limits, relief handover and recovery time afterwards."
type: guide
tags:
  - management
  - on-call
  - incident-management
  - team-process
  - career
created: 2026-10-19
modified: 2026-10-19
draft: false
---

On-call asks people to restrict their evenings, keep a laptop close and accept being woken at night. A team that treats this as free will pay for it later in attrition, mistakes and quiet resentment. A good policy has three parts: fair compensation for the burden, rules that stop a long incident turning into a long shift for one tired person, and guaranteed recovery afterwards. It should be written down, auditable and boring.

> [!warning] Labour law and contracts vary
> Working-time rules, rest periods, overtime, on-call classification and pay obligations differ by country and by employment contract, and may differ between employees and contractors. This note is general guidance. It contains no pay rates and no legal figures. Involve HR and legal before adopting any policy, and check local law and your agreements.

## Scope

[[on-call-health]] covers rotation design, alert hygiene, load metrics and burnout signals. This note goes deeper on two things that note only touches: how on-call is compensated and what happens to people during and after long incidents. The incident process itself is in [[incident-response]].

## What on-call costs

Be explicit about the costs that compensation and rest are meant to offset:

- **Availability constraint:** being unable to travel, drink, or be offline, even when no page arrives.
- **Interruption:** pages during evenings, weekends and nights, with sleep disruption lasting beyond the page itself.
- **Cognitive load:** staying alert for a system that might fail.
- **Home impact:** caring duties, plans, health.
- **Career impact:** people on heavy rotas have less time for growth work, which is a fairness issue in [[performance-feedback]].

These costs differ per person and per week. A policy that ignores load treats a quiet week like a bad one.

## Compensation models compared

| Model            | How it works                                          | Fairness                                                  | Cost predictability              | Admin effort | Typical risk                          |
| ---------------- | ----------------------------------------------------- | --------------------------------------------------------- | -------------------------------- | ------------ | ------------------------------------- |
| Standby payment  | A fixed amount for being on call, regardless of pages | Rewards availability; ignores heavy weeks                 | High                             | Low          | Heavy weeks feel unpaid               |
| Per call-out     | Payment or time for each page or intervention         | Tracks effort; can reward noisy systems                   | Low                              | Medium       | Perverse incentive not to fix alerts  |
| Time off in lieu | Time off for out-of-hours work, taken later           | Matches the cost (rest); depends on being able to take it | High in money, lower in capacity | Medium       | Unused balance, resentment if blocked |
| Mixed            | Standby plus call-out or time off for heavy work      | Best coverage of the cost                                 | Medium                           | Highest      | Complexity; unclear rules             |

Choose by what you want to protect. If you want fewer pages, avoid models that pay more for pages without a counterweight, such as a reliability goal on the team. If you want rest, time in lieu is direct. Whatever you choose, set amounts with HR and finance. Budget lines are in [[engineering-budget-planning]].

## Measuring load to price it

Use the load data from [[on-call-health]]: pages per shift, out-of-hours minutes, night pages. Weight them so that bad nights count more than easy daytime pages. The weights below are a template; set your own with the team.

```text title="load-weighting-template.txt"
Per person, per shift (all weights are ILLUSTRATIVE, set your own):

load_points =
    w_day    * daytime_pages
  + w_eve    * evening_pages            # outside working hours, awake
  + w_night  * night_pages              # sleep disruption
  + w_min    * out_of_hours_minutes_worked / 15
  + w_wknd   * weekend_or_holiday_days_on_call

Review: median load_points per shift per quarter, per person.
Flag: any shift above the team threshold (set from last quarter's data).
Use: allocate time in lieu or heavier-week compensation by band,
     for example band A below the median, band B above, band C far above.
```

Measure out-of-hours in each person's local working hours, not the company's headquarters time. Keep the raw data; if someone asks "why was my week in band C", you can answer.

## Writing the policy

A usable policy is short and covers:

1. **Who is on the rota** and who is exempt, with the criteria and the process for adjustments.
2. **What is paid or compensated**, in which model, how it is calculated, and who approves exceptions. State the amounts in the HR document, not here.
3. **What counts as on-call work:** time responding, time on handover, time on follow-up actions after the page.
4. **Claiming:** how people record time (a form, a tool), by when, and who checks.
5. **Time in lieu rules:** accrual, deadline to take it, whether it expires, who may refuse and why.
6. **Fatigue rules:** the next two sections.
7. **Review:** how often the policy is reviewed and the data used.
8. **Opt-outs and swaps:** fair rules, applied equally.

Keep the document in the repository, versioned. Auditable means a third person can recompute any claim from the policy and the data.

## TOIL ledger

A time-off-in-lieu ledger turns a vague promise into an obligation that can be tracked. Use a simple shared record per person.

| Field                | Meaning                                            |
| -------------------- | -------------------------------------------------- |
| Date of work         | The shift and incident the time relates to         |
| Hours earned         | Computed from the policy, not estimated afterwards |
| Approver             | The manager who agreed the hours                   |
| Take-by date         | Deadline to use it; set by the policy              |
| Hours taken and date | When it was used                                   |
| Balance              | Earned minus taken                                 |
| Status               | open / taken / expired (with the reason)           |

Report balances monthly to the manager. A growing balance shows that the team is overloaded or that time off is being blocked. Do not let it expire silently; an expiry is a failure of the process, so treat it as one. Do not confuse this ledger with the toil measure in [[toil-budget]], which is about repetitive manual work.

## Why fatigue causes errors

Tired people make more mistakes, decide slowly, take risky shortcuts and miss warnings. In a long incident this compounds: a responder awake for many hours is more likely to run the wrong command in production, and less likely to notice. The sleep disruption of night pages affects the next day's work as well. The fix is organisational: do not rely on willpower, build rules that remove the decision from the tired person. The [Google SRE book chapter on being on call](https://sre.google/sre-book/being-on-call/) discusses workload and operational overload in more depth.

## Incident shift limits and relief handover

For SEV1 and SEV2 incidents, write limits into the policy. The numbers are the team's to set, not this note's; local rules may impose rest requirements.

- **Maximum continuous incident hours before handover:** a fixed number set by the team, counted from the first page, not from the moment the person felt tired. At the limit, the responder hands over, even if the fix is close.
- **Relief person:** every SEV1 and SEV2 has a named relief, found early, not at the limit. The incident commander asks for relief at the start of a long incident. The relief should be rested, not the person who was on call the night before.
- **Handover content:** current state, hypotheses tried, hypotheses ruled out, commands run, pending decisions, who has been told. Use a written note in the incident channel and a short call. The handover template in [[on-call-health]] is a starting point.
- **Roles over heroes:** separate the incident commander from the person making changes, as in [[incident-response]]. Rotate the commander as well.
- **Meals and breaks:** the incident commander is responsible for making sure responders eat and rest. It sounds trivial; it is not.
- **No decisions to take irreversible actions** (data deletion, region failover) by a responder past the limit without a second person.

## Recovery time after incidents

Recovery must be automatic, not negotiated. Put it into the policy in these terms:

- After a night incident, the responder starts later the next day or takes the day, as the policy states, without needing to ask.
- After a long SEV1 or SEV2, the responder has a rest period before the next shift and is removed from the following on-call week if the load was high.
- Follow-up work (postmortem writing, remediation) is scheduled as work, not added to the same person's weekend.
- The manager checks in within one working day. See [[one-on-ones]].
- Recovery time counts against nothing: not against sick leave, not against holiday, not against the person's performance record.

State the recovery rule in plain words and do not let managers override it quietly. If the business needs the person back sooner, that is an exception with a record and an approver.

## Review cadence

- Each incident: did the shift limit and relief rule work? Note it in the review, see [[incident-review-programme]].
- Monthly: TOIL balances and load bands.
- Quarterly: the median load, attrition and engagement signals, and the policy's costs versus budget, and the findings go into [[engineering-budget-planning]] and a report.
- Yearly: the policy text with HR and legal, and a check that it still matches local law.

If load stays high after compensation improves, you have bought tolerance, not health. Treat reliability work as the fix, see [[toil-budget]].

## Sources

- [Google SRE book: Being on-call](https://sre.google/sre-book/being-on-call/): workload, fatigue and operational load.
- [PagerDuty incident response documentation](https://response.pagerduty.com/): shared practices for incident roles and on-call. Check the current docs.

## Related

- [[on-call-health]]
- [[incident-response]]
- [[toil-budget]]
- [[engineering-budget-planning]]
- [[performance-feedback]]
- [[one-on-ones]]
- [[incident-review-programme]]
