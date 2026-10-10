---
title: Notes
description: Architecture decisions, platform patterns, and operational notes
tags:
  - meta
created: 2026-10-10
modified: 2026-10-10
draft: false
---

Architecture decisions, platform patterns, and operational notes. These are working notes: written to be useful to future me and to colleagues, kept short, and corrected when they turn out to be wrong.

> [!info] Scope
> The notes lean towards Kubernetes, GitOps and Google Cloud platform engineering. Each note says which versions or products it was checked against, and carries a `modified` date so you can judge how fresh it is.

## How the site is organised

| Section                               | What lives there                                                            |
| ------------------------------------- | --------------------------------------------------------------------------- |
| [[adr/index\|Architecture decisions]] | Numbered, immutable records of significant decisions and their context.     |
| [[patterns/index\|Patterns]]          | Reusable, tested ways of building things on the platform.                   |
| [[tools/index\|Tools]]                | Comparisons and evaluations of tools, with the reasoning behind the choice. |
| [[standards/index\|Standards]]        | How notes themselves are written, named, tagged and reviewed.               |

Start with these:

- [[0001-gitops-with-argocd|ADR 0001: GitOps with Argo CD]] explains how changes reach clusters.
- [[gke-workload-identity|Workload Identity Federation for GKE]] covers keyless access to Google Cloud APIs from Pods.
- [[argocd-vs-flux|Argo CD vs Flux]] compares the two GitOps engines behind that decision.
- [[writing-notes|Writing notes]] is the contract every note follows.

## Finding things

- Use the search box (press `/`) for full-text search across all notes.
- Browse by topic on the [[tags|tags page]], or use the explorer on the left.
- Every note lists its backlinks and a local graph on the right; the global graph shows how the whole set connects.

## Conventions in one paragraph

Notes are plain Markdown with YAML frontmatter, linked with `[[wikilinks]]`, and live in the `content/` folder of a Git repository. Decisions are recorded as ADRs and never rewritten; they are superseded by a new ADR instead. See [[writing-notes]] for the details.
