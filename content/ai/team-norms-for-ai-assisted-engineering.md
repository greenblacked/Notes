---
title: Team norms for AI-assisted engineering
description: A team working agreement for AI assistants - author ownership, review disclosure, what never to paste, review load, junior learning and pairing.
type: pattern
tags:
  - ai
  - team-process
  - security
  - delivery
created: 2026-10-27
modified: 2026-10-27
draft: false
---

This note is a short working agreement that a platform or DevOps team can adopt for day-to-day use of AI assistants and coding agents: who owns generated code, what reviewers are told, what must never be pasted into a tool, how review load is shared, how junior engineers keep learning, how to pair with an assistant and when to revisit the rules. It is for senior engineers and team leads. It does not cover technical enforcement of agent permissions ([[agent-tool-authorization-boundaries]], [[coding-agent-permission-allowlists]]), the organisation-level code policy ([[ai-generated-code-policy-and-provenance]]) or how to introduce tools in the first place ([[rolling-out-ai-tools-in-a-team]]).

> [!note] Not verified
> The sources were found through search on 2026-10-27, but the pages could not be fetched, so nothing here is checked against them. Check before relying on it: the GitLab handbook wording on sanctioned tools and confidential data, the scope of NIST SP 800-218A (it addresses AI model producers, AI system producers and AI system acquirers, not day-to-day engineers), and any vendor's current data-retention and training terms. No specific tool or vendor is endorsed here.

## Write it down, keep it short

Norms that live in people's heads drift. Put the agreement in the repository (for example `docs/ai-working-agreement.md`), keep it to one page, and link it from the PR template and the onboarding checklist. Each rule should say who it binds and what a violation looks like. Rules that cannot be observed in a review or an audit are wishes, so prefer ones a reviewer can check.

## The author owns every line

A change produced with an assistant is the submitter's change. The person who opens the PR must be able to explain every line, the failure modes and the rollback path. "The model wrote it" is not an answer in review, and it is not a defence in a postmortem.

Practical consequences:

- The author reads the full diff before requesting review, as if a stranger had written it.
- The author ran the tests and the linters, and says so, instead of relying on the assistant's claim that they pass ([[agent-done-criteria-and-verification]]).
- Generated infrastructure code gets the same gates as hand-written code: plan review, policy checks and a diff read ([[validating-ai-generated-infrastructure-code]], [[llm-assisted-terraform-plan-review]]).
- A reviewer may reject a change the author cannot explain, without judging the code itself.

## Disclosure in reviews

Reviewers need a signal to decide how deeply to look. They do not need a transcript. A light-touch PR template does the job:

```markdown
## AI assistance

- [ ] No AI assistance used
- [ ] Assisted: drafted code / tests / docs / commit message (delete what does not apply)
- Tool: <name, as the team lists it>
- Author verification: <what you ran or read yourself>
- Areas I am least sure of: <files or functions>
```

Agree on these points explicitly:

- **Disclosure is expected, not punished.** If people fear a penalty, they will hide use, and the signal is lost. Do not use disclosure to rank engineers.
- **Ask for the plan, not the chat log.** A reviewer may ask for the task spec or the plan the agent worked from ([[plan-first-agent-workflows]]). Full transcripts can hold secrets and internal context, so handle them as sensitive by default ([[agent-session-transcript-handling]]).
- **Disclosure and git attribution are separate questions.** Whether commit trailers or tool footers appear in history is a policy choice; decide it once and apply it consistently ([[tooling-attribution-in-git-history]]).
- **Do not hide assistance to dodge a norm.** Stripping markers to avoid extra scrutiny breaks the agreement and should be treated as a conduct issue, not a tooling one.

## What never goes into a tool

Per the GitLab handbook's AI guidance, prefer the team's sanctioned tool and keep confidential customer data out of external tools; verify its current wording. Make the list concrete so people do not have to guess:

| Never paste                                                     | Why                                           |
| --------------------------------------------------------------- | --------------------------------------------- |
| Credentials, tokens, private keys, kubeconfigs                  | They persist in logs, history and transcripts |
| Unredacted customer data and production logs with personal data | Disclosure and data-protection exposure       |
| Findings for unreleased vulnerabilities                         | Premature disclosure                          |
| Secret-store paths and layouts                                  | Maps targets for an attacker                  |
| Internal architecture documents marked restricted               | Contract and confidentiality terms            |

Mitigations beyond "be careful":

- Use only tools the team has listed, on the plan and settings the team approved. Data-use and retention terms depend on plan and settings and change over time; verify each vendor's current terms before writing them into policy ([[model-data-use-contract-review]], [[ai-coding-assistant-admin-controls]]).
- Redact before the call, in code, not by hand ([[redacting-sensitive-data-before-llm-calls]]).
- Run secret scanning on commits and in CI as a backstop for what slips through ([[secret-scanning-pre-commit-and-ci]]).
- If something sensitive was pasted anyway, treat it as an exposure: rotate the credential, record it, tell the owner. No blame, quick action.

The OWASP Top 10 for LLM Applications lists sensitive information disclosure as a risk class; cite the edition when you reference its numbering, because entries were renumbered between editions.

