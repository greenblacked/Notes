---
title: "Scripting 02: Safe Bash: strict mode, traps and ShellCheck"
description: Make Bash scripts fail loudly and clean up after themselves with strict mode, traps, mktemp, a reusable skeleton and ShellCheck in pre-commit and CI.
type: guide
tags:
  - learning
  - linux
  - ci-cd
  - security
created: 2026-10-17
modified: 2026-10-17
verified: 2026-10-17
draft: false
---

> [!info] Level: junior-middle | Time: about 6 h | You need: [[learn/bash-scripting-fundamentals|Scripting 01: Bash fundamentals]] | Lab: Option A, the Ubuntu LTS VM from [[learn/lab-setup|Start 01: Set up your lab]]

The worst scripts are not the ones that crash. They are the ones that hit an error, carry on, and print "done". A backup script that copies nothing and reports success is more dangerous than one that stops with a message. This lesson turns the fundamentals from Scripting 01 into scripts you can run unattended from cron or CI: they stop on errors, clean up after themselves, say what went wrong and pass a linter.

## What you will learn

- What silent failure looks like, and how `set -e`, `set -u` and `pipefail` turn it into a loud one.
- Where `set -e` does _not_ fire, so you do not trust it more than it deserves.
- Why `local x=$(cmd)` hides the exit code, and how to split it.
- How to clean up with `trap ... EXIT`, report errors with `trap ... ERR`, and handle `INT` and `TERM`.
- A reusable script skeleton with usage text, logging to stderr, `main "$@"` and an exit-code convention.
- How to run ShellCheck locally, suppress a warning properly, and gate it in pre-commit and CI.

## What silent failure looks like

Here is a backup script written the way many first scripts are written. It has no error handling.

```bash
mkdir -p ~/lab16 && cd ~/lab16
cat > backup_bad.sh <<'EOF'
#!/usr/bin/env bash
SRC="$1"
DEST="/tmp/lab16-backup"
mkdir -p "$DEST"
cp "$SRC/data.txt" "$DEST/"
echo "backup finished"
EOF
bash backup_bad.sh /nonexistent
echo "exit=$?"
bash backup_bad.sh
echo "exit=$?"
```

```text
cp: cannot stat '/nonexistent/data.txt': No such file or directory
backup finished
exit=0
cp: cannot stat '/data.txt': No such file or directory
backup finished
exit=0
```

The `cp` failed, but Bash carried on to the next line, printed "backup finished" and exited `0`. A scheduler, a CI job or a person reading the last line would believe the backup exists. The second run is worse: with no argument, `$SRC` is empty and the path quietly became `/data.txt`. By default a Bash script treats every command failure as something the script may ignore. Strict mode changes that default.

## Strict mode, one option at a time

### set -e: stop when a command fails

With `set -e` (`-o errexit`), the shell exits as soon as a simple command returns a non-zero code.

### set -u: an unset variable is an error

With `set -u` (`-o nounset`), expanding a variable that was never set is an error instead of an empty string. This catches typos (`$DEST_DIRR`) and the empty `$SRC` above. When a variable may legitimately be unset, say so with a default: `${NAME:-}` for empty, or `${NAME:-fallback}`.

### set -o pipefail: a pipeline fails if any stage fails

Normally a pipeline's exit code is the code of the **last** command, so an early failure disappears.

```bash
bash -c 'false | cat; echo "without pipefail: $?"'
bash -c 'set -o pipefail; false | cat; echo "with pipefail: $?"'
```

```text
without pipefail: 0
with pipefail: 1
```

This matters in real scripts. In `curl -s "$URL" | jq '.items[]'`, if `curl` fails (DNS error, timeout), `jq` sees empty input and succeeds, and the script continues with no data. With `pipefail`, the pipeline fails and `set -e` stops the script.

### set -E: make the ERR trap work inside functions

`set -E` (`-o errtrace`) makes functions and command substitutions inherit the `ERR` trap. You will want it when you add the trap below.

### The canonical header

Put this directly under the shebang in every script:

```bash
set -Eeuo pipefail
```

Now fix the backup script with two changes: the header, and a required argument.

