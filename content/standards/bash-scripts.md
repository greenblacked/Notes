---
title: Bash script standard
description: Structure, safety rules and ShellCheck CI gating for Bash in ops repositories, with copy-ready templates and a rule for when to switch to Python.
type: standard
tags:
  - standards
  - ci-cd
  - gitlab-ci
  - security
created: 2026-10-17
modified: 2026-10-17
draft: false
---

Most ops automation starts as Bash: a deploy helper, a cleanup job, a wrapper around `gcloud` or `kubectl`. Bash is good at gluing commands together and bad at everything else, so small mistakes (an unquoted variable, a missing check) turn into deleted files or half-applied changes. This standard gives every script in an ops repository the same skeleton, the same safety rules and the same lint gate. It applies to scripts in repositories, CI jobs and runbook helpers. One-off commands typed at a terminal are out of scope.

It complements [[code-review]] (which says what reviewers check), [[gitlab-ci-pipeline-structure]] (where the lint job lives) and [[secret-scanning-pre-commit-and-ci]] (which catches secrets that a script prints or commits). For a gentler introduction see [[learn/bash-scripting-fundamentals]] and [[learn/safe-bash-scripts]].

> [!info] Scope and versions
> The examples target Bash 4 or newer on Linux (CI images, GKE nodes, laptops). macOS ships an older Bash by default, so scripts that must run there need testing there. ShellCheck version-specific behaviour is called out where it matters and marked "not verified".

## Header and strict mode

Every script starts with the same header. Copy it, then fill in `usage`.

```bash title="scripts/template.sh"
#!/usr/bin/env bash
#
# template.sh - one line saying what this script does and why it exists.
#
# Usage: [DRY_RUN=0] template.sh <environment>   (DRY_RUN=1 is the default)
# Exit codes: 0 ok, 1 runtime failure, 2 bad usage.
#
set -Eeuo pipefail

readonly SCRIPT_NAME="${0##*/}"
DRY_RUN="${DRY_RUN:-1}"
TMP_DIR=""

log() { printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SCRIPT_NAME" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }
usage() { printf 'Usage: [DRY_RUN=0] %s <environment>\n' "$SCRIPT_NAME" >&2; exit 2; }

cleanup() {
  local rc=$?
  trap - EXIT
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf -- "$TMP_DIR"
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'log "failed at line $LINENO: $BASH_COMMAND"' ERR

main() {
  [[ $# -eq 1 ]] || usage
  local environment="$1"
  TMP_DIR="$(mktemp -d)"
  log "starting for environment=${environment} dry_run=${DRY_RUN}"
  # ... work goes here ...
}

main "$@"
```

What each part does:

- `#!/usr/bin/env bash` finds Bash on the `PATH`. Do not use `#!/bin/sh` for Bash features; arrays and `[[ ]]` do not exist in POSIX `sh`.
- `set -E` makes the `ERR` trap fire inside functions, `set -e` exits on a failing command, `set -u` turns an unset variable into an error, and `set -o pipefail` makes a pipeline fail if any stage fails.
- `DRY_RUN` defaults to `1` (safe). A real run needs an explicit `DRY_RUN=0`.
- Logs go to stderr so stdout stays clean for data that another command reads.
- Everything lives in `main` and the file ends with `main "$@"`. A half-downloaded script then cannot run a partial body.

> [!warning] set -e is not a safety net
> `set -e` is ignored inside `if` conditions, on the left of `&&` and `||`, and in some subshell and command-substitution cases. Read the Bash manual section on it once. Treat it as a backstop for forgotten checks. Check the commands that matter explicitly (`cmd || die "cmd failed"`).

## Quoting and arrays

Quote every expansion unless you want word splitting, and then say so in a comment. Use arrays for lists and for commands built from parts.

```bash title="Quoting rules"
# Wrong: word splitting and globbing on the value
rm -rf $BUILD_DIR/*

# Right: quoted; the glob stays outside the quotes on purpose
rm -rf -- "${BUILD_DIR:?BUILD_DIR must be set}"/*

# Wrong: a string of flags (ShellCheck SC2086 on the expansion)
FLAGS="--project $PROJECT --quiet"
gcloud compute instances list $FLAGS

# Right: an array keeps each argument intact
flags=(--project "$PROJECT" --quiet)
gcloud compute instances list "${flags[@]}"
```

