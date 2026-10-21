# Contributing to Modelith

## ライセンスと CLA

- 本体は [AGPL-3.0](LICENSE) に [プラグイン例外](PLUGIN-EXCEPTION.md) を付けて提供しています。
- 初めて PR を送る際に **CLA（Contributor License Agreement）への同意**が必要です。
  PR 上で案内が表示されたら手順に従ってください。（CLA 本文と署名の仕組みは準備中です。ADR-0006 参照）

## 開発の流れ

- ブランチ戦略: [docs/development/branching-strategy.md](docs/development/branching-strategy.md)
- 設計判断: [docs/adr/](docs/adr/)
- 完了前に `scripts/check.sh` がグリーンであることを確認してください。CI も同じスクリプトを実行します。

## 必要なツール

- Rust stable（`rust-toolchain.toml` で wasm32 ターゲットごと自動導入）
- Node.js 22 の最新（`.nvmrc`。CI は毎回最新の 22.x を使う）

## 手元で動かす

必要なもの：Rust（stable。`rust-toolchain.toml` が wasm32 ターゲットごと入れる）、Node.js 22、UI テストを動かすなら Docker。

```bash
git clone https://github.com/modelith/modelith.git
cd modelith
npm ci --prefix web
scripts/build-wasm.sh          # Rust のコアを wasm にする（web の前に必要）
npm run dev --prefix web       # http://localhost:5173/ で開く
```

```bash
scripts/check.sh               # 静的検査 → 単体 → 結合 → 統合（CI と同じ。PR の前に必ず通す）
scripts/check.sh --fast        # 静的検査と単体テストだけ
```

## 依存の追加・更新

サプライチェーン攻撃（乗っ取られたパッケージの版の配布）から守るための決まりです。

- lockfile（`Cargo.lock`・`package-lock.json`）をコミットする。npm の依存は `npm ci` で入れる（`npm install` は依存を変えるときだけ）。
- インストール時のスクリプト（`postinstall` など）は動かさない。lockfile のあるフォルダの `.npmrc` に `ignore-scripts=true` を置き、CI も `npm ci --ignore-scripts` で入れる。
- 公開から 7 日たっていない版は入れない（Dependabot の `cooldown` も 7 日）。急ぎのセキュリティ修正は除く。
- Python のパッケージには依存しない。
- CI の `audit` が、既知の脆弱性（RustSec・npm）と npm の署名・来歴（`npm audit signatures`）を確かめる。

## 構成

```
crates/modelith-core   Rust のコア（SysML v2 のパーサ。ブラウザ・CLI・サーバで共有する）
crates/modelith-wasm   ブラウザ向けの wasm
crates/modelith-cli    modelith コマンド（準備中）
web/                   Web アプリ（TypeScript + Vite）
docs/                  文書（要求仕様・設計判断・開発の手順）
```

## 開発者向けの文書

| 文書 | 内容 |
| --- | --- |
| [要求仕様](docs/reference/requirements.sysml) | 何を作るか。SysML v2 で書いた唯一の定義元 |
| [設計判断（ADR）](docs/adr/) | なぜそう作るか |
| [アーキテクチャ](docs/explanation/architecture.md) | 全体の構成と、この先の段階 |
| [ブランチ戦略](docs/development/branching-strategy.md)・[テスト](docs/development/testing.md)・[リリース手順](docs/development/releasing.md) | 開発の進め方 |
| [画面の言葉の手引き](docs/development/ui-writing.md) | 画面の文言の書き方 |
| [CLAUDE.md](CLAUDE.md) | AI エージェント向けの作業ガイド |
