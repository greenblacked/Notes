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

[[ -d dist ]] || { echo "dist/ not found: build before deploying" >&2; exit 2; }
served_env="$(jq -r '.env' dist/build-info.json)"
[[ "$served_env" == "$env_name" ]] || { echo "dist/ was built for '$served_env', not '$env_name'" >&2; exit 2; }

wrangler() { npx --no-install wrangler "$@"; }
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }

# The version currently taking 100% of traffic is the rollback target.
# A first-ever deploy has none; then a failed smoke test cannot roll back.
previous_version="$(wrangler deployments status --env "$env_name" --json 2>/dev/null \
  | jq -r '[.versions[] | select(.percentage == 100)][0].version_id // empty' || true)"
log "current $env_name version: ${previous_version:-none (first deploy)}"

log "deploying $commit to $env_name"
wrangler deploy --env "$env_name" --tag "${commit:0:12}" --message "$message"

if scripts/smoke-test.sh "$env_name" "$commit"; then
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
  --message "Automatic rollback: smoke test failed for $commit"
# Re-check without a commit pin: the old version must be healthy again.
if scripts/smoke-test.sh "$env_name"; then
  log "rollback succeeded; $env_name is back on $previous_version"
else
  log "rollback finished but smoke test still fails; investigate now"
fi
exit 1