The two fixes ShellCheck asks for most often:

```bash title="SC2086 and SC2155"
# SC2086: double-quote to prevent globbing and word splitting
echo "$name"

# SC2155: declare and assign separately so the exit status of the
# command is not hidden by "local"
local project_id
project_id="$(gcloud config get-value project 2>/dev/null)"
```

Further rules:

- `${VAR:?message}` stops with a message when a variable is empty. Use it before any `rm`, `mv` or path built from a variable.
- Put `--` before arguments that come from outside, so a value starting with `-` is not read as a flag.
- Use `[[ ... ]]` for tests, `$(...)` for command substitution and `printf` rather than `echo -e`.
- Never build a command string and run it with `eval` or `bash -c "$string"`. Use arrays.
- Read lines with `while IFS= read -r line; do ...; done < file`, or `mapfile -t lines < <(command)`.

## Functions, logging and exit codes

- One job per function, named in `snake_case`, with `local` variables. Pass values as arguments rather than through globals.
- Return codes carry meaning. Use `0` for success, `1` for a runtime failure and `2` for bad usage, and document any other code in the header. Other numbers are fine if a caller depends on them (see the `terraform plan` example below).
- Log what you are about to do, not just what happened. A line before a destructive step is what you will read at 03:00.
- Send errors to stderr and exit with a non-zero code. Do not print `ERROR` and then exit `0`.
- Do not parse human-readable output. Ask for machine output (`--format=json`, `--format='value(name)'`, `-o json`) and read it with `jq`.

```bash title="Functions with local variables and explicit failure"
require_cmd() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "required command not found: ${cmd}"
  done
}

get_project() {
  local project
  project="$(gcloud config get-value project 2>/dev/null)"
  [[ -n "$project" && "$project" != "(unset)" ]] || die "no gcloud project configured"
  printf '%s\n' "$project"
}
```

## Cleanup with trap

Scripts that create temporary files, lock files or background processes clean up in an `EXIT` trap. The header above already has the pattern. Rules:

- Create temporary files with `mktemp` and set their directory variable before the work starts, so `cleanup` knows what to remove.
- Use `EXIT` for cleanup. It runs on a normal exit, on `exit` after an error and, in Bash, on `INT` and `TERM` signals that terminate the script.
- Keep `cleanup` short and make it safe to run twice. Reset the trap (`trap - EXIT`) at the top so a failure inside it does not loop.
- Capture `$?` first (`local rc=$?`) and exit with it, so cleanup does not turn a failure into success.
- A `SIGKILL` cannot be trapped. CI runners that cancel a job escalate to it, so cleanup must never be the only thing protecting a remote resource. Use expiring resources and idempotent retries.

## Dry run and idempotency

A script that changes things must be safe to run twice and safe to preview.

**Dry run.** Wrap every command that changes state in `run`. Read-only commands run normally, because a preview needs real data.

```bash title="run() wrapper with DRY_RUN"
# Prints the command in a shell-quoted form; executes it only when DRY_RUN=0.
run() {
  if [[ "$DRY_RUN" == "1" ]]; then
    log "DRY-RUN: $(printf '%q ' "$@")"
    return 0
  fi
  log "RUN: $(printf '%q ' "$@")"
  "$@"
}

# usage
run kubectl --namespace "$NAMESPACE" rollout restart deployment/"$DEPLOYMENT"
```

If you add a flag such as `--apply`, parse it in one place and set `DRY_RUN` from it. CI should call the dry run first, show the output in the job log and apply only after approval. This is the same idea as the saved plan in [[production-change-checklist]].

**Idempotency.** Describe first, create only when missing, and make updates converge to a desired state. Do not rely on "already exists" error text.

