#!/usr/bin/env bash
# PreToolUse(Bash): ブランチ戦略に反する git 操作をブロックする。判断は scripts/lib/policy.sh。
set -euo pipefail
# shellcheck source=../../scripts/lib/load.sh
source "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}/scripts/lib/load.sh"
harness_load hook-io
hook_read_input

cmd="$(hook_field .tool_input.command)"
[[ $cmd == *git* ]] || exit 0

branch="$(git -C "$HARNESS_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
reason="$(policy_git_command "$cmd" "$branch")" || hook_block "$reason"

if [[ $cmd =~ git[[:space:]]+commit ]]; then
  staged="$(git -C "$HARNESS_ROOT" diff --cached --name-only 2>/dev/null || true)"
  found="$(policy_forbidden_paths <<<"$staged")" ||
    hook_block "コミット禁止のファイルがステージされています（'git restore --staged <path>' で外してください）:
$found"
fi
exit 0
