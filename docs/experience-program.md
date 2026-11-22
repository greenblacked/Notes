# Experience-grounded notes program

Working document for the programme that adds notes from real experience and brings the unrated
backlog under control. The published rules live in
[`content/standards/experience-and-evidence.md`](../content/standards/experience-and-evidence.md)
and [`content/adr/0063-notes-are-grounded-in-real-experience.md`](../content/adr/0063-notes-are-grounded-in-real-experience.md).
This file holds the state, the backlog and the decisions that are still open.

## Where it stands

| Thing                                                | State                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `content/experiences/` section                       | Added, registered in the top bar, with an index and a template                             |
| The standard                                         | Written                                                                                    |
| ADR 0063                                             | Accepted                                                                                   |
| Checker rule: an operational claim links to its case | Implemented in `scripts/check-notes.mjs`, with tests                                       |
| Risk scan for unrated notes                          | `node scripts/scan-unrated-notes.mjs`, with tests                                          |
| First lab case                                       | `content/experiences/postgres-lock-queue-lab.md` (lab-tested, run in Docker on 2026-11-22) |
| First runbook from a case                            | `content/runbooks/postgres-lock-queue-triage.md` (lab-tested)                              |
| Production cases                                     | **None yet.** Only the owner can write them.                                               |

The chain works end to end on the lab case: a case, a procedure, and a link in both directions.
The first production case is the next thing that needs the owner, not more code.

## Baseline, 2026-11-22

From `npm run check:notes --queue` and `npm run scan:unrated`:

- 589 notes; 90 declare an evidence level (all `source-reviewed`; 0 `lab-tested`, 0
  `operationally-verified`).
- 499 notes with a type declare no level. Of those, 355 contain commands a reader will copy, 314
  describe something destructive, and 464 make a security, IAM or credential claim.
- 40 unrated notes are `type: runbook` — procedures with no evidence behind them. They are the
  highest-value review target, and the risk scan ranks them first.

The top of the risk list is exactly what it should be: the most-linked runbooks with the most
commands. `kubernetes-pod-troubleshooting` (score 20, 14 command blocks, 70 inbound links) is the
single most dangerous note on the site if any of it is wrong.

## Backlog

Ordered by the risk scan, one row per wave. Do not start a wave before the previous one is merged:
each wave changes the evidence levels the next one builds on.

| Wave | Contents                                                                    | Owner effort               | Gate                                                             |
| ---- | --------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| 0    | Section, standard, ADR, checker rule, risk scan, first lab case             | done                       | `check:notes`, `test:scripts`, `check:links`, build              |
| 1    | Three production cases, from interviews                                     | 3 × 45 min + 45 min review | owner sets `operationally-verified`; each case links its runbook |
| 2    | Three runbooks rebuilt from those cases, reproduced in a lab where possible | 45 min review              | `lab-tested` with observed output                                |
| 3    | Two patterns and one architecture note the cases revealed                   | 30 min review              | sources checked, links resolve                                   |
| 4    | Audit batch 1: the top 10 risk-ranked runbooks                              | 30 min per batch           | each note rated, corrected or deleted                            |
| 5    | Audit batches 2 to n, 10 to 40 notes each                                   | 30 min per batch           | `check:notes`, `check:links`, CHANGELOG                          |

## The three production cases

The programme is only as good as these three. Candidates from the repository's own history, in
order of how much material already exists:

1. **The GKE node-pool relabel that dropped labels** (`0.15.0`). A real bug, a real fix, and a
   rule — "`--node-labels` replaces all user-set labels, read them first" — that is currently
   buried in a changelog entry rather than a note.
2. **Artifactory storage full** (`content/runbooks/artifactory-storage-full-recovery.md`). A
   procedure that exists with no case behind it.
3. **Cloud SQL HA failover** (`content/runbooks/cloud-sql-ha-failover-recovery.md`). Same shape,
   and the client-side reconnect behaviour is the part that bites.

If none of these is the incident that actually hurt, use that one instead. The interview matters
more than the topic.

## Interview plan

Three recorded 45-minute sessions, each on one real case, following the
`tacit-knowledge-elicitation` questions:

- What did you check first, and why that first?
- What would a novice have missed?
- What would have made you change course?
- What did you do that a runbook would have told you not to?

Output per session: one `content/experiences/` note, and two to five decision rules of the form
"if X, look at Y first, because Z". Each rule is re-tested against the same case before it ships;
a rule that misleads is worse than no rule.

## Open decisions

1. Which three cases anchor wave 1.
2. Whether production cases stay in `content/experiences/` or are also summarised in the
   runbook's `## When to use`.
3. How aggressive the audit is: the scan suggests 60 to 120 notes are worth deleting or rewriting.
   That list is proposed and approved, never executed unilaterally.

## Commands

```sh
npm run check:notes        # evidence metadata; fails on a broken rule
npm run check:notes -- --queue   # reviews overdue, due soon, changed since review, unrated count
npm run scan:unrated       # rank unrated notes by risk
npm run scan:unrated -- --top 10 --summary "$GITHUB_STEP_SUMMARY"
npm run test:scripts       # unit tests, including the two new rules
```