```bash title="Idempotent describe-or-create with gcloud"
ensure_service_account() {
  local project="$1" name="$2" display_name="$3"
  local email="${name}@${project}.iam.gserviceaccount.com"

  if gcloud iam service-accounts describe "$email" \
      --project "$project" >/dev/null 2>&1; then
    log "service account exists: ${email}"
  else
    log "creating service account: ${email}"
    run gcloud iam service-accounts create "$name" \
      --project "$project" \
      --display-name "$display_name"
  fi
}

ensure_service_account "example-project" "ci-deployer" "CI deployer"
```

> [!note] A failing describe is not always "missing"
> `describe` also fails on a permission error or a network problem, and this pattern then tries to create. That is acceptable for a create that fails safely when the resource exists. For anything else, read the error, or use `gcloud ... list --filter=...` and test the output instead. Change `example-project` to your own project ID.

## Calling cloud CLIs safely

Cloud CLIs are the part of a script that touches production, so apply extra rules.

**Arrays, not strings.** Build the argument list in an array and pass `"${args[@]}"`. Never interpolate user input into a string that is later split or evaluated.

**Timeouts.** A hung API call can hold a CI job for its whole timeout. Wrap network commands in `timeout` and set the tool's own timeout too.

```bash title="Timeouts on kubectl and gcloud"
# GNU coreutils timeout: kill after 60 seconds. Exit code 124 means it timed out.
timeout 60 kubectl --request-timeout=30s --namespace "$NAMESPACE" get pods -o json > "$TMP_DIR/pods.json"

# Same for gcloud
timeout 120 gcloud compute instances list --project "$PROJECT" --format=json > "$TMP_DIR/instances.json"
```

`timeout` sends `TERM` after the limit. Add `--kill-after=10` if the tool ignores it.

**Never `set -x` in CI.** Trace mode prints every expanded command, including tokens and passwords passed as arguments, into a job log that many people can read. Do not enable `set -x` in scripts that handle secrets, and do not turn on your CI system's debug tracing on a protected pipeline. If you must debug, do it locally with fake values. Mask CI variables (see [[gitlab-ci-pipeline-structure]]), and pass secrets by environment variable or file, not command-line argument, because arguments show up in process listings.

**Redact before logging.** When you must show a command's output or an error body, filter it first.

```bash title="Redacting secrets from output"
redact() {
  sed -E \
    -e 's|(Bearer )[A-Za-z0-9._~+/=-]+|\1[REDACTED]|g' \
    -e 's/((token|password|passwd|secret|api[_-]?key)=)[^&[:space:]"]+/\1[REDACTED]/Ig'
}

some_api_call 2>&1 | redact >&2
```

The `I` flag after the substitution is a GNU `sed` extension. Redaction is a safety net with gaps, not a guarantee. The first defence is not to print secrets, and the second is [[secret-scanning-pre-commit-and-ci]].

**Terraform exit codes.** `terraform plan -detailed-exitcode` changes what the exit code means: 0 is success with no changes, 1 is an error, and 2 is success with changes present. A script that wraps it must not treat 2 as a failure, and must not let `set -e` kill the script before it can read the code.

```bash title="Handling terraform plan -detailed-exitcode"
rc=0
terraform plan -input=false -detailed-exitcode -out=plan.tfplan || rc=$?

case "$rc" in
  0) log "no changes" ;;
  2) log "changes present; plan saved for review" ;;
  *) die "terraform plan failed with exit code ${rc}" ;;
esac
```

> [!warning] Check before relying on this
> Not verified against the Terraform or OpenTofu version you run: the `-detailed-exitcode` meanings above (0, 1, 2) are the long-standing documented behaviour. Run `terraform plan -help` for your version, and test the case statement against a real change and a real error before it gates a pipeline. See [[terraform-plan-policy-checks]] for gating on the plan content.

## ShellCheck config and suppressions

