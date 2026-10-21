#!/usr/bin/env bash
# CI check for pull requests from a text/ branch: such a branch ships to production without stage
# (text-release.yml), so it may change only notes under content/. Any other pull request is not
# restricted. Requires EVENT_NAME, HEAD_REF, PR_BASE and PR_HEAD in the env; the checkout needs
# the history of both commits (fetch-depth: 0).
set -euo pipefail

if [[ "${EVENT_NAME:-}" != "pull_request" || "${HEAD_REF:-}" != text/* ]]; then
  echo "Not a text/ pull request; no path restriction."
  exit 0
fi

if [[ ! "$HEAD_REF" =~ ^text/[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "::error::A text/ branch must be text/<lower-case-kebab>."
  exit 1
fi
for sha in "$PR_BASE" "$PR_HEAD"; do
  if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "::error::Expected a full commit id, got '$sha'."
    exit 1
  fi
done

# The pull request's own changes (like a three-dot diff), not whatever main did meanwhile.
mb="$(git merge-base "$PR_BASE" "$PR_HEAD")"
list="$(mktemp)"
trap 'rm -f "$list"' EXIT
if ! LIST_FILE="$list" "$(dirname "${BASH_SOURCE[0]}")/require-content-only.sh" "$mb" "$PR_HEAD"; then
  echo "::error::A text/ branch may change only notes under content/ (.md and raster images); use a <type>/<kebab> branch, which goes through stage and Cut release."
  exit 1
fi
if [[ ! -s "$list" ]]; then
  echo "::error::This text/ pull request changes nothing."
  exit 1
fi
echo "text/ pull request changes only notes."
