---
title: Running fleet-wide change campaigns across many repositories
description: Plan, automate, track and enforce a change that must land in every team's repositories, from inventory and bot merge requests to deadlines and exceptions.
type: guide
tags:
  - management
  - delivery
  - team-process
  - terraform
  - helm
  - gitlab-ci
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Most platform work does not end in the platform's own repositories. A new major version of the shared Helm library chart, a Terraform provider upgrade, a base image change, a Kubernetes API removal, a central CI template release: each one has to land in tens or hundreds of repositories owned by other teams, who have their own priorities. Without a method, these changes follow the same curve every time: a fast start with the eager teams, a long tail that stalls well short of done, and a deadline that slips because the last repositories belong to teams that never read the announcement. A campaign is the method for getting the tail done: one owner, a precise inventory, automation that does the work for teams, a visible board, a nudge ladder, and enforcement with exceptions at the end.

> [!info] Scope and what is not verified
> The GitLab API calls follow the GitLab documentation read on 2026-10-21; GitLab features differ by tier and version, so check yours. The Renovate options follow the Renovate configuration docs of the same date; Renovate changes often (for example `managerFilePatterns` replaced `fileMatch`), so check the docs for the version you run. The inventory, clone and merge request scripts were tested against sample repositories and a local mock of the GitLab API, not a live instance. The Renovate configuration and the Conftest policy were **not run**. GitLab API rate limits were **not checked**: keep the pauses and check the limits on your instance.

## When work is a campaign

Treat a change as a campaign when **all** of these hold:

- It must land in repositories the platform team does not own.
- There is a date after which the old state is a problem (an end-of-life date, an API removal, a security fix, a shim you want to delete).
- More than a handful of repositories are affected, so tracking by memory fails.

Small, optional improvements are not campaigns: publish them and let teams adopt them through normal dependency updates ([[automated-dependency-updates]]). The Jenkins to GitLab migration is a campaign large enough to be a programme with waves and staffing ([[jenkins-to-gitlab-migration-programme]]); this note covers the more common, smaller kind that one engineer runs alongside other work.

## Campaign brief

Write one page before anything is announced. It is the link in every merge request, message and ticket.

```markdown title="campaign-brief.md"
# Campaign PLAT-123: platform-lib 3.x in every service chart

Owner: @handle (one person) Sponsor: @eng-manager Status: running
Deadline: 2027-01-31 (why: platform-lib 2.x stops receiving fixes on that date)

## What changes and why

One paragraph a product engineer understands. Link the RFC or ADR.

## What teams must do

- Merge the bot merge request, or apply the change by hand (guide below).
- Run your pipeline to staging and check the rendered manifests.
  Expected effort per repository: about 30 minutes (measured on the pilot repositories).

## Upgrade guide

Before/after snippets, breaking changes, how to test, how to roll back.

## Scope

Inventory query, number of repositories, owners. Out of scope: ...

## Timeline

Pilot -> announcement -> bot MRs -> nudges -> warn in CI -> deadline -> enforce -> clean-up.

## Exceptions

How to ask, who approves, maximum length.

## Help

Office hours (time), channel, FAQ.
```

The "why" and the measured effort are what make teams prioritise the work. "Platform asked" is not a reason; "your chart stops getting security fixes on 31 January, and the change took 30 minutes in the pilot" is. If the change is big enough to need design review, run it through [[rfc-and-design-review-process]] first, and follow the deprecation timelines in [[api-deprecation-policy]] when the campaign removes an interface.

## Inventory

The inventory is the denominator of every progress number. Build it from the code, not from a spreadsheet of who said they use something.

### Finding the repositories

The GitLab groups API lists a group's projects; `include_subgroups=true` covers the whole tree and `archived=false` drops archived projects. The script below pages through that list and shallow-clones each project with your SSH key, with hooks disabled.

