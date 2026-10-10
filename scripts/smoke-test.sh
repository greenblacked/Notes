#!/usr/bin/env bash
# Smoke-test a deployed environment.
#
#   scripts/smoke-test.sh <production|stage> [expected-build-id]
#   scripts/smoke-test.sh <production|stage> --live-build
#
# With a build id (the "build" field of dist/build-info.json), waits until the
# site serves exactly that build, so the checks run against the version that
# was just deployed. --live-build prints the build id currently served.
set -euo pipefail

env_name="${1:?usage: smoke-test.sh <production|stage> [expected-build-id|--live-build]}"
expected_build="${2:-}"

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

served_build() {
  curl "${curl_opts[@]}" --fail "$base_url/build-info.json?ts=$(date +%s)" 2>/dev/null \
    | jq -r '.build // empty' 2>/dev/null || true
}

if [[ "$expected_build" == "--live-build" ]]; then
  served_build
  exit 0
fi

if [[ -n "$expected_build" ]]; then
  log "waiting for $base_url to serve build $expected_build"
  for ((i = 1; i <= attempts; i++)); do
    served="$(served_build)"
    [[ "$served" == "$expected_build" ]] && break
    log "attempt $i/$attempts: serving '${served:-nothing}'"
    if ((i == attempts)); then
      fail "build $expected_build never became live (still serving '${served:-nothing}')"
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
check_status /robots.txt 200
check_status /this-page-does-not-exist/ 404

home="$(curl "${curl_opts[@]}" "$base_url/")"
headers="$(curl "${curl_opts[@]}" -D - -o /dev/null "$base_url/")"
robots="$(curl "${curl_opts[@]}" "$base_url/robots.txt")"

expect "home page has the site title" matches "$home" '<title>[^<]*Notes'
expect "security headers are sent" matches "$headers" '^strict-transport-security:'
expect "a hash-only script CSP is sent" matches "$headers" "^content-security-policy:.*script-src 'self' 'wasm-unsafe-eval' 'sha256-"
expect "robots.txt is a robots file" matches "$robots" '^User-agent:'

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
