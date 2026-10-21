#!/usr/bin/env bash
# The gate of the release job in text-release.yml: decides whether $SHA is released as the next
# PATCH version, and writes the release notes. Writes release=true|false (and, when true, latest,
# tag and version) to $GITHUB_OUTPUT; the notes go to $RUNNER_TEMP/notes.md, the path that Cut
# release uses too. It releases only when everything from the latest vX.Y.Z tag to $SHA is notes
# under content/ (require-content-only.sh), so a text release never ships code or configuration
# that skipped stage and Cut release. Anything else releases nothing and says why.
# Run in a checkout with full history and tags. Requires GH_TOKEN (contents: read), GH_REPO, SHA,
# PR, HEAD_REF, RUNNER_TEMP and GITHUB_OUTPUT in the env; GITHUB_STEP_SUMMARY is used when set.
set -euo pipefail

here="$(dirname "${BASH_SOURCE[0]}")"

skip() {
  echo "release=false" >>"$GITHUB_OUTPUT"
  exit 0
}

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::SHA must be a full 40-character commit id, got '$SHA'."
  exit 1
fi

rc=0
info="$("$here/text-release-version.sh")" || rc=$?
if [[ "$rc" -eq 3 ]]; then
  echo "::notice::No vX.Y.Z tag exists yet: run Cut release first. Nothing was released."
  skip
elif [[ "$rc" -ne 0 ]]; then
  exit 1
fi
latest="" latest_sha="" tag="" version=""
while IFS='=' read -r key value; do
  case "$key" in
    latest) latest="$value" ;;
    latest_sha) latest_sha="$value" ;;
    tag) tag="$value" ;;
    version) version="$value" ;;
  esac
done <<<"$info"

if ! git cat-file -e "$latest_sha^{commit}" 2>/dev/null; then
  echo "::error::The commit of $latest ($latest_sha) is not in this checkout."
  exit 1
fi

# A slower, older run must never tag an older commit after a newer one was released.
if [[ "$latest_sha" == "$SHA" ]] || git merge-base --is-ancestor "$SHA" "$latest_sha"; then
  echo "::notice::$SHA is already in $latest; nothing to release."
  skip
fi
if ! git merge-base --is-ancestor "$latest_sha" "$SHA"; then
  echo "::error::$latest ($latest_sha) is not an ancestor of $SHA; refusing to release."
  exit 1
fi

list="$RUNNER_TEMP/changed.tsv"
rc=0
LIST_FILE="$list" "$here/require-content-only.sh" "$latest_sha" "$SHA" || rc=$?
if [[ "$rc" -eq 1 ]]; then
  msg="main has unreleased changes outside content/ since $latest (they have not been through stage and Cut release). Nothing was released: run Cut release, which ships them together with this text."
  echo "::warning::$msg"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    echo "$msg" >>"$GITHUB_STEP_SUMMARY"
  fi
  skip
elif [[ "$rc" -ne 0 ]]; then
  exit 1
fi
if [[ ! -s "$list" ]]; then
  echo "::notice::No file changed since $latest; nothing to release."
  skip
fi

"$here/text-release-notes.sh" "$latest" "$tag" "$PR" "$HEAD_REF" "$list" >"$RUNNER_TEMP/notes.md"
cat "$RUNNER_TEMP/notes.md"
{
  echo "release=true"
  echo "latest=$latest"
  echo "tag=$tag"
  echo "version=$version"
} >>"$GITHUB_OUTPUT"