```bash title="clone-group.sh"
#!/usr/bin/env bash
# Shallow-clone every non-archived project in a GitLab group tree, read-only,
# for a campaign inventory. Uses your SSH key for git and a read_api token for the API.
set -euo pipefail

GITLAB_URL="${GITLAB_URL:-https://gitlab.example.com}"
GROUP="${1:?usage: clone-group.sh <group-path> <dest-dir>}"
DEST="${2:?usage: clone-group.sh <group-path> <dest-dir>}"
: "${GITLAB_TOKEN:?export GITLAB_TOKEN (read_api scope)}"

gl_get_all() {
  local path="$1" sep='?' page=1 hdr
  [[ "$path" == *\?* ]] && sep='&'
  hdr="$(mktemp)"
  while [[ -n "$page" ]]; do
    printf 'header = "PRIVATE-TOKEN: %s"\n' "$GITLAB_TOKEN" |
      curl -sS --fail --config - -D "$hdr" \
        "${GITLAB_URL}/api/v4/${path}${sep}per_page=100&page=${page}" || {
      rm -f "$hdr"; return 1
    }
    echo
    page="$(awk 'tolower($1) == "x-next-page:" { gsub("\r", "", $2); print $2 }' "$hdr")"
  done
  rm -f "$hdr"
}

[[ ! -e "$DEST" ]] || { echo "${DEST} exists; use a new directory" >&2; exit 1; }
mkdir -p "$DEST"
group_enc="$(jq -rn --arg g "$GROUP" '$g | @uri')"

gl_get_all "groups/${group_enc}/projects?include_subgroups=true&archived=false" |
  jq -r '.[] | [.path_with_namespace, .ssh_url_to_repo] | @tsv' |
  while IFS=$'\t' read -r path url; do
    dir="${DEST}/${path//\//__}"   # group/sub/repo -> group__sub__repo
    git -c core.hooksPath=/dev/null clone --quiet --depth 1 --no-tags "$url" "$dir" ||
      echo "clone failed: ${path}" >&2
  done
echo "cloned $(find "$DEST" -mindepth 1 -maxdepth 1 -type d | wc -l) repositories into ${DEST}"
```

Offset pagination works up to a documented limit on the projects endpoints (keyset pagination beyond it); a single group rarely gets near it. Server-side code search is an alternative to cloning, but instance-wide and group code search need advanced search or exact code search, which are Premium and Ultimate features; on the Free tier, cloning and scanning is the portable method.

### Scanning the checkouts

The scanner walks the checkouts and writes one CSV row per finding: the version of a named library chart dependency in `Chart.yaml`, `FROM` images in Dockerfiles, Terraform `required_version`, and `ref:` lines in GitLab CI files (the pinned versions of central template includes, per [[0013-versioned-central-ci-templates]]). It is a line-level scan for finding things, not a full YAML or HCL parser; check unexpected rows by hand.

