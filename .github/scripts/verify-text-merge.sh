#!/usr/bin/env bash
# Verifies through the API that $SHA is the merge commit of a pull request that came from a text/
# branch of this repository, was merged into main and was merged by the owner. Used by
# text-release.yml and by the production deploy guard (require-release-actor.sh).
# Requires GH_TOKEN (pull-requests: read, contents: read), GH_REPO and SHA in the env.
# When GITHUB_OUTPUT is set it receives pr=<number> and head_ref=<branch>.
# Exit codes: 0 a verified text/ merge by the owner, 3 not one (a notice says why),
# 1 bad input, an API error or an ambiguous result.
set -uo pipefail

owner="greenblacked"
export SHA="${SHA:-}" GH_REPO="${GH_REPO:-}"

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::SHA must be a full 40-character commit id, got '$SHA'."
  exit 1
fi
if [[ -z "$GH_REPO" ]]; then
  echo "::error::GH_REPO is not set."
  exit 1
fi

not_text() {
  echo "::notice::$SHA: $1"
  exit 3
}

candidates="$(gh api "repos/$GH_REPO/commits/$SHA/pulls" \
  --jq '.[] | select(.merge_commit_sha == env.SHA and .merged_at != null and .base.ref == "main" and (.head.ref | startswith("text/")) and .head.repo.full_name == env.GH_REPO) | .number')" || exit 1
mapfile -t numbers < <(printf '%s\n' "$candidates" | sed '/^$/d')

if [[ "${#numbers[@]}" -eq 0 ]]; then
  not_text "not the merge commit of a text/ pull request from this repository."
fi
if [[ "${#numbers[@]}" -gt 1 ]]; then
  echo "::error::$SHA matches more than one text/ pull request (${numbers[*]}); refusing."
  exit 1
fi
n="${numbers[0]}"
if [[ ! "$n" =~ ^[0-9]+$ ]]; then
  echo "::error::Unexpected pull request number '$n'."
  exit 1
fi

# "-" stands for an empty value: a tab-separated read would collapse empty fields.
row="$(gh api "repos/$GH_REPO/pulls/$n" \
  --jq '[.merged, .merge_commit_sha, (.merged_by.login // "-"), .head.ref, (.head.repo.full_name // "-"), .base.ref, (.base.repo.full_name // "-")] | @tsv')" || exit 1
IFS=$'\t' read -r merged merge_sha merged_by head_ref head_repo base_ref base_repo <<<"$row"

if [[ "$merged" != "true" ]]; then
  not_text "pull request #$n is not merged."
fi
if [[ "$merge_sha" != "$SHA" ]]; then
  not_text "pull request #$n was merged as $merge_sha, not this commit."
fi
if [[ "$merged_by" != "$owner" ]]; then
  not_text "pull request #$n was merged by '$merged_by', not the owner."
fi
if [[ ! "$head_ref" =~ ^text/[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  not_text "pull request #$n head branch is not text/<lower-case-kebab>."
fi
if [[ "$head_repo" != "$GH_REPO" ]]; then
  not_text "pull request #$n head repository is '$head_repo', not this repository."
fi
if [[ "$base_ref" != "main" ]]; then
  not_text "pull request #$n base branch is '$base_ref', not main."
fi
if [[ "$base_repo" != "$GH_REPO" ]]; then
  not_text "pull request #$n base repository is '$base_repo', not this repository."
fi

echo "Verified: $SHA is the merge of text/ pull request #$n ($head_ref) by $owner."
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "pr=$n"
    echo "head_ref=$head_ref"
  } >>"$GITHUB_OUTPUT"
fi
