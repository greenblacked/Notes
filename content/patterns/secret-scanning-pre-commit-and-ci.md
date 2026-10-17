---
title: Secret scanning in pre-commit hooks and CI
description: Layer gitleaks in a pre-commit hook, a GitLab merge request job and a scheduled history scan, with baselines, reasoned allowlists and a clear hand-off to rotation.
type: pattern
tags:
  - patterns
  - security
  - ci-cd
  - gitlab-ci
created: 2026-10-17
modified: 2026-10-17
draft: false
---

This note shows how to keep secrets out of Git with gitleaks: a fast pre-commit hook for the developer, a CI job that is the real control, a scheduled scan of the full history and the platform's own push protection. It is for senior DevOps engineers who run GitLab CI. What to do after a secret is found (rotate, revoke, review use) stays in [[runbooks/leaked-credential-rotation]]; how to avoid having secrets in repositories at all is in [[patterns/external-secrets-with-secret-manager]].

> [!info] Scope and sources
> Written against gitleaks v8 as described in its README and the pre-commit and GitLab CI documentation on docs.gitlab.com. No gitleaks version is pinned here; pin the release you reviewed.

> [!note] Not verified
> The claims below were written from documentation knowledge and were not checked against a running system or the current docs: gitleaks subcommand changes between versions (`detect` and `protect` versus `git` and `dir`), configuration key names (the single `allowlist` table versus the newer `allowlists` array of tables), which gitleaks release first supports the JUnit and SARIF report formats and `--baseline-path`, how baseline matching behaves with `--redact` reports, and which GitLab tiers include built-in secret detection and push protection. Check them before relying on them.

## Layers

No single layer is enough. A hook catches the mistake while it is cheap to fix, CI catches what the hook missed, a scheduled scan catches what was already in history, and the platform can block the push itself.

| Layer                       | Runs where                   | Catches                            | Can be skipped?                         | Role                          |
| --------------------------- | ---------------------------- | ---------------------------------- | --------------------------------------- | ----------------------------- |
| Pre-commit hook             | Developer machine            | Staged changes before the commit   | Yes (`--no-verify`, hook not installed) | Fast feedback, not a control  |
| CI job on merge request     | Runner                       | New commits in the merge request   | No, if the job is required              | The control                   |
| Scheduled full-history scan | Runner, nightly or weekly    | Old history, new rules, bad merges | No                                      | Safety net and baseline check |
| Platform push protection    | Git server (check your tier) | Known token formats on push        | Only by an explicit, logged bypass      | Blocks before it lands        |

The rule: the hook is a convenience; **CI is the control**, because any developer can skip a hook and new clones have no hooks until someone installs them. Make the CI job a required check on the default branch.

