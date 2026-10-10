#!/usr/bin/env bash
# Post-deploy smoke test.
#
# Usage: scripts/smoke-test.sh <base_url> <expected_version> <stage|production>
#
#   base_url          e.g. https://notes.szolotov.com (no trailing slash needed)
#   expected_version  exact content of /version.txt (without the newline),
#                     e.g. "1.2.3+<40-char sha>" or "main+<40-char sha>"
#   stage|production  selects the indexing expectations (noindex vs. indexable)
#
# The version check is retried with a growing delay (custom domains and edge
# propagation can lag a few minutes behind `wrangler deploy`). All other checks
# run once the expected version is being served. Exits non-zero on any failure.
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <base_url> <expected_version> <stage|production>" >&2
  exit 2
fi

BASE_URL="${1%/}"
EXPECTED="$2"
MODE="$3"

case "$MODE" in
  stage | production) ;;
  *)
    echo "error: mode must be 'stage' or 'production', got '$MODE'" >&2
    exit 2
    ;;
esac

MAX_ATTEMPTS="${SMOKE_MAX_ATTEMPTS:-10}"
MAX_DELAY="${SMOKE_MAX_DELAY:-20}"

CURL_OPTS=(--silent --show-error --location --max-redirs 3 --connect-timeout 10 --max-time 30)
if [[ "$BASE_URL" == https://* ]]; then
  CURL_OPTS+=(--proto '=https' --proto-redir '=https')
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILURES=0
pass() { echo "  PASS  $*"; }
fail() {
  echo "  FAIL  $*"
  FAILURES=$((FAILURES + 1))
}

# fetch <path> <name>: stores headers in $WORK/<name>.h, body in $WORK/<name>.b
# and prints the HTTP status code (000 when the request itself failed).
fetch() {
  local path="$1" name="$2" code
  code="$(curl "${CURL_OPTS[@]}" --dump-header "$WORK/$name.h" --output "$WORK/$name.b" \
    --write-out '%{http_code}' "$BASE_URL$path" 2>"$WORK/$name.err")" || code="000"
  echo "$code"
}

# header_value <name> <header>: last value of a response header, case-insensitive.
# Redirect hops are included in the dump, so the final response wins.
header_value() {
  local line
  line="$(grep -i "^$2:" "$WORK/$1.h" | tail -n 1 || true)"
  line="${line#*:}"
  line="${line%$'\r'}"
  echo "${line#"${line%%[![:space:]]*}"}"
}

echo "Smoke test: $BASE_URL ($MODE), expecting version '$EXPECTED'"

# 1. Wait until the expected version is live.
echo "Waiting for /version.txt to match (max $MAX_ATTEMPTS attempts)"
live=""
attempt=1
while true; do
  cb="$RANDOM$RANDOM"
  code="$(fetch "/version.txt?cb=$cb" version)"
  body="$(tr -d '\r\n' <"$WORK/version.b" 2>/dev/null || true)"
  if [[ "$code" == "200" && "$body" == "$EXPECTED" ]]; then
    live="yes"
    echo "  attempt $attempt: HTTP $code, version '$body' matches"
    break
  fi
  echo "  attempt $attempt: HTTP $code, version '${body:0:100}' (not yet '$EXPECTED')"
  if ((attempt >= MAX_ATTEMPTS)); then
    break
  fi
  delay=$((attempt * 5))
  if ((delay > MAX_DELAY)); then delay="$MAX_DELAY"; fi
  sleep "$delay"
  attempt=$((attempt + 1))
done

echo "Checks"
if [[ -n "$live" ]]; then
  pass "/version.txt serves '$EXPECTED'"
else
  fail "/version.txt did not serve '$EXPECTED' after $MAX_ATTEMPTS attempts (last HTTP $code, body '${body:0:100}')"
fi

cc="$(header_value version cache-control)"
if [[ "$cc" == *no-store* ]]; then
  pass "/version.txt Cache-Control contains no-store ($cc)"
else
  fail "/version.txt Cache-Control should contain no-store, got '$cc'"
fi

# 2. Home page and security headers.
code="$(fetch "/?cb=$RANDOM$RANDOM" home)"
if [[ "$code" == "200" ]]; then
  pass "GET / returned 200"
else
  fail "GET / returned HTTP $code"
fi

for h in strict-transport-security content-security-policy x-content-type-options referrer-policy permissions-policy; do
  v="$(header_value home "$h")"
  if [[ -n "$v" ]]; then
    pass "header $h present"
  else
    fail "header $h missing on /"
  fi
done

v="$(header_value home x-content-type-options)"
if [[ "${v,,}" == "nosniff" ]]; then
  pass "X-Content-Type-Options is nosniff"
else
  fail "X-Content-Type-Options should be nosniff, got '$v'"
fi

# 3. Indexing policy.
robots_header="$(header_value home x-robots-tag)"
code="$(fetch "/robots.txt?cb=$RANDOM$RANDOM" robots)"
if [[ "$code" != "200" ]]; then
  fail "GET /robots.txt returned HTTP $code"
fi
robots_body="$(tr -d '\r' <"$WORK/robots.b" 2>/dev/null || true)"

if [[ "$MODE" == "stage" ]]; then
  if [[ "${robots_header,,}" == *noindex* ]]; then
    pass "X-Robots-Tag contains noindex ($robots_header)"
  else
    fail "stage must send X-Robots-Tag: noindex, got '$robots_header'"
  fi
  if grep -qiE '^[[:space:]]*Disallow:[[:space:]]*/[[:space:]]*$' <<<"$robots_body"; then
    pass "robots.txt disallows everything"
  else
    fail "stage robots.txt must contain 'Disallow: /'"
  fi
else
  if [[ "${robots_header,,}" == *noindex* ]]; then
    fail "production must not send X-Robots-Tag noindex, got '$robots_header'"
  else
    pass "no X-Robots-Tag noindex"
  fi
  if grep -qiE '^[[:space:]]*Disallow:[[:space:]]*/[[:space:]]*$' <<<"$robots_body"; then
    fail "production robots.txt must not contain 'Disallow: /'"
  else
    pass "robots.txt does not block the site"
  fi
fi

echo
if ((FAILURES > 0)); then
  echo "Smoke test FAILED ($FAILURES check(s) failed)"
  exit 1
fi
echo "Smoke test passed"
