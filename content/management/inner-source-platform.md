---
title: Inner-source contribution model for platform code
description: "How product teams change platform-owned Helm charts, Terraform modules and pipeline templates by merge request while the platform team keeps ownership."
type: guide
tags:
  - management
  - team-process
  - delivery
  - leadership
created: 2026-10-17
modified: 2026-10-17
draft: false
---

A platform team that owns Helm charts, Terraform modules and pipeline templates, and accepts every change only through its own backlog, becomes the bottleneck for everyone who depends on it. Product teams know what they need, and often could write the change in an afternoon. **Inner source** is the mechanism that lets them: the code is open to merge requests from any team in the company, and the platform team keeps ownership, review and release. This note describes the model, the files that implement it, and how to tell whether it works. It adds the mechanism that [[platform-team-operating-model]] leaves open.

> [!info] What is not verified
> GitLab features named here (CODEOWNERS sections, required approvals from code owners, protected branches) vary by tier and version, and which tier you need for section approvals is **not verified**. Check your GitLab edition and documentation before you build on it. The pattern names of the InnerSource Commons community are not used as such; "sponsor" in this note is a local term for the platform engineer who guides a contribution. The API calls shown are written from memory of the GitLab REST API and were not run for this note.

## Why inner source

Three problems appear in a platform team that only accepts requests:

- **Queue time.** A one-line chart value or a new Terraform module variable waits weeks behind larger work. The product team works around it with a fork, a copy of the module or a private pipeline script.
- **Missing context.** The platform team guesses what the product team needs. A contributor who has the problem writes a better first version.
- **Capacity.** The platform team grows by hiring, which is slow. Contributions grow with the number of teams that use the platform.

Inner source does not mean "anyone can change anything". The platform team still decides what is accepted, keeps the standards and carries the support burden for what it merges. It is a trade: the product team brings the change, the platform team brings review, tests and the release.

It fits when the platform has many consumers, a clear public interface (module inputs, chart values, template parameters) and tests that give reviewers confidence. It fits poorly for the security-critical core (for example the organisation policy, the network foundation or the signing keys), where a smaller group should keep sole write access. Name these areas explicitly.

## Ownership with CODEOWNERS

Ownership stays with the platform team. The mechanism is a `CODEOWNERS` file combined with a protected default branch and merge request approval rules, so that a change under platform-owned paths cannot merge without a platform approval.

```text title="CODEOWNERS"
# Default section: applies to every path, in addition to any named section below (not verified for your tier).
* @example-org/platform

[Terraform modules][1]
# A module change needs one approval from a platform maintainer.
/modules/ @example-org/platform-maintainers

[Helm charts][1]
/charts/ @example-org/platform-maintainers

[Pipeline templates][1]
/ci-templates/ @example-org/platform-maintainers

[Security-critical, platform only][2]
# Needs approval from platform-security. Not part of inner source.
/modules/org-policy/ @example-org/platform-security
/modules/network-foundation/ @example-org/platform-security
```

How to read it:

- `[Section][N]` is a GitLab-style section requiring `N` approvals from that section's code owners. The numbers shown are examples. Set them from your own review policy.
- The first block is a safety net. A path with no explicit owner falls to the platform team, never to nobody. Sections are additive, so a path that matches the default and a named section needs approval from both.
- The security-critical paths need approval from a smaller group. This keeps inner source out of the places where a mistake is hard to reverse. CODEOWNERS only requires approvals and does not stop anyone from opening a merge request; to prevent contributor changes entirely, keep these modules in a separate repository with restricted Developer access.
- A contributor from a product team opens the merge request and gets feedback. They do **not** become a code owner by contributing. Add a contributor to a section only through a deliberate decision, for example after repeated good changes to one module.

Repository settings that make the file binding:

- Protect the default branch: no direct pushes, merge requests only.
- Turn on "approval from code owners" for the protected branch. In GitLab this depends on the tier, see the callout above.
- Require the pipeline to pass before merge.
- Do not allow the author to approve their own merge request.

The same shape works on GitHub with a `CODEOWNERS` file, branch protection and "require review from code owners". The section syntax is GitLab-specific. See [[team-reorg-runbook]] for a note on CODEOWNERS syntax that is not verified.

## Contribution guide

A contributor should not have to ask the platform team how to contribute. Put `CONTRIBUTING.md` at the repository root, link it from the README and from the merge request template, and keep it short.

