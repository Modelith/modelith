#!/usr/bin/env bash
# PreToolUse(mcp__github__merge_pull_request | mcp__github__enable_pr_auto_merge):
# PR のマージ先・マージ元・方式から許可／承認要求／拒否を返す。判断は scripts/lib/policy.sh。
# PR 情報は GitHub API（HARNESS_GITHUB_API、既定 https://api.github.com）から取得する。
set -uo pipefail
# shellcheck source=../../scripts/lib/load.sh
source "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}/scripts/lib/load.sh"
harness_load hook-io
hook_read_input

owner="$(hook_field .tool_input.owner)"
repo="$(hook_field .tool_input.repo)"
pr="$(hook_field .tool_input.pullNumber)"
method="$(hook_field '(.tool_input.merge_method // .tool_input.mergeMethod // "") | ascii_downcase')"

# PR の base / head を "<base> <head>" で出力する（取得できなければ空）。
fetch_pr_refs() {
  local api="${HARNESS_GITHUB_API:-https://api.github.com}" auth=()
  [[ -n ${GITHUB_TOKEN:-} ]] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  curl -fsS --max-time 10 "${auth[@]}" -H "Accept: application/vnd.github+json" \
    "$api/repos/$owner/$repo/pulls/$pr" 2>/dev/null | jq -r '"\(.base.ref // "") \(.head.ref // "")"'
}

read -r base head <<<"$(fetch_pr_refs || true)"
IFS=$'\t' read -r decision reason <<<"$(policy_merge_decision "${base:-}" "${head:-}" "$method")"
hook_decide "$decision" "$reason: $owner/$repo#$pr"
