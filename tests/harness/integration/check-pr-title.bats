#!/usr/bin/env bats
# scripts/check-pr-title.sh の結合テスト。

load check-clis

@test "check-pr-title: 規約どおりのタイトルは OK を出す（正常系）" {
  # Arrange
  local title="feat(core): add parser"
  # Act
  run "$SANDBOX/scripts/check-pr-title.sh" "$title"
  # Assert
  [ "$status" -eq 0 ]
}

@test "check-pr-title: 規約外のタイトルは stderr に理由を出して失敗する（異常系）" {
  # Arrange
  local title="Add parser"
  # Act
  run --separate-stderr "$SANDBOX/scripts/check-pr-title.sh" "$title"
  # Assert
  [ "$status" -eq 1 ]
  [[ $stderr == "ERROR: PR タイトル"* ]]
}

@test "check-pr-title: 引数が無ければ使い方を出して失敗する（異常系: 引数なし）" {
  # Arrange
  local script="$SANDBOX/scripts/check-pr-title.sh"
  # Act
  run --separate-stderr "$script"
  # Assert
  [ "$status" -ne 0 ]
  [[ $stderr == *"usage"* ]]
}
