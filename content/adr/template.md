---
title: ADR template
description: Template for new Architecture Decision Records. Copy it, do not edit it in place.
type: standard
tags:
  - adr
  - meta
created: 2026-10-10
modified: 2026-10-11
draft: false
---

> [!note] This is a template
> Copy this file to `content/adr/NNNN-short-kebab-title.md`, replace the placeholders, and set `status`. Pick the next unused number from [[adr/index|the ADR index]], and add the new record to the table there.

Frontmatter to use in the copy:

```yaml title="content/adr/NNNN-short-kebab-title.md"
---
title: Short decision title
description: One sentence stating the decision.
type: adr
tags:
  - adr
  - <topic tag>
status: proposed # proposed | accepted | rejected | deprecated | superseded
created: YYYY-MM-DD
modified: YYYY-MM-DD
decided: YYYY-MM-DD # the day it was accepted; leave out while proposed
draft: false
aliases:
  - ADR-NNNN
---
```

`type`, `status` and `decided` feed the metadata sheet under the title (see [[writing-notes#Metadata sheet|writing notes]]). Add `verified: YYYY-MM-DD` only after checking the claims against their sources.

Body structure:

```markdown
## Context

What is the problem or situation? Which forces (technical, organisational, cost,
risk) are at play? State facts, not the solution.

## Decision

We will ... (one active-voice sentence, then the details that make it actionable).

## Consequences

What becomes easier? What becomes harder? What new risks or follow-up work do we accept?

## Alternatives considered

For each serious alternative: what it is, and why it was not chosen. Link to a
comparison note when there is one.

## References

Links to docs, issues, and related ADRs.
```

See [[writing-notes#ADR lifecycle|the ADR lifecycle]] for how statuses change.
