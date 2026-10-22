#!/usr/bin/env bats
# scripts/check-pr-base.sh の結合テスト。

load check-clis

@test "check-pr-base: dev 向けの PR は OK を出す（正常系）" {
  # Arrange
  local base=dev head=feat/x
  # Act
  run "$SANDBOX/scripts/check-pr-base.sh" "$base" "$head"
  # Assert
  [ "$status" -eq 0 ]
}

@test "check-pr-base: トピック → main は失敗する（異常系）" {
  # Arrange
  local base=main head=feat/x
  # Act
  run --separate-stderr "$SANDBOX/scripts/check-pr-base.sh" "$base" "$head"
  # Assert
  [ "$status" -eq 1 ]
  [[ $stderr == "ERROR:"* ]]
}

@test "check-pr-base: 引数が 1 つしか無ければ失敗する（境界値: 引数不足）" {
  # Arrange
  local base=main
  # Act
  run --separate-stderr "$SANDBOX/scripts/check-pr-base.sh" "$base"
  # Assert
  [ "$status" -ne 0 ]
  [[ $stderr == *"usage"* ]]
}
