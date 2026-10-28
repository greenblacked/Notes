---
title: Deterministic hooks for coding agents
description: Use harness-level tool hooks and git hooks to enforce rules a coding agent must never break, with fail-closed guards, canary tests and CI as the backstop.
type: pattern
tags:
  - ai
  - security
  - policy-as-code
  - reliability
created: 2026-10-27
modified: 2026-10-27
draft: false
---

This note covers hooks that run outside the model: pre- and post-tool-use hooks in coding-agent CLIs, and git hooks with the pre-commit framework. It is for engineers who need some rules to hold every time, such as blocking destructive commands, denying secret files and enforcing formatting. It does not cover sandbox design ([[sandboxing-coding-agents-on-workstations-and-runners]]), command generation ([[safe-shell-command-generation-for-agents]]) or credential scoping ([[agent-tool-authorization-boundaries]]), though hooks should sit alongside all three.

> [!note] Not verified
> Sources were found via search on 2026-10-27, but the pages could not be fetched, so no claim here was checked against live documentation. Before use, check for your tool and version: the hook event names and matcher syntax, which exit codes block a call, whether the model sees stdout or stderr, where project, user and managed settings are loaded from, the project-hook trust prompt, and the stage names and bypass variables of the pre-commit framework.

## Hooks versus instructions

Instruction files (`AGENTS.md`, system prompts, rules files) are advisory. The model may follow them most of the time and still ignore one on the run that matters. A hook is a program the harness runs on an event, with the tool call as input, so the model cannot talk its way past it. Use the two for different jobs:

| Rule type                                                                         | Mechanism                                       |
| --------------------------------------------------------------------------------- | ----------------------------------------------- |
| Must hold every time (no force-push to protected branches, no reads of key files) | Hook, backed by permission rules and a sandbox  |
| Style, naming, how to structure a change                                          | Instructions                                    |
| Policy that must hold for humans too                                              | CI and branch protection, not only a local hook |

Layer the controls: permission allow/deny rules first, a sandbox for filesystem and network second, hooks for policy and audit third, CI last. Pattern matching on a shell string is bypassable through quoting, `sh -c`, variables or aliases, so say "reduces" rather than "prevents" when you describe a guard.

## A fail-closed pre-tool guard

In the common design, a pre-tool-use hook is matched by tool name (for example a shell tool, or an edit/write tool), receives the call as JSON on stdin, and blocks it with a specific exit code, with stderr returned to the model. Check the current hooks documentation for the exact contract. The trap: other non-zero exit codes are usually non-blocking errors, so a guard that crashes fails open. Handle that explicitly.

```bash
#!/usr/bin/env bash
# .agent/hooks/guard-bash.sh - illustrative; adapt to your tool's hook contract
set -Eeuo pipefail

deny() { echo "Blocked by guard-bash: $1. Use the documented alternative." >&2; exit 2; }
trap 'deny "guard error (failing closed)"' ERR

input=$(cat)
cmd=$(printf '%s' "$input" | jq -er '.tool_input.command')

case "$cmd" in
  *"rm -rf /"*|*"rm -rf ~"*)            deny "recursive delete of a root path" ;;
  *"git push"*"--force"*|*"git push -f"*) deny "force push" ;;
  *"terraform apply"*)                   [[ "$cmd" == *"tfplan"* ]] || deny "apply without a reviewed plan file" ;;
  *".env"*|*".pem"*|*"id_rsa"*)          deny "secret file access" ;;
esac
exit 0
```

Wire it up in settings with a short timeout. Check what your tool does when a hook times out or cannot start: in some harnesses a timed-out or missing pre-tool hook is a non-blocking error and the call proceeds unless you opt in to blocking on failure, so the `ERR` trap above does not cover those cases. The shape below is illustrative.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": ".agent/hooks/guard-bash.sh", "timeout": 5 }]
      }
    ]
  }
}
```

Design rules that hold across tools:

- Catch every error, including JSON parse failures and a missing `jq`, and exit with the blocking code. Where the harness has a block-on-failure setting for timeouts and hooks that fail to start, turn it on for guards.
- Keep messages short and actionable: what was blocked, which rule, what to do instead. Hook output enters the model's context, so do not paste policy text.
- Deny the agent write access to the hook scripts and the settings files. An agent that can edit its guard has no guard.
- Review hooks as code, keep them pinned in the repository, and give each rule an owner.
- Assume secrets can still appear in tool output. Block the read, redact on the way out ([[agent-session-transcript-handling]]), and rotate on any leak ([[leaked-credential-rotation]]).

## Post-tool hooks for format and audit

Use a post-tool hook for work that should happen after every edit: run the formatter on the changed file only, and append a line to an audit log.

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
input=$(cat)
file=$(printf '%s' "$input" | jq -er '.tool_input.file_path')
case "$file" in
  *.py) ruff format -- "$file" ;;
  *.ts|*.tsx) prettier --write -- "$file" ;;
esac
# Log the tool name and path only, never the full arguments.
printf '%s' "$input" | jq -c '{tool: .tool_name, path: .tool_input.file_path}' >> "${AUDIT_LOG:-agent-tools.jsonl}"
```

