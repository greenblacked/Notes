---
title: Tags
description: How tags are used to classify notes, and where to browse them.
tags:
  - meta
created: 2026-10-10
modified: 2026-10-10
draft: false
---

Tags answer "what is this note about?" while folders answer "what kind of note is this?". Every note carries at least one tag from the controlled vocabulary in [[writing-notes#Tagging taxonomy|the tagging taxonomy]].

## Browsing

Quartz generates one page per tag at `/tags/<tag>` and an index of all tags at [[tags/index|the tag index]]. Nested tags such as `cloud/gcp` also produce a page for each parent (`/tags/cloud`).

Some entry points:

- Decisions: [[tags/adr|adr]]
- Kubernetes: [[tags/kubernetes|kubernetes]]
- Google Cloud: [[tags/gcp|gcp]]
- GitOps: [[tags/gitops|gitops]]
- Security: [[tags/security|security]]

## Using tags

- Put tags in the frontmatter `tags` list, lowercase, hyphen-separated.
- Prefer a few precise tags over many vague ones; three to five is typical.
- Inline `#tags` in the body also work, but frontmatter keeps them reviewable, so notes here use frontmatter only.
- A new tag needs an entry in the taxonomy first. See [[writing-notes]].
