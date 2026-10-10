---
title: Notes
description: Architecture decisions, platform patterns, and operational notes
template: splash
hero:
  tagline: Architecture decisions, platform patterns, and operational notes from running Kubernetes and cloud platforms in production.
  actions:
    - text: Architecture decisions
      link: /adr/0001-gitops-with-argocd/
      icon: right-arrow
    - text: Browse by tag
      link: /tags/
      variant: minimal
---

## What is here

| Section | What it holds |
| --- | --- |
| [[adr/0001-gitops-with-argocd\|Architecture decisions]] | ADRs: context, decision, consequences. One decision per record, never rewritten, only superseded. |
| [[gke-workload-identity\|Patterns]] | Reusable, production-tested ways of solving a recurring platform problem. |
| [[argocd-vs-flux\|Tools]] | Comparisons and evaluations, with the criteria that decided them. |
| [[standards/index\|Standards]] | Conventions these notes and the platform work follow. |

## Recently added

- [[0001-gitops-with-argocd]] — why cluster state is reconciled from Git by Argo CD
- [[gke-workload-identity]] — keyless access from GKE workloads to Google Cloud APIs
- [[argocd-vs-flux]] — how the two GitOps controllers compare in practice

> [!note] How these notes are written
> Notes are authored in Obsidian and published from Git. Links between notes use
> `[[wikilinks]]`; every page lists its tags at the bottom, and the [tags page](/tags/) indexes them.
