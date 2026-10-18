#!/usr/bin/env bash
# Post-deploy smoke test.
#
# Usage: scripts/smoke-test.sh <base_url> <expected_version> <indexable|noindex>
#
#   base_url          e.g. https://notes.szolotov.com (no trailing slash needed)
#   expected_version  exact content of /version.txt (without the newline),
#                     e.g. "1.2.3+<sha>", "main+<sha>" or "dev+<sha>"
#   indexable|noindex what this host is expected to send: "indexable" (no noindex,
#                     robots.txt allows crawling; only notes.szolotov.com in production) or
#                     "noindex" (X-Robots-Tag noindex, robots.txt "Disallow: /"; the dev
#                     Preview and every workers.dev URL)
#
# The version check is retried with a growing delay (custom domains and edge
# propagation can lag a few minutes behind `wrangler deploy`). All other checks
# run once the expected version is being served. Exits non-zero on any failure.
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <base_url> <expected_version> <indexable|noindex>" >&2
  exit 2
fi

BASE_URL="${1%/}"
EXPECTED="$2"
MODE="$3"

case "$MODE" in
  indexable | noindex) ;;
  *)
    echo "error: expectation must be 'indexable' or 'noindex', got '$MODE'" >&2
    exit 2
    ;;
esac

MAX_ATTEMPTS="${SMOKE_MAX_ATTEMPTS:-10}"
MAX_DELAY="${SMOKE_MAX_DELAY:-20}"
CHECK_ROUNDS="${SMOKE_CHECK_ROUNDS:-6}"
CHECK_DELAY="${SMOKE_CHECK_DELAY:-10}"
# SMOKE_ALLOW_ACCESS=1: a host behind Cloudflare Access (redirect to its login) passes with a
# notice instead of failing. Only for the dev Preview, which the account protects with Access.
ALLOW_ACCESS="${SMOKE_ALLOW_ACCESS:-}"
# Identifiable User-Agent, so a Cloudflare WAF rule can recognise these requests
# (see docs/deployment.md, Troubleshooting).
USER_AGENT="${SMOKE_USER_AGENT:-notes-smoke-test/1 (+https://github.com/greenblacked/Notes)}"
# Optional shared secret sent as X-Notes-Smoke-Test, for a WAF skip rule that a
# spoofed User-Agent cannot satisfy. Unset means the header is not sent.
SMOKE_TEST_TOKEN="${SMOKE_TEST_TOKEN:-}"

