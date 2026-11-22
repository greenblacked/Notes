---
title: Notes are grounded in real experience, and an operational claim must name its case
description: Notes carry a provenance, real cases get their own section, and a note claiming operational verification must link to the case that proves it.
type: adr
tags:
  - adr
  - meta
status: accepted
created: 2026-11-22
modified: 2026-11-22
decided: 2026-11-22
draft: false
aliases:
  - ADR-0063
---

## Context

This site grew in batches. The changelog records the scale plainly: "110 new notes, 11 in each of the adr, ai, architecture, compliance, learn, management, patterns, runbooks, standards and tools sections" (0.8.0), then "105 AI operations notes" (0.10.0). By November 2026 there were 589 notes.

The evidence levels introduced with the AI notes were the first attempt to say how far a note had been checked. By the time of this decision:

| State                     | Notes |
| ------------------------- | ----- |
| Total notes               | 589   |
| With any `evidence` level | 90    |
| `source-reviewed`         | 90    |
| `lab-tested`              | 0     |
| `operationally-verified`  | 0     |
| With no level             | 499   |

Three things follow from that table.

- **The default was "unrated".** Most notes were written from general knowledge and never checked against anything. That is a legitimate state, but at 84% of the site it is the site's character, not an exception.
- **Nothing had been run.** No note claimed `lab-tested`, and none claimed `operationally-verified`. Every procedure on the site was, at best, documented rather than executed.
- **The last eight releases were repair.** `0.9.0` to `0.16.0` are largely corrections: source-reviewing AI notes, replacing GKE node labels that could not be verified, fixing runbooks, fixing CI. Adding text faster than it can be checked has a cost, and the cost was being paid in release reviews.

The rule that mattered already existed in [[writing-notes]]: "If a lab or review is not actually done, the level is not claimed; unrated is better than overstated." It was true and unenforced. Nothing stopped a note from claiming operational verification with a paragraph of confident prose, and nothing connected a runbook to the incident that produced it.

## Decision

**Every note's claims rest on a named provenance, real cases get their own section, and a note that claims `operationally-verified` must link to the case that proves it.**

### Provenance

A claim rests on one of four kinds of evidence, and a note's level is the weakest it relies on: `OP` (a real incident or decision, owner only), `LAB` (run in a disposable lab, with output), `SRC` (checked against primary documentation at a recorded date) or `HIST` (a decision already in this repository). The model is written down in [[standards/experience-and-evidence]].

### A section for cases

`content/experiences/` holds **experience notes**: a production case, written by the person who was there, or a lab case, with recorded output. Every case names the runbook or pattern it produced, and the link runs both ways. A production case is the only route to `operationally-verified`; a lab case is the honest first step for a procedure nobody has yet met in production.

### Enforcement

A note outside `content/experiences/` that declares `operationally-verified` must have an `### Operational check` subsection containing a wikilink to a note in that section. `npm run check:notes` fails otherwise. Before this, the subsection only had to be non-empty.

`node scripts/scan-unrated-notes.mjs` ranks the unrated notes by the damage a wrong claim would do — runnable commands, IAM and security claims, destructive steps, inbound links — so the review batches are chosen by risk rather than by convenience. It reports and never fails.

### What does not change

Unrated remains a valid state. The levels are promises, not badges, and most of the site will stay unrated for a long time. Nothing is retroactively marked. The 496 unrated notes are reviewed in batches, by risk, or they stay as they are.

## Consequences

Easier:

- A reader can judge a note by its provenance instead of by how confident it sounds.
- A runbook that claims operational verification has a case behind it, and the case can be read.
- The next batch of notes has an obvious shape: a case, a procedure, and the links between them.
- Review effort goes where a wrong claim would hurt most, because the scan ranks it.

Harder or newly required:

- **Writing a note takes longer.** A lab case needs the run, the output and the versions; a source-reviewed note needs every claim checked against a primary source. That is the point, and it is why the batches get smaller.
- **Only the owner can write a production case.** An agent can draft, verify and run, but cannot supply the operational experience or set `operationally-verified`. This deliberately caps how fast the section can grow.
- **A new section is a code change.** `content/experiences/` is registered in `local-plugins/top-bar/sections.ts`, so introducing it cannot ship as a `text/` release; it needs a normal branch and Cut release.
- **The checker is now stricter.** A note that declares `operationally-verified` without a linked case will fail CI where it previously passed.
- **Risk remains.** A case can still be wrong about its own system. The level records who checked and when, not that the check was perfect.

## Alternatives considered

- **Keep adding notes and review later.** This is what produced the 0.9.0 to 0.16.0 repair releases. Rejected: the cost of the backlog is paid at the worst time, during a release.
- **Require every note to be rated.** Would either force a mass of `source-reviewed` claims nobody checked, or block publishing almost everything. Rejected: unrated is honest, and a rule that cannot be met is not a rule.
- **Put cases inside `runbooks/`.** Avoids a code change, but mixes "what happened" with "what to do", and leaves a runbook with no distinct evidence to point at. Rejected.
- **Enforce evidence on all notes with a lint that blocks merge.** Rejected for now: the correct first step is to make the strongest claim (`operationally-verified`) honest, then widen. A site-wide gate would need the 496-note backlog cleared first.
- **Record cases only as internal postmortems.** Keeps the site tidy, but loses the mechanism that is worth publishing and leaves the runbooks unsupported. Rejected.

## References

- [[writing-notes]]: the note contract and the evidence metadata.
- [[standards/experience-and-evidence]]: the provenance model in full.
- [[experiences/index|Experiences]]: the section.
- [[postgres-lock-queue-lab]]: the first lab case, and the runbook it produced.
- [[blameless-postmortems]]: the internal write-up an experience note is not.
