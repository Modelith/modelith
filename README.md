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
  <a href="https://modelith.github.io/">ユーザーマニュアル</a> &nbsp;|&nbsp;
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
- **目的に合わせた図** — ブロック定義図・内部ブロック図・アクティビティ図・状態遷移図・シーケンス図・トレーサビリティなど、同じモデルを見たい切り口で表示できます。SVG や draw.io 形式にも書き出せます。
- **要求の抜けに気づける** — 利用者要求から方式設計・検証までのつながりをたどり、導出・充足・検証の抜けを示します。
- **SysML v2 を知らなくても読める** — テキストのキーワードや図の名前にマウスを乗せると、その意味を表示します。
- **ブラウザを開くだけ** — インストールもアカウントも不要です。手元のフォルダを VS Code のように開いて、編集・保存できます。
- **モデルは手元から出ない** — モデルを外部に送信せず、アクセス解析も使いません。モデルはただのテキストファイルなので、Git で差分を追えます。

## はじめる

**<https://modelith.github.io/modelith/>** をブラウザで開くと、サンプルのモデル（電気ケトル）が表示されます。使い方は [ユーザーマニュアル](https://modelith.github.io/) をご覧ください。

| 環境 | できること |
| --- | --- |
| Chrome・Edge | フォルダを開いて、ファイルを直接編集・上書き保存 |
| Safari・Firefox | ファイルの読み込みと、ダウンロードでの保存 |
| スマホなど幅の狭い画面 | モデルを見て確かめる（テキストは読み取り専用で開き、「編集」で書き換える） |

## SysML v2 の対応状況

