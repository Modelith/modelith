# shellcheck shell=bash
# check-pr-title / check-pr-base / check-forbidden-files / check-rustup の結合テストで共有する準備。
# 各 CLI は policy の薄いアダプタなので、ここでは「引数・環境変数 → 終了コード・出力先」の配線を確かめる
# （判定の網羅は unit/policy.bats で行う）。

setup() {
  bats_require_minimum_version 1.5.0
  load ../helpers
  make_sandbox
}
