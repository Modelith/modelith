#!/usr/bin/env bash
# Stop: 作業完了の前に高速チェックを走らせ、失敗なら停止を差し戻す（終了コード 2）。
# 対象となる変更は scripts/harness.conf の HARNESS_VERIFY_TRIGGER、判断は scripts/lib/policy.sh。
set -uo pipefail
# shellcheck source=../../scripts/lib/load.sh
source "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}/scripts/lib/load.sh"
harness_load hook-io
hook_read_input

# 差し戻し後の再停止では無限ループを避けるため通す
[[ "$(hook_field .stop_hook_active)" == "true" ]] && exit 0

cd "$HARNESS_ROOT" || exit 0
changed="$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } 2>/dev/null)"
policy_needs_verify <<<"$changed" || exit 0

if ! out="$(scripts/check.sh --fast 2>&1)"; then
  echo "scripts/check.sh --fast が失敗しました。修正してから完了してください。" >&2
  tail -n 60 <<<"$out" >&2
  exit 2
fi
exit 0
