# modelith — エージェント向け作業ガイド

SysML v2 / KerML のテキストとダイアグラムを同期編集する、プラグインで拡張可能なモデリングエディタ。
Rust のコアをブラウザ（wasm）・CLI・サーバで共有する。全体像は [docs/explanation/architecture.md](docs/explanation/architecture.md)、設計判断は [docs/adr/](docs/adr/)。
このファイルは Claude Code などの AI エージェントが最初に読む「ハーネス」の入口である。

## 完了の定義（Definition of Done）

作業完了を宣言する前に、必ず以下を満たすこと。

1. `scripts/check.sh` がグリーン（静的検査 → 単体 → 結合 → 統合の順に実行し、失敗した段階で止まる）
2. 振る舞いの変更にはテストを追加・更新している（テスト原則に従う）
3. トピックブランチ上でコミットし、Conventional Commits 形式のメッセージを付けている

`scripts/check.sh` が唯一の判定基準。CI も同じスクリプトを実行する。
独自のコマンド列で「たぶん通る」と判断しないこと。

## 原則（スキル）

コード・スクリプト・フック・テストを書く／変える／レビューするときは、必ず次のスキルに従う。いずれも**厳守**。

| スキル | 内容 |
| --- | --- |
| [programming-principles](.claude/skills/programming-principles/SKILL.md) | SOLID、テスト可能なコード（判断と I/O の分離・依存の注入）、YAGNI、可読性 |
| [testing-principles](.claude/skills/testing-principles/SKILL.md) | ISTQB の 7 原則、単体 → 結合 → 統合、同値分割・境界値・正常系／異常系、AAA パターン |
| [release](.claude/skills/release/SKILL.md) | 版を出す手順（下書きまで。公開はメンテナ）と、リリースノートの決まった形 |

スキルは「書くときの指針」であり、ハーネスで強制するのは fmt・clippy・ShellCheck・テストの成否と、関数の doc コメント（ADR-0008）。
同じ種類の違反が繰り返されたら、その時点で機械的な検査を足す。

## 守るべき設計原則

- **要求仕様の SSoT は [docs/reference/requirements.sysml](docs/reference/requirements.sysml)**（ADR-0011）。振る舞いを変えるときは実装より先に要求を更新し、
  テストを足したら `verification def` で要求に `verify` を結ぶ。要求を他の文書に書き写さない。
- **テキストが唯一の正本**（ADR-0001）。図やプラグインからの変更も `TextEdit` として表現する。
- **仕様の基準は SysML v2 仕様、次にモック**（ADR-0002・ADR-0013）。モックと仕様が食い違うときは仕様に従い、根拠（BNF の規則・章）付きのケースを `web/src/core/spec.test.ts` に書く。
  `reference/mock/` と `reference/golden/*.json` は手で編集しない。
  モックの HTML ファイルと内蔵のサンプルモデルは非公開。`reference/mock/` をコミットしたり、サンプルモデルをコード・ケース・ドキュメントに転記したりしない。
  モックのコードは `web/` へ TypeScript として移植してよい（ADR-0009）。移植した暫定コアは `web/src/core/` に閉じ込める。
  モックと同じ振る舞いを確かめるケースは `reference/golden/cases/` に足し、`node reference/tools/gen-golden.mjs` で再生成する。
- **画面の言葉は、SysML v2 の構文を知らない人に合わせる**（ADR-0014）。トースト・ダイアログ・案内などの文言は [画面の言葉の手引き](docs/development/ui-writing.md) に従う。
- **プラグインとの契約は plugin-sdk に置く**（ADR-0004）。本リポジトリでプラグイン向けの型を独自に定義しない。
- ADR に反する変更が必要なら、実装より先に ADR を追加・更新する PR を出す。

## ブランチとコミット

詳細は [docs/development/branching-strategy.md](docs/development/branching-strategy.md)。要点のみ:

