---
title: Engineering budget planning and forecasting
description: How an engineering manager builds an annual budget, forecasts monthly, explains variance and tracks vendor renewals, with templates and a worked hire example.
type: guide
tags:
  - management
  - cost
  - leadership
  - team-process
created: 2026-10-17
modified: 2026-10-17
draft: false
---

Moving from engineer to engineering manager usually means owning a budget for the first time. You are asked what the team will cost next year, why last month was over plan, and what you would cut if you had to. This note covers the manager's side: people, cloud, SaaS and vendors, a monthly forecast and variance notes. Allocation of cloud cost to teams and guardrails are in [[finops-cost-allocation-and-guardrails]].

> [!info] Illustrative numbers
> All amounts are examples in an unnamed currency. The loaded-cost multiplier and every percentage are assumptions to calibrate with your finance partner. Your fiscal year, approval limits and tooling will differ.

## Budget lines

Split the budget into lines that finance recognises and that you can control separately. A typical engineering budget has five.

| Line                   | What it contains                                                        | How much you control it           |
| ---------------------- | ----------------------------------------------------------------------- | --------------------------------- |
| People                 | Salaries, bonus, benefits, employer taxes, contractors                  | By hiring plan; most of the total |
| Cloud                  | GCP projects, networking, support plan, Cloudflare plan                 | By usage and commitments          |
| SaaS and tools         | GitLab, Jenkins plugins and support, SonarQube, Artifactory, monitoring | By seat count and contract        |
| Vendors and services   | Consultants, managed services, audits, penetration tests                | By contract                       |
| One-off and enablement | Equipment, training, conferences, recruiting fees, migration projects   | By decision, often discretionary  |

Keep the lines stable from year to year so you can compare. Tag each cost with a team, an environment and, where possible, a product, so you can answer "what does service X cost to run" later.

### Workbook structure

One spreadsheet (or a finance-system export that you reconcile to one) is enough. Keep the structure the same every month.

```text title="Workbook structure"
Sheet 1  Summary         Totals by line: plan, YTD actual, full-year forecast, variance
Sheet 2  People          One row per person or open role: start date, end date, base,
                         loaded cost per month, ramp factor, cost per month (12 columns)
Sheet 3  Cloud           Cost by project/team from the billing export, committed spend,
                         forecast with growth assumptions
Sheet 4  SaaS-Vendors    The renewal register (one row per contract), cost per month
Sheet 5  One-off         Equipment, training, recruiting, projects, with approval status
Sheet 6  Assumptions     Loaded-cost multiplier, growth rates, FX rate, attrition,
                         hiring-delay assumption, who supplied each number and when
Sheet 7  Log             Date, who changed what, why (a plain change history)
```

The **Assumptions** sheet is the most important one. Every number in the other sheets that is a guess points at a cell there. When finance challenges the plan, you change an assumption instead of rebuilding.

## From headcount plan to loaded cost

A salary is not the cost of an employee. The **loaded cost** adds the extra costs of employing someone: employer taxes, benefits, pension, equipment, software seats and a share of overheads. Finance usually gives you a multiplier or a per-role figure.

```text title="Loaded cost"
monthly loaded cost = annual base salary / 12 x loaded-cost multiplier
```

> [!warning] Assumption to calibrate
> The multiplier of 1.3 used in the example below is an assumption, not a standard. It varies with country, benefits and what finance includes. Ask finance for their number and ask which items it covers, so you do not count equipment or seats twice.

Build the people sheet from a headcount plan:

1. List every current person with the date any change takes effect (promotion, leave, planned departure).
2. Add each open or planned role with a **start date**, not a requisition date. Hires start later than you hope; plan for notice periods and a hiring delay (see [[hiring-devops-engineers]] for how long a loop takes in practice).
3. Apply the ramp (see the worked example) so you see capacity as well as cost.
4. Add a vacancy allowance only if finance asks for one, and write down the percentage and why.

### Worked example: one hire with an onboarding ramp

You plan to hire one platform engineer, starting 1 April, in a calendar fiscal year. Assumptions: annual base 80,000, loaded multiplier 1.3, a recruiting agency fee of 15% of base, 2,000 for equipment.

```text title="Cost for the first fiscal year"
Loaded cost per year     = 80,000 x 1.3          = 104,000
Loaded cost per month    = 104,000 / 12          =   8,666.67
Months employed (Apr-Dec)                        =   9
Salary and on-costs      = 8,666.67 x 9          =  78,000
Recruiting fee (15%)     = 80,000 x 0.15         =  12,000
Equipment                                        =   2,000
Total first-year cost                            =  92,000
```

