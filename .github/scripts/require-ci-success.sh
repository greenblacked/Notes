#!/usr/bin/env bash
# Fails unless $SHA (a) has a successful ci.yml run for a push to main and (b) is on main
# (the head of main or one of its ancestors). Used by release.yml before it tags and by the
# guard job of deploy-production.yml, so a production deploy never ships a commit that CI did
# not pass on main. Requires GH_TOKEN (actions: read, contents: read), GH_REPO and SHA in the env.
set -euo pipefail

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::SHA must be a full 40-character commit id, got '$SHA'."
  exit 1
fi

count="$(gh api "repos/$GH_REPO/actions/workflows/ci.yml/runs?head_sha=$SHA&event=push&status=completed&per_page=100" \
  --jq '[.workflow_runs[] | select(.conclusion == "success" and .head_branch == "main")] | length')"
if [[ "$count" -lt 1 ]]; then
  echo "::error::No successful ci.yml push run found for $SHA. Wait for CI on main to finish (or fix it) and retry."
  exit 1
fi
echo "Found $count successful CI run(s) for $SHA."

# Resolve main to a commit first, then compare against that SHA: the ref name in a compare
# path is ambiguous (a tag or branch with the same name), a commit id is not.
main_sha="$(gh api "repos/$GH_REPO/git/ref/heads/main" --jq '.object.sha')"
if [[ ! "$main_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::Could not resolve the head of main to a commit id, got '$main_sha'."
  exit 1
fi

# "identical" (the head of main) or "behind" (an ancestor of main); "ahead" and "diverged" are
# commits that are not on main.
status="$(gh api "repos/$GH_REPO/compare/$main_sha...$SHA?per_page=1" --jq '.status')"
if [[ "$status" != "identical" && "$status" != "behind" ]]; then
  echo "::error::$SHA is not on main (compare $main_sha...$SHA: $status)."
  exit 1
fi
echo "$SHA is on main (compare status: $status)."
