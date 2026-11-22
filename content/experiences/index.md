---
title: Experiences
description: What actually happened — real incidents and real lab experiments — and the rule or procedure each one produced.
tags:
  - experiences
  - meta
created: 2026-11-22
modified: 2026-11-22
draft: false
---

A note in this section records a **case**: something that happened, with enough detail that a reader can judge the claim. It is the evidence behind the runbooks and patterns elsewhere on the site. A runbook says what to do; an experience note says what happened when it was done, and why the procedure looks the way it does.

This section exists because the rest of the site is full of procedures with no case behind them. [[standards/experience-and-evidence|Experience and evidence]] is the rule: a claim is worth what its provenance is worth, and the note has to say which provenance it has.

## Two kinds of case

| Kind            | What it is                                                   | Who can record it             | Evidence level it can reach |
| --------------- | ------------------------------------------------------------ | ----------------------------- | --------------------------- |
| Production case | A real incident, near miss or decision in a real environment | Only the person who was there | `operationally-verified`    |
| Lab case        | A real experiment, reproduced and recorded, with the output  | Anyone who ran it             | `lab-tested`                |

Both are real. A lab case is not a lesser thing — it is the only honest way to publish a mechanism you have not met in production, and it is how a procedure earns its first evidence level. What neither may be is **invented**: a plausible timeline that nobody lived is worse than no note, because a future reader cannot tell it from the real ones.

## The rule for this section

- **A production case is written by the person who was there,** and only they set `operationally-verified`. Agents and contributors without that access never set it.
- **A lab case records the commands, the versions and the observed output,** in the `### Lab run` subsection. If a step was not run, it goes under `### Not verified`.
- **Every case names what it produced:** a runbook, a pattern, a decision rule, or a change to how the team works. A case that changed nothing is a diary entry, not a note.
- **A case is not a postmortem.** Postmortems follow [[blameless-postmortems]] and stay internal. An experience note is the part that is worth publishing: the mechanism, the rule and the evidence, with names and internal detail removed.

## Notes

- [[postgres-lock-queue-lab|A lock queue behind an ALTER, reproduced in a lab]]: a Postgres 17 lab run showing one idle transaction blocking an `ALTER` and every later reader, and what each cancellation actually does. Produced [[postgres-lock-queue-triage]].

## Writing one

Start from [[experiences/template|the experience template]]. It has the frontmatter, the section order and the evidence subsections the checker requires. Keep the case short: the reader wants the mechanism and the rule, not the story.

> [!tip] The test for a good case
> After reading it, a colleague should be able to answer three questions without asking you: what was the actual cause, what would they see that tells them it is happening again, and what is the one thing to do first. If the note cannot answer those, it is not finished.
