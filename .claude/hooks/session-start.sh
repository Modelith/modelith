#!/usr/bin/env bash
# SessionStart: 作業開始時にツールチェーンと依存を揃え、現在のブランチと作業ルールをエージェントに伝える。
# 準備の失敗はセッション開始を妨げない（警告だけ出す）。
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

prepare_toolchain() {
  command -v rustup >/dev/null || return 0
  # 古い rustup はツールチェーンを取るときの TLS の確かめが甘い（RUSTSEC-2026-0382。1.29.2 で修正）
  rustup self update >/dev/null 2>&1 || echo "警告: rustup 自身を更新できませんでした（1.29.2 以上を使ってください）"
  rustup component add rustfmt clippy >/dev/null 2>&1 || echo "警告: rustfmt / clippy を追加できませんでした"
  rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || echo "警告: wasm32 ターゲットを追加できませんでした"
}

prepare_node_packages() {
  local dir
  for dir in web tests/harness; do
    [[ -f $dir/package-lock.json && ! -d $dir/node_modules ]] || continue
    npm ci --prefix "$dir" --ignore-scripts --no-audit --no-fund >/dev/null 2>&1 || echo "警告: $dir の npm ci に失敗しました"
  done
}

# ShellCheck の導入は OS のパッケージ（署名付き）から行う。PyPI など言語のパッケージ置き場は使わない（CONTRIBUTING の依存の決まり）
prepare_shellcheck() {
  command -v shellcheck >/dev/null && return 0
  local sudo=""
  [[ $(id -u) -ne 0 ]] && command -v sudo >/dev/null && sudo="sudo"
  if command -v apt-get >/dev/null; then
    { $sudo apt-get install -y -qq shellcheck || { $sudo apt-get update -qq && $sudo apt-get install -y -qq shellcheck; }; } >/dev/null 2>&1 && return 0
  fi
  echo "警告: shellcheck を導入できませんでした（apt-get install shellcheck・brew install shellcheck などで入れてください）"
}

announce() {
  local branch
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  echo "現在のブランチ: $branch"
  [[ $branch == main || $branch == dev ]] &&
    echo "注意: $branch 上にいます。変更前に 'git switch dev && git switch -c <type>/<topic>' でブランチを作成してください。"
  echo "PR の向け先は dev（PR 作成時に base を明示する）。トピック → dev は CI グリーンなら Squash で自分でマージしてよい。main へのマージはメンテナの許可が必要。"
  echo "コードとテストは .claude/skills/programming-principles と testing-principles に従う。完了条件: scripts/check.sh がグリーン。"
}

prepare_toolchain
prepare_node_packages
prepare_shellcheck
announce
exit 0
