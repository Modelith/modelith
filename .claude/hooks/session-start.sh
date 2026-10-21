#!/usr/bin/env bash
# SessionStart: 作業開始時にツールチェーンと依存を揃え、現在のブランチと作業ルールをエージェントに伝える。
# 準備の失敗はセッション開始を妨げない（警告だけ出す）。
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

prepare_toolchain() {
  command -v rustup >/dev/null || return 0
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

prepare_shellcheck() {
  command -v shellcheck >/dev/null && return 0
  pip install --quiet shellcheck-py >/dev/null 2>&1 || echo "警告: shellcheck を導入できませんでした"
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
