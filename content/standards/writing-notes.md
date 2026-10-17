---
title: Writing notes
description: File naming, required frontmatter, tagging taxonomy, wikilink and callout conventions, and the ADR lifecycle.
type: standard
tags:
  - standards
  - meta
created: 2026-10-10
modified: 2026-10-17
verified: 2026-10-11
draft: false
---

This is the contract every note follows. It is deliberately short.

## File naming and layout

- Lowercase kebab-case file names: `gke-workload-identity.md`, not `GKE Workload Identity.md`.
- One note per file, in the folder that says what **kind** of note it is: `adr/`, `architecture/`, `patterns/`, `tools/`, `runbooks/`, `compliance/`, `ai/`, `management/`, `standards/`, `learn/`.
- Each folder has an `index.md` that introduces the section and links to its notes.
- ADRs use `NNNN-short-kebab-title.md` (see [[adr/index|the ADR index]]).
- Images and attachments go next to the note that uses them, in a folder named after the note; avoid binary files when text or Mermaid will do.

## Required frontmatter

Every note starts with YAML frontmatter:

```yaml title="content/<section>/note.md"
---
title: Human readable title
description: One sentence, shown in link previews and search results.
type: pattern
tags:
  - topic-tag
created: 2026-10-10
modified: 2026-10-10
draft: false
---
```

| Field         | Required | Notes                                                                                                       |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `title`       | yes      | Sentence case. Becomes the page heading, so do not repeat it as an `# H1`.                                  |
| `description` | yes      | One sentence, under about 160 characters.                                                                   |
| `tags`        | yes      | At least one tag from the taxonomy below.                                                                   |
| `created`     | yes      | ISO date `YYYY-MM-DD`.                                                                                      |
| `modified`    | yes      | ISO date. Update it when the meaning changes, not for typo fixes.                                           |
| `draft`       | yes      | `true` keeps a note out of the published site.                                                              |
| `type`        | yes      | What kind of note this is: `adr`, `pattern`, `tool`, `standard`, `runbook`, `guide`, `reference` or `note`. |
| `aliases`     | no       | Alternative names that wikilinks can use.                                                                   |
| `status`      | ADRs     | One of the ADR statuses below, in lowercase.                                                                |
| `verified`    | no       | ISO date `YYYY-MM-DD` on which the content was last checked against its sources.                            |
| `decided`     | ADRs     | ISO date `YYYY-MM-DD` on which the decision was accepted.                                                   |

`reference` is for architecture reference designs: a target design and its trade-offs.

Home, section index and tags pages are not notes in this sense: they take no `type`.

## Metadata sheet

`type`, `status`, `verified` and `decided` are shown in a small spec sheet under the title, next to the modified date and the reading time: `type` and `status` as chips (`accepted` green, `proposed` blue, `deprecated`, `superseded` and `rejected` amber), then `decided`, `verified` and the modified date as full dates. A page with none of the four fields shows no sheet, and a missing field is simply left out. The home page lists every note in an index, grouped by folder, with its type, status and `verified` date (the modified date when there is none). Section indexes, the tags pages and files named `template.md` are left out of it.

- `verified` is a promise. Set it only to the day you actually compared the note with the system, document or command output it describes, and move it forward only after repeating that check. Leave it out when you have not checked; an old honest date is better than a fresh guess. It is not the same as `modified`, which records the last edit.
- Write dates unquoted (`2026-10-11`). YAML reads them as dates, and the sheet handles quoted strings as well.
- `status` is lowercase, as listed in [[adr/index#Lifecycle|the ADR lifecycle]]. Other values are shown as given in a neutral chip.

## Reading aids

- **Numbered sections.** The `##` headings of a note are numbered 01, 02, and so on, and the table of contents on the right carries the same numbers. Keep the top-level headings at `##` (the title is the `#`), and the numbers match.
- **Sidenotes.** Use normal Markdown footnotes (`text.[^name]`, then `[^name]: The note.` anywhere in the file). From 1200px up they appear in the margin next to the text that cites them; on narrower screens they stay a numbered list at the end. Margin notes are all or nothing per page: if any footnote contains a list, code block or table, cites another footnote, or is referenced from a callout, table, heading or link, the whole page keeps its footnotes at the end on every screen. Keep footnotes to a sentence or two of plain text, referenced from running text.

## Tagging taxonomy

Tags are lowercase and hyphen-separated. Use the existing ones before inventing new ones.

| Kind     | Tags                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Type     | `adr`, `patterns`, `tools`, `standards`, `runbooks`, `architecture`, `compliance`, `ai`, `management`, `learning`, `meta`                                                            |
| Platform | `kubernetes`, `gitops`, `gke`, `gcp`, `terraform`, `helm`, `docker`, `gitlab-ci`, `jenkins`, `artifactory`, `sonarqube`, `prometheus`, `spinnaker`, `chef`, `opentelemetry`, `linux` |
| Concern  | `security`, `networking`, `observability`, `reliability`, `ci-cd`, `incident-management`, `on-call`, `cost`, `supply-chain`, `policy-as-code`, `audit`                               |
| People   | `leadership`, `hiring`, `career`, `team-process`, `delivery`                                                                                                                         |

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

Compliance notes carry a `> [!warning] Not legal or audit advice` callout, because auditors, assessors or counsel decide what satisfies a control. AI notes link the owner's AI skills catalogue at [ai.szolotov.com](https://ai.szolotov.com).

## Code and diagrams

- Fence code with a language (`bash`, `yaml`, `text`) so it is highlighted and gets a copy button.
- Name the file a block belongs to with `title="..."` after the language: ` ```yaml title="wrangler.jsonc" `. The name is shown as a caption above the block.
- Commands must be copy-pasteable. Put variables at the top and reference them.
- Prefer Mermaid diagrams over images so they diff, review and theme properly.

## Lesson structure

Notes in `learn/` are lessons: `type: guide`, tag `learning` plus the platform and concern tags they teach, and a title `<Track> NN: <topic>` (for example "Linux 01: The shell and the filesystem"). The level is shown in the opening callout, not in a frontmatter field. Every lesson has these sections, in this order:

1. An opening callout: `> [!info] Level: junior | Time: about N h | You need: [[prerequisite]] | Lab: <lab>`.
2. `## What you will learn`: three to six bullets.
3. Concept sections that build up from first principles, each with a real command and sample output, labelled illustrative where values differ per machine.
4. `## Hands-on exercises`: numbered, each with the exact command, the expected output and an "If you see something else" line.
5. `## Common mistakes`: why each bites, and the fix.
6. `## Check your understanding`: four to six questions, with the answers in a folded `> [!question]- Answers` callout.
7. `## Next steps`: the next lesson and the senior notes for going deeper.
8. `## Sources`: official documentation first, with the version checked.

Add `verified` only when the commands were actually run, and give the distro and tool versions. Paid cloud steps get a `> [!warning] Costs money` callout with the cleanup command next to them. Use example domains and the documentation address ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), never real addresses.

## ADR lifecycle

ADRs follow `proposed` -> `accepted` and then end in one of `rejected`, `deprecated` or `superseded`. Accepted ADRs are immutable apart from status and links. To change a decision, write a new ADR that supersedes the old one and set the old one to `superseded` with a link in both directions. The full rules are in [[adr/index]]; start new records from [[template]].
