#!/usr/bin/env bash
# Fails unless the production deploy was started by the repository owner, by a Cut release run
# that the owner started for the same commit, or by a Text release run (text-release.yml) for a
# text/ pull request that the owner merged. Environment reviewers are not available on a private
# repository on GitHub Free, so this guard is what enforces who may deploy production.
# The text path needs all three: a Text release push run of the owner for this commit,
# verify-text-merge.sh (that workflow succeeds on every push to main, so the merge is checked
# again here), and TAG being the highest vX.Y.Z tag (a stale text tag cannot roll production back).
# Requires GH_TOKEN (actions: read, pull-requests: read), GH_REPO, SHA, TAG, ACTOR and
# TRIGGERING_ACTOR in the env.
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

  # Text release dispatches the same way, after a push of the owner's merge of a text/ branch.
  semver='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
  tag="${TAG:-}"
  if [[ "$tag" =~ $semver ]]; then
    text_runs="$(gh api "repos/$GH_REPO/actions/workflows/text-release.yml/runs?head_sha=$SHA&event=push&per_page=100" \
      --jq '[.workflow_runs[] | select(.head_branch == "main" and .event == "push" and .actor.login == "greenblacked" and .triggering_actor.login == "greenblacked" and (.status == "in_progress" or .conclusion == "success"))] | length')"
    if [[ "$text_runs" -ge 1 ]] &&
      GITHUB_OUTPUT="" "$(dirname "${BASH_SOURCE[0]}")/verify-text-merge.sh"; then
      latest="$(gh api --paginate "repos/$GH_REPO/git/matching-refs/tags/v" --jq '.[].ref' \
        | sed 's#^refs/tags/##' \
        | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' \
        | sort -V | tail -n 1 || true)"
      if [[ "$tag" == "$latest" ]]; then
        echo "Dispatched by a Text release run of the owner for $SHA ($tag, the latest release tag)."
        exit 0
      fi
    fi
  fi
  echo "::error::No Cut release run by the owner, nor a verified text/ merge release, for $SHA ($tag). Run Cut release, or Run workflow on the tag as the owner."
  exit 1
fi

echo "::error::Deploy production is limited to the repository owner or a Cut release run by the owner (actor '$ACTOR', triggered by '$TRIGGERING_ACTOR')."
exit 1
