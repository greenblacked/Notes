#!/usr/bin/env bash
# Usage: text-release-notes.sh <latest tag> <new tag> <pull request number> <head ref> <list file>
# Prints the GitHub Release notes of a text release. The list file is the LIST_FILE of
# require-content-only.sh (one "A|M|D<TAB>path" line per changed file); its paths are safe to
# quote because that script only allows a restricted character set.
set -euo pipefail

if [[ $# -ne 5 ]]; then
  echo "usage: text-release-notes.sh <latest> <tag> <pr> <head_ref> <list_file>" >&2
  exit 1
fi
latest="$1"
tag="$2"
pr="$3"
head_ref="$4"
list="$5"

semver='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
if [[ ! "$latest" =~ $semver || ! "$tag" =~ $semver ]]; then
  echo "::error::Tags must be vX.Y.Z." >&2
  exit 1
fi
if [[ ! "$pr" =~ ^[0-9]+$ ]]; then
  echo "::error::The pull request number must be digits." >&2
  exit 1
fi
if [[ ! "$head_ref" =~ ^text/[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "::error::The head ref must be text/<lower-case-kebab>." >&2
  exit 1
fi
if [[ ! -f "$list" ]]; then
  echo "::error::List file '$list' not found." >&2
  exit 1
fi

lines=""
while IFS=$'\t' read -r status path; do
  case "$status" in
    A) verb="added" ;;
    M) verb="changed" ;;
    D) verb="removed" ;;
    *)
      echo "::error::Unexpected change type '$status' in the list." >&2
      exit 1
      ;;
  esac
  if [[ ! "$path" =~ ^content/[A-Za-z0-9._/-]+$ ]]; then
    echo "::error::Unexpected path in the list." >&2
    exit 1
  fi
  lines+="- $verb \`$path\`"$'\n'
done <"$list"

tick='`'
printf 'Content-only release from pull request #%s (%s%s%s), on top of %s. No code or configuration changed since %s; stage was not used.\n\nNotes changed:\n%s' \
  "$pr" "$tick" "$head_ref" "$tick" "$latest" "$latest" "$lines"