SysML v2 のテキストの書き方のうち、よく使う部分から対応しています（**0.1.0-alpha.9 時点**、2026-10-20 に [SysML v2 の規格](https://github.com/Systems-Modeling/SysML-v2-Release) と照合）。

| 印 | 意味 |
| --- | --- |
| ✅ | 使える |
| 🟡 | 一部だけ使える |
| ⚠️ | 書き方によっては、誤ったエラーや表示が出る（alpha.10 で直す） |
| ❌ | まだ使えない |

| 分類 | 書き方 | 状況 | 足りないところ | 対応の予定 |
| --- | --- | :---: | --- | --- |
| パッケージ | `package`（入れ子を含む）、`library package` | ✅ | ライブラリの印は記録しない | — |
| | `import`、package 直下の `filter`、可視性 `private`・`public` | ❌ | ほかの package・ファイルの名前を `import` で取り込めない | 0.2.0 |
| 名前 | 引用名 `'Fuel Tank'`・短い名前 `<R1>`・修飾名 `A::B`・`alias` | 🟡 | 同じファイルの中だけ解決する | 0.2.0 |
| 構造 | `part`・`item`・`attribute`・`port`・`enum`・`occurrence` の定義と使用、`event occurrence`・`timeslice`・`snapshot`・`individual` | ✅ | | |
| | 型付け `:`・特殊化 `:>`・再定義 `:>>`・参照 `::>`・多重度 `[0..4]`・値 `=`・`:=`・`default`・向き `in`・`out` | ✅ | `: A, B` は先頭の型だけ | — |
| | キーワードの無い特性 `x : Real;`、型の無い `ref r;`、`crosses`・`=>`、`'~Pt'` の共役ポート | ⚠️ | 捨てるか、読み違える | alpha.10 |
| つながり | `connection`・`connect`（3 つ以上をつなぐ形を含む）・`interface`・`bind`・`allocate`・`dependency` | ✅ | | |
| | `flow`・`flow def`・`message`・`succession flow` | 🟡 | `flow a to b;` など `from`・`first` の無い短い形を捨てる。定義の中の型の無い部品を端にすると「見つかりません」と出る | alpha.10 |
| 振る舞い | `action`・順序 `first … then`・`fork`・`join`・`merge`・`decide`・`send`・`accept`・`assign`・`terminate`・`if`・`while`・`for` | ✅ | アクションのパラメータとその間のフローを図に描かない | 0.3.0 以降 |
| | `state`・遷移 `transition`（トリガ・ガード・効果と省略形）・`entry`・`do`・`exit`・`parallel` | ✅ | 状態の使用の中の遷移を図に描かない | 0.3.0 以降 |
| | `perform`・`exhibit` | 🟡 | 既存の要素を指す形 `perform x.y;`・`exhibit s;` を読まない | alpha.10 |
| | `calc`・`constraint` | ⚠️ | 本体が `true`・`false`・`not` で始まると、誤った構文エラーが出る | alpha.10 |
| 要求と検証 | `requirement`・`subject`・`stakeholder`・`actor`・`concern`・`case`・`analysis`・`verification`・`use case`・`#derivation dependency` | ✅ | | |
| | `satisfy`・`verify`・`frame` | ⚠️ | 宣言する形 `satisfy requirement r : R by x;` で誤った「見つかりません」が出る。`frame c;` を読まない | alpha.10 |
| | `objective`・`assert constraint`・`assert not` | 🟡 | 中身を親の要素に入れる | 0.3.0 以降 |
| 図（ビュー） | `view`・`view def`・`expose`・`filter`（`and`・`or`・`not` などの式）・`render` | 🟡 | メタデータの値を比べる `filter`、表や文字の形の `render` は使えない | 0.3.0 以降 |
| 注釈 | `doc`・`comment … about`（メモ）・`rep`・`metadata def`・`#M`・`metadata … about`・自分で決めたキーワード | ⚠️ | `@M { :>> x = 1; }` の値と、関係の本体の `doc` を読み違える | alpha.10 |
| 式 | 式・単位 `1500 [kg]` | 🟡 | 文字列として持つだけで、計算しない。`->collect{ … }` で誤った構文エラーが出る | alpha.10・0.3.0 以降 |
| その他 | KerML、標準ライブラリ、モデル交換の形式（`.kpar`） | ❌ | KerML の宣言の中身が外に漏れて表示される | alpha.10・0.3.0 以降 |

| 図の種類（SysML v2 の標準ビュー） | 状況 | 足りないところ | 対応の予定 |
| --- | :---: | --- | --- |
| ブロック定義図・一般の図（GeneralView） | 🟡 | package 直下の使用のうち、図に出るのは `part`・`requirement` だけ。ユースケースの楕円・アクターの記号が無い | — |
| 内部ブロック図（InterconnectionView） | 🟡 | 対象そのもののポートへの線と、入れ子の部品のポートを図から作る操作が無い | — |
| アクティビティ図（ActionFlowView） | 🟡 | パラメータとその間のフロー、区画（swim lane）が無い | 0.3.0 以降 |
| 状態遷移図（StateTransitionView） | 🟡 | 状態の使用の中の遷移と、2 つ目以降の状態定義を描かない | 0.3.0 以降 |
| シーケンス図（SequenceView） | 🟡 | 分岐や繰り返しの枠（`alt`・`loop`）が無く、図からイベントや順序を足せない | 0.3.0 以降 |
| ジオメトリ・グリッド・ブラウザ（GeometryView・GridView・BrowserView） | ❌ | 一般の図で代わりに描き、そのことを知らせる | 0.3.0 以降 |

書き方ごとの詳しい状況は [対応表](docs/reference/sysml-conformance.md) にあります。予定は利用者の声に合わせて入れ替えることがあります。必要な書き方があれば、[Issues](https://github.com/modelith/modelith/issues/new/choose) でお知らせください。

## ロードマップ

いまは **0.1.0 に向けた alpha 版**です。おおむね 1 週間ごとに公開し、テストユーザーの声をもとに育てています。操作方法や保存形式は、予告なく変わることがあります。

| 版 | 内容 |
| --- | --- |
| 0.1.0-alpha.10 | 誤った表示をなくす（上の表の ⚠️） |
| 0.1.0-beta.1 | 起動時に前回の続きから始める。機能を固定し、以降は不具合の修正だけにする |
| 0.1.0 | 正式版 |
| 0.2.0 | `import` と、複数のファイルにまたがるモデル |
| 0.3.0 以降 | 式の計算と単位、KerML、標準ライブラリ、残りの図、モデル交換の形式 |

詳しくは [リリース計画](docs/development/release-plan.md)、各版の変更点は [リリース](https://github.com/modelith/modelith/releases) をご覧ください。
0.1.0 の先は、CLI・MCP・LSP・プラグイン・サーバへと広げていく予定です（[アーキテクチャ](docs/explanation/architecture.md)）。

## ドキュメント

| 文書 | 内容 |
| --- | --- |
| [ユーザーマニュアル](https://modelith.github.io/) | 使い方（画面・ファイル・図・SysML v2 の書き方入門・プラグイン） |
| [SysML v2 の対応表](docs/reference/sysml-conformance.md) | 規格の書き方ごとの対応状況 |
| [検査ルール](docs/reference/check-rules.md)・[スクリプトのプラグイン](docs/reference/script-plugins.md) | プラグインの作り方 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 開発に参加する方法（手元で動かす・構成・開発者向けの文書） |

## 開発に参加する

使ってみた感想や「こんな図がほしい」は、[Issues](https://github.com/modelith/modelith/issues/new/choose) にお寄せください。
コードで貢献するときは、[CONTRIBUTING.md](CONTRIBUTING.md)（CLA を含む）を先にお読みください。

| リポジトリ | 内容 | ライセンス |
| --- | --- | --- |
| [modelith](https://github.com/modelith/modelith) | エディタ本体（Rust コア・Web アプリ・CLI） | AGPL-3.0 + [Plugin Exception](PLUGIN-EXCEPTION.md) |
| [plugin-sdk](https://github.com/modelith/plugin-sdk) | プラグイン向けのインタフェース・型定義 | MIT |
| [modelith.github.io](https://github.com/modelith/modelith.github.io) | ユーザーマニュアル | MIT |

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
