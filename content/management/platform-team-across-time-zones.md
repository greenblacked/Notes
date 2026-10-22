---
title: Running a platform team across time zones
description: Overlap maths that handles daylight saving, async decisions, written handoffs of in-flight changes, fair meeting slots and on-call for distributed teams.
type: guide
tags:
  - management
  - leadership
  - team-process
  - on-call
created: 2026-10-21
modified: 2026-10-21
draft: false
---

A platform team spread over several time zones can cover more of the day than a co-located one, but by default it gets the worst of both: changes wait a full day for a review from the other side of the world, production work stalls when the one person who knows it goes to sleep, and the same region always takes the 07:00 or 21:00 meeting. None of that is fixed by more meetings. It is fixed by knowing exactly how much overlap you have, making written work the default, handing over in-flight operational work explicitly, and sharing the inconvenient hours fairly. This note covers the daily mechanics; the on-call side is in [[on-call-health]].

> [!warning] Not legal advice
> Working-time, rest and on-call rules differ by country, by contract and sometimes by collective agreement. Anything this note says about rest periods or on-call time is an example to discuss with HR or legal, never a statement of what is allowed where your people work.

## Map the team

Start with facts, not impressions. For each person record the time zone by its IANA name (`Europe/Berlin`, not "CET"), their normal working hours in local time, and any fixed constraints (school run, a regular late start). Abbreviations such as CET or EST are ambiguous and ignore daylight saving; IANA names do not.

| Role       | Time zone (IANA)   | Local hours | Notes                           |
| ---------- | ------------------ | ----------- | ------------------------------- |
| lead       | `Europe/Berlin`    | 09:00-17:30 |                                 |
| sre-1      | `Europe/London`    | 09:00-17:30 |                                 |
| sre-2      | `America/New_York` | 08:30-17:00 | Prefers no meetings after 16:00 |
| platform-1 | `Asia/Singapore`   | 09:00-17:30 | No daylight saving in this zone |

Use roles or names inside the team; do not publish this table outside it, because working hours and locations are personal data.

### Calculate the overlap, including daylight saving

Overlap is not a constant. Zones that observe daylight saving switch on different dates (Europe and North America do not change on the same weekend), and some zones do not switch at all, so the shared window moves and shrinks for a few weeks each year. Compute it per day for real dates instead of once from the offsets.

The script below uses `zoneinfo` from the Python standard library (Python 3.9 and later). It needs time zone data: on most Linux and macOS systems it comes from the operating system; on Windows, and on minimal container images without system tz data, install the `tzdata` package. The script tells you when the data is missing.

```python title="tz_overlap.py"
#!/usr/bin/env python3
"""Shared working hours of a distributed team, per day, in UTC and local time. Standard library only.

For each working day of a date range it prints the window in which everyone is inside their
working hours, and the shared minutes of every pair whenever they change, so that a
daylight-saving switch in one zone shows up as a moved or shrunk window.
"""
import sys
from datetime import date, datetime, time, timedelta, timezone

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:
    sys.exit("zoneinfo needs Python 3.9 or later")

# role, IANA time zone, local start and end of the working day (example values, use your own)
TEAM = [
    ("lead",       "Europe/Berlin",    time(9, 0),  time(17, 30)),
    ("sre-1",      "Europe/London",    time(9, 0),  time(17, 30)),
    ("sre-2",      "America/New_York", time(8, 30), time(17, 0)),
    ("platform-1", "Asia/Singapore",   time(9, 0),  time(17, 30)),
]
FIRST_DAY = date(2026, 3, 2)
DAYS = 42  # six weeks, wide enough to cover a spring daylight-saving change
SKIP_WEEKENDS = True


def window_utc(day, tz, start, end):
    """The person's working window on their local `day`, converted to UTC."""
    begin = datetime.combine(day, start, tzinfo=tz).astimezone(timezone.utc)
    finish = datetime.combine(day, end, tzinfo=tz).astimezone(timezone.utc)
    return begin, finish


def overlap_minutes(a, b):
    begin, finish = max(a[0], b[0]), min(a[1], b[1])
    return max(0, int((finish - begin).total_seconds() // 60))


def main(members):
    try:
        zones = [(role, ZoneInfo(name), s, e) for role, name, s, e in members]
    except ZoneInfoNotFoundError as err:
        sys.exit(f"time zone data not found ({err}): install the tzdata package")

    previous, previous_pairs = None, None
    for offset in range(DAYS):
        day = FIRST_DAY + timedelta(days=offset)
        if SKIP_WEEKENDS and day.weekday() >= 5:
            continue
        windows = [window_utc(day, tz, s, e) for _, tz, s, e in zones]
        begin = max(w[0] for w in windows)
        finish = min(w[1] for w in windows)
        if finish <= begin:
            text = "no shared hours"
        else:
            minutes = int((finish - begin).total_seconds() // 60)
            local = ", ".join(
                f"{role} {begin.astimezone(tz):%H:%M}-{finish.astimezone(tz):%H:%M}"
                for role, tz, _, _ in zones
            )
            text = f"{begin:%H:%M}-{finish:%H:%M} UTC ({minutes} min): {local}"
        marker = "" if text == previous else "  <- changed"
        print(f"{day:%a %Y-%m-%d}  team: {text}{marker}")
        previous = text
        pairs = [
            (zones[i][0], zones[j][0], overlap_minutes(windows[i], windows[j]))
            for i in range(len(zones)) for j in range(i + 1, len(zones))
        ]
        if pairs != previous_pairs:
            for a, b, minutes in pairs:
                print(f"{'':16}  {a} + {b}: {minutes} min")
            previous_pairs = pairs


if __name__ == "__main__":
    main(TEAM)
```

