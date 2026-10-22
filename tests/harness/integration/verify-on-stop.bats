#!/usr/bin/env bats
# .claude/hooks/verify-on-stop.sh の結合テスト。check.sh はスタブに置き換える。

setup() {
  bats_require_minimum_version 1.5.0
  load ../helpers
  make_sandbox
  HOOK="$SANDBOX/.claude/hooks/verify-on-stop.sh"
}

# スタブの check.sh を置く: stub_check <exit_code>
stub_check() {
  printf '#!/usr/bin/env bash\necho "stub check: $*"\nexit %s\n' "$1" >"$SANDBOX/scripts/check.sh"
  chmod +x "$SANDBOX/scripts/check.sh"
  git -C "$SANDBOX" add scripts/check.sh
  git -C "$SANDBOX" -c user.email=t@example.com -c user.name=t commit -q -m stub
}

@test "verify-on-stop: 対象の変更が無ければチェックしない（正常系）" {
  # Arrange
  stub_check 1
  echo x >"$SANDBOX/README.md"
  # Act
  run "$HOOK" <<<'{}'
  # Assert
  [ "$status" -eq 0 ]
}

@test "verify-on-stop: 対象の変更があり、チェックが通れば停止を許可する（正常系）" {
  # Arrange
  stub_check 0
  echo 'fn main() {}' >"$SANDBOX/main.rs"
  # Act
  run "$HOOK" <<<'{}'
  # Assert
  [ "$status" -eq 0 ]
}

@test "verify-on-stop: チェックが失敗したら停止を差し戻す（異常系）" {
  # Arrange
  stub_check 1
  echo 'fn main() {}' >"$SANDBOX/main.rs"
  # Act
  run --separate-stderr "$HOOK" <<<'{}'
  # Assert
  [ "$status" -eq 2 ]
  [[ $stderr == *"stub check: --fast"* ]]
}

@test "verify-on-stop: 差し戻し後の再停止は無限ループを避けて通す（境界値）" {
  # Arrange
  stub_check 1
  echo 'fn main() {}' >"$SANDBOX/main.rs"
  # Act
  run "$HOOK" <<<'{"stop_hook_active":true}'
  # Assert
  [ "$status" -eq 0 ]
}
