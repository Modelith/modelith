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
2. リリース用ブランチ `chore/release-vX.Y.Z-<段階>.<番号>` を `dev` から作り、バージョン番号を更新する。
   - Cargo のワークスペース（`Cargo.toml` の `[workspace.package] version`）
   - `web/package.json` の `version`
3. リリースノートを生成し、内容を確認する。
4. PR（`chore(release): vX.Y.Z-<段階>.<番号>`）を `dev` に向けて出し、CI グリーンで Squash merge する。
5. `dev` のマージコミットにタグ `vX.Y.Z-<段階>.<番号>` を打ち、GitHub Release を「プレリリース」として作る。
6. タグを push すると `.github/workflows/pages.yml` が Web アプリを GitHub Pages に公開する。公開後、画面右上の「?」でバージョンを確かめる。

## rc を出す

1. 上の 1〜4 を rc の番号で行う。
2. `dev` → `main` の PR（`chore(release): vX.Y.Z-rc.N`）を作る。**マージにはメンテナの明示的な許可が必要。** 方式はマージコミット。
3. `main` のマージコミットにタグ `vX.Y.Z-rc.N` を打ち、プレリリースとして公開する。
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

Conventional Commits の履歴から [git-cliff](https://git-cliff.org/) で生成する（設定は最初のリリース時に追加する）。
生成結果をそのまま使わず、利用者に関係する変更が伝わるように手で整える。
