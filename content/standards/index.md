---
title: Standards
description: Conventions for writing these notes and for changing this site.
tags:
  - standards
  - meta
created: 2026-10-10
modified: 2026-10-10
draft: false
---

Standards keep a growing set of notes consistent and findable.

- [[writing-notes|Writing notes]]: file naming, required frontmatter, tagging taxonomy, wikilinks, callouts and the ADR lifecycle.

> [!warning] Commands are examples
> Commands in these notes use example project and cluster names. Read them before you run them.

## Changing this site

- Use Conventional Commits (for example `feat:`, `fix:`, `docs:`, `ci:`, `build:`, `chore:`, optionally scoped as `fix(ci):`) and keep the subject line to 72 characters or fewer.
- Every change goes through a pull request into `main`, and the `CI OK` check must pass.
- Merging to `main` deploys nothing by itself. The dev site is updated by running Deploy dev manually from `main`, when the owner asks.
- Production releases are `vX.Y.Z` tags created by the Release workflow, and need approval in the `production` environment.
- Notable changes go into `CHANGELOG.md` under _Unreleased_.

Changes to a standard follow the same rule as any other decision: if it is significant, record it as an [[adr/index|ADR]].
