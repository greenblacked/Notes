#!/usr/bin/env bash
# Usage: require-content-only.sh <from> <to>
# Fails unless every file changed between the two commits is a plain note or raster image under
# content/: path content/<segments>/<name>.(md|png|jpg|jpeg|gif|webp|avif) with no dot-segments,
# spaces or control characters (Quartz copies .svg, .html and .js into the site as active
# content, so they are refused), regular files only (mode 100644: no symlinks, submodules or
# executables), and only added, modified or deleted (no type changes). Renames are not detected
# (--no-renames), so a move into content/ still shows the path it came from.
# A .md note can still carry raw HTML that Quartz renders; that is accepted, as for any note the
# owner merges, because the owner reviews and merges every text/ pull request.
# Optional LIST_FILE: receives one "A|M|D<TAB>path" line per changed file.
# Exit codes: 0 allowed (an empty diff too), 1 at least one violation, 2 usage or git error.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: require-content-only.sh <from> <to>" >&2
  exit 2
fi
from="$1"
to="$2"
for ref in "$from" "$to"; do
  if ! git rev-parse --verify --quiet "$ref^{commit}" >/dev/null; then
    echo "::error::'$ref' is not a commit."
    exit 2
  fi
done

allowed='^content/([A-Za-z0-9_-][A-Za-z0-9._-]*/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.(md|png|jpe?g|gif|webp|avif)$'
raw="$(mktemp)"
trap 'rm -f "$raw"' EXIT
if ! git -c core.quotepath=off diff --no-renames --no-ext-diff --no-textconv --raw -z --no-abbrev "$from" "$to" >"$raw"; then
  echo "::error::git diff failed for $from..$to."
  exit 2
fi

if [[ -n "${LIST_FILE:-}" ]]; then
  : >"$LIST_FILE"
fi

# Encode a path the way workflow commands require, so it cannot start another command.
escape() {
  local s="$1"
  s="${s//'%'/'%25'}"
  s="${s//$'\r'/'%0D'}"
  s="${s//$'\n'/'%0A'}"
  printf '%s' "$s"
}

count=0
bad=0
while IFS= read -r -d '' meta && IFS= read -r -d '' path; do
  count=$((count + 1))
  read -r old_mode new_mode _ _ status <<<"$meta"
  old_mode="${old_mode#:}"
  shown="$(escape "$path")"
  if [[ ! "$path" =~ $allowed ]]; then
    echo "::error::$shown is not a note or raster image under content/ with a plain name."
    bad=1
    continue
  fi
  if [[ ("$old_mode" != "100644" && "$old_mode" != "000000") || ("$new_mode" != "100644" && "$new_mode" != "000000") ]]; then
    echo "::error::$shown is not a regular non-executable file (modes $old_mode -> $new_mode)."
    bad=1
    continue
  fi
  if [[ "$status" != "A" && "$status" != "M" && "$status" != "D" ]]; then
    echo "::error::$shown has change type $status; only add, modify and delete are allowed."
    bad=1
    continue
  fi
  if [[ -n "${LIST_FILE:-}" ]]; then
    printf '%s\t%s\n' "$status" "$path" >>"$LIST_FILE"
  fi
done <"$raw"

if [[ "$bad" -ne 0 ]]; then
  exit 1
fi
echo "$count changed file(s) between $from and $to, all plain notes or images under content/."