Output for the example team, from 2 March to 10 April 2026 (trimmed; the full run prints every working day):

```text
Mon 2026-03-02  team: no shared hours  <- changed
                  lead + sre-1: 450 min
                  lead + sre-2: 180 min
                  lead + platform-1: 90 min
                  sre-1 + sre-2: 240 min
                  sre-1 + platform-1: 30 min
                  sre-2 + platform-1: 0 min
Mon 2026-03-09  team: no shared hours
                  lead + sre-1: 450 min
                  lead + sre-2: 240 min
                  lead + platform-1: 90 min
                  sre-1 + sre-2: 300 min
                  sre-1 + platform-1: 30 min
                  sre-2 + platform-1: 0 min
Mon 2026-03-30  team: no shared hours
                  lead + sre-1: 450 min
                  lead + sre-2: 180 min
                  lead + platform-1: 150 min
                  sre-1 + sre-2: 240 min
                  sre-1 + platform-1: 90 min
                  sre-2 + platform-1: 0 min
```

What it shows:

- **There is no moment when all four are working.** That is normal for a team spanning Asia, Europe and North America, and it is the most important fact for the team's design: no daily all-hands stand-up can be fair, and no decision can wait for "when everyone is around".
- **New York and Singapore never overlap.** Any work passed between them goes through Europe or through writing.
- **The windows move.** For about three weeks in March the Europe-New York overlap is an hour longer, and from the end of March the Europe-Singapore overlap grows. A meeting booked in one zone's local time drifts in the others. Re-run the script for the weeks around each daylight-saving change and warn the team in advance.

## The core overlap window

Pick a short window, in UTC, when each pair of regions that hands work to each other is reliably online, and protect it:

- **Use it for what needs synchronous time:** unblocking reviews, live incident coordination, a pairing session, the occasional design discussion. Not for status updates.
- **Keep it short.** One to two hours of protected overlap per region pair is usually enough. Protect the rest of the day for focus work.
- **Publish it in UTC and in each local time,** and update the local times when daylight saving changes.
- **Write it in the [[team-charter]]** under working agreements, together with the expected response time for messages outside the window (for example "by the start of your next working day").

## Async by default

The GitLab handbook, from a fully remote company, states asynchronous communication as a principle: write things down, prefer merge requests and issues to chat, and check whether a meeting is needed at all. Its reasoning applies to any distributed platform team: an async thread can always be promoted to a call, while a decision made in a call is hard to make visible afterwards.

Practices that make async work:

