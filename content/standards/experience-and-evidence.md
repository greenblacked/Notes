---
title: Experience and evidence
description: Where a note's claims come from, what each evidence level requires, and the rule that an operational claim must point at the case that proves it.
type: standard
tags:
  - standards
  - meta
created: 2026-11-22
modified: 2026-11-22
draft: false
---

[[writing-notes]] is the contract for how a note is shaped. This is the contract for what a note is **worth**: where its claims came from, which evidence level that supports, and what the site will and will not publish. It exists because a knowledge base that grows faster than it is checked turns into a set of confident guesses, and the reader cannot tell which is which.

The decision behind it is [[adr/0063-notes-are-grounded-in-real-experience]].

## Provenance

Every technical claim rests on one of four kinds of evidence. A note's `evidence` level is the weakest kind it relies on.

| Code   | Provenance                                                                                       | Who can supply it             | Supports                            |
| ------ | ------------------------------------------------------------------------------------------------ | ----------------------------- | ----------------------------------- |
| `OP`   | A real incident, near miss or decision in a real environment                                     | Only the person who was there | `operationally-verified`            |
| `LAB`  | The procedure run in a disposable lab, with the observed output                                  | Anyone who ran it             | `lab-tested`                        |
| `SRC`  | Every technical claim checked against current official documentation, at a recorded URL and date | Anyone                        | `source-reviewed`                   |
| `HIST` | A decision already recorded in this repository: an ADR, a merged change, a release review        | The repository itself         | `source-reviewed`, cited to the ADR |

A claim that rests on none of these does not go in a note. It is removed, or the note is written without it.

### What each level requires

The mechanical requirements are in [[writing-notes#Evidence levels]] and enforced by `npm run check:notes`. The parts a checker cannot enforce:

- **`source-reviewed`** means every command, flag, field, limit, default and version statement was compared with a primary source on the `reviewed` date. "I know this is how it works" is not a source. A secondary source — a blog post, a summary, another note — is not a primary source.
- **`lab-tested`** means the note's **main procedure** ran, not a helper step, and the output is recorded. The `### Lab run` subsection holds the commands and the output, and the versions are the ones printed, not the ones intended.
- **`operationally-verified`** means the owner carried the procedure out against a real target environment. It also requires a `verified` date, and it cannot be set by an agent or a contributor, because they do not have that environment.

Unrated is a valid state. Most notes on this site are unrated, and that is honest: they are useful and they have not been checked. The levels are a promise, not a badge, and a missing promise is better than a broken one.

## Experience notes

An **experience note** records a case. It lives in `content/experiences/` and is the evidence behind a runbook or a pattern elsewhere on the site.

- **A production case** is an incident, near miss or decision in a real environment. Only the person who was there writes it and sets `operationally-verified`.
- **A lab case** is a real experiment with recorded output. It can reach `lab-tested`.

Both are real; neither may be invented. A plausible timeline that nobody lived is the worst failure mode of this section, because a future reader cannot distinguish it from the real ones.

Every case must name what it produced: a runbook, a pattern, a decision rule, or a change to how the team works. The link runs in both directions — the case links to the procedure, the procedure links to the case.

## The rule the checker enforces

A note **outside** `content/experiences/` that declares `operationally-verified` must have an `### Operational check` subsection containing a wikilink to a note in `content/experiences/`. A note inside `content/experiences/` is itself the case and needs no such link.

The point is narrow: an operational claim must be traceable to a case. A paragraph of confident prose is not a case, and before this rule it passed the checker. A runbook that says "verified in production" and cannot name the incident is claiming a level it has not earned.

## Finding what needs work

`node scripts/scan-unrated-notes.mjs` ranks the notes that declare no level by how much damage a wrong claim in them would do: runnable commands, IAM or security claims, destructive steps, type, and how many other notes link to them. It reports; it never fails the build and never edits a note. Use it to choose the next batch to review, in the same way the AI notes were reviewed in batches.

## Working rules

- **Do not copy a command forward.** A command taken from a neighbouring note inherits that note's unverified assumptions. Re-check it or re-run it.
- **Write the case before the procedure.** A runbook written before the case tends to describe the mechanism someone imagined rather than the one that bit them.
- **Record what failed.** The `### Not verified`, `### Failure conditions` and Troubleshooting sections are where a note stops being generic. A note with nothing in them has probably not been run.
- **Keep names out.** Systems are described generically; no customer, host or account names in a published case.
- **A case is not a postmortem.** Postmortems stay internal and follow [[blameless-postmortems]]. The published part is the mechanism and the rule.

## Related

- [[writing-notes]]: the shape of a note and the evidence metadata.
- [[adr/0063-notes-are-grounded-in-real-experience]]: the decision.
- [[experiences/index|Experiences]]: the section, and the template.
- [[blameless-postmortems]]: the internal write-up an experience note is not.