```markdown title="CONTRIBUTING.md"
# Contributing to platform code

Anyone in the company can propose a change to the modules, charts and pipeline
templates in this repository. The platform team reviews and releases it.

## Before you start

- [ ] Check the open issues and merge requests for the same change.
- [ ] For anything beyond a small fix, open an issue first and describe the
      problem, not the solution. A platform engineer (your sponsor) will reply
      within the review service level below.
- [ ] Check that the change is not in a platform-only area (see CODEOWNERS).
      Those paths need approval from platform-security.

## Making the change

- [ ] Branch from the default branch. Keep the merge request small and about
      one thing.
- [ ] Keep backwards compatibility. Add a new input with a default that keeps
      the current behaviour. Removing or renaming an input is a breaking change
      and needs a major version bump and a migration note.
- [ ] Follow the conventions of the component: Terraform module layout,
      Helm chart conventions, pipeline template parameters.
- [ ] Add or update tests (see "What a change needs").
- [ ] Update the README or the values documentation of the component.
- [ ] Add a changelog entry and the version bump the component requires.

## Opening the merge request

- [ ] Fill in the merge request template, including which team needs the
      change and by when.
- [ ] Make sure the pipeline is green.
- [ ] Do not merge your own change. A platform approval is required.

## After merge

- [ ] The platform team tags the release. Pin the new version in your own
      repository and test it in a non-production environment first.
```

Keep the guide honest: if a step is not enforced by the pipeline or the review, say so, and add the check to the pipeline when you can.

## What a change needs

The platform team accepts contributions faster when the repository tells reviewers what "done" is. Every change to platform code needs:

| Item          | What it means                                                                                                                                                                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tests         | A Terraform module change has a `terraform test` or native test case, see [[terraform-testing]]. A chart change passes `helm lint`, template rendering and the gates in [[helm-chart-ci-quality-gates]]. A shared library change has unit tests, see [[jenkins-shared-libraries]]. |
| Documentation | Inputs, values or parameters are documented where consumers read them. A new variable without a description is not complete.                                                                                                                                                       |
| Changelog     | One entry that says what changed for consumers, and flags anything that needs action.                                                                                                                                                                                              |
| Version bump  | The component's version moves according to the rules in [[release-versioning-and-changelog-automation]]. Breaking changes bump the major version.                                                                                                                                  |
| Compatibility | Existing consumers keep working without change, or the merge request includes a migration path and a deprecation note.                                                                                                                                                             |
| Plan or diff  | For modules and charts, the pipeline shows the rendered or planned change on a sample consumer, so the reviewer sees the effect, not only the diff.                                                                                                                                |

If the pipeline can check an item, let it check. Reviewer time goes to design and risk, not to reminding people about changelogs. Component conventions are in [[terraform-module-and-state-layout]] and [[helm-chart-conventions]].

### Merge request template

The template asks the question that matters for prioritisation: who needs the change and when. Place it at `.gitlab/merge_request_templates/Default.md` (the folder and file name follow GitLab convention, not verified for your version).

```markdown title=".gitlab/merge_request_templates/Default.md"
## What and why

<!-- What does this change, and what problem does it solve for consumers? -->

## Which team needs this change, and by when?

- Team:
- Contact:
- Needed by (date, or "no deadline"):
- What happens if it is not merged by then:

## Type of change

- [ ] Bug fix, no behaviour change for existing consumers
- [ ] New optional input, value or parameter (default keeps current behaviour)
- [ ] Breaking change (major version bump and migration note included)
- [ ] Documentation or tests only

## Checklist

- [ ] Tests added or updated
- [ ] Documentation updated
- [ ] Changelog entry added
- [ ] Version bumped as required by the component
- [ ] Pipeline is green
- [ ] I tested this against a real consumer (link or plan output):

## Platform notes (filled in by the sponsor)

- Sponsor:
- Review started on:
```

## Review service levels

Contributors stop contributing when a merge request sits for weeks. Publish the service levels and track them. The numbers below are suggested defaults to set from your own capacity.

| Event                                 | Suggested target                                                     |
| ------------------------------------- | -------------------------------------------------------------------- |
| First response from the platform team | One working day                                                      |
| Sponsor assigned                      | At the first response                                                |
| First full review                     | Three working days for a small change                                |
| Follow-up review after changes        | One working day                                                      |
| Release after approval                | A fixed cadence, for example weekly, or on request for an urgent fix |
| Contribution declined, with reasons   | Same day as the decision                                             |

Mechanisms that make the targets achievable:

- **A sponsor per contribution.** One platform engineer owns the review end to end, answers questions and shepherds the change through. Sponsor is a local term here, not an established pattern name. Rotate the duty weekly, as the shield rotation in [[platform-team-operating-model]].
- **Review is work.** Count it in the platform team's capacity. If it is treated as a favour, it will lose to the roadmap.
- **Say no early and kindly.** A contribution that does not fit the platform direction is better declined on the issue than after a week of work. Say what would make it acceptable.
- **Follow the review standard.** Use the same expectations as [[code-review]]: small changes, clear feedback, review of risk.

## Avoiding forks and bottlenecks

Inner source can fail in two opposite ways. Teams fork because the platform is slow, or the platform team becomes a gate that nobody passes.

**Prevent forks:**