```bash
cat > backup_good.sh <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

SRC="${1:?usage: backup_good.sh SOURCE_DIR}"
DEST="/tmp/lab16-backup"
mkdir -p "$DEST"
cp "$SRC/data.txt" "$DEST/"
echo "backup finished"
EOF
bash backup_good.sh /nonexistent
echo "exit=$?"
bash backup_good.sh
echo "exit=$?"
```

```text
cp: cannot stat '/nonexistent/data.txt': No such file or directory
exit=1
backup_good.sh: line 4: 1: usage: backup_good.sh SOURCE_DIR
exit=1
```

The "backup finished" line is gone and the exit code is non-zero. Callers can now tell that it failed.

## Where set -e does not fire

`set -e` is a safety net with holes, not a guarantee. The Bash manual and BashFAQ 105 document the rules, and the rules are subtle enough that experienced people get them wrong. The cases you must know:

| Situation                                                     | What happens                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| The command is the condition of `if`, `while` or `until`      | A failure is the condition's answer, not an error.               |
| The command is in an `&&` or `\|\|` list, except the last one | `false && echo hi` does not exit. Only the final command counts. |
| The command is negated with `!`                               | The failure is the point; it is not an error.                    |
| A function is called from one of the places above             | `set -e` is switched off inside the whole function body.         |
| A failing command substitution inside another command         | `echo $(false)` succeeds, because `echo` succeeded.              |
| Process substitution `<(cmd)` failing                         | Not detected by `set -e`.                                        |

The function case is the one that bites. Watch the same function behave in two ways:

```bash
bash -c '
set -e
f() { false; echo "f carried on"; }
if f; then echo "f reported ok"; fi
f
echo "never printed"
'
echo "exit=$?"
```

```text
f carried on
f reported ok
exit=1
```

Called inside `if`, the `false` inside `f` did not stop anything, and `f` returned success. Called on its own, the same function stopped the script. Do not write code that depends on this. For commands that matter, check explicitly:

```bash
cp "$src" "$dest" || die "copy failed: $src"
```

Two more surprises. An arithmetic command that evaluates to `0` has exit code `1`, so `(( i++ ))` with `i=0` stops a `set -e` script. Write `i=$((i + 1))`. And a `set -e` script cannot tell "grep found nothing" (exit `1`) from a real error, so test with `if grep -q ...; then`.

> [!note] Why people disagree about set -e
> BashFAQ 105 argues that `set -e` is unpredictable and that explicit error handling is better. Aaron Maxwell's "unofficial strict mode" article argues for using it anyway. Both are right in part. This lesson's position: use strict mode as a backstop for the checks you forgot, keep the explicit checks for the commands that matter, and do not copy the `IFS=$'\n\t'` line from that article without understanding what it changes for every later unquoted expansion.

## local x=$(cmd) hides the exit code

The `local` builtin returns its own exit code, which is `0` when the declaration works. If you declare and assign in one statement, the exit code of the command substitution is thrown away.

```bash
bash -c '
set -e
f() { local out=$(false); echo "local hid the failure, rc=$?"; }
f
echo "script continues"
'
bash -c '
set -e
f() { local out; out=$(false); echo "never printed"; }
f
echo "never printed either"
'
echo "exit=$?"
```

```text
local hid the failure, rc=0
script continues
exit=1
```

The first function printed `rc=0` and the script carried on. In the second, splitting the declaration from the assignment let `set -e` see the failure. ShellCheck reports this as `SC2155`. The same applies to `export x=$(cmd)` and `readonly x=$(cmd)`.

## trap: run code when the script ends

A **trap** runs a command when the shell receives a signal or reaches an event. The events you need:

| Trap          | Fires when                                                                     |
| ------------- | ------------------------------------------------------------------------------ |
| `EXIT`        | The script exits for any reason: normal end, `exit`, an error under `set -e`.  |
| `ERR`         | A command fails (with the same exceptions as `set -e`).                        |
| `INT`, `TERM` | Ctrl-C, and the default `kill` signal. A CI cancel usually sends `TERM` first. |

### Clean up with EXIT, and create temporary files with mktemp

`mktemp -d` creates a new directory with a random name that only you can read (mode 700), so it avoids name clashes and guessing attacks. Never use a fixed name such as `/tmp/work`.

