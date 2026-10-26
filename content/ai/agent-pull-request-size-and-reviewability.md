---
title: Pull request size and reviewability for agent changes
description: Bound agent-authored pull requests so reviewers can understand intent, validate evidence, and reject unsafe scope expansion.
type: guide
tags:
  - ai
  - team-process
  - ci-cd
  - delivery
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Reviewability is a safety property

A pull request is useful only when reviewers can understand what changed and why. Agents can produce large diffs quickly, which can create an illusion of progress while transferring hidden verification cost to maintainers. Size alone does not determine risk: a one-line privilege change can be more consequential than a generated API client update. The goal is a bounded, coherent change with enough evidence for an informed decision.

Before work begins, define a reviewable unit: one outcome, a file or subsystem boundary, acceptance criteria, and explicit exclusions. Ask the agent to report intended files and uncertainties before it modifies more than the initial scope. A new requirement discovered mid-task should be surfaced and approved or split into another change, not silently absorbed.

This complements [[ai-code-review-bots]]: automated comments can help surface issues but do not reduce the author's obligation to produce a clear diff. Generated code policy remains covered by [[ai-generated-code-policy-and-provenance]].

## Pull request workflow

1. **Set a scope budget.** Agree on the objective and likely files before generation. A line count can be a prompt to split or add explanation, not a universal pass/fail rule.
2. **Separate concerns.** Keep behavior changes, generated artifacts, mechanical formatting, dependency upgrades, and migrations separate when possible. If they must be combined, explain the dependency and provide a review order.
3. **Require a factual summary.** The PR description should state user-visible intent, key design decisions, files or layers changed, validation actually run, known limitations, and recovery considerations. Do not copy an unverified model-generated summary.
4. **Expose generated boundaries.** Identify generated files, their source schema, generator version, and reproducible command. Ensure the diff shows the real source change as well as regenerated output.
5. **Use staged review.** Review requirements and design first, then implementation, then tests and operational consequences. For large mechanical output, use a validated generation check to reduce repetitive inspection while retaining human review of inputs and representative output.
6. **Apply ownership rules.** Route security, data, infrastructure, and API changes to appropriate owners. Required reviews and checks should be enforced by repository settings rather than relying on agent instructions.
7. **Split when comprehension degrades.** If reviewers cannot explain the purpose and risk of each component, divide the change into dependent pull requests or smaller commits while keeping dependency order explicit. Do not split in a way that makes an unsafe intermediate state mergeable.

State what has not been verified. A list of test names is not enough: say whether the tests ran, the environment used, and any known gaps. For high-impact changes, include rollback or forward-recovery notes and operational owners.

## Failure modes

**Diff flooding** occurs when generated formatting or regenerated files hide a small risky source change. **Scope laundering** occurs when an agent includes unrelated changes under the original issue. **Summary substitution** happens when reviewers trust a polished description rather than inspect the diff. **False green** occurs when checks are missing, skipped, or run on a different revision. **Review splitting** can create unsafe intermediate states if each PR does not preserve compatibility.

Mitigate these by checking changed-file lists, comparing generated artifacts to their source, confirming the tested commit SHA, and using path ownership. Ask the author to split or explain an unreviewable change; do not approve on the basis of the agent's status message. If CI lacks a reliable guard for a high-risk change, require an explicit manual owner check until the guard exists.

No single PR size threshold is appropriate for every repository or change type. Large changes may be justified by a mechanical regeneration or a necessary coordinated migration, but require validation that reduces the portion of repetitive code reviewers must inspect. Risk, coupling, and reviewer comprehension matter more than raw lines.

## Decision checklist

- Is the change one coherent outcome, with in/out-of-scope boundaries?
- Can a reviewer map requirements to changed files and tests?
- Are generated or mechanical changes reproducible and clearly labeled?
- Are validation claims tied to the exact commit and actual results?
- Are domain owners, required checks, and review policies applied?
- Are known limitations, unverified behavior, and recovery steps explicit?
- Would splitting improve comprehension without exposing an unsafe intermediate state?

If a reviewer cannot form a reliable view of impact, the right next step is a smaller change, clearer evidence, or a focused technical review—not a faster approval.

## Related

- [Owner’s AI skills catalogue](https://ai.szolotov.com).

## Sources

- [Google Engineering Practices: What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html): reviewer focus on design, functionality, complexity, tests, and clarity.
- [GitHub Docs: Pull requests](https://docs.github.com/en/pull-requests/reference/pull-requests): pull request review and change integration concepts.
- [GitHub Docs: About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches): required reviews and checks as repository-enforced controls.
