#!/usr/bin/env bash
# GitHub Pages に置くサイトを作る（ADR-0020）。安定版を <base>、プレリリース版を <base>preview/ に置く。
#   scripts/pages-build.sh <安定版のタグ> <プレリリース版のタグ> <出力先> <base>
#   例: scripts/pages-build.sh v0.1.0-rc.1 v0.2.0-alpha.2 site /modelith/
# 版のタグはどちらも空でよい（その系列は置かない）。版ごとに、そのタグの中身で e2e・UI テストを流し、
# 失敗したら公開しない。テストのレポートも、その版の reports/ に置く。
# テストが落ちたときは、原因を追えるように、その版の結果（失敗時の画面・差分画像・トレース・レポート）を
# pages-test-results/<系列>/ に残す（ワークフローがアーティファクトとして上げる）。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

stable=${1:-}
preview=${2:-}
out=${3:?出力先を渡してください}
base=${4:?base（/modelith/ など）を渡してください}
failed_results="$PWD/pages-test-results"

# 1 つの版を、そのタグの作業ツリーでテストしてビルドし、出力先の dest に写す
build_one() {
  local tag=$1 dest=$2 path=$3 channel=$4 dir
  dir=$(mktemp -d)
  git worktree add --detach "$dir" "$tag"
  (
    cd "$dir"
    npm ci --prefix web --ignore-scripts --no-audit --no-fund
    if ! scripts/e2e.sh; then
      mkdir -p "$failed_results/$channel"
      cp -r web/test-results web/reports "$failed_results/$channel/" 2>/dev/null || true
      echo "$channel（$tag）のテストが落ちたため公開しません。結果は pages-test-results/$channel/ にあります" >&2
      exit 1
    fi
    MODELITH_BASE=$path MODELITH_CHANNEL=$channel npm run build --prefix web
    cp -r web/reports web/dist/reports
    # reports/e2e/ の画面は Playwright（Apache-2.0）の配布物なので、LICENSE と NOTICE を添える（C-5）
    cp web/node_modules/playwright-core/{LICENSE,NOTICE,ThirdPartyNotices.txt} web/dist/reports/e2e/
  )
  mkdir -p "$dest"
  cp -r "$dir/web/dist/." "$dest/"
  git worktree remove --force "$dir"
}

rm -rf "$out" "$failed_results"
mkdir -p "$out"
if [[ -n $stable ]]; then build_one "$stable" "$out" "$base" stable; fi
if [[ -n $preview ]]; then build_one "$preview" "$out/preview" "${base}preview/" preview; fi
if [[ -z $stable && -z $preview ]]; then
  echo "公開できる版がありません" >&2
  exit 1
fi
