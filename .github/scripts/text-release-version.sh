#!/usr/bin/env bash
# Finds the latest vX.Y.Z tag, the commit it points at, and the next PATCH version, and prints
#   latest=<tag> latest_sha=<commit> tag=<next tag> version=<next version>
# one per line. Exit 3 when there is no vX.Y.Z tag yet (run Cut release first). With
# EXPECT_LATEST set, exit 1 when the latest tag is not that tag (a release was created
# meanwhile). Requires GH_TOKEN (contents: read) and GH_REPO in the env.
set -euo pipefail

# gh runs on its own so an API failure is an error (exit 1), not "no tag yet" (exit 3).
refs="$(gh api --paginate "repos/$GH_REPO/git/matching-refs/tags/v" --jq '.[].ref')" || {
  echo "::error::Could not list the release tags." >&2
  exit 1
}
latest="$(printf '%s\n' "$refs" \
  | sed 's#^refs/tags/##' \
  | grep -E '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' \
  | sort -V | tail -n 1 || true)"
if [[ -z "$latest" ]]; then
  echo "::notice::No vX.Y.Z tag exists yet." >&2
  exit 3
fi
if [[ -n "${EXPECT_LATEST:-}" && "$EXPECT_LATEST" != "$latest" ]]; then
  echo "::error::The latest release tag is $latest, expected $EXPECT_LATEST: a release was created meanwhile." >&2
  exit 1
fi

# Resolve the tag (annotated or lightweight) to its commit.
read -r obj_type obj_sha <<<"$(gh api "repos/$GH_REPO/git/ref/tags/$latest" --jq '.object | "\(.type) \(.sha)"')"
if [[ "$obj_type" == "tag" ]]; then
  obj_sha="$(gh api "repos/$GH_REPO/git/tags/$obj_sha" --jq '.object.sha')"
fi
if [[ ! "$obj_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::Could not resolve $latest to a commit id, got '$obj_sha'." >&2
  exit 1
fi

[[ "$latest" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]
next="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$((BASH_REMATCH[3] + 1))"
echo "latest=$latest"
echo "latest_sha=$obj_sha"
echo "tag=v$next"
echo "version=$next"
