#!/usr/bin/env bash
# Fails unless the production deploy was started by the repository owner, or by a Cut release
# run that the owner started for the same commit. Environment reviewers are not available on a
# private repository on GitHub Free, so this guard is what enforces who may deploy production.
# Requires GH_TOKEN (actions: read), GH_REPO, SHA, ACTOR and TRIGGERING_ACTOR in the env.
set -euo pipefail

owner="greenblacked"
bot="github-actions[bot]"

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::SHA must be a full 40-character commit id, got '$SHA'."
  exit 1
fi

if [[ "$ACTOR" == "$owner" && "$TRIGGERING_ACTOR" == "$owner" ]]; then
  echo "Dispatched by the owner."
  exit 0
fi

# Cut release dispatches this workflow with GITHUB_TOKEN, so the actor is the bot. An owner
# re-run of that dispatch keeps the bot as actor and makes the owner the triggering actor.
if [[ "$ACTOR" == "$bot" && ("$TRIGGERING_ACTOR" == "$bot" || "$TRIGGERING_ACTOR" == "$owner") ]]; then
  count="$(gh api "repos/$GH_REPO/actions/workflows/cut-release.yml/runs?head_sha=$SHA&event=workflow_dispatch&per_page=100" \
    --jq '[.workflow_runs[] | select(.head_branch == "main" and .actor.login == "greenblacked" and .triggering_actor.login == "greenblacked" and (.status == "in_progress" or .conclusion == "success"))] | length')"
  if [[ "$count" -ge 1 ]]; then
    echo "Dispatched by a Cut release run of the owner for $SHA."
    exit 0
  fi
  echo "::error::No Cut release run by the owner for $SHA. Run Cut release, or Run workflow on the tag as the owner."
  exit 1
fi

echo "::error::Deploy production is limited to the repository owner or a Cut release run by the owner (actor '$ACTOR', triggered by '$TRIGGERING_ACTOR')."
exit 1
