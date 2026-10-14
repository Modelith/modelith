# テスト

テストの考え方は [testing-principles](../../.claude/skills/testing-principles/SKILL.md)（ISTQB の 7 原則・単体 → 結合 → 統合・AAA）に従う。
何を確かめるべきかは [要求仕様](../reference/requirements.sysml) が決め、テストは `verification def` と、テスト名に書いた要求 ID で要求に結ぶ（ADR-0011）。

## テストの種類と置き場所

| レベル | 何を確かめるか | 置き場所 | 道具 |
| --- | --- | --- | --- |
| 単体 | 1 つの関数・モジュール（I/O なし） | `web/src/**/*.test.ts`、`web/tools/**/*.test.ts`、Rust の `#[cfg(test)]` | Vitest、cargo test |
| 結合 | モジュールの組み合わせ（コアとゴールデン、ワークスペースと偽のファイルシステム、要求仕様の検査） | 同上 | Vitest |
| 統合（e2e） | ビルドしたアプリを Chromium で操作し、要求どおりに動くか | `web/e2e/*.spec.ts` | Playwright |
| 統合（UI） | 画面の見た目が変わっていないか（基準画像との比較） | `web/e2e/visual.spec.ts` と基準画像 `visual.spec.ts-snapshots/` | Playwright |

`scripts/check.sh` がこの順に実行し、失敗した段階で止まる。CI も同じ。

## 実行

```bash
npm test --prefix web          # 単体・結合
scripts/e2e.sh                 # e2e・UI（ビルドしてから、基準のブラウザで操作する）
scripts/e2e.sh -g F-FILE       # 要求 ID でしぼる（引数は Playwright にそのまま渡す）
```

### 基準のブラウザ

画面の画素は、同じ Chromium でも OS のフォントや描画の設定で変わる（改行の位置がずれることもある）。
どこで動かしても同じ画像になるよう、`scripts/e2e.sh` はブラウザを **Playwright の公式イメージ（Docker）** の中で動かし、
テストは手元の Node から、そのブラウザにつなぐ（Playwright の `run-server`）。

- イメージの版は `web/package.json` の `@playwright/test` と同じにする（版を固定する）。Playwright を上げたら、基準画像も作り直す。
- 手元・CI・公開のワークフローは、すべて同じイメージを使う。手元で通れば CI でも通る。
- Docker が無い手元では、手元の Chromium で e2e だけを動かし、UI テストは飛ばす（見た目は CI で比べる）。CI では Docker が無ければ失敗にする。

## レポート（人が読むもの）

| レポート | 中身 | どこで見るか |
| --- | --- | --- |
| 要求別の表（`reports/requirements.html`） | システム要求ごとに、合格・失敗・単体／結合で検証・未検証 | CI のジョブのサマリ（同じ表）、CI の成果物 `test-reports`、公開版の「?」→「この版のテスト結果」 |
| Playwright のレポート（`reports/e2e/`） | テストごとの手順・最後の画面。失敗したときは操作の記録（trace）、UI テストの「基準・今回・差分」 | CI の成果物 `test-reports`、手元では `npx playwright show-report reports/e2e`（`web/` で実行） |

公開版（GitHub Pages）には、その版で実行したレポートを `reports/` に一緒に載せる。テストが失敗したら公開しない。

## e2e の書き方

- テスト名の先頭に要求 ID を書く（例: `F-FILE-2: …`。複数なら `F-EDIT-2・C-1: …`）。要求別の表はこの ID で集計する。
- 共通部品は `e2e/fixtures.ts`。ローカルフォルダは OPFS（ブラウザ内の本物のファイルシステム）で代用し、ピッカーだけを置き換える。
- 画面で例外が出たら、どのテストも失敗にする（fixtures が確かめる）。
- 待つときは `expect(...).toHave...` や `expect.poll` を使い、決め打ちの `waitForTimeout` は入力の反映待ち（0.28 秒）など理由があるときだけにする。

## UI テストの基準画像を更新する

意図して見た目を変えたときだけ更新する。

1. `scripts/e2e.sh e2e/visual.spec.ts` で、どの画面が変わったかを確かめる（レポートに差分が出る）。
2. 変化が意図どおりなら、`scripts/e2e.sh e2e/visual.spec.ts --update-snapshots=all` で基準画像を作り直す。
   変わっていない画像は、同じ内容のまま書き直されるので差分に出ない。
3. 更新した画像を PR に含め、PR の説明に「何が・なぜ変わったか」を書く。レビューでは画像の差分を確かめる。

手元に Docker が無いときは、CI で作り直す。

1. トピックブランチのコミットメッセージに `[ui-baselines]` を含めて push する。
2. ワークフロー `UI baselines` が同じ基準のブラウザで基準画像を作り、成果物 `ui-baselines` に置く。
   成果物を取れない環境（エージェントなど）のために、ログの `=====BEGIN UI BASELINES=====` から `=====END UI BASELINES=====` の間にも
   tar.gz を base64 で出す（`base64 -d | tar xz -C web/e2e` で展開できる）。
3. 展開した画像を `web/e2e/visual.spec.ts-snapshots/` に置いてコミットし、差分を確かめてから push する。
