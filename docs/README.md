# Modelith ドキュメント

このディレクトリは、将来公開するドキュメントサイトの原稿を兼ねる。
読者と目的ごとに置き場所を分け（[Diátaxis](https://diataxis.fr/) の 4 分類）、公開時はこの構成をそのままサイトの目次にする。

## 構成

| ディレクトリ | 種類 | 内容 | 主な読者 |
| --- | --- | --- | --- |
| `tutorials/` | チュートリアル | 初めての人が手を動かして学ぶ（例: 最初のモデルを作る） | 利用者 |
| `how-to/` | ハウツー | 目的を達成する手順（例: draw.io に書き出す、プラグインを作る） | 利用者・プラグイン作者 |
| `reference/` | リファレンス | 仕様の正確な記述（バージョン規則、ファイル形式、CLI、プラグイン API） | 全員 |
| `explanation/` | 解説 | 背景と考え方（アーキテクチャ、設計の理由） | 全員 |
| `adr/` | 設計判断の記録 | なぜそう決めたか（ADR） | 開発者 |
| `development/` | 開発者向け | ブランチ戦略、リリース手順など、本体の開発に参加する人向け | 開発者 |

中身が無い分類のディレクトリは作らない。最初の文書を書くときに作る。

## 現在の文書

- リファレンス
  - [要求仕様（SysML v2、唯一の定義元）](reference/requirements.sysml)
  - [バージョン規則](reference/versioning.md)
  - [チェックルール（v0 のプラグイン）と modelith check](reference/check-rules.md)
- 解説
  - [アーキテクチャ概要](explanation/architecture.md)
- 開発者向け
  - [ブランチ戦略](development/branching-strategy.md)
  - [リリース手順](development/releasing.md)
  - [リリース計画（0.1.0）](development/release-plan.md)
  - [テスト](development/testing.md)
- [設計判断（ADR）](adr/README.md)

## API ドキュメント

API リファレンスは手書きせず、コードから生成して `reference/` から参照する。

| 対象 | 生成元 | 公開先（予定） |
| --- | --- | --- |
| Rust（`modelith-core` など） | rustdoc（doc コメント） | docs.rs、ドキュメントサイト |
| プラグイン API（Rust） | rustdoc（`modelith/plugin-sdk`） | docs.rs |
| プラグイン API（TypeScript） | TypeDoc（`@modelith/plugin-sdk`） | ドキュメントサイト |
| マニフェスト・レジストリ索引 | JSON Schema（`modelith/plugin-sdk` の `schema/`） | ドキュメントサイト |

そのため、公開 API には必ず doc コメントを書く（CLAUDE.md のコーディング規約）。

## 書き方の約束

- 1 文書 1 テーマ。リファレンスは「何が正しいか」だけを書き、手順や理由は他の分類へリンクする。
- 文書間のリンクは相対パスで書く（サイト化してもそのまま使えるように）。
- 公開を前提に、非公開の情報（モックの HTML・内蔵サンプル、内部の事情）は書かない。