Cost and capacity are different things. A new engineer is not at full output on day one, and someone senior spends time on onboarding (see [[onboarding-engineers]]).

| Month of employment | Productivity (assumed) | Effective engineer-months | Mentor time (assumed) |
| ------------------- | ---------------------- | ------------------------- | --------------------- |
| 1                   | 25%                    | 0.25                      | 0.2                   |
| 2                   | 50%                    | 0.50                      | 0.2                   |
| 3                   | 75%                    | 0.75                      | 0.2                   |
| 4 to 9              | 100%                   | 6.00                      | 0                     |
| Total               |                        | 7.50                      | 0.6                   |

Net capacity gained in year one is 7.5 - 0.6 = 6.9 engineer-months, for a cost of 92,000. In year two the same person costs 104,000 and gives about 12 engineer-months. The ramp percentages are assumptions; replace them with what you saw on your last two hires.

Two things to say to finance and to your own manager:

- If the start slips from April to May, you underspend by about 8,667 in the year, but you also lose a month of capacity. Report both.
- A hire that starts late in the year costs little in year one and the full amount in year two. Put the annualised cost next to the in-year cost.

Link the headcount ask to the quarterly priorities in [[planning-and-prioritization]]: a role with no named outcome is the first thing finance cuts.

## Cloud and commitments

Cloud is the line that changes most between plan and actual, because it follows usage.

- **Baseline from the billing export.** Use the last three to six full months by project and by team. Remove one-off spikes you can name (a migration, an incident).
- **Growth assumptions.** Add explicit drivers: new services, traffic growth, data retention, environments. Each driver goes on the Assumptions sheet with an owner.
- **Planned savings.** Count a saving only when someone owns the change and it has a date. Right-sizing, autoscaling and storage lifecycle rules are covered in [[kubernetes-autoscaling]] and [[finops-cost-allocation-and-guardrails]].
- **Commitments.** Committed use discounts (CUDs) trade a lower unit price for a fixed spend or resource commitment over a period. They suit steady baseline usage and are a bad fit for workloads you may move or shut down. Treat the commitment as a fixed cost in the forecast, with its end date in the renewal register.
- **Support plans and network egress** are easy to forget. Add them as their own rows.

> [!warning] Check before relying on this
> Not verified: Google Cloud committed use discount terms, discount percentages, what is eligible and how they are billed today, and the names of the phases in the FinOps framework. Read the current Google Cloud pricing and commitment documentation and the FinOps Foundation material, and have finance confirm how commitments are booked, before putting numbers into a plan.

## SaaS and vendor renewals and exit plans

Most surprise spend and most lock-in sits in contracts that auto-renew. Keep a **renewal register**, one row per contract, reviewed monthly. This replaces a separate vendor-management process for a team of this size.

| Field            | Why it matters                                                     |
| ---------------- | ------------------------------------------------------------------ |
| Vendor, product  | What it is                                                         |
| Owner            | One named person who decides on renewal                            |
| Business purpose | Which service or process breaks without it                         |
| Start and end    | Contract term                                                      |
| Notice period    | How many days before the end you must act, or it auto-renews       |
| Decide-by date   | End date minus notice period minus time to evaluate and negotiate  |
| Cost, billing    | Annual or monthly, per seat or flat, price-increase clause         |
| Data and access  | What data the vendor holds, which systems integrate, which secrets |
| Exit plan        | The alternative, how to export data, how long migration takes      |
| Status           | Renew, renegotiate, replace, retire                                |

A sample row:

```text title="Renewal register row (illustrative)"
Vendor / product : ExampleVendor Code Quality (hosted)
Owner            : Platform engineering manager
Purpose          : Static analysis gate in the CI pipeline for all services
Term             : 2025-04-01 to 2027-03-31
Notice period    : 90 days (written notice by 2026-12-31 to avoid auto-renewal)
Decide-by        : 2026-11-15 (leaves six weeks to evaluate and negotiate)
Cost             : 24,000 per year, billed annually; 5% annual uplift clause
Data / access    : Source code and findings history; CI token with read access
Exit plan        : Self-hosted alternative evaluated in 2026-Q3; export findings
                   as JSON; two engineer-weeks to switch pipelines
Status           : Renegotiate; ask for a multi-year price cap
```

Rules that keep the register useful:

- The **decide-by date** goes in the owner's calendar, not just in the sheet. Missing a notice date is the commonest way to lose negotiating power.
- Write the exit plan before you sign, and re-read it at each renewal. If the plan is "we cannot leave", that is a risk to record and tell stakeholders about (see [[stakeholder-communication]]).
- Compare seats or usage against what you pay for. Idle seats and unused environments are the easiest savings.
- Involve security and legal for vendors that store data or hold access to production. This note does not replace their review.

