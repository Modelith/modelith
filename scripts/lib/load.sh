# shellcheck shell=bash
# 共有スクリプトの読み込み口。リポジトリルートを決め、設定（harness.conf）と判断ロジック（policy.sh）、
# 必要なアダプタを読み込む。
#   harness_load            設定と policy のみ
#   harness_load hook-io    加えてフック用の入出力アダプタ

harness_load() {
  HARNESS_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
  # shellcheck source=../harness.conf
  source "$HARNESS_ROOT/scripts/harness.conf"
  # shellcheck source=policy.sh
  source "$HARNESS_ROOT/scripts/lib/policy.sh"
  local adapter
  for adapter in "$@"; do
    # shellcheck source=/dev/null
    source "$HARNESS_ROOT/scripts/lib/$adapter.sh"
  done
}