```python title="scan_fleet.py"
#!/usr/bin/env python3
"""Scan a directory of repository checkouts and print a campaign inventory CSV.
Standard library only; a line-level scan, good for finding, not a full parser.

  python3 scan_fleet.py ./checkouts --chart platform-lib > inventory.csv
"""
import argparse
import csv
import re
import sys
from pathlib import Path

SKIP_DIRS = {".git", "node_modules", "vendor", ".terraform"}
FROM_RE = re.compile(r"^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)", re.IGNORECASE)
TF_REQ_RE = re.compile(r'^\s*required_version\s*=\s*"([^"]+)"')
CI_REF_RE = re.compile(r"^\s*ref:\s*['\"]?([^'\"\s#]+)")
ITEM_RE = re.compile(r"^(\s*)-\s+(.*)$")
KV_RE = re.compile(r"^(\w+):\s*['\"]?([^'\"#]*?)['\"]?\s*(?:#.*)?$")


def chart_dependency_versions(text: str, chart: str):
    """Yield the version of every `dependencies:` item named `chart` in a Chart.yaml."""
    in_deps, item, item_indent = False, None, None
    for line in text.splitlines() + ["end:"]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        if indent == 0 and not (in_deps and line.startswith("-")):
            if item and item.get("name") == chart:
                yield item.get("version", "")
            in_deps, item = line.startswith("dependencies:"), None
            continue
        if not in_deps:
            continue
        m = ITEM_RE.match(line)
        if m and (item_indent is None or len(m.group(1)) == item_indent):
            if item and item.get("name") == chart:
                yield item.get("version", "")
            item_indent, item, rest = len(m.group(1)), {}, m.group(2)
        else:
            rest = line.strip()
        kv = KV_RE.match(rest)
        if item is not None and kv:
            item[kv.group(1)] = kv.group(2).strip()


def files(root: Path):
    for path in root.rglob("*"):
        if path.is_file() and not SKIP_DIRS.intersection(path.relative_to(root).parts):
            yield path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("checkouts", type=Path, help="directory with one subdirectory per repository")
    ap.add_argument("--chart", default="platform-lib", help="library chart dependency to report")
    args = ap.parse_args()

    out = csv.writer(sys.stdout)
    out.writerow(["repository", "kind", "file", "line", "value"])
    for repo in sorted(p for p in args.checkouts.iterdir() if p.is_dir()):
        for path in files(repo):
            rel = path.relative_to(repo).as_posix()
            name = path.name
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                print(f"skip {path}: {exc}", file=sys.stderr)
                continue
            if name in ("Chart.yaml", "Chart.yml"):
                for version in chart_dependency_versions(text, args.chart):
                    out.writerow([repo.name, f"chart:{args.chart}", rel, "", version])
            elif name.startswith(("Dockerfile", "Containerfile")):
                for n, line in enumerate(text.splitlines(), 1):
                    if m := FROM_RE.match(line):
                        out.writerow([repo.name, "base-image", rel, n, m.group(1)])
            elif name.endswith((".tf", ".tofu")):
                for n, line in enumerate(text.splitlines(), 1):
                    if m := TF_REQ_RE.match(line):
                        out.writerow([repo.name, "terraform-required-version", rel, n, m.group(1)])
            elif name == ".gitlab-ci.yml" or (rel.startswith(".gitlab/ci/") and name.endswith(".yml")):
                for n, line in enumerate(text.splitlines(), 1):
                    if m := CI_REF_RE.match(line):
                        out.writerow([repo.name, "ci-include-ref", rel, n, m.group(1)])
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

```bash
./clone-group.sh platform-consumers ./checkouts-2026-10-21
python3 scan_fleet.py ./checkouts-2026-10-21 --chart platform-lib > inventory.csv
```

```text title="inventory.csv (sample data)"
repository,kind,file,line,value
shop__svc-a,base-image,Dockerfile,1,registry.example.com/base/python:3.12
shop__svc-a,chart:platform-lib,chart/Chart.yaml,,2.4.1
shop__svc-b,chart:platform-lib,deploy/helm/Chart.yaml,,3.0.0
shop__svc-c,ci-include-ref,.gitlab-ci.yml,3,v4.2.0
shop__svc-c,terraform-required-version,infra/main.tf,2,>= 1.6.0
```

Add an owner column by joining with your service catalogue or CODEOWNERS. For Kubernetes API removals, the code is not enough: the API server reports use of deprecated APIs through a `Warning` header, an audit annotation and the `apiserver_requested_deprecated_apis` metric, which the Kubernetes deprecation guide describes. Use them to find live callers, including the ones not in any repository.

## Automating the change

The best campaign is one where most teams only review and merge. Do the work for them.

### With Renovate

If Renovate already runs across the fleet ([[renovate-vs-dependabot]], [[0060-renovate-for-automated-dependency-updates]]), the change is mostly configuration. Its built-in managers read `Chart.yaml` dependencies (`helmv3`), Dockerfile `FROM` lines (`dockerfile`), Terraform files including `required_providers` (`terraform`), and GitLab CI `include: project` references with a `ref:` (`gitlabci-include`; an include without `ref:` is skipped, one more reason to pin). A campaign preset groups the change, labels it and points to the brief:

```json title="renovate-presets/campaign-plat-123.json"
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "description": "Campaign PLAT-123: platform-lib 3.x",
  "packageRules": [
    {
      "matchManagers": ["helmv3"],
      "matchPackageNames": ["platform-lib"],
      "matchUpdateTypes": ["major"],
      "groupName": "platform-lib 3.x (PLAT-123)",
      "addLabels": ["campaign::PLAT-123"],
      "prBodyNotes": [
        "Campaign PLAT-123: see the campaign brief for the upgrade guide and deadline."
      ]
    }
  ]
}
```

For versions Renovate cannot see on its own, such as a version in an environment file, a regex custom manager reads an annotated line:

```json title="renovate.json (excerpt)"
{
  "customManagers": [
    {
      "customType": "regex",
      "managerFilePatterns": ["/(^|/)ci/versions\\.env$/"],
      "matchStrings": [
        "# renovate: datasource=(?<datasource>[a-z-]+) depName=(?<depName>\\S+)\\n[A-Z_]+=(?<currentValue>\\S+)"
      ],
      "versioningTemplate": "docker"
    }
  ]
}
```

```text title="ci/versions.env"
# renovate: datasource=docker depName=registry.example.com/base/python
BASE_IMAGE_TAG=3.12.7
```

The `docker` versioning scheme fits image tags; if the same manager also reads other datasources, capture the scheme per line instead of fixing it in `versioningTemplate`. `prConcurrentLimit` and `prHourlyLimit` throttle how many merge requests open at once, and the dependency dashboard issue gives each repository a list of pending updates. Check `prBodyNotes` and every option against the docs for your Renovate version before rolling the preset out; the configuration above was not run.

### With a script

Without Renovate, or for changes Renovate cannot express, a script can open the merge requests through the GitLab API: it reads the file with the repository files API, edits it, creates a branch and commit in one call with the commits API (`branch` plus `start_branch`), and opens a merge request with a label. It is a dry run unless you pass `--apply`.

```python title="open_mrs.py"
#!/usr/bin/env python3
"""Open one campaign merge request per repository that bumps a library chart
dependency in Chart.yaml through the GitLab API. Dry run unless --apply.
Standard library only.

Input CSV columns: project (ID or full path), file (path of Chart.yaml in the repo).

  GITLAB_URL=https://gitlab.example.com GITLAB_TOKEN=... \
    python3 open_mrs.py targets.csv --chart platform-lib --to 3.0.0 --campaign PLAT-123 [--apply]
"""
import argparse
import csv
import difflib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ITEM_RE = re.compile(r"^(\s*)-\s+(.*)$")


