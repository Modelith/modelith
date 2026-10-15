---
name: release
description: Modelith の版（alpha・beta・rc）を出す手順と、リリースノートの書き方。「リリースして」「alpha.N を出して」「リリースノートを書いて」と頼まれたとき、または版を上げる PR を作るときに必ず従う。公開（Publish）とタグの最終判断はメンテナが行う。
---

# リリース

手順の正本は [docs/development/releasing.md](../../../docs/development/releasing.md)。ここはエージェントが迷わないための要約と、リリースノートの書き方。

## 前提

- **リリースを始める前に、メンテナに進めてよいか確かめる。** 許可は版ごとに取り、前の版の許可を流用しない。
- エージェントにできるのは、下書きまで。タグの作成と公開は、メンテナが GitHub の画面で「Publish release」を押したときに行われる。
- alpha・beta は `dev` で出し、`main` にはマージしない。rc から先は releasing.md に従い、`main` へのマージは毎回メンテナの許可を取る。

## 手順（alpha・beta）

1. `dev` の CI がグリーンで、出したい変更がすべて `dev` に入っていることを確かめる。
2. `dev` から `chore/release-v<版>` を作る。
3. 版を上げる。
   - `Cargo.toml` の `[workspace.package] version`
   - `web/package.json`（`npm version <版> --no-git-tag-version --prefix web`）
   - `cargo update -w`
4. リリースノートのひな形を作る：`node web/tools/release-notes-cli.ts new <版>`。`docs/releases/v<版>.md` ができる。
5. 「（ここに書く）」を、下の「書き方」に従って埋める。
6. `node web/tools/release-notes-cli.ts check <版>` で、形と版の一致を確かめる。`scripts/check.sh` も通す。
7. PR `chore(release): v<版>` を `dev` に向けて出す。本文にはリリースノートの全文を入れ、CI グリーンで Squash merge する。
8. 「Release draft」ワークフローを、`version` に版を渡して起動する（`actions_run_trigger`、`workflow_id: release-draft.yml`、`ref: dev`、inputs は `version` と `branch: dev`）。
   下書きが、`dev` の先頭を対象に、ノートを本文にして作られる。
9. 下書きのリンクをメンテナに渡し、「Publish release」を押してもらう。リンクは `https://github.com/modelith/modelith/releases` の下書きの行から取る。
10. 公開されたら、Pages のワークフローが成功したことと、画面右上の「ヘルプ」に出る版を確かめる。リリース計画（release-plan.md）のその行に「（公開済み）」を足す PR を出す。

公開済みの版のノートを直すときは、`docs/releases/v<版>.md` を直す PR をマージしてから、同じワークフローを同じ版で起動する（本文だけを差し替える）。

## リリースノートの書き方

- **読み手は利用者。** SysML v2 の構文を知らない人にも分かる言葉で書く（ADR-0014、[画面の言葉の手引き](../../../docs/development/ui-writing.md)）。
  ADR・テスト・CI・内部の作りなど、開発者だけに関係することは書かない（それは PR とコミットに残っている）。
- **前の版のノート（`docs/releases/` の直前の版）を読んでから書き、語り口と粒度をそろえる。**
- 形（`check` で検査する）：
  1. `# Modelith <版>`
  2. この版で何が変わったかの要約を 1 段落（1〜2 文）
  3. `## 主な変更`：箇条書き。「- 項目の名前：何ができるようになったか・どう変わったか」。文末に句点を付けない
  4. `## <前の版> をお使いの方へ`（任意）：保存形式の変更や、前の版から使い方が変わる点。無ければ節ごと消す
  5. ご注意・商標・ライセンス（決まった部分。ひな形に入っているものを変えない。変えるときは `web/tools/release-notes.ts` の `FOOTER` を直す）
- 主な変更には、利用者に見える変化だけを、影響の大きい順に並べる。不具合の修正は「〜するようになりました」と、直った後の振る舞いで書く。