```bash
cat > tmpdemo.sh <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

work_dir=""

cleanup() {
  local rc=$?
  trap - EXIT
  if [[ -n "$work_dir" && -d "$work_dir" ]]; then
    rm -rf -- "$work_dir"
    echo "cleanup: removed ${work_dir}" >&2
  fi
  exit "$rc"
}
trap cleanup EXIT

work_dir="$(mktemp -d)"
echo "$work_dir" > /tmp/lab16-last-dir
echo "working in ${work_dir}"
touch "${work_dir}/scratch.txt"
ls "${work_dir}"
false
echo "not reached"
EOF
bash tmpdemo.sh
echo "exit=$?"
ls "$(cat /tmp/lab16-last-dir)"
```

```text
working in /tmp/tmp.Wxwe8TlXv9
scratch.txt
cleanup: removed /tmp/tmp.Wxwe8TlXv9
exit=1
ls: cannot access '/tmp/tmp.Wxwe8TlXv9': No such file or directory
```

_Illustrative: the random directory name differs on every run._

The details are deliberate:

- The trap is on `EXIT`, not at the bottom of the script. The bottom is not reached when a command fails, when you call `exit`, or when a signal ends the script. `EXIT` covers all of those.
- `local rc=$?` is the first line, so the original exit code survives. The function ends with `exit "$rc"`, so cleanup does not turn a failure into a success.
- `trap - EXIT` removes the trap, so a failure inside `cleanup` cannot call it again in a loop.
- `work_dir=""` is set before the trap, and the check `-n "$work_dir"` stops cleanup from running `rm` on an empty path if the script fails before `mktemp`.
- `rm -rf -- "$work_dir"` uses `--` so a path starting with a dash is not read as a flag.

> [!warning] Cleanup cannot catch SIGKILL
> `SIGKILL` (`kill -9`) cannot be trapped. CI runners escalate to it when a job ignores `TERM`. Cleanup is for local files; never rely on it as the only protection of a remote resource. Make remote changes idempotent and give temporary resources an expiry.

### Report where it broke with ERR and $LINENO

An `ERR` trap runs when a command fails. `$LINENO` is the line being executed, and `$BASH_COMMAND` is the command that failed.

```bash
cat > errtrap.sh <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "error: line $LINENO: $BASH_COMMAND (exit $?)" >&2' ERR

step_one() { echo "step one"; }
step_two() { ls /nonexistent-dir; }

step_one
step_two
echo "not reached"
EOF
bash errtrap.sh
echo "exit=$?"
```

```text
step one
ls: cannot access '/nonexistent-dir': No such file or directory
error: line 6: ls /nonexistent-dir (exit 2)
exit=2
```

The single quotes matter: they delay the expansion of `$LINENO` and `$?` until the trap fires. In double quotes they would be filled in when the `trap` line itself runs. `set -E` is what makes the trap fire from inside `step_two`.

### Handle INT and TERM so the exit code is honest

When a person presses Ctrl-C or a runner cancels the job, you want cleanup to run and the exit code to say "interrupted". Convention: `128 + signal number`, so `130` for `INT` and `143` for `TERM`.

```bash
cat > sig.sh <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
tmp="$(mktemp -d)"
cleanup() { local rc=$?; trap - EXIT; rm -rf -- "$tmp"; echo "cleanup ran (rc=$rc)" >&2; exit "$rc"; }
trap cleanup EXIT
trap 'echo "got TERM" >&2; exit 143' TERM
trap 'echo "got INT" >&2; exit 130' INT
echo "pid $$ working in $tmp"
sleep 30 &
wait $!
EOF
bash sig.sh &
sleep 1
kill -TERM %1
wait %1
echo "exit=$?"
```

```text
pid 29999 working in /tmp/tmp.kkyIF0cxIh
got TERM
cleanup ran (rc=143)
exit=143
```

_Illustrative: the process ID and directory differ._

Running the long command in the background and using `wait` lets Bash react to a signal at once. (The background `sleep` keeps running until its 30 seconds are over; that is harmless in the lab.) Bash defers a trap while a **foreground** command runs, until that command ends. In a test without the `TERM` trap, cleanup still ran, but it saw `rc=0` while the process was reported as killed by `TERM` (not verified on other Bash versions). Setting the traps explicitly makes the behaviour visible in your code instead of depending on that.

