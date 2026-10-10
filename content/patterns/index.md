---
title: Patterns
description: Reusable, tested ways of building things on the platform.
tags:
  - patterns
  - meta
created: 2026-10-10
modified: 2026-10-10
draft: false
---

A pattern is a repeatable solution to a recurring problem, with enough detail to apply it and enough context to know when not to.

## Patterns

- [[gke-workload-identity|Workload Identity Federation for GKE]]: give Pods access to Google Cloud APIs without service account keys.

## Shape of a pattern note

1. The problem and when the pattern applies.
2. The steps, with commands that can be copied.
3. A way to verify it worked.
4. Troubleshooting for the failures you actually hit.
5. Rollback, when the change is not trivially reversible.

Patterns that embody a significant choice link to the [[adr/index|ADR]] that made it.
