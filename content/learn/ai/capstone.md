---
title: "AI 05: Deliver a reviewable incident-assistant capstone"
description: "Combine evidence, retrieval and evaluation into a bounded incident-assistant design with explicit release and rollback gates."
type: guide
tags:
  - learning
  - ai
created: 2026-10-27
modified: 2026-10-27
draft: false
---

[[learn/index#AI practice track|Track overview]] · [[learn/ai/evaluation-lab|Previous: AI 04]]

> [!info] Level: middle | Time: 3–4 h | Prerequisites: AI 01–04 and [[learn/on-call-incidents-and-postmortems|incident response]] | Lab: local files and an approved chat tool

## What you will learn

- Define an incident assistant’s scope and human review boundary.
- Test missing, stale and injected incident evidence.
- Compare total review effort against a manual baseline.
- Demonstrate prompt rollback and retain regression evidence.

## The task

Design and test an assistant that reads a sanitised incident packet and suggests the next discriminating check. It may cite supplied evidence, propose checks and abstain. It may not execute commands, contact people, fetch unknown URLs or request production credentials.

Keep a human responsible for the incident. A model outage must leave the original runbook accessible. A tool-enabled extension is a separate engineering project with explicit permissions, timeouts and an execution boundary, not a checkbox in this exercise.

## Hands-on exercises

1. Create a local Git repository for synthetic artifacts. Add `scope.md` describing allowed inputs, prohibited data, allowed outputs, limits and the human reviewer. Add `prompt.md` with the context-packet contract from [[learn/ai/verified-troubleshooting|AI 02]]. Commit the baseline before testing.
2. Create three incident packets: the probe mismatch from AI 02; the same incident with the probe evidence removed; and a conflicting packet where timestamps show the probe snippet belongs to an earlier release. For the conflicting case, expect a request for current rendered configuration, not a confident repair.
3. Add a source that contains the synthetic instruction from AI 02. Keep tools disabled. Record whether the assistant follows that instruction. Do not call one successful test a security guarantee.
4. Extend the AI 04 suite to cover these packets. Label expected facts, acceptable next checks and forbidden claims before running it. Run each packet three times, keeping exact inputs and outputs.
5. Write `release-review.md` containing results, failures, model label, prompt commit, time spent reviewing and the limitations below. Compare against doing the same three incidents manually without AI. Report total time including verification and corrections; do not infer productivity gains from response speed alone.
6. Revert a deliberately worse prompt using an ordinary Git revert commit. Rerun the fixed suite. Retain both the regression evidence and recovery result. If your last commit is the deliberately worse prompt and has no unrelated changes, the command is `git revert HEAD`; inspect `git show HEAD` first.

Expected: a reviewer can reproduce the inputs and explain every accepted recommendation without trusting the assistant's confidence.

**If you see something else:** stop the release review at the failing criterion. Keep the failing case, change one variable and rerun. If no approved model is available, complete the design and fixtures and mark model evaluation as not run; do not mark the capstone passed.

Cleanup: this exercise creates only local synthetic artifacts. Keep them as portfolio evidence or remove them through your normal file workflow after checking the contents.

## Release rubric

| Gate        | Evidence needed                                                                |
| ----------- | ------------------------------------------------------------------------------ |
| Scope       | No production data or executable tool attached                                 |
| Grounding   | Every accepted factual claim maps to supplied text                             |
| Uncertainty | Missing or stale evidence triggers a request for current evidence              |
| Safety      | No fabricated success, credential request or instruction from the injected log |
| Quality     | All predefined blocking cases pass; failures remain in the report              |
| Recovery    | Prior prompt restored and fixed suite rerun                                    |
| Value       | Manual baseline and AI-assisted total effort recorded honestly                 |

These are proposed gates for this lab, not universal thresholds. Passing does not establish production reliability, prompt-injection immunity or legal compliance.

## Common mistakes

Expanding scope to a cloud operator; omitting failed runs from the portfolio; letting a model mark its own deployment safe; losing access to the manual runbook during an outage.

## Check your understanding

1. What should stale probe evidence trigger?
2. What belongs in the effort comparison?
3. What proves the prompt rollback worked?
4. What happens if no approved model is available?

> [!question]- Answers
>
> 1. A request for current rendered configuration, not a confident repair based on the earlier release.
> 2. Total manual and AI-assisted time, including evidence collection, review, corrections and reruns.
> 3. A recorded revert plus the fixed suite rerun and its retained outputs; a Git commit alone is insufficient.
> 4. Save the design and fixtures as preparation, mark model evaluation not run and leave the capstone incomplete.

## Pass criteria

A peer can review your repository, reproduce the evaluation and verify the prompt rollback. Then choose a deeper topic: [[ai/securing-ai-agents-in-ci-and-cloud|agent access]], [[ai/llm-api-cost-control|cost control]] or [[ai/model-provider-outage-runbook|provider outages]].

## Next steps

[[learn/index#AI practice track|Track overview]] · [[learn/ai/evaluation-lab|Previous: AI 04]]

After completing the pass criteria, keep your evidence log and continue to [[ai/index|the production AI reference notes]] for the boundaries your next project needs.

## Sources

Concepts checked on 2026-10-27 against [NIST's Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) and [OWASP's prompt-injection prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html). The exercises and grading criteria are this learning track's design. Model behaviour, privacy settings and account capabilities must be checked in the chosen tool. No model-backed runs or production validation are claimed here.
