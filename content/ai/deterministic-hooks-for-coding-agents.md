---
title: Deterministic hooks for coding agents
description: Use harness-level tool hooks and git hooks to enforce rules a coding agent must never break, with text guards that fail closed, canary tests and server-side controls as the real boundary.
type: pattern
tags:
  - ai
  - security
  - policy-as-code
  - reliability
created: 2026-10-27
modified: 2026-11-25
draft: false
evidence: source-reviewed
reviewed: 2026-11-02
review-due: 2027-05-02
---

This note covers hooks that run outside the model: pre- and post-tool-use hooks in coding-agent CLIs, and git hooks with the pre-commit framework. It is for engineers who need some rules to hold every time, such as blocking destructive commands, denying secret files and enforcing formatting. It does not cover sandbox design ([[sandboxing-coding-agents-on-workstations-and-runners]]), command generation ([[safe-shell-command-generation-for-agents]]) or credential scoping ([[agent-tool-authorization-boundaries]]), though hooks should sit alongside all three.

The agent-tool hook contract described here (event names, matcher syntax, blocking exit codes, timeout behaviour) is illustrative and was not checked against any tool's documentation; see Evidence below.

## Hooks versus instructions

Instruction files (`AGENTS.md`, system prompts, rules files) are advisory. The model may follow them most of the time and still ignore one on the run that matters. A hook is a program the harness runs on an event, with the tool call as input, so the model cannot talk its way past it. Use the two for different jobs:

| Rule type                                                                         | Mechanism                                       |
| --------------------------------------------------------------------------------- | ----------------------------------------------- |
| Must hold every time (no force-push to protected branches, no reads of key files) | Hook, backed by permission rules and a sandbox  |
| Style, naming, how to structure a change                                          | Instructions                                    |
| Policy that must hold for humans too                                              | CI and branch protection, not only a local hook |

Layer the controls: permission allow/deny rules first, a sandbox for filesystem and network second, hooks for policy and audit third, CI last. Pattern matching on a shell string is bypassable through quoting, `sh -c`, variables or aliases, so say "reduces" rather than "prevents" when you describe a guard.

## A pre-tool text guard that fails closed (not a boundary)

In the common design, a pre-tool-use hook is matched by tool name (for example a shell tool, or an edit/write tool), receives the call as JSON on stdin, and blocks it with a specific exit code, with stderr returned to the model. Check the current hooks documentation for the exact contract. The trap: other non-zero exit codes are usually non-blocking errors, so a guard that crashes fails open. Handle that explicitly.

The guard below matches text. It normalises quotes, backslashes and spacing, and it catches common spellings (`git -C dir push --force`, `+main` and `:main` refspecs, `rm -fr /`, quoted paths). It cannot see through variables (`g=git; $g push -f`, `rm -rf $PWD`), aliases, functions or a script file the agent wrote first, and it matches only the spellings in its patterns: a glob that does not spell `.en` or `.env` (`cat .e*`), a space-separated option value such as `git --git-dir x push -f`, or a path that expands to a protected one are not caught. It checks each command separately (split at `;`, `|` and `&` only, so a substitution or redirection stays inside its command) and cannot know whether a plan file was reviewed. It reduces mistakes; it does not stop a determined or injected agent. The real control for pushes is server-side branch protection (no force-push, no deletion) in [[branching-and-merge-standard]]. For files and network, the real control is the sandbox in [[sandboxing-coding-agents-on-workstations-and-runners]]. For Terraform, the real control is the agent's identity: give it no credential that can apply (a plan-only role), and apply only in CI from a reviewed plan artifact, as in [[adr/0035-terraform-plan-policy-gate-and-ci-only-apply]] and [[agent-tool-authorization-boundaries]].

