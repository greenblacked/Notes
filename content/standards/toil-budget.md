---
title: Toil measurement and the toil budget
description: Define toil strictly, track it, cap it, rank automation by payback and report it with SLO and on-call data, with a worked certificate renewal example.
type: standard
tags:
  - standards
  - on-call
  - reliability
  - leadership
created: 2026-10-17
modified: 2026-10-17
draft: false
---

"We spend too much time on manual work" is a feeling. A toil budget turns it into a number you can plan around: how much of the team's time goes to work that a machine should do, what it costs, and which automation pays back first. This standard gives a strict definition, a way to track it, a cap, a way to rank the work, and a report for leadership. It is written for engineering managers and senior engineers who need to justify automation time against feature work.

> [!info] Source quoted
> The definition and the 50% guideline below follow the Google SRE book, chapter 5 ("Eliminating Toil"), as I remember it. I did not re-read the chapter when writing this. The SRE Workbook has its own chapter on eliminating toil that may word things differently, and I did not check what differs. Treat the wording as a paraphrase and read the chapter you plan to quote before you cite it.

## Strict definition and what is not toil

The SRE book describes toil as work tied to running a production service that tends to be manual, repetitive, automatable, tactical, without enduring value, and growing linearly with the size of the service. The word "toil" is often used loosely for anything unpleasant. A strict definition matters, because a broad one makes the number meaningless and makes automation requests look like complaints.

Work is toil when most of these are true:

- **Manual.** A person runs a command, clicks, or copies data.
- **Repetitive.** It is done again and again, not once.
- **Automatable.** A script or system could do it, and a human adds no judgement.
- **Tactical.** It is interrupt-driven and reactive, not planned work with a goal.
- **No enduring value.** After you finish, the service is no better than before; the next occurrence needs the same effort.
- **Scales with the service.** More services, users or hosts means proportionally more of it.

What is **not** toil, even when it is annoying:

- **Overhead.** Meetings, planning, hiring, one-on-ones, training, expense reports, and incident reviews.
- **Engineering work with lasting value.** Writing the automation itself, designing a system, building a dashboard, fixing the root cause of an incident.
- **Work that needs judgement.** Capacity planning decisions, security triage, reviewing a design, a first-time investigation of a new failure.
- **A one-off task.** Migrating a service once is a project. Migrating it every quarter is toil.
- **Incident response itself.** Responding to a page is on-call work. The repeated manual fix you apply during most pages is toil. See [[on-call-health]] for load and alert hygiene.

If the team argues about whether something is toil, apply the checklist in the next section and write down the answer. The point is consistency over time, not a perfect verdict on each item.

## Tracking

You cannot manage what you do not record, and estimates made at the end of a quarter are wrong. Track toil as it happens, in a lightweight log that costs a minute per entry.

Use a shared sheet, a ticket label (for example `toil`) with a time field, or a form. The fields:

| Field        | Example                                                              | Notes                                                      |
| ------------ | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| Date         | 2026-10-14                                                           |                                                            |
| Who          | Engineer name or initials                                            | For the team's own view; do not use it to rank individuals |
| Task         | Renew certificate for `api.example.com`                              | Same name every time, so entries can be summed             |
| Category     | Certificates, access requests, deploys, data fixes, capacity, alerts | A short fixed list                                         |
| Minutes      | 20                                                                   | Hands-on time, not elapsed time                            |
| Trigger      | Expiry alert / ticket / page                                         | Helps find the source                                      |
| Toil?        | yes / no / partly                                                    | From the checklist below                                   |
| Automatable? | yes / partly / no                                                    | And a link to the automation ticket if one exists          |

Classification checklist. Answer for the task, not for one occurrence:

```text
[ ] Manual: a person has to do it by hand (command, click, copy and paste)?
[ ] Repetitive: has it happened more than twice in the last quarter?
[ ] Automatable: could a script or controller do it without human judgement?
[ ] Tactical: was it triggered by an alert, ticket or request, not planned in advance?
[ ] No enduring value: is the service unchanged for the better afterwards?
[ ] Scales with the service: will it grow if we add services, users or hosts?

Score: 5 or 6 yes  -> toil, log it
       3 or 4 yes  -> partly toil, log the hands-on part
       0 to 2 yes  -> not toil (project work, overhead or judgement)
```

The score thresholds are a team convention, not from a book; adjust them and keep them stable. Review the log in the team meeting every month for ten minutes: which categories grew, which task names repeat, and which entries are missing. Keep it honest by making clear that the log is used to justify automation work, not to measure people.

## The 50% cap guideline

The SRE book sets a goal that site reliability engineers spend no more than half their time on operational work, so that at least half goes to engineering that reduces future toil or improves the service. Many teams adopt 50% as a ceiling for toil.

How to use it in a DevOps or platform team:

- Treat 50% as an upper bound for a healthy team, not a target to reach. A team at 20% toil is not wasting 30%.
- Measure against the time of the people doing operations work, including on-call, not the whole department.
- Above the cap for a quarter is a signal to act, not a failure to hide. Act by shifting capacity into automation in the next planning cycle (see [[planning-and-prioritization]]), by pushing back on new work that adds toil, or by asking whether the team owns too many services.
- A team under the cap for a long time and with unused capacity can take on more.
- If one engineer carries most of the toil (always the same person gets certificate renewals), the average hides a burnout risk. Look at the distribution as well as the mean.

Whether the 50% figure and its exact wording appear as I describe them in chapter 5 of the SRE book was not re-checked, and your organisation can choose a different cap. What matters is that you pick one number, write it down and review it.

