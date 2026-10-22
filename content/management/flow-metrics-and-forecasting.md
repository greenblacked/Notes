---
title: Flow metrics and forecasting for platform work
description: Use WIP, cycle time, throughput and work item age from GitLab issues, and a Monte Carlo forecast, to answer "when will it be done" with honest ranges.
type: guide
tags:
  - management
  - delivery
  - team-process
  - gitlab-ci
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Platform teams are bad at estimates for a structural reason: a large share of their week is unplanned. Incidents, access requests, broken pipelines and "quick questions" arrive at random, so a story-point plan made on Monday is wrong by Wednesday. Flow metrics replace the guess with a measurement of how work actually moves through the team, and a Monte Carlo forecast turns that history into a date range with a stated probability. This note covers the four flow metrics, how to define them on a GitLab board, a standard-library exporter and report, a forecast script, and how to talk about the result without promising a single date.

> [!info] Scope and what is not verified
> The metric definitions follow the Kanban Guide (2025 edition, as summarised from kanbanguides.org); check the current wording. Not checked against current docs: the exact response fields of the resource label events API for issues, the permissions a token needs for it, GitLab rate limits, whether the `PRIVATE-TOKEN` header is still the preferred way to pass a token, and which tier gives you Value Stream Analytics in your edition. Classes of service and Monte Carlo forecasting are practitioner techniques, not part of the Kanban Guide. The scripts were run against sample data and a local mock of the API, not against a real GitLab instance.

## The four flow metrics

The Kanban Guide names four measures. Teams may rename them (Flow Time instead of Cycle Time, Delivery Rate instead of Throughput); what matters is that everyone uses the same definition.

| Metric        | Definition (Kanban Guide wording, paraphrased)                  | Question it answers                      |
| ------------- | --------------------------------------------------------------- | ---------------------------------------- |
| WIP           | Number of work items started but not finished                   | How much are we juggling right now?      |
| Cycle time    | Elapsed time between a work item starting and finishing         | How long does one item usually take?     |
| Work item age | Elapsed time between a work item starting and now               | Which in-progress item is getting stuck? |
| Throughput    | Number of work items finished per unit of time, counted exactly | How many items do we finish per week?    |

The guide also describes a **service level expectation** (SLE): a forecast of how long one item should take from start to finish, with a time window and a probability, for example "85% of items finish in eight days or less". It is based on historical cycle time and shown on the board.

These metrics are connected. If WIP goes up while throughput stays flat, cycle time goes up: every item waits longer for attention. That is why limiting WIP is the main lever, not working harder.

> [!note] Three different "lead times"
> Do not mix these up in a report. **Flow cycle time** (this note) runs from the moment the team starts an item to the moment it is finished. **DORA change lead time** runs from commit to running in production, see [[dora-metrics]]. **GitLab Value Stream Analytics** has its own definitions: its lead time is the time from issue created to issue closed, and its cycle time starts at the first merge request commit that references the issue. Name which one you mean every time.

## Define start and finish on the board

Before collecting a single number, write down where the clock starts and stops. Without that, two people measure the same issue and get different cycle times.

- **Start:** the item is pulled into active work. On a GitLab issue board, that is the moment a label such as `doing` is added. Creation time is not the start: an issue can sit in the backlog for months, which says something about prioritisation, not about flow.
- **Finish:** the item delivers its value. For most platform work that is "closed", but only if your definition of done includes the change being live (merged, rolled out, documented). If issues are closed at merge and rolled out a week later, measure to the rollout.
- **One unit of work.** Count issues, not tasks, epics or merge requests. Keep items roughly right-sized: if something is obviously months of work, split it before it starts. Throughput counts items, so it needs items of a broadly similar order of size, not identical size.
- **Write it in the team charter**, see [[team-charter]], so new joiners and the shield engineer apply it the same way.

Scoped labels (`workflow::doing`) are convenient because an issue can carry only one label of a scope at a time, so the board cannot show an item in two columns. Check the labels documentation for your tier before relying on them; plain labels work with the scripts below.

## Classes of service and WIP limits

