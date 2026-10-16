---
title: On-call health
description: Designing a sustainable on-call rotation, with alert hygiene, load metrics, a handover template, escalation paths and burnout signals for a DevOps team.
type: guide
tags:
  - management
  - on-call
  - incident-management
  - team-process
created: 2026-10-16
modified: 2026-10-16
draft: false
---

On-call is where reliability work meets people. A rotation that wakes engineers repeatedly for non-actionable alerts costs you your best people. Healthy on-call is a combination of rotation design, alert quality, fair compensation and a team that is allowed to fix the causes of pages. This note is general guidance. Pay, rest and working-time rules vary by country and by employment contract, so check local law and company policy before you apply any of it.

## Rotation design

Choose a design based on team size and where your engineers are.

| Design                      | Works when                                                      | Watch out for                                                        |
| --------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| Single region, weekly shift | Small team in one or two nearby time zones                      | Night pages land on the same people; needs enough people in the rota |
| Follow-the-sun              | Engineers in three or more time zones, with real people on each | Handover quality, uneven knowledge across regions                    |
| Primary and secondary       | Anyone who needs a backup                                       | Secondary must have a defined role, not an implied one               |
| Business-hours only         | Services where customer impact overnight is tolerable           | Must be an explicit decision with stakeholders                       |

Guidelines:

- **Enough people.** A rota with too few people means frequent shifts. If you have fewer than about five or six engineers, consider shared on-call with an adjacent team, or narrow the scope. Decide the minimum from your own page load, not from a rule of thumb.
- **Shift length.** One week is common. Shorter shifts reduce fatigue but increase handovers. Choose what the team prefers and review it.
- **Fairness.** Publish the schedule well ahead, allow swaps, track out-of-hours load per person, and avoid always using the same people for holidays.
- **Not alone.** New engineers shadow first, then take a shift with a buddy as secondary. See [[onboarding-engineers]].
- **Opt-outs.** Be fair about people with caring duties or health issues, and consider this with local rules in mind.
- **Separate from interrupts.** The shield for support requests (see [[platform-team-operating-model]]) should not also be the paged engineer.
- **Scope.** Write down what the rota covers: which services, which severity, which hours. Out-of-scope alerts do not page.

## Follow-the-sun or single region

Follow-the-sun removes night pages but adds coordination cost, so it is a trade-off, not an upgrade.

- It needs at least two groups that can each take a full shift in their daytime, each large enough to rotate.
- Handover must be written and consistent (template below).
- Runbooks must be good enough for any region to act, see [[runbooks/index|runbooks]].
- Without enough people, a "follow-the-sun" rota can be fragile. A single-region rota with strong alert hygiene and time-off in lieu may be healthier.

## Alert hygiene

Most on-call pain is alert pain. Rules that work:

1. **Every page must be actionable and urgent.** If it can wait until morning, it is a ticket, not a page.
2. **Page on symptoms, not causes.** Alert on user-facing error rate or latency against an SLO, not on CPU. See [[slo-burn-rate-alerting]].
3. **Every alert has a runbook link** and an owner. An alert without a runbook is unfinished.
4. **Delete or fix noisy alerts** in the next working day after they fire. Track flapping alerts.
5. **Tune thresholds** with data, and use `for:` durations and burn-rate windows to avoid flaps.
6. **Group and deduplicate** so that one failure causes one page.
7. **Review monthly.** For each alert that fired, ask: was it actionable, what did the responder do, can we automate it?
8. **Severity levels** with clear definitions of who gets woken for what.

```yaml title="prometheus-alert-example.yaml"
groups:
  - name: checkout-slo
    rules:
      - alert: CheckoutErrorBudgetBurnFast
        # 0.001 is the error budget of a 99.9% SLO (1 - 0.999)
        expr: |
          (
            sum(rate(http_requests_total{service="checkout",code=~"5.."}[1h]))
            / sum(rate(http_requests_total{service="checkout"}[1h]))
          ) > (14.4 * 0.001)
          and
          (
            sum(rate(http_requests_total{service="checkout",code=~"5.."}[5m]))
            / sum(rate(http_requests_total{service="checkout"}[5m]))
          ) > (14.4 * 0.001)
        for: 2m
        labels:
          severity: page
        annotations:
          summary: Checkout is burning its error budget fast
          runbook_url: https://wiki.example.com/runbooks/checkout-errors
```

