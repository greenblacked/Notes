#!/usr/bin/env bash
# Applies the branch rulesets and environment branch policies this pipeline relies on
# (docs/deployment.md#repository-settings), idempotently, through the GitHub REST API.
# Used by repo-settings.yml. Requires GH_REPO (owner/name) and GH_TOKEN (fine-grained token with
# Administration: read and write on this repository only) in the env; DRY_RUN is "true"
# (default: only print the planned changes) or "false". Needs gh and jq.
#
# The environment `stage` is limited to the branch `dev`.
#
# Never prints the token and never enables `set -x`. Branch protection of `main` and the
# `production` environment are only read, never written; the `main` ruleset is only ever made
# stricter. The required check `CI OK` is pinned to GitHub Actions (integration 15368): a `CI OK`
# entry with any other integration is removed, because another app could satisfy it with a
# commit status, and the pinned entry is added when missing.
set -euo pipefail

: "${GH_REPO:?GH_REPO (owner/name) is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"
DRY_RUN="${DRY_RUN:-true}"
if [[ "$DRY_RUN" != "true" && "$DRY_RUN" != "false" ]]; then
  echo "::error::DRY_RUN must be 'true' or 'false', got '$DRY_RUN'."
  exit 1
fi

# 15368 is the GitHub Actions app: only Actions can satisfy the check, a commit status from
# anyone else cannot.
CI_CHECK='{"context":"CI OK","integration_id":15368}'
PLANNED=0
GOT=""

say() {
  echo "$1"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    echo "- $1" >>"$GITHUB_STEP_SUMMARY"
  fi
}

# mutate METHOD PATH [json]: the only function that writes.
mutate() {
  local method="$1" path="$2" body="${3:-}"
  if [[ "$DRY_RUN" == "true" ]]; then
    PLANNED=$((PLANNED + 1))
    if [[ -n "$body" ]]; then
      say "PLAN: $method $path $(jq -c . <<<"$body")"
    else
      say "PLAN: $method $path"
    fi
    return 0
  fi
  if [[ -n "$body" ]]; then
    printf '%s' "$body" | gh api -X "$method" "repos/$GH_REPO/$path" --input - >/dev/null
  else
    gh api -X "$method" "repos/$GH_REPO/$path" >/dev/null
  fi
  say "DONE: $method $path"
}

# get PATH [gh args]: sets GOT. Returns 0 when found, 1 on HTTP 404; any other error stops the run.
get() {
  local path="$1" err
  shift
  err="$(mktemp)"
  if GOT="$(gh api "repos/$GH_REPO/$path" "$@" 2>"$err")"; then
    rm -f "$err"
    return 0
  fi
  if grep -q 'HTTP 404' "$err"; then
    rm -f "$err"
    GOT=""
    return 1
  fi
  echo "::error::GET $path failed: $(head -c 500 "$err")"
  if grep -q 'HTTP 403' "$err"; then
    echo "::error::HTTP 403: the token may lack a read permission; see docs/deployment.md#repository-settings."
  fi
  rm -f "$err"
  exit 1
}

rules_json() { # $1: allowed merge methods as a JSON array
  jq -nc --argjson methods "$1" --argjson ci "$CI_CHECK" '[
    {type: "deletion"},
    {type: "non_fast_forward"},
    {type: "pull_request", parameters: {
      required_approving_review_count: 0,
      dismiss_stale_reviews_on_push: false,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_review_thread_resolution: false,
      allowed_merge_methods: $methods}},
    {type: "required_status_checks", parameters: {
      strict_required_status_checks_policy: false,
      do_not_enforce_on_create: false,
      required_status_checks: [$ci]}}]'
}

desired_ruleset() { # $1 name, $2 branch, $3 merge methods
  jq -nc --arg name "$1" --arg ref "refs/heads/$2" --argjson rules "$(rules_json "$3")" '{
    name: $name, target: "branch", enforcement: "active", bypass_actors: [],
    conditions: {ref_name: {include: [$ref], exclude: []}},
    rules: $rules}'
}