- **Decisions in writing, with a deadline for objections.** A proposal states the decision, the options considered, the decider and a date: "If there are no blocking objections by Thursday 12:00 UTC, we go ahead." That gives every region at least one full working day to respond. Larger changes follow the [[rfc-and-design-review-process]].
- **A decision log.** Small decisions that do not need an ADR go into one running log (date, decision, who decided, link to the discussion). People who were asleep can catch up in minutes.
- **Written status instead of a stand-up.** Each person posts a short update at the end of their day: done, next, blocked. The next region reads it at the start of theirs.
- **Reviews across the handoff.** Ask for a merge request review before you log off, from someone whose day is starting. Two time zones can then turn around a review in one calendar day instead of two.
- **Self-contained messages.** A message that needs three follow-up questions costs three half-days across time zones. Put the context, the link and the specific ask in the first message.
- **Record the meetings you do hold,** share the agenda in advance, and write the outcome into the issue or the decision log, so the people who could not attend are not second-class members.

## Daily written handoff for in-flight work

Operational work that spans a working day (a migration, an upgrade, a backfill, an incident follow-up) needs an explicit handoff when the person running it logs off. Without it, the next region either does nothing ("not mine, not sure of the state") or does the wrong thing.

```markdown title="handoff.md"
## Handoff: <from region> to <to region>, <date>, <time> UTC

**In-flight changes**

- <change or MR link>: state now (for example "3 of 8 node pools upgraded"),
  next safe step, what NOT to do, rollback command or runbook link.

**Waiting on you**

- <review, approval or decision>, needed by <time UTC>, why.

**Watch**

- <alert, dashboard or job> that may fire, and what to do if it does.

**Paused on purpose**

- <work> paused until <condition>; do not resume without <person or check>.

**Who to reach**

- Owner of each in-flight change, and the on-call for the next shift.
```

Post it in a fixed place (the team channel thread for the day, or the change issue itself), and make reading it the first thing the next region does. Re-use the structure of the on-call handover in [[on-call-health]] so people learn one format.

## Change safety across regions

A production change made at the end of one region's day, with nobody awake who knows it, is a common way to turn a small problem into a long incident. Rules that help:

- **A second person awake.** A risky production change starts only when a second engineer who can help is online for at least the expected duration plus the rollback time. If the only reviewer is about to log off, wait.
- **No starting a risky change in your last hours.** Agree a cut-off (for example "no high-risk change in the last two hours of your day", example value). Low-risk, automatically rolled-back changes can be exempt.
- **Hand over or roll back.** A change that is not finished by the end of the day is either handed over with the template above or rolled back. It is never left half-done without an owner.
- **Follow the checklist.** The [[production-change-checklist]] applies in every region, and change freezes and maintenance windows in [[change-freezes-and-maintenance-windows]] are defined in UTC with each region's local time shown.

## Rotate meeting slots fairly

Some meetings are worth holding live. When a slot is inconvenient for someone, spread the pain:

- **Rotate recurring meetings** between two or three slots so the same region does not always take the early or late one. Publish the rotation for the quarter.
- **Have a meeting budget.** Agree a cap on recurring meeting hours per person per week (a team choice, for example four hours), and count the hours outside someone's normal day separately. Meetings that cost someone their evening should be rare.
- **Default to the overlap window.** If a meeting can fit the core window for everyone who must attend, it goes there.
- **Who must attend.** Most meetings need fewer people than are invited. Required attendees only; everyone else reads the notes.
- **Never schedule across a known daylight-saving change without checking** the local times in the weeks around it.

This rotation practice is a team habit, not a published standard; adjust it to what your team considers fair, and ask in retrospectives.

## 1:1s and proximity bias

Managers tend to give more attention, information and opportunity to the people they share hours or an office with. In a distributed team this shows up as "the people in my time zone get the interesting projects" and is rarely intended.

- **Hold every 1:1 in the report's working hours,** even if it is the manager's early morning or evening. See [[one-on-ones]].
- **Write down how work is assigned** (in planning, in the open) so people outside the manager's time zone can see and volunteer.
- **Check the distribution** each quarter: who led projects, who presented at reviews, who was on-call during incidents. Uneven patterns are a prompt for a conversation, not proof of bias.
- **Spread knowledge on purpose.** Each critical system should have someone who knows it in more than one region, see [[bus-factor-and-knowledge-transfer]].

## Follow-the-sun or regional on-call

A distributed team can cover the day without night shifts by passing the pager between regions. Whether it should depends on numbers and on how well the regions share knowledge.