## Prioritising automation

You cannot automate everything, and some automation never pays back. Rank candidates by payback time:

```text
payback_weeks = effort_to_automate / weekly_time_saved

effort_to_automate = build + test + document + expected upkeep, in the same unit as the saving
weekly_time_saved  = runs_per_week x minutes_saved_per_run
```

Worked example. Someone renews certificates by hand: 6 runs a week at 20 minutes each, so 120 minutes (2 hours) a week. The engineer estimates one day to automate, which is 8 hours or 480 minutes.

```text
weekly_time_saved = 6 runs x 20 min = 120 min per week
effort_to_automate = 1 day = 480 min
payback_weeks = 480 / 120 = 4 weeks
```

About four weeks, so it pays back within a quarter and is a clear yes. Then re-check the numbers, because the estimate is rarely right:

- Engineers tend to underestimate automation effort. If the real effort is two or three days, payback is eight to twelve weeks. Still worth it for a task that will exist for years, doubtful for one that will disappear soon.
- Count upkeep. An automation that breaks monthly and needs an hour to fix costs 12 hours a year; subtract that from the saving.
- Count the non-time benefits: fewer errors, no knowledge held by one person, no pages at night. They justify automation that has a longer payback.
- Count the interruption cost. Twenty minutes of work often costs more than twenty minutes, because it breaks focus. Do not invent a multiplier; use it as a reason to favour the interrupt-driven task when two candidates tie.
- Re-check after you ship. If the log shows the task still takes time, the automation did not cover the real work.

Sort candidates by payback and by who is affected. Link the winners to [[tech-debt-management]], where automation of toil often sits as a debt item, and plan them through [[planning-and-prioritization]].

## Reporting with SLO and on-call data

Toil alone is an internal measure. Leadership cares about its effect on reliability and people, so report it next to SLO and on-call data. A quarterly table keeps the story short:

| Measure                                    | Last quarter       | This quarter      | Comment                                |
| ------------------------------------------ | ------------------ | ----------------- | -------------------------------------- |
| Toil share of team time (logged)           | 38%                | 31%               | Illustrative numbers; use your own log |
| Hours of toil by top category              | Certificates: 26 h | Certificates: 4 h | Automation shipped in week 3           |
| Automation items shipped / planned         | 2 / 4              | 3 / 4             | One slipped due to an incident         |
| Pages per on-call week (median)            | 14                 | 9                 | From the on-call report                |
| Pages that needed a manual fix             | 40%                | 25%               | Share that ends with a runbook step    |
| SLO attainment for the main services       | 99.93%             | 99.95%            | Against the agreed target              |
| Error budget consumed by operational error | 22%                | 12%               | Budget lost to manual mistakes         |

All values in the table are illustrative, to show the layout. Pull the real ones from the toil log, the on-call tooling (see [[on-call-health]]) and the SLO dashboards. State how each figure was measured, and keep the method the same between quarters so the trend means something. Do not claim that automation caused an SLO change unless you can show the link; say what you changed and what moved.

End the report with a decision request: the automation items you want capacity for next quarter, their payback, and what you will stop doing if you do not get it.

## Example

Certificate renewal is a standard toil source: periodic, manual, easy to forget, and an outage if forgotten. The manual runbook is in [[tls-certificate-renewal]]. The automation replaces the human steps with a controller and an alert for the case where the controller fails.

Before: 6 renewals a week across services, 20 minutes each, with a ticket, a CSR, a copy to the right secret and a restart. After: cert-manager renews 30 days before expiry and the application picks up the new secret, and a human only acts on an alert.

```yaml title="certificate.yaml"
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: api-example-com
  namespace: edge # change: your namespace
spec:
  secretName: api-example-com-tls
  dnsNames:
    - api.example.com # change: your domain
  duration: 2160h # 90 days; change to what your issuer supports
  renewBefore: 720h # renew 30 days before expiry, leaving time to fix a failure
  privateKey:
    rotationPolicy: Always
  issuerRef:
    name: letsencrypt-prod # change: an existing (Cluster)Issuer in your cluster
    kind: ClusterIssuer
```

```yaml title="certificate-alerts.yaml"
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: certificate-expiry
  namespace: monitoring
spec:
  groups:
    - name: certificates
      rules:
        - alert: CertificateExpiresSoon
          # cert-manager exposes this metric; confirm the name on your version.
          expr: certmanager_certificate_expiration_timestamp_seconds - time() < 14 * 24 * 3600
          for: 1h
          labels:
            severity: ticket
          annotations:
            summary: "Certificate {{ $labels.name }} expires in under 14 days"
            runbook_url: https://wiki.example.com/runbooks/tls-certificate-renewal
```

The alert fires at 14 days, well after the 30-day renewal point, so it only fires when renewal has failed. That makes it a signal, not routine work. The payback was computed above: about four weeks for a one-day build, and afterwards the log should show the category falling to near zero. If it does not, find out why before you close the item. Add the numbers to the next quarterly report.

> [!tip] Check the metric name
> The `certmanager_certificate_expiration_timestamp_seconds` metric and the cert-manager `rotationPolicy` field are from memory of the cert-manager interface. Confirm both on the version you run before you roll the rule out.

## Related notes

- [[on-call-health]]: alert load, handovers and burnout signals that sit beside the toil numbers.
- [[tech-debt-management]]: recording automation work as debt and arguing for capacity.
- [[planning-and-prioritization]]: where the toil budget turns into a quarterly capacity split.
- [[tls-certificate-renewal]]: the manual procedure behind the worked example.
