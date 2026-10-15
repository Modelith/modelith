#!/usr/bin/env bash
# リリースの下書きを作る（docs/development/releasing.md）。.github/workflows/release-draft.yml が dev の先頭で実行する。
#   scripts/release-draft.sh <版>     例: scripts/release-draft.sh 0.1.0-alpha.4
#
# リリースノートは docs/releases/v<版>.md をそのまま使う。形と版の一致は release-notes-cli.ts で先に確かめる。
# まだ無ければ下書き（タグは公開したときに作られる）を作り、既にあれば本文だけを差し替える。
# 公開（Publish）は、メンテナが GitHub の画面で行う。公開すると Pages のワークフローが動く。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

version=${1:?使い方: scripts/release-draft.sh <版>}
node web/tools/release-notes-cli.ts check "$version"

tag="v$version"
notes="docs/releases/$tag.md"
existing=$(gh release list --limit 100 --json tagName,isDraft --jq ".[] | select(.tagName == \"$tag\") | .tagName")

if [[ -n $existing ]]; then
  gh release edit "$tag" --notes-file "$notes"
  echo "リリース $tag の本文を差し替えました"
else
  prerelease=()
  [[ $version == *-* ]] && prerelease=(--prerelease)
  gh release create "$tag" --draft "${prerelease[@]}" --target "$(git rev-parse HEAD)" --title "$tag" --notes-file "$notes"
  echo "リリース $tag の下書きを作りました（対象: $(git rev-parse --short HEAD)）"
fi
gh release view "$tag" --json url --jq .url