| Option                  | What it looks like                                        | Works when                                                         | Watch out for                                                           |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Follow-the-sun          | Each region holds the pager in its own daytime            | Each region has enough people to rotate, and runbooks are complete | Handover quality, knowledge gaps between regions, coordination overhead |
| Regional rota, 24 hours | One region holds the pager around the clock for a shift   | Small team, most expertise in one region                           | Night pages for that region, fatigue, compensation                      |
| Hybrid                  | Follow-the-sun for paging, one region owns follow-up work | Unequal regions                                                    | Follow-up work piling on the owning region                              |

Google's SRE book notes that night shifts harm health and that a multi-site, follow-the-sun rotation avoids them, at the cost of communication and coordination overhead. It gives six people per site as a reasonable minimum for a dual-site team, and the SRE Workbook gives five per site for a multi-site rotation with an extra engineer per site as a buffer (the Workbook figure is not verified here: check the current text). These are Google's figures at Google's scale; use them as a sense of proportion, not a rule, and decide from your own page load as [[on-call-health]] describes. Compensation and rest after night work are covered in [[on-call-compensation-and-recovery]].

> [!warning] Working-time rules
> For example, the EU Working Time Directive sets a minimum daily rest of 11 consecutive hours and a weekly rest period, and case law treats some forms of on-call time as working time. National law and contracts can be stricter, and other countries have their own rules. A rota that moves people across shifts, or a handoff that keeps someone online late, can break rest rules. Ask HR or legal before you design the rota.

## UTC everywhere it matters

- **Logs and metrics in UTC.** Every log line carries a UTC timestamp with an explicit offset (`2026-10-21T14:03:12Z`), as set out in [[structured-logging-conventions]]. Dashboards can display local time, but the stored value is UTC.
- **Incident timelines in UTC.** During an incident with responders in three regions, "at 10:00" is ambiguous. The incident channel and the timeline use UTC, as in [[incident-response]].
- **Deadlines in UTC with a local hint.** "Thursday 12:00 UTC (in European and US summer time: 13:00 London, 14:00 Berlin, 08:00 New York, 20:00 Singapore)" removes the guesswork. Recalculate the hints when daylight saving changes; the script above does it for you.
- **Scheduled jobs.** Cron schedules for CI pipelines and maintenance are written and documented in UTC, with the local effect noted for each region that is affected.

## Common mistakes

- **One daily stand-up at a time that suits one region.** Replace it with written status and a short overlap sync between pairs of regions.
- **Using offsets or abbreviations instead of IANA zones.** They break twice a year. Use `Europe/Berlin`, not "UTC+1".
- **Decisions in calls without a written outcome.** The people asleep cannot see them or object.
- **Leaving in-flight changes without a handoff.** Either hand over with the template or roll back.
- **Follow-the-sun with two people per region.** It looks like coverage and breaks on the first holiday.
- **Assuming the overlap is fixed.** Re-run the overlap check before each daylight-saving change.
- **Interesting work going to the manager's time zone.** Assign work in the open and check the distribution.

## Sources

- [Python `zoneinfo`](https://docs.python.org/3/library/zoneinfo.html): availability from Python 3.9, system tz data and the `tzdata` fallback, `ZoneInfoNotFoundError`.
- [GitLab handbook, communication](https://handbook.gitlab.com/handbook/communication/): asynchronous communication as a principle, merge requests and issues before chat.
- [GitLab handbook, all-remote guide](https://handbook.gitlab.com/handbook/company/culture/all-remote/guide/) and [all-remote meetings](https://handbook.gitlab.com/handbook/company/culture/all-remote/meetings/): when to meet, recordings and agendas for other time zones.
- [Google SRE book, Being On-Call](https://sre.google/sre-book/being-on-call/): night shifts, multi-site rotations, team size for dual sites.
- [Google SRE Workbook, On-Call](https://sre.google/workbook/on-call/): minimum people per site for multi-site rotations.
- [EU Working Time Directive 2003/88/EC](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex:32003L0088): an example of working-time rules; not legal advice, ask HR or legal for your jurisdiction.

## Related

- [[on-call-health]] and [[on-call-compensation-and-recovery]]: rota design, handover and rest after night work.
- [[one-on-ones]]: running 1:1s across time zones.
- [[team-charter]]: where the overlap window and response times are written down.
- [[rfc-and-design-review-process]]: async review of larger changes.
- [[change-freezes-and-maintenance-windows]]: change safety rules.
- [[structured-logging-conventions]]: UTC in logs.
- [[bus-factor-and-knowledge-transfer]]: spreading knowledge across regions.
