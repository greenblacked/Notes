---
title: Architecture decisions
description: What an Architecture Decision Record is, the numbering convention, and the list of records.
tags: [adr, meta]
sidebar:
  label: Overview
  order: 0
---

An Architecture Decision Record (ADR) captures one significant decision: the
context that forced it, the option chosen, and the consequences accepted. The
format follows Michael Nygard's "Documenting Architecture Decisions".

## Numbering and file names

- Files are named `NNNN-short-kebab-title.md`, for example `0001-gitops-with-argocd.md`.
- `NNNN` is a four-digit, zero-padded sequence number. Numbers are never reused
  or renumbered, even if a record is rejected or superseded.
- The `title` is `ADR-NNNN: Decision in sentence case`; wikilinks use the file
  name, for example `[[0001-gitops-with-argocd]]`.
- Start from [[template|the ADR template]].

## Lifecycle

An ADR has exactly one `status` at a time:

| Status | Meaning |
| --- | --- |
| `proposed` | Open for discussion; not yet binding. |
| `accepted` | Agreed and in force. |
| `rejected` | Considered and declined. Kept for the record. |
| `deprecated` | No longer relevant, with no replacement. |
| `superseded` | Replaced by a newer ADR. Link both directions. |

> [!warning] Records are immutable
> Once an ADR is `accepted`, only its status and links may change. If the
> decision changes, write a new ADR that supersedes the old one. Fixing typos is
> fine; rewriting history is not.

## Records

| ADR | Title | Status |
| --- | --- | --- |
| [[0001-gitops-with-argocd\|0001]] | GitOps with Argo CD | accepted |
