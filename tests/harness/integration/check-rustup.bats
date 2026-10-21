#!/usr/bin/env bats
# scripts/check-rustup.sh の結合テスト。PATH の先頭に置いた偽の rustup の出力から、終了コードと出力先を確かめる
# （版の比較の網羅は unit/policy.bats で行う）。

load check-clis

# 偽の rustup を作る: fake_rustup '<rustup --version の出力>'
fake_rustup() {
  local bin="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$bin"
  printf '#!/usr/bin/env bash\necho %q\n' "$1" >"$bin/rustup"
  chmod +x "$bin/rustup"
  PATH="$bin:$PATH"
}

@test "check-rustup: 下限以上の rustup なら OK を出す（正常系）" {
  # Arrange
  fake_rustup "rustup 1.29.2 (d8c92c676 2026-10-21)"
  # Act
  run "$SANDBOX/scripts/check-rustup.sh"
  # Assert
  [ "$status" -eq 0 ]
  [[ $output == "rustup OK: rustup 1.29.2"* ]]
}

@test "check-rustup: 古い rustup は stderr に理由を出して失敗する（異常系）" {
  # Arrange
  fake_rustup "rustup 1.28.2 (e4f3ad6f8 2025-04-28)"
  # Act
  run --separate-stderr "$SANDBOX/scripts/check-rustup.sh"
  # Assert
  [ "$status" -eq 1 ]
  [[ $stderr == "ERROR: rustup 1.28.2 は古すぎます"* ]]
}
