#!/usr/bin/env bats
# scripts/lib/load.sh の結合テスト（リポジトリの配置から設定とアダプタを読み込む）。

setup() {
  load ../helpers
  make_sandbox
}

@test "harness_load: CLAUDE_PROJECT_DIR の設定と policy を読み込む（正常系）" {
  # Arrange
  source "$SANDBOX/scripts/lib/load.sh"
  # Act
  harness_load
  # Assert
  [ "$HARNESS_ROOT" = "$SANDBOX" ]
  [ "$HARNESS_STRATEGY_DOC" = docs/strategy.md ]
  declare -F policy_pr_title >/dev/null
}

@test "harness_load: アダプタは指定したときだけ読み込む（インタフェース分離）" {
  # Arrange
  source "$SANDBOX/scripts/lib/load.sh"
  # Act
  harness_load
  local without; without=$(declare -F hook_field || true)
  harness_load hook-io
  local with; with=$(declare -F hook_field || true)
  # Assert
  [ -z "$without" ]
  [ "$with" = hook_field ]
}

@test "harness_load: CLAUDE_PROJECT_DIR が無ければ Git のルートを使う（境界値）" {
  # Arrange
  unset CLAUDE_PROJECT_DIR
  source "$SANDBOX/scripts/lib/load.sh"
  # Act
  cd "$SANDBOX" && harness_load
  # Assert
  [ "$HARNESS_ROOT" = "$SANDBOX" ]
}