def bump(text: str, chart: str, new_version: str):
    """Return (new_text, old_version) for the single dependency named `chart`."""
    lines = text.splitlines(keepends=True)
    in_deps, items, current, item_indent = False, [], None, None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        if indent == 0 and not (in_deps and stripped.startswith("-")):
            in_deps = stripped.startswith("dependencies:")
            current = None
            continue
        if not in_deps:
            continue
        m = ITEM_RE.match(line.rstrip("\n"))
        if m and (item_indent is None or len(m.group(1)) == item_indent):  # nested lists stay in the item
            item_indent = len(m.group(1))
            current = {"lines": []}
            items.append(current)
            body = m.group(2)
        else:
            body = stripped
        if current is not None:
            current["lines"].append((i, body))
    matches = []
    for item in items:
        names = [b for _, b in item["lines"] if re.match(rf"name:\s*['\"]?{re.escape(chart)}['\"]?\s*(#.*)?$", b)]
        if names:
            matches.append(item)
    if len(matches) != 1:
        raise ValueError(f"expected one dependency named {chart}, found {len(matches)}")
    versions = [(i, b) for i, b in matches[0]["lines"] if b.startswith("version:")]
    if len(versions) != 1:
        raise ValueError(f"expected one version line for {chart}")
    i, _ = versions[0]
    m = re.match(r"^(.*?version:\s*)(['\"]?)([^'\"\s#]+)(['\"]?)(.*)$", lines[i], re.S)
    old = m.group(3)
    lines[i] = f"{m.group(1)}{m.group(2)}{new_version}{m.group(4)}{m.group(5)}"
    return "".join(lines), old


class GitLab:
    def __init__(self, base: str, token: str):
        self.base, self.token = base.rstrip("/"), token

    def call(self, method: str, path: str, body=None, raw=False):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self.base}/api/v4/{path}", data=data, method=method)
        req.add_header("PRIVATE-TOKEN", self.token)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = resp.read()
        return payload.decode() if raw else json.loads(payload)


