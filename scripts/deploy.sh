#!/usr/bin/env bash
# Deploy ./dist to one environment, smoke-test it and roll back on failure.
#
#   scripts/deploy.sh <production|stage> <commit-sha> <message>
#
# Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
set -euo pipefail

env_name="${1:?usage: deploy.sh <production|stage> <commit-sha> <message>}"
commit="${2:?commit sha required}"
message="${3:?deploy message required}"

case "$env_name" in
  production|stage) ;;
  *) echo "unknown environment: $env_name" >&2; exit 2 ;;
esac

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" || -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN (environment secret) and CLOUDFLARE_ACCOUNT_ID (variable) must be set" >&2
  exit 2
fi

[[ -f dist/build-info.json ]] || { echo "dist/ not found: build before deploying" >&2; exit 2; }
built_env="$(jq -r '.env' dist/build-info.json)"
new_build="$(jq -r '.build' dist/build-info.json)"
[[ "$built_env" == "$env_name" ]] || { echo "dist/ was built for '$built_env', not '$env_name'" >&2; exit 2; }

wrangler() { npx --no-install wrangler "$@"; }
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# The version taking 100% of traffic is the rollback target. Only a Worker
# that has never been deployed may have none; any other error stops here,
# so a deploy never runs with rollback silently disabled.
status_err="$(mktemp)"
trap 'rm -f "$status_err"' EXIT
if status_json="$(wrangler deployments status --env "$env_name" --json 2>"$status_err")"; then
  previous_version="$(jq -r '[.versions[] | select(.percentage == 100)][0].version_id // empty' <<<"$status_json")"
elif grep -qiE 'has no deployments|not found|10007' "$status_err"; then
  previous_version=""
else
  cat "$status_err" >&2
  log "could not read the current $env_name deployment; aborting before deploy"
  exit 1
fi
previous_build="$(scripts/smoke-test.sh "$env_name" --live-build)"
log "current $env_name version: ${previous_version:-none (first deploy)}, build: ${previous_build:-unknown}"

log "deploying $commit (build $new_build) to $env_name"
wrangler deploy --env "$env_name" --tag "${commit:0:12}" --message "$message"

if scripts/smoke-test.sh "$env_name" "$new_build"; then
  log "deploy to $env_name succeeded"
  exit 0
fi

log "smoke test failed for $env_name"
if [[ -z "$previous_version" ]]; then
  log "no previous version to roll back to; leaving the failed version live"
  exit 1
fi

log "rolling back $env_name to $previous_version"
wrangler rollback "$previous_version" --env "$env_name" --yes \
  --message "Automatic rollback: smoke test failed for ${commit:0:12}"
# Wait for the old build to be served again, then re-check it.
if scripts/smoke-test.sh "$env_name" "$previous_build"; then
  log "rollback succeeded; $env_name is back on $previous_version"
else
  log "rollback finished but smoke test still fails; investigate now"
fi
exit 1
