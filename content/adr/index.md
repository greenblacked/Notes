---
title: Architecture decisions
description: What an Architecture Decision Record is, the numbering convention, and the list of records.
tags:
  - adr
  - meta
created: 2026-10-10
modified: 2026-10-10
draft: false
---

An Architecture Decision Record (ADR) captures one significant decision: the context that forced it, the option chosen, and the consequences accepted. The format follows Michael Nygard's original proposal, "Documenting Architecture Decisions".

## Numbering and file names

- Files are named `NNNN-short-kebab-title.md`, for example `0001-gitops-with-argocd.md`.
- `NNNN` is a four-digit, zero-padded sequence number. Numbers are never reused or renumbered, even if a record is rejected or superseded.
- The note `title` is the decision in sentence case without the number, and the file stem (for example `0001-gitops-with-argocd`) is what wikilinks use. Optional `aliases` such as `ADR-0001` add short names.
- Start from [[template|the ADR template]].

## Lifecycle

An ADR has exactly one status at a time, written in lowercase in the `status` frontmatter field and shown as a chip above the title:

| Status       | Meaning                                                                |
| ------------ | ---------------------------------------------------------------------- |
| `proposed`   | Open for discussion; not yet binding.                                  |
| `accepted`   | Agreed and in force.                                                   |
| `rejected`   | Considered and declined. Kept for the record.                          |
| `deprecated` | No longer relevant, with no replacement.                               |
| `superseded` | Replaced by a newer ADR. Add `superseded_by` and link both directions. |

> [!warning] Records are immutable
> Once an ADR is `Accepted`, only its status and links may change. If the decision changes, write a new ADR that supersedes the old one. Fixing typos is fine; rewriting history is not.

## Records

| ADR                               | Title               | Status   |
| --------------------------------- | ------------------- | -------- |
| [[0001-gitops-with-argocd\|0001]] | GitOps with Argo CD | Accepted |
