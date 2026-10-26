---
title: Safe shell command generation for agents
description: Review generated shell commands as executable code and enforce limits outside the model before running them.
type: guide
tags:
  - ai
  - security
  - ci-cd
  - linux
created: 2026-10-26
modified: 2026-10-26
draft: false
---

## A command suggestion is not authorization

Shell commands combine parsing, variable expansion, quoting, pipelines, redirection, environment inheritance, and program-specific options. A command that looks harmless in a chat can delete files, expose credentials, contact an unintended host, or leave a long-running process. Treat generated commands as untrusted code; the model cannot grant itself authority or certify the safety of its own output.

Prefer a supported API, task runner, or narrowly scoped script with typed inputs over a free-form shell string. If shell is necessary, require the agent to provide one command at a time, explain its purpose and expected effects, identify the working directory and inputs, and wait for the required approval before execution. Do not turn a request for diagnosis into permission to install packages, change system configuration, or publish artifacts.

Command generation intersects with [[coding-agent-branch-and-worktree-isolation]]: isolated workspaces reduce the blast radius but do not make a dangerous command acceptable. Refer to [[sandboxing-coding-agents-on-workstations-and-runners]] for execution containment.

## A safer execution workflow

1. **Classify effects.** Identify reads, writes, network access, privilege changes, process launches, and persistent configuration changes. Treat shell pipelines and scripts as a whole, including every stage and redirection.
2. **Make the target explicit.** Confirm the repository root, working directory, target environment, and file or service scope. Reject commands whose paths resolve outside the allowed workspace unless explicitly authorized.
3. **Prefer argument arrays.** When a wrapper launches a process, pass an executable and argument vector rather than constructing a shell command string. Keep data separate from syntax. Do not concatenate untrusted filenames or user values into a command.
4. **Use constrained identities.** Run in a disposable, unprivileged environment with a minimal filesystem view, no host credential socket, and bounded network access. Provide short-lived scoped credentials only for an approved task.
5. **Preview and approve.** For changes, inspect the proposed diff or use a documented dry-run mode when the specific tool supports it. Verify what that dry run does; a flag name alone is not proof that it cannot write. Ask a human for confirmation before destructive, privileged, externally visible, or production-affecting actions.
6. **Execute once and inspect.** Capture exit status, bounded output, and resulting state. Avoid automatic retries when a command may have partially completed. Verify state through an independent read-only check.
7. **Record and recover.** Retain a concise record of command, task, identity, target, approval, result, and cleanup needed. Avoid logging secrets or full environment dumps. Roll back only through an owner-approved, understood procedure.

For automation, use explicit allowlists of executable paths and subcommands, not brittle substring matching or denylist filtering. Validate each argument according to its expected type and range. A “safe commands” policy that allows arbitrary `sh -c`, interpreters, package scripts, or aliases effectively allows arbitrary code execution.

## Failure modes

Quoting errors can change the command's structure; a value intended as a filename may be interpreted as an option. Shell injection may occur through command substitution, unquoted expansions, or a value passed through multiple interpreters. Other risks include `sudo`, recursive deletion, broad globbing, force flags, shell startup files, `curl | sh`, remote scripts, package lifecycle hooks, and shell redirections that overwrite files. Commands copied from logs may contain malicious text that looks like an instruction.

A successful dry run can still be misleading if it differs from the real environment, omits hooks, or checks only syntax. A timeout does not prove that the command stopped. If the result is unexpected, terminate only the known process using its exact process identity, then inspect state and credentials; do not issue a speculative cleanup command. If a command may have accessed secrets or an external target, treat the event as a potential incident and follow [[runaway-or-compromised-ai-agent-response]].

## Decision checklist

- Is shell necessary, or can a structured API or task runner do the job?
- Are effects, target, paths, arguments, and expected output explicit?
- Is the command free of untrusted string concatenation and unexpected interpreters?
- Does the runtime enforce least privilege and a bounded filesystem/network view?
- Is a real dry-run available and understood for this exact tool?
- Has a human approved destructive, privileged, or production-impacting work?
- Can the outcome be verified without repeating a possibly partial operation?

If not, do not execute. Return the proposed command for a human to review, or ask for a narrower request. Never rely on the assistant's own assurance as the only safety check.

## Related

- [Owner’s AI skills catalogue](https://ai.szolotov.com).

## Sources

- [OWASP OS Command Injection Defense Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html): avoiding shell interpretation and using parameterization.
- [Python documentation: subprocess — Subprocess management](https://docs.python.org/3/library/subprocess.html): process APIs and the distinction between argument sequences and shell execution.
- [GitHub Docs: Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use): workflow execution, untrusted inputs, and permission boundaries.