AI coding agents and assistants make this more important, not less: they read environment files and paste values into code and logs. See [the owner's AI skills catalogue](https://ai.szolotov.com) and [[ai/securing-ai-agents-in-ci-and-cloud]] for how to limit what an agent can read in the first place.

## Pre-commit hook

Use the `pre-commit` framework so the hook version is pinned in the repository and every developer runs the same one.

```yaml title=".pre-commit-config.yaml"
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: vX.Y.Z # change: a gitleaks release you reviewed that supports junit reports and --baseline-path
    hooks:
      - id: gitleaks
```

```bash
set -euo pipefail

pip install --user pre-commit   # or your package manager
pre-commit install
pre-commit run gitleaks --all-files
```

Document the install step in the repository README and in your onboarding checklist ([[management/onboarding-engineers]]). Do not rely on it being installed.

## CI job

The job below runs on every merge request and on the default branch. It scans only the commits the merge request adds, redacts values in the log and the report, and exits non-zero on any finding. The JUnit report shows each finding as a failed test in the merge request.

```yaml title=".gitlab-ci.yml (fragment)"
secret-scan:
  stage: test
  image:
    name: ghcr.io/gitleaks/gitleaks:vX.Y.Z # change: the same reviewed release as the hook, by tag or digest
    entrypoint: [""]
  variables:
    GIT_DEPTH: "0" # full history so the commit range resolves
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      variables:
        SCAN_RANGE: "${CI_MERGE_REQUEST_DIFF_BASE_SHA}..${CI_COMMIT_SHA}"
    - if: $CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      variables:
        SCAN_RANGE: "${CI_COMMIT_BEFORE_SHA}..${CI_COMMIT_SHA}"
  script:
    # Scheduled, web and API pipelines (and the first push to a branch) have an
    # all-zero CI_COMMIT_BEFORE_SHA: scan the last commit only in that case.
    - |
      case "$SCAN_RANGE" in
        0000000000000000000000000000000000000000..*) SCAN_RANGE="${CI_COMMIT_SHA}~1..${CI_COMMIT_SHA}" ;;
      esac
    - >
      gitleaks detect
      --source .
      --config .gitleaks.toml
      --log-opts="${SCAN_RANGE}"
      --redact
      --verbose
      --exit-code 1
      --report-format junit
      --report-path gitleaks-report.xml
  artifacts:
    when: always
    expire_in: 14 days
    paths:
      - gitleaks-report.xml
    reports:
      junit: gitleaks-report.xml
  allow_failure: false

secret-scan-full-history:
  stage: test
  image:
    name: ghcr.io/gitleaks/gitleaks:vX.Y.Z # change: same reviewed release
    entrypoint: [""]
  variables:
    GIT_DEPTH: "0"
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  script:
    # The CI clone has only the pipeline's branch: fetch every branch and tag first.
    - git fetch origin '+refs/heads/*:refs/remotes/origin/*' '+refs/tags/*:refs/tags/*'
    - >
      gitleaks detect
      --source .
      --config .gitleaks.toml
      --redact
      --exit-code 1
      --report-format json
      --report-path gitleaks-history.json
  artifacts:
    when: always
    expire_in: 30 days
    paths:
      - gitleaks-history.json
```

Create a pipeline schedule (weekly is a reasonable start) that runs the second job. The first job's default-branch rule matches push pipelines only, because scheduled, web and API pipelines have an all-zero `CI_COMMIT_BEFORE_SHA` and a range starting with it cannot be resolved; the script also falls back to the last commit when it sees that value. The fetch line makes the scheduled job see all branches and tags; without it the job covers only the default branch.

The report files contain match metadata. With `--redact` the secret value is hidden, but the file and line are not, so treat the artifact as internal.

## Allowlists and baselines

Two different tools for two different problems:

- **Allowlist** for things that will never be secrets: a fake key in a test fixture, a documented example token. Keep it in `.gitleaks.toml`, narrow (a path or a specific regex, never a whole directory like `src/`), with a comment that says why. Allowlist changes go through code review like any rule change ([[standards/code-review]]).
- **Baseline** for findings that already exist in history and cannot be removed yet. Generate it once, commit it, and the scan reports only new findings. A baseline is a debt list: every entry needs a rotation ticket.

```toml title=".gitleaks.toml"
title = "Repository gitleaks configuration"

[extend]
useDefault = true # keep the built-in rules and add ours on top

# Check the key names for your gitleaks version: newer releases use an allowlists array of tables.
[allowlist]
description = "Fake credentials used by unit tests. The values are random strings that authenticate nowhere."
paths = [
  '''^tests/fixtures/fake-credentials/''',
]
```

```bash
set -euo pipefail

# Create the baseline once, from the current history.
gitleaks detect --source . --redact --report-format json --report-path .gitleaks-baseline.json || true

# Every later scan reports only findings that are not in the baseline.
gitleaks detect --source . --redact --baseline-path .gitleaks-baseline.json --exit-code 1
```

Add `--baseline-path .gitleaks-baseline.json` to the CI commands while the baseline exists, and delete the file when the last entry is rotated. The `|| true` in the first command is there only because gitleaks exits non-zero when it finds something while writing a baseline.

For a single known false positive, gitleaks also supports a fingerprint file (`.gitleaksignore`). Prefer it over a regex for one-off cases, and give each line a comment.

## Scanning history

Scan the whole history in three situations: when you introduce scanning to an existing repository, after adding or changing rules, and on a schedule.

```bash
set -euo pipefail

REPO_URL="git@gitlab.example.com:team/service.git"   # change: the repository to scan
WORKDIR="$(mktemp -d)"

git clone --mirror "$REPO_URL" "$WORKDIR/repo.git"
cd "$WORKDIR/repo.git"

# --exit-code 0: findings must not stop the script before the count is printed.
gitleaks detect --source . --redact --exit-code 0 --report-format json --report-path "$WORKDIR/history.json"
jq 'length' "$WORKDIR/history.json"
```

Use a mirror clone to include all branches and tags, not only the default branch. Remember that a deleted branch can still hold a secret in the server's object store and in forks and caches. Removing a secret from history (a rewrite) is a separate, disruptive decision and never replaces rotation.

## What to do on a finding

1. Treat the secret as compromised the moment it was pushed to a shared remote. A force-push does not un-leak it.
2. Rotate or revoke it first, following [[runbooks/leaked-credential-rotation]]. Removing it from the code comes second.
3. Replace it with a reference to the secret manager ([[patterns/external-secrets-with-secret-manager]]) so the fix does not just move the value to another file.
4. If the finding is a false positive, add the narrowest allowlist entry with a reason, in a reviewed change.
5. Record what happened and how it was found. A pattern of findings points to a missing control, not to careless developers.

## Platform push protection

GitLab and GitHub can reject a push that contains a known token format. This is the earliest layer that cannot be skipped locally. Which tiers include it, and whether it covers your token types, is not verified here: check your plan and the platform documentation. Push protection does not replace the CI job, since it only knows formats the platform has rules for, and your internal tokens need custom gitleaks rules.

## Pitfalls

- **Hook as the only control.** It is skipped by `--no-verify`, by new clones and by web edits.
- **Different versions in the hook and in CI.** Findings then differ between laptop and pipeline. Pin both.
- **Shallow clones.** With the default `GIT_DEPTH` the commit range cannot be resolved and the job silently scans less. Set `GIT_DEPTH: "0"` for the job.
- **Broad allowlists.** An allowlist on `src/` or on a whole file type is a permanent hole.
- **Unredacted reports.** A report with raw values is a new leak. Always use `--redact`.
- **Fixing the code but not the credential.** The secret is still valid and still in history.
- **Custom internal token formats are invisible.** Add a custom rule with a recognisable prefix to internal tokens.

## Verify

```bash
set -euo pipefail

WORKDIR="$(mktemp -d)"
cd "$WORKDIR"
git init -q .
git config user.email "test@example.com"
git config user.name "Scanner Test"

# A made-up token in the GitLab personal access token format (glpat- plus 20 characters).
# It authenticates nowhere. The AWS documentation example keys are not used because
# the default rules likely allowlist values ending in EXAMPLE.
printf 'token = glpat-FAKEFAKEFAKEFAKEFAKE\n' > config.ini
git add config.ini
git commit -q -m "test: add sample key"

gitleaks detect --source . --redact --exit-code 1 && echo "NOT DETECTED: check your setup" || echo "detected as expected"
```

Expected: gitleaks reports a finding with the value redacted, and the script prints `detected as expected`. Then open a merge request that adds a similar line and confirm the `secret-scan` job fails and the finding shows in the merge request's test report. If the made-up token is not flagged by the default rules in your version, add a custom test rule with a recognisable prefix and confirm the job turns red.

## Rollback

If a rule produces too many false positives and blocks work, do not disable the job. Narrow the rule or add a reasoned allowlist entry in a reviewed change, or temporarily set `allow_failure: true` on the job with a deadline in the merge request description and an owner. Restore blocking behaviour as soon as the rule is fixed.

## Related

- [[runbooks/leaked-credential-rotation]]: what to do after a finding is confirmed.
- [[patterns/external-secrets-with-secret-manager]]: where secrets should live instead of Git.
- [[standards/code-review]]: reviewers check allowlist and baseline changes like rule changes.
- [[ai/securing-ai-agents-in-ci-and-cloud]]: limiting what AI agents can read and write. See also [the owner's AI skills catalogue](https://ai.szolotov.com).
