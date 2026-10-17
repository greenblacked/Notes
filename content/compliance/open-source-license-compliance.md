---
title: Open-source licence compliance in the pipeline
description: Build a licence inventory from SBOMs, classify licences into allow, review and deny lists, gate merges in CI and handle exceptions.
type: standard
tags:
  - compliance
  - supply-chain
  - ci-cd
  - audit
created: 2026-10-17
modified: 2026-10-17
draft: false
---

This standard describes how to turn SBOMs into a licence inventory, classify licences into allow, review and deny lists, gate builds on the result, and handle exceptions. It is written for senior DevOps engineers who run the pipeline; the decisions about what each licence means belong to legal counsel. SBOM generation is covered in [[compliance/sbom-generation-and-storage]], dependency update automation in [[patterns/automated-dependency-updates]].

> [!warning] Not legal or audit advice
> This is general engineering guidance. Your auditor, assessor or legal counsel decides what satisfies a control or a legal obligation; check control numbers and wording against the current edition of the framework.

> [!info] Scope and sources
> Written against SPDX licence identifiers and expressions ([spdx.dev](https://spdx.dev)) and the CycloneDX JSON SBOM format ([cyclonedx.org](https://cyclonedx.org)). The policy lists below are examples to agree with legal, not recommendations about any specific licence.

> [!note] Not verified
> The claims below were written from documentation knowledge and were not checked against a running system or the current docs: the CycloneDX JSON licence field shapes in the current spec version. The legal position on any specific licence is not stated here; legal decides. Check the field shapes against your SBOM before relying on the script.

## Rules

- Legal owns the lists. Engineering owns the mechanism that applies them and the evidence that it ran.
- Classify by SPDX identifier, not by free-text names. Free text is "unknown" until someone maps it.
- Three outcomes only: allow (build passes), review (build passes with a warning and a ticket), deny (build fails).
- Unknown or missing licences fail the build, so gaps cannot hide.
- Evaluate the SBOM of the built artifact, including transitive dependencies, not only the direct dependencies in the manifest.
- Keep the policy file in Git, reviewed like code, with the date and the person from legal who approved the last change.
- Every exception is written down, has an owner and an expiry, and is reviewed at expiry.
- Check the policy against the licence of the artifact you ship, not only against the licences of inputs. Distribution model matters (internal service, SaaS, shipped binary) and legal sets the rules per model.

## Policy table

| Class  | Meaning for the pipeline                       | Example SPDX identifiers                                                     |
| ------ | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Allow  | Pass without action                            | `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `0BSD`           |
| Review | Pass, warn, open a ticket for legal            | `MPL-2.0`, `LGPL-2.1-only`, `LGPL-3.0-only`, `EPL-2.0`, `CDDL-1.0`           |
| Deny   | Fail the build unless an exception is approved | `AGPL-3.0-only`, `AGPL-3.0-or-later`, `GPL-3.0-only`, `SSPL-1.0`, `BUSL-1.1` |

The lists above are examples to agree with legal. In particular, whether weak copyleft, strong copyleft and network copyleft licences are acceptable depends on how you distribute and run the software, and that is a legal question. Network-copyleft licences are listed in the deny example because they can affect software offered over a network; legal confirms the actual position.

The policy as a file:

```yaml title="license-policy.yaml"
# Example lists. Agree every entry with legal before use.
# Approved by: <name, legal>  Date: <YYYY-MM-DD>
allow:
  - MIT
  - Apache-2.0
  - BSD-2-Clause
  - BSD-3-Clause
  - ISC
  - 0BSD
review:
  - MPL-2.0
  - LGPL-2.1-only
  - LGPL-3.0-only
  - EPL-2.0
  - CDDL-1.0
  - GPL-2.0-only WITH Classpath-exception-2.0
deny:
  - AGPL-3.0-only
  - AGPL-3.0-or-later
  - GPL-3.0-only
  - GPL-3.0-or-later
  - SSPL-1.0
  - BUSL-1.1
```

## SPDX expressions

A component can declare a compound licence expression instead of a single identifier:

- `MIT OR Apache-2.0` means the consumer chooses. Take the most permissive acceptable branch.
- `MIT AND BSD-3-Clause` means both apply. Take the strictest.
- `GPL-2.0-only WITH Classpath-exception-2.0` means a licence with an added exception. Treat the whole phrase as its own entry in the lists; fall back to the base licence if the combination is not listed.
- Parentheses group expressions.

The script below applies exactly these rules: `OR` takes the best branch, `AND` takes the worst, and an unlisted identifier is unknown. Identifiers such as `LicenseRef-...` or free-text names are unknown by design.

## Transitive dependencies

Most licences in an image arrive through transitive dependencies and OS packages, not through your manifest. Evaluating the SBOM of the built image (rather than the manifest) catches them. Expect noise on the first run: many OS packages declare GPL-family licences for tools that are not linked into your code. Triage once, record the decision, and put recurring cases in the exceptions list rather than weakening the lists.

Two limits to state openly: SBOM generators read declared licences and may report none or a wrong one, and a licence file in the package may disagree with the metadata. The gate catches missing data, not wrong data.

## CI gate

The check is a standard-library Python script. It reads a CycloneDX JSON SBOM and the policy file, prints one line per component that is not allowed, and exits non-zero on denied or unknown licences.

```python title="scripts/check_licenses.py"
#!/usr/bin/env python3
"""Fail when a CycloneDX SBOM contains denied or unknown licences."""

import argparse
import json
import re
import sys

RANK = {"allow": 0, "review": 1, "deny": 2, "unknown": 3}
NAMES = {value: key for key, value in RANK.items()}


def load_policy(path):
    """Read the simple 'key:' followed by '  - item' layout of license-policy.yaml."""
    policy = {"allow": set(), "review": set(), "deny": set()}
    current = None
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.split("#", 1)[0].rstrip()
            if not line.strip():
                continue
            if not line.startswith(" ") and line.endswith(":"):
                current = line[:-1].strip()
                if current not in policy:
                    raise SystemExit(f"unknown policy key: {current}")
            elif line.lstrip().startswith("- ") and current:
                policy[current].add(line.lstrip()[2:].strip().strip('"'))
            else:
                raise SystemExit(f"cannot parse policy line: {raw.rstrip()}")
    return policy


def classify(identifier, policy):
    """Return the rank of one licence identifier; deny wins over review over allow."""
    for status in ("deny", "review", "allow"):
        if identifier in policy[status]:
            return RANK[status]
    return RANK["unknown"]


def parse_or(tokens, pos, policy):
    value, pos = parse_and(tokens, pos, policy)
    while pos < len(tokens) and tokens[pos].upper() == "OR":
        right, pos = parse_and(tokens, pos + 1, policy)
        value = min(value, right)
    return value, pos


def parse_and(tokens, pos, policy):
    value, pos = parse_atom(tokens, pos, policy)
    while pos < len(tokens) and tokens[pos].upper() == "AND":
        right, pos = parse_atom(tokens, pos + 1, policy)
        value = max(value, right)
    return value, pos


def parse_atom(tokens, pos, policy):
    if pos >= len(tokens):
        return RANK["unknown"], pos
    token = tokens[pos]
    if token == "(":
        value, pos = parse_or(tokens, pos + 1, policy)
        if pos < len(tokens) and tokens[pos] == ")":
            pos += 1
        return value, pos
    pos += 1
    if pos + 1 < len(tokens) and tokens[pos].upper() == "WITH":
        combined = f"{token} WITH {tokens[pos + 1]}"
        pos += 2
        value = classify(combined, policy)
        if value == RANK["unknown"]:
            value = classify(token, policy)
        return value, pos
    return classify(token, policy), pos


def rank_expression(expression, policy):
    tokens = re.findall(r"\(|\)|[^\s()]+", expression)
    value, _ = parse_or(tokens, 0, policy)
    return value


def component_rank(component, policy):
    """Worst rank over the licence entries of a component; no licence is unknown."""
    entries = component.get("licenses") or []
    if not entries:
        return RANK["unknown"], "no licence declared"
    ranks = []
    labels = []
    for entry in entries:
        if "expression" in entry:
            labels.append(entry["expression"])
            ranks.append(rank_expression(entry["expression"], policy))
        elif "license" in entry:
            lic = entry["license"]
            label = lic.get("id") or lic.get("name") or ""
            labels.append(label or "empty licence entry")
            ranks.append(classify(label, policy) if label else RANK["unknown"])
        else:
            labels.append("unrecognised licence entry")
            ranks.append(RANK["unknown"])
    return max(ranks), ", ".join(labels)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sbom", required=True, help="CycloneDX JSON file")
    parser.add_argument("--policy", required=True, help="license-policy.yaml")
    parser.add_argument("--fail-on-review", action="store_true", help="also fail on review licences")
    args = parser.parse_args()

    policy = load_policy(args.policy)
    with open(args.sbom, encoding="utf-8") as handle:
        sbom = json.load(handle)

    failed = False
    for component in sbom.get("components", []):
        rank, label = component_rank(component, policy)
        if rank == RANK["allow"]:
            continue
        name = f"{component.get('name', '?')}@{component.get('version', '?')}"
        print(f"{NAMES[rank].upper():8} {name} [{label}]")
        if rank >= RANK["deny"] or (rank == RANK["review"] and args.fail_on_review):
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```

Run it locally against a stored SBOM before wiring it into CI:

```bash
set -euo pipefail

python3 scripts/check_licenses.py --sbom sbom.cdx.json --policy license-policy.yaml
```

The script only looks at top-level `components`; nested components and the root component in `metadata` are not checked. Extend it if your generator nests components.

The GitLab job runs after SBOM generation and consumes its artifact:

```yaml title=".gitlab-ci.yml"
license-check:
  stage: sbom
  image: python:3.12-slim # pin by digest in real use
  needs:
    - job: sbom
      artifacts: true
  script:
    - python3 scripts/check_licenses.py --sbom sbom.cdx.json --policy license-policy.yaml
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

Run it on merge requests as well as on the default branch, so the author finds out before review. Treat review-class findings as a ticket to legal rather than a failure, or pass `--fail-on-review` while you are cleaning up the first backlog.

## Exceptions

An exception is a recorded, time-limited decision by legal, not a pipeline override. Store approved exceptions next to the policy (for example an `exceptions` section or file with package, version, licence, reason, approver and expiry) and have the gate skip only exact matches that have not expired. The script above does not implement exceptions on purpose: add them only when you have an owner for the file.

```text
Licence exception request

Package and version:   <name>@<version>
Detected licence:      <SPDX identifier or expression>
Policy class:          <review | deny | unknown>
Where it is used:      <service, image, repository>
How it is used:        <linked library, tool in the build only, shipped binary, network service>
Distribution model:    <internal only | SaaS | shipped to customers>
Alternatives checked:  <replacement package, version change, removal>
Requested by:          <name>
Requested expiry:      <YYYY-MM-DD>
Legal decision:        <approved | rejected | approved with conditions>
Conditions:            <for example attribution notice, source offer, isolation>
Approved by / date:    <legal contact, YYYY-MM-DD>
```

Review open exceptions at expiry. If a package keeps needing one, change the policy with legal rather than renewing indefinitely.

A tool choice can also hinge on licence terms: see [[tools/terraform-vs-opentofu]] for one such comparison. Treat the licence section of a tool decision as input for legal, not as a conclusion.

## Checklist

- [ ] Legal has approved `license-policy.yaml` and the date is recorded in the file.
- [ ] Every release produces a CycloneDX SBOM of the built image.
- [ ] The licence check runs on merge requests and on the default branch.
- [ ] Unknown and missing licences fail the build.
- [ ] Review-class findings create a ticket with an owner.
- [ ] Exceptions have an owner, a reason and an expiry.
- [ ] Dependency update pull requests run the same gate (see [[patterns/automated-dependency-updates]]).
- [ ] The gate is tested with a known denied package once per quarter.

## Related

- [[compliance/sbom-generation-and-storage]]: produces the SBOM that this gate reads.
- [[patterns/automated-dependency-updates]]: new versions can change licences; run the gate on update PRs.
- [[tools/terraform-vs-opentofu]]: an example of a tool decision where licence terms matter.
- [[patterns/image-signing-and-admission-verification]]: sign the images that passed the gate.
