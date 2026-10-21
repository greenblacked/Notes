---
title: Developer experience surveys for platform teams
description: Run a repeatable developer experience survey for a platform, with question design, a question bank, anonymity rules, an analysis script and follow-up.
type: guide
tags:
  - management
  - delivery
  - team-process
  - leadership
  - ci-cd
created: 2026-10-21
modified: 2026-10-21
draft: false
---

DORA metrics, pipeline durations and adoption counts tell a platform team what is happening. They do not tell it why: why a team avoids the golden path, why deploys feel risky although the change failure rate is fine, or why everyone asks the same question in the support channel. A short, regular survey of the platform's users answers the "why" and shows whether the answers change after the team acts on them. Done badly, it is a yearly form nobody trusts; done well, it is one of the main inputs to the roadmap ([[platform-roadmap-multi-quarter]]).

> [!info] Scope and what is not verified
> This note describes a method, not a validated instrument. The SPACE paper (ACM Queue, 2021) is cited for one claim, that productivity cannot be captured by a single metric. The SPACE dimension names and the DevEx framework's dimensions below are **not verified** against the papers in this review; read them at the source before you quote them. No benchmark response rates, sample sizes or survey intervals were checked: every number here is an example to set locally. The analysis script was tested only against made-up data.

## What a survey can and cannot tell you

| A survey is good for                                     | A survey is poor for                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| Perceived friction: where people lose time or confidence | Measuring how long things actually take                            |
| Comparing journeys: CI versus deploy versus docs         | Ranking teams or people                                            |
| Change over time on the same questions                   | One-off answers to a new, complicated question                     |
| Finding problems no metric covers (support, docs, trust) | Validating a solution you already chose                            |
| Giving quiet users a voice                               | Replacing conversations: it shows where to look, not what to build |

Perception is data. If developers believe the deploy pipeline is unreliable, they batch changes and deploy less often, whatever the dashboard says. The survey measures that belief; the system data tells you whether it is accurate.

## Pairing perception with system data

The SPACE paper argues that developer productivity cannot be measured by a single metric or dimension, and proposes looking across several. The dimensions are commonly summarised as satisfaction and well-being, performance, activity, communication and collaboration, and efficiency and flow (**not verified** here; check the paper). The later DevEx framework from some of the same authors focuses on developer experience through feedback loops, cognitive load and flow state (also **not verified**; check the paper). Neither is a questionnaire you can copy; both are useful as a checklist that you are not measuring only one thing.

In practice, put every survey question next to a system metric where one exists:

| Survey statement (agree 1 to 5)                                 | System data next to it                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| "My CI pipeline gives me feedback fast enough to stay focused." | Median and 90th percentile pipeline duration on merge requests              |
| "I am confident a deploy will not break production."            | Change failure rate and rollback count ([[dora-metrics]])                   |
| "I can find the documentation I need without asking."           | Support questions per week that link to an existing doc                     |
| "Getting a new service to production is straightforward."       | Time from repository creation to first production deploy on the golden path |

When the two disagree, that is the interesting finding. Fast pipelines with low "fast enough" scores often mean flaky jobs and retries; good change failure rates with low confidence often mean that rollback is hard or poorly understood.

## Question design rules

- **Statements about the respondent's own experience,** in the last few weeks: "In the last month, I could..." not "The platform is...".
- **One idea per statement.** "CI is fast and reliable" is two questions.
- **One scale for everything:** a five-point agreement scale (strongly disagree to strongly agree), plus "does not apply to me". Keeping the scale fixed lets you compare questions and rounds.
- **Neutral wording.** "How much does the new deploy tool improve your work?" assumes it does.
- **Few questions.** Aim for something completed in about ten minutes (example, set your own). Rotate optional modules instead of asking everything every time.
- **Keep core questions stable** across rounds; change wording only when you accept losing the comparison.
- **Two free-text questions at most:** "What is the single biggest thing slowing you down?" and "What should the platform team stop, start or continue?" Free text is where the surprises are.
- **No questions that identify a person** by combination (team plus role plus location plus tenure). Ask for the team or area only if you need the breakdown and the groups are big enough (see anonymity below).

