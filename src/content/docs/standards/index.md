---
title: Standards
description: Conventions for writing these notes and for the platform work they describe.
tags: [meta, standards]
---

## Writing notes

- One topic per note; file names are lowercase kebab-case (`gke-workload-identity.md`).
- Every note has `title`, `description` and `tags` in frontmatter.
- Link notes with `[[wikilinks]]` — bare file names resolve when unique, use the
  path (`[[adr/0001-gitops-with-argocd]]`) when they are not. Broken links fail CI.
- Use callouts for anything a reader must not miss:

> [!warning] Commands are examples
> Commands in these notes use example project and cluster names. Read before you run.

## Architecture decision records

- Numbered `adr/NNNN-short-title.md`, status in frontmatter: `proposed`,
  `accepted`, `superseded` or `deprecated`.
- Accepted ADRs are not rewritten. A new ADR supersedes the old one and both link
  to each other.

## Changes to this site

- Conventional Commits, subject line ≤ 72 characters.
- Every change goes through a pull request into `main`; merging deploys stage.
- Production releases are `vX.Y.Z` tags and need approval in the `production` environment.
