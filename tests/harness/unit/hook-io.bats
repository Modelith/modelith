#!/usr/bin/env bats
# scripts/lib/hook-io.sh の単体テスト（フック規約の入出力アダプタ）。

setup() {
  bats_require_minimum_version 1.5.0
  load ../helpers
  # shellcheck source=../../../scripts/lib/hook-io.sh
  source "$REPO_ROOT/scripts/lib/hook-io.sh"
}

@test "hook_field: 入力 JSON から値を取り出す（正常系）" {
  # Arrange
  hook_read_input <<<'{"tool_input":{"command":"git status"}}'
  # Act
  run hook_field .tool_input.command
  # Assert
  [ "$output" = "git status" ]
}

@test "hook_field: 無いキーは空文字を返す（境界値）" {
  # Arrange
  hook_read_input <<<'{}'
  # Act
  run hook_field .tool_input.command
  # Assert
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "hook_block: 終了コード 2 で理由と参照先を stderr に出す（異常系）" {
  # Arrange
  HARNESS_STRATEGY_DOC=docs/strategy.md
  # Act
  run --separate-stderr hook_block "だめです"
  # Assert
  [ "$status" -eq 2 ]
  [ "$stderr" = $'BLOCKED: だめです\n参照: docs/strategy.md' ]
}

@test "hook_decide: PreToolUse の判定 JSON を出力する（正常系）" {
  # Arrange
  local decision=ask reason=確認してください
  # Act
  run hook_decide "$decision" "$reason"
  # Assert
  [ "$status" -eq 0 ]
  [ "$(jq -r '.hookSpecificOutput | "\(.hookEventName) \(.permissionDecision) \(.permissionDecisionReason)"' <<<"$output")" = "PreToolUse ask 確認してください" ]
}