[ShellCheck](https://www.shellcheck.net) finds quoting errors, unsafe patterns and portability problems. Keep one config at the repository root so editors, pre-commit hooks and CI all agree.

```text title=".shellcheckrc"
# Treat scripts as Bash unless they declare otherwise
shell=bash

# Follow "source" statements to files that exist in the repository
external-sources=true
source-path=SCRIPTDIR

# Optional checks worth turning on (see "shellcheck --list-optional")
enable=check-unassigned-uppercase
```

> [!warning] Check before relying on this
> Not verified: the `.shellcheckrc` keys above (`shell`, `external-sources`, `source-path`, `enable`), the optional check names, and what changed in ShellCheck 0.11 compared with older releases. Confirm them with `shellcheck --help`, `shellcheck --list-optional` and the project's wiki and release notes for the exact version you pin. Run it once on the repository to see which new warnings appear before you make it a gate.

Suppress a warning only for a reason that a reviewer can read. Put the directive directly above the line it applies to, with the reason in the comment above it. Never disable a rule for the whole repository to make a pipeline green.

```bash title="Inline suppression with a reason"
# Reason: CONFIG_FILE is read by the sourced library, not used in this file.
# shellcheck disable=SC2034
CONFIG_FILE="/etc/example/app.conf"
```

Review rules for suppressions:

- Each `disable` names one code and has a reason. A bare `# shellcheck disable=SC2086` is a review comment.
- `SC2086` (unquoted) and `SC2155` (masked exit status) are almost always fixed, not suppressed; see the fixes above.
- `SC1090` and `SC1091` (cannot follow `source`) are fixed with `source-path` and a `# shellcheck source=path` directive rather than disabled.

## CI gate

Lint on every merge request, and fail the job on any finding at or above the severity you chose. A pinned image keeps the result stable; an unpinned one changes the rules under you.

```yaml title=".gitlab-ci.yml"
shellcheck:
  stage: test
  image: koalaman/shellcheck-alpine:<PINNED_TAG_OR_DIGEST> # change: pin a tag you have checked, ideally by digest
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - |
      find . -type f -name '*.sh' -not -path './.git/*' -print0 \
        | xargs -0 -r shellcheck --severity=style --format=gcc
```

> [!warning] Check before relying on this
> Not verified: the image name, the existence of a tag and the contents of the image (shell, `find`, `xargs`). Pick the tag from the registry, record its digest and test the job on a branch with a deliberate error before you merge it. If the image has no shell your runner can use, install ShellCheck from your internal mirror in a small base image instead and pin that. Check which version it contains with `shellcheck --version`.

Notes on the gate:

- `find` only catches files named `*.sh`. Scripts without an extension need a list, or a check of the shebang line. Keep ops scripts under `scripts/` and name them `.sh`.
- Roll the gate out with a baseline: fix the existing findings in one change, then enable the job as blocking. A permanently red non-blocking job teaches people to ignore it.
- Add `shfmt -d` as a second job if the team wants formatting enforced. Pin it the same way.
- Test critical scripts with [bats](https://github.com/bats-core/bats-core) or with a dry-run run in CI against a throwaway project.

## When not to use Bash

Switch to Python (or another real language) when any of these is true:

- The script is longer than a screen or two and has branches that need tests.
- It handles structured data beyond a simple `jq` filter: nested JSON, YAML, pagination, joins.
- It needs retries with backoff, concurrency, or careful error handling around an API.
- It does arithmetic on floating-point values, dates in several time zones or text encodings.
- It must run on more than one operating system.
- Several people need to change it, and it needs unit tests and type checks.

Bash stays the right choice for short glue: calling three commands in order, wrapping a tool with defaults, a CI step. A common path is to keep Bash as a thin entry point that sets up the environment and calls a Python module. For Python habits in ops see [[learn/python-for-ops]].

## Checklist for reviewers

- [ ] Header with `set -Eeuo pipefail`, `trap cleanup EXIT` and `main "$@"`.
- [ ] All expansions quoted; lists in arrays; no `eval`.
- [ ] State changes go through `run`; `DRY_RUN` defaults to safe.
- [ ] Create steps are describe-then-create or otherwise idempotent.
- [ ] Network commands have timeouts; no `set -x`; secrets are not in arguments or logs.
- [ ] ShellCheck passes with no new suppressions without a reason.
- [ ] The exit codes are documented, and wrappers of `terraform plan -detailed-exitcode` handle 2.

## Related

- [[code-review]]
- [[gitlab-ci-pipeline-structure]]
- [[secret-scanning-pre-commit-and-ci]]
- [[production-change-checklist]]
- [[terraform-plan-policy-checks]]
- [[learn/safe-bash-scripts]]
