---
title: Experience note template
description: Template for an experience note — a production case or a lab case — with the frontmatter and evidence subsections the checker requires.
type: standard
tags:
  - experiences
  - meta
created: 2026-11-22
modified: 2026-11-22
draft: false
---

> [!note] This is a template
> Copy it to `content/experiences/<kebab-title>.md`, replace the placeholders, and delete the parts that do not apply. Do not edit it in place. Read [[standards/experience-and-evidence|Experience and evidence]] first.

Frontmatter for a **production case** (the person who was there sets `operationally-verified`):

```yaml title="content/experiences/<kebab-title>.md"
---
title: What happened, in one line
description: One sentence: the mechanism and what it produced.
type: note
tags:
  - experiences
  - <platform tag>
  - <concern tag>
created: YYYY-MM-DD
modified: YYYY-MM-DD
draft: false
evidence: operationally-verified
verified: YYYY-MM-DD # the day the owner last checked the claims against the system
reviewed: YYYY-MM-DD
review-due: YYYY-MM-DD # after reviewed, at most 366 days later
---
```

For a **lab case**, use `evidence: lab-tested` and drop `verified`. Both levels need `reviewed` and `review-due`.

Body structure:

```markdown
> [!info] What this case is
> One or two sentences: where it happened, and whether it is a production case or a lab case.

## Context

The situation before anything went wrong: the system, the change in flight, the
constraint that made it matter. Facts, not the fix.

## The experiment / What happened

For a lab case: the setup, the exact commands, and the observed output in fenced
blocks. For a production case: the timeline, with times and what was observed, not
what people assumed.

## What it means

The rules the case produced, as "if X, look at Y first, because Z". Each one should
be checkable against the case above it.

## Evidence

### Sources checked

- [Title](https://example.com): the claims this backs, checked YYYY-MM-DD.

### Not verified

- Every claim or step no source or run confirmed. Never empty.

### Environment

Platform and tool versions, as printed.

### Prerequisites

What must be in place before the case can be reproduced.

### Expected results

What a successful run looks like.

### Failure conditions

What tells you the run did not work.

### Cleanup and rollback

What the case created and how it is removed.

### Lab run

Required for a lab case: host OS, exact tool versions, the commands in one fenced
block, the observed output in a second fenced block, and the date.

### Operational check

Required for a production case: which system (described generically), who checked
it, when, and what was observed.

## Related

- [[the-runbook-or-pattern-it-produced]]
```

This note is the case, so its `### Operational check` needs no link. A note **outside** this section that claims `operationally-verified` (a runbook or pattern) must link to the experience note that records the case, and the checker enforces that.
