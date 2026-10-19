---
title: Bus factor and knowledge transfer for platform systems
description: Find single points of knowledge in infrastructure from commit and on-call data, then make them survivable with runbooks, pairing and rotations.
type: guide
tags:
  - management
  - team-process
  - reliability
  - on-call
created: 2026-10-19
modified: 2026-10-19
draft: false
---

Every platform team has a system that only one person really understands: the Terraform for the network, the Jenkins controller that nobody dares touch, the certificate renewal that happens "when Olena remembers". The bus factor is the number of people who can leave before the system cannot be operated. For many infrastructure systems it is one. This is a management risk, not a personal failing, and the remedy is deliberate transfer of knowledge, not heroics or a documentation sprint.

## Why platform teams accumulate single owners

- **Specialisation is efficient in the short term.** The person who built it fixes it fastest, so work keeps flowing to them.
- **Interrupts reinforce it.** The expert answers every question, learns more, and teaches less.
- **Infrastructure changes rarely.** A system that runs for a year without changes is not rehearsed; knowledge decays silently.
- **Incentives favour delivery over transfer.** Nobody gets promoted for writing the runbook that makes them replaceable, unless the career ladder says so, see [[career-ladder-devops]].
- **Small teams.** With five engineers and thirty systems, someone must own several.

Make ownership explicit first, see [[delegation-and-ownership]] and [[team-charter]]: a named owner and a named deputy for each system.

## Finding single points of knowledge

Use data as a starting point and talk to people for the verdict. Three sources:

**Commit history.** Who has changed each area in the last year?

```bash title="bus-factor-scan.sh"
#!/usr/bin/env bash
# Authors per top-level directory over the last 12 months. A starting point, not a verdict.
set -euo pipefail

REPO_DIR="${1:?usage: bus-factor-scan.sh <repo-dir>}"
SINCE="${SINCE:-12 months ago}"

cd "${REPO_DIR}"
for dir in $(git ls-tree -d --name-only HEAD); do
  echo "== ${dir}"
  git shortlog -sn --no-merges --since="${SINCE}" -- "${dir}" | head -5
done
```