## Question bank by journey

Pick a core set of about a dozen and one rotating module per round. All statements use the agreement scale.

| Journey                           | Statement                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| Local development                 | I can get a working local environment for my service in under a day.                              |
| Local development                 | I can reproduce a CI failure on my machine when I need to.                                        |
| CI (GitLab CI or Jenkins)         | My pipeline gives me feedback fast enough to stay focused.                                        |
| CI                                | When my pipeline fails, the failure is usually caused by my change, not by flaky jobs or runners. |
| CI                                | I understand the shared CI templates well enough to change my pipeline safely.                    |
| Images and dependencies           | Building and publishing a container image is straightforward.                                     |
| Images and dependencies           | Fetching dependencies from Artifactory rarely slows me down or fails.                             |
| Images and dependencies           | I know what to do when a security scan blocks my build.                                           |
| Deploy (Helm, Argo CD, Spinnaker) | I am confident a deploy will not break production.                                                |
| Deploy                            | I can roll back a bad deploy quickly without help.                                                |
| Deploy                            | I can see what version of my service runs in each environment.                                    |
| Infrastructure (Terraform)        | I can get the cloud resources my service needs without waiting on another team.                   |
| Infrastructure                    | I understand the Terraform modules I use well enough to change them.                              |
| Observability                     | I can tell from dashboards and logs whether my service is healthy.                                |
| Observability                     | Alerts for my service are actionable.                                                             |
| On-call                           | On-call for my service is sustainable.                                                            |
| Docs and support                  | I can find the documentation I need without asking someone.                                       |
| Docs and support                  | When I ask the platform team for help, I get a useful answer in a reasonable time.                |
| Overall                           | The platform helps me deliver more than it gets in my way.                                        |
| Overall                           | I would recommend the golden path to a new service team.                                          |

The journeys follow the golden path ([[golden-path-templates-architecture]]) and the platform's layers ([[internal-developer-platform-architecture]]). If your platform has a journey not listed here, add one statement for it before adding a third for an existing one.

## Cadence and survey fatigue

- **Twice a year is a reasonable start** (example, set your own), aligned so results arrive before roadmap planning.
- **Short pulse checks** (three to five statements) after a big change, such as a CI template major version, only for the people affected.
- **Never more often than you can act.** If the previous round's "you said, we did" has not been published, do not send the next survey.
- **Coordinate with other surveys** in the company (engagement, security, HR). Developers do not distinguish between them, and fatigue is shared.

## Anonymity and minimum group size

People answer honestly only if they believe they cannot be identified. Make that true, and say how.

- **Collect no names or email addresses** in the response data. If the tool needs sign-in to prevent duplicates, make sure the export does not include the identity, and say so in the invitation.
- **Report groups only above a minimum size.** The script below hides any group with fewer responses than a threshold; five is a common starting point (example, set your own, and make it larger for sensitive questions).
- **Watch for subtraction.** If you publish an overall result and every group but one, the hidden group can be computed. Hide a second group, or merge small groups into "other", when that would happen.
- **Free text can identify people.** Read it before sharing; remove names, team-specific details and anything that points to an individual. Share themes, not quotes, unless the person agreed.
- **Results are never used for individual performance.** State that in the invitation and keep to it ([[performance-feedback]] is a separate process).

> [!warning] Check data protection and employee representation rules first
> A survey of employees is personal data processing in many jurisdictions, and some organisations need the agreement of a works council or employee representatives before running one. Check with your data protection contact and HR before the first round: what you may collect, where the data is stored, who can see raw responses and how long you keep them. This note is not legal advice.

## Sampling and response rate