## Review load is a fairness issue

Assistants make large diffs cheap to produce and leave the cost with reviewers. Without an agreement, the engineers who review most (often the seniors) absorb a hidden tax.

- **Size norm.** Set a soft limit on diff size and split larger agent output into slices a person can review in one sitting ([[agent-pull-request-size-and-reviewability]]).
- **Pre-review by the author.** Authors who generate a large change review it themselves first and annotate the risky parts in the PR description.
- **Count review work.** Track review time and queue wait per person, not only PR count. If one or two people carry most of the review load, rotate. [[measuring-ai-impact-on-delivery]] covers metrics that expose this, and [[on-call-health]] is a reminder that load imbalances become people problems.
- **Allow a "too big" decline.** A reviewer can bounce a change for size without being asked to justify it line by line.
- **Do not review by bot alone.** Automated reviewers help as a first pass, but a human stays accountable ([[ai-code-review-bots]]).

## Junior engineers keep learning

Seniors tend to use assistants to go faster. Juniors can use them to skip the struggle where skill forms. Agree on protections:

- Some tasks per sprint are done unassisted, or with the assistant set to explain rather than write.
- In pairing and review, check understanding, not just output: ask the author to explain a function, predict a failure, or walk through the rollback.
- Seniors do not use assistant answers as a replacement for mentoring; the review comment should teach, not just fix.
- Juniors can say "I do not understand this generated code" and get time to work through it, without it counting against them.
- Rotate who owns the tricky areas so knowledge does not live only in prompts ([[bus-factor-and-knowledge-transfer]], [[onboarding-engineers]]).

## Pairing etiquette with an assistant

When two people and an assistant work together, ambiguity about who is acting causes incidents.

- Say aloud who is driving: the human, or the agent under supervision.
- The human still approves or types each command in prod-adjacent shells; the driver says what the agent is about to run before it runs ([[safe-shell-command-generation-for-agents]]).
- Keep agent output with secrets off shared screens and recordings. Start the session in a clean environment with the minimum credentials ([[just-in-time-agent-credentials]]).
- The navigator may veto an agent action for any reason. Disagreement about the agent is settled by reading the diff, not by arguing about the model.
- Agree who writes up the result: a summary in the PR that states what the agent did and what the humans checked.

## Revisit the norms

Treat the agreement as a living document.

- Review it each quarter, and after a tool change, a security incident or a near miss.
- Use data: incident reviews, review-queue times, rework and rejected-PR counts, not anecdotes ([[incident-review-programme]]).
- Make changes in a PR to the agreement itself, with an owner and a date for the next review.
- Retire rules nobody follows or can check; keep fewer, better ones.

## Failure modes

- **Rubber-stamp reviews.** Reviewers assume the author checked because the code looks tidy. Fluent code hides subtle errors; require the author's verification note.
- **Disclosure as theatre.** The checkbox is ticked automatically and carries no information. Sample PRs to check it matches reality.
- **Hidden use.** People stop disclosing because they fear scrutiny. Fix the culture, not the form.
- **Reviewer burnout.** Large agent PRs pile onto two people. Watch queue time per reviewer.
- **Skill atrophy.** Juniors cannot debug without the assistant. Protect unassisted practice.
- **Sensitive paste.** A production log with personal data goes into an external tool. Redaction and a sanctioned-tool list reduce it; detection and rotation handle the rest.
- **Norm drift.** The document says one thing and the team does another. Review it on a schedule.
- **Over-reading standards.** Treating NIST SP 800-218A as an engineer-level rulebook; it addresses AI model and system producers and acquirers.

## Review checklist

- [ ] The working agreement is in the repository, one page, linked from the PR template and onboarding.
- [ ] The PR template asks for AI assistance, the author's verification and the least-sure areas.
- [ ] The team has a list of sanctioned tools with plan and settings checked against current vendor terms.
- [ ] A "never paste" list exists, with redaction and secret scanning behind it.
- [ ] A pasted-secret procedure exists: rotate, record, notify, no blame.
- [ ] A diff size norm exists and reviewers may decline oversized changes.
- [ ] Review time per person is tracked and the rotation is adjusted.
- [ ] Juniors have protected unassisted tasks and reviews check understanding.
- [ ] Pairing rules say who drives and who approves commands in prod-adjacent shells.
- [ ] Git attribution policy is decided once ([[tooling-attribution-in-git-history]]).
- [ ] A quarterly review is scheduled, with an owner and data inputs.

## Sources

- [GitLab Developer Experience handbook, AI section](https://handbook.gitlab.com/handbook/engineering/infrastructure-platforms/developer-experience/ai) - a published example of norms: prefer the sanctioned tool, keep human review on AI-generated code, keep confidential customer data out of external tools.
- [NIST SP 800-218A](https://csrc.nist.gov/pubs/sp/800/218/a/final) - an SSDF community profile for generative AI and dual-use foundation models, aimed at AI model producers, AI system producers and AI system acquirers; background for producer and acquirer framing, not a rule for engineers using an assistant.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