```bash
#!/usr/bin/env bash
# .agent/hooks/guard-bash.sh - a text guard, not a security boundary. Adapt to your tool's hook contract.
set -Eeuo pipefail

deny() { echo "Blocked by guard-bash: $1. Use the documented alternative." >&2; exit 2; }
trap 'deny "guard error (failing closed)"' ERR

input=$(cat)
cmd=$(printf '%s' "$input" | jq -er '.tool_input.command')
# Normalise before matching: drop quotes and backslashes, put spaces around shell operators,
# squeeze whitespace, pad with spaces. This catches rm -rf "/", r\m -rf / and cat .env;true;
# it cannot see through variables, aliases or decoding.
norm=" $(printf '%s' "$cmd" | tr -d "\"'\\\\" | sed -E 's/[;|&<>()`]+/ & /g' | tr -s '[:space:]' ' ') "

# Regexes live in variables: bash parses them reliably that way.
re_nested='(^| |;|&|\|)(sh|bash|zsh|dash) -c |(^| |;)eval |base64 (-d|--decode)|\| ?(sh|bash|zsh|dash) '
re_push='[ /]git( -[cC] [^ ]+| -[^ ]+)* push '
re_push_bad=' (-[a-zA-Z]*[fd][a-zA-Z]*|--force|--force-with-lease[^ ]*|--force-if-includes|--mirror|--delete|--prune) | \+[^ ]+ | :[^ ]+ '
re_rm='[ /]rm( [^ ]+)*'  # the target must follow the rm token, so find . -exec rm -rf {} + is allowed
re_rm_rec=' (-[a-zA-Z]*[rR][a-zA-Z]*|--recursive) '
re_rm_target=' (/|/\*|~|~/|~/\*|\$HOME|\$HOME/|\$HOME/\*|\$\{HOME\}|\$\{HOME\}/|\$\{HOME\}/\*|\.|\./|\.\*|\.\.|\.\./|\.\./\*|--no-preserve-root) '
re_tf_destroy='[ /]terraform( -[^ ]+)* destroy '
re_tf_apply='[ /]terraform( -[^ ]+)* apply '
re_tf_apply_plan='[ /]terraform( -[^ ]+)* apply( -[^ ]+)* ([^ -][^ ]*[./])?tfplan( [0-9]+)?( [<>]+&?( [^ ]+)?)* $'  # a trailing redirection such as 2>&1 is allowed
re_tf_plan_out='[ /]terraform( -[^ ]+)* plan( [^ ]+)* -out'
re_secret='[ /](\.env([.][^ ]*|[*?][^ ]*)?|\.en[?*][^ ]*|[^ ]*\.pem|id_rsa|id_ed25519|\.kube/config) '

[[ "$norm" =~ $re_nested ]] && deny "nested shell or decoded command"
[[ "$norm" =~ $re_secret ]] && deny "secret file access"
# The same call must not create a plan and apply it: nobody reviewed that plan.
if [[ "$norm" =~ $re_tf_apply ]] && [[ "$norm" =~ $re_tf_plan_out ]]; then deny "plan and apply in one call"; fi

