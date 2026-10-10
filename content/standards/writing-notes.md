---
title: Writing notes
description: File naming, required frontmatter, tagging taxonomy, wikilink and callout conventions, and the ADR lifecycle.
tags:
  - standards
  - meta
created: 2026-10-10
modified: 2026-10-10
draft: false
---

This is the contract every note follows. It is deliberately short.

## File naming and layout

- Lowercase kebab-case file names: `gke-workload-identity.md`, not `GKE Workload Identity.md`.
- One note per file, in the folder that says what **kind** of note it is: `adr/`, `patterns/`, `tools/`, `standards/`.
- Each folder has an `index.md` that introduces the section and links to its notes.
- ADRs use `NNNN-short-kebab-title.md` (see [[adr/index|the ADR index]]).
- Images and attachments go next to the note that uses them, in a folder named after the note; avoid binary files when text or Mermaid will do.

## Required frontmatter

Every note starts with YAML frontmatter:

```yaml
---
title: Human readable title
description: One sentence, shown in link previews and search results.
tags:
  - topic-tag
created: 2026-10-10
modified: 2026-10-10
draft: false
---
```

| Field         | Required | Notes                                                                      |
| ------------- | -------- | -------------------------------------------------------------------------- |
| `title`       | yes      | Sentence case. Becomes the page heading, so do not repeat it as an `# H1`. |
| `description` | yes      | One sentence, under about 160 characters.                                  |
| `tags`        | yes      | At least one tag from the taxonomy below.                                  |
| `created`     | yes      | ISO date `YYYY-MM-DD`.                                                     |
| `modified`    | yes      | ISO date. Update it when the meaning changes, not for typo fixes.          |
| `draft`       | yes      | `true` keeps a note out of the published site.                             |
| `aliases`     | no       | Alternative names that wikilinks can use.                                  |
| `status`      | ADRs     | One of the ADR statuses below.                                             |

## Tagging taxonomy

Tags are lowercase and hyphen-separated. Use the existing ones before inventing new ones.

| Kind     | Tags                                                     |
| -------- | -------------------------------------------------------- |
| Type     | `adr`, `patterns`, `tools`, `standards`, `meta`          |
| Platform | `kubernetes`, `gitops`, `gke`, `gcp`                     |
| Concern  | `security`, `networking`, `observability`, `reliability` |

Add a new tag by adding it to this table in the same change that first uses it. See [[tags|the tags page]] for browsing.

## Wikilinks

- Link with `[[note-name]]` using the file name without extension; Quartz resolves the shortest unambiguous path. Include the folder (`[[adr/index]]`) when the bare name is ambiguous, as with the `index.md` pages.
- Use `[[note-name|display text]]` when the text should differ, and `[[note-name#Heading]]` to link to a section.
- Inside tables, escape the pipe: `[[note-name\|display text]]`.
- A link that doesn't resolve fails CI (`npm run check:links`), so a note can't ship with a dead link.
- Link generously: every note should link to at least one other note, and every decision should link to the notes that explain it.
- External links use normal Markdown links and always `https://`.

## Callouts

Use callouts sparingly, for things a skimming reader must not miss:

| Callout        | Use for                                                 |
| -------------- | ------------------------------------------------------- |
| `> [!note]`    | Neutral extra context.                                  |
| `> [!info]`    | Scope, assumptions, versions checked.                   |
| `> [!tip]`     | A shortcut or recommended practice.                     |
| `> [!warning]` | Something that causes outages, data loss or insecurity. |
| `> [!danger]`  | Irreversible actions.                                   |

Add a title after the type (`> [!warning] Records are immutable`). More than two callouts in a screenful is a sign the prose needs work.

## Code and diagrams

- Fence code with a language (`bash`, `yaml`, `text`) so it is highlighted and gets a copy button.
- Commands must be copy-pasteable. Put variables at the top and reference them.
- Prefer Mermaid diagrams over images so they diff, review and theme properly.

## ADR lifecycle

ADRs follow `Proposed` -> `Accepted` and then end in one of `Rejected`, `Deprecated` or `Superseded`. Accepted ADRs are immutable apart from status and links. To change a decision, write a new ADR that supersedes the old one and set the old one to `Superseded` with a link in both directions. The full rules are in [[adr/index]]; start new records from [[template]].
