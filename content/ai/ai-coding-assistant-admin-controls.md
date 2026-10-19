---
title: "Admin controls for AI coding assistants: seats, data, telemetry and deny rules"
description: The settings a platform admin controls on AI coding assistants (seats, retention, telemetry, file deny rules, tool allowlists) and how to verify each one.
type: standard
tags:
  - ai
  - security
  - audit
  - team-process
created: 2026-10-19
modified: 2026-10-19
draft: false
---

A policy that says "do not feed secrets to AI assistants" is only as good as the settings that enforce it. This standard lists the controls a platform or security admin can set on AI coding assistants, who owns each one, and how to prove it works. It covers configuration. The policy about what code may be generated and how it is reviewed is in [[ai-generated-code-policy-and-provenance]].

> [!warning] Not legal or audit advice
> This note describes engineering controls. Whether a setting satisfies a contract, a data processing agreement or an audit requirement is for your legal, privacy and audit people to decide.

> [!info] Scope
> Written for organisation-managed use of coding assistants in IDEs, CLIs and CI. It names no vendor values on purpose. Retention periods, training use of your data, regions and telemetry options differ by vendor and plan and change over time. Read the vendor's current trust, privacy and admin pages at every renewal, and record the date you read them.

> [!note] Not verified
> Not checked against any product. Setting names, file locations and precedence rules vary and move; the vendor pages under Sources may have changed paths. Everything here is a checklist of questions to answer from the current documentation, plus the verification method.

## Control inventory

Use this table as the register. Each row needs an owner, the current value, the date you checked it, and a link to the evidence.

| Control                    | What to decide                                       | Owner                 |
| -------------------------- | ---------------------------------------------------- | --------------------- |
| Seat assignment            | Who gets a licence, through which group              | Platform admin        |
| Identity                   | SSO required, SCIM provisioning and deprovisioning   | Identity admin        |
| Data retention             | How long prompts and outputs are kept by the vendor  | Security and privacy  |
| Training use               | Whether your data may be used to train models        | Security and privacy  |
| Region and sub-processors  | Where data is processed and by whom                  | Privacy               |
| Telemetry                  | What usage data leaves the machine, and where        | Platform admin        |
| Managed settings           | Settings users cannot override                       | Platform admin        |
| File access deny rules     | Paths the assistant must not read                    | Security              |
| Tool, plugin and MCP lists | Which extensions, servers and commands are allowed   | Platform and security |
| Audit logs                 | Whether admin and usage events are exported and kept | Security              |
| Exceptions                 | Who may deviate, until when                          | Security              |

## Seats and licences

Seats are an access-control problem, not a purchasing detail.

- **SSO only.** Seats are granted to identities from your identity provider, not to personal accounts. A personal account used for work code has none of your retention or training terms.
- **Group-driven assignment.** One group per tier (for example `ai-assistants-standard`). Membership changes go through the same approval as other access.
- **SCIM or an equivalent sync** where the vendor supports it, so removal in the identity provider removes the seat.
- **Offboarding.** Seat removal is a step in the leaver checklist. Include it in the periodic access review ([[access-reviews-gcp-and-gke]]) and keep the review export as evidence.
- **Idle reclaim.** Review seats with no recent activity on a schedule you set, and ask the holder before removing. This is a cost control as much as a security one.

## Data: retention, training use, region, telemetry

Do not copy numbers from this note or from memory. For each tool and plan, read the current terms and write down, with the date and the URL:

1. What prompt and output data the vendor stores, and for how long.
2. Whether prompts, code or outputs may be used for training, and how that is switched off for your organisation.
3. Where processing happens and the list of sub-processors.
4. What telemetry the client sends, whether it can be disabled, and whether code snippets are in it.
5. How to request deletion and how long it takes.

Then decide the data classes allowed per tool: for example "internal source code: yes; customer data: no; secrets: never". Put the decision next to the licence in the register, and put the plan name on it, because terms differ between plans. If the vendor changes terms, treat it as a change request and re-run the review. Whether a given term is acceptable for personal data is a privacy question for your DPO or counsel.

## Managed settings and file deny rules

Most assistants read settings from several levels: user, project and organisation. Use the organisation level for anything that is a control and make it non-overridable where the product supports that. Check in the vendor's current documentation how precedence works and which file or console holds the managed policy.

Deny reads of files that commonly hold secrets:

