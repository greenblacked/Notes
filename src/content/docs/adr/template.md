---
title: ADR template
description: Template for new Architecture Decision Records. Copy it, do not edit it in place.
tags: [adr, meta]
sidebar:
  order: 9999
---

> [!note] This is a template
> Copy this file to `src/content/docs/adr/NNNN-short-kebab-title.md`, replace
> the placeholders and set `status`. Pick the next unused number from
> [[adr/index|the ADR index]], and add the record to its table.

Frontmatter for the copy:

```yaml
---
title: 'ADR-NNNN: Short decision title'
description: One sentence stating the decision.
status: proposed
tags: [adr, <topic tag>]
created: YYYY-MM-DD
sidebar:
  label: NNNN Short decision title
---
```

Body:

```markdown
## Context

What is the problem or situation? Which forces (technical, organisational,
cost, risk) are at play? State facts, not the solution.

## Decision

We will ... (one active-voice sentence, then the details that make it actionable).

## Consequences

What becomes easier? What becomes harder? What new risks or follow-up work do
we accept?

## Alternatives considered

For each serious alternative: what it is, and why it was not chosen. Link to a
comparison note when there is one.

## References

Links to docs, issues and related ADRs.
```

See [[writing-notes#ADR lifecycle|the ADR lifecycle]] for how statuses change.
