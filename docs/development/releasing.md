# リリース手順

[バージョン規則](../reference/versioning.md) と [ブランチ戦略](branching-strategy.md) に基づく、リリースの具体的な手順。

## 段階とブランチの対応

| 段階 | タグを打つブランチ | `main` へのマージ |
| --- | --- | --- |
| alpha・beta | `dev` | しない |
| rc | `main`（`dev` → `main` をマージしてから） | 必要（メンテナの許可） |
| 正式版 | `main`（最後の rc と同じコミット） | rc で済んでいる |

## alpha・beta を出す

1. `dev` が CI グリーンであることを確認する。
2. `dev` から `chore/release-v<版>` を作り、`scripts/release-prepare.sh <版>` を実行する。
   版（`Cargo.toml`・`web/package.json` とそれぞれのロックファイル）を書き換え、リリースノートのひな形 `docs/releases/v<版>.md` を作る。
3. リリースノートの「（ここに書く）」を埋め（下の「リリースノート」）、`node web/tools/release-notes-cli.ts check <版>` で確かめる。
4. PR（`chore(release): v<版>`）を `dev` に向けて出し、CI グリーンで Squash merge する。
   マージすると「Release draft」ワークフローが動き、`dev` のマージコミットを対象に、リリースの下書き（プレリリース）を作る。
5. メンテナが下書きを確かめ、「Publish release」を押す。このときタグ `v<版>` が作られ、`.github/workflows/pages.yml` が Web アプリを GitHub Pages に公開する。
6. 公開後、画面右上の「ヘルプ」でバージョンを確かめ、[リリース計画](release-plan.md) のその行に「（公開済み）」を足す。

エージェントは 1〜4 と 6 を行い、5 の公開だけをメンテナに頼む（[release スキル](../../.claude/skills/release/SKILL.md)）。

## rc を出す

1. 上の 1〜4 を rc の番号で行う（`dev` へのマージでは下書きは作られない）。
2. `dev` → `main` の PR（`chore(release): v<版>`）を作る。**マージにはメンテナの明示的な許可が必要。** 方式はマージコミット。
   マージすると、`main` のマージコミットを対象に下書きが作られる。
3. メンテナが下書きを公開する。
4. 不具合が見つかったら `dev` で修正し、rc の番号を上げて 1 からやり直す。

## GitHub Pages の初期設定（一度だけ）

- Settings → Pages → Build and deployment の Source を **GitHub Actions** にする。
- Settings → Environments → `github-pages` → Deployment branches and tags に、タグのルール `v*` を追加する（既定では既定ブランチからしか公開できないため）。

## 正式版を出す

1. 最後の rc で、一定期間（目安 1 週間）重大な報告がないことを確認する。
2. バージョンから段階の接尾辞を外す変更を、上の手順で `dev` → `main` に入れる。
3. `main` にタグ `vX.Y.Z` を打ち、GitHub Release を通常のリリースとして公開する。

## 緊急修正

[ブランチ戦略の緊急修正](branching-strategy.md#緊急修正hotfix) に従い、`main` に `fix/*` を入れて PATCH を上げ、タグ `vX.Y.(Z+1)` を打つ。直後に `main` → `dev` を同期する。

## リリースノート

版ごとに `docs/releases/v<版>.md` に置き、GitHub のリリースの本文にそのまま使う。読み手は利用者で、形は決めてある。

1. `# Modelith <版>`
2. この版で何が変わったかの要約（1 段落）
3. `## 主な変更`：「- 項目の名前：何ができるようになったか」の箇条書き
4. `## <前の版> をお使いの方へ`（任意）：保存形式の変更など、前の版から移る人への注意
5. ご注意・商標・ライセンス（決まった部分。`web/tools/release-notes.ts` の `FOOTER`）

形は `scripts/check.sh` が検査する（`release-notes-cli.ts check`）。書き方の細則は [release スキル](../../.claude/skills/release/SKILL.md)。
公開済みの版の本文を直すときは、ファイルを直す PR をマージしてから「Release draft」を版を渡して手で起動する（本文だけを差し替える）。