## A script skeleton to copy

This is the pattern the [[standards/bash-scripts|team Bash standard]] expects. It has a header comment with usage and exit codes, strict mode, logging to stderr, option parsing with `getopts`, input validation, a temp directory with cleanup, a dry-run mode and `main "$@"` at the end. The task is real: compress old log files.

```bash title="archive_logs.sh"
#!/usr/bin/env bash
#
# archive_logs.sh - compress *.log files older than N days in one directory.
#
# Usage: archive_logs.sh [-n] [-d DAYS] LOG_DIR
#   -n        dry run: print what would be compressed, change nothing
#   -d DAYS   age threshold in days (default: 7)
#   -h        show this help
#
# Exit codes: 0 ok, 1 runtime failure, 2 bad usage.
#
set -Eeuo pipefail

readonly SCRIPT_NAME="${0##*/}"
readonly EX_FAILURE=1
readonly EX_USAGE=2

work_dir=""

log() { printf '%s %s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SCRIPT_NAME" "$*" >&2; }
die() { log "ERROR: $*"; exit "$EX_FAILURE"; }

usage() {
  cat >&2 <<USAGE
Usage: ${SCRIPT_NAME} [-n] [-d DAYS] LOG_DIR
  -n        dry run: print what would be compressed, change nothing
  -d DAYS   age threshold in days (default: 7)
  -h        show this help
USAGE
}

cleanup() {
  local rc=$?
  trap - EXIT
  if [[ -n "$work_dir" && -d "$work_dir" ]]; then
    rm -rf -- "$work_dir"
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'log "failed at line ${LINENO}: ${BASH_COMMAND}"' ERR
trap 'exit 130' INT
trap 'exit 143' TERM

main() {
  local dry_run=0 days=7 opt

  while getopts ':nd:h' opt; do
    case "$opt" in
      n) dry_run=1 ;;
      d) days="$OPTARG" ;;
      h) usage; exit 0 ;;
      :) log "option -${OPTARG} needs a value"; usage; exit "$EX_USAGE" ;;
      *) log "unknown option -${OPTARG}"; usage; exit "$EX_USAGE" ;;
    esac
  done
  shift $((OPTIND - 1))

  [[ $# -eq 1 ]] || { log "expected exactly one LOG_DIR"; usage; exit "$EX_USAGE"; }
  [[ "$days" =~ ^[0-9]+$ ]] || { log "-d must be a whole number"; exit "$EX_USAGE"; }

  local log_dir="$1"
  [[ -d "$log_dir" ]] || die "not a directory: ${log_dir}"

  work_dir="$(mktemp -d)"
  local list="${work_dir}/files.txt"

  find "$log_dir" -maxdepth 1 -type f -name '*.log' -mtime "+${days}" -print0 > "$list"

  local count=0 file
  while IFS= read -r -d '' file; do
    count=$((count + 1))
    if (( dry_run )); then
      log "would compress: ${file}"
    else
      log "compressing: ${file}"
      gzip -- "$file"
    fi
  done < "$list"

  if (( dry_run )); then
    log "dry run: ${count} file(s) matched"
  else
    log "done: ${count} file(s) compressed"
  fi
}

main "$@"
```

Why it is built this way:

- **Everything in `main`, and `main "$@"` last.** If a download is cut off halfway, a truncated file does not contain a complete `main "$@"` call, so it cannot run a half-script.
- **Logs to stderr, data to stdout.** `log` writes to stderr. Anything the script prints on stdout can be piped to another command.
- **Exit codes:** `0` success, `1` runtime failure, `2` wrong usage. Callers can retry on `1` and fix their command on `2`.
- **Validation before action.** The days value must be digits only, and the directory must exist, before any file is touched. `-print0` with `read -r -d ''` handles file names with spaces and newlines.
- **Dry run.** `-n` shows what would happen. For destructive scripts, make the dry run the default and require an explicit flag to apply.
- **No `eval`, no unquoted variables, no parsing `ls`.**

Save the script above as `archive_logs.sh` and run `chmod +x archive_logs.sh`. Then run it against a lab directory:

