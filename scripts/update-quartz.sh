#!/usr/bin/env bash
# Re-imports the Quartz engine at a given upstream tag and updates QUARTZ_VERSION.
# Leaves content/, quartz.config.yaml, worker/, scripts/ and everything else of ours alone.
#
# Usage: scripts/update-quartz.sh v5.0.0
#
# Replaced from upstream: quartz/ globals.d.ts index.d.ts quartz.config.default.yaml
#                         quartz.lock.json tsconfig.json LICENSE-QUARTZ
# Not replaced (local changes): quartz.ts (reads NOTES_BASE_URL), quartz.config.yaml
# Not touched:            package.json / package-lock.json (diff upstream's dependencies by hand,
#                         the script prints the differences), .npmrc, .gitattributes
set -euo pipefail

UPSTREAM="https://github.com/jackyzha0/quartz"
TAG="${1:-}"
if [[ ! "${TAG}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 vX.Y.Z" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

# Every path this script overwrites; refuse to run if any has uncommitted changes.
REPLACED=(quartz globals.d.ts index.d.ts quartz.config.default.yaml quartz.lock.json tsconfig.json
  LICENSE-QUARTZ QUARTZ_VERSION)
if [[ -n "$(git status --porcelain -- "${REPLACED[@]}")" ]]; then
  echo "error: uncommitted changes in paths this script replaces; commit or stash them first:" >&2
  git status --short -- "${REPLACED[@]}" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo "Resolving ${TAG} ..."
COMMIT="$(git ls-remote "${UPSTREAM}" "refs/tags/${TAG}^{}" | awk '{print $1}')"
if [[ -z "${COMMIT}" ]]; then
  COMMIT="$(git ls-remote "${UPSTREAM}" "refs/tags/${TAG}" | awk '{print $1}')"
fi
if [[ ! "${COMMIT}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "error: tag ${TAG} not found upstream" >&2
  exit 1
fi
echo "  commit ${COMMIT}"

echo "Fetching upstream ..."
git clone --quiet --no-checkout --filter=blob:none "${UPSTREAM}" "${WORK}/src"
git -C "${WORK}/src" fetch --quiet origin "${COMMIT}" 2>/dev/null || true
git -C "${WORK}/src" checkout --quiet "${COMMIT}"

echo "Replacing engine files ..."
rm -rf quartz
cp -R "${WORK}/src/quartz" quartz
for f in globals.d.ts index.d.ts quartz.config.default.yaml quartz.lock.json tsconfig.json; do
  cp "${WORK}/src/${f}" "${f}"
done
cp "${WORK}/src/LICENSE.txt" LICENSE-QUARTZ

# Local patches to the engine are none today (see QUARTZ_VERSION); re-apply them here if added.

echo "Comparing upstream dependencies with package.json ..."
node --input-type=module - "${WORK}/src/package.json" <<'NODE'
import { readFileSync } from "node:fs"
const up = JSON.parse(readFileSync(process.argv[2], "utf8"))
const ours = JSON.parse(readFileSync("package.json", "utf8"))
for (const key of ["dependencies", "devDependencies", "engines"]) {
  const a = up[key] ?? {}
  const b = ours[key] ?? {}
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[name] !== b[name]) console.log(`  ${key}.${name}: ours=${b[name] ?? "-"} upstream=${a[name] ?? "-"}`)
  }
}
NODE

cat > QUARTZ_VERSION <<EOF_VERSION
# Vendored Quartz engine. Maintained by scripts/update-quartz.sh
tag: ${TAG}
commit: ${COMMIT}
upstream: ${UPSTREAM}
EOF_VERSION

cat <<'MSG'

Done. Next steps:
  1. Update package.json dependencies for any differences listed above, then `npm install`.
  2. npm run build && npm run check:links
  3. Review `git diff --stat`, then commit.
MSG
