---
title: Quality gates for AI-assisted test generation
description: A reviewable workflow for turning generated tests into useful evidence without treating coverage as correctness.
type: guide
tags:
  - ai
  - ci-cd
  - reliability
  - security
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Start with a testable claim

AI can accelerate test authoring, but a plausible test is not proof that the implementation is correct. Start by stating the behavior to protect in observable terms: inputs, expected outputs, side effects, and important rejected cases. Ask for a test plan before code when the behavior is ambiguous. Compare that plan with the requirement, issue, contract, or incident evidence; do not let the model silently decide what the product ought to do.

Use generated tests to expand a human-reviewed specification, not to manufacture a specification from the implementation. Tests that merely mirror current code can preserve a defect. For a change to a parser, for example, define valid and invalid inputs independently of the proposed parser logic. For authorization behavior, enumerate actor, action, and resource combinations before accepting examples.

This complements [[ai-generated-code-policy-and-provenance]]: provenance and accountability apply to tests too, even when test files do not ship in production. It is distinct from [[ai-code-review-bots]], which concerns automated review comments rather than the correctness of a test suite.

## A controlled generation workflow

1. **Constrain the change.** Give the assistant the relevant interface, requirement, existing test conventions, and non-sensitive fixtures. Specify the target files and ask it not to alter production code unless separately requested. Keep unrelated modules and secrets out of the prompt.
2. **Request cases before implementation.** Ask for normal, boundary, invalid, permission-denied, and failure-path cases as applicable. A short table of input and expected outcome is easier to review than a large unexplained patch.
3. **Review each assertion.** Confirm that assertions encode the intended contract, not a guessed implementation detail. Prefer public behavior over private method calls. Check that a test would fail for a representative defect and pass for the intended behavior.
4. **Run the ordinary suite and quality checks.** Use the repository's pinned test command, formatter, type checker, and lint rules. The CI job should run in the same trusted pipeline as peer-authored tests. Do not make generation a required privileged job that can publish or deploy.
5. **Inspect test signal.** Review coverage changes as a clue, not a score to maximize. For high-risk logic, consider mutation testing, property-based tests, contract tests, or a second independent set of edge cases. These methods can reveal weak assertions but do not replace domain review.
6. **Keep review ownership clear.** The author remains responsible for understanding every assertion. Require an independent reviewer for tests that protect security boundaries, data integrity, billing, or destructive operations.

Tests should be deterministic and isolated. Use fixed clocks, seeded randomness, controlled network responses, and temporary test databases where the existing framework supports them. Do not copy production credentials, customer data, or live endpoints into prompts or fixtures. A generated integration test that reaches real services may incur cost or mutate state; fake the boundary unless live behavior is explicitly needed and isolated.

## Gates and failure modes

Coverage percentage alone is a poor acceptance gate: generated tests can execute lines without asserting meaningful outcomes. A test may pass because the mock reproduces the same mistake, because it never reaches the disputed branch, or because it checks only that no exception occurred. Conversely, brittle snapshot tests can fail harmless changes and encourage reviewers to accept updates mechanically.

Use gates that match the repository: all tests pass; no new test is skipped or weakened without explanation; added assertions identify the behavior they protect; fixtures contain no secrets; and flaky tests are quarantined only through the normal owner-reviewed process. For critical paths, record what defect class a test is intended to catch. If a generator changes an expected output, require the author to justify the behavior change against an authoritative requirement.

Common failure modes include hallucinated test APIs, stale framework conventions, invalid mocks, excessive test duplication, hidden dependency on execution order, and tests that encode a defect as expected behavior. Treat unfamiliar imports and magic helper functions as untrusted until confirmed in the project. If the suite fails, distinguish a real regression from environment or fixture problems; do not let an assistant repeatedly weaken assertions just to obtain green CI. A green result is evidence only for the tests that actually ran.

## Decision checklist

- Is the requirement independently stated and are acceptance cases traceable to it?
- Are generated imports, fixtures, mocks, and framework APIs real and compatible with pinned versions?
- Does each test assert observable outcomes, including important negative cases?
- Can a representative regression make the test fail?
- Are timing, randomness, external services, and data isolated?
- Did the standard suite, static checks, and any relevant mutation or contract checks run?
- Has a human author reviewed the test and retained ownership of its maintenance?

If any answer is no, revise or discard the test rather than lowering the gate. For a low-impact unit test, normal peer review may suffice. For access control or irreversible data operations, require domain-owner review and explicit evidence in the change description.

## Related

- [Owner’s AI skills catalogue](https://ai.szolotov.com).

## Sources

- [pytest documentation](https://docs.pytest.org/en/stable/): test collection and execution conventions; check the project's pinned pytest version before adopting APIs.
- [NIST SP 800-218, Secure Software Development Framework (SSDF) Version 1.1](https://csrc.nist.gov/pubs/sp/800/218/final): software verification and review practices; guidance, not a test-specific certification.
- [GitHub Docs: Responsible use of GitHub Copilot features](https://docs.github.com/en/copilot/responsible-use): human review and validation responsibilities for generated suggestions.