```bash
mkdir -p logs && cd logs
touch new.log && touch -d '10 days ago' old1.log "old two.log" && echo x > keep.txt
cd ..
./archive_logs.sh -n logs
./archive_logs.sh logs
ls logs
```

```text
2026-10-17T16:52:33Z archive_logs.sh: would compress: logs/old two.log
2026-10-17T16:52:33Z archive_logs.sh: would compress: logs/old1.log
2026-10-17T16:52:33Z archive_logs.sh: dry run: 2 file(s) matched
2026-10-17T16:52:33Z archive_logs.sh: compressing: logs/old two.log
2026-10-17T16:52:33Z archive_logs.sh: compressing: logs/old1.log
2026-10-17T16:52:33Z archive_logs.sh: done: 2 file(s) compressed
keep.txt
new.log
old two.log.gz
old1.log.gz
```

_Illustrative: timestamps differ, and the order of files from `find` is not guaranteed._

## ShellCheck: a linter for shell scripts

**ShellCheck** reads a script without running it and reports quoting mistakes, unsafe patterns and portability problems, each with a code like `SC2086`. It catches in seconds what code review misses.

Install it on the lab VM:

```bash
sudo apt-get update
sudo apt-get install -y shellcheck
shellcheck --version
```

```text
ShellCheck - shell script analysis tool
version: 0.9.0
license: GNU General Public License, version 3
website: https://www.shellcheck.net
```

_Illustrative: the packaged version depends on your Ubuntu release. This lesson's output was produced with ShellCheck 0.11.0, installed with `pip install shellcheck-py`. Messages and severities can differ between versions._

Create a script with typical mistakes and lint it:

```bash
cat > cleanup_bad.sh <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

target=$1
cd $target
stamp=$(date +%F)
local_copy=$(mktemp)
for f in $(ls *.tmp); do
  rm $f
done
echo "cleaned $target on $stamp"
EOF
shellcheck cleanup_bad.sh
```

```text
In cleanup_bad.sh line 5:
cd $target
   ^-----^ SC2086 (info): Double quote to prevent globbing and word splitting.

Did you mean:
cd "$target"


In cleanup_bad.sh line 7:
local_copy=$(mktemp)
^--------^ SC2034 (warning): local_copy appears unused. Verify use (or export if used externally).


In cleanup_bad.sh line 8:
for f in $(ls *.tmp); do
         ^---------^ SC2045 (error): Iterating over ls output is fragile. Use globs.
              ^-- SC2035 (info): Use ./*glob* or -- *glob* so names with dashes won't become options.


In cleanup_bad.sh line 9:
  rm $f
     ^-- SC2086 (info): Double quote to prevent globbing and word splitting.

Did you mean:
  rm "$f"

For more information:
  https://www.shellcheck.net/wiki/SC2045 -- Iterating over ls output is fragile. Use globs.
  https://www.shellcheck.net/wiki/SC2034 -- local_copy appears unused. Verify use (or export if used externally).
  https://www.shellcheck.net/wiki/SC2035 -- Use ./*glob* or -- *glob* so names with dashes won't become options.
```

_Illustrative: the exact wording and the list can differ between ShellCheck versions._

Each finding has a **severity** (`error`, `warning`, `info`, `style`), a code and a link to a wiki page that explains the problem and the fix. Search the wiki for the code (`SC2086`) whenever a message is unclear. Fix the script until ShellCheck prints nothing:

```bash
cat > cleanup_good.sh <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

target="${1:?usage: cleanup_good.sh DIR}"
cd -- "$target"
stamp="$(date +%F)"
shopt -s nullglob
removed=0
for f in ./*.tmp; do
  rm -- "$f"
  removed=$((removed + 1))
done
echo "removed ${removed} file(s) from ${target} on ${stamp}"
EOF
shellcheck cleanup_good.sh
echo "shellcheck exit=$?"
```

```text
shellcheck exit=0
```

Silence means success: exit code `0`. The fixes were to quote `"$target"`, drop the unused variable, loop over a glob instead of `ls`, and use `--` and `./` so a file named `-rf.tmp` cannot become an option.

### Suppress a warning, with a reason

Sometimes a warning is a false alarm or the code is intentional. Suppress that one line with a directive and say why. A bare suppression forces every reviewer to guess.

