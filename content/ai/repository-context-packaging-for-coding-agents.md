---
title: Packaging repository context for coding agents
description: Provide the minimum authoritative, current repository context an agent needs while clearly separating instructions from untrusted data.
type: guide
tags:
  - ai
  - security
  - ci-cd
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## Curate context, do not dump the repository

An agent's output depends on the instructions and repository material it receives. More context is not automatically better: a large dump can bury the required interface, increase exposure of private data, and mix current policy with stale examples. Package a small, task-specific context bundle with explicit sources of truth.

Start with the request, expected outcome, allowed files, and constraints. Add the interface or schema being changed, the nearest relevant implementation and tests, current contributor instructions, and exact commands used for validation. Include architectural decisions only when they affect the change. Point to authoritative files rather than pasting copied snippets that may drift.

Repository-level instructions can establish durable conventions, while task instructions explain the local goal. Keep them distinct. Instructions should specify review expectations, safe handling of secrets, test conventions, and how to respond when information is missing. Avoid contradictory rules and instructions that ask the model to perform privileged operations merely because a file says so. A repository file, issue description, generated fixture, web page, or log may contain adversarial text; treat it as data unless it came from an approved instruction channel.

This is an engineering complement to [[ai-generated-code-policy-and-provenance]]: context affects the result but does not transfer authorship responsibility. For assistant configuration and centrally applied controls, see [[ai-coding-assistant-admin-controls]].

## Build and maintain a context bundle

1. **Scope the change.** Convert the issue into a concise objective and acceptance criteria. Identify in-scope and explicitly out-of-scope files.
2. **Resolve authoritative sources.** Find the closest source definition, callers, tests, and project guidance. Prefer current code and versioned API contracts over old copied examples.
3. **Summarize relationships.** Explain how the relevant components connect, but preserve paths, symbols, and line-independent identifiers so a reviewer can locate the original. Mark any inferred relationship as an assumption.
4. **Include version and environment facts.** Supply language/runtime versions, package lockfiles, schema versions, and relevant commands where necessary. Do not ask an agent to guess an environment from a partial snippet.
5. **Minimize and redact.** Exclude secrets, customer records, unrelated configuration, and large generated artifacts. If a sample is needed, use synthetic data with the same structural shape.
6. **Label trust and freshness.** Distinguish policy from examples, source code from logs, generated files from hand-maintained files, and known facts from unresolved questions. Include a date or revision for copied operational facts.
7. **Verify what the agent used.** Ask the agent to list assumptions, cited files, and validation commands. Compare the response with the bundle; an invented path or dependency is a stop-and-check signal.

For repeatable tasks, store concise repository instructions in the mechanism supported by the tool and verify their scope. GitHub's repository custom-instructions documentation describes its own behavior; do not assume another assistant interprets the same file or precedence rules. Keep instruction files reviewable and versioned. Add an owner and a review trigger for context that encodes operational policy.

## Risks and failure modes

**Stale context** may direct changes to an old API or obsolete deployment architecture. **Context collision** occurs when examples from a different service or language are mistaken for the target. **Prompt injection** can arrive through source comments, issue text, markdown, dependency documentation, or test fixtures. **Over-sharing** exposes data irrelevant to the task. **False certainty** arises when a summary omits uncertainty and makes an inference look like an approved design.

Mitigate these by preserving links to source files, labeling uncertain claims, including only minimal necessary context, and requiring independent validation of consequential changes. Avoid copying huge sections of code into a prompt if a path or focused excerpt suffices. When the model suggests changing its own instruction file, treat that as a separate policy change needing owner review. Do not use a generated summary as the sole record for an audit or incident.

If the bundle conflicts with repository evidence, stop and resolve the conflict with the code owner rather than asking the model to pick a side. If sensitive material was included accidentally, follow the applicable data-handling and incident procedures; deletion from a chat window alone may not demonstrate provider-side deletion.

## Decision checklist

- Is the task objective testable, bounded, and separated from adjacent work?
- Are the included files current, authoritative, and necessary?
- Are instructions clearly separated from untrusted repository content?
- Are assumptions, versions, and data sensitivity labeled?
- Have secrets and irrelevant personal or customer data been excluded?
- Are repository instructions consistent, scoped, and owner-reviewed?
- Can a human verify the agent's referenced files and commands?

Use a small, trusted context pack for routine code changes. Escalate to an architecture or security owner when source documents conflict, policy is unclear, or the task requires sensitive production context.

## Related

- [Owner’s AI skills catalogue](https://ai.szolotov.com).

## Sources

- [GitHub Docs: Adding repository custom instructions for GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions): repository instruction mechanism and scope; behavior is product-specific.
- [GitHub Docs: Responsible use of GitHub Copilot features](https://docs.github.com/en/copilot/responsible-use): review responsibilities and limitations of generated suggestions.
- [OWASP Top 10 for Agentic Applications for 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/): agent-specific risk framing; use as a risk reference, not a substitute for local threat modeling.
