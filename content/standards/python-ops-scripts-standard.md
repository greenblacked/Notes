---
title: Python ops script standard
description: Layout, version policy, hashed dependencies, CLI, logging, exit codes, subprocess and cloud SDK safety, and the CI gate for Python in ops repositories.
type: standard
tags:
  - standards
  - ci-cd
  - security
  - gitlab-ci
  - linux
created: 2026-10-21
modified: 2026-10-21
draft: false
---

[[bash-scripts]] says when to stop writing Bash: structured data, retries, real error handling, tests, more than a screen of logic. This standard says what the Python that replaces it must look like in an ops repository: a cleanup job, an inventory exporter, a migration helper, a CronJob's entry point. The goal is the same as for Bash: every script has the same skeleton, previews before it changes anything, fails loudly with a meaningful exit code, never leaks a secret, and passes the same CI gate.

For learning the language in an ops context see [[learn/python-for-ops]]. Services and libraries with their own release process follow their team's standards; this note is about scripts and small tools that operators run.

## Scope

Applies to Python in repositories we own that runs against shared environments: CI jobs, scheduled jobs ([[scheduled-jobs-standard]]), runbook helpers and operator tools. Notebooks and one-off exploration on a laptop are out of scope until they touch a shared environment.

> [!info] Keywords
> MUST means the CI gate or a reviewer blocks the merge. SHOULD means the author explains a deviation in the merge request. The dry-run default, the log fields, the exit-code mapping, the lint rule set and every number that is not quoted from documentation are proposed team defaults and are labelled so. Library behaviour was checked on 2026-10-21 against the documentation sources in Sources.

## Layout

Two shapes are allowed.

**Single file** (SHOULD for stdlib-only tools under a few hundred lines, a proposed team default): `scripts/<name>.py`, with a module docstring that states purpose, usage and exit codes, the same header contract as a Bash script.

**Small package** when the tool has third-party dependencies, several modules or shared code:

```text title="Package layout"
tools/ns-reaper/
  pyproject.toml          # metadata and tool config (ruff, mypy, pytest)
  requirements.in         # direct runtime dependencies, loose pins
  requirements.txt        # generated lock: every package pinned with == and hashed
  requirements-dev.in
  requirements-dev.txt    # generated lock for lint and test tools
  ns_reaper/
    __init__.py
    __main__.py           # from ns_reaper.cli import main; raise SystemExit(main())
    cli.py
  tests/
    test_cli.py
  README.md
```

Rules for both shapes:

- All logic lives in functions. The entry point is `main(argv) -> int`, and the module ends with `sys.exit(main())` under `if __name__ == "__main__":`. Importing the module has no side effects, so tests can call `main` directly.
- No work at import time: no API calls, no reading of credentials, no logging configuration outside `main`.
- Run the tool as `python -m <package>` or `python scripts/<name>.py`, never by importing it from another script to run it.

## Python version policy