```bash
cat > disable.sh <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

# Intentional word splitting: EXTRA_FLAGS is a space-separated list set by the CI job.
# shellcheck disable=SC2086 # reviewed: flags never contain spaces or globs
tool --verbose $EXTRA_FLAGS "$1"
EOF
shellcheck disable.sh
echo "shellcheck exit=$?"
```

```text
shellcheck exit=0
```

Prefer an array over suppressing `SC2086` when you control the input. Never disable a rule for the whole repository to get a pipeline green. Use `# shellcheck source=path/to/lib.sh` when ShellCheck cannot follow a `source`, and `shellcheck -x` to let it follow files.

> [!tip] Useful flags
> `shellcheck -S warning script.sh` shows only warnings and errors (`-S` is the minimum severity). `shellcheck -f gcc script.sh` prints one line per finding in a format editors and CI understand. `shellcheck -x` follows `source`d files.

### Run it before the commit, and in CI

Run ShellCheck in two places. A pre-commit hook gives the author feedback in seconds. A CI job is the gate that nobody can skip.

```yaml title=".pre-commit-config.yaml"
repos:
  - repo: https://github.com/shellcheck-py/shellcheck-py
    rev: v0.11.0.1 # change: pin the latest release tag you have checked
    hooks:
      - id: shellcheck
        args: [--severity=warning]
```

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
        | xargs -0 -r shellcheck --severity=warning --format=gcc
```

> [!warning] Check before relying on this
> Not verified: the pre-commit tag `v0.11.0.1` (the lesson only confirmed that the `shellcheck-py` package installs as version 0.11.0.1 with `pip`), the container image name and tag, and whether the image contains `find` and `xargs`. Pick the tags from the project pages, test the job on a branch with a deliberate error, and check the version with `shellcheck --version` in the job. The team standard has the same gate: [[standards/bash-scripts]].

Roll the gate out with a baseline: fix the existing findings in one change, then make the job blocking. A permanently red job teaches people to ignore it. See [[patterns/gitlab-ci-pipeline-structure]] for where the job sits in the pipeline, and [[patterns/secret-scanning-pre-commit-and-ci]] for the other check that belongs in the same hook.

## Wrapper patterns for CI jobs

A CI job is a script somebody else runs for you, often at the worst time. These patterns keep it predictable:

- **Put the logic in a script file, not in YAML.** `script: ["./scripts/deploy.sh --env stage"]` can be linted, run on a laptop and reviewed. Forty lines of shell inside `.gitlab-ci.yml` cannot.
- **Start every multi-line block with strict mode.** If you must inline commands, begin with `set -Eeuo pipefail`.
- **Make the dry run the default.** The script previews unless told to apply, and the pipeline applies only on the approved path.
- **Capture exit codes you expect.** Some tools use non-zero codes for information. Take the code without letting `set -e` kill the script:

```bash
rc=0
terraform plan -input=false -detailed-exitcode -out=plan.tfplan || rc=$?
case "$rc" in
  0) echo "no changes" ;;
  2) echo "changes present; plan saved for review" ;;
  *) echo "plan failed (exit ${rc})" >&2; exit 1 ;;
