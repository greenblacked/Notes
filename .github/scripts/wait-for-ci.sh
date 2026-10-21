#!/usr/bin/env bash
# Waits (bounded) for the latest ci.yml push run on main for $SHA to finish. Exit 0 only when it
# concluded success. A failed, cancelled or timed-out run, and a missing run at the deadline,
# fail closed: nothing is released. Used by text-release.yml before it tags.
# Requires GH_TOKEN (actions: read), GH_REPO and SHA in the env. Optional POLL_SECONDS (default
# 30) and MAX_WAIT_SECONDS (default 2700); both non-negative integers.
set -euo pipefail

poll="${POLL_SECONDS:-30}"
max="${MAX_WAIT_SECONDS:-2700}"
if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::SHA must be a full 40-character commit id, got '$SHA'."
  exit 1
fi
if [[ ! "$poll" =~ ^[0-9]+$ || ! "$max" =~ ^[0-9]+$ ]]; then
  echo "::error::POLL_SECONDS and MAX_WAIT_SECONDS must be non-negative integers."
  exit 1
fi

hint="A newer text/ merge releases this content with it, or fix CI and re-run this workflow."
deadline=$((SECONDS + max))
while true; do
  state="$(gh api "repos/$GH_REPO/actions/workflows/ci.yml/runs?head_sha=$SHA&event=push&per_page=100" \
    --jq '[.workflow_runs[] | select(.head_branch == "main")] | sort_by(.run_number, .run_attempt) | last | "\(.status // "none") \(.conclusion // "none")"')"
  read -r status conclusion <<<"$state"
  if [[ "$status" == "completed" ]]; then
    if [[ "$conclusion" == "success" ]]; then
      echo "CI succeeded for $SHA."
      exit 0
    fi
    echo "::error::CI for $SHA concluded $conclusion; nothing is released. $hint"
    exit 1
  fi
  if [[ "$SECONDS" -ge "$deadline" ]]; then
    echo "::error::Timed out after ${max}s waiting for CI on $SHA (last state: $state); nothing is released. $hint"
    exit 1
  fi
  echo "CI for $SHA: $state; waiting ${poll}s."
  sleep "$poll"
done
