---
title: "Scripting 03: Python for ops: venv, subprocess, CLIs, APIs and config"
description: "Write small Python ops tools: venv, safe subprocess calls, argparse CLIs, HTTP APIs with timeouts and retries, YAML config and tests."
type: guide
tags:
  - learning
  - linux
  - security
  - ci-cd
created: 2026-10-17
modified: 2026-10-17
verified: 2026-10-17
draft: false
---

> [!info] Level: junior-middle | Time: about 8 h | You need: [[learn/safe-bash-scripts|Scripting 02: Safe Bash]] and [[learn/http-and-tls|Networking 04: HTTP and TLS]] | Lab: Option A, the Ubuntu LTS VM from [[learn/lab-setup|Start 01: Set up your lab]] (any machine with a current Python 3 and a shell also works)

Bash is the glue. Python is what you reach for when the glue gets thick: when a script needs to call an API and handle its errors, read structured config, retry, report in a table or run tests. This lesson builds up the pieces one at a time and ends with a small tool, `ops-check`, that checks the health of HTTP services and the days left on their TLS certificates, with tests and an exit code CI can use.

## What you will learn

- When to choose Python over Bash, and how to set up an isolated environment with `venv` and `pip`.
- How to run other programs safely with `subprocess`, and why `shell=True` with user input is an injection hole.
- How to write a command-line tool with `argparse`, `logging` and honest exit codes.
- How to call HTTP APIs with timeouts, retries (for `GET` only), `Retry-After` and pagination, without leaking a token.
- How to read JSON and YAML config safely, and validate it so the user sees every problem at once.
- How to test the result with `pytest` and a throwaway local HTTP server.

## Python or Bash?

Use Bash for short glue: run three commands in order, set a few variables, call a tool with defaults. Switch to Python when any of these is true:

- The script has more than a screen or two of logic, or branches you want to test.
- It handles structured data: nested JSON, YAML, pagination, joins.
- It needs retries with backoff, concurrency or careful error handling around an API.
- It does date or number work that Bash cannot do well.
- Several people will change it, so it needs tests and readable structure.

A common shape is a thin Bash entry point that sets up the environment and then runs a Python module. The team rule is in [[standards/bash-scripts|the Bash script standard]], under "When not to use Bash".

## Virtual environments and pip

Python programs depend on third-party packages (`requests`, `PyYAML`). If you install them into the system Python, two projects that need different versions break each other, and you can break tools that the operating system itself uses. A **virtual environment** (venv) is a folder with its own Python and its own packages, so each project has its own set.

```bash
mkdir -p ~/lab17 && cd ~/lab17
python3 -m venv .venv
source .venv/bin/activate
which python
pip install requests PyYAML pytest
pip freeze > requirements.txt
cat requirements.txt
```

```text
/home/student/lab17/.venv/bin/python
certifi==2026.7.22
charset-normalizer==3.5.2
idna==3.20
iniconfig==2.3.1
packaging==26.3
pluggy==1.7.0
Pygments==2.21.0
pytest==9.1.1
PyYAML==6.0.3
requests==2.34.2
urllib3==2.8.0
```

_Illustrative: the home directory and every version number will differ. These were the versions pip installed on Python 3.13.16 when this lesson was tested._

`source .venv/bin/activate` puts `.venv/bin` first on your `PATH`, so `python` and `pip` now mean the environment's copies. `which python` is your proof: if it does not point into `.venv`, you are not inside it. Type `deactivate` to leave. Never commit `.venv` itself; commit `requirements.txt` and add `.venv/` to `.gitignore`.

A few rules for `requirements.txt`:

- Pin exact versions (`requests==2.34.2`) for tools that run in CI or production, so a rebuild next month installs what you tested. Let a bot propose upgrades, as in [[patterns/automated-dependency-updates]].
- `pip freeze` also lists dependencies of dependencies. That is fine for reproducing an environment. Keep a short hand-written list of what you import if you want to see your real dependencies.
- Install with `pip install -r requirements.txt` in a fresh venv to prove the file is complete.

### Why pip sometimes says "externally managed"

