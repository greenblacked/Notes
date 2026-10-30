---
title: Coding agent permission allowlists
description: Design per-repository and per-user allow, ask and deny rules for coding-agent shell, file, network and MCP tool use, and review and audit them over time.
type: pattern
tags:
  - ai
  - security
  - policy-as-code
  - audit
created: 2026-10-27
modified: 2026-10-30
draft: false
---

This note covers the allow, ask and deny rules a coding agent checks before it runs a shell command, touches a file or calls an MCP tool: scoping, precedence and wildcards, reviewing rule changes, and auditing auto-approvals. It is for engineers who own agent configuration in shared repositories. It does not cover OS-level isolation ([[sandboxing-coding-agents-on-workstations-and-runners]]), egress filtering ([[agent-network-egress-controls]]), hook scripts ([[deterministic-hooks-for-coding-agents]]), vetting a server before you trust it ([[third-party-mcp-server-vetting]]) or organisation-wide managed policy ([[ai-coding-assistant-admin-controls]]). The wider model of what an agent may be authorised to do is in [[agent-tool-authorization-boundaries]].

> [!note] Not verified
> The tool documentation in Sources was not re-checked line by line. Rule grammar, precedence, mode names and version gates differ between tools and releases. Check your tool's current docs for: settings precedence; whether a trailing wildcard matches the bare command; handling of compound commands and leading environment assignments; MCP rule syntax; and which file rules also cover shell commands.

## Principles

A permission rule list is an access policy, so apply the usual rules.

- **Least privilege.** Each allowed prefix needs a use case someone can name. Start from reads only and add entries from observed need, not from a broad "allow shell" grant.
- **Three outcomes.** `allow` for cheap, reversible commands, `ask` for actions that need a human glance (push, install, apply), and `deny` for actions an agent session should never take.
- **Deny wins, at least in some tools.** In the tool documented in Sources, evaluation runs deny, then ask, then allow, and the first match wins regardless of specificity, so a narrower allow cannot punch through a broad deny. Other systems pick the most specific rule, and Kubernetes RBAC has no deny rules at all; confirm the model your tool uses.
- **Rules are a filter, not a boundary.** Command-text rules cannot see what a program does after it starts. Pair them with a sandbox and egress control.

## Scopes and who owns what

Most tools layer settings from several places. A typical split:

| Scope               | Lives in                | Reviewed by       | Put here                                                          |
| ------------------- | ----------------------- | ----------------- | ----------------------------------------------------------------- |
| Organisation        | Managed policy          | Platform/security | Hard denies, bypass-style modes disabled, approved MCP servers    |
| Repository          | Committed settings file | Code review       | Build, test and lint commands for that repo; repo-specific denies |
| Developer, per repo | Gitignored local file   | Nobody            | Personal convenience only                                         |
| Developer, global   | Home-directory settings | Nobody            | Read-only utilities, editor-like tools                            |

Only the repository scope goes through a pull request. Keep the committed file small and boring, gitignore local files by default, and confirm the precedence order in the current docs. Path patterns may be anchored differently per scope, so a `secrets/**` rule in a user file may not mean the project's `secrets/` directory.

## Writing rules that mean what you think