Python ships one feature release a year. Each release gets bug-fix releases, then security-only releases, then reaches end of life: two years of bug fixes and three more of security fixes since 3.13 (older releases had 18 months of bug fixes). The current list of supported versions and their end-of-life dates is on the [Python devguide status page](https://devguide.python.org/versions/). This note deliberately names no version.

- MUST: CI images and runtime images use a Python version in the bug-fix or security phase on that page.
- MUST: the version is pinned in the image (by digest) and stated once in `pyproject.toml` (`requires-python`).
- SHOULD: move to a newer release at least six months before the one you run reaches end of life (proposed team default). Track it with the end-of-life process in [[dependency-update-policy]].

## Dependencies

- **Standard library first.** `argparse`, `json`, `logging`, `subprocess`, `urllib.request`, `concurrent.futures` and `datetime` cover most ops scripts. Every third-party dependency is a supply-chain risk and an update to track.
- **Lock with hashes.** Runtime and dev dependencies are installed from a lock file in which every package, including transitive ones, is pinned with `==` and has a `--hash=sha256:...`. Generate it, never write it by hand: `pip-compile --generate-hashes requirements.in` (pip-tools) produces such a file.
- **Install in hash-checking mode.** `pip install --require-hashes -r requirements.txt`. Hash-checking is all or nothing: once any requirement has a hash, pip demands hashes for all of them, so a missing transitive pin fails the install instead of slipping through. Add `--only-binary :all:` where every package has wheels, so no `setup.py` runs during install.
- **Resolve through Artifactory.** pip uses the virtual repository from [[adr/0007-language-packages-resolve-through-artifactory]], set with `PIP_INDEX_URL` as a masked CI variable. Never put a token in `pip.conf` or in the repository, and never run verbose pip in CI with credentials in the URL, because pip prints the index URL.
- **Always a virtual environment.** `python -m venv .venv`; never `pip install` into the system or image interpreter at run time.
- Updates follow [[dependency-update-policy]], and the lock file is regenerated by the update bot, not edited.

Pinning with `==` alone trusts the index to serve the same file forever. The hash protects against a changed or substituted artifact.

## Command-line interface

- Use `argparse`. On invalid arguments it prints usage to stderr and exits with status 2, which matches the Bash standard's "2 means bad usage".
- **Dry run is the default for anything that changes state** (proposed team default). The script reports what it would do; `--apply` does it. A flag that makes a script more dangerous must be typed; a flag that makes it safer must not be required.
- The target is explicit: `--project`, `--context`, `--environment` are required arguments, never taken silently from the current `gcloud` or `kubectl` configuration.
- Destructive scripts SHOULD have a cap (`--max-deletes`, default small) that aborts when the plan is larger than expected.
- Secrets never come from arguments: arguments appear in process listings and CI logs. Read them from the environment or a file mounted by the platform.

## Logging

- Use the standard `logging` module, configured once in `main`. No `print` for diagnostics.
- Logs are one JSON object per line with the field names of [[structured-logging-conventions]] (`severity`, `message`, `time`, `service`, `version`, `env`, plus `event` and other fields). The standard library has no JSON formatter, so the formatter is a short class (in the template below); keep one copy per repository.
- Logs go to **stderr**, as in the Bash standard, so stdout stays free for data another command reads. A job whose only output is logs may use stdout instead; how your log agent sets severity per stream was not verified here, so keep `severity` in the JSON either way.
- Log the intent before a change ("deleting namespace X"), the result after it, and one summary line at the end.
- Never log secrets, tokens, request bodies or environment dumps. Do not log `os.environ`, a full `subprocess` command that carries a credential, or an exception from an HTTP client without checking what it contains.

## Exit codes

Aligned with [[bash-scripts]]:

| Code | Meaning                                                      | Where it comes from                                 |
| ---- | ------------------------------------------------------------ | --------------------------------------------------- |
| 0    | Success, including a dry run that found work to do           | `return 0` from `main`                              |
| 1    | Runtime failure: an API or command failed, bad data          | Caught exception in `main`, logged, `return 1`      |
| 2    | Bad usage                                                    | `argparse`, which exits with 2 on invalid arguments |
| 130  | Interrupted with Ctrl-C (128 + SIGINT, the shell convention) | `KeyboardInterrupt` handled at the entry point      |

Any other code is documented in the module docstring, for example `3` for "skipped: another run holds the lock" in a scheduled job. Do not let an unexpected exception escape with a traceback as the only signal: catch at the top of `main`, log it with `error.type`, and return 1.

## subprocess safety

`subprocess.run` defaults to `shell=False`, `check=False` and `timeout=None`. The last two defaults are exactly why this standard requires explicit values: without them a failed command is ignored and a hung one blocks forever.

- MUST pass the command as a **list** of arguments. The library then calls no shell, and shell metacharacters in values are passed through safely.
- MUST NOT use `shell=True` with any value that comes from outside the script. The Python docs leave all quoting to the caller when a shell is used, which is how shell injection happens. If a shell is truly needed (a pipeline of tools), record an exception, build the command from constants and quote every variable with `shlex.quote`.
- MUST set `check=True` (or check `returncode` explicitly) and a `timeout=`. On timeout the child is killed and `subprocess.TimeoutExpired` is raised; a non-zero exit with `check=True` raises `subprocess.CalledProcessError`.
- Ask tools for machine output (`--format=json`, `-o json`) and parse it with `json`; never parse human-readable tables.
- Pass `env=` explicitly when the child must not inherit secrets from the parent environment.

## Cloud SDKs and credentials

- Authenticate with **Application Default Credentials** (ADC): `google.auth.default()` returns the credentials and project the environment provides. In CI and on GKE that is a keyless identity (Workload Identity Federation per [[adr/0026-keyless-ci-auth-with-workload-identity-federation]], or the workload's service account). On a laptop, `gcloud auth application-default login` writes user credentials for client libraries.
- MUST NOT use service account key files, and MUST NOT set `GOOGLE_APPLICATION_CREDENTIALS` to a key. The `gcloud` help still shows a key-file example; do not copy it.
- MUST set an explicit timeout and a bounded retry on every API call, and retry only idempotent operations. Read the method's `timeout` and `retry` parameters in the client library reference; the defaults differ per API and were not checked for this note. The general rules are in [[timeouts-retries-load-shedding]].
- Pass the project explicitly to clients rather than relying on the ADC project, so a script cannot act on the wrong project because of someone's local configuration.

> [!note] Not verified
> The order in which ADC searches for credentials, and the default retry and timeout settings of the Google Cloud client libraries, were not checked for this note. See the [ADC page](https://cloud.google.com/docs/authentication/application-default-credentials) and the reference for the client library you use.

## Secrets

- Read secrets from environment variables injected by CI (masked and protected) or from files mounted by the platform (a Kubernetes Secret synced from Secret Manager). See [[architecture/secrets-architecture-gcp-and-gke]].
- Fetch from Secret Manager at run time only when the platform cannot inject the secret, using ADC, and keep the value in memory.
- Never write a secret to a temporary file without restrictive permissions and cleanup, never put one in an exception message, and never commit one. [[secret-scanning-pre-commit-and-ci]] is the backstop, not the plan.

## Lint, format and types

- MUST: `ruff check` and `ruff format --check` pass in CI. Pin the ruff version in the dev lock file and **select rules explicitly**: the default rule set has changed between ruff releases, so relying on it lets an upgrade change the gate silently.
- SHOULD: a type checker (`mypy` with `strict = true`, or `pyright` in `strict` mode) on new code. Retrofitting strict typing to an old script is a separate change.

```toml title="pyproject.toml"
[project]
name = "ns-reaper"
version = "1.0.0"
description = "Delete expired ephemeral review namespaces"
# requires-python: set to the oldest Python version you support, taken from the
# devguide status page; this note deliberately names no version.
dependencies = []

[tool.ruff]
line-length = 100

[tool.ruff.lint]
# Proposed team default: pyflakes, pycodestyle errors, bugbear, pyupgrade,
# flake8-bandit security checks and ruff's own rules.
select = ["F", "E", "B", "UP", "S", "RUF"]

[tool.ruff.lint.per-file-ignores]
"tests/*" = ["S101"] # assert is how pytest tests work

[tool.mypy]
strict = true

[tool.pytest.ini_options]
testpaths = ["tests"]
```

> [!warning] Check the rule codes for your ruff version
> The rule groups `F`, `E`, `B`, `UP`, `S` and `RUF` exist; the exact rules inside each group, the code `S101` for `assert`, and which `S` rules flag `subprocess` calls were not verified here. Run `ruff check --select S .` once on the repository and decide which findings to fix and which to suppress per line with a reason, as with ShellCheck.

## Tests

- Use `pytest`, run as `python -m pytest` from the tool's root (that form adds the current directory to `sys.path`, so tests can import the tool).
- Test the pure functions (parsing, planning, filtering) with fixed inputs, and test that a dry run changes nothing by replacing the function that runs commands.
- Test bad usage: `main` with invalid arguments raises `SystemExit` with code 2.
- No test calls a real cloud API or cluster. Integration runs go against a disposable project in a separate job.

## Template

A complete stdlib-only script. It deletes Kubernetes namespaces labelled as ephemeral once they are older than a maximum age, a typical review-environment cleanup. Change the label selector, service name and limits to your own.

```python title="scripts/ns_reaper.py"
#!/usr/bin/env python3
"""ns_reaper.py - delete ephemeral review namespaces older than a maximum age.

Usage: ns_reaper.py --context CONTEXT --max-age-hours N [--max-deletes N] [--apply]
Dry run is the default; --apply deletes.
Exit codes: 0 ok, 1 runtime failure, 2 bad usage, 130 interrupted.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

SERVICE = "ns-reaper"
VERSION = os.environ.get("SERVICE_VERSION", "unknown")
ENV = os.environ.get("DEPLOY_ENV", "unknown")
LABEL_SELECTOR = "example.com/ephemeral=true"  # change: the label your namespaces carry
COMMAND_TIMEOUT_S = 60  # proposed team default

log = logging.getLogger(SERVICE)


class JsonFormatter(logging.Formatter):
    """One JSON object per line, with the fields from the structured logging standard."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "severity": record.levelname,  # DEBUG, INFO, WARNING, ERROR, CRITICAL
            "message": record.getMessage(),
            "time": datetime.fromtimestamp(record.created, tz=timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "service": SERVICE,
            "version": VERSION,
            "env": ENV,
        }
        entry.update(getattr(record, "fields", {}))
        if record.exc_info:
            entry["error.stack"] = self.formatException(record.exc_info)
        return json.dumps(entry, separators=(",", ":"), ensure_ascii=False)


def setup_logging(verbose: bool) -> None:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.DEBUG if verbose else logging.INFO)


class CommandError(RuntimeError):
    """A command failed, timed out or was not found. The message is safe to log."""


def run(cmd: Sequence[str], timeout: int = COMMAND_TIMEOUT_S) -> str:
    """Run a command without a shell, with a timeout, and return its stdout."""
    try:
        result = subprocess.run(
            list(cmd), check=True, capture_output=True, text=True, timeout=timeout
        )
    except subprocess.TimeoutExpired as exc:
        raise CommandError(f"{cmd[0]} timed out after {timeout}s") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip()[:500]
        raise CommandError(f"{cmd[0]} exited {exc.returncode}: {detail}") from exc
    except OSError as exc:
        raise CommandError(f"{cmd[0]} could not be started: {exc}") from exc
    return result.stdout


def fields(event: str, **values: Any) -> dict[str, Any]:
    """Build the logging `extra` argument: a stable event name plus structured fields."""
    return {"fields": {"event": event, **values}}


def positive_int(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog=SERVICE, description="Delete expired ephemeral review namespaces."
    )
    parser.add_argument("--context", required=True, help="kubectl context (explicit target)")
    parser.add_argument("--max-age-hours", type=positive_int, required=True)
    parser.add_argument(
        "--max-deletes", type=positive_int, default=20, help="abort if more would be deleted"
    )
    parser.add_argument("--apply", action="store_true", help="delete; otherwise only report")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def find_expired(namespaces: dict[str, Any], now: datetime, max_age: timedelta) -> list[str]:
    """Return names of namespaces older than max_age that are not already terminating."""
    expired = []
    for item in namespaces.get("items", []):
        meta = item["metadata"]
        created = datetime.fromisoformat(meta["creationTimestamp"].replace("Z", "+00:00"))
        if now - created > max_age and item.get("status", {}).get("phase") != "Terminating":
            expired.append(meta["name"])
    return sorted(expired)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    setup_logging(args.verbose)
    mode = "apply" if args.apply else "dry-run"
    kubectl = ["kubectl", "--context", args.context, "--request-timeout=30s"]
    log.info("starting", extra=fields("reaper.start", mode=mode, context=args.context))
    try:
        raw = run([*kubectl, "get", "namespaces", "-l", LABEL_SELECTOR, "-o", "json"])
        expired = find_expired(
            json.loads(raw), datetime.now(timezone.utc), timedelta(hours=args.max_age_hours)
        )
        if len(expired) > args.max_deletes:
            log.error(
                "plan larger than --max-deletes, aborting",
                extra=fields("reaper.cap", count=len(expired), cap=args.max_deletes),
            )
            return 1
        for name in expired:
            if not args.apply:
                log.info("would delete namespace", extra=fields("reaper.plan", namespace=name))
                continue
            log.info("deleting namespace", extra=fields("reaper.delete", namespace=name))
            run([*kubectl, "delete", "namespace", name, "--ignore-not-found", "--wait=false"])
    except CommandError as exc:
        error = {"error.type": "CommandError", "error.message": str(exc)}
        log.error("command failed", extra=fields("reaper.failed", **error))
        return 1
    except (json.JSONDecodeError, KeyError, ValueError) as exc:
        log.error(
            "unexpected kubectl output",
            extra=fields("reaper.failed", **{"error.type": type(exc).__name__}),
        )
        return 1
    log.info("finished", extra=fields("reaper.done", mode=mode, count=len(expired)))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
```

What makes it safe to run twice: namespaces already terminating are skipped, `--ignore-not-found` turns a race into a no-op, and the cap stops a wrong label selector from deleting everything. The kubectl context is a required argument, never the current context.

The test imports `scripts.ns_reaper` without an `__init__.py` in `scripts/`: run from the repository root with `python -m pytest`, Python treats `scripts/` as an implicit namespace package. Add an empty `scripts/__init__.py` if your tooling (for example mypy) wants a regular package.

```python title="tests/test_ns_reaper.py"
import json
from datetime import datetime, timedelta, timezone

import pytest

from scripts import ns_reaper

NOW = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)


def ns(name: str, created: str, phase: str = "Active") -> dict:
    return {"metadata": {"name": name, "creationTimestamp": created}, "status": {"phase": phase}}


def test_find_expired_skips_young_and_terminating() -> None:
    data = {
        "items": [
            ns("old", "2026-10-17T12:00:00Z"),
            ns("young", "2026-10-21T10:00:00Z"),
            ns("going", "2026-10-01T00:00:00Z", phase="Terminating"),
        ]
    }
    assert ns_reaper.find_expired(data, NOW, timedelta(hours=72)) == ["old"]


def test_dry_run_deletes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def fake_run(cmd, timeout=60):  # type: ignore[no-untyped-def]
        calls.append(list(cmd))
        return json.dumps({"items": [ns("old", "2020-01-01T00:00:00Z")]})

    monkeypatch.setattr(ns_reaper, "run", fake_run)
    assert ns_reaper.main(["--context", "example-dev", "--max-age-hours", "72"]) == 0
    assert not any("delete" in call for call in calls)


def test_bad_usage_exits_2() -> None:
    with pytest.raises(SystemExit) as exc:
        ns_reaper.main(["--context", "example-dev", "--max-age-hours", "0"])
    assert exc.value.code == 2
```

## CI job

The lint and test job runs on merge requests and the default branch, from a pinned image, with the dev dependencies installed in hash-checking mode. Stage names and rules follow [[ci-pipeline-standard]].

```yaml title=".gitlab-ci.yml"
python-lint-test:
  stage: test
  image: registry.example.com/ci/python@sha256:0000000000000000000000000000000000000000000000000000000000000000 # change: pinned image with a supported Python
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  timeout: 15m
  # PIP_INDEX_URL is a masked CI/CD variable pointing at the Artifactory virtual repository.
  script:
    - python -m venv .venv
    - .venv/bin/python -m pip install --require-hashes --only-binary :all: -r requirements-dev.txt
    - .venv/bin/ruff check .
    - .venv/bin/ruff format --check .
    - .venv/bin/mypy scripts
    - .venv/bin/python -m pytest --junitxml=report.xml
  artifacts:
    when: always
    reports:
      junit: report.xml
```

`requirements-dev.txt` is the hashed lock for ruff, mypy, pytest and the runtime dependencies. The image digest is a placeholder.

> [!note] Not verified
> The pytest `--junitxml` option and the exact mypy and pyright strict-mode behaviour were not re-read for this note, and the job was not run. The template script was exercised only against a stub `kubectl` (dry run, apply, bad usage, missing binary), never against a cluster, and ruff and mypy were not run on it. Test it on a branch with a deliberate lint error and a failing test before making it a required check.

## Troubleshooting

| Symptom                                               | Likely cause and fix                                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pip install` fails with a missing-hash error         | A transitive dependency is not in the lock. Regenerate the lock with `--generate-hashes`; do not add a hash by hand                     |
| Hash mismatch for a package that installed yesterday  | A different file was served (another wheel, or a changed artifact). Stop and check the Artifactory remote before regenerating           |
| The job hangs until the CI timeout                    | A `subprocess.run` or API call without a timeout. Add one; find it with the last log line before the hang                               |
| `CalledProcessError` with an empty message            | The tool wrote its error to stdout. Log a trimmed `exc.stdout` as well, after checking it carries no secret                             |
| Works on a laptop, fails in CI with permission errors | ADC on the laptop is the user's own identity; CI runs as the workload identity, which lacks the role. Fix the role, not the credentials |
| A dry run in CI deletes things                        | Someone added `--apply` to the default job. Require `--apply` only in a manual, protected job                                           |

## Exceptions

A script that cannot meet a rule (a vendor SDK that forces a shell call, a tool that cannot run in hash-checking mode) records the rule, the reason, an owner and an expiry date (proposed default 90 days) through [[policy-exception-and-waiver-process]]. Service account key files and secrets in arguments are not accepted as exceptions.

## Reviewer checklist

- [ ] `main(argv) -> int`, `sys.exit(main())` under `__main__`, no work at import time; docstring states usage and exit codes.
- [ ] Python version from the supported list, pinned in the image and in `requires-python`.
- [ ] Dependencies locked with hashes and installed with `--require-hashes` through Artifactory; stdlib preferred.
- [ ] `argparse`; dry run by default, `--apply` to change; the target is a required argument; a cap on destructive plans.
- [ ] JSON logs with the standard fields; no secrets, environment dumps or request bodies in logs.
- [ ] Exit codes 0, 1, 2 (and 130), others documented.
- [ ] `subprocess.run` with a list, `check=True`, `timeout=`; no `shell=True` without an exception.
- [ ] ADC with a keyless identity; no key files; explicit project, timeouts and bounded retries on API calls.
- [ ] `ruff check`, `ruff format --check` and tests pass in CI; rules selected explicitly.

## Sources

Checked 2026-10-21 against the documentation sources (the upstream repositories of these pages):

- [Python: subprocess](https://docs.python.org/3/library/subprocess.html): `run()` defaults, `TimeoutExpired`, `CalledProcessError`, security considerations.
- [Python: argparse](https://docs.python.org/3/library/argparse.html): `error()` exits with status 2.
- [Python: logging](https://docs.python.org/3/library/logging.html) and the [logging cookbook](https://docs.python.org/3/howto/logging-cookbook.html): no built-in JSON formatter; structured logging pattern.
- [Python devguide: status of Python versions](https://devguide.python.org/versions/) and [PEP 602](https://peps.python.org/pep-0602/): annual releases and support phases.
- [pip: secure installs](https://pip.pypa.io/en/stable/topics/secure-installs/) and [repeatable installs](https://pip.pypa.io/en/stable/topics/repeatable-installs/): hash-checking mode, `--require-hashes`, `--only-binary`.
- [pip-tools](https://github.com/jazzband/pip-tools): `pip-compile --generate-hashes`.
- [pyproject.toml specification](https://packaging.python.org/en/latest/specifications/pyproject-toml/)
- [Ruff: configuration](https://docs.astral.sh/ruff/configuration/) and [linter](https://docs.astral.sh/ruff/linter/): config tables, `ruff format --check`, rule selection.
- [mypy: configuration file](https://mypy.readthedocs.io/en/stable/config_file.html) and [Pyright: configuration](https://microsoft.github.io/pyright/#/configuration)
- [pytest: how to invoke pytest](https://docs.pytest.org/en/stable/how-to/usage.html): `python -m pytest` adds the current directory to `sys.path`.
- [google-auth user guide](https://googleapis.dev/python/google-auth/latest/user-guide.html) and [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials)

## Related

- [[bash-scripts]]: the sibling standard and the exit-code table.
- [[learn/python-for-ops]]: learning Python for operations work.
- [[structured-logging-conventions]]: the JSON log fields.
- [[scheduled-jobs-standard]]: when the script runs on a schedule.
- [[ci-pipeline-standard]]: where the lint and test job sits.
- [[adr/0007-language-packages-resolve-through-artifactory]]: where pip resolves packages.
- [[dependency-update-policy]] and [[automated-dependency-updates]]: keeping the lock current.