- 作業ブランチは `dev` から作り、PR は `dev` に向ける（GitHub の既定ブランチは `dev`。PR 作成時も base を `dev` と明示する）。`main` / `dev` へ直接 commit / push しない（フックでブロックされる）
- ブランチ名: `<type>/<topic>`（type: feat|fix|refactor|docs|test|perf|ci|chore|claude）
- コミット / PR タイトル: `<type>(<scope>): <summary>`（Conventional Commits）
- 1 ブランチ 1 目的。依頼範囲外のリファクタや整形を混ぜない
- PR の中は、1 つずつ読めるコミットに分ける（1 コミット 1 変更、層をまたぐ変更は下の層から順に、テストは同じコミットに、どのコミットでもテストが通る）。詳細は branching-strategy の「PR の中のコミットの分け方」
- force-push 禁止。他人のブランチの履歴を書き換えない
- **トピック → `dev` は許可なしでマージしてよい。** 条件は CI（`check` / `conventions`）がグリーンで、未解決のレビューコメントがないこと。方式は Squash
- **`main` へのマージ（PR のマージ、auto-merge の有効化を含む）はメンテナの明示的な許可を得てから行う。**
  `dev` → `main` はマイルストーン（リリース）ごと、方式はマージコミット。許可は PR ごとに取り、過去の許可や他の PR への許可を流用しない
- ステージはパスを明示する（`git add -A` / `.` はフックでブロックされる）。非公開のモック・`node_modules`・`target` はコミットしない

## コマンド

| 目的 | コマンド |
| --- | --- |
| フルチェック（完了前に必須） | `scripts/check.sh` |
| 高速チェック | `scripts/check.sh --fast` |
| 単体テスト絞り込み | `cargo test -p <crate> <name>` |
| ハーネスのテスト | `tests/harness/node_modules/.bin/bats tests/harness/{unit,integration}` |
| web のテスト | `npm test --prefix web`（単体・結合。パーサのテストは TS と Rust の両方で動く）、`scripts/e2e.sh`（統合・UI。ブラウザは Docker の公式イメージで動かす。テスト名に要求 ID を書く） |
| wasm のビルド（web のテスト・アプリの前に必要） | `scripts/build-wasm.sh` |
| ゴールデン再生成 | `node reference/tools/gen-golden.mjs` |
| リリースの準備（版の書き換えとノートのひな形） | `scripts/release-prepare.sh <版>`（リリースノートの検査は `node web/tools/release-notes-cli.ts check [<版>]`） |
| PR タイトル検証 | `scripts/check-pr-title.sh "<title>"` |
| PR 向け先検証 | `scripts/check-pr-base.sh <base> <head>` |

## ハーネス（自動で動くもの）

構成: 判断は `scripts/lib/policy.sh`（純粋関数）、入出力は `scripts/lib/hook-io.sh`、リポジトリ固有の値は `scripts/harness.conf`。
フックと `scripts/check-*.sh` は「入力を集める → policy で判断 → 結果を返す」だけの薄いアダプタ。
`scripts/lib/`・フック・`check-pr-*.sh`・`check-forbidden-files.sh` は plugin-sdk と同じ内容を保つ（固有の値は書かない）。

`.claude/settings.json` に定義。

| タイミング | フック | 役割 |
| --- | --- | --- |
| セッション開始 | `session-start.sh` | ツールチェーン・npm 依存・shellcheck を用意し、現在ブランチと作業ルールを通知 |
| Bash 実行前 | `guard-git.sh` | main / dev への push・その上での commit・force-push・一括ステージ・禁止ファイルのコミットをブロック |
| マージ操作前 | `guard-merge.sh` | dev 向けの Squash は許可、main 向けは毎回ユーザーの承認を求め、方式の誤りは拒否 |
| 停止前 | `verify-on-stop.sh` | コード変更があれば `check.sh --fast` を実行し、失敗なら差し戻し |

フックにブロックされたら、回避策を探さず、メッセージに従って手順を正すこと。

## コーディング規約

- Rust edition 2024 / stable ツールチェーン（`rust-toolchain.toml`）、`unsafe` 禁止
- TypeScript は `strict` + `noUncheckedIndexedAccess`
- `unwrap()` / `expect()` はテストとプロトタイプ以外で避け、エラー型で返す
- テスト以外のすべての関数に doc コメント（概要・引数・戻り値・入力と期待する出力の例）を書く。書き方は programming-principles の「関数の doc コメント」。`scripts/check.sh` が不足を検出する
- 周辺コードの命名・コメント密度・イディオムに合わせる

## ハーネスの改善

エージェントが同じ種類のミスを繰り返したら、それは指示ではなくハーネスで防ぐべきサイン。
このファイル・`scripts/`・`.claude/hooks/`・CI のいずれかに再発防止策を追加する PR（`chore(harness): ...`）を作ること。