esac
```

- **Time-box network calls.** `timeout 60 curl --fail --silent --show-error "$URL"` stops a hung call from using the whole job timeout. `--fail` makes `curl` exit non-zero on HTTP errors, which `pipefail` can then see.
- **Never `set -x` where secrets exist.** Trace mode prints every expanded command, including tokens passed as arguments, into a log many people can read.

> [!warning] Check before relying on this
> How a CI runner treats a failing command in the middle of a multi-line `script` block depends on the runner, its shell and its version. Not verified here. Test your runner by putting `false` in the middle of a block with a later `echo`, and write `set -e` explicitly instead of relying on the runner's defaults.

## Hands-on exercises

Work in `~/lab16`. The scripts are the ones created above; ShellCheck needs to be installed. Output is illustrative where it depends on your machine.

1. **Broken backup, before and after.** Run `bash backup_bad.sh /nonexistent; echo "exit=$?"`, then `bash backup_good.sh /nonexistent; echo "exit=$?"`.
   Expected: the first prints the `cp` error, then `backup finished` and `exit=0`. The second prints the `cp` error and `exit=1`, with no "backup finished".
   If you see something else: if the good version still prints `backup finished`, `set -Eeuo pipefail` is not on line 2, or you edited the wrong file.

2. **Missing argument.** Run `bash backup_good.sh; echo "exit=$?"`.
   Expected: `usage: backup_good.sh SOURCE_DIR` and `exit=1`.
   If you see something else: if it tries to copy `/data.txt`, the `${1:?...}` is missing and you are looking at the unsafe version.

3. **pipefail, 0 versus 1.** Run `bash -c 'false | cat; echo $?'` and `bash -c 'set -o pipefail; false | cat; echo $?'`.
   Expected: `0`, then `1`.
   If you see something else: if both print `0`, `pipefail` is not set in the second shell. Check the quoting of the `-c` string.

4. **local hides the code.** Run the two `local` examples from this lesson.
   Expected: `local hid the failure, rc=0` and `script continues` for the first; no output and `exit=1` for the second.
   If you see something else: if the second prints "never printed", your `local out` and `out=$(false)` are on one line.

5. **set -e and an `if`.** Run the `f` function example (the one called inside `if`, then on its own).
   Expected: `f carried on`, `f reported ok`, and `exit=1`, with "never printed" absent.
   If you see something else: if "never printed" appears, `set -e` is missing at the top of the `-c` string.

6. **Temp directory removed on exit.** Run `bash tmpdemo.sh; echo "exit=$?"`, then `ls "$(cat /tmp/lab16-last-dir)"`.
   Expected: the script prints a path, `scratch.txt` and a `cleanup: removed` line; `exit=1`; then `No such file or directory` for the directory.
   If you see something else: if the directory still exists, `trap cleanup EXIT` is missing, or `work_dir` was assigned inside a subshell. Run `ls /tmp/tmp.*` to find it, and remove only that directory.

7. **Error line from the ERR trap.** Run `bash errtrap.sh; echo "exit=$?"`.
   Expected: `step one`, the `ls` error, an `error: line 6: ls /nonexistent-dir (exit 2)` line and `exit=2`.
   If you see something else: if no `error:` line appears, `-E` is missing from `set`. Without it the trap does not fire inside functions.

8. **Interrupt and clean up.** Run `sig.sh` as in the lesson, then repeat with `kill -INT %1`.
   Expected: `got TERM`, `cleanup ran (rc=143)`, `exit=143`; and for `INT`: `got INT`, `cleanup ran (rc=130)`, `exit=130`.
   If you see something else: `kill: %1: no such job` means the script already exited or you ran the commands in separate shells. Run them together.

9. **The skeleton.** Create `archive_logs.sh`, make it executable, run `shellcheck archive_logs.sh`, then the log-directory demo from this lesson. Finally run `./archive_logs.sh; echo "exit=$?"` and `./archive_logs.sh -d x logs; echo "exit=$?"`.
   Expected: ShellCheck prints nothing. The demo matches the output above. The no-argument run prints the usage and `exit=2`; the bad `-d` prints `-d must be a whole number` and `exit=2`.
   If you see something else: a ShellCheck finding on a pasted copy usually means a quote was lost in copying. Compare with the original line by line.

10. **ShellCheck until silent.** Create `cleanup_bad.sh`, run `shellcheck cleanup_bad.sh`, and fix one finding at a time until the output is empty and `echo $?` prints `0`.
    Expected: `SC2086` is reported first (for `cd $target`), then `SC2034`, `SC2045`, `SC2035` and a second `SC2086`. The finished script resembles `cleanup_good.sh`.
    If you see something else: a different set of codes means a different ShellCheck version. Fix whatever it reports; the codes' wiki pages explain each.

11. **A suppression with a reason.** Create `disable.sh`, run `shellcheck disable.sh` (expect silence), then delete the `# shellcheck disable=` line and run it again.
    Expected: without the directive, `SC2086` is reported for `$EXTRA_FLAGS`.
    If you see something else: if nothing is reported even without the directive, the `# shellcheck disable=SC2086` line is still in the file. Remove that line.

## Common mistakes