# Redirects are never followed: a 3xx from the deployed host is a failure (see is_redirect), so a
# misrouted or hijacked host cannot hand the checks to another origin.
CURL_OPTS=(--silent --show-error --connect-timeout 10 --max-time 30 --user-agent "$USER_AGENT")
if [[ "$BASE_URL" == https://* ]]; then
  CURL_OPTS+=(--proto '=https')
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [[ -n "$SMOKE_TEST_TOKEN" ]]; then
  # Passed through a file so the token never appears in the process list.
  printf 'X-Notes-Smoke-Test: %s\n' "$SMOKE_TEST_TOKEN" >"$WORK/request-headers"
  CURL_OPTS+=(--header "@$WORK/request-headers")
fi

FAILURES=0
pass() { echo "  PASS  $*"; }
fail() {
  echo "  FAIL  $*"
  FAILURES=$((FAILURES + 1))
}

# describe <name>: print what came back for a response, to show who answered
# (our Worker, a Cloudflare challenge or block, a redirect).
describe() {
  local name="$1" h mitigated
  mitigated="$(header_value "$name" cf-mitigated)"
  if [[ -n "$mitigated" ]]; then
    echo "        => blocked by Cloudflare (cf-mitigated: $mitigated) before reaching the Worker;"
    echo "           see docs/deployment.md#cloudflare-blocks-the-smoke-test"
  fi
  echo "        status: $(grep -E '^HTTP/' "$WORK/$name.h" | tr -d '\r' | paste -sd '>' - || true)"
  for h in server cf-ray cf-mitigated location content-type x-robots-tag; do
    echo "        $h: $(header_value "$name" "$h")"
  done
  echo "        body: $(head -c 300 "$WORK/$name.b" | tr -c '[:print:]' ' ')"
  if [[ -s "$WORK/$name.err" ]]; then
    echo "        curl: $(tr -d '\r' <"$WORK/$name.err" | head -n 3 | paste -sd ' ' -)"
  fi
}

# fail_on <name> <message>: record a failure and describe the response behind it.
fail_on() {
  local name="$1"
  shift
  fail "$@"
  describe "$name"
}

# fetch <path> <name>: stores headers in $WORK/<name>.h, body in $WORK/<name>.b
# and prints the HTTP status code (000 when the request itself failed).
fetch() {
  local path="$1" name="$2" code
  # Start from empty files so a request that fails outright (DNS, TLS, timeout)
  # still leaves something to read.
  : >"$WORK/$name.h"
  : >"$WORK/$name.b"
  : >"$WORK/$name.err"
  code="$(curl "${CURL_OPTS[@]}" --dump-header "$WORK/$name.h" --output "$WORK/$name.b" \
    --write-out '%{http_code}' "$BASE_URL$path" 2>"$WORK/$name.err")" || code="000"
  echo "$code"
}

# header_value <name> <header>: last value of a response header, case-insensitive.
header_value() {
  local line
  line="$(grep -i "^$2:" "$WORK/$1.h" | tail -n 1 || true)"
  line="${line#*:}"
  line="${line%$'\r'}"
  echo "${line#"${line%%[![:space:]]*}"}"
}

echo "Smoke test: $BASE_URL ($MODE), expecting version '$EXPECTED'"

# is_redirect <code>: true for any 3xx status.
is_redirect() { [[ "$1" =~ ^3[0-9][0-9]$ ]]; }

# behind_access <name> <code>: true when the response is a 3xx to a Cloudflare Access login. A
# Location header on any other status (a 200 from the Worker) is not Access.
behind_access() {
  is_redirect "$2" && grep -qiE '^location:[[:space:]]*https://[^/[:space:]]+\.cloudflareaccess\.com/' "$WORK/$1.h"
}

# fail_redirect <name> <path> <code>: a redirect is a failure, not something to follow.
fail_redirect() {
  fail_on "$1" "GET $2 answered HTTP $3 redirecting to '$(header_value "$1" location)'; redirects are not followed and count as failures"
}

# 1. Wait until the expected version is live.
echo "Waiting for /version.txt to match (max $MAX_ATTEMPTS attempts)"
live=""
attempt=1
while true; do
  cb="$RANDOM$RANDOM"
  code="$(fetch "/version.txt?cb=$cb" version)"
  body="$(tr -d '\r\n' <"$WORK/version.b")"
  if behind_access version "$code"; then
    if [[ "$ALLOW_ACCESS" == "1" ]]; then
      echo "::notice::$BASE_URL is behind Cloudflare Access (redirected to its login page), so its content cannot be checked from CI. Skipping the content checks."
      exit 0
    fi
    fail_on version "$BASE_URL redirects to a Cloudflare Access login, so the deploy cannot be verified here"
    echo
    echo "Smoke test FAILED ($FAILURES check(s) failed)"
    exit 1
  fi
  if is_redirect "$code"; then
    fail_redirect version /version.txt "$code"
    echo
    echo "Smoke test FAILED ($FAILURES check(s) failed)"
    exit 1
  fi
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

# 2. Content, header and indexing checks. A new route or custom domain can take a moment
# to reach every edge, so the whole set is retried a few times once the version is live.
run_checks() {
  FAILURES=0
  if [[ -n "$live" ]]; then
    pass "/version.txt serves '$EXPECTED'"
  else
    fail_on version "/version.txt did not serve '$EXPECTED' after $MAX_ATTEMPTS attempts (last HTTP $code)"
  fi

  cc="$(header_value version cache-control)"
  if [[ "$cc" == *no-store* ]]; then
    pass "/version.txt Cache-Control contains no-store ($cc)"
  else
    fail_on version "/version.txt Cache-Control should contain no-store, got '$cc'"
  fi

  # 2. Home page and security headers.
  code="$(fetch "/?cb=$RANDOM$RANDOM" home)"
  if [[ "$code" == "200" ]]; then
    pass "GET / returned 200"
  elif is_redirect "$code"; then
    fail_redirect home / "$code"
  else
    fail_on home "GET / returned HTTP $code"
  fi

  for h in strict-transport-security content-security-policy x-content-type-options referrer-policy permissions-policy; do
    v="$(header_value home "$h")"
    if [[ -n "$v" ]]; then
      pass "header $h present"
    else
      fail_on home "header $h missing on /"
    fi
  done

  v="$(header_value home x-content-type-options)"
  if [[ "${v,,}" == "nosniff" ]]; then
    pass "X-Content-Type-Options is nosniff"
  else
    fail_on home "X-Content-Type-Options should be nosniff, got '$v'"
  fi

  # 3. Indexing policy.
  robots_header="$(header_value home x-robots-tag)"
  code="$(fetch "/robots.txt?cb=$RANDOM$RANDOM" robots)"
  if is_redirect "$code"; then
    fail_redirect robots /robots.txt "$code"
  elif [[ "$code" != "200" ]]; then
    fail_on robots "GET /robots.txt returned HTTP $code"
  fi
  robots_body="$(tr -d '\r' <"$WORK/robots.b")"

  if [[ "$MODE" == "noindex" ]]; then
    if [[ "${robots_header,,}" == *noindex* ]]; then
      pass "X-Robots-Tag contains noindex ($robots_header)"
    else
      fail_on home "this host must send X-Robots-Tag: noindex, got '$robots_header'"
    fi
    if grep -qiE '^[[:space:]]*Disallow:[[:space:]]*/[[:space:]]*$' <<<"$robots_body"; then
      pass "robots.txt disallows everything"
    else
      fail_on robots "robots.txt of this host must contain 'Disallow: /'"
    fi
  else
    if [[ "${robots_header,,}" == *noindex* ]]; then
      fail_on home "an indexable host must not send X-Robots-Tag noindex, got '$robots_header'"
    else
      pass "no X-Robots-Tag noindex"
    fi
    if grep -qiE '^[[:space:]]*Disallow:[[:space:]]*/[[:space:]]*$' <<<"$robots_body"; then
      fail_on robots "robots.txt of an indexable host must not contain 'Disallow: /'"
    else
      pass "robots.txt does not block the site"
    fi
  fi
}

round=1
while true; do
  echo "Checks (round $round of $CHECK_ROUNDS)"
  run_checks
  if ((FAILURES == 0)) || [[ -z "$live" ]] || ((round >= CHECK_ROUNDS)); then
    break
  fi
  echo "  $FAILURES check(s) failed; retrying in ${CHECK_DELAY}s"
  sleep "$CHECK_DELAY"
  round=$((round + 1))
done
echo
if ((FAILURES > 0)); then
  echo "Smoke test FAILED ($FAILURES check(s) failed)"
  exit 1
fi
echo "Smoke test passed"
