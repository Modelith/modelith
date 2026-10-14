#!/usr/bin/env bash
# e2e と UI テスト（見た目）を実行する。check.sh と公開のワークフローが使う。
#   scripts/e2e.sh [Playwright の引数...]
#   例: scripts/e2e.sh e2e/visual.spec.ts --update-snapshots=all   （基準画像を作り直す）
#
# 画面の画素は、OS のフォントや描画の設定で変わる。どこで動かしても同じ画像になるよう、
# ブラウザは Playwright の公式イメージ（Docker）の中で動かし、テストはそこへつなぐ（docs/development/testing.md）。
# Docker が無い手元では、手元のブラウザで e2e だけを動かし、UI テストは飛ばす（CI では Docker を必須にする）。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if ! docker info >/dev/null 2>&1; then
  if [[ -n ${CI:-} ]]; then
    echo "ERROR: CI では、UI テストの基準のブラウザを動かすために Docker が必要です" >&2
    exit 1
  fi
  echo "注意: Docker が使えないので、UI テスト（見た目）は飛ばします。見た目は CI で比べます" >&2
  exec npm run e2e --prefix web --silent -- "$@"
fi

# イメージの版は、テストを動かす Playwright と同じにする（つなぐには版が一致している必要がある）
version=$(node -p 'require("./web/package.json").devDependencies["@playwright/test"]')
if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: web/package.json の @playwright/test は版を固定してください（今: $version）" >&2
  exit 1
fi
image="mcr.microsoft.com/playwright:v${version}-noble"
port=${PW_REFERENCE_PORT:-3123}
name="modelith-reference-browser-$$"

# Playwright のサーバは、手元の node_modules（JavaScript だけを使う）を読み取り専用で借りて動かす
docker run -d --rm --init --name "$name" --user pwuser -w /pw \
  -p "127.0.0.1:${port}:${port}" -v "$PWD/web/node_modules:/pw/node_modules:ro" \
  "$image" node node_modules/@playwright/test/cli.js run-server --port "$port" --host 0.0.0.0 >/dev/null
trap 'docker stop "$name" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 120); do
  docker logs "$name" 2>&1 | grep -q "Listening on" && break
  sleep 0.5
done
docker logs "$name" 2>&1 | grep -q "Listening on" || {
  echo "ERROR: 基準のブラウザが起動しませんでした" >&2
  docker logs "$name" >&2 || true
  exit 1
}

PW_REFERENCE_WS="ws://127.0.0.1:${port}/" npm run e2e --prefix web --silent -- "$@"