- **Survey everyone who uses the platform,** not a sample, while the population is in the hundreds. Sampling adds complexity without much gain at that size.
- **Track response rate per area,** not only overall. A good overall rate with one silent department means the results describe the others.
- **Ask managers to give time,** not to chase individuals. Pressure lowers honesty.
- **Report the response count with every number.** A 40-point change from five responses is noise.

Do not add margins of error or significance tests unless someone with the statistics background designs them; for a platform team's decisions, the size of the change, the number of responses and the free text together are usually enough.

## Analysis script

The script reads a CSV export with one row per response. Question columns start with `q_` and hold 1 to 5 (blank for "not answered" or "does not apply"). It prints, per question, the number of answers, the favourable share (4 or 5), the unfavourable share (1 or 2), the median, the change in favourable share since the previous round, and the distribution. With `--group`, it adds per-group favourable shares and hides groups below the minimum size.

```python title="survey_report.py"
#!/usr/bin/env python3
"""Summarise a developer experience survey export. Standard library only.

Input: one CSV row per response. Question columns are named with a prefix
(default "q_") and hold 1 to 5 agreement scores (blank = not answered).
An optional group column (for example "team") gives per-group results,
suppressed below a minimum group size.

  python3 survey_report.py 2026-q4.csv --previous 2026-q2.csv --group team --min-group 5
"""
import argparse
import csv
import statistics
import sys
from collections import Counter, defaultdict


def load(path, prefix, group_col):
    """Return {question: [scores]} overall and {group: {question: [scores]}}."""
    overall, by_group = defaultdict(list), defaultdict(lambda: defaultdict(list))
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        questions = [c for c in (reader.fieldnames or []) if c.startswith(prefix)]
        if not questions:
            sys.exit(f"{path}: no columns starting with {prefix!r}")
        for row in reader:
            group = (row.get(group_col) or "").strip() if group_col else ""
            for q in questions:
                raw = (row.get(q) or "").strip()
                if not raw:
                    continue
                score = int(raw)
                if not 1 <= score <= 5:
                    sys.exit(f"{path}: {q} has out-of-range value {raw!r}")
                overall[q].append(score)
                if group:
                    by_group[group][q].append(score)
    return overall, by_group


def favourable(scores):
    return sum(s >= 4 for s in scores) / len(scores) if scores else None


def main() -> int:
    ap = argparse.ArgumentParser(description="Developer experience survey report")
    ap.add_argument("current")
    ap.add_argument("--previous", help="CSV from the previous round, same question ids")
    ap.add_argument("--prefix", default="q_")
    ap.add_argument("--group", help="column with the group, e.g. team")
    ap.add_argument("--min-group", type=int, default=5, help="hide groups smaller than this")
    args = ap.parse_args()

    cur, cur_groups = load(args.current, args.prefix, args.group)
    prev = load(args.previous, args.prefix, None)[0] if args.previous else {}

    print(f"{'question':28} {'n':>4} {'fav':>5} {'unfav':>6} {'median':>7} {'change':>7}  distribution 1..5")
    for q in sorted(cur):
        s = cur[q]
        fav = favourable(s)
        unfav = sum(x <= 2 for x in s) / len(s)
        dist = Counter(s)
        change = ""
        if q in prev and prev[q]:
            change = f"{(fav - favourable(prev[q])) * 100:+.0f}pt"
        bars = " ".join(f"{dist.get(i, 0):3d}" for i in range(1, 6))
        print(f"{q:28} {len(s):4d} {fav:5.0%} {unfav:6.0%} {statistics.median(s):7.1f} {change:>7}  {bars}")

    if args.group:
        print(f"\nFavourable by {args.group} (groups under {args.min_group} responses hidden)")
        for g in sorted(cur_groups):
            sizes = [len(v) for v in cur_groups[g].values()]
            if not sizes or max(sizes) < args.min_group:
                print(f"  {g:20} hidden (fewer than {args.min_group} responses)")
                continue
            parts = []
            for q in sorted(cur_groups[g]):
                s = cur_groups[g][q]
                parts.append(f"{q}={favourable(s):.0%}" if len(s) >= args.min_group else f"{q}=hidden")
            print(f"  {g:20} " + "  ".join(parts))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Output on made-up data:

```text
question                        n   fav  unfav  median  change  distribution 1..5
q_ci_feedback_fast             18   78%     0%     4.5   +30pt    0   0   4   5   9
q_deploy_confident             21   52%    19%     4.0   +16pt    4   0   6   5   6
q_docs_findable                18   50%    28%     3.5    +0pt    3   2   4   5   4

