#!/usr/bin/env bash
# Writes `current=true|false` to $GITHUB_OUTPUT: whether $SHA is still the head
# of the main branch. Used by deploy-stage.yml so a stale run never overwrites
# a newer deployment. Requires GH_TOKEN, GITHUB_REPOSITORY and SHA in the env.
set -euo pipefail

head="$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/main" --jq '.object.sha')"
if [[ "$head" == "$SHA" ]]; then
  echo "current=true" >>"$GITHUB_OUTPUT"
  echo "::notice::$SHA is the head of main, continuing."
else
  echo "current=false" >>"$GITHUB_OUTPUT"
  echo "::notice::Skipping deploy: $SHA is no longer the head of main (now $head); a newer run will deploy it."
fi
