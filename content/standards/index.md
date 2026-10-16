---
title: Standards
description: How notes are written, and how production changes, code reviews and postmortems are done.
tags:
  - standards
  - meta
created: 2026-10-10
modified: 2026-10-16
draft: false
---

Standards say how the team works: how notes are written, how production changes are made and reviewed, and how incidents are written up.

- [[writing-notes|Writing notes]]: file naming, required frontmatter, tagging taxonomy, wikilinks, callouts and the ADR lifecycle.

## Engineering standards

- [[production-change-checklist|Production change checklist]]: standard for planning, executing, verifying and communicating production changes, with a risk classification table and a copy-paste checklist.
- [[code-review|Code review for infrastructure code]]: review standard for Terraform, Helm, CI YAML and Dockerfiles covering checks, MR size, turnaround, approvals, tone and automation.
- [[blameless-postmortems|Blameless postmortems]]: when a postmortem is required, how to run it without blame, and a full template with timeline, contributing factors and tracked action items.

> [!warning] Commands are examples
> Commands in these notes use example project and cluster names. Read them before you run them.

## Changing this site

- Use Conventional Commits (for example `feat:`, `fix:`, `docs:`, `ci:`, `build:`, `chore:`, optionally scoped as `fix(ci):`) and keep the subject line to 72 characters or fewer.
- Every change goes through a pull request into `main`, and the `CI OK` check must pass.
- Merging to `main` deploys nothing by itself. The dev site is updated by running Deploy dev manually from `main`, when the owner asks.
- Production releases are `vX.Y.Z` tags created by the Release workflow, and need approval in the `production` environment.
- Notable changes go into `CHANGELOG.md` under _Unreleased_.

Changes to a standard follow the same rule as any other decision: if it is significant, record it as an [[adr/index|ADR]].