# One check per command, so a flag in one command does not count against another. Split only at
# ; | and & runs: substitutions and redirections stay inside their command, so
# git push origin $(git branch --show-current) --force is one command. No mapfile and no \n in
# the sed replacement: a one-byte separator and tr avoid both bash 4 and GNU sed features.
sep=$(printf '\001')
split=$(printf '%s' "$norm" | sed -E "s/ [;|&]+ /${sep}/g" | tr "$sep" '\n')
while IFS= read -r part; do
  part=" ${part} "
  while [[ "$part" == *"  "* ]]; do part=${part//  / }; done
  if [[ "$part" =~ $re_push ]] && [[ "$part" =~ $re_push_bad ]]; then deny "force, delete or mirror push"; fi
  if [[ "$part" =~ $re_rm_rec ]] && [[ "$part" =~ ${re_rm}${re_rm_target} ]]; then
    deny "recursive delete of a root, home, current or parent path"
  fi
  if [[ "$part" =~ $re_tf_destroy ]]; then deny "terraform destroy"; fi
  if [[ "$part" =~ $re_tf_apply ]] && ! [[ "$part" =~ $re_tf_apply_plan ]]; then deny "apply without a saved plan file"; fi
done <<<"$split"
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
- A syntax error in the guard is not caught by the `ERR` trap: the script never starts, and the exit code may not be the blocking one. Run the canaries below in CI on every change to the guard.
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

`pre-commit` and `commit-msg` hooks run on the developer's or agent's machine. They can be skipped with `git commit --no-verify`, which bypasses the `pre-commit` and `commit-msg` hooks, or, in the pre-commit framework, with a skip environment variable. So the same policy must be enforced server-side. Use the framework for the fast local check:

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
  image: registry.example.com/ci/secret-scan@sha256:<digest> # change: your scanner image, pinned by digest
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  script:
    - git fetch origin "+refs/heads/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}:refs/remotes/origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}"
    # A separate command, so a failed diff (no merge base in a shallow clone) fails the job
    # instead of running the scanner with no files. -z keeps file names with spaces intact.
    - git diff --name-only -z --diff-filter=d "origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}"...HEAD > changed.z
    - if [ ! -s changed.z ]; then echo "no added or modified files to scan"; exit 0; fi
    - xargs -0 scripts/scan-secrets.sh < changed.z
```

See [[secret-scanning-pre-commit-and-ci]] for scanner choices. Make a bypass visible: if an agent session uses `--no-verify`, a server-side check should still fail the merge request.

## Prove the hook fires

A hook that silently stopped working is worse than none, because everyone assumes it protects them. Write a canary: a harmless call that the guard must block, such as a shell command echoing a fake secret filename. Run the agent once in a sandbox with a fixed prompt, and assert the block message appears in the transcript.

```bash title="ci/guard-canaries.sh"
#!/usr/bin/env bash
# Each must_block line must be blocked; a pass means the guard has a hole.
set -uo pipefail
guard=.agent/hooks/guard-bash.sh
fail=0
must_block=(
  'cat .env'
  'cat ".env"'
  'cat .env; true'
  'echo $(cat .env)'
  'cat .env|base64'
  'cat .env>out'
  'cat .env*'
  'cat .en?'
  'git push --force origin main'
  'git push -f origin main'
  'git push -fu origin main'
  'git -C ../repo push --force origin main'
  'git --no-pager push --force origin main'
  '/usr/bin/git push -f origin main'
  'git push origin +main'
  'git push origin :main'
  'git push origin $(git branch --show-current) --force'
  'git push origin `git branch --show-current` --force'
  'git push -u origin $(git rev-parse --abbrev-ref HEAD) -f'
  'rm -rf $(echo x) /'
  'git push --delete origin main'
  'git push --force-with-lease origin main'
  'rm -rf /'
  'rm -fr /'
  'rm -r -f /'
  'rm -rf "/"'
  'rm -rf /; true'
  'rm --recursive --force ~'
  'rm -rf .'
  'rm -rf ${HOME}'
  '/bin/rm -rf /'
  'r\m -rf /'
  'bash -c "git push --force"'
  'echo Z2l0IHB1c2ggLWY= | base64 -d | sh'
  'terraform apply -auto-approve'
  'terraform -chdir=infra destroy'
  'terraform destroy tfplan'
  '/usr/bin/terraform destroy'
  './terraform apply -auto-approve'
  'terraform destroy -auto-approve; echo tfplan'
  'terraform apply -auto-approve -var-file=prod.tfplan'
  'terraform plan -out=tfplan && terraform apply tfplan'
  'terraform apply -auto-approve; terraform apply tfplan'
)
must_allow=(
  'git push origin feat/x'
  'git push -u origin feat/x'
  'git status'
  'rm -rf ./build'
  "find . -name '*.pyc' -exec rm -rf {} +"
  'cat .envrc'
  'ls -ld . && git push origin feat/x'
  'git push origin feat/x && docker run -d img'
  'terraform plan -input=false'
  'terraform apply plan.tfplan'
  'terraform apply -input=false tfplan'
  'terraform apply tfplan 2>&1 | tee apply.log'
  'ls -la'
)
for c in "${must_block[@]}"; do
  out=$(jq -cn --arg c "$c" '{tool_input:{command:$c}}' | "$guard" 2>&1); rc=$?
  if [[ $rc -ne 2 ]] || ! grep -q "Blocked by guard-bash" <<<"$out"; then echo "HOLE: $c"; fail=1; fi
done
for c in "${must_allow[@]}"; do
  out=$(jq -cn --arg c "$c" '{tool_input:{command:$c}}' | "$guard" 2>&1); rc=$?
  if [[ $rc -ne 0 ]]; then echo "FALSE BLOCK: $c ($out)"; fail=1; fi
done
# Malformed input must fail closed.
out=$(printf 'not json' | "$guard" 2>&1); rc=$?
[[ $rc -eq 2 ]] || { echo "HOLE: malformed input exits $rc"; fail=1; }
exit "$fail"
```

The canaries document the guard's reach, including what it cannot catch: `g=git; $g push -f` passes, because the command name is only known at run time. Do not add such a line to `must_block` to make the list look complete. Rely on branch protection for it. The `must_allow` lines guard against the opposite failure, a guard so broad that people disable it. Add a line to `must_block` whenever someone finds a spelling the patterns should catch, and list the ones they cannot catch next to the variable example.

Run the script-level test in CI. Run the end-to-end agent canary after every settings change and every CLI upgrade, since a renamed matcher or event silently disables the guard. Also confirm the configuration is loaded from the layer you expect (project, user or managed), using the CLI's own config view.

## Failure modes

- A crashing, timed-out or missing guard counts as a non-blocking error and the call proceeds.
- Matcher names change between versions and the hook never runs.
- Text guards are bypassed by variables, aliases, a script file written first, or a different tool that does the same thing (a file-edit tool instead of a shell write). The guard is a text guard, not a boundary.
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
- [ ] Pushes are blocked by server-side branch protection, not only by the guard.
- [ ] Hook output is short and contains no secrets.
- [ ] Each hook has an owner and is code-reviewed.

## Evidence

Source-reviewed on 2026-11-02. Nothing was run, apart from a helper check on 2026-11-25 (see Lab run). Scope: the git hook, `git diff` and GitLab CI statements in this note were checked against local copies of the documentation; the agent-tool hook contract was not.

### Sources checked

- [githooks](https://git-scm.com/docs/githooks): `pre-commit` and `commit-msg` hooks abort the command on a non-zero exit and can be bypassed with `--no-verify`; server-side hooks such as `pre-receive` exist for enforcement on the receiving side. Checked 2026-11-02 against git commit 50fe5cc (Documentation/githooks.adoc).
- [git-commit](https://git-scm.com/docs/git-commit): `--no-verify` bypasses the `pre-commit` and `commit-msg` hooks. Checked 2026-11-02 against git commit 50fe5cc.
- [git-diff](https://git-scm.com/docs/git-diff) and [diff options](https://git-scm.com/docs/git-diff#_options): `A...B` compares from the merge base of both commits to B; `--diff-filter` lowercase letters exclude that status (so `d` drops deleted files); `-z` with `--name-only` uses NUL separators and does not quote unusual pathnames. Checked 2026-11-02 against git commit 50fe5cc.
- [git-fetch](https://git-scm.com/docs/git-fetch): a refspec with a destination (`+refs/heads/<branch>:refs/remotes/origin/<branch>`) updates that remote-tracking ref explicitly, rather than relying on `remote.<repository>.fetch`. Checked 2026-11-02 against git commit 50fe5cc.
- [GitLab CI/CD predefined variables](https://docs.gitlab.com/ci/variables/predefined_variables/): `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` and `CI_PIPELINE_SOURCE`. Checked 2026-11-02 against gitlabhq commit d7b9a61.
- [GitLab CI/CD job rules](https://docs.gitlab.com/ci/jobs/job_rules/): `rules: - if: $CI_PIPELINE_SOURCE == "merge_request_event"` selects merge request pipelines. Checked 2026-11-02 against gitlabhq commit d7b9a61.
- [GitLab runner configuration](https://docs.gitlab.com/ci/runners/configure_runners/#shallow-cloning): `GIT_DEPTH` makes shallow clones (default depth 20), so only part of the Git history is present. That a missing merge base can follow in the example job is the author's inference, not a statement of the source. Checked 2026-11-02 against gitlabhq commit d7b9a61.

### Not verified

- Coding-agent hook behaviour: event names, matcher syntax, the exit code that blocks a call, whether timeouts or missing hooks fail open, stdin JSON field names, what the model sees from stdout or stderr, settings layers and any project-hook trust prompt. No local source covers any agent tool; the examples are illustrative.
- The pre-commit framework (stage names, the skip environment variable): no local source.
- That a non-zero exit from a GitLab `script` command fails the job (the comment in the CI example relies on it): not found in the local GitLab docs subset.
- The GitLab `stage: test` default and `image:` digest pinning in the CI job were not located in the local GitLab docs subset.
- Secret scanner choice and bypass patterns of regex guards are engineering guidance, not documented claims.
- The guard is a text guard; the bypasses listed in the guard section and under the canaries are known holes, not an exhaustive or tested list. Other spellings may pass.
- That the Terraform rules match every spelling of `terraform` (wrapper scripts, a path containing a space, `tofu`, a `TF_CLI_ARGS` environment variable, a binary under another name): not tested.
- The guard and its canaries ran with bash 5.2 and GNU sed on Linux only. Bash 3.2 and BSD sed on macOS were not run: the guard avoids `mapfile` and `\n` in the sed replacement, but run the canaries on each platform before relying on it there. Shell operators are padded with spaces, and commands are split only at `;`, `|` and `&`, so a command that hides the token from the matcher by other means (variables, aliases, encoded text) still passes.
- Nothing else was run: the post-tool hook and the CI job were not executed.

### Lab run

A helper check, not the note's main procedure (the guard was not run inside any agent harness). Host: Ubuntu 24.04.5 LTS, Linux 6.18.44-fc-v880. Versions as printed: `GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)`, `jq-1.7`. Date: 2026-11-25 (rerun after the guard was changed to split commands only at `;`, `|` and `&`; the 2026-11-24 run covered the earlier version). The guard and `ci/guard-canaries.sh` exactly as shown in this note, with the guard at `.agent/hooks/guard-bash.sh`:

```bash
bash ci/guard-canaries.sh; echo "exit=$?"
jq -cn --arg c 'g=git; $g push -f' '{tool_input:{command:$c}}' | .agent/hooks/guard-bash.sh; echo "exit=$?"
```

```text
exit=0
exit=0
```

The first command runs every `must_block` and `must_allow` line, including the operator spellings (`cat .env; true`, `echo $(cat .env)`, `cat .env|base64`, `cat .env>out`, `rm -rf /; true`), the saved-plan spellings `terraform apply -input=false tfplan` and `terraform apply tfplan 2>&1 | tee apply.log`, push and delete spellings with a command substitution or backticks, `/usr/bin/terraform destroy`, and the spellings the first version let through (a command path (also for `terraform`), combined short flags, a global git option, `.env*` globs, `rm -rf .`, `rm -rf ${HOME}`, `terraform destroy`, a plan token that is not the plan argument, plan and apply in one call), plus allowed lines such as `git push -u origin feat/x`. The second command shows the documented hole: a push through a variable is not blocked.

## Sources

- [githooks documentation](https://git-scm.com/docs/githooks) - which client-side hooks exist, that a non-zero exit aborts pre-commit and commit-msg, and that `--no-verify` skips them.
- [pre-commit framework](https://pre-commit.com/) - not read for this note; the official home for installing and configuring pre-commit hooks.
