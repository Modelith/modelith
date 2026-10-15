<p align="center">
  <img src="https://raw.githubusercontent.com/modelith/.github/main/profile/logo.svg" width="88" height="88" alt="Modelith">
</p>

<h1 align="center">Modelith</h1>

<p align="center">
  <b>テキストと図を同期して編集できる、オープンソースの SysML v2 モデリングエディタ</b><br>
  <sub>SysML v2 / KerML modeling editor with synchronized text and diagram editing</sub>
</p>

<p align="center">
  <a href="https://modelith.github.io/modelith/"><b>ブラウザで試す</b></a> &nbsp;|&nbsp;
  <a href="https://github.com/modelith/modelith/releases">リリース</a> &nbsp;|&nbsp;
  <a href="https://modelith.github.io/modelith/reports/requirements.html">テスト結果</a> &nbsp;|&nbsp;
  <a href="https://github.com/modelith/modelith/issues/new/choose">フィードバック</a>
</p>

<p align="center">
  <a href="https://github.com/modelith/modelith/releases"><img src="https://img.shields.io/github/v/release/modelith/modelith?include_prereleases&label=release" alt="release"></a>
  <a href="https://github.com/modelith/modelith/actions/workflows/ci.yml?query=branch%3Adev"><img src="https://github.com/modelith/modelith/actions/workflows/ci.yml/badge.svg?branch=dev" alt="CI"></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-AGPL--3.0%20%2B%20Plugin%20Exception-blue" alt="license"></a>
</p>

<p align="center">
  <a href="https://modelith.github.io/modelith/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/modelith/.github/main/profile/screenshot-dark.png">
      <img src="https://raw.githubusercontent.com/modelith/.github/main/profile/screenshot.png" width="800" alt="Modelith の画面。左にファイル、中央にトレーサビリティの図、右に SysML v2 のテキスト">
    </picture>
  </a>
</p>

## Modelith とは

システムエンジニア・学生・研究者のための、SysML v2 のモデリングエディタです。
テキストで書いたモデルがすぐ図になり、図で動かした内容はテキストに書き戻されます。

- **書いても、描いても、同じモデル** — テキストを打てば図に反映し、図で要素や関係を足せばテキストが書き換わります。
- **目的に合わせた 7 つのビュー** — トレーサビリティ・構造・制御ループ・内部ブロック図・振る舞い・シーケンスなど、同じモデルを見たい切り口で表示できます。SVG や draw.io 形式にも書き出せます。
- **要求の抜けに気づける** — 利用者要求から方式設計・検証までのつながりをたどり、導出・充足・検証の抜けを示します。
- **ブラウザを開くだけ** — インストールもアカウントも不要です。手元のフォルダを VS Code のように開いて、編集・保存できます。
- **モデルは手元から出ない** — モデルを外部に送信せず、アクセス解析も使いません。モデルはただのテキストファイルなので、Git で差分を追えます。

## 使ってみる

**<https://modelith.github.io/modelith/>** をブラウザで開くと、サンプルのモデル（電気ケトル）が表示されます。

| ブラウザ | できること |
| --- | --- |
| Chrome・Edge | フォルダを開いて、ファイルを直接編集・上書き保存 |
| Safari・Firefox | ファイルの読み込みと、ダウンロードでの保存 |

## 開発状況

いまは **0.1.0 に向けた alpha 版**です。おおむね 1 週間ごとに alpha を公開し、テストユーザーの声をもとに育てています。
操作方法や保存形式は、予告なく変わることがあります。

- 各版の変更点：[リリース](https://github.com/modelith/modelith/releases)
- 0.1.0 までの予定：[リリース計画](docs/development/release-plan.md)
- SysML v2 仕様への対応状況：[対応表](docs/reference/sysml-conformance.md)

0.1.0 の先は、CLI・MCP・LSP・プラグイン・サーバへと広げていく予定です（[アーキテクチャ](docs/explanation/architecture.md)）。

## 開発に参加する

使ってみた感想や「こんな図がほしい」は、[Issues](https://github.com/modelith/modelith/issues/new/choose) にお寄せください。
コードで貢献するときは、[CONTRIBUTING.md](CONTRIBUTING.md)（CLA を含む）を先にお読みください。

### 手元で動かす

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

### 構成

```
crates/modelith-core   Rust のコア（SysML v2 のパーサ。ブラウザ・CLI・サーバで共有する）
crates/modelith-wasm   ブラウザ向けの wasm
crates/modelith-cli    modelith コマンド（準備中）
web/                   Web アプリ（TypeScript + Vite）
docs/                  文書（要求仕様・設計判断・開発の手順）
```

### 文書

| 文書 | 内容 |
| --- | --- |
| [要求仕様](docs/reference/requirements.sysml) | 何を作るか。SysML v2 で書いた唯一の定義元 |
| [設計判断（ADR）](docs/adr/) | なぜそう作るか |
| [アーキテクチャ](docs/explanation/architecture.md) | 全体の構成と、この先の段階 |
| [ブランチ戦略](docs/development/branching-strategy.md)・[テスト](docs/development/testing.md)・[リリース手順](docs/development/releasing.md) | 開発の進め方 |
| [画面の言葉の手引き](docs/development/ui-writing.md) | 画面の文言の書き方 |
| [CLAUDE.md](CLAUDE.md) | AI エージェント向けの作業ガイド |

### 関連リポジトリ

| リポジトリ | 内容 | ライセンス |
| --- | --- | --- |
| [modelith](https://github.com/modelith/modelith) | エディタ本体（Rust コア・Web アプリ・CLI） | AGPL-3.0 + [Plugin Exception](PLUGIN-EXCEPTION.md) |
| [plugin-sdk](https://github.com/modelith/plugin-sdk) | プラグイン向けのインタフェース・型定義 | MIT |

## License

Copyright (C) 2026 The Modelith Authors

[AGPL-3.0](LICENSE) with the [Modelith Plugin Exception](PLUGIN-EXCEPTION.md).
This program is distributed WITHOUT ANY WARRANTY; see the license for details.
"The Modelith Authors" are the contributors recorded in this repository's Git history.
Third-party components bundled with the web app (fonts, Vite's runtime code, and the Rust crates compiled into the WebAssembly core) are listed with their licenses in `licenses.txt` of each build.
Plugin interfaces ([plugin-sdk](https://github.com/modelith/plugin-sdk)) are MIT licensed.

## Trademarks

SysML® and OMG® are registered trademarks, and KerML™ is a trademark, of Object Management Group, Inc.
Modelith is an independent project. It is not affiliated with or endorsed by OMG.
Modelith is based on the SysML v2 and KerML specifications, but does not claim conformance with them
(see [docs/reference/sysml-conformance.md](docs/reference/sysml-conformance.md) for what is supported).