def main() -> int:
    ap = argparse.ArgumentParser(description="Open campaign merge requests for a chart bump")
    ap.add_argument("targets")
    ap.add_argument("--chart", required=True)
    ap.add_argument("--to", required=True, help="new exact version")
    ap.add_argument("--campaign", required=True, help="campaign id, used in branch, label and title")
    ap.add_argument("--pause", type=float, default=2.0, help="seconds between repositories")
    ap.add_argument("--apply", action="store_true", help="really create branches and MRs")
    args = ap.parse_args()

    token = os.environ.get("GITLAB_TOKEN")
    if not token:
        print("export GITLAB_TOKEN (api scope, from a bot account)", file=sys.stderr)
        return 2
    gl = GitLab(os.environ.get("GITLAB_URL", "https://gitlab.example.com"), token)
    branch = f"campaign/{args.campaign.lower()}-{args.chart}-{args.to}"
    failures = 0

    with open(args.targets, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            project, path = row["project"].strip(), row["file"].strip()
            pid = urllib.parse.quote(project, safe="")
            try:
                default = gl.call("GET", f"projects/{pid}")["default_branch"]
                fpath = urllib.parse.quote(path, safe="")
                text = gl.call("GET", f"projects/{pid}/repository/files/{fpath}/raw?ref={default}", raw=True)
                new_text, old = bump(text, args.chart, args.to)
                if old == args.to:
                    print(f"SKIP {project}: already on {args.to}")
                    continue
                print(f"{'APPLY' if args.apply else 'DRY-RUN'} {project}: {args.chart} {old} -> {args.to}")
                if not args.apply:
                    sys.stdout.writelines(difflib.unified_diff(
                        text.splitlines(True), new_text.splitlines(True), f"a/{path}", f"b/{path}"))
                    continue
                gl.call("POST", f"projects/{pid}/repository/commits", {
                    "branch": branch,
                    "start_branch": default,
                    "commit_message": f"Bump {args.chart} to {args.to} ({args.campaign})",
                    "actions": [{"action": "update", "file_path": path, "content": new_text}],
                })
                mr = gl.call("POST", f"projects/{pid}/merge_requests", {
                    "source_branch": branch,
                    "target_branch": default,
                    "title": f"Bump {args.chart} to {args.to} ({args.campaign})",
                    "description": f"Part of campaign {args.campaign}. See the campaign brief for "
                                   "the upgrade guide, deadline and office hours.",
                    "labels": f"campaign::{args.campaign}",
                    "remove_source_branch": True,
                })
                print(f"  opened {mr['web_url']}")
            except (urllib.error.URLError, ValueError, KeyError) as exc:
                failures += 1
                print(f"FAIL {project}: {exc}", file=sys.stderr)
            time.sleep(args.pause)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
```

Dry run on sample data:

```text
DRY-RUN 1: platform-lib 1.4.0 -> 2.0.0
--- a/chart/Chart.yaml
+++ b/chart/Chart.yaml
@@ -3,5 +3,5 @@
 version: 0.1.0
 dependencies:
   - name: platform-lib
-    version: 1.4.0
+    version: 2.0.0
     repository: oci://registry.example.com/charts
SKIP 2: already on 2.0.0
FAIL 5: HTTP Error 404: Not Found
```

Rules for campaign automation:

- **Run as a bot account** (a group access token or service account), never a person's token, with the smallest scope that can push branches and open merge requests ([[offboarding-platform-engineers]] explains why personal tokens in automation hurt later).
- **Never pass `force`** to the commits API: the GitLab docs warn that it overwrites the target branch. The script does not.
- **Do not give the bot "allowed to push and merge"** on protected branches. Merge requests should still go through each team's review and Code Owner approvals, which is also how teams learn what changed.
- **Lock files.** If repositories commit `Chart.lock`, a merge request that changes only `Chart.yaml` leaves the lock out of date, and the chart build may fail. Renovate's Helm manager can update lock files (check its docs for your version); a plain API commit cannot run `helm`. Either update the lock in the team's pipeline or prefer Renovate for this change.
- **Pilot first.** Run the change by hand on three repositories of different shapes, measure the effort, and fix the upgrade guide before opening a hundred merge requests.

## Tracking board and burn-up

Progress is the inventory re-run, not merge requests opened. Re-scan weekly and count:

```bash
awk -F, '$2 == "chart:platform-lib" { split($5, v, "."); gsub(/[^0-9]/, "", v[1]); total++; if (v[1] + 0 >= 3) done++ }
  END { printf "%d of %d charts on 3.x (%.0f%%)\n", done, total, total ? 100 * done / total : 0 }' inventory.csv
```

Record the number each week and plot it as a burn-up against the deadline. Keep a board with one row per repository and these columns: owner, merge request link, state (not started, MR open, merged, deployed, exception), last nudge date, notes. The merge request label (`campaign::PLAT-123`) lets GitLab's merge request list show what is open across the group.

A campaign is done when the code is deployed, not merged. If the change matters at runtime (a chart, an image), check what runs, for example through the image and chart versions your deploy tooling reports, not only the default branch.

## Nudge ladder and office hours

Escalate in steps, politely and on a calendar the brief announced in advance. The dates below assume a three-month campaign (example, set your own).

| When     | Step                                                                                     | From                        |
| -------- | ---------------------------------------------------------------------------------------- | --------------------------- |
| Week 0   | Announcement with the brief, in every channel teams read ([[stakeholder-communication]]) | Campaign owner              |
| Week 1   | Bot merge requests opened                                                                | Bot                         |
| Weekly   | Office hours: drop-in session for teams stuck on the change                              | Campaign owner              |
| Week 4   | Comment on open merge requests, message to team channels with the board link             | Campaign owner              |
| Week 8   | Direct message to each remaining team's engineering manager, with effort estimate        | Campaign owner              |
| Week 10  | CI warning in every pipeline still on the old version                                    | Central CI template         |
| Week 11  | Remaining teams listed in the platform's status update to engineering leadership         | Sponsor                     |
| Deadline | Enforcement, or approved exception                                                       | Central CI template, policy |

For the last few repositories, offer to make the change for the team, pairing with one of their engineers. An hour of the platform team's time is usually cheaper than a month of nudging. Dependencies on other teams' roadmaps belong in [[cross-team-dependencies]].

## Enforcement at the deadline

Enforcement is what makes the deadline real, and the reason the earlier steps are generous. Move from audit to enforce in two releases, as described in [[policy-rollout-audit-to-enforce]].

1. **Warn.** A new policy rule in the central policy bundle, run by a job in the central CI templates, prints a warning but does not fail. Conftest treats `warn` rules as passing with a message ([[conftest-policy-gate-for-manifests]]).
2. **Enforce.** At the deadline, the rule becomes `deny` in a new release of the policy bundle, and pipelines of repositories still on the old version fail, unless they hold an exception.

```rego title="policy/campaign/platform_lib.rego"
package campaign.platform_lib

import rego.v1

# Campaign PLAT-123: every chart on platform-lib 3.x by 2027-01-31.
required_major := 3

exact_version := `^v?[0-9]+\.[0-9]+\.[0-9]+$`

lib_deps contains dep if {
	some dep in input.dependencies
	dep.name == "platform-lib"
}

major(v) := to_number(split(trim_prefix(v, "v"), ".")[0])

# Change "warn" to "deny" in the release that ships on the deadline.
warn contains msg if {
	some dep in lib_deps
	regex.match(exact_version, dep.version)
	major(dep.version) < required_major
	msg := sprintf("platform-lib %s is below %d.x: upgrade by 2027-01-31 (campaign PLAT-123)", [dep.version, required_major])
}

warn contains msg if {
	some dep in lib_deps
	not regex.match(exact_version, dep.version)
	msg := sprintf("platform-lib version %v is not an exact version: pin it (campaign PLAT-123)", [dep.version])
}
```

```bash
conftest test --namespace campaign.platform_lib --policy policy chart/Chart.yaml
```

The policy was not run for this note: add unit tests next to it and run them with `conftest verify` or `opa test` before shipping, as the Conftest note describes, and check the flag names for your Conftest version. If consumers pin the central CI templates by tag ([[gitlab-ci-components-and-includes]], [[0013-versioned-central-ci-templates]]), the enforcing rule only reaches them when they move to the new template version, which can itself be part of the campaign. For runtime changes, the same audit-then-enforce pattern applies at admission in the cluster.

## Exceptions with expiry

Some repositories cannot meet the date: a service being retired next quarter, a vendor chart that has not caught up, a team in a freeze. Handle them through the normal waiver process ([[policy-exception-and-waiver-process]]):

- One exception per repository, with an owner, a reason, a compensating control if there is a risk, and an **expiry date**, at most one or two months out (example, set your own).
- The enforcing job reads the exception list from the policy repository, so the exception is reviewed like code.
- Expired exceptions fail like any other repository; renewal needs a new approval.
- Retiring services get an exception that ends on their shutdown date ([[decommissioning-platform-services]]).

## Closing the campaign

1. **Inventory shows zero** repositories on the old version, apart from live exceptions.
2. **Remove shims:** compatibility code in the library chart, old template versions, redirects, dual-publishing. This is the payoff; do not skip it.
3. **Turn the policy into the default** or remove it, whichever keeps the CI templates simple.
4. **Retro** with two or three consuming teams: what made the change easy or hard, effort actually spent, what the next campaign should do differently. Record it in the brief.
5. **Update the EOL register** if the campaign was driven by an end-of-life date ([[end-of-life-tracking-platform-versions]]).

## Worked example: platform-lib 2.x to 3.x

The shared library chart from [[helm-library-and-umbrella-charts]] gets a new major version that renames a few values and drops a deprecated template.

- **Weeks -4 to -1.** RFC accepted. Release `platform-lib` 3.0.0 alongside 2.x. Pilot on three services of different shapes (a simple deployment, one with a CronJob, one using an umbrella chart); the effort is about 30 minutes each, mostly values renames. Write the upgrade guide from the pilot diffs, including how to roll back (revert the merge request; 2.x stays published).
- **Week 0.** Inventory: 84 charts in 61 repositories (illustrative numbers). Brief published, announcement sent.
- **Week 1.** Renovate opens grouped merge requests with the campaign label. Repositories without Renovate get merge requests from `open_mrs.py`. Office hours start.
- **Week 6.** Burn-up at 70%. The remaining repositories cluster in three teams; the owner contacts their managers and offers pairing.
- **Week 10.** CI warning on in the central templates. Two teams ask for exceptions: one retiring service (exception to its shutdown date), one vendor-wrapped chart (four-week exception).
- **Deadline.** The rule becomes `deny`. Three repositories fail their next pipeline; all three fix it within two days, using the guide linked from the failure message.
- **Close.** The 2.x compatibility templates are removed in 3.1.0, the 2.x line stops receiving fixes as announced, and the retro notes that the CronJob values rename caused most of the questions.

## Common mistakes

- **No owner.** "The platform team" does not chase the last ten repositories. One named person does.
- **Counting merge requests opened** instead of repositories migrated and deployed.
- **An upgrade guide written before the pilot.** It misses the real problems.
- **Announcing in one channel.** Teams that do not read it are the long tail.
- **Enforcing without warning.** Breaking pipelines on deadline day without a warning phase burns trust for the next campaign.
- **Deadlines without exceptions,** or exceptions without expiry. Either the deadline is ignored, or the exception list becomes permanent.
- **Bot merge requests that bypass review.** Teams learn nothing and own a change they never saw.
- **Never removing the shim.** Then the campaign only added complexity.

## Sources

- [GitLab: groups API](https://docs.gitlab.com/api/groups/) and [projects API](https://docs.gitlab.com/api/projects/): listing a group's projects, `include_subgroups`, `archived`, pagination limits.
- [GitLab: REST API](https://docs.gitlab.com/api/rest/): pagination headers and namespaced path encoding.
- [GitLab: commits API](https://docs.gitlab.com/api/commits/), [repository files API](https://docs.gitlab.com/api/repository_files/) and [merge requests API](https://docs.gitlab.com/api/merge_requests/): creating the branch, commit and merge request; the `force` warning.
- [GitLab: search API](https://docs.gitlab.com/api/search/), [advanced search](https://docs.gitlab.com/user/search/advanced_search/) and [exact code search](https://docs.gitlab.com/user/search/exact_code_search/): code search tiers.
- [Renovate: configuration options](https://docs.renovatebot.com/configuration-options/): `customManagers`, `packageRules`, `prConcurrentLimit`, `prHourlyLimit`, dependency dashboard.
- [Renovate: self-hosted configuration](https://docs.renovatebot.com/self-hosted-configuration/): autodiscovery for running across a fleet.
- [Kubernetes: deprecated API migration guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/) and [deprecation policy](https://kubernetes.io/docs/reference/using-api/deprecation-policy/): finding callers of deprecated APIs.
- [Helm: charts](https://helm.sh/docs/topics/charts/): the `dependencies` field of `Chart.yaml`. Check the current docs.

## Related

- [[automated-dependency-updates]] and [[0060-renovate-for-automated-dependency-updates]]: the update tooling campaigns build on.
- [[terraform-module-versioning]]: versioned shared code that campaigns move.
- [[gitlab-ci-components-and-includes]]: pinned central templates.
- [[policy-rollout-audit-to-enforce]] and [[policy-exception-and-waiver-process]]: enforcement and exceptions.
- [[end-of-life-tracking-platform-versions]]: the dates that start most campaigns.
- [[cross-team-dependencies]]: working with other teams' roadmaps.
