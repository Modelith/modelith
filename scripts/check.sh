#!/usr/bin/env bash
# ハーネスの単一エントリポイント。人間・AI エージェント・CI すべてがこれを実行する。
# テスト原則（.claude/skills/testing-principles/）に従い、静的検査 → 単体 → 結合 → 統合 の順に実行し、
# 失敗した段階で止まる。
#   scripts/check.sh          全段階
#   scripts/check.sh --fast   静的検査（軽量）と単体テストのみ（Stop フック用）
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

MODE=full
[[ ${1:-} == --fast ]] && MODE=fast
BATS=tests/harness/node_modules/.bin/bats

step() { printf '\n==> %s\n' "$*"; }

ensure_dependencies() {
  [[ -d web/node_modules ]] || npm ci --prefix web --ignore-scripts --no-audit --no-fund
  [[ -d tests/harness/node_modules ]] || npm ci --prefix tests/harness --ignore-scripts --no-audit --no-fund
  command -v shellcheck >/dev/null || { echo "ERROR: shellcheck が必要です（apt-get install shellcheck・brew install shellcheck など）" >&2; exit 1; }
}

stage_static() {
  step "[static] 禁止ファイル・ShellCheck・リリースノートの形・プラグインの型のコピー・関数の doc コメント"
  scripts/check-forbidden-files.sh
  node web/tools/release-notes-cli.ts check
  # プラグインとの契約の TypeScript の型は plugin-sdk のコピー。Cargo.toml で固定したコミットと同じかを確かめる（ADR-0004）
  node web/tools/plugin-protocol-cli.ts check
  # 関数の doc コメント（programming-principles §4、ADR-0008）。書き足し終えた領域から順に対象に加える
  node web/tools/doc-comments-cli.ts web/tools web/src crates
  shellcheck -x scripts/*.sh scripts/lib/*.sh .claude/hooks/*.sh
  step "[static] rust: fmt / $([[ $MODE == fast ]] && echo check || echo clippy)"
  cargo fmt --all -- --check
  if [[ $MODE == fast ]]; then
    cargo check --workspace --all-targets --quiet
  else
    cargo clippy --workspace --all-targets --all-features -- -D warnings
  fi
  # web の型検査とテストは、Rust のコアの wasm を使う（ADR-0015）
  step "[static] wasm build"
  scripts/build-wasm.sh
  step "[static] web: typecheck"
  npm run --prefix web -s typecheck
}

stage_unit() {
  step "[unit] harness"
  "$BATS" tests/harness/unit
  step "[unit] rust"
  cargo test --workspace --lib --bins --quiet
  step "[unit] web"
  npm run --prefix web -s test
}

stage_integration() {
  step "[integration] harness"
  "$BATS" tests/harness/integration
  step "[integration] rust（crates/*/tests）"
  if compgen -G 'crates/*/tests/*.rs' >/dev/null; then cargo test --workspace --test '*' --quiet; else echo "なし"; fi
}

stage_system() {
  step "[system] golden（モックとの一致。モックが手元に無ければスキップ）"
  node reference/tools/gen-golden.mjs --check
  step "[system] e2e・UI テスト（ビルドしたアプリを、基準のブラウザで操作する）"
  scripts/e2e.sh
}

ensure_dependencies
stage_static
stage_unit
if [[ $MODE == full ]]; then
  stage_integration
  stage_system
fi
step "OK ($MODE)"
