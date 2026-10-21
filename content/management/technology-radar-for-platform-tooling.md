---
title: A technology radar for platform tooling
description: Keep platform tool choices visible and governed with a radar stored as code, rings tied to support obligations, a validator in CI and soft enforcement of hold.
type: guide
tags:
  - management
  - leadership
  - team-process
  - delivery
created: 2026-10-21
modified: 2026-10-21
draft: false
---

Tool sprawl rarely comes from one bad decision. It comes from a hundred reasonable ones: a team needs a pipeline today and the old CI server is right there, someone trials a registry and nobody turns it off, a deprecated configuration tool keeps getting new hosts because nobody said otherwise. Each extra tool means another thing to patch, license, monitor, secure and teach. A technology radar makes the default visible: what to use, what is being tried, what is only being looked at and what must not be started. Done well, it governs adoption over time without blocking experiments, and it links every position to the decision behind it.

> [!info] Scope and what is not verified
> Ring and quadrant names come from the Thoughtworks Technology Radar FAQ. The Build your own Radar README (read on 2026-10-21) states that the fourth ring was renamed from Hold to Caution and that "Hold" input is still accepted and shown as Caution. Not checked against current docs: the wording Thoughtworks uses to describe Caution, the input format and accepted values of the Build your own Radar tool for the version you use (including whether the hosted instance accepts custom quadrants), and the configuration syntax of any enforcement tool named here. The validator and CI jobs in this note were written for it; the validator was run against the example entries, the CI jobs were not run.

## What a radar is

The Thoughtworks Technology Radar is a periodic, opinionated snapshot of techniques and tools, sorted into **rings** and **quadrants**:

- **Rings** say how strongly to use something. Adopt means proven and mature for use. Trial means ready for use but less proven; Thoughtworks only puts things there after production experience. Assess means worth keeping an eye on. The outer ring was long called Hold, described as "don't start anything new with this technology"; recent editions label it Caution; check the current FAQ for how Thoughtworks describes it.
- **Quadrants** group entries by kind. Thoughtworks uses Techniques, Platforms, Tools, and Languages and Frameworks. Its FAQ notes that the quadrant matters less than the ring.

Many organisations build an internal radar on the same idea (Thoughtworks has published guidance on an enterprise radar, linked in Sources). An internal radar is not a market survey. It is a statement about **your** platform: what you support, what you will help with, and what you will not.

## Rings mapped to platform obligations

The ring must mean something operational, or nobody will care which ring a tool is in. Tie each ring to what the platform team promises:

| Ring   | Meaning for a product team                                                             | Platform obligation                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adopt  | The default. Use it without asking.                                                    | Supported paved road: templates, docs, upgrades, on-call knowledge, a named owner. See [[platform-team-operating-model]].                                            |
| Trial  | Allowed for real work, with a named owner in your team and the platform team informed. | Best-effort help. The trial has exit criteria and a review date that decides adopt or hold.                                                                          |
| Assess | Spike or proof of concept only, not in production.                                     | None beyond answering questions. A write-up of what was learned is expected.                                                                                         |
| Hold   | No new use. Existing use continues under a migration plan.                             | Keeps existing use safe (patching, end-of-life tracking) until it is gone. See [[decommissioning-platform-services]] and [[end-of-life-tracking-platform-versions]]. |

This note keeps the name **Hold** for the outer ring because it states the rule ("no new use") more clearly than Caution for an internal audience. Use whichever word your organisation will read correctly, and say which.

Two consequences of these definitions:

- **Adopt costs the platform team money and time.** An item should only reach adopt if someone is funded to support it, see [[engineering-budget-planning]] and [[devops-vendor-and-licence-management]] for licensed tools.
- **Hold is not a ban.** It stops growth and starts an exit. Existing users are not punished; they get a migration path and a realistic timeline.

## Quadrants adapted to platform tooling

The Thoughtworks quadrants fit a broad technology survey. For a platform radar, quadrants that match how your teams think about the platform are easier to use. An example set:

| Quadrant                   | Examples of what goes there                                        |
| -------------------------- | ------------------------------------------------------------------ |
| Delivery                   | CI systems, deployment and GitOps tools, release techniques        |
| Infrastructure             | IaC binaries, image building, configuration management, registries |
| Runtime                    | Kubernetes add-ons, service mesh, ingress, managed data services   |
| Security and observability | Scanners, secret management, policy engines, metrics and logs      |

