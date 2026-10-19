---
title: Measuring AI impact on delivery without fooling yourself
description: Attribute delivery changes to AI tools with cohorts, a fixed baseline and counter-metrics, and avoid vanity figures such as lines generated or acceptance rate.
type: guide
tags:
  - ai
  - delivery
  - team-process
  - observability
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Six months after a rollout someone asks: "Did the AI tools help?" If the only data is a vendor dashboard showing lines generated and suggestions accepted, the honest answer is "we do not know". Those numbers measure use, not outcome. This guide is about attribution: designing the comparison so a change in delivery can be linked to the tools with some confidence, and showing the uncertainty. The metric definitions are in [[dora-metrics]], and the pilot and rollout process in [[rolling-out-ai-tools-in-a-team]].

> [!info] Scope
> Written for a platform or product engineering team that already measures delivery from its CI/CD and incident data. It is tool-neutral. Check dora.dev for the current definitions of the metrics before publishing numbers, because they have been revised.

> [!note] Not verified
> The method has not been run on real team data, and the thresholds are starting points. Unchecked: the current DORA metric names and any added metrics, and the statistical guidance, which is a summary and not a replacement for a statistician when stakes are high.

## Baseline and cohort design

You cannot see a change without a "before" or a "without". Decide the design before the rollout, not after:

- **Before and after on the same team**, with a fixed baseline window (for example the three months before the start date) and an equally long window after. The baseline is frozen and written down; do not move it when the numbers look inconvenient.
- **Staggered rollout**: some teams start earlier than others, and the later ones act as the comparison group. This is the strongest practical design for a platform team because it controls for things that change for everyone at once.
- **Cohorts of similar work.** Compare like with like: infrastructure changes with infrastructure changes, small service fixes with small service fixes. A new tool that gets used mostly for easy tasks will look good on average.
- **Opt-in bias.** Volunteers are usually the keenest engineers. If only they use the tool, the cohort difference is partly them. Where you can, assign or stagger by team, not by preference.

Write the plan in one page: question, cohorts, windows, metrics, who reviews. Put the start date in your change log so everyone agrees on it.

## DORA metrics as the core set

The DORA research programme describes four key measures of software delivery performance ([[dora-metrics]] explains them in depth):

| Metric                          | What it tells you                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------- |
| Deployment frequency            | How often you ship to production                                                  |
| Lead time for changes           | Time from commit to running in production                                         |
| Change failure rate             | Share of deployments that cause a failure                                         |
| Failed deployment recovery time | Time to recover from a failed deployment (previously called mean time to restore) |

DORA has also discussed adding rework rate as a further measure; check dora.dev for the current set before you rely on it. Use the same data sources and definitions for the baseline and the comparison period, and take them from systems of record (pipeline events, release tags, incident records), not from surveys or self-reports. Where your own definition differs from DORA's, say so in the report.

## Counter-metrics

Throughput numbers can improve while quality or people suffer. Pair every speed metric with metrics that would show the cost:

- **Rework and revert rate:** changes reverted or fixed again within a short period.
- **Review time and review load:** AI-assisted changes can arrive faster than reviewers can read them ([[ai-code-review-bots]] covers the review side).
- **Merge request size:** growing size means harder review.
- **Incidents and escaped defects:** production incidents linked to recent changes, and bugs found after release.
- **Vulnerability and policy findings** per change from your scanners.
- **Test stability:** flaky or deleted tests.
- **On-call load** ([[on-call-health]]), because faster change can mean more pages.

If lead time falls while rework and incidents rise, you moved the cost, not removed it.

## Vanity metrics to avoid

These are cheap to collect and misleading as outcomes:

- **Lines generated, or share of code written by AI.** More code is not more value, and it can mean more to maintain.
- **Suggestion acceptance rate.** It measures how often a suggestion looked plausible, and rises when people accept without reading.
- **Number of active users or prompts.** Use, not outcome.
- **Self-reported "hours saved"** collected once, without a baseline. People are poor at estimating this.

Collect them if the vendor gives them, as context for adoption. Do not put them in the headline.

## Attribution limits

Say plainly what the data can and cannot show:

- **Confounders.** Seasonality (quarter-end releases, holidays), reorganisations, new team members, changes in the codebase, change freezes ([[change-freezes-and-maintenance-windows]]), and other tooling changes in the same period. List the ones you know about next to the chart.
- **Regression to the mean.** A team picked for the rollout because it had a bad quarter will look better afterwards regardless.
- **Small numbers.** A team with a handful of deployments a month produces noisy metrics. Use longer windows or pool teams.
- **Mixed causes.** If the tool changed the work (more tests, more documentation), the effect may be real and not about speed. Name it.
- **Correlation.** Staggered rollout and a baseline reduce the problem; they do not remove it. Use words like "consistent with" and "we saw".

Report **ranges, not single numbers**: medians with interquartile ranges, or intervals from bootstrapping the weekly values, and the number of data points behind each.

## Developer experience

Delivery metrics miss how the work feels, and a tool can slow people down in ways that show up later as attrition. Use short, regular surveys on developer experience; the SPACE framework (satisfaction, performance, activity, communication, efficiency) is a useful checklist for what to ask and a reminder not to rely on one dimension. Keep the survey anonymous, short, and the same each time. Treat the results as signals to investigate with conversations, not as a score. The discussion of productivity in the ACM Queue article below is worth reading before you design it.

## Dashboard and review cadence

Build one dashboard, owned by one person, with:

1. The four delivery metrics per cohort, as ranges, for the baseline and current windows.
2. The counter-metrics beside them.
3. Adoption context (seats active), clearly labelled as use, not outcome.
4. Annotations for rollout dates, freezes, reorganisations and incidents.
5. A "what we cannot conclude" box.

Review it **quarterly** with the engineering leads, as part of the regular engineering review ([[quarterly-engineering-review]]), and decide: continue, widen, narrow, or stop. Compare the result with the pre-rollout expectations and the bake-off findings ([[evaluating-ai-tools-for-a-platform-team]]), and send what you learn back into the next evaluation. Keep the cost per team next to the benefits so the decision is about value for money ([[llm-api-cost-control]] covers the cost side), and never use these metrics to rank individual engineers.

## Sources

- [DORA](https://dora.dev/), DevOps Research and Assessment.
- [DORA's four keys](https://dora.dev/guides/dora-metrics-four-keys/), verify the path, as it may have moved.
- [The SPACE of Developer Productivity](https://queue.acm.org/detail.cfm?id=3454124), ACM Queue.

## Related

- [[dora-metrics]]: definitions and how to collect the four keys.
- [[rolling-out-ai-tools-in-a-team]]: the pilot and rollout this measurement supports.
- [[evaluating-ai-tools-for-a-platform-team]]: pre-rollout evaluation of tools.
- [[ai-code-review-bots]]: review-side effects to watch.
- [[quarterly-engineering-review]]: where the dashboard is reviewed.
- [[change-freezes-and-maintenance-windows]]: a common confounder.
- [the owner's AI skills catalogue](https://ai.szolotov.com): reusable agent skills and workflows.