## Monthly forecast

Once a month, after finance closes the books, update **actuals** and **re-forecast the rest of the year**. The forecast is your best current estimate, not the plan. Do not change the plan during the year; the gap between plan and forecast is the information.

Illustrative table at the end of June (six months in):

| Line      | Annual plan | YTD plan | YTD actual | Full-year forecast | Variance (forecast - plan) |
| --------- | ----------- | -------- | ---------- | ------------------ | -------------------------- |
| People    | 1,000,000   | 480,000  | 455,000    | 985,000            | -15,000                    |
| Cloud     | 600,000     | 290,000  | 318,000    | 650,000            | +50,000                    |
| SaaS      | 120,000     | 60,000   | 61,500     | 123,000            | +3,000                     |
| Vendors   | 80,000      | 40,000   | 40,000     | 80,000             | 0                          |
| One-off   | 50,000      | 30,000   | 14,000     | 45,000             | -5,000                     |
| **Total** | 1,850,000   | 900,000  | 888,500    | 1,883,000          | +33,000                    |

Convention: variance is forecast minus plan, so a positive number is an overspend. State the sign in the table header and keep it for the whole year.

How to build each forecast figure:

- **People:** actuals to date plus remaining months by person, using real start and end dates. A hire that has slipped is the usual reason for an underspend.
- **Cloud:** the latest monthly run rate plus the known drivers (a launch, a migration) and planned savings. Do not just multiply by twelve.
- **SaaS and vendors:** contracted amounts plus renewals due this year at the expected price.
- **One-off:** approved items plus those you expect to approve.

Look ahead too: show the forecast for the next two quarters by month, so finance sees when the spend lands.

## Variance notes

For every line whose forecast differs from the plan by more than a threshold you agree with finance (for example 5% or a fixed amount, whichever is larger), write a short note. Say what happened, why, whether it is a one-off or a run-rate change, and what you will do.

```text title="Variance note template"
Line:        <People | Cloud | SaaS | Vendors | One-off>
Period:      <month and year-to-date>
Variance:    <amount and %, forecast minus plan; positive = overspend>
What:        <the facts in one or two sentences>
Why:         <the cause: volume, price, timing, scope, or a plan error>
Nature:      <one-off | timing (reverses later) | run-rate change>
Impact:      <effect on full-year forecast and on next year>
Action:      <what you are doing, who owns it, by when>
Decision:    <what you need from finance or leadership, or "none">
```

A filled example:

```text title="Variance note (illustrative)"
Line:        Cloud
Period:      June, year to date
Variance:    +50,000 on the full year (+8.3% of plan)
What:        Spend has run about 7,000 per month above plan since March
             (28,000 so far).
Why:         A new analytics workload went to production in March with
             an unplanned always-on cluster; plan assumed a batch job.
Nature:      Run-rate change.
Impact:      +50,000 this year (28,000 so far plus 22,000 expected before the
             fix lands); about +84,000 a year if the run rate is not fixed.
Action:      Move the workload to autoscaled, scheduled capacity; owner is the
             data platform lead; target is back to plan by the end of Q3.
Decision:    None for now; will raise a plan change request if the saving
             is not visible by the September forecast.
```

Be plain about plan errors. "We under-estimated" is a better note than a long explanation that hides it.

## Working with finance

Your finance partner is your most useful ally if you treat them as a colleague who needs good inputs on time.

- **Learn the calendar.** Know when the plan is due, when books close, when forecasts are locked and who approves what. Plan your updates a few days before each date.
- **Use their definitions.** Agree what counts as capital or operating cost, how contractors and recruiting fees are booked, which exchange rate is used and how commitments are recognised.
- **No surprises.** Tell them early about a large renewal, a hiring change, a commitment you are about to sign or an overspend you can see coming. A forecast shared at month five is better than a variance at month eleven.
- **Show the assumptions.** Share the Assumptions sheet. It builds trust and lets them correct a wrong number early.
- **Bring options.** When you are over, offer choices with a trade-off for each: delay a hire, defer a project, change a tier, renegotiate a contract. Link them to priorities in [[planning-and-prioritization]].
- **Keep records.** Keep approvals, quotes and the log sheet. They answer audit questions later.

Report the numbers in the quarterly review too; see [[quarterly-engineering-review]].

## Related

- [[hiring-devops-engineers]]
- [[planning-and-prioritization]]
- [[finops-cost-allocation-and-guardrails]]
- [[stakeholder-communication]]
- [[onboarding-engineers]]
- [[quarterly-engineering-review]]