Favourable by team (groups under 5 responses hidden)
  data                 hidden (fewer than 5 responses)
  payments             q_ci_feedback_fast=78%  q_deploy_confident=27%  q_docs_findable=71%
  search               q_ci_feedback_fast=71%  q_deploy_confident=86%  q_docs_findable=38%
```

Notes on reading it:

- Look at the unfavourable share as well as the favourable one. A question with 50% favourable and 45% unfavourable is polarised, which usually means two groups with different experiences; the group breakdown shows which.
- In this example, the group "data" is hidden, but with the overall and two visible groups someone could compute it. Before publishing, merge it into "other" or hide a second group.
- Store the raw exports where only the survey owner can read them, and publish only the report.

## Turning results into roadmap items

1. **Pick the three lowest-scoring journeys** with enough responses, and read their free text. Do not try to fix everything.
2. **Pair each with system data** from the table above. Confirm the friction is real and find where it comes from.
3. **Talk to five users** per problem before designing anything ([[platform-product-discovery]]). The survey says where; interviews say what.
4. **Write each as a roadmap item** with the survey statement as the success measure: "raise 'my pipeline gives feedback fast enough' from 40% to 60% favourable by the next round", next to the system metric.
5. **Publish "you said, we did"** within a month of the survey closing: the top themes, what the team will do, what it will not do and why, and when users will see the change. Send it through the usual channels ([[stakeholder-communication]]).
6. **Next round, report against it.** The core questions are what show whether the work landed.

The same loop works for measuring the effect of AI assistants on delivery, where perception and system data disagree often; see [[measuring-ai-impact-on-delivery]].

## Common mistakes

- **Surveying without a plan to act.** Each unanswered survey lowers the next response rate.
- **Changing the questions every round.** Nothing can be compared. Keep a stable core.
- **Reporting averages only.** A 3.0 average can be everyone neutral or half furious; show the distribution.
- **Breaking down by small groups.** People recognise each other; honesty drops next round.
- **Treating scores as targets for teams.** Teams will answer to hit the target. The survey measures the platform, not its users.
- **Ignoring the free text** because it is hard to count. It is where the problems you did not think to ask about appear.
- **Survey instead of conversation.** The survey points to the problem; the platform team still needs to sit with users ([[platform-team-operating-model]]).

## Sources

- [The SPACE of Developer Productivity, ACM Queue, 2021](https://queue.acm.org/detail.cfm?id=3454124) and its [Microsoft Research publication page](https://www.microsoft.com/en-us/research/publication/the-space-of-developer-productivity-theres-more-to-it-than-you-think/): authors, venue, and that productivity cannot be measured by a single metric.
- [The DevEx framework paper, ACM Queue, 2023](https://queue.acm.org/detail.cfm?id=3595878): feedback loops, cognitive load and flow state. Not read for this note; check the paper.
- [DORA research](https://dora.dev/): capabilities and the survey behind the DORA metrics. Check the current research.

## Related

- [[platform-team-operating-model]]: the platform as a product with users.
- [[platform-product-discovery]]: interviews and discovery after the survey.
- [[dora-metrics]]: the delivery metrics to pair with perception.
- [[measuring-ai-impact-on-delivery]]: the same perception and data pairing for AI tools.
- [[platform-roadmap-multi-quarter]]: where survey findings become roadmap items.
- [[internal-developer-platform-architecture]] and [[golden-path-templates-architecture]]: the journeys the question bank follows.
- [[stakeholder-communication]]: publishing "you said, we did".