Read the output carefully. One author in a directory may be a script that bots commit, a generated area, or a stable module that needs no change. Many authors can still hide a single operator if the others only edit text. Authorship is not the same as ability to operate. For options see the [git shortlog documentation](https://git-scm.com/docs/git-shortlog), and note the effect of mailmap files on the names.

**On-call data.** Who is escalated to, who resolves, who answers in the incident channel? If the same person is paged by the secondary or pulled in by colleagues, that person is a single point. See [[on-call-health]] on heroes.

**Review data.** Who approves changes in each area? Areas where only one person can approve are blocked when they are away.

Then ask the team directly, in one-on-ones or a retro, "Which system would you not be able to fix alone if X were unavailable?". People often know. The answer is more reliable than the git log. See [[one-on-ones]].

## Runbook coverage matrix

List the systems vertically and people horizontally. Mark who can operate each without help: deploy, roll back, diagnose a common failure, and renew whatever expires.

| System (tier)                | Ana | Ben | Chris | Dara | Able to operate alone (count) |
| ---------------------------- | --- | --- | ----- | ---- | ----------------------------- |
| GKE clusters (tier 1)        | Y   | Y   | N     | S    | 2                             |
| Terraform network (tier 1)   | Y   | N   | N     | N    | 1 - action needed             |
| Jenkins controller (tier 2)  | N   | Y   | N     | N    | 1 - action needed             |
| Artifact repository (tier 1) | Y   | S   | Y     | N    | 2                             |

Legend: Y = can operate alone, S = shadowing, N = cannot. The names are placeholders.

A starting target: at least two people able to operate each tier-1 system without help. This is a starting point, not a law; adjust to the size of your team and the cost of an outage. Define tiers using your SLOs, see [[slo-burn-rate-alerting]]. Any system with a count of one gets an action with an owner and a date.

## Pairing and shadow rotations

Documents alone do not transfer operating skill; doing does. Mix three techniques:

1. **Pairing on real work.** The expert navigates and the learner drives, then swap. Make this a normal part of task allocation: the learner takes the ticket, the expert reviews.
2. **Shadow rotation.** The learner joins the on-call for the system as a silent second for a number of shifts, then becomes primary with the expert as backup, then the expert steps out. Plan the sequence in the rota, not just in good intentions.
3. **Reverse shadowing.** The learner handles an incident or change while the expert watches and says nothing unless safety demands it. Debrief afterwards.

```text title="shadow-rotation-plan.txt"
System: Terraform network     Expert: Ana     Learner: Ben
Week 1-2   Ben shadows Ana's changes; reads state layout; writes questions
Week 3-4   Ben drives changes with Ana reviewing; one change done end to end
Week 5-6   Ben primary for network pages; Ana secondary, stays quiet
Week 7     Game day: Ben restores from a broken state without Ana's help
Week 8     Review: update runbook with every gap found; sign off or extend
Exit rule: Ben operates without help in game day and a real change;
           otherwise extend by two weeks, once.
```

Protect learning time on the roadmap, otherwise interrupts consume it. A quarter's worth of transfer should appear as capacity in [[planning-and-prioritization]].

## Recorded walkthroughs

A 20-minute screen recording of an expert doing a routine task, with narration of why, is cheap and captures things that written docs miss. Rules that keep them useful:

- one task per recording, with a title and a date;
- store them next to the runbook, linked from it;
- never record secrets or customer data on screen;
- they supplement the runbook; they do not replace it, because recordings cannot be searched or diffed easily.

Review them when the system changes, or mark them stale. A stale recording misleads more than none.

## Measuring the result

Track a few numbers each quarter, and report them honestly:

- count of tier-1 systems with fewer than two independent operators (target: down);
- share of on-call shifts where the secondary resolved the page without escalating to a named expert;
- runbook coverage: tier-1 alerts with a runbook that has been exercised in a game day;
- time to onboard a new engineer to the rota, see [[onboarding-engineers]];
- the number of times the expert was needed outside their shift.

Do not turn the metrics into individual scores. The point is to see the system's risk, not to rank people.

## Game-day check

The test of a runbook is whether someone other than its author can follow it. Run a game day each quarter on one tier-1 system:

1. Pick a scenario from the incident history, see [[incident-response]].
2. A learner does the work with only the runbook; the author sits in another room, reachable only through a fixed question budget.
3. Record every question, every wrong turn and every command that did not work.
4. Fix the runbook the same week and re-run the failing step.
5. Record the result in the coverage matrix.

Run it in a non-production environment unless the team has a mature practice; if it must run in production, follow a change procedure with a rollback.

## When to stop

Knowledge transfer has diminishing returns. Stop when:

- two people can operate each tier-1 system, and the matrix has been re-checked in a game day;
- lower-tier systems have a runbook and a deputy, and that is enough for their risk;
- the cost of cross-training exceeds the outage cost, which is a decision to make on the record, not by drift.

Retire systems that nobody wants to learn; that is a signal for [[decommissioning-platform-services]]. Do not demand deep expertise from everyone on everything; the aim is survivability, not uniformity.

## Failure modes

- **Blaming the expert.** The expert is a symptom of how work was allocated. Thank them, and protect their time to teach.
- **Documentation nobody runs.** Pages written once and never exercised rot; the game day is the cure.
- **Treating git authorship as truth.** It misses operators and over-counts committers.
- **Transfer without capacity.** If there is no time on the plan, there will be no transfer.
- **Pairing as a punishment.** Frame it as normal practice, and rotate who learns.
- **Single expert leaves mid-plan.** Prioritise the one-person systems first, and keep exit interviews and handover time in mind, see [[team-reorg-runbook]] for continuity during change.

## Sources

- [git shortlog documentation](https://git-scm.com/docs/git-shortlog): summarising commit authorship. Check the options for your Git version.

## Related

- [[delegation-and-ownership]]
- [[onboarding-engineers]]
- [[on-call-health]]
- [[team-charter]]
- [[incident-response]]
- [[one-on-ones]]