# find_ruleset NAME: sets RULESET_ID ("" when missing). Only rulesets of this repository.
find_ruleset() {
  local list
  get "rulesets?includes_parents=false" --paginate || true
  list="$(jq -sc 'add // []' <<<"${GOT:-[]}")"
  RULESET_ID="$(jq -r --arg n "$1" '[.[] | select(.name == $n and .source_type == "Repository") | .id][0] // ""' <<<"$list")"
}

# (a) Ruleset `dev`: owned by this script, brought to the exact desired state.
ensure_dev_ruleset() {
  local want
  want="$(desired_ruleset dev dev '["merge","squash","rebase"]')"
  find_ruleset dev
  if [[ -z "$RULESET_ID" ]]; then
    mutate POST rulesets "$want"
    return
  fi
  get "rulesets/$RULESET_ID" || { echo "::error::Ruleset $RULESET_ID vanished."; exit 1; }
  if jq -e --argjson w "$want" '
      . as $have
      | $have.enforcement == $w.enforcement
        and ($have.bypass_actors // []) == []
        and $have.target == $w.target
        and ($have.conditions.ref_name.include // [] | sort) == ($w.conditions.ref_name.include | sort)
        and ($have.conditions.ref_name.exclude // []) == []
        and ([$have.rules[].type] | sort) == ([$w.rules[].type] | sort)
        and ($w.rules | all(
          . as $wr
          | ($have.rules[] | select(.type == $wr.type)) as $hr
          | ($wr.parameters // {}) | to_entries | all(
              . as $e
              | if $e.key == "required_status_checks"
                then ($e.value | map({context, integration_id}) | sort)
                     == (($hr.parameters.required_status_checks // []) | map({context, integration_id}) | sort)
                elif ($e.value | type) == "array"
                then ($e.value | sort) == ((($hr.parameters // {})[$e.key] // []) | sort)
                else $e.value == (($hr.parameters // {})[$e.key])
                end)))' <<<"$GOT" >/dev/null; then
    say "OK: ruleset dev up to date"
  else
    mutate PUT "rulesets/$RULESET_ID" "$want"
  fi
}

# (b) Ruleset `main`: add only, never loosen. Classic branch protection is never modified.
ensure_main_ruleset() {
  local want rules existing new_rules enforcement changed
  if get branches/main/protection; then
    say "OK: classic protection on main exists (read only, not modified): $(jq -c '{pr: (.required_pull_request_reviews != null), checks: (.required_status_checks.contexts // []), force_push: (.allow_force_pushes.enabled // false), deletions: (.allow_deletions.enabled // false)}' <<<"$GOT")"
  else
    say "OK: no classic protection on main"
  fi
  want="$(desired_ruleset main main '["merge"]')"
  find_ruleset main
  if [[ -z "$RULESET_ID" ]]; then
    mutate POST rulesets "$want"
    return
  fi
  get "rulesets/$RULESET_ID" || { echo "::error::Ruleset $RULESET_ID vanished."; exit 1; }
  existing="$GOT"
  if ! jq -e '.target == "branch" and ((.conditions.ref_name.include // []) | any(. == "refs/heads/main" or . == "~DEFAULT_BRANCH")) and ((.conditions.ref_name.exclude // []) | length == 0)' <<<"$existing" >/dev/null; then
    echo "::error::Ruleset main (id $RULESET_ID) may not protect the branch main (target must be branch, conditions.ref_name.include must contain refs/heads/main or ~DEFAULT_BRANCH, and conditions.ref_name.exclude must be empty, because any exclude pattern could exclude main). Fix or delete it in the repository settings, then run this workflow again."
    exit 1
  fi
  if ! jq -e '(.conditions.ref_name.include // []) | length == 1' <<<"$existing" >/dev/null; then
    echo "::error::Ruleset main (id $RULESET_ID) must target only the branch main: conditions.ref_name.include must be exactly one entry, refs/heads/main or ~DEFAULT_BRANCH. Other patterns would get a pull request and CI OK requirement, but ci.yml runs only for main and dev, so those branches could never merge. Remove the other patterns and protect those branches with a dedicated ruleset, then run this workflow again."
    exit 1
  fi
  rules="$(jq -c '.rules' <<<"$want")"
  new_rules="$(jq -c --argjson d "$rules" --argjson ci "$CI_CHECK" '
      .rules as $r
      | ($r + [$d[] | select(.type as $t | ($r | map(.type) | index($t)) == null)])
      | map(if .type == "required_status_checks"
               and (((.parameters.required_status_checks // []) | any(.context == $ci.context and .integration_id != $ci.integration_id))
                    or ((.parameters.required_status_checks // []) | any(.context == $ci.context and .integration_id == $ci.integration_id) | not))
            then .parameters.required_status_checks = (
                ((.parameters.required_status_checks // []) | map(select(.context != $ci.context or .integration_id == $ci.integration_id))) as $kept
                | if ($kept | any(.context == $ci.context)) then $kept else $kept + [$ci] end)
            else . end)' <<<"$existing")"
  enforcement="$(jq -r '.enforcement' <<<"$existing")"
  changed=false
  if [[ "$new_rules" != "$(jq -c '.rules' <<<"$existing")" ]]; then
    changed=true
  fi
  if [[ "$enforcement" != "active" ]]; then
    changed=true
  fi
  if jq -e '[.rules[] | select(.type == "pull_request") | .parameters.allowed_merge_methods[]? | select(. != "merge")] | length > 0' <<<"$existing" >/dev/null; then
    say "WARN: ruleset main allows more merge methods than merge commits; left as it is (dev to main must use a merge commit)."
  fi
  if jq -e '(.bypass_actors // []) | length > 0' <<<"$existing" >/dev/null; then
    say "WARN: ruleset main has bypass actors; left untouched."
  fi
  if [[ "$changed" == "true" ]]; then
    mutate PUT "rulesets/$RULESET_ID" "$(jq -c --argjson r "$new_rules" '{name, target, enforcement: "active", bypass_actors: (.bypass_actors // []), conditions, rules: $r}' <<<"$existing")"
  else
    say "OK: ruleset main up to date"
  fi
}

# (c) Environment NAME restricted to the single branch BRANCH.
ensure_env() {
  local name="$1" branch="$2" exists=1 env_json="null" body policies others id
  get "environments/$name" || exists=0
  if ((exists)); then
    env_json="$GOT"
  fi
  if ((exists)) && jq -e '(.deployment_branch_policy // {}) | .protected_branches == false and .custom_branch_policies == true' <<<"$env_json" >/dev/null; then
    say "OK: environment $name uses custom branch policies"
  else
    # Keep the existing wait timer and reviewers so the PUT never drops a protection.
    body="$(jq -nc --argjson e "$env_json" '
      {deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}}
      + (if $e == null then {} else
          {wait_timer: (([$e.protection_rules[]? | select(.type == "wait_timer") | .wait_timer][0]) // 0)}
          + (([$e.protection_rules[]? | select(.type == "required_reviewers")][0]) as $rr
             | if $rr == null then {}
               else {prevent_self_review: ($rr.prevent_self_review // false),
                     reviewers: [$rr.reviewers[]? | {type, id: .reviewer.id}]} end)
         end)')"
    mutate PUT "environments/$name" "$body"
  fi
  policies="[]"
  if ((exists)); then
    get "environments/$name/deployment-branch-policies" --paginate || true
    policies="$(jq -sc '[.[].branch_policies[]?]' <<<"${GOT:-}")"
  fi
  # Add before deleting: the environment is never open, and with zero entries it allows nothing.
  if jq -e --arg b "$branch" 'any(.[]; .name == $b and (.type // "branch") == "branch")' <<<"$policies" >/dev/null; then
    say "OK: environment $name allows branch $branch"
  else
    mutate POST "environments/$name/deployment-branch-policies" "$(jq -nc --arg b "$branch" '{name: $b, type: "branch"}')"
  fi
  others="$(jq -r --arg b "$branch" '.[] | select(.name != $b or (.type // "branch") != "branch") | .id' <<<"$policies")"
  for id in $others; do
    mutate DELETE "environments/$name/deployment-branch-policies/$id"
  done
}

# (d) production: report only, no writes.
report_production() {
  local reviewers policies
  if ! get environments/production; then
    say "WARN: environment production does not exist (see docs/deployment.md#repository-settings)."
    return
  fi
  reviewers="$(jq -r '[.protection_rules[]? | select(.type == "required_reviewers") | .reviewers[]? | (.reviewer.login // .reviewer.slug)] | join(",")' <<<"$GOT")"
  get environments/production/deployment-branch-policies --paginate || true
  policies="$(jq -sc '[.[].branch_policies[]?]' <<<"${GOT:-}")"
  say "OK: production (read only): reviewers '${reviewers}', policies $(jq -c 'map("\(.type // "branch"):\(.name)")' <<<"$policies")"
  if [[ -z "$reviewers" ]]; then
    say "WARN: production has no required reviewers."
  fi
  if ! jq -e 'any(.[]; .type == "tag" and .name == "v*")' <<<"$policies" >/dev/null; then
    say "WARN: production has no tag policy v*."
  fi
  if ! jq -e 'any(.[]; (.type // "branch") == "branch" and .name == "main")' <<<"$policies" >/dev/null; then
    say "WARN: production has no branch policy main."
  fi
}

# (e) Retired environments (dev, replaced by stage on 2026-10-18; staging, removed 2026-10-15)
# are deleted only on explicit opt-in (DELETE_OLD_ENVIRONMENTS=true), because deletion is
# irreversible and they may hold the only copy of CLOUDFLARE_API_TOKEN. The live environments
# are never deleted here.
remove_env() {
  local name="$1"
  if [[ "$name" == "stage" || "$name" == "production" || "$name" == "repo-admin" ]]; then
    echo "::error::refusing to delete environment $name"
    exit 1
  fi
  if get "environments/$name"; then
    mutate DELETE "environments/$name"
  else
    say "OK: no $name environment"
  fi
}

# (f) Fork pull request workflows need the owner's approval.
ensure_fork_approval() {
  if ! get actions/permissions/fork-pr-contributor-approval; then
    say "WARN: fork pull request approval policy is not available for this repository."
    return
  fi
  if [[ "$(jq -r '.approval_policy' <<<"$GOT")" == "all_external_contributors" ]]; then
    say "OK: fork pull request workflows need approval for all external contributors"
  else
    mutate PUT actions/permissions/fork-pr-contributor-approval '{"approval_policy":"all_external_contributors"}'
  fi
}

report_state() {
  local list
  get "rulesets?includes_parents=false" --paginate || true
  list="$(jq -sc 'add // []' <<<"${GOT:-[]}")"
  say "STATE: rulesets $(jq -c 'map("\(.name):\(.enforcement)")' <<<"$list")"
  for name in stage repo-admin production; do
    if get "environments/$name"; then
      say "STATE: environment $name $(jq -c '.deployment_branch_policy' <<<"$GOT")"
    else
      say "STATE: environment $name missing"
    fi
  done
}

apply_all() {
  ensure_dev_ruleset
  ensure_main_ruleset
  ensure_env stage dev
  ensure_env repo-admin main
  report_production
  if [[ "${DELETE_OLD_ENVIRONMENTS:-false}" == "true" ]]; then
    remove_env dev
    remove_env staging
  else
    say "OK: old environments dev and staging left as they are (delete_old_environments not set)"
  fi
  ensure_fork_approval
}

apply_all

if [[ "$DRY_RUN" == "true" ]]; then
  say "Dry run: $PLANNED planned change(s); re-run with dry_run unchecked to apply."
else
  report_state
  say "Verify: re-run with dry_run checked; it must report 0 planned change(s)."
fi