```text title="deny-patterns (concept; syntax differs by tool)"
.env
.env.*
*.tfvars
*.tfstate
*.tfstate.backup
*.pem
*.key
**/secrets/**
**/.kube/config
kubeconfig*
```

Four points that apply whatever the syntax is:

- A deny rule on reads does not stop the assistant from running a shell command that reads the file. Deny the commands, or run the assistant without a shell, or both.
- Rules based on path patterns miss files with unexpected names. Back them with secret scanning on commits and in CI ([[secret-scanning-pre-commit-and-ci]]).
- Keep real secrets out of workspaces entirely. Use a secrets manager and short-lived credentials so there is nothing to deny.
- A project-level file can be changed by whoever can merge to the project. Put the organisation floor where project authors cannot weaken it.

## Tool, plugin and MCP allowlists

Treat extensions and tool servers as third-party code that runs with the user's rights.

- The allowlist of extensions, plugins and servers lives in a repository with CODEOWNERS, so every addition is a reviewed change with a reason.
- Entries are pinned by version, and by digest where they are container images.
- Servers get read-only credentials by default; write access is a separate, justified entry.
- Commands the assistant may run without asking are an explicit short list. Anything that deletes, deploys, changes IAM or reaches the network starts as "ask".
- New entries get the same review as a new dependency ([[open-source-license-compliance]] covers the licence side).

For agents that run unattended in pipelines, the stricter rules in [[securing-ai-agents-in-ci-and-cloud]] apply; this note is about assistants used by people. Shared skill files and prompts follow [[agent-skills-and-shared-workflows]].

## Verification checklist

A control that has not been tested is a hope. For every row of the register, have a test user try to break it and capture the result as evidence.

| Control                    | Test                                                        | Evidence to keep                        |
| -------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| Seat via SSO only          | Try to sign in with a personal account on a managed machine | Screenshot or log of the refusal        |
| Deprovisioning             | Remove a test user from the group; check the seat is gone   | Admin console export with timestamps    |
| Training/retention opt-out | Read the admin setting and the plan terms                   | Page capture with date and URL          |
| Telemetry                  | Observe client traffic from a test machine                  | Proxy log listing destination hosts     |
| File deny rule             | Ask the assistant to open a `.env` file in a test repo      | Transcript showing the refusal          |
| Shell bypass               | Ask it to `cat` the same file                               | Transcript or the denied-command log    |
| Managed settings           | Try to override a managed setting as a user                 | Screenshot of the locked setting        |
| Allowlist                  | Try to add an unlisted server                               | Refusal message and the blocking config |
| Audit export               | Perform an action; find it in the exported log              | Log line with the correlation details   |

Run the checklist when you roll out, after every vendor change notice, and at least once a year. Store results with the rest of your control evidence ([[audit-evidence-collection-and-retention]]). Never use real secrets for the tests: create a canary file with a fake value.

## Exceptions and review cadence

Some teams will need a different setting, such as a repository where the assistant must read generated config. Handle that with the normal waiver process ([[policy-exception-and-waiver-process]]): a written reason, a named approver, compensating controls and an expiry date. No exception is open-ended. Keep a list of active exceptions in the register, and review it monthly.

Review the whole register at each renewal and whenever a vendor announces a terms, region or telemetry change. Put a dated reminder on the owner so the check does not depend on someone remembering. When a control fails verification, treat it like any other control failure: fix, re-test, record.

## Sources

- [GitHub Copilot documentation](https://docs.github.com/en/copilot): administration, data and privacy pages. Paths move; check the current ones.
- [Claude Code settings](https://docs.claude.com/en/docs/claude-code/settings): settings files, permissions and managed policy. This page may have moved; verify the address.
- [OWASP Top 10 for LLM applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/), OWASP.

## Related

- [[ai-generated-code-policy-and-provenance]]: the policy these settings enforce.
- [[securing-ai-agents-in-ci-and-cloud]]: stricter rules for unattended agents.
- [[agent-skills-and-shared-workflows]]: governing shared prompts and skills.
- [[access-reviews-gcp-and-gke]]: where seat reviews fit.
- [[policy-exception-and-waiver-process]]: how exceptions are approved and expire.
- [[open-source-license-compliance]]: licence questions about generated code and extensions.
- [[audit-evidence-collection-and-retention]]: keeping the verification results.
- [the owner's AI skills catalogue](https://ai.szolotov.com): reusable agent skills and workflows.
