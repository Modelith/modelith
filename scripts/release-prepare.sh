#!/usr/bin/env bash
# 版を上げる PR の準備（docs/development/releasing.md）。版を書き換え、リリースノートのひな形を作る。
#   scripts/release-prepare.sh <版>   例: scripts/release-prepare.sh 0.1.0-alpha.4
# このあと docs/releases/v<版>.md の「（ここに書く）」を埋め、release-notes-cli.ts check <版> で確かめる。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

version=${1:?使い方: scripts/release-prepare.sh <版>}
branch=$(git branch --show-current)
if [[ $branch != "chore/release-v$version" ]]; then
  echo "ERROR: dev から chore/release-v$version を作ってから実行してください（今は $branch）" >&2
  exit 1
fi

git fetch --quiet --tags origin || echo "注意: タグを取得できませんでした。前の版はノートのファイルから選びます" >&2
sed -i -E "0,/^version = \".*\"$/s//version = \"$version\"/" Cargo.toml
cargo update --workspace --quiet
npm version "$version" --no-git-tag-version --prefix web >/dev/null
node web/tools/release-notes-cli.ts new "$version"
echo "版を $version にしました（Cargo.toml・Cargo.lock・web/package.json・web/package-lock.json）"
