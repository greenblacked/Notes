---
title: Agent done criteria and verification
description: Define done for agent-run tasks as checkable evidence, reject unverified success claims, and require agents to report skipped steps and failed checks.
type: pattern
tags:
  - ai
  - reliability
  - team-process
  - delivery
created: 2026-10-27
modified: 2026-11-25
draft: false
---

This note explains how to define "done" for a task handed to a coding agent, how to demand evidence for the claim, and how to treat missing evidence. It is for engineers and reviewers who merge agent-produced changes. It does not cover scoring agents over many tasks ([[task-success-evaluation-for-agents]]), generating tests ([[ai-assisted-test-generation-quality-gates]]) or bounding retries in depth ([[bounded-agent-loops-and-stop-conditions]]); those are linked where they apply. For the pipeline baseline, see [[ci-pipeline-standard]].

> [!note] Not verified
> Sources were found via search on 2026-10-27, but the pages could not be fetched. Before use, check: the current wording of your coding agent's best-practices documentation, whether named features such as a goal evaluator, a verify skill or a stop-event hook exist in your tool version, and the current branch protection and required status check behaviour for your hosting plan (it differs between cloud and self-managed editions). The scripts and the CI job below are sketches and were not run.

## Define done before the work starts

"Looks good" is not a completion condition. Write done as a command and an expected result, in the task or the plan ([[plan-first-agent-workflows]]):

- `make test` exits 0 on the final commit.
- `terraform validate` passes and `terraform plan` shows no unexpected destroys.
- CI job `unit` is green on the head SHA of the pushed branch.
- `git grep OLD_API_NAME` returns nothing.

