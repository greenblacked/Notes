---
title: Preventing documentation drift in AI-assisted changes
description: Tie generated documentation to authoritative code and verify examples and operational claims with repeatable checks.
type: guide
tags:
  - ai
  - reliability
  - ci-cd
created: 2026-10-26
modified: 2026-11-24
draft: false
---

## Documentation is a maintained interface

Generated explanations and examples can become stale as quickly as handwritten prose. An agent may describe a default that no longer exists, invent a flag, copy behavior from another version, or confidently turn an assumption into an operational instruction. The goal is not to forbid AI drafting; it is to preserve a traceable relationship between documentation and the behavior it describes.

Classify content before editing: API reference, configuration example, architecture overview, onboarding guide, runbook, or decision record. Each has a different source of truth and risk. A command that deletes data or changes access requires stronger verification than a high-level conceptual introduction. For operational procedures, verify each step against the current system and documentation before relying on it.

## Documentation workflow

1. **Identify the owner and canonical source.** Link API docs to the schema or implementation; link runbooks to maintained operational systems and named owners; link architecture claims to reviewed decisions. Do not create a second source of truth without explaining how it stays synchronized.
2. **Ask for a claim map.** For substantive edits, have the draft identify each version-sensitive claim and its supporting file, command, or official external documentation. Treat that map as a review aid, not as evidence by itself.
3. **Verify examples mechanically.** Run code examples, configuration validation, link checks, and schema generation where the repository supports them. Pin the runtime and tool versions for executable examples. A snippet copied from a model's answer is not a test result.
4. **Review context and version.** Confirm the documented product, command, flags, defaults, and supported versions. For vendor docs, link the exact official page and note that provider behavior can change. Avoid statements such as “always” or “guaranteed” unless the source supports them.
5. **Use ownership and change triggers.** Assign documentation owners for procedures with operational risk. Couple relevant docs to code owners or the change process that modifies the underlying API, schema, or configuration.
6. **Automate drift detection.** Generate reference material from schemas where possible; fail CI when generated docs differ; validate links and examples. Treat generated output as derived and review changes to the source generator or templates separately.
7. **Close the loop.** Review the rendered page, not just markdown, and record any intentionally unverified assumptions. Schedule revalidation when a provider version, service contract, or operational procedure changes.

Repository instruction files can help agents find the right docs, but they do not make the docs correct. See [[repository-context-packaging-for-coding-agents]] for ways to provide source paths and distinguish policy from examples.

## Worked example: a claim map and a drift gate

A claim map for a short change to a runbook, kept in the merge request description:

| Claim in the draft                                | Source of truth                       | Checked by                |
| ------------------------------------------------- | ------------------------------------- | ------------------------- |
| `--timeout` defaults to 30 seconds                | `cmd/flags.go` at the merged commit   | Reviewer read the code    |
| The restore step needs the `backup-operator` role | IAM module in the infrastructure repo | Owner confirmed in review |
| The example config validates                      | `docs/examples/restore.yaml`          | CI job `docs-examples`    |

For generated reference pages, regenerate in CI and fail when the committed copy differs. This sketch was not run; the generator script and paths are yours to replace.

```yaml title=".gitlab-ci.yml"
docs-drift:
  stage: test
  image: registry.example.com/ci/docs-toolbox@sha256:<digest> # change: an image with your doc generator, pinned by digest
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      changes:
        - api/**/*
        - docs/reference/**/*
        - scripts/gen-reference-docs.sh
  script:
    - ./scripts/gen-reference-docs.sh docs/reference
    - |
      if [ -n "$(git status --porcelain -- docs/reference)" ]; then
        git status --porcelain -- docs/reference
        echo "docs/reference is out of date: run scripts/gen-reference-docs.sh and commit the result" >&2
        exit 1
      fi
```

`git status --porcelain` also catches new files that the generator created and nobody committed, which `git diff --exit-code` misses.

## Failure modes and response

**Silent drift:** a runbook's command changes behavior after a tool upgrade. **Version blending:** the draft combines current syntax with obsolete defaults. **Circular validation:** an example is generated from the same incorrect description that it is meant to validate. **Link rot:** a redirect or deleted page hides a changed product contract. **Overconfident summaries:** a caveat about eligibility or retention disappears from a short explanation.

Minimize these risks by maintaining local examples against pinned versions and rechecking external claims when they materially affect architecture, security, or cost. If a link redirects, inspect the destination and cite its canonical URL, not a stale path. Mark the date and version when discussing a provider's mutable behavior. This is especially important for retention, data use, model capabilities, pricing, and preview features.

If an agent proposes a documentation-only change that conflicts with observed code or official docs, do not update the prose to match the draft. Resolve the product behavior with the owner and update source code or documentation accordingly. If an operational instruction may have caused harm, preserve the prior version and use the incident process rather than quietly editing away the evidence.

## Decision checklist

- Is each significant claim tied to a named source of truth?
- Are commands, code snippets, configuration, and links verified?
- Are product/version and provider-specific details scoped and dated?
- Is the documentation owner clear, with a change trigger for relevant code?
- Does CI validate generated docs and runnable examples where practical?
- Have high-risk instructions received an operational owner review?
- Are known uncertainties explicit rather than smoothed over?

For low-risk conceptual prose, normal peer review may suffice. For security, data retention, deployment, or incident procedures, require verification against the current system and owner approval before publishing.

## Related

- [[repository-context-packaging-for-coding-agents]]: source paths and instruction files for agents.
- [[agent-done-criteria-and-verification]]: verification evidence in agent reports.

## Sources

- [NIST SP 800-218, Secure Software Development Framework (SSDF) Version 1.1](https://csrc.nist.gov/pubs/sp/800/218/final): review and verification practices for software artifacts.