A class of service is a policy for how a type of work is treated. The four commonly used classes are usually traced to David J. Anderson's Kanban work; other practitioners use different sets, so treat the names as a convention, not a standard.

| Class      | Platform example                                         | Policy (example, set your own)                                    | WIP limit (example) |
| ---------- | -------------------------------------------------------- | ----------------------------------------------------------------- | ------------------- |
| Expedite   | Production incident follow-up, critical CVE              | Pulled immediately, may exceed other limits, reviewed afterwards  | 1                   |
| Fixed date | Certificate expiry, provider end-of-life, audit deadline | Started early enough that the p85 cycle time ends before the date | 2                   |
| Standard   | Roadmap work, module features, migrations                | First in, first out within priority                               | 4 for a team of 6   |
| Intangible | Tech debt, upgrades with no current pain, tooling        | Always one in progress, so it never stops completely              | 1                   |

The limits above are illustrations for a team of six engineers, not recommendations. Start with the WIP you have today minus one or two, watch cycle time for a month and adjust. The Open Guide to Kanban puts it plainly: do not pull more work than the WIP limit allows. A limit that is always exceeded is not a limit; it is a decoration.

Fixed-date items deserve special attention because they are where flow data pays off directly: if the p85 cycle time for standard work is twelve days, an item due on the 30th must start by about the 18th. Track these dates in [[end-of-life-tracking-platform-versions]] and [[planning-and-prioritization]].

Expedite is the class to watch. If more than a small share of finished items are expedite, the team is not doing planned work; it is running an incident queue. That is a signal for [[toil-budget]] and reliability work, not for more process.

## Pull the data from GitLab