If you want to draw the radar with a tool that expects the standard quadrant names, map yours onto them in the export or use a self-hosted version that allows custom names (check the tool's README).

## One entry per item, stored as code

Keep the radar in a repository: one JSON file per entry, reviewed by merge request. One file per entry keeps each move a small, reviewable change with its own history, and the standard library can validate JSON without extra dependencies.

Every entry carries the fields that make it governable, not just a name and a ring:

```json title="radar/entries/gitlab-ci.json"
{
  "name": "GitLab CI",
  "quadrant": "delivery",
  "ring": "adopt",
  "is_new": false,
  "owner": "platform-ci",
  "description": "Default for every new delivery pipeline, using the shared CI templates.",
  "rationale": "ADR 0012: all new delivery pipelines are written in GitLab CI.",
  "adr": "0012-gitlab-ci-for-new-pipelines",
  "review_by": "2027-04-30"
}
```

| Field           | Required                    | Purpose                                                      |
| --------------- | --------------------------- | ------------------------------------------------------------ |
| `name`          | yes                         | Display name; the file name is its lower-kebab form          |
| `quadrant`      | yes                         | One of the quadrants above                                   |
| `ring`          | yes                         | `adopt`, `trial`, `assess`, `hold`, or `pending` (see below) |
| `owner`         | yes                         | Team or role that answers questions and runs the review      |
| `description`   | yes                         | What a reader should do, in one or two sentences             |
| `rationale`     | yes                         | Why it is in this ring, with evidence                        |
| `adr`           | for adopt, hold and pending | The ADR that records the decision, by file name              |
| `migration`     | for hold                    | How existing use ends: a plan link or one line               |
| `exit_criteria` | for trial                   | What evidence moves it to adopt or to hold                   |
| `review_by`     | yes                         | Date by which the position is reviewed                       |
| `is_new`        | no                          | Marks entries that moved or appeared in this edition         |

**Open decisions.** Some questions are genuinely undecided. Putting an undecided tool into adopt or hold misleads readers. The `pending` ring in this scheme means "a decision is open in a proposed ADR": the validator requires the ADR link and leaves the entry off the drawn radar, and the published page lists it separately under "decisions in progress".

## Example entries from current ADRs

The entries below are an illustration derived from the ADRs in this repository, not an official radar. Each states only what its ADR decides.

| Entry                                     | Quadrant       | Ring    | What the ADR decides                                                                                                                                  |
| ----------------------------------------- | -------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitLab CI                                 | Delivery       | Adopt   | All new delivery pipelines are GitLab CI ([[0012-gitlab-ci-for-new-pipelines\|ADR 0012]]).                                                            |
| Jenkins                                   | Delivery       | Hold    | Frozen for new jobs; existing jobs stay and migrate when they next need a significant change; no deadline (ADR 0012).                                 |
| Argo CD                                   | Delivery       | Adopt   | Delivery on Kubernetes ([[0017-argo-cd-and-rollouts-not-spinnaker\|ADR 0017]]).                                                                       |
| Argo Rollouts                             | Delivery       | Adopt   | Progressive delivery on Kubernetes (ADR 0017).                                                                                                        |
| Spinnaker                                 | Delivery       | Hold    | Not adopted; reconsidered only for what Argo CD cannot model: multi-cloud, VM or instance-group targets, orchestration outside Kubernetes (ADR 0017). |
| Immutable host images (Packer and InSpec) | Infrastructure | Adopt   | New hosts come from tested images rolled out through managed instance groups ([[0041-retire-chef-for-immutable-images\|ADR 0041]]).                   |
| Chef                                      | Infrastructure | Hold    | Not used for new hosts; existing hosts stay until they migrate; exceptions need an owner and an end date (ADR 0041).                                  |
| IaC binary: Terraform or OpenTofu         | Infrastructure | Pending | Undecided. [[0031-terraform-or-opentofu\|ADR 0031]] is proposed: one binary pinned in CI, one tool per state; the choice itself is open.              |

Spinnaker is a slightly unusual hold: it was never adopted, so there is nothing to migrate. It is on the radar because people ask about it, and the entry answers the question with the reopen conditions.

The hold and pending entries as files:

```json title="radar/entries/jenkins.json"
{
  "name": "Jenkins",
  "quadrant": "delivery",
  "ring": "hold",
  "is_new": false,
  "owner": "platform-ci",
  "description": "No new jobs. Existing jobs keep running until they next need a significant change.",
  "rationale": "ADR 0012 freezes Jenkins for new jobs; there is no migration deadline.",
  "adr": "0012-gitlab-ci-for-new-pipelines",
  "migration": "A job moves to GitLab CI when it next needs a significant change (ADR 0012).",
  "review_by": "2027-04-30"
}
```

```json title="radar/entries/iac-binary-terraform-or-opentofu.json"
{
  "name": "IaC binary: Terraform or OpenTofu",
  "quadrant": "infrastructure",
  "ring": "pending",
  "is_new": false,
  "owner": "platform-iac",
  "description": "Undecided. One binary pinned in CI with exactly one tool per state is proposed; the choice between the two is open.",
  "rationale": "ADR 0031 is proposed, not accepted. Do not treat either tool as the standard until it is decided.",
  "adr": "0031-terraform-or-opentofu",
  "review_by": "2027-01-31"
}
```

For background on the Terraform and OpenTofu question, see [[terraform-vs-opentofu]]. For the Jenkins exit, see [[jenkins-to-gitlab-migration-programme]].

## Validate the radar in CI

The validator checks every entry, fails on missing or invalid fields, warns on overdue reviews and can export a CSV in the column layout that the Build your own Radar tool documents (`name`, `ring`, `quadrant`, `isNew`, `description`; the README also documents an optional `status` column for showing movement, which this export does not write).

```python title="radar/validate_radar.py"
#!/usr/bin/env python3
"""Validate technology radar entries (one JSON file each) and optionally export a CSV.

Usage: validate_radar.py [--entries DIR] [--today YYYY-MM-DD] [--strict] [--export-csv FILE]
Exit 1 on an invalid entry; with --strict, also when a review date has passed.
Standard library only.
"""
import argparse
import csv
import json
import pathlib
import re
import sys
from datetime import date

RINGS = {"adopt", "trial", "assess", "hold", "pending"}  # pending: decision open in a proposed ADR
QUADRANTS = {"delivery", "infrastructure", "runtime", "security-and-observability"}
REQUIRED = ("name", "quadrant", "ring", "owner", "description", "rationale", "review_by")
ADR_RE = re.compile(r"^\d{4}-[a-z0-9-]+$")  # ADR file name without .md


def check(path, entry, today):
    errors, warnings = [], []
    for field in REQUIRED:
        if not str(entry.get(field, "")).strip():
            errors.append(f"missing {field}")
    ring = entry.get("ring")
    if ring not in RINGS:
        errors.append(f"ring {ring!r} is not one of {sorted(RINGS)}")
    if entry.get("quadrant") not in QUADRANTS:
        errors.append(f"quadrant {entry.get('quadrant')!r} is not one of {sorted(QUADRANTS)}")
    adr = entry.get("adr")
    if adr is not None and not ADR_RE.match(str(adr)):
        errors.append(f"adr {adr!r} should look like 0012-short-title")
    if ring in {"adopt", "hold", "pending"} and not adr:
        errors.append(f"ring {ring} needs an adr that records the decision")
    if ring == "hold" and not str(entry.get("migration", "")).strip():
        errors.append("ring hold needs a migration plan (link or one line)")
    if ring == "trial" and not str(entry.get("exit_criteria", "")).strip():
        errors.append("ring trial needs exit_criteria (what moves it to adopt or hold)")
    try:
        review_by = date.fromisoformat(str(entry.get("review_by")))
        if review_by < today:
            warnings.append(f"review_by {review_by} has passed")
    except ValueError:
        errors.append(f"review_by {entry.get('review_by')!r} is not YYYY-MM-DD")
    if path.stem != slug(entry.get("name", "")):
        warnings.append(f"file name should be {slug(entry.get('name', ''))}.json")
    return errors, warnings


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--entries", default="radar/entries")
    p.add_argument("--today", type=date.fromisoformat, default=date.today())
    p.add_argument("--strict", action="store_true", help="fail on overdue reviews too")
    p.add_argument("--export-csv", help="write name,ring,quadrant,isNew,description")
    args = p.parse_args()

    files = sorted(pathlib.Path(args.entries).glob("*.json"))
    if not files:
        sys.exit(f"no entries found in {args.entries}")
    entries, failed, overdue, names = [], False, False, set()
    for path in files:
        try:
            entry = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as err:
            print(f"ERROR {path}: not valid JSON: {err}")
            failed = True
            continue
        errors, warnings = check(path, entry, args.today)
        key = str(entry.get("name", "")).lower()
        if key in names:
            errors.append("duplicate name")
        names.add(key)
        for msg in errors:
            print(f"ERROR {path}: {msg}")
        for msg in warnings:
            print(f"WARN  {path}: {msg}")
        failed = failed or bool(errors)
        overdue = overdue or any("has passed" in w for w in warnings)
        entries.append(entry)

    if args.export_csv and not failed:
        with open(args.export_csv, "w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(["name", "ring", "quadrant", "isNew", "description"])
            for e in sorted(entries, key=lambda e: (e["quadrant"], e["ring"], e["name"])):
                if e["ring"] == "pending":
                    continue  # open decisions are listed separately, not drawn on the radar
                writer.writerow([e["name"], e["ring"], e["quadrant"],
                                 str(bool(e.get("is_new", False))).lower(), e["description"]])
    print(f"{len(files)} entries checked")
    sys.exit(1 if failed or (args.strict and overdue) else 0)


if __name__ == "__main__":
    main()
```

Output against the example entries (run on 2026-10-21):

```text
8 entries checked
```

And against a broken entry, to show what a reviewer sees:

```text
ERROR bad/x.json: missing owner
ERROR bad/x.json: quadrant 'tools' is not one of ['delivery', 'infrastructure', 'runtime', 'security-and-observability']
ERROR bad/x.json: ring trial needs exit_criteria (what moves it to adopt or hold)
WARN  bad/x.json: review_by 2026-01-01 has passed
WARN  bad/x.json: file name should be some-tool.json
1 entries checked
```

Wire it into the radar repository's pipeline. Overdue reviews only warn on merge requests, so a stale entry does not block an unrelated change, and fail in a scheduled pipeline so the owner is told:

```yaml title=".gitlab-ci.yml"
stages:
  - validate

variables:
  PYTHON_IMAGE: python:3.12-slim # pin by digest in your registry

radar:validate:
  stage: validate
  image: $PYTHON_IMAGE
  script:
    - python3 radar/validate_radar.py --entries radar/entries --export-csv radar.csv
  artifacts:
    paths:
      - radar.csv
    expire_in: 30 days
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

radar:review-due:
  stage: validate
  image: $PYTHON_IMAGE
  script:
    - python3 radar/validate_radar.py --entries radar/entries --strict
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
```

The `python:3.12-slim` tag is an example; use the image your CI baseline pins, see [[0012-gitlab-ci-for-new-pipelines]].

## Process: proposing and moving entries

- **Proposal.** Anyone may propose a new entry or a move by merge request. A move into adopt, or into hold for something in active use, is a significant platform change and goes through the [[rfc-and-design-review-process]], ending in an ADR (see [[adr/index|the ADR index]]).
- **Evidence for moves.** Trial to adopt needs production experience from the trial (incidents, effort, user feedback), a funded owner, and docs. Anything to hold needs a migration plan and an end-of-life view. Assess to trial needs a team willing to own it in production.
- **Build or buy.** If a trial involves a paid product or a self-built tool, run the comparison in [[build-vs-buy-devops-tools]] before the move.
- **Quarterly review.** Once a quarter the owners walk the entries whose `review_by` falls in the next quarter. Each one is confirmed, moved, or removed. The review is short; the evidence is in the merge requests.
- **Removing entries.** When the last use of a hold item is gone, record the decommissioning (see [[decommissioning-platform-services]]) and remove the entry in the next edition, noting it in the changelog.

## Soft enforcement of hold

Enforcement should make the radar visible at the moment someone is about to ignore it, not block them silently. Soft signals work better than hard gates for most items:

- **A warning job in product pipelines.** A job that flags a merge request adding a hold technology (a new `Jenkinsfile`, a new Chef cookbook) shows up as a warning, with a link to the radar entry. The sketch below allows the job to fail, so the pipeline passes with a visible warning.
- **Dependency update rules.** Update bots such as Renovate can be configured to stop proposing upgrades for hold items, or to label them. Check the bot's current documentation for the exact rule syntax; it is not reproduced here.
- **Image and registry allow-lists.** Admission policies or registry rules can warn on images from tools in hold. Start in audit or warn mode before any enforcement.
- **Hard gates only where the ADR requires it.** For a security-relevant hold (for example a tool with an unpatched end-of-life), an enforcing control is justified, with an exception process.

```yaml title="templates/radar-hold-check.gitlab-ci.yml"
# Warns when a merge request adds files that indicate a technology in the hold ring.
# Not run for this note: check the predefined variable names in your GitLab version.
radar:hold-check:
  stage: test
  image:
    name: $GIT_IMAGE # any pinned image with git and a POSIX shell
    entrypoint: [""] # some git images set git as the entrypoint
  variables:
    GIT_IMAGE: registry.example.com/platform/git:pinned
    GIT_DEPTH: "0" # the merge base must be in the clone
  script:
    - |
      set -eu
      base="${CI_MERGE_REQUEST_DIFF_BASE_SHA:?not a merge request pipeline}"
      added="$(git diff --name-only --diff-filter=A "$base" HEAD)"
      found=0
      if printf '%s\n' "$added" | grep -Eq '(^|/)Jenkinsfile$'; then
        echo "New Jenkinsfile: Jenkins is on hold for new jobs (ADR 0012). Use GitLab CI."
        found=1
      fi
      if printf '%s\n' "$added" | grep -Eq '(^|/)cookbooks/[^/]+/metadata\.rb$'; then
        echo "New Chef cookbook: Chef is on hold for new hosts (ADR 0041). Use an image build."
        found=1
      fi
      exit "$found"
  allow_failure: true
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

## Publishing

- **One page, generated.** Publish the radar as a page generated from the entries, grouped by quadrant and ring, with the pending decisions in their own list. If you use the Build your own Radar tool, feed it the exported CSV; the hosted tool expects a public sheet or a reachable CSV or JSON URL, which is often not acceptable for internal data, so a self-hosted copy or your own page is usually the better fit.
- **Editions.** Publish on a fixed cadence (for example after each quarterly review) with a short changelog: what moved and why, with links to the ADRs.
- **Link from the paved road.** The golden-path docs, the CI templates and the onboarding guide link to the radar. A radar nobody sees at the moment of choice does nothing.

## Common mistakes

- **A radar as a wish list.** Entries in adopt that nobody supports. Adopt means a funded owner.
- **Positions without reasons.** Every entry needs a rationale and, for adopt and hold, an ADR. Otherwise the radar is an opinion and will be ignored.
- **Hold without a migration plan.** Teams on the old tool are left without a path, and hold becomes permanent.
- **Forcing undecided questions into a ring.** If the ADR is still proposed, say so. Calling a tool the standard before the decision creates rework and distrust.
- **Never reviewing.** A radar older than a year describes a platform that no longer exists. The `review_by` field and the scheduled job keep it honest.
- **Blocking experiments.** If assess and trial are hard to enter, people experiment off the radar. Keep entry cheap and adopt demanding.
- **Hard enforcement first.** A blocking gate on a hold item breaks pipelines the day it lands. Warn first, measure, then decide.

## Sources

- [Thoughtworks Technology Radar FAQ](https://www.thoughtworks.com/en-us/radar/faq): ring and quadrant names and meanings; check for the current outer ring label.
- [Thoughtworks: Build your own Radar](https://www.thoughtworks.com/radar/byor): input options and fields.
- [Build your own Radar on GitHub](https://github.com/thoughtworks/build-your-own-radar): the self-hosted tool, input format and customisation; check the README for your version.
- [Thoughtworks: How to create your enterprise technology radar](https://www.thoughtworks.com/insights/blog/technology-strategy/how-to-create-your-enterprise-technology-radar): guidance on internal radars.
- The ADRs cited above, read from this repository on 2026-10-21.

## Related

- [[adr/index|The ADR index]]: where radar decisions are recorded.
- [[build-vs-buy-devops-tools]]: deciding whether to adopt a product or build.
- [[decommissioning-platform-services]] and [[end-of-life-tracking-platform-versions]]: what hold leads to.
- [[devops-vendor-and-licence-management]]: the cost side of adopt.
- [[rfc-and-design-review-process]]: how a move is proposed and decided.
- [[0012-gitlab-ci-for-new-pipelines]], [[0017-argo-cd-and-rollouts-not-spinnaker]], [[0041-retire-chef-for-immutable-images]] and [[0031-terraform-or-opentofu]]: the decisions behind the example entries.
- [[platform-team-operating-model]]: the paved road that adopt promises.