Prefer checks the agent can run itself that give an unambiguous pass or fail: test suites, build exit codes, linters, fixture diffs. Coding-agent guidance commonly treats this as one of the strongest levers on agent quality (check your tool's documentation); an agent without such a signal can only guess. Copy the criteria into the pull request description so a reviewer can compare stated criteria with evidence.

## Require evidence, not assertion

A claim of success without a command next to it counts as unverified. Ask for a fixed report shape and reject reports that do not follow it:

```markdown
## Verification

- Commit: 3f9c2ab
- `make test` (repo root): exit 0, last lines: `212 passed, 0 failed`
- `ruff check src/ tests/`: exit 0
- Secret scan on changed files: exit 0
- `git diff origin/main...HEAD --stat`: 4 files, all listed in the plan

## Not verified

- Integration tests: no database in the sandbox.
- Staging deploy: not requested.
```

The rules behind the template:

- Evidence names the exact command, directory, commit SHA, exit code and the relevant tail of output.
- A run is only evidence for the commit it ran on. Any edit after a passing run invalidates it, so the final check must come after the final edit.
- "Not verified" and "failed" are different. A timeout, missing tool or sandbox denial is not verified, and must never be reported as pass.
- Skipped steps are reported with a reason. Silently dropping a step is a reject.

## Make the gate deterministic where you can

Do not rely on the agent remembering to run the checks. A stop-time hook can re-run the test script and block the agent from ending its turn while it fails (check whether your tool offers this and how it behaves; see [[deterministic-hooks-for-coding-agents]]).

```bash
#!/usr/bin/env bash
# scripts/verify.sh - one entry point used by the agent, hooks and CI
set -Eeuo pipefail

base="${1:-origin/main}"
log="${VERIFY_LOG:-verify.log}"
sha=$(git rev-parse --short HEAD)
: > "$log"
list=$(mktemp)
trap 'rm -f "$list"' EXIT

run() { echo "+ $*" | tee -a "$log"; "$@" 2>&1 | tee -a "$log" | tail -n 15; }

run make build
run make test
run ruff check .
# Not `mapfile < <(git diff ...)`: a process substitution's exit status is lost, so a missing
# base or a shallow clone would leave the list empty and the gate would pass unchecked.
# NUL-separated names go through a file, so a failing git diff stops the script (set -e) and a
# name with a newline or a leading dash stays one argument.
git diff -z --name-only --diff-filter=d "$base"...HEAD > "$list"
mapfile -d '' -t changed < "$list"
if (( ${#changed[@]} == 0 )); then
  echo "no changed files against $base; refusing to report VERIFIED" | tee -a "$log" >&2
  exit 1
fi
# `--` ends option parsing; your scanner must honour it (check), or pass paths another way.
run scripts/scan-secrets.sh -- "${changed[@]}"

echo "VERIFIED commit=$sha" | tee -a "$log"
```

Because it uses `set -Eeuo pipefail`, a failing stage stops the script, and the final `VERIFIED` line only prints if all stages passed. Strict mode does not cover every construct: a failure inside a process substitution such as `< <(git diff ...)` is not seen, so write the output to a file with a plain redirect, which `set -e` does check, read the NUL-separated names from it, and treat an empty change list as an error. A single entry point also means the agent, a hook and CI cannot disagree about what "done" is.

This gate is defined in the branch it checks, so a change that edits `scripts/verify.sh`, `scripts/scan-secrets.sh`, the `Makefile` or `.gitlab-ci.yml` can make itself pass, and so can a change to `scripts/detect-test-weakening.sh` or to a CI file pulled in with `include:`. Treat changes to those files as needing human sign-off (the detector below flags them), and require code-owner approval for them on the protected branch (check how your hosting plan enforces it). The detector runs from the branch it checks, so it cannot catch an edit that disables its own copy: the real control is code-owner approval, or running the base branch's copy (for example `git show "$base":scripts/detect-test-weakening.sh | bash -s -- "$base"`). A gate is only as strong as the review of changes to the gate.

For high-stakes changes add an independent reviewer whose job is to refute the result, ideally a separate agent or model with a fresh context that reads the final diff and tries to find what the author missed ([[independent-review-agents]]). A second reading of the diff is cheaper than an incident.

## Local green is not CI green

Local verification and CI verification are different claims. State which one was observed and link the run, and check that the run's head SHA matches the pushed commit. Enforce the server side with required status checks on the protected branch, and limit which identities may report a status, since a check that any integration can set is weak evidence. Check how your hosting plan treats administrators and whether the branch must be up to date before merge.

```yaml title=".gitlab-ci.yml"
verify:
  stage: test
  image: registry.example.com/ci/toolbox@sha256:<digest> # change: an image with your build and test tools, pinned by digest
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  script:
    - git fetch --no-tags origin "+refs/heads/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}:refs/remotes/origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}"
    - scripts/verify.sh "origin/${CI_MERGE_REQUEST_TARGET_BRANCH_NAME}"
  artifacts:
    when: always
    expire_in: 1 week
    paths: [verify.log]
```

On a shallow clone the three-dot diff may not find a merge base; `verify.sh` then exits non-zero. Increase the clone depth for this job (check the runner documentation for your version) rather than weakening the check.

## Minimum checklist per change

At least: build, unit tests for touched code, linter and formatter on changed files, a secret scan, and a review of the final `git diff` for unrelated edits. Add integration or manual checks only where the change touches them. For infrastructure work, done also means a reviewed plan or dry run, not just code that parses ([[validating-ai-generated-infrastructure-code]]). If the change touches docs, see [[ai-docs-drift-and-verification]].

## Bound the loop and watch for tampering

When a check fails repeatedly the agent tends to keep editing. Set a local limit on attempts at the same check, then stop and report the failing output and hypotheses. The number is a policy choice, not a standard. Unbounded loops often end with weakened tests.

Treat any diff that deletes, skips or loosens tests, snapshots or lint rules in the same change as a fix as a flag requiring human sign-off. The same goes for any change to the gate's own files. A simple detector, which covers only the paths it lists:

```bash title="scripts/detect-test-weakening.sh"
#!/usr/bin/env bash
# Sketch: fails when the diff deletes assertions, adds skips and lint suppressions,
# or touches the gate's own files. It covers only the paths listed below.
set -Eeuo pipefail

base="${1:-origin/main}"
gate=(
  scripts/verify.sh scripts/scan-secrets.sh scripts/detect-test-weakening.sh Makefile
  ':(glob)**/*.gitlab-ci.yml' ':(glob)ci-templates/**' ':(glob)**/*.mk' # add your other CI include files here
)
watched=(
  ':(glob)tests/**' ':(glob)**/*.test.*' ':(glob)**/__snapshots__/**'
  ':(glob)**/.eslintrc*' ':(glob)**/eslint.config.*' ':(glob)**/jest.config.*'
  ':(glob)**/ruff.toml' ':(glob)**/.ruff.toml' ':(glob)**/pyproject.toml' ':(glob)**/pytest.ini' ':(glob)**/conftest.py'
  ':(glob)**/setup.cfg' ':(glob)**/tox.ini'
)

# A failing git diff (missing base, shallow clone) stops the script here: fail closed.
gate_out=$(git diff --name-only "$base"...HEAD -- "${gate[@]}")
if [[ -n "$gate_out" ]]; then
  printf '%s\n' "$gate_out"
  echo "Gate files changed: needs human sign-off" >&2
  exit 1
fi
diff_out=$(git diff -U0 "$base"...HEAD -- "${watched[@]}")
# The optional group lets a keyword start the line; it cannot match the +++ and --- file headers.
if printf '%s\n' "$diff_out" | grep -E '^-([^-].*)?(assert|expect)|^\+([^+].*)?(skip|xfail|\.only|noqa|eslint-disable)'; then
  echo "Test or lint weakening detected: needs human sign-off" >&2
  exit 1
fi
echo "no matches in the gate files or in: ${watched[*]}"
```

## Failure modes

- The agent reports "all tests pass" from a run before its last edit.
- A tool is missing in the sandbox and the report says pass.
- The agent verified a different branch, directory or fixture set than the one under review.
- CI is green on an older SHA.
- Done is judged by reading the agent's summary instead of the diff and logs.
- The failing test is fixed by deleting the assertion.
- The reviewer approves a report that has no "Not verified" section, so skipped work is invisible.

## Review checklist

- [ ] Done criteria are written as commands and expected results before work starts.
- [ ] The final report lists commands, directory, SHA, exit codes and output tails.
- [ ] Checks ran after the last edit.
- [ ] "Not verified" is reported separately from "failed", with reasons.
- [ ] CI result is linked and its head SHA matches the pushed commit.
- [ ] Required status checks guard the protected branch.
- [ ] A secret scan and a final diff review were done.
- [ ] Tests, snapshots and lint rules were not weakened, or a human signed off.
- [ ] Retries are bounded and a stuck agent reports instead of continuing.
- [ ] High-stakes changes had an independent reviewer.

## Sources

- [NIST SP 800-218, Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - governance framing for integrating verification into the development lifecycle.
- [SLSA: distributing provenance](https://slsa.dev/spec/v1.0/distributing-provenance) - verifiable provenance, relevant when done includes released artifacts.
