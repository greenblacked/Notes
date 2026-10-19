#!/usr/bin/env bash
# Fails unless the most recently executed Deploy stage run (deploy-stage.yml) for $SHA on main is completed with
# conclusion success AND its job "Update stage Preview" ran the step "Update the stage Preview"
# with success. A run whose commit was no longer the head of main skips that step but still
# succeeds, so a green run alone does not prove stage serves $SHA. Records the run checked in
# $GITHUB_STEP_SUMMARY. "Most recently executed" is the latest run_started_at (a re-run keeps its
# run number but gets a new start time), ties broken by run_number, then run_attempt. Used by cut-release.yml before it tags.
# The one exception is the very first release: while no release tag (vX.Y.Z) exists yet, the check
# is skipped with a notice, because the stage Preview needs the custom domain, which only exists
# after the first production deploy. If the tag lookup itself fails, the check fails closed.
# Requires GH_TOKEN (actions: read), GH_REPO and SHA in the env.
set -euo pipefail

workflow="deploy-stage.yml"
job_name="Update stage Preview"
step_name="Update the stage Preview"
retry="Run Deploy stage from main (Actions, Deploy stage, Run workflow), wait until it is green, then run Cut release again."

summary() {
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$@" >>"$GITHUB_STEP_SUMMARY"
  fi
}

fail() {
  echo "::error::$1"
  summary "Stage check: refused for \`$SHA\`: $1"
  exit 1
}

# Values from the API are printed only after this check.
safe_word() {
  if [[ "$1" =~ ^[a-z_]+$ ]]; then
    printf '%s' "$1"
  else
    printf 'unknown'
  fi
}

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::SHA must be a full 40-character commit id, got '$SHA'."
  exit 1
fi

# First release only: no release tag yet means stage cannot have been deployed (see above).
if ! tag_refs="$(gh api --paginate "repos/$GH_REPO/git/matching-refs/tags/v" --jq '.[].ref')"; then
  fail "Could not list the release tags to decide whether this is the first release."
fi
if ! grep -qE '^refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$' <<<"$tag_refs"; then
  echo "::notice::No release tag (vX.Y.Z) exists yet: this is the first release, so the Deploy stage run is not required (the custom domain that stage needs exists only after the first production deploy)."
  summary "### Stage check" "" "- Commit: \`$SHA\`" \
    "- Skipped: no release tag exists yet (first release); the Deploy stage run is not required"
  exit 0
fi

runs="$(gh api "repos/$GH_REPO/actions/workflows/$workflow/runs?head_sha=$SHA&branch=main&per_page=100" \
  --paginate --jq '.workflow_runs[] | {id, run_number, run_attempt, run_started_at, head_sha, head_branch, status, conclusion}')"
latest="$(jq -sc --arg sha "$SHA" \
  'map(select(.head_sha == $sha and .head_branch == "main")) | max_by([(.run_started_at // ""), .run_number, .run_attempt]) // empty' <<<"$runs")"
if [[ -z "$latest" ]]; then
  fail "No Deploy stage run found for $SHA on main. $retry"
fi

id="$(jq -r '.id | tostring' <<<"$latest")"
run_number="$(jq -r '.run_number | tostring' <<<"$latest")"
run_attempt="$(jq -r '.run_attempt | tostring' <<<"$latest")"
status="$(safe_word "$(jq -r '.status // "unknown"' <<<"$latest")")"
conclusion="$(safe_word "$(jq -r '.conclusion // "unknown"' <<<"$latest")")"

if [[ ! "$id" =~ ^[0-9]+$ || ! "$run_number" =~ ^[0-9]+$ || ! "$run_attempt" =~ ^[0-9]+$ ]]; then
  fail "Deploy stage run for $SHA has an unexpected run id. $retry"
fi
url="${GITHUB_SERVER_URL:-https://github.com}/$GH_REPO/actions/runs/$id"

if [[ "$status" != "completed" ]]; then
  fail "Deploy stage run $url for $SHA is still $status; wait for it to finish, then run Cut release again."
fi
if [[ "$conclusion" != "success" ]]; then
  fail "Deploy stage run $url for $SHA ended with '$conclusion'. $retry"
fi

jobs="$(gh api "repos/$GH_REPO/actions/runs/$id/jobs?filter=latest&per_page=100" --paginate --jq '.jobs[]')"
job_count="$(jq -s --arg n "$job_name" '[.[] | select(.name == $n)] | length' <<<"$jobs")"
if [[ "$job_count" != "1" ]]; then
  fail "Deploy stage run $url has no single job '$job_name'. $retry"
fi
job_conclusion="$(safe_word "$(jq -rs --arg n "$job_name" '[.[] | select(.name == $n)][0].conclusion // "unknown"' <<<"$jobs")")"
if [[ "$job_conclusion" == "skipped" ]]; then
  fail "Deploy stage run $url did not update stage for $SHA (job '$job_name' was skipped; main may have moved on). $retry"
fi
if [[ "$job_conclusion" != "success" ]]; then
  fail "Deploy stage run $url: job '$job_name' ended with '$job_conclusion'. $retry"
fi
step_conclusion="$(safe_word "$(jq -rs --arg n "$job_name" --arg s "$step_name" \
  '[.[] | select(.name == $n)][0] | ([.steps[]? | select(.name == $s) | .conclusion][0]) // "missing"' <<<"$jobs")")"
if [[ "$step_conclusion" != "success" ]]; then
  fail "Deploy stage run $url did not update stage for $SHA (step '$step_name': $step_conclusion; main may have moved on). $retry"
fi

summary "### Stage check" "" "- Commit: \`$SHA\`" \
  "- Deploy stage run: $url (run #$run_number, attempt $run_attempt)" \
  "- Run: completed, success; job \"$job_name\": success; step \"$step_name\": success"
echo "Deploy stage run $url updated stage for $SHA."