The rule assumes a 99.9% SLO over 30 days (error budget 0.001); the 1h window keeps it from firing on short blips and the 5m window lets it resolve quickly. Copy the full rule set (page and ticket tiers) from [[slo-burn-rate-alerting]] rather than re-deriving it. For tooling background see [[prometheus-vs-cloud-monitoring]].

## Measuring load

You cannot manage what you do not count. Export alert history from your paging tool and track per shift:

- **Pages per shift,** and the split into actionable and not.
- **Out-of-hours pages,** meaning outside the engineer's local working hours.
- **Pages at night** (sleep disruption), which matter more than daytime pages.
- **Time to acknowledge and time to resolve.**
- **Repeat pages** from the same alert.
- **Toil during the shift:** time spent on manual, repeatable work. Ask the engineer to log it in the handover.
- **Load per person** over a quarter, to spot imbalance.

Choose thresholds with your team and write them down. Start from your own data: take last quarter's median pages per shift and out-of-hours pages per person, set the threshold at or below that, write it down, and review it each quarter. Report the numbers in the weekly status, see [[stakeholder-communication]]. If load stays over the threshold, treat reliability work as the top roadmap item in [[planning-and-prioritization]].

## Handover template

Hand over in writing, then talk through anything open for ten minutes.

```markdown title="on-call-handover.md"
## On-call handover: <outgoing> to <incoming>, <date>

**Overview:** One line on how the week went (quiet, busy, one major incident).

**Open incidents and issues:** Links, current state, next step, owner.

**Pages this shift:** Count, count out of hours, notable ones with ticket links.

**Changes in flight:** Deployments, migrations, maintenance windows planned for the next week.

**Known risks:** Things that may page (expiring certificates, capacity, flaky dependency).

**Alerts to fix:** Noisy or non-actionable alerts, with tickets.

**Toil logged:** Manual tasks that should be automated.

**Anything unusual:** Access issues, missing runbooks, vendor issues.
```

## Escalation

- Define the path: primary, secondary, engineering manager or incident commander, then the relevant service owner.
- Define time-boxes: if the primary has not acknowledged in a short fixed time, the page goes to the secondary automatically.
- Make it clear that **escalating is expected, not weak.** Nobody should resolve a major incident alone in the night.
- For major incidents, follow [[incident-response]] and nominate an incident commander and a communications owner, see [[stakeholder-communication]].
- Include non-technical escalations: security (see [[leaked-credential-rotation]]), legal, and vendor support contacts.
- Test the path. Run a game day or a page test each quarter.

## Compensation and time off

General guidance only. Rules differ widely across jurisdictions and contracts.

- On-call should be recognised, not assumed. Common approaches: a standby allowance, extra pay for call-outs, time off in lieu (TOIL), or a mix.
- Provide **rest after disturbed nights.** Define a rule such as a later start or a day off after a night incident, and apply it without making the engineer ask.
- Check working-time and rest-period rules for your country, and works council or union agreements where they apply.
- Check your company policy, and ask HR or legal when you design the scheme. Do not invent a scheme from this note.
- Be consistent. Applying rules by favour damages trust.
- Track TOIL balances and make sure people actually take the time.

## Burnout signals

Watch for these in one-on-ones (see [[one-on-ones]]) and in the data:

- Rising cynicism about alerts, or muting and ignoring them.
- Reluctance to take shifts, or repeated swap requests.
- Sleep or health complaints after shifts, or sick days after heavy ones.
- Withdrawn behaviour in the team, shorter replies, missed meetings.
- Frequent mistakes in routine work.
- Engineers leaving the rota or the company, with on-call named as a reason.
- Heroes: one person who answers every page. This is a risk, not a strength.

Response: reduce load immediately (take the person off the rota, fix the top noisy alert, add a person), talk privately and without judgement, and fix the system cause. Do not rely on resilience as a strategy.

## Review cycle

Hold a short on-call review every two weeks: load numbers, top three alerts, handover themes, actions with owners. Feed outcomes into [[tech-debt-management]] and into postmortems, see [[blameless-postmortems]].