- Make the contribution path faster than a private copy. Track the time from opened to merged for outside contributions.
- Ask why a team copied a module before you ask them to remove the copy. The answer is usually a missing input or a slow review.
- Scan for copies. A search for your module sources or chart names across the organisation's repositories shows who is pinned to a copy.
- Offer a supported extension point (a hook value, an `extra_*` input, a template include) so a team can adapt a component without a change in the source.

**Prevent bottlenecks:**

- Grow the group of maintainers. Give strong contributors review rights on the part they know, through CODEOWNERS sections, after a deliberate decision.
- Keep the maintainers group in the sections larger than one person, and not only the people who hold the pager.
- Keep the interface small and the tests good. A well-tested module is reviewable by many.
- Split the repository by component when one repository's release cadence slows everything.
- Keep a visible queue of open contributions with age. Review the queue in the platform team's weekly meeting.

Watch for these signs of trouble:

- The platform team rewrites most contributions after review. The guide, the tests or the interface need work.
- One person reviews everything. That is a bus-factor problem and a bottleneck.
- Contributions only come from two or three teams. The others do not know, do not trust the process or have no time.
- Contributors do not return after the first change. Ask them why.

## Measuring contributions

Measure to learn whether the mechanism works, not to rank teams. A count of merge requests is a signal, not a goal.

Useful measures:

- Merge requests merged per quarter from authors outside the platform team, and the number of distinct teams behind them.
- Time from opening to first response, and to merge, for outside contributions.
- Share of outside merge requests that needed more than two review rounds.
- Number of forks or private copies found, and how that changes.
- Contributor return rate: teams that contributed more than once.

A GitLab API query idea for merged merge requests from non-platform authors per quarter. It lists merged requests for a group within a window, then removes authors who are platform team members. The endpoints and parameters (`merged_after`, `merged_before`, pagination headers) are written from memory and are **not verified**. Check the REST API documentation for your GitLab version.

```bash title="outside-contributions.sh"
#!/usr/bin/env bash
# Count merged MRs per author in a quarter, excluding platform team members.
# Needs: curl, jq. Read-only token with the read_api scope, kept in the environment.
set -Eeuo pipefail

GITLAB_URL="https://gitlab.example.com"   # change to your GitLab host
GROUP_ID="1234"                            # change to the numeric ID of the group that holds the platform repositories
PLATFORM_GROUP_ID="5678"                   # change to the ID of the platform team's group
FROM="2026-07-01T00:00:00Z"                # start of the quarter
TO="2026-10-01T00:00:00Z"                  # end of the quarter
: "${GITLAB_TOKEN:?set GITLAB_TOKEN to a read_api token}"

api() { curl -fsS --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" "$@"; }

# Usernames of the platform team (first 100 members is enough for a small team;
# paginate if your group is larger).
platform_users="$(api "${GITLAB_URL}/api/v4/groups/${PLATFORM_GROUP_ID}/members/all?per_page=100" \
  | jq -r '[.[].username]')"

trap 'rm -f "${resp:-}" "${hdr:-}"' EXIT

page=1
all='[]'
while [ -n "${page}" ]; do
  # -D - prints headers so we can follow the next page.
  resp="$(mktemp)"; hdr="$(mktemp)"
  api -D "${hdr}" -o "${resp}" \
    "${GITLAB_URL}/api/v4/groups/${GROUP_ID}/merge_requests?state=merged&scope=all&merged_after=${FROM}&merged_before=${TO}&per_page=100&page=${page}"
  all="$(jq -s '.[0] + .[1]' <(printf '%s' "${all}") "${resp}")"
  page="$(awk -F': ' 'tolower($1)=="x-next-page"{gsub(/\r/,"",$2); print $2}' "${hdr}")"
  rm -f "${resp}" "${hdr}"
done

printf '%s' "${all}" | jq --argjson platform "${platform_users}" '
  map(select(.author.username as $u | ($platform | index($u)) | not))
  | group_by(.author.username)
  | map({author: .[0].author.username, merged: length})
  | sort_by(-.merged)'
```

Illustrative shape of the output (not real data):

```json
[
  { "author": "dev-one", "merged": 4 },
  { "author": "dev-two", "merged": 2 }
]
```

Limits of the query: it counts by author, so a platform engineer who finishes a change for a product team is counted as platform. It also treats a typo fix and a new module equally. Use it as a trend, and read a sample of the merge requests every quarter.

Review the numbers with the platform team each quarter and share them with the teams that contribute. Thank contributors by name where they agree. Feed what you learn into the roadmap, as described in [[platform-team-operating-model]].

## Related

- [[platform-team-operating-model]] for the platform-as-a-product model this note extends.
- [[terraform-module-and-state-layout]] for module layout and versioning rules a contributor follows.
- [[helm-chart-conventions]] for chart conventions and values.
- [[jenkins-shared-libraries]] for shared pipeline code and its tests.
- [[code-review]] for the review expectations behind the service levels.
- [[release-versioning-and-changelog-automation]] for version bumps and changelogs.
- [[team-reorg-runbook]] for notes on CODEOWNERS when team ownership changes.
