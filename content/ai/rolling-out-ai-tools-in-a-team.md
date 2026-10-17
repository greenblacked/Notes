---
title: Rolling out AI coding tools in a DevOps team
description: An engineering manager's guide to piloting AI coding and review assistants with a baseline, outcome metrics, security review, cost tracking and a go or no-go decision.
type: guide
tags:
  - ai
  - management
  - leadership
  - delivery
created: 2026-10-17
modified: 2026-10-17
draft: false
---

This guide is for an engineering manager, or an engineer moving into management, who has to decide whether AI coding and review assistants are worth adopting in a DevOps team. It covers questions to answer before a pilot, how to design the pilot, which outcomes to measure, how to track cost, which team norms to set, and how to decide. It does not define the code policy itself ([[ai/ai-generated-code-policy-and-provenance]]), the technical controls for agents ([[ai/securing-ai-agents-in-ci-and-cloud]]) or the metrics themselves in depth ([[management/dora-metrics]]).

> [!info] Scope and sources
> Written for a platform or DevOps team of roughly five to fifteen engineers working with GitLab or Jenkins pipelines, Terraform, Helm and GKE. It uses generic "AI assistant" wording and no product names. Durations and thresholds are examples to adapt, not benchmarks. The DORA measures follow the public [DORA research programme](https://dora.dev/).

> [!note] Not verified
> The claims below were written from general experience and documentation knowledge and were not checked against a running system or the current docs: your provider's data-retention and training terms, licence terms for generated code, and the fields available in your merge request export. Check them before relying on them. No statistics or prices are quoted on purpose.

## Before you start

Answer these before anyone installs anything. Most "pilot failures" are decisions skipped here.

**Security and data**

- What leaves the laptop or the repository: file contents, prompts, telemetry, full repositories?
- Is the data used to train models, and for how long is it retained? Get this in writing from the provider.
- Which repositories are out of scope (secrets, customer data, regulated systems)?
- Can the tool run commands or call cloud APIs? If yes, see [[ai/securing-ai-agents-in-ci-and-cloud]] first.
- Where do logs of use go, and who can read them?

**Procurement and legal**

- Who owns the contract and the data processing terms? Involve security and legal early.
- What are the licence and copyright terms for generated code? Ask legal; do not guess.
- Is single sign-on and seat removal supported, so leavers lose access?

**Fit**

- Which problems do you expect it to help with: boilerplate, tests, Terraform and Helm edits, review summaries, documentation?
- Who is the sponsor, and what would make them stop the pilot?

## Pilot design

Run a time-boxed pilot with a baseline, a control and an end date. The durations below are examples.

| Weeks | Teams                  | Activities                                                                    |
| ----- | ---------------------- | ----------------------------------------------------------------------------- |
| 0-2   | Whole team             | Security and data review, pick scope, collect baseline metrics, run training  |
| 3-8   | Pilot group (3-5 devs) | Use the tool on agreed work; weekly 30-minute check-in; log problems and wins |
| 3-8   | Control group          | Work as usual; same metrics collected                                         |
| 9     | Whole team             | Compare against the baseline, survey, cost review                             |
| 10    | Sponsor and security   | Go, no-go or extend decision, written down                                    |

Pick comparable people for both groups, and avoid starting during a release freeze or an on-call-heavy period. If the team is too small for a control group, compare each person with their own previous weeks and say that the comparison is weaker.

A short pilot plan keeps everyone aligned:

```text
Pilot plan: AI coding assistant

Owner:            <MANAGER NAME>
Sponsor:          <SPONSOR NAME>
Dates:            <START DATE> to <END DATE>
Scope:            <REPOSITORIES IN SCOPE>
Out of scope:     <REPOSITORIES AND DATA EXCLUDED, e.g. secrets, customer data>
Pilot group:      <NAMES>
Control group:    <NAMES>
Tool and plan:    <TOOL NAME, SEAT OR USAGE BASED>
Allowed uses:     <E.G. tests, docs, Terraform and Helm edits, review summaries>
Forbidden uses:   <E.G. pasting secrets, production data, unreviewed merges>
Baseline metrics: lead time, change failure rate, review turnaround, escaped defects
Survey dates:     <WEEK 0 AND WEEK 9>
Stop conditions:  <E.G. a data leak, a security finding, failing quality gates>
Decision date:    <DATE>, decided by <NAMES>
```

## Metrics

Measure outcomes, not output. Lines of code, number of merge requests and prompt counts go up with tools that generate more text, and say nothing about value.

| Metric                | Source                                          | Why                                                                          |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Lead time for changes | Git and pipeline data                           | Shows whether work flows faster end to end                                   |
| Change failure rate   | Incident and rollback records                   | Catches speed bought with more breakage                                      |
| Review turnaround     | MR export (created, first review, merged times) | Shows whether review is a bottleneck or got heavier                          |
| Escaped defects       | Incident tickets traced to recent changes       | Quality that reaches production                                              |
| Quality gate failures | SonarQube and CI results                        | Early signal of lower quality code; see [[patterns/sonarqube-quality-gates]] |
| Developer survey      | Short form, weeks 0 and 9                       | Experience, trust, time saved and lost, which logs cannot show               |
| Time on toil          | Survey or ticket sample                         | Whether it removes boring work or adds checking work                         |

Use [[management/dora-metrics]] for the first two. Compare trends and groups, never individuals, and never use these numbers in performance reviews; people will otherwise game them or hide usage.

A sketch for review turnaround, to adapt to your data. The table and column names here are assumptions about an export of merge request data:

```sql
-- Data source: your own export of merge requests, loaded into a table
-- named merge_requests (adapt table and column names to your export).
-- Columns assumed: id, author, created_at, first_review_at, merged_at,
-- and group_name ('pilot' or 'control').
SELECT
  group_name,
  date_trunc('week', created_at) AS week,
  count(*) AS merge_requests,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY extract(epoch FROM (first_review_at - created_at)) / 3600
  ) AS median_hours_to_first_review,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY extract(epoch FROM (merged_at - created_at)) / 3600
  ) AS median_hours_to_merge
FROM merge_requests
WHERE merged_at IS NOT NULL
  AND created_at >= DATE '2026-09-01' -- change: baseline start date
GROUP BY group_name, week
ORDER BY group_name, week;
```

Short surveys get answered; long ones do not. Ask the same questions at the start and the end:

```text
Rate each from 1 (strongly disagree) to 5 (strongly agree):
1. I trust the code the assistant suggests enough to review it quickly.
2. The assistant saves me time on tasks I care about.
3. I spend more time fixing or checking its output than I save.
4. I understand what data the tool sends outside our network.
5. I know what is not allowed to be pasted into it.

Free text:
6. Where did it help most?
7. Where did it get in the way or produce something wrong?
8. What should the team rule be?
```

## Cost tracking

Track cost from week one so the decision is not a surprise.

- Record the pricing model: per seat, per usage or both. Take numbers from your contract, not from this note.
- Note seats assigned and seats actually used each week. Unused seats are the easiest saving.
- For usage-based plans, set a budget alert per team and review it weekly.
- Count the hidden cost: training time, review time spent on generated code, security review and admin.
- Compare against the benefit in the same units, such as hours saved from the survey and the lead time change. State the uncertainty.

Reclaim idle seats on a schedule instead of waiting for the renewal. Use the same cost-allocation labels you use for cloud spend if the vendor offers a usage export.

## Team norms

Agree norms before the pilot starts and put them in the repository next to the contributing guide. The detailed policy lives in [[ai/ai-generated-code-policy-and-provenance]]; a short version for the team:

- The author owns every line they commit, however it was written. "The AI wrote it" is not a review answer.
- No secrets, customer data or production data in prompts.
- Generated Terraform, Helm and pipeline changes get the same review as hand-written ones, with extra attention to permissions and `terraform plan` output.
- Say in the merge request when a change was substantially generated, if your policy asks for it.
- Tests and quality gates must pass; never lower a gate to merge generated code.
- Agents that run commands or hold credentials need their own review, see [[ai/securing-ai-agents-in-ci-and-cloud]].
- Share useful prompts and workflows in a team repository. For examples of reusable skills and workflows, see [the owner's AI skills catalogue](https://ai.szolotov.com).

Run a one-hour session at the start with examples from your own repositories: a good result, a plausible wrong result, and a prompt that leaked something it should not have.

## Decision and rollout

At the end of the pilot, write a one-page decision for the sponsor and security (see [[management/stakeholder-communication]]):

1. What was tried, for how long and by whom.
2. Baseline and pilot numbers for each metric, with caveats.
3. Survey results and quotes.
4. Cost per active user and total.
5. Security findings and how they were handled.
6. Decision: go, no-go or extend, with the conditions.

If the answer is go, roll out in waves rather than all at once. Add one team at a time, keep the norms in the repository, name an owner for the tool and review the metrics each quarter. Fit it into the team's priorities ([[management/planning-and-prioritization]]) and decide which team owns the shared configuration and approved tools ([[management/platform-team-operating-model]]). If the answer is no-go, write down why, so the next evaluation starts from facts.

## Pitfalls

- **No baseline.** Without before numbers, every result is an opinion.
- **Counting lines or merge requests.** More output is not more value; measure outcomes.
- **Skipping security review.** A pilot with real code is a data transfer; review it first.
- **Mandating usage.** Targets for usage create theatre. Measure results and let people opt in.
- **Ignoring juniors and seniors differently.** Juniors may over-trust, seniors may under-use. Check both in the survey.
- **Review overload.** Faster authoring can swamp reviewers; watch review turnaround.
- **One-off evaluation.** Tools and terms change. Re-check data terms and costs at least every renewal.

> [!note] Treat the numbers as starting points
> The durations, group sizes and metrics here are starting points. Adjust them to your team size and risk, and decide in advance what result would change your mind.

## Related

- [[management/dora-metrics]]: the delivery metrics to use as baseline and outcome.
- [[management/planning-and-prioritization]]: where the pilot fits among other work.
- [[management/platform-team-operating-model]]: who owns shared tooling and standards.
- [[ai/ai-generated-code-policy-and-provenance]]: the policy behind the team norms.
- [[ai/securing-ai-agents-in-ci-and-cloud]]: technical controls for agents with access.
- [the owner's AI skills catalogue](https://ai.szolotov.com): reusable agent skills and workflows.