- **Trusting `set -e` alone.** It does not fire in `if`, `&&`/`||` lists or inside functions called from them. Check commands that matter with `|| die "..."`.
- **`local x=$(cmd)`.** The failure vanishes. Declare `local x` first, assign on the next line.
- **Cleanup at the bottom of the script.** It never runs on failure. Use `trap cleanup EXIT`.
- **A cleanup that overwrites the exit code.** If `cleanup` ends with a successful command, a failed script reports success. Capture `rc=$?` and `exit "$rc"`.
- **Using a fixed path in `/tmp`.** Two runs collide, and another user can plant a file or link there. Use `mktemp`.
- **Single quotes versus double quotes in `trap`.** In double quotes, `$LINENO` is replaced when the trap is set, not when it fires. Use single quotes, or call a function.
- **Muting ShellCheck.** A repository-wide `disable` removes the check for everyone. Fix the code, or suppress one line with a reason.
- **Leaving `SC2086` for later.** An unquoted variable is the usual cause of a script deleting the wrong thing. Treat it as a bug.
- **Printing secrets while debugging.** `set -x` and `echo "$TOKEN"` put secrets into logs. Debug locally with fake values.

## Check your understanding

1. Why does `local out=$(false)` give exit code `0`, and what is the fix?
2. Name three situations in which `set -e` does not stop the script.
3. Why do you put the cleanup in `trap ... EXIT` instead of at the end of the script?
4. What does `set -o pipefail` change in `curl -s "$URL" | jq .`?
5. What does a script gain from distinct exit codes for usage errors and runtime errors?
6. When is it right to suppress a ShellCheck warning, and what must the suppression contain?

> [!question]- Answers
>
> 1. `local` is a command with its own exit code, `0` when the declaration works, and it replaces the exit code of the command substitution. Split it: `local out` on one line and `out=$(false)` on the next, so `set -e` sees the failure. ShellCheck flags this as SC2155.
> 2. Any three of: the command is the condition of `if`, `while` or `until`; it is in an `&&` or `||` list but not the last command; it is negated with `!`; it runs inside a function that was called from one of those places; it is inside a command substitution used as an argument to a command that succeeds (`echo $(false)`).
> 3. The end of the script is not reached when a command fails, when `exit` is called or when a signal ends the script. `EXIT` runs in all those cases.
> 4. Without it, the pipeline's exit code is `jq`'s, so a `curl` failure is hidden. With it, the pipeline fails if any stage fails, and `set -e` can then stop the script.
> 5. Callers, cron and CI can tell "you ran me wrongly" (fix the command, do not retry) from "something failed at runtime" (maybe retry), and logs and alerts are easier to read.
> 6. When the code is intentionally doing what ShellCheck warns about, or the warning is a verified false alarm. The directive goes on the line above the code, names one rule code, and has a comment that says why it is safe. Fixing the code is better whenever you can.

## Next steps

Next lesson: [[learn/python-for-ops|Scripting 03: Python for ops: venv, subprocess, CLIs, APIs and config]]. Previous lesson: [[learn/bash-scripting-fundamentals|Scripting 01: Bash fundamentals]].

To go deeper:

- [[standards/bash-scripts]] for the team standard: dry run, idempotency, cloud CLI safety and the reviewer checklist.
- [[patterns/gitlab-ci-pipeline-structure]] for how lint jobs and script calls fit into a pipeline.
- [[patterns/secret-scanning-pre-commit-and-ci]] for catching secrets before they land in a repository.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- GNU Bash Reference Manual (https://www.gnu.org/software/bash/manual/): "The Set Builtin" and "Bourne Shell Builtins" (`trap`). The examples were run with GNU bash 5.2.21 on Ubuntu 24.04 LTS.
- Greg's Wiki, BashFAQ 105, "Why doesn't set -e (or set -o errexit, or trap ERR) do what I expected?" (https://mywiki.wooledge.org/BashFAQ/105).
- ShellCheck wiki and project (https://www.shellcheck.net/wiki/ and https://github.com/koalaman/shellcheck). The output was produced with ShellCheck 0.11.0 (`shellcheck-py` 0.11.0.1); the distro-packaged version will differ.
- Aaron Maxwell, "Use the Unofficial Bash Strict Mode (Unless You Looove Debugging)" (http://redsymbol.net/articles/unofficial-bash-strict-mode/). Read it together with BashFAQ 105: its `IFS` advice and its view of `set -e` are contested.
