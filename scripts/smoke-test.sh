#!/usr/bin/env bash
# Smoke-test a deployed environment.
#
#   scripts/smoke-test.sh <production|stage> [expected-commit-sha]
#
# With a commit SHA, waits until /build-info.json reports that commit, so the
# checks run against the version that was just deployed, not the previous one.
set -euo pipefail

env_name="${1:?usage: smoke-test.sh <production|stage> [expected-commit-sha]}"
expected_commit="${2:-}"

case "$env_name" in
  production) default_url="https://notes.szolotov.com" ;;
  stage)      default_url="https://stage.notes.szolotov.com" ;;
  *) echo "unknown environment: $env_name" >&2; exit 2 ;;
esac

# SMOKE_BASE_URL points the checks at another host, e.g. a local preview.
base_url="${SMOKE_BASE_URL:-$default_url}"
attempts="${SMOKE_ATTEMPTS:-30}"
delay="${SMOKE_DELAY_SECONDS:-10}"
failures=0

log()  { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() { log "FAIL: $*"; failures=$((failures + 1)); }

curl_opts=(--silent --show-error --max-time 15 --retry 2 --retry-all-errors)
[[ -n "${SMOKE_BASE_URL:-}" ]] || curl_opts+=(--proto '=https')

if [[ -n "$expected_commit" ]]; then
  log "waiting for $base_url to serve commit $expected_commit"
  for ((i = 1; i <= attempts; i++)); do
    served="$(curl "${curl_opts[@]}" "$base_url/build-info.json?ts=$(date +%s)" 2>/dev/null | jq -r '.commit // empty' 2>/dev/null || true)"
    [[ "$served" == "$expected_commit" ]] && break
    log "attempt $i/$attempts: serving '${served:-nothing}'"
    if ((i == attempts)); then
      fail "new version never became live (still serving '${served:-nothing}')"
      exit 1
    fi
    sleep "$delay"
  done
fi

# expect <description> <command...>: log ok, or count a failure.
expect() {
  local what="$1"; shift
  if "$@"; then log "ok: $what"; else fail "$what"; fi
}
matches() { grep -qiE "$2" <<<"$1"; }
lacks()   { ! grep -qiE "$2" <<<"$1"; }

check_status() {
  local path="$1" want="$2" got
  got="$(curl "${curl_opts[@]}" -o /dev/null -w '%{http_code}' "$base_url$path")"
  expect "$path returns $want (got $got)" test "$got" = "$want"
}

check_status / 200
check_status /tags/ 200
check_status /adr/0001-gitops-with-argocd/ 200
check_status /pagefind/pagefind.js 200
check_status /this-page-does-not-exist/ 404

home="$(curl "${curl_opts[@]}" "$base_url/")"
headers="$(curl "${curl_opts[@]}" -D - -o /dev/null "$base_url/")"
robots="$(curl "${curl_opts[@]}" "$base_url/robots.txt")"

expect "home page has the site title" matches "$home" '<title>[^<]*Notes'
expect "security headers are sent" matches "$headers" '^strict-transport-security:'

if [[ "$env_name" == "stage" ]]; then
  expect "stage sends X-Robots-Tag noindex" matches "$headers" '^x-robots-tag:.*noindex'
  expect "stage has a noindex meta tag" matches "$home" 'name="robots"[^>]*noindex'
  expect "stage robots.txt disallows all" matches "$robots" '^Disallow: /$'
else
  expect "production sends no X-Robots-Tag" lacks "$headers" '^x-robots-tag:'
  expect "production has no noindex meta tag" lacks "$home" 'name="robots"[^>]*noindex'
  expect "production robots.txt allows crawling" lacks "$robots" '^Disallow: /$'
fi

if ((failures > 0)); then
  log "$failures check(s) failed for $base_url"
  exit 1
fi
log "all checks passed for $base_url"
