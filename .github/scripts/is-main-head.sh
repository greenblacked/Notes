#!/usr/bin/env bash
# Writes `current=true|false` to $GITHUB_OUTPUT: whether $SHA is still the head
# of $BRANCH (default main). Used by deploy-dev.yml so a stale run never overwrites a newer
# deployment. Requires GH_TOKEN, GITHUB_REPOSITORY and SHA in the env.
set -euo pipefail

branch="${BRANCH:-main}"
if [[ ! "$branch" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "::error::BRANCH must be a plain branch name, got '$branch'."
  exit 1
fi

head="$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/${branch}" --jq '.object.sha')"
if [[ "$head" == "$SHA" ]]; then
  echo "current=true" >>"$GITHUB_OUTPUT"
  echo "::notice::$SHA is the head of $branch, continuing."
else
  echo "current=false" >>"$GITHUB_OUTPUT"
  echo "::notice::Skipping deploy: $SHA is no longer the head of $branch (now $head); a newer run will deploy it."
fi
