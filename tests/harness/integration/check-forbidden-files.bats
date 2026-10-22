#!/usr/bin/env bats
# scripts/check-forbidden-files.sh の結合テスト（実際の Git インデックスを検査する）。

load check-clis

@test "check-forbidden-files: 禁止ファイルが無ければ成功する（正常系）" {
  # Arrange
  echo x >"$SANDBOX/a.txt" && git -C "$SANDBOX" add a.txt
  # Act
  run "$SANDBOX/scripts/check-forbidden-files.sh"
  # Assert
  [ "$status" -eq 0 ]
}

@test "check-forbidden-files: 管理下の禁止ファイルを列挙して失敗する（異常系）" {
  # Arrange
  mkdir -p "$SANDBOX/web/node_modules" && echo x >"$SANDBOX/web/node_modules/m.js"
  git -C "$SANDBOX" add -f web/node_modules/m.js
  # Act
  run --separate-stderr "$SANDBOX/scripts/check-forbidden-files.sh"
  # Assert
  [ "$status" -eq 1 ]
  [[ $stderr == *"web/node_modules/m.js"* ]]
}