Keep these fast and scoped to the touched file. Slow hooks get disabled. Treat the formatter as convenience and CI as the gate. If logs capture tool arguments, remember they may contain secrets.

## Git hooks are a separate, skippable layer

`pre-commit` and `commit-msg` hooks run on the developer's or agent's machine. They can be skipped with `git commit --no-verify` or, in the pre-commit framework, a skip environment variable. So the same policy must be enforced server-side. Use the framework for the fast local check:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: secret-scan
        name: secret scan
        entry: scripts/scan-secrets.sh
        language: script
        pass_filenames: true
```

and repeat it in CI so skipping locally changes nothing:

```yaml title=".gitlab-ci.yml"
secret-scan:
  stage: test
  image: registry.example.com/ci/secret-scan@sha256:REPLACE_WITH_DIGEST # change: your scanner image, pinned by digest
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  script:
    - git fetch origin "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    # A separate command, so a failed diff (no merge base in a shallow clone) fails the job
    # instead of running the scanner with no files. -z keeps file names with spaces intact.
    - git diff --name-only -z --diff-filter=d "origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}"...HEAD > changed.z
    - if [ ! -s changed.z ]; then echo "no added or modified files to scan"; exit 0; fi
    - xargs -0 scripts/scan-secrets.sh < changed.z
```

See [[secret-scanning-pre-commit-and-ci]] for scanner choices. Make a bypass visible: if an agent session uses `--no-verify`, a server-side check should still fail the merge request.

## Prove the hook fires

A hook that silently stopped working is worse than none, because everyone assumes it protects them. Write a canary: a harmless call that the guard must block, such as a shell command echoing a fake secret filename. Run the agent once in a sandbox with a fixed prompt, and assert the block message appears in the transcript.

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
out=$(printf '{"tool_input":{"command":"cat .env"}}' | .agent/hooks/guard-bash.sh 2>&1 || true)
grep -q "Blocked by guard-bash" <<<"$out" || { echo "canary failed: guard did not block"; exit 1; }
```

Run the script-level test in CI. Run the end-to-end agent canary after every settings change and every CLI upgrade, since a renamed matcher or event silently disables the guard. Also confirm the configuration is loaded from the layer you expect (project, user or managed), using the CLI's own config view.

## Failure modes

- A crashing, timed-out or missing guard counts as a non-blocking error and the call proceeds.
- Matcher names change between versions and the hook never runs.
- Regex guards are bypassed by `bash -c "$(...)"`, encoded strings or a different tool that does the same thing (a file-edit tool instead of a shell write).
- Local git hooks are treated as a control, then skipped.
- Hooks are slow, so developers turn them off.
- The agent can write to `.agent/hooks/` or the settings file.
- Hook output is verbose and floods the context window.

## Review checklist

- [ ] Rules that must always hold are hooks, not only instructions.
- [ ] Guards fail closed on parse errors, missing tools and timeouts.
- [ ] Permission rules and a sandbox sit under the hooks.
- [ ] The agent cannot modify hook scripts or settings.
- [ ] A canary proves each guard blocks, and runs after upgrades.
- [ ] Config precedence was checked in the tool's own view.
- [ ] Git hooks are mirrored by CI and branch protection.
- [ ] Hook output is short and contains no secrets.
- [ ] Each hook has an owner and is code-reviewed.

## Sources

- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) - example of hook events, tool-name matchers, the exit code that blocks a pre-tool call, and timeout and failure behaviour; check the current page for your version.
- [Best practices (code.claude.com)](https://code.claude.com/docs/en/best-practices) - guidance on hooks as deterministic gates and on checkable pass/fail signals.
- [githooks documentation](https://git-scm.com/docs/githooks) - which client-side hooks exist, that a non-zero exit aborts pre-commit and commit-msg, and that `--no-verify` skips them.
- [pre-commit framework](https://pre-commit.com/) - the official home for installing and configuring pre-commit hooks.

The owner's AI skills catalogue is at [ai.szolotov.com](https://ai.szolotov.com).