On recent Debian and Ubuntu releases, running `pip install` outside a venv against the system Python fails with an `externally-managed-environment` error. This is deliberate: [PEP 668](https://peps.python.org/pep-0668/) lets a distribution mark its Python as managed by the package manager, so `pip` does not overwrite files that `apt` owns.

```text
error: externally-managed-environment

× This environment is externally managed
╰─> To install Python packages system-wide, try apt install
    python3-xyz, where xyz is the package you are trying to install.
    ...
```

_Illustrative and abridged: the wording is quoted from memory and was not produced on the lab machine._

The fix is the venv you just made. Do not use `--break-system-packages` to silence the error.

> [!warning] Check before relying on this
> Which releases mark the system Python as externally managed, and the exact message, depend on your distribution and version (verify for yours). On Ubuntu, `python3 -m venv` may fail with a message about `ensurepip` until you install the `python3-venv` package.

## Running programs with subprocess

`subprocess.run` starts another program and waits for it. The safe form is a **list**: the first item is the program, the rest are its arguments, passed as they are with no shell involved.

```python
import subprocess

done = subprocess.run(["echo", "hello"], capture_output=True, text=True, check=True, timeout=5)
print(repr(done.stdout), done.returncode)
```

```text
'hello\n' 0
```

The options worth knowing:

| Option                | What it does                                                       |
| --------------------- | ------------------------------------------------------------------ |
| `capture_output=True` | Collects stdout and stderr in the result instead of printing them. |
| `text=True`           | Gives you `str` instead of `bytes`.                                |
| `check=True`          | Raises `CalledProcessError` if the exit code is not 0.             |
| `timeout=N`           | Raises `TimeoutExpired` after N seconds and kills the child.       |
| `cwd=`, `env=`        | Working directory and environment for the child.                   |

Failure shows up as an exception, which you handle where you can do something useful:

```python
try:
    subprocess.run(["ls", "/nonexistent"], capture_output=True, text=True, check=True)
except subprocess.CalledProcessError as err:
    print("failed:", err.returncode, err.stderr.strip())

try:
    subprocess.run(["sleep", "5"], timeout=1)
except subprocess.TimeoutExpired as err:
    print("timed out after", err.timeout, "seconds")

try:
    subprocess.run(["no-such-tool"])
except FileNotFoundError as err:
    print("missing:", err)
```

```text
failed: 2 ls: cannot access '/nonexistent': No such file or directory
timed out after 1 seconds
missing: [Errno 2] No such file or directory: 'no-such-tool'
```

### Why shell=True is an injection risk

With `shell=True` and a string, Python hands the whole string to `/bin/sh`, which interprets `;`, `&&`, `$(...)`, backticks and globs. If any part of that string came from a user, a file, a web request or a ticket title, that person controls what runs on your machine. Compare the two forms with a hostile "directory name":

```python title="injection_demo.py"
import subprocess

user_input = "/tmp; echo hacked"

print("--- shell=True with a string (unsafe)")
subprocess.run(f"ls -d {user_input}", shell=True)

print("--- list form (safe)")
result = subprocess.run(["ls", "-d", user_input], capture_output=True, text=True)
print("returncode:", result.returncode)
print("stderr:", result.stderr.strip())
```

```text
--- shell=True with a string (unsafe)
/tmp
hacked
--- list form (safe)
returncode: 2
stderr: ls: cannot access '/tmp; echo hacked': No such file or directory
```

The unsafe form ran `ls -d /tmp` and then `echo hacked`. A real attacker would not print "hacked". The list form treated the entire text as one file name and simply failed. Rules: pass a list, keep `shell=False` (the default), and if you really need a pipeline, run two `subprocess.run` calls and connect the data in Python. If you must build a command string for a remote shell, quote every piece with `shlex.quote`.

## Writing a command-line tool

A tool other people run needs `--help`, clear errors, logs that do not mix with data, and an exit code that means something. The standard library gives you all of this.

```python title="disk_report.py"
#!/usr/bin/env python3
"""Report disk usage for one or more paths and warn above a threshold.

Exit codes: 0 all paths below the threshold, 1 at least one path at or above it,
2 bad usage or an unreadable path.
"""
import argparse
import logging
import shutil
import sys

log = logging.getLogger("disk_report")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("paths", nargs="+", help="directories to check")
    parser.add_argument(
        "--threshold",
        type=int,
        default=80,
        metavar="PERCENT",
        help="warn at or above this percent used (default: %(default)s)",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    args = parser.parse_args(argv)
    if not 0 <= args.threshold <= 100:
        parser.error("--threshold must be between 0 and 100")
    return args


def percent_used(path):
    usage = shutil.disk_usage(path)
    return round(usage.used * 100 / usage.total)


def main(argv=None):
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
        stream=sys.stderr,
    )
    worst = 0
    for path in args.paths:
        log.debug("checking %s", path)
        try:
            used = percent_used(path)
        except OSError as err:
            log.error("cannot read %s: %s", path, err.strerror or err)
            return 2
        if used >= args.threshold:
            log.warning("%s is %d%% used (threshold %d%%)", path, used, args.threshold)
            worst = 1
        else:
            log.info("%s is %d%% used", path, used)
        print(f"{path}\t{used}")
    return worst


if __name__ == "__main__":
    sys.exit(main())
```

Read it from the bottom up:

- `sys.exit(main())`: `main` returns the exit code, and the module can be imported by a test without running anything. This is the Python version of the Bash `main "$@"` habit.
- `argparse` builds the parser, `--help` and the usage errors for you. `nargs="+"` means one or more paths. `type=int` converts and rejects non-numbers. `parser.error(...)` prints the usage line and exits with code `2`.
- `logging` writes to **stderr**; `print` writes the data (a path and a number, separated by a tab) to **stdout**. Someone can then run `disk_report.py / > usage.tsv` and get a clean file. Use `print` for the output of the program and `logging` for what the program says about itself.
- The exit codes follow the convention from Scripting 02: `0` fine, `1` a path is at or above the threshold, `2` bad usage or an unreadable path.

Run it:

```bash
python disk_report.py --help
python disk_report.py /
python disk_report.py --threshold 0 / /tmp; echo "exit=$?"
python disk_report.py /nonexistent; echo "exit=$?"
```

```text
usage: disk_report.py [-h] [--threshold PERCENT] [-v] paths [paths ...]

Report disk usage for one or more paths and warn above a threshold.

positional arguments:
  paths                directories to check

options:
  -h, --help           show this help message and exit
  --threshold PERCENT  warn at or above this percent used (default: 80)
  -v, --verbose        debug logging
INFO / is 12% used
/	12
WARNING / is 12% used (threshold 0%)
/	12
WARNING /tmp is 12% used (threshold 0%)
/tmp	12
exit=1
ERROR cannot read /nonexistent: No such file or directory
exit=2
```

_Illustrative: percentages depend on your disk. On Python versions before 3.10 the heading above the options reads `optional arguments:`._

### Choices and subcommands

When one tool does several jobs, give it **subcommands**, like `git commit` and `git push`. `choices=` limits an option to known values and gives a helpful error for anything else.

```python title="subcmd_demo.py"
import argparse
import sys


def build_parser():
    parser = argparse.ArgumentParser(prog="svc", description="Tiny service helper")
    sub = parser.add_subparsers(dest="command", required=True)

    status = sub.add_parser("status", help="show the status of a service")
    status.add_argument("name")
    status.add_argument("--env", choices=["dev", "stage", "prod"], default="dev")

    restart = sub.add_parser("restart", help="restart a service")
    restart.add_argument("name")
    restart.add_argument("--yes", action="store_true", help="do not ask for confirmation")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    print(f"command={args.command} name={args.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

```text
$ python subcmd_demo.py status web --env stage
command=status name=web
$ python subcmd_demo.py status web --env qa
usage: svc status [-h] [--env {dev,stage,prod}] name
svc status: error: argument --env: invalid choice: 'qa' (choose from 'dev', 'stage', 'prod')
$ python subcmd_demo.py
usage: svc [-h] {status,restart} ...
svc: error: the following arguments are required: command
```

For design guidance on command-line tools (flags, output, errors, help) read [clig.dev](https://clig.dev/), listed in the sources.

## Calling HTTP APIs

The `requests` library is the common choice for HTTP. Most of the bugs in ops scripts that call APIs come from four omissions: no timeout, no status check, retrying the wrong requests, and logging the token.

### Always set a timeout

`requests` has **no default timeout**. Without one, a server that accepts the connection and then says nothing makes your script wait forever. That is how a cron job hangs for days and a CI job eats its entire time limit. Always pass `timeout=`, either one number or a `(connect, read)` pair.

```python title="get_status.py"
#!/usr/bin/env python3
"""Print the HTTP status of a URL. Exit 0 on a response below 400, 1 otherwise."""
import sys

import requests


def get_status(url, timeout=5):
    response = requests.get(url, timeout=timeout)
    return response.status_code


def main(argv):
    if len(argv) != 2:
        print(f"usage: {argv[0]} URL", file=sys.stderr)
        return 2
    try:
        status = get_status(argv[1])
    except requests.exceptions.RequestException as err:
        print(f"request failed: {type(err).__name__}", file=sys.stderr)
        return 1
    print(status)
    return 0 if status < 400 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

```bash
python get_status.py https://no-such-host.invalid; echo "exit=$?"
python get_status.py; echo "exit=$?"
```

```text
request failed: ConnectionError
exit=1
usage: get_status.py URL
exit=2
```

_Illustrative: behind a proxy you may see `ProxyError` instead of `ConnectionError`. The `.invalid` name is reserved and never resolves._

Catching `requests.exceptions.RequestException` covers connection errors, timeouts and bad URLs in one place. Use `response.raise_for_status()` when you want an HTTP error status (4xx, 5xx) to become an exception too.

### Retries: GET only, with backoff

Networks fail briefly. A retry fixes that, but a blind retry of a request that changes something can charge a customer twice or create two servers. Retry only **idempotent** requests (safe to repeat, such as `GET` and `HEAD`), and let the library handle the waiting. `requests` uses `urllib3`, whose `Retry` class does backoff and honours the `Retry-After` header, which servers send with `429 Too Many Requests` and `503`.

Make a local server that fails twice, to see it work. It answers `503` twice, then `200`:

```python title="flaky_server.py"
"""A local server that answers 503, 503, then 200, for the retry demo."""
import http.server
import threading

RESPONSES = [503, 503, 200]


class Handler(http.server.BaseHTTPRequestHandler):
    calls = 0

    def do_GET(self):
        code = RESPONSES[min(Handler.calls, len(RESPONSES) - 1)]
        Handler.calls += 1
        body = b"ok\n" if code == 200 else b"unavailable\n"
        self.send_response(code)
        if code == 503:
            self.send_header("Retry-After", "0")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("server answered", args[1])


def start():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
```

```python title="retry_demo.py"
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

import flaky_server


def make_session():
    retry = Retry(
        total=3,
        backoff_factor=0.2,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET", "HEAD"}),
        respect_retry_after_header=True,
    )
    session = requests.Session()
    session.mount("http://", HTTPAdapter(max_retries=retry))
    session.mount("https://", HTTPAdapter(max_retries=retry))
    return session


server = flaky_server.start()
url = f"http://127.0.0.1:{server.server_address[1]}/health"
response = make_session().get(url, timeout=5)
print("final status:", response.status_code, "| server calls:", flaky_server.Handler.calls)
server.shutdown()
```

```text
server answered 503
server answered 503
server answered 200
final status: 200 | server calls: 3
```

Points to notice:

- `status_forcelist` names the statuses worth retrying. `allowed_methods` limits retries to `GET` and `HEAD`. A `POST` that fails is not repeated, so you cannot create the thing twice. If you need to retry a `POST`, the API must support an idempotency key, and you must read its documentation first.
- `backoff_factor` makes the waits grow (roughly `0.2`, `0.4`, `0.8` seconds, and so on). The exact formula can differ between `urllib3` versions (verify for yours). The server's own `Retry-After: 0` was honoured here.
- When the retries run out on a status in `status_forcelist`, `requests` raises `RetryError`. It is a `RequestException`, so the handler above catches it.
- `urllib3` logs each retry at warning level to stderr. That noise is useful when you debug, so leave it on.

> [!warning] Check before relying on this
> Library behaviour changes between versions. This lesson ran with requests 2.34.2 and urllib3 2.8.0. Older tutorials use the argument `method_whitelist`, which newer `urllib3` versions no longer accept; the current name is `allowed_methods`. Check the `Retry` documentation for the version in your `requirements.txt`.

### Pagination

Many APIs return one page at a time and tell you where the next page is. GitHub-style APIs use a `Link` header, which `requests` parses for you into `response.links`. This loop follows `next` links until none remains. It refuses to send the token to a different host, in case a malicious or buggy response points the `next` link somewhere else.

```python title="get_all (excerpt)"
from urllib.parse import urlparse


def get_all(session, url, token, timeout=5):
    """Follow rel="next" links and return every item."""
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    host = urlparse(url).netloc
    items = []
    while url:
        response = session.get(url, headers=headers, timeout=timeout)
        response.raise_for_status()
        items.extend(response.json()["items"])
        url = response.links.get("next", {}).get("url")
        if url and urlparse(url).netloc != host:
            raise ValueError("refusing to send the token to another host")
    return items
```

Tested against a local server that returned three pages, it printed `[1, 2, 3, 4, 5]`. Other APIs use a page token in the JSON body or an offset parameter; read the API's documentation for the style it uses.

### Secrets: from the environment, never in the output

A token must not be in the source code, in a command-line argument (visible in `ps`), or in a log. Read it from the environment, or from a secret manager at run time, and fail early and clearly when it is missing.

```python
import os
import sys

token = os.environ.get("API_TOKEN")
if not token:
    print("API_TOKEN is not set", file=sys.stderr)
    sys.exit(2)
```

Rules that follow:

- Never `print` or log the token, the `Authorization` header or a whole request object. If you log a URL, strip query-string credentials first. Redact before logging, then rely on [[patterns/secret-scanning-pre-commit-and-ci|secret scanning]] as the safety net, not the plan.
- Do not put secrets in exception messages you re-raise to users.
- In Kubernetes or CI, take the value from a secret store, as in [[patterns/external-secrets-with-secret-manager]]. On GCP that store is Secret Manager. Use short-lived credentials where you can.
- If a token does leak, treat it as compromised and follow [[runbooks/leaked-credential-rotation]].

The OWASP Secrets Management Cheat Sheet (in the sources) has the longer list.

## Reading config: JSON and YAML

### JSON

`json.load` parses a file and raises `json.JSONDecodeError` on bad input, with the position of the error. Catch it and show it to the user rather than a stack trace.

```python
import json

for text in ['{"ok": true,}', ""]:
    try:
        json.loads(text)
    except json.JSONDecodeError as err:
        print(f"invalid JSON at line {err.lineno} column {err.colno}: {err.msg}")
```

```text
invalid JSON at line 1 column 12: Illegal trailing comma before end of object
invalid JSON at line 1 column 1: Expecting value
```

_The message wording can differ between Python versions._

### YAML: only safe_load

PyYAML's `yaml.load` can build arbitrary Python objects from tags in the file, including ones that run code. `yaml.safe_load` builds only plain data: dicts, lists, strings, numbers, booleans, dates. Always use `safe_load`, even for files you wrote yourself, because the habit protects you on the day the file is not yours.

```python
import yaml

try:
    yaml.safe_load('x: !!python/object/apply:os.system ["echo pwned"]')
except yaml.YAMLError as err:
    print("safe_load refused:", type(err).__name__)
```

```text
safe_load refused: ConstructorError
```

### The Norway problem, and other YAML surprises

PyYAML follows the YAML 1.1 rules for plain (unquoted) scalars, where `NO`, `no`, `off` and `yes`, `on` are booleans. A country list with `NO` for Norway silently turns into `False`.

```python
import yaml

print(yaml.safe_load("country: NO\nnames: [NO, yes, on, 'NO']\nversion: 1.10\nport: 0777"))
```

```text
{'country': False, 'names': [False, True, True, 'NO'], 'version': 1.1, 'port': 511}
```

Three other things in that line: `1.10` became the number `1.1`, `0777` became octal `511`, and only the quoted `'NO'` stayed a string. The cure is to quote values that must be text (`"NO"`, `"1.10"`) and to validate types after loading. A parser that follows the YAML 1.2 rules treats these differently, so check which one your tools use before you assume (verify for your version).

### Validate everything and report all problems

A config file with six mistakes should not make the user fix one, re-run, find the next, and so on. Collect every error and print them together. This validator checks the shape and types of a `services.yaml` and returns a list of messages.

```python title="validate_services.py"
#!/usr/bin/env python3
"""Validate services.yaml and report every problem, not just the first.

Exit codes: 0 valid, 1 invalid, 2 unreadable file or bad usage.
"""
import sys
from urllib.parse import urlparse

import yaml


def validate(data):
    errors = []
    if not isinstance(data, dict) or not isinstance(data.get("services"), list):
        return ["top level must be a mapping with a 'services' list"]

    seen = set()
    for index, service in enumerate(data["services"]):
        where = f"services[{index}]"
        if not isinstance(service, dict):
            errors.append(f"{where}: must be a mapping")
            continue

        name = service.get("name")
        if not isinstance(name, str) or not name:
            errors.append(f"{where}: 'name' is required and must be text")
        elif name in seen:
            errors.append(f"{where}: duplicate name '{name}'")
        else:
            seen.add(name)

        url = service.get("url")
        if not isinstance(url, str) or urlparse(url).scheme not in ("http", "https"):
            errors.append(f"{where}: 'url' must start with http:// or https://")

        timeout = service.get("timeout", 5)
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or timeout <= 0:
            errors.append(f"{where}: 'timeout' must be a number above 0, got {timeout!r}")

        status = service.get("expect_status", 200)
        if isinstance(status, bool) or not isinstance(status, int) or not 100 <= status <= 599:
            errors.append(f"{where}: 'expect_status' must be a whole number from 100 to 599, got {status!r}")
    return errors


def main(argv):
    if len(argv) != 2:
        print(f"usage: {argv[0]} FILE", file=sys.stderr)
        return 2
    try:
        with open(argv[1], encoding="utf-8") as handle:
            data = yaml.safe_load(handle)
    except (OSError, yaml.YAMLError) as err:
        print(f"cannot read {argv[1]}: {err}", file=sys.stderr)
        return 2

    errors = validate(data)
    for message in errors:
        print(f"{argv[1]}: {message}", file=sys.stderr)
    if errors:
        print(f"{len(errors)} problem(s) found", file=sys.stderr)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

Here is a deliberately broken file:

```yaml title="services.yaml"
services:
  - name: web
    url: https://www.example.com/
    timeout: 5
    expect_status: 200
  - name: api
    url: ftp://api.example.com/
    timeout: 0
  - url: https://status.example.com/
    timeout: "ten"
  - name: web
    url: https://www.example.com/health
    expect_status: 700
```

```bash
python validate_services.py services.yaml; echo "exit=$?"
```

```text
services.yaml: services[1]: 'url' must start with http:// or https://
services.yaml: services[1]: 'timeout' must be a number above 0, got 0
services.yaml: services[2]: 'name' is required and must be text
services.yaml: services[2]: 'timeout' must be a number above 0, got 'ten'
services.yaml: services[3]: duplicate name 'web'
services.yaml: services[3]: 'expect_status' must be a whole number from 100 to 599, got 700
6 problem(s) found
exit=1
```

Notice the `isinstance(..., bool)` checks: in Python `True` is an `int`, so a YAML `timeout: yes` would otherwise pass as `1`. Also notice that unreadable files and invalid YAML exit with `2` while a valid file with wrong content exits `1`: the caller can tell "I could not check" from "I checked and it is wrong".

## Testing with pytest

A tool you cannot test you will be afraid to change. `pytest` finds functions named `test_*`, runs them and reports. A **fixture** prepares something a test needs and cleans it up afterwards. For HTTP code, the standard library's `http.server` gives you a real server on a free local port (`("127.0.0.1", 0)` asks the operating system for one), so tests need no network and no mocks of the library you are testing.

The tests below start such a server in a fixture. You will meet them again in the capstone.

## Capstone: ops-check

Build a tool that reads `services.yaml`, checks each service over HTTP, checks the TLS certificate's remaining days for `https` services, prints a table or JSON, and exits `0`, `1` or `2`. It reuses the validator from above.

> [!info] Lab only
> The exercise checks servers on your own machine, so it needs no outside network. Point the real tool only at systems you own or are allowed to test. Use `example.com` hostnames in documents and examples, not other people's services.

Create a folder with the validator and the requirements:

```bash
mkdir -p ~/lab17/ops-check && cd ~/lab17/ops-check
cp ../validate_services.py .
cp ../requirements.txt .
```

The tool:

```python title="ops_check.py"
#!/usr/bin/env python3
"""ops-check: HTTP health and TLS expiry for the services listed in a YAML file.

Data (a table, or JSON with --json) goes to stdout. Logs go to stderr.
Exit codes: 0 every check passed, 1 at least one check failed,
2 bad usage or invalid configuration.
"""
import argparse
import json
import logging
import socket
import ssl
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
import yaml
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from validate_services import validate

log = logging.getLogger("ops_check")

EXIT_OK, EXIT_FAILED, EXIT_USAGE = 0, 1, 2


def make_session():
    """A session that retries idempotent requests only, never POST."""
    retry = Retry(
        total=2,
        backoff_factor=0.3,
        status_forcelist=(429, 502, 503, 504),
        allowed_methods=frozenset({"GET", "HEAD"}),
        respect_retry_after_header=True,
    )
    session = requests.Session()
    session.mount("http://", HTTPAdapter(max_retries=retry))
    session.mount("https://", HTTPAdapter(max_retries=retry))
    return session


def days_until(not_after, now=None):
    """Whole days from `now` until a certificate's notAfter text (ssl format)."""
    expires = ssl.cert_time_to_seconds(not_after)
    now = now if now is not None else time.time()
    return int((expires - now) // 86400)


def check_tls(host, port=443, timeout=5, context=None):
    """Return the days left on the certificate the server presents."""
    context = context or ssl.create_default_context()
    with socket.create_connection((host, port), timeout=timeout) as sock:
        with context.wrap_socket(sock, server_hostname=host) as tls:
            return days_until(tls.getpeercert()["notAfter"])


def check_service(session, service, min_days):
    """Run the checks for one service and return a result dict."""
    result = {
        "name": service["name"],
        "url": service["url"],
        "ok": False,
        "status": None,
        "ms": None,
        "tls_days": None,
        "detail": "",
    }
    timeout = service.get("timeout", 5)
    expected = service.get("expect_status", 200)
    started = time.monotonic()
    try:
        response = session.get(service["url"], timeout=timeout, allow_redirects=False)
    except requests.exceptions.RequestException as err:
        result["detail"] = type(err).__name__
        return result
    result["ms"] = round((time.monotonic() - started) * 1000)
    result["status"] = response.status_code
    problems = []
    if response.status_code != expected:
        problems.append(f"status {response.status_code}, expected {expected}")

    parsed = urlparse(service["url"])
    if parsed.scheme == "https":
        try:
            result["tls_days"] = check_tls(parsed.hostname, parsed.port or 443, timeout)
        except (OSError, ssl.SSLError, KeyError) as err:
            problems.append(f"tls: {type(err).__name__}")
        else:
            if result["tls_days"] < min_days:
                problems.append(f"certificate expires in {result['tls_days']} days")

    result["detail"] = "; ".join(problems)
    result["ok"] = not problems
    return result


def render_table(results):
    rows = [("NAME", "STATUS", "MS", "TLS DAYS", "RESULT")]
    for r in results:
        rows.append(
            (
                r["name"],
                "-" if r["status"] is None else str(r["status"]),
                "-" if r["ms"] is None else str(r["ms"]),
                "-" if r["tls_days"] is None else str(r["tls_days"]),
                "OK" if r["ok"] else f"FAIL {r['detail']}".strip(),
            )
        )
    widths = [max(len(row[i]) for row in rows) for i in range(4)]
    return "\n".join(
        "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row[:4])) + "  " + row[4]
        for row in rows
    )


def load_services(path):
    with open(path, encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    errors = validate(data)
    if errors:
        raise ValueError("\n".join(errors))
    return data["services"]


def parse_args(argv):
    parser = argparse.ArgumentParser(prog="ops-check", description=__doc__.splitlines()[0])
    parser.add_argument("config", help="YAML file listing the services")
    parser.add_argument("--json", action="store_true", help="print JSON instead of a table")
    parser.add_argument("--min-days", type=int, default=14, help="fail if a certificate expires sooner (default: %(default)s)")
    parser.add_argument("-v", "--verbose", action="store_true")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="%(levelname)s %(message)s",
        stream=sys.stderr,
    )
    try:
        services = load_services(args.config)
    except (OSError, yaml.YAMLError, ValueError) as err:
        print(f"ops-check: {err}", file=sys.stderr)
        return EXIT_USAGE

    session = make_session()
    results = [check_service(session, s, args.min_days) for s in services]
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    log.debug("checked %d service(s) at %s", len(results), stamp)

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print(render_table(results))
    return EXIT_OK if all(r["ok"] for r in results) else EXIT_FAILED


if __name__ == "__main__":
    sys.exit(main())
```

How it works, in the order a request flows:

1. `load_services` reads the YAML with `safe_load` and runs the validator. Any problem becomes exit code `2` before a single request is made.
2. `make_session` builds a session that retries `GET` and `HEAD` only.
3. `check_service` times the request, compares the status with `expect_status` (default `200`), and, for `https` URLs, opens a TLS connection with `ssl` and the default context to read the certificate. `check_tls` verifies the certificate chain and the host name like a browser would, because `ssl.create_default_context()` turns verification on. A verification failure is an `SSLError`, reported as a failed check. `days_until` converts the certificate's `notAfter` text into whole days.
4. `allow_redirects=False` means a `301` counts as a `301`, which is usually what a health check wants to know.
5. The table or JSON goes to stdout. The exit code is `0` if every check passed, `1` if any failed.

Now the tests:

```python title="test_ops_check.py"
import http.server
import json
import threading
from datetime import datetime, timezone

import pytest

import ops_check


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        code = 200 if self.path == "/up" else 500
        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args):
        pass


@pytest.fixture
def base_url():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def test_healthy_service_passes(base_url):
    service = {"name": "local", "url": f"{base_url}/up", "timeout": 2}
    result = ops_check.check_service(ops_check.make_session(), service, min_days=14)
    assert result["ok"] is True
    assert result["status"] == 200


def test_failing_service_sets_exit_code_1_and_json(base_url, tmp_path, capsys):
    config = tmp_path / "services.yaml"
    config.write_text(
        "services:\n"
        "  - name: up\n"
        f"    url: {base_url}/up\n"
        "  - name: down\n"
        f"    url: {base_url}/down\n"
        "    timeout: 2\n"
    )
    code = ops_check.main([str(config), "--json"])
    report = json.loads(capsys.readouterr().out)
    assert code == 1
    assert [r["ok"] for r in report] == [True, False]


def test_days_until_counts_whole_days():
    now = datetime(2026, 10, 17, 12, 0, tzinfo=timezone.utc).timestamp()
    assert ops_check.days_until("Oct 31 12:00:00 2026 GMT", now=now) == 14
    assert ops_check.days_until("Oct 10 12:00:00 2026 GMT", now=now) == -7
```

```bash
pytest -q
```

```text
...                                                                      [100%]
3 passed in 1.16s
```

_Illustrative: the time differs._

The three tests cover a healthy service, a failing service through `main` (checking the exit code and the JSON), and the date arithmetic, with a fixed `now` so the test never depends on today's date. The TLS connection itself is not covered by these tests. It was checked once by hand against a local TLS server with a self-signed certificate, with a context that trusted that certificate; production TLS checks are best done against a staging endpoint you own.

Try it against local servers. In one terminal, start a web server with one file:

```bash
mkdir -p www && echo ok > www/up
cd www && python3 -m http.server 8081 --bind 127.0.0.1
```

In another terminal, in `~/lab17/ops-check`:

```yaml title="services.yaml"
services:
  - name: local-up
    url: http://127.0.0.1:8081/up
    timeout: 3
  - name: local-missing
    url: http://127.0.0.1:8081/missing
    timeout: 3
  - name: local-closed
    url: http://127.0.0.1:9/
    timeout: 2
```

```bash
python ops_check.py services.yaml; echo "exit=$?"
python ops_check.py services.yaml --json | jq -c '.[] | {name, ok}'
python ops_check.py services.yaml --json | jq -e 'all(.[]; .ok)'; echo "jq exit=$?"
```

```text
NAME           STATUS  MS  TLS DAYS  RESULT
local-up       200     7   -         OK
local-missing  404     2   -         FAIL status 404, expected 200
local-closed   -       -   -         FAIL ConnectionError
exit=1
{"name":"local-up","ok":true}
{"name":"local-missing","ok":false}
{"name":"local-closed","ok":false}
false
jq exit=1
```

_Illustrative: timings differ. The two `WARNING Retrying ...` lines that `urllib3` prints to stderr for the closed port are left out._

`jq -e 'all(.[]; .ok)'` prints `true` or `false` and sets its exit code from the result, so a CI job can use the JSON output as a gate with one line. You learned `jq -e` in [[learn/text-and-data-tools|Linux 03]]. Port `9` is the "discard" port, which is normally closed, so the connection is refused.

> [!tip] Running it from CI
> In a pipeline, the tool's own exit code is enough: `python ops_check.py services.yaml` fails the job when a check fails. Use `--json` when you want to keep the report as an artifact. Install dependencies from the pinned `requirements.txt` into a fresh venv in the job, and run `shellcheck` and `pytest` as separate jobs. See [[patterns/gitlab-ci-pipeline-structure]].

## Using AI to write scripts

An AI assistant is good at explaining an error, suggesting a test, or reviewing a script for the problems in this lesson (missing timeouts, `shell=True`, unquoted input). It is no replacement for reading the code it writes and running the tests. Never paste secrets, customer data or internal configuration into a prompt. The owner's AI skills catalogue is at <https://ai.szolotov.com>.

## Hands-on exercises

Work in `~/lab17` with the files from this lesson. Outputs are illustrative where they depend on your machine.

1. **A venv with requests.** Run `python3 -m venv .venv`, `source .venv/bin/activate`, `which python`, `pip install requests PyYAML pytest`, `pip freeze > requirements.txt` and `grep -i '^requests' requirements.txt`.
   Expected: `which python` ends in `lab17/.venv/bin/python`, and the last command prints a pinned line such as `requests==2.34.2`.
   If you see something else: `/usr/bin/python3` means the venv is not active (run the `source` line again). An `ensurepip is not available` error means `sudo apt install python3-venv` first.

2. **disk_report.py.** Create the file and run `python disk_report.py --help`, then `python disk_report.py --threshold 0 / ; echo "exit=$?"`, then `python disk_report.py /nonexistent; echo "exit=$?"`.
   Expected: the help text; a `WARNING` line, a tab-separated path and number on stdout, and `exit=1`; then an `ERROR cannot read /nonexistent` line and `exit=2`.
   If you see something else: if no warning appears, the threshold was not `0`. To check the stdout/stderr split, run `python disk_report.py / 2>/dev/null`: it should show only the data line (the path and the number).

3. **The shell=True demo.** Create `injection_demo.py` and run it with `python injection_demo.py`.
   Expected: the unsafe section prints `/tmp` and `hacked`; the list section prints `returncode: 2` and a `cannot access '/tmp; echo hacked'` message.
   If you see something else: if `hacked` appears in the second section, you passed a string with `shell=True` there too.

4. **get_status with a timeout.** Create `get_status.py` and run `python get_status.py https://no-such-host.invalid; echo "exit=$?"`, then `python get_status.py; echo "exit=$?"`.
   Expected: `request failed: ConnectionError` and `exit=1`; then the usage line and `exit=2`.
   If you see something else: a long traceback means the `except requests.exceptions.RequestException` handler is missing. `ProxyError` instead of `ConnectionError` is normal behind a proxy.

5. **Retry against a flaky server.** Create `flaky_server.py` and `retry_demo.py` and run `python retry_demo.py`.
   Expected: `server answered 503` twice, then `server answered 200`, and `final status: 200 | server calls: 3`.
   If you see something else: `final status: 503` or a `RetryError` means the retries ran out; check that `total=3` and `status_forcelist` include `503`. A `TypeError` about `method_whitelist` means you copied an old tutorial's argument name.

6. **Validate services.yaml.** Create `validate_services.py` and the broken `services.yaml`, and run `python validate_services.py services.yaml; echo "exit=$?"`. Then fix every problem in the file and run it again.
   Expected: six problems and `exit=1`; after fixing, `ok` and `exit=0`.
   If you see something else: if you get fewer than six messages, check that the file has four `services` entries and the problems from the lesson. If you get a Python traceback, the file may not be valid YAML. Check indentation (spaces only, no tabs).

7. **NO is not "NO".** Run the Python line from the Norway section. Then change the input to `country: "NO"` and run it again.
   Expected: `'country': False` the first time; `'country': 'NO'` after quoting.
   If you see something else: if you get the string `'NO'` in the first run, your YAML library follows the YAML 1.2 rules for booleans (verify with the library's documentation).

8. **Build and test ops-check.** Follow the capstone: create the folder, copy `validate_services.py` and `requirements.txt`, create `ops_check.py` and `test_ops_check.py`, and run `pytest -q`.
   Expected: `3 passed`.
   If you see something else: `ModuleNotFoundError: No module named 'ops_check'` means you are not running `pytest` in the folder that holds the file. `ModuleNotFoundError` for `requests` or `yaml` means the venv is not active.

9. **Run ops-check against local servers.** Start the local web server, create the three-service `services.yaml`, and run the three commands from the capstone.
   Expected: the table with `OK`, `FAIL status 404, expected 200` and `FAIL ConnectionError`; `exit=1`; the JSON summary; and `false` with `jq exit=1`. Then remove the two failing services from the file and confirm `exit=0` and `jq` printing `true`.
   If you see something else: if all three fail with `ConnectionError`, the web server is not running on port 8081. If the table is not aligned, you changed the column code. Compare with the lesson.

## Common mistakes

- **No `timeout=` on a request.** `requests` waits forever by default, so a cron job or a CI step hangs. Always pass a timeout, and handle `requests.exceptions.RequestException`.
- **`shell=True` with outside input.** Anyone who controls part of the string runs commands on your host. Pass a list.
- **Installing into the system Python.** It breaks other tools, and on recent distributions it fails with an "externally managed" error. Use a venv per project.
- **`yaml.load` instead of `yaml.safe_load`.** The first can construct arbitrary objects. Always use `safe_load`.
- **Trusting unquoted YAML.** `NO`, `1.10` and `0777` do not mean what they look like. Quote text values and validate types.
- **Retrying a `POST` blindly.** The request may have worked, and you create a second copy. Retry idempotent methods only, or use an idempotency key.
- **Printing logs to stdout.** Output that other programs read gets mixed with messages. Data to stdout, logs to stderr.
- **Logging the token.** Logs are copied, shipped and read by many people. Never log credentials or full request headers.
- **Stopping at the first config error.** Users fix one problem per run and give up. Collect all errors and report them together.
- **Following a `next` link to any host with your token attached.** Check that the host is the one you meant to call.

## Check your understanding

1. Why can a missing timeout hang a cron job for days, and what do you add to fix it?
2. Why is `yaml.safe_load` the only acceptable choice, even for files you wrote?
3. Why does a tool print data to stdout and log messages to stderr?
4. Why must you never print or log an API token, and where should the token come from?
5. Why does the `Retry` configuration list `GET` and `HEAD` and not `POST`?
6. Your tool reads `country: NO` from YAML and gets `False`. Why, and what are two ways to prevent it?

> [!question]- Answers
>
> 1. `requests` has no default timeout, so if the server accepts the connection and then goes silent, the call blocks forever and the next cron run may start on top of it. Pass `timeout=` (a number or a `(connect, read)` pair) on every request and handle the resulting exception.
> 2. `yaml.load` can build arbitrary Python objects from tags in the file, which can run code. `safe_load` creates plain data only. A file you wrote can still be replaced or edited by someone else, so the safe habit costs nothing and removes the risk.
> 3. Another program or a redirect (`> file`, `| jq`) reads stdout, so it must contain only data. Messages about what the program is doing belong on stderr, where a person or a log collector sees them without corrupting the output.
> 4. Logs are stored, shipped, searched and read by many people and tools, so a logged token is a leaked token. Read it from an environment variable or a secret manager at run time, fail clearly when it is missing, and rotate it if it ever leaks.
> 5. `GET` and `HEAD` are idempotent: repeating them cannot change anything on the server. A repeated `POST` may create a second resource or charge twice if the first attempt did succeed. Retry a `POST` only when the API supports an idempotency key.
> 6. PyYAML follows YAML 1.1 rules, where an unquoted `NO` is the boolean false. Quote the value (`"NO"`), or validate the type after loading and reject a boolean where text is expected. A YAML 1.2 parser also avoids the problem.

## Next steps

Next stage: containers, starting with [[learn/containers-under-the-hood|Containers 01: What a container really is]]. Previous lesson: [[learn/safe-bash-scripts|Scripting 02: Safe Bash: strict mode, traps and ShellCheck]].

To go deeper:

- [[standards/bash-scripts]] for the rule on when a Bash script should become Python.
- [[patterns/gitlab-ci-pipeline-structure]] to run your tool and its tests in a pipeline.
- [[patterns/external-secrets-with-secret-manager]] and [[runbooks/leaked-credential-rotation]] for secrets in production and what to do when one leaks.
- AI-assisted scripting: the AI skills catalogue at <https://ai.szolotov.com>, and the safety notes in "Using AI to write scripts" above.
- The whole path is mapped in [[learn/index|the learning path]].

## Sources

- Python documentation (https://docs.python.org/3/): `venv`, `subprocess`, `argparse`, `logging`, `json`, `ssl`, `http.server`. The examples ran on Python 3.13.16 on Ubuntu 24.04 LTS; only 3.13 was tested.
- Requests documentation (https://requests.readthedocs.io/) and urllib3 `Retry` documentation (https://urllib3.readthedocs.io/en/stable/reference/urllib3.util.html). Tested with requests 2.34.2 and urllib3 2.8.0.
- PyYAML documentation (https://pyyaml.org/wiki/PyYAMLDocumentation) and the YAML 1.1 and 1.2 specifications (https://yaml.org/spec/). Tested with PyYAML 6.0.3.
- PEP 668, Marking Python base environments as externally managed (https://peps.python.org/pep-0668/).
- pytest documentation (https://docs.pytest.org/). Tested with pytest 9.1.1.
- Command Line Interface Guidelines (https://clig.dev/).
- OWASP Secrets Management Cheat Sheet (https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html).
