#!/usr/bin/env bash
# リリースの下書きを作る（docs/development/releasing.md）。.github/workflows/release-draft.yml が実行する。
#   scripts/release-draft.sh --auto   版を上げた PR がマージされたとき（push）。Cargo.toml の版のノートがあり、
#                                     その版のリリースがまだ無ければ下書きを作る。それ以外は何もしない
#   scripts/release-draft.sh <版>     手で起動したとき。下書きが無ければ作り、あれば本文だけを差し替える
#
# リリースノートは docs/releases/v<版>.md をそのまま使う。形と版の一致は release-notes-cli.ts で先に確かめる。
# 下書きのタグは、公開（Publish）したときに作られる。公開はメンテナが GitHub の画面で行い、公開すると Pages のワークフローが動く。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

arg=${1:?使い方: scripts/release-draft.sh --auto | <版>}
version=$arg
[[ $arg == --auto ]] && version=$(node web/tools/release-notes-cli.ts current)
tag="v$version"
notes="docs/releases/$tag.md"

if [[ $arg == --auto && ! -f $notes ]]; then
  echo "$notes が無いので、下書きは作りません（版を上げる PR ではない）"
  exit 0
fi
# alpha・beta は dev で、rc と正式版は main で出す（releasing.md の「段階とブランチの対応」）
branch=${GITHUB_REF_NAME:-$(git branch --show-current)}
expected=dev
[[ $version == *-* && $version != *-rc.* ]] || expected=main
if [[ $arg == --auto && $branch != "$expected" ]]; then
  echo "$version は $expected で出す版なので、$branch では下書きを作りません"
  exit 0
fi
node web/tools/release-notes-cli.ts check "$version"

existing=$(gh release list --limit 100 --json tagName --jq ".[] | select(.tagName == \"$tag\") | .tagName")
if [[ -n $existing && $arg == --auto ]]; then
  echo "リリース $tag は既にあります。本文を差し替えるときは、版を渡して手で起動してください"
  exit 0
elif [[ -n $existing ]]; then
  gh release edit "$tag" --notes-file "$notes"
  echo "リリース $tag の本文を差し替えました"
else
  prerelease=()
  [[ $version == *-* ]] && prerelease=(--prerelease)
  gh release create "$tag" --draft "${prerelease[@]}" --target "$(git rev-parse HEAD)" --title "$tag" --notes-file "$notes"
  echo "リリース $tag の下書きを作りました（対象: $(git rev-parse --short HEAD)）"
fi
# 下書きは、タグからは引けないので一覧から探す
gh api "repos/{owner}/{repo}/releases" --jq ".[] | select(.tag_name == \"$tag\") | \"下書き・リリースのページ: \" + .html_url"