An illustrative project file (the syntax is one tool's; check the current docs for yours):

```json title=".agent/settings.json"
{
  "permissions": {
    "allow": [
      "Bash(git status *)",
      "Bash(git diff *)",
      "Bash(git log *)",
      "Bash(npm run test *)",
      "Bash(npm run lint *)",
      "Read(src/**)"
    ],
    "ask": ["Bash(git push *)", "Bash(npm install *)", "Bash(terraform plan *)"],
    "deny": [
      "Bash(git push --force *)",
      "Bash(terraform apply *)",
      "Bash(kubectl delete *)",
      "Read(.env*)",
      "Read(**/secrets/**)",
      "Edit(.github/**)",
      "Edit(.gitlab-ci.yml)"
    ]
  }
}
```

Pitfalls to design around:

- **Wildcard before the subcommand.** `Bash(git *)` allows `git push --force`. Put the wildcard after the subcommand: `Bash(git log *)`. A wildcard in the middle (`git * main`) is almost always a mistake.
- **Denies match text, not intent.** `Bash(git push --force *)` does not catch `git push -f`, `git push --force-with-lease` or `git push origin +main`. Deny the dangerous verb more broadly (or put all of `git push` in `ask`) and enforce force-push protection on the server with protected branches.
- **Trailing wildcard semantics.** In some tools a trailing `*` also matches the bare command, in others it requires an argument. Test it.
- **Interpreters and wrappers.** Never allow a prefix that executes its argument: `sh -c`, `bash -c`, `python -c`, `node -e`, `env`, `xargs`, `ssh`, `kubectl exec`, `docker run`. One allowed wrapper defeats every deny after it.
- **Program identity is not matched.** A deny on `curl *` may not stop `/usr/bin/curl`, a script that calls curl, or an interpreter opening a socket. Enforce network and filesystem limits below the agent.
- **Compound commands.** Many tools split `a && b`, pipes and `$(...)` and check each part. Check how yours handles leading environment assignments: an allow may fail to match `FOO=1 npm test` while a deny still matches it.
- **File denies are partial.** A `Read` deny typically covers the built-in file tools and perhaps some recognised shell commands, not `grep -r` or a script that opens the file. Keep secrets out of the agent's filesystem view instead of hiding them with a rule.
- **Symlinks.** Confirm that a deny applies to the resolved target as well as the requested path.
- **Allowed scripts the agent can edit.** `Bash(npm run test *)` runs whatever `package.json`, a Makefile or a test file says. If the agent may edit those files, the allow is effectively arbitrary execution; rely on the sandbox, not the rule.
- **Bare tool name versus scoped rule.** In some tools, denying a whole tool removes it from the session, while a scoped deny leaves it available and rejects matching calls. The first is a hard boundary, the second a filter.

## MCP tools

Scope MCP rules to one server and, where supported, one tool (one tool's form is `mcp__<server>__<tool>`), never a blanket wildcard over all servers. If rules cannot match MCP tool arguments, a server exposing both `list_issues` and `delete_repository` needs the dangerous tool denied by name or the server wrapped. Review a new server like a dependency: pin it, read its tool list, and follow [[third-party-mcp-server-vetting]] before allowing anything.

## Reviewing allowlist changes

Treat each new `allow` line like an IAM binding diff. Add the settings files to CODEOWNERS so platform or security reviews them (see [[code-review]]), and add a CI lint so reviewers do not rely on eyes alone. The job below runs a lint script you write and keep in the repository; pin the image by digest in your registry.

```yaml title=".gitlab-ci.yml"
agent-permissions-lint:
  stage: test
  image: node:22-alpine # pin to a digest in real pipelines
  script:
    - node scripts/lint-agent-permissions.mjs .agent/settings.json .mcp.json
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        - .agent/**/*
        - .mcp.json
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      changes:
        - .agent/**/*
        - .mcp.json
```

The lint script should fail on:

- an `allow` that is a bare tool name or `*`;
- a wildcard before the subcommand of a multi-command CLI (`git`, `kubectl`, `terraform`, `gcloud`, `docker`);
- any allow for an interpreter or wrapper, or containing `push`, `apply`, `delete`, `--force`, `destroy` or `exec`;
- any new MCP entry without an explicit approval label;
- unknown tool names, because a typo in a deny rule silently removes the protection. Do not rely on the tool's own startup warnings to catch every typo, especially in MCP names.

In review, ask: what is the worst command this prefix lets through, is that covered by a deny or an ask, and is the rule still safe if the agent reads hostile content (see [[safe-shell-command-generation-for-agents]])?

## Auditing auto-approved prompts

Interactive "do not ask again" choices usually write rules into a local file, so rule sets accrete outside review.

1. **Inventory.** Use the tool's permissions view, or read the settings files directly, to list every rule with its source file, per developer and per repository.
2. **Compare.** Diff local rule sets against the committed baseline. Rules common to many machines belong in the committed file, after review; one-off rules are candidates for removal.
3. **Log decisions.** Where the tool exposes hooks or telemetry, record which rule approved each call (tool, matched rule, repository; no secrets from arguments). Without this you know what is allowed, not what was auto-approved.
4. **Sample.** On a fixed schedule, read a sample of auto-approved calls and ask whether a human would have approved them. Move risky ones to `ask`.
5. **Expire.** Delete rules for commands no longer used.

Set expectations in [[team-norms-for-ai-assisted-engineering]]: who may add rules, which scopes are reviewed, and when bypass-style modes are acceptable. Fresh clones and worktrees ([[coding-agent-branch-and-worktree-isolation]]) inherit the committed file, so keep it conservative.

## Failure modes

- A broad prefix such as `Bash(npm *)` allows publishes or arbitrary scripts; a deny on one spelling of a flag misses its short form.
- A narrow allow written to override a broad deny does nothing, and the team concludes the tool is broken.
- A deny on `curl` or a `Read` deny is mistaken for network or secret protection.
- A local file of accreted approvals becomes the real, unreviewed policy.
- A new MCP server arrives in a pull request with its write tools allowed in the same diff.
- Rules are assumed to behave the same after a tool upgrade.

## Review checklist

- [ ] The committed settings file is small, owned in CODEOWNERS and linted in CI.
- [ ] Every allow has a named use case and no wildcard before the subcommand.
- [ ] No allow covers an interpreter, wrapper or `exec`-style prefix.
- [ ] Push, apply, delete, force and publish actions are in `ask` or `deny`, and force-push is also blocked server-side.
- [ ] A sandbox and egress control exist, and secrets are absent from the agent's filesystem view.
- [ ] MCP allows name one server and tool, and each server was vetted.
- [ ] Rule syntax and precedence were checked against the current docs for the tool version in use.
- [ ] Local rule sets are compared with the baseline, auto-approvals are sampled, and stale rules are removed.

## Sources

- Your coding agent's own documentation for rule syntax, precedence, wildcard matching, compound commands, MCP rules and OS-level sandboxing. The tool-specific behaviour this note gives as an example varies by tool and version; check it there before copying any configuration.
- [NIST SP 800-53 Rev. 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) — the least-privilege control (AC-6) and separation of duties (AC-5) used as the policy frame.
- [Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) — an allow-only authorisation model, as a contrast to deny-first precedence.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
