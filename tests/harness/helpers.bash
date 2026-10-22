# shellcheck shell=bash
# ハーネスのテスト共通ヘルパー。各 .bats から `load ../helpers` で読み込む。

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
FIXTURES="$REPO_ROOT/tests/harness/fixtures"

# 単体テスト用: テスト用設定と判断ロジックだけを読み込む（I/O なし）。
load_policy() {
  # shellcheck source=fixtures/harness.conf
  source "$FIXTURES/harness.conf"
  # shellcheck source=../../scripts/lib/policy.sh
  source "$REPO_ROOT/scripts/lib/policy.sh"
}

# 結合・統合テスト用: 共有スクリプトとテスト用設定を持つ一時 Git リポジトリを作り、パスを SANDBOX に入れる。
make_sandbox() {
  SANDBOX="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$SANDBOX/scripts" "$SANDBOX/.claude"
  cp -R "$REPO_ROOT/scripts/lib" "$REPO_ROOT"/scripts/check-*.sh "$SANDBOX/scripts/"
  cp -R "$REPO_ROOT/.claude/hooks" "$SANDBOX/.claude/"
  cp "$FIXTURES/harness.conf" "$SANDBOX/scripts/harness.conf"
  cp "$REPO_ROOT/.shellcheckrc" "$SANDBOX/"
  git -C "$SANDBOX" init -q -b feat/sandbox
  git -C "$SANDBOX" add scripts .claude .shellcheckrc
  git -C "$SANDBOX" -c user.email=t@example.com -c user.name=t commit -q -m init
  export CLAUDE_PROJECT_DIR="$SANDBOX"
}

# フックへの入力 JSON を作る: hook_input '<jq の式>'
hook_input() {
  jq -nc "$1"
}

# コマンドの終了コードだけを出力する（bats の set -e で中断させずに異常系の結果を集めるため）。
#   status_of <command>...            標準入力は引き継がない
#   status_of_stdin <input> <command>...
status_of() {
  local s=0
  "$@" >/dev/null 2>&1 </dev/null || s=$?
  echo "$s"
}
status_of_stdin() {
  local input=$1 s=0
  shift
  "$@" >/dev/null 2>&1 <<<"$input" || s=$?
  echo "$s"
}