GitLab issues carry `created_at` and `closed_at`. The start time is not a field: it is the moment the start label was added, which the [resource label events API](https://docs.gitlab.com/api/resource_label_events/) records as a separate event per label change. Label changes are not system notes, so the Notes API does not show them.

The exporter below writes two CSV files: `finished.csv` (items closed since a date, with start and finish) and `in_progress.csv` (open items that have started, with their age). It needs one token with read-only API access, taken from the environment.

```python title="export_flow.py"
#!/usr/bin/env python3
"""Export start and finish times of GitLab issues for flow metrics. Read-only, standard library only.

Start = the first time one of START_LABELS was added (from resource label events).
Finish = the issue's closed_at. Writes finished.csv and in_progress.csv to OUT_DIR.
"""
import csv
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

GITLAB_URL = os.environ.get("GITLAB_URL", "https://gitlab.example.com")
PROJECT = os.environ.get("PROJECT", "platform/backlog")  # numeric ID or full path
START_LABELS = set(os.environ.get("START_LABELS", "doing").split(","))
CLASS_LABELS = {  # label on the issue -> class of service; anything else is "standard"
    "cos-expedite": "expedite",
    "cos-fixed-date": "fixed-date",
    "cos-intangible": "intangible",
}
SINCE = os.environ.get("SINCE", "2026-04-01")  # keep items finished on or after this day (UTC)
OUT_DIR = os.environ.get("OUT_DIR", "flow-data")
TOKEN = os.environ.get("GITLAB_TOKEN")  # read-only token (read_api); never hard-code it
PER_PAGE = 100


def parse_ts(value):
    # GitLab returns UTC timestamps ending in "Z"; older Pythons need +00:00 instead
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def get_all(path, params=None):
    """Yield every item of a paginated GET, following X-Next-Page."""
    page = "1"
    while page:
        query = urllib.parse.urlencode({**(params or {}), "per_page": PER_PAGE, "page": page})
        req = urllib.request.Request(
            f"{GITLAB_URL}/api/v4{path}?{query}", headers={"PRIVATE-TOKEN": TOKEN}
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            items = json.load(resp)
            next_page = resp.headers.get("X-Next-Page")
        if next_page is None:  # header missing: fall back to "a full page means there is more"
            next_page = str(int(page) + 1) if len(items) == PER_PAGE else ""
        page = next_page
        yield from items


def started_at(project, iid):
    adds = [
        parse_ts(event["created_at"])
        for event in get_all(f"/projects/{project}/issues/{iid}/resource_label_events")
        if event.get("action") == "add"
        and (event.get("label") or {}).get("name") in START_LABELS  # label is null if deleted
    ]
    return min(adds) if adds else None


def class_of(issue):
    return next((CLASS_LABELS[l] for l in issue.get("labels", []) if l in CLASS_LABELS), "standard")


def main():
    if not TOKEN:
        sys.exit("export GITLAB_TOKEN (a read-only token) first")
    project = urllib.parse.quote(PROJECT, safe="")
    since = datetime.fromisoformat(SINCE).replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    os.makedirs(OUT_DIR, exist_ok=True)
    finished, in_progress, never_started = [], [], 0

    for issue in get_all(f"/projects/{project}/issues", {"state": "closed"}):
        closed = parse_ts(issue.get("closed_at"))
        if not closed or closed < since:
            continue
        start = started_at(project, issue["iid"])
        if start is None:
            never_started += 1  # closed without passing the start column: throughput only
        cycle = round((closed - start).total_seconds() / 86400, 2) if start else ""
        finished.append([issue["iid"], class_of(issue), start.isoformat() if start else "",
                         closed.isoformat(), cycle])

    for issue in get_all(f"/projects/{project}/issues", {"state": "opened"}):
        start = started_at(project, issue["iid"])
        if start:
            age = round((now - start).total_seconds() / 86400, 2)
            in_progress.append([issue["iid"], class_of(issue), start.isoformat(), age])

    for name, header, rows in (
        ("finished.csv", ["iid", "class", "started", "finished", "cycle_days"], finished),
        ("in_progress.csv", ["iid", "class", "started", "age_days"], in_progress),
    ):
        with open(os.path.join(OUT_DIR, name), "w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(header)
            writer.writerows(rows)
    print(f"finished: {len(finished)} ({never_started} without a start label), "
          f"in progress: {len(in_progress)}, written to {OUT_DIR}/")


if __name__ == "__main__":
    main()
```

Run it with a read-only token from your secret store, never on the command line where it lands in shell history:

```bash title="run-export.sh"
#!/usr/bin/env bash
set -euo pipefail

export GITLAB_URL="https://gitlab.example.com"
export PROJECT="platform/backlog"
export START_LABELS="doing"
export SINCE="2026-04-01"
export OUT_DIR="flow-data"
: "${GITLAB_TOKEN:?export GITLAB_TOKEN from your secret store first}"

python3 export_flow.py
wc -l "${OUT_DIR}/finished.csv" "${OUT_DIR}/in_progress.csv"
```

Points to check before you trust the output:

- **Pagination.** The script follows the `X-Next-Page` header and falls back to "a full page means there is more". The REST docs describe `per_page` with a maximum of 100 for most endpoints and a depth limit on offset pagination for large collections; check the limits for these endpoints in your version.
- **Request count.** It makes one call per issue for label events. On a large project, narrow the issue query with the filters the [issues API](https://docs.gitlab.com/api/issues/) offers (labels, dates) and check your instance's rate limits.
- **Event shape.** The script reads `action` and `label.name` and ignores anything it does not recognise. A deleted label shows up as an event without a usable label; it is skipped.
- **Timestamps.** GitLab returns UTC timestamps ending in `Z`. The script replaces `Z` with `+00:00` because older Python versions do not parse `Z` in `datetime.fromisoformat` (not verified for which version changed this; the replacement is safe either way).
- **Items without a start.** Issues closed without ever getting the start label count for throughput but not for cycle time. The script prints how many there were. If it is a large share, the board is not being used and the numbers are fiction.

> [!tip] Value Stream Analytics
> GitLab's built-in Value Stream Analytics shows lead and cycle time without a script. Its definitions differ from the flow definitions above, and its availability depends on tier and on project versus group level (check the [docs](https://docs.gitlab.com/user/group/value_stream_analytics/) for your edition). The exporter is for teams that want the Kanban definitions, data for a forecast, or numbers they can reproduce.

## Read cycle time and aging work

The report script prints three things: weekly throughput, cycle-time percentiles per class of service, and in-progress items that are already older than the 85th percentile cycle time of their class.

```python title="flow_report.py"
#!/usr/bin/env python3
"""Weekly throughput, cycle-time percentiles per class and aging work. Standard library only."""
import csv
import sys
from collections import Counter, defaultdict
from datetime import date

DATA_DIR = sys.argv[1] if len(sys.argv) > 1 else "flow-data"
SLE_PCT = 85  # the percentile you publish as your service level expectation


def nearest_rank(sorted_values, pct):
    index = max(0, -(-len(sorted_values) * pct // 100) - 1)
    return sorted_values[int(index)]


def read(name):
    with open(f"{DATA_DIR}/{name}", newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


finished = read("finished.csv")
in_progress = read("in_progress.csv")

print("Throughput per ISO week (finished items):")
weeks = Counter(date.fromisoformat(r["finished"][:10]).isocalendar()[:2] for r in finished)
for (year, week), count in sorted(weeks.items())[-12:]:
    print(f"  {year}-W{week:02d}  {count:3d}  {'#' * count}")
print("  (weeks with nothing finished are missing here; count them as zero)")

cycle = defaultdict(list)
for r in finished:
    if r["cycle_days"]:
        cycle[r["class"]].append(float(r["cycle_days"]))
        cycle["all"].append(float(r["cycle_days"]))

print("\nCycle time in days (nearest-rank percentiles):")
sle = {}
for cls, values in sorted(cycle.items()):
    values.sort()
    p50, p85, p95 = (nearest_rank(values, p) for p in (50, 85, 95))
    sle[cls] = nearest_rank(values, SLE_PCT)
    print(f"  {cls:<11} n={len(values):<4} p50={p50:<6} p85={p85:<6} p95={p95}")
    if len(values) < 20:
        print(f"  {'':<11} few data points: treat these numbers as rough")

print(f"\nIn-progress items older than the p{SLE_PCT} cycle time of their class:")
flagged = 0
for r in sorted(in_progress, key=lambda r: -float(r["age_days"])):
    limit = sle.get(r["class"], sle.get("all"))
    if limit is not None and float(r["age_days"]) > limit:
        flagged += 1
        print(f"  #{r['iid']:<6} {r['class']:<11} age {r['age_days']} d > {limit} d")
print(f"  {flagged} item(s) flagged" if flagged else "  none")
```

Sample output against the sample data in the next section (illustrative excerpt: the throughput section and the smaller classes are omitted):

```text
Cycle time in days (nearest-rank percentiles):
  all         n=13   p50=6.34   p85=12.24  p95=21.21
              few data points: treat these numbers as rough
  standard    n=8    p50=4.17   p85=11.06  p95=12.24
              few data points: treat these numbers as rough

In-progress items older than the p85 cycle time of their class:
  #444    standard    age 19.1 d > 11.06 d
  #447    expedite    age 1.2 d > 0.35 d
  2 item(s) flagged
```

How to read it:

- **Percentiles, not averages.** Cycle times are skewed: most items finish quickly and a few take weeks. The mean is pulled up by the tail and describes no real item. Quote p50 for "typical" and p85 or p95 for "safe".
- **The SLE comes from the data.** "85% of standard items finish within 11 days" is a statement the team can defend because it describes what already happened. Many teams quote the 85th percentile; choose the percentile by the cost of being late, not by habit.
- **Aging work is the daily signal.** Cycle time tells you about items after they are done, when it is too late to help them. Work item age tells you about items now. An item older than the SLE needs a conversation at stand-up: is it blocked, too big, or waiting on another team (see [[cross-team-dependencies]])?
- **Scatter plot.** If you chart it, plot each finished item as a dot (finish date on the x axis, cycle time on the y axis) with horizontal lines at p50 and p85. Clusters of dots high above the p85 line usually share a cause: one dependency, one kind of work, one person on holiday.
- **Small samples.** With fewer than about 20 finished items per class the percentiles move a lot from week to week. Report them, but say so.

## Forecast with Monte Carlo

A Monte Carlo forecast replaces "how many points fit in the sprint" with "given how many items we actually finished per day recently, what range of outcomes is likely". It answers two questions:

- **When:** how long until N more items are done?
- **How many:** how many items will be done by a given date?

The method: take the number of items finished on each day of a recent window (zeros included), then simulate the future many times by drawing a random past day for each future day. Each run gives one possible outcome; thousands of runs give a distribution. Vendor tools that implement this describe running thousands to a million simulations and reporting a date or count at a probability; ten thousand runs are plenty for a team backlog.

Sample input (the same format as the exporter's `finished.csv`; only the `finished` column is used by the forecast):

```text title="flow-data/finished.csv"
iid,class,started,finished,cycle_days
412,standard,2026-09-01T08:10:00+00:00,2026-09-03T15:00:00+00:00,2.28
415,expedite,2026-09-02T09:00:00+00:00,2026-09-02T17:30:00+00:00,0.35
409,standard,2026-08-28T10:00:00+00:00,2026-09-08T11:20:00+00:00,11.06
420,fixed-date,2026-09-04T07:45:00+00:00,2026-09-10T16:00:00+00:00,6.34
418,standard,2026-09-07T12:00:00+00:00,2026-09-15T09:30:00+00:00,7.9
423,intangible,2026-09-01T09:00:00+00:00,2026-09-22T14:00:00+00:00,21.21
427,standard,2026-09-16T08:00:00+00:00,2026-09-18T10:00:00+00:00,2.08
430,standard,2026-09-21T13:00:00+00:00,2026-09-25T16:40:00+00:00,4.15
431,expedite,2026-09-29T06:50:00+00:00,2026-09-29T11:05:00+00:00,0.18
433,standard,2026-09-24T09:15:00+00:00,2026-10-06T15:00:00+00:00,12.24
436,standard,2026-10-01T10:00:00+00:00,2026-10-08T12:00:00+00:00,7.08
438,fixed-date,2026-10-05T08:30:00+00:00,2026-10-14T17:00:00+00:00,9.35
441,standard,2026-10-12T09:00:00+00:00,2026-10-16T13:00:00+00:00,4.17
```

```python title="forecast.py"
#!/usr/bin/env python3
"""Monte Carlo forecast from past daily throughput. Standard library only.

  when:     how long until N more items are finished?
  how-many: how many items will be finished by a date?
"""
import argparse
import csv
import random
import sys
from collections import Counter
from datetime import date, timedelta


def nearest_rank(sorted_values, pct):
    """Nearest-rank percentile of an already sorted list (pct between 0 and 100)."""
    index = max(0, -(-len(sorted_values) * pct // 100) - 1)  # ceil(n * pct / 100) - 1
    return sorted_values[int(index)]


def daily_samples(path, start, history_days, workdays):
    """Finished-per-day counts for every day of the history window, zeros included."""
    finished = Counter()
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row.get("finished"):
                finished[date.fromisoformat(row["finished"][:10])] += 1
    samples = []
    for offset in range(history_days, 0, -1):
        day = start - timedelta(days=offset)
        if workdays and day.weekday() >= 5:
            continue
        samples.append(finished.get(day, 0))
    return samples


def is_working(day, workdays):
    return not (workdays and day.weekday() >= 5)


def simulate_when(samples, items, start, trials, workdays, rng):
    results = []
    for _ in range(trials):
        done, day, last = 0, start, start
        while done < items:
            if is_working(day, workdays):
                done += rng.choice(samples)
                last = day
            day += timedelta(days=1)
            if (day - start).days > 3650:
                sys.exit("forecast runs past ten years: check the history window")
        results.append(last)
    return sorted(results)


def simulate_how_many(samples, start, until, trials, workdays, rng):
    days = [start + timedelta(days=i) for i in range((until - start).days + 1)]
    working = [d for d in days if is_working(d, workdays)]
    return sorted(sum(rng.choice(samples) for _ in working) for _ in range(trials))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("mode", choices=["when", "how-many"])
    p.add_argument("--data", default="flow-data/finished.csv")
    p.add_argument("--start", type=date.fromisoformat, default=date.today())
    p.add_argument("--history-days", type=int, default=90)
    p.add_argument("--items", type=int, help="items left (mode when)")
    p.add_argument("--until", type=date.fromisoformat, help="last day counted (mode how-many)")
    p.add_argument("--trials", type=int, default=10000)
    p.add_argument("--workdays", action="store_true", help="ignore Saturdays and Sundays")
    p.add_argument("--seed", type=int, help="fix the random seed for a repeatable run")
    args = p.parse_args()

    samples = daily_samples(args.data, args.start, args.history_days, args.workdays)
    if not samples or sum(samples) == 0:
        sys.exit("no finished items in the history window: nothing to forecast from")
    rng = random.Random(args.seed)
    print(f"history: {len(samples)} days, {sum(samples)} items finished, trials: {args.trials}")

    if args.mode == "when":
        if not args.items or args.items < 1:
            sys.exit("--items is required and must be at least 1")
        dates = simulate_when(samples, args.items, args.start, args.trials, args.workdays, rng)
        for pct in (50, 85, 95):
            print(f"{pct}% chance to finish {args.items} items on or before {nearest_rank(dates, pct)}")
    else:
        if not args.until or args.until < args.start:
            sys.exit("--until is required and must not be before --start")
        counts = simulate_how_many(samples, args.start, args.until, args.trials, args.workdays, rng)
        for pct in (50, 85, 95):
            # "at least X with 85% chance" is the 15th percentile of the outcomes
            print(f"{pct}% chance to finish at least {nearest_rank(counts, 100 - pct)} items by {args.until}")


if __name__ == "__main__":
    main()
```

Run both questions:

```bash title="run-forecast.sh"
#!/usr/bin/env bash
set -euo pipefail

DATA="flow-data/finished.csv"
START="2026-10-21"
HISTORY_DAYS=60
ITEMS_LEFT=10
UNTIL="2026-12-18"

python3 forecast.py when --data "$DATA" --start "$START" \
  --history-days "$HISTORY_DAYS" --items "$ITEMS_LEFT" --workdays --seed 7
python3 forecast.py how-many --data "$DATA" --start "$START" \
  --history-days "$HISTORY_DAYS" --until "$UNTIL" --workdays --seed 7
```

Output with the sample data (illustrative; your numbers depend on your history):

```text
history: 42 days, 13 items finished, trials: 10000
50% chance to finish 10 items on or before 2026-12-02
85% chance to finish 10 items on or before 2026-12-16
95% chance to finish 10 items on or before 2026-12-25
history: 42 days, 13 items finished, trials: 10000
50% chance to finish at least 13 items by 2026-12-18
85% chance to finish at least 10 items by 2026-12-18
95% chance to finish at least 9 items by 2026-12-18
```

Notes on the choices in the script:

- **The direction of "how many".** "85% chance of at least X" is the 15th percentile of simulated counts, not the 85th. Getting this backwards turns a safe commitment into an optimistic one.
- **History window.** Use a window that reflects how the team works now: after a reorg, a new joiner or a big change in interrupt load, older data describes a different team. Sixty to ninety days is a common starting point; it is a choice, not a rule.
- **Weekends and holidays.** `--workdays` drops Saturdays and Sundays from both history and simulation. Public holidays and planned leave are not modelled; widen the range or remove those days from the window by hand.
- **Item count is an assumption.** "Ten items left" is itself an estimate. Backlogs grow as work is discovered. Add a split-rate allowance (for example "items tend to become 1.3 items" from your own history) or forecast a range of item counts.
- **Unstable systems.** No forecast technique works when the process is out of control: WIP unlimited, items of wildly different size, the board not kept current. Fix that first.

## Communicate forecasts as ranges

A forecast is only useful if stakeholders read it correctly. See [[stakeholder-communication]] for the general rules; for forecasts:

- **Give the probability with the date.** "85% likely by 16 December, 50% by 2 December" is honest. "2 December" alone is a promise you have not made.
- **Choose the percentile with the stakeholder.** For an audit deadline use p95. For an internal milestone p85 is usually enough.
- **Re-forecast on a schedule.** Every week, with the latest data, and show how the range moved. The Open Guide to Kanban states the obvious but often forgotten point that past performance does not guarantee future results. A forecast is a weather report, not a contract.
- **Say what would change it.** "This assumes interrupt load stays at the level of the last two months. A major incident or a security campaign moves it out."
- **Put it in the review.** The [[quarterly-engineering-review]] and [[platform-roadmap-multi-quarter]] should show forecasts as ranges next to the plan, and the miss or hit of last quarter's forecasts.

## Interrupt load and the shield rotation

Interrupts are the main reason platform forecasts fail. Make them visible instead of pretending they do not exist:

- **Label interrupt work** (`interrupt`, or the expedite class) and keep it on the same board. Then throughput includes it and the forecast reflects real capacity.
- **Track the interrupt share** per week: finished interrupt items over all finished items. A rising share is an early warning for planned work.
- **Use a shield rotation** so one engineer absorbs interrupts and the rest keep flow, see [[platform-team-operating-model]]. Forecast planned work from the throughput of the non-shield engineers, or from planned items only.
- **Separate the shield from the pager**, see [[on-call-health]]. If the paged engineer also takes support requests, both suffer.
- **Feed the cause back.** Repeated interrupts of the same kind are toil, see [[toil-budget]] and [[tech-debt-management]].

## Gaming and how to avoid it

Any metric that becomes a target gets gamed. The common forms:

- **Splitting for throughput.** Items get sliced thin to raise the count. The fix: never compare throughput across teams, and never set a throughput target. Use it only to forecast the same team's work.
- **Closing early.** Issues closed at merge, with rollout tracked nowhere. The fix: the definition of finish in the charter, checked in review.
- **Late start.** The start label is added just before closing, which makes cycle time look tiny. Watch for a sudden drop in cycle time with no change in throughput.
- **Hiding work.** Interrupts done off the board. Throughput falls while people are busy; ask in [[one-on-ones]].
- **Performance use.** Using flow metrics in individual reviews kills them. They describe the system, not the person, see [[performance-feedback]].

## Common mistakes

- **Starting the clock at creation.** That measures backlog age, not flow. Use the start label.
- **Reporting the mean.** Use percentiles; the distribution is skewed.
- **Ignoring zero days.** A forecast built only from days when something finished is optimistic. The script counts empty days.
- **One forecast, never updated.** Re-run it weekly and show the movement.
- **Unlimited WIP.** Without a limit, cycle time grows and the data says only "everything is slow".
- **Mixing definitions.** Flow cycle time, DORA lead time and GitLab VSA lead time are different measures. Label every chart.
- **Comparing teams.** Teams size items differently. Compare a team with its own past.

## Sources

- [The Kanban Guide](https://kanbanguides.org/english/): flow metric definitions, SLE, defining the workflow's start and finish. Check the current edition.
- [Open Guide to Kanban (2025.7)](https://kanbanguides.org/open-guide-to-kanban/2025.7/): WIP limits, aging, reprioritising in-progress work, past performance.
- [GitLab Issues API](https://docs.gitlab.com/api/issues/): `created_at`, `closed_at`, list filters.
- [GitLab resource label events API](https://docs.gitlab.com/api/resource_label_events/): label add and remove events per issue; check the fields and permissions for your version.
- [GitLab REST API](https://docs.gitlab.com/api/rest/): pagination headers and limits.
- [GitLab Value Stream Analytics](https://docs.gitlab.com/user/group/value_stream_analytics/): built-in lead and cycle time, tier and definitions.
- [ActionableAgile: Monte Carlo How Many](https://55degrees.atlassian.net/wiki/spaces/ActionableAgile/pages/2407399482/Monte+Carlo+How+Many): one vendor's description of the "when" and "how many" forecasts; vendor documentation, not a standard.

## Related

- [[planning-and-prioritization]]: where the forecast feeds the plan.
- [[platform-team-operating-model]]: intake, triage and the shield rotation.
- [[dora-metrics]]: delivery performance metrics, with different definitions.
- [[stakeholder-communication]]: reporting ranges and risks.
- [[quarterly-engineering-review]] and [[platform-roadmap-multi-quarter]]: where forecasts are reviewed.
- [[toil-budget]]: what to do about interrupt load.
- [[on-call-health]]: keeping the pager separate from the shield.
