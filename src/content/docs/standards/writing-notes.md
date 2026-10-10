---
title: Writing notes
description: File naming, frontmatter, tags, wikilink and callout conventions, and the ADR lifecycle.
tags: [standards, meta]
---

This is the contract every note follows. It is deliberately short.

## File naming and layout

- Lowercase kebab-case file names: `gke-workload-identity.md`, not `GKE Workload Identity.md`.
- One note per file, in the folder that says what **kind** of note it is:
  `adr/`, `patterns/`, `tools/`, `standards/`.
- Each folder has an `index.md` that introduces the section and links to its notes.
- ADRs use `NNNN-short-kebab-title.md` (see [[adr/index|the ADR index]]).
- Images go next to the note that uses them; prefer Mermaid when a diagram will do.

## Frontmatter

```yaml
---
title: Human readable title
description: One sentence, shown in search results and link previews.
tags: [topic-tag]
created: 2026-10-10
modified: 2026-10-10
---
```

| Field | Required | Notes |
| --- | --- | --- |
| `title` | yes | Sentence case. Becomes the page heading, so don't repeat it as an `# H1`. |
| `description` | yes | One sentence, under about 160 characters. |
| `tags` | yes | At least one tag from the taxonomy below. |
| `created` | recommended | ISO date `YYYY-MM-DD`. |
| `modified` | no | ISO date. Update it when the meaning changes, not for typo fixes. The page footer also shows the last Git change. |
| `draft` | no | `true` keeps a note out of every deployed build. Links to drafts fail CI. |
| `status` | ADRs | One of the ADR statuses below. |

## Tags

Tags are lowercase and hyphen-separated. Use the existing ones before inventing new ones.

| Kind | Tags |
| --- | --- |
| Type | `adr`, `pattern`, `tools`, `standards`, `meta` |
| Platform | `kubernetes`, `gitops`, `gke`, `gcp`, `argocd`, `flux` |
| Concern | `security`, `iam`, `networking`, `observability`, `reliability` |

Add a new tag to this table in the same change that first uses it.
Browse them on the [tags page](/tags/).

## Wikilinks

- Link with `[[note-name]]`, the file name without extension. Use the path
  (`[[adr/index]]`) when the bare name is ambiguous.
- `[[note-name|display text]]` changes the text; `[[note-name#Heading]]` links to a section.
- Inside tables, escape the pipe: `[[note-name\|display text]]`.
- A link that doesn't resolve fails CI, so a note can't ship with a dead link.
- Every note should link to at least one other note, and every decision to the
  notes that explain it.
- External links use normal Markdown links and always `https://`.

## Callouts

Use callouts sparingly, for things a skimming reader must not miss:

| Callout | Use for |
| --- | --- |
| `> [!note]` | Neutral extra context. |
| `> [!info]` | Scope, assumptions, versions checked. |
| `> [!tip]` | A shortcut or recommended practice. |
| `> [!warning]` | Something that causes outages, data loss or insecurity. |
| `> [!danger]` | Irreversible actions. |

Add a title after the type (`> [!warning] Records are immutable`). More than
two callouts in a screenful is a sign the prose needs work.

## Code and diagrams

- Fence code with a language (`bash`, `yaml`, `text`) so it is highlighted and gets a copy button.
- Commands must be copy-pasteable. Put variables at the top and reference them.
- Prefer Mermaid diagrams over images so they diff, review and theme properly.

## ADR lifecycle

ADRs go from `proposed` to `accepted`, and end as `rejected`, `deprecated` or
`superseded`. Accepted ADRs are immutable apart from status and links. To
change a decision, write a new ADR that supersedes the old one, set the old one
to `superseded` and link both directions. The rules are in [[adr/index]];
start new records from [[template]].
