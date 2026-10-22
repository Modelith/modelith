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
- **目的に合わせた図** — ブロック定義図・内部ブロック図・アクティビティ図・状態遷移図・シーケンス図・トレーサビリティなど、同じモデルを見たい切り口で表示できます。SVG や draw.io 形式でエクスポートすることもできます。
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

SysML v2 のテキストの書き方のうち、よく使う部分から対応しています（**0.2.0-alpha.1 時点**、2026-10-20 に [SysML v2 の規格](https://github.com/Systems-Modeling/SysML-v2-Release) と照合）。

状況の欄は、「対応」（使える）・「一部対応」（足りないところがある）・「未対応」（まだ使えない）で表します。

| 分類 | 書き方 | 状況 | 足りないところ | 対応の予定 |
| --- | --- | --- | --- | --- |
| パッケージ | `package`（入れ子を含む）、`library package` | 対応 | ライブラリの印は記録しない | — |
| | `import`、package 直下の `filter`、可視性 `private`・`public` | 未対応 | ほかの package・ファイルの名前を `import` で取り込めない | 0.2.0 |
| 名前 | 引用名 `'Fuel Tank'`・短い名前 `<R1>`・修飾名 `A::B`・`alias` | 一部対応 | 同じファイルの中だけ解決する | 0.2.0 |
| 構造 | `part`・`item`・`attribute`・`port`・`enum`・`occurrence` の定義と使用、`event occurrence`・`timeslice`・`snapshot`・`individual` | 対応 | | |
| | 型付け `:`・特殊化 `:>`・再定義 `:>>`・参照 `::>`・多重度 `[0..4]`・値 `=`・`:=`・`default`・向き `in`・`out` | 対応 | `: A, B` は先頭の型だけ | — |
| | キーワードの無い特性 `x : Real;`・`ref r;`・交差 `=>`・`crosses`・共役ポート `~Pt` | 対応 | | |
| つながり | `connection`・`connect`（3 つ以上をつなぐ形を含む）・`interface`（`connect` を省いた形を含む）・`bind`・`allocate`・`dependency` | 対応 | | |
| | `flow`・`flow def`・`message`・`succession flow`（`from` を省いた短い形を含む） | 対応 | | |
| 振る舞い | `action`・順序 `first … then`・`fork`・`join`・`merge`・`decide`・`send`・`accept`・`assign`・`terminate`・`if`・`while`・`for` | 対応 | アクションのパラメータとその間のフローを図に描かない | 0.2.0 |
| | `state`・遷移 `transition`（トリガ・ガード・効果と省略形）・`entry`・`do`・`exit`・`parallel` | 対応 | 状態の使用の中の遷移を図に描かない | 0.3.0 以降 |
| | `perform`・`exhibit`（既存の要素を指す `perform x.y;`・`exhibit s;` を含む）、`calc`・`constraint` | 対応 | | |
| 要求と検証 | `requirement`・`subject`・`stakeholder`・`actor`・`concern`・`case`・`analysis`・`verification`・`use case`・`#derivation dependency` | 対応 | | |
| | `satisfy`（`by` の無い形・宣言する形を含む）・`frame` | 対応 | | |
| | `verify` | 一部対応 | 型の無い検証の使用の中では線を引かない | — |
| | `objective`・`assert constraint`・`assert not` | 対応 | 目的は検証・解析の区画に、制約は持ち主の区画に書く。式は計算しない | — |
| 図（ビュー） | `view`・`view def`・`expose`・`filter`（`and`・`or`・`not` などの式）・`render` | 一部対応 | メタデータの値を比べる `filter`、表や文字の形の `render` は使えない | 0.3.0 以降 |
| 注釈 | `doc`・`comment … about`（メモ）・`rep`・`metadata def`・`#M`・`metadata … about`・自分で決めたキーワード | 対応 | 関係（`dependency`・`alias`）の本体の `doc` は記録しない | — |
| 式 | 式・単位 `1500 [kg]`・`->collect{ … }` | 一部対応 | 文字列として持つだけで、計算しない | 0.3.0 以降 |
| その他 | KerML、標準ライブラリ、モデル交換の形式（`.kpar`） | 未対応 | KerML の宣言は「まだ扱えない」と知らせる | 0.3.0 以降 |

| 図の種類（SysML v2 の標準ビュー） | 状況 | 足りないところ | 対応の予定 |
| --- | --- | --- | --- |
| ブロック定義図・一般の図（GeneralView） | 一部対応 | ユースケースの楕円・アクターの記号が無い | 0.3.0 以降 |
| 内部ブロック図（InterconnectionView） | 一部対応 | 対象そのもののポート（枠の上のポート）へ、図から新しく線を引く操作が無い（テキストで書く） | 0.3.0 以降 |
| アクティビティ図（ActionFlowView） | 一部対応 | 入れ子の本体の流れと、区画（swim lane）が無い | 0.2.0 |
| 状態遷移図（StateTransitionView） | 一部対応 | 状態の使用の中の遷移と、2 つ目以降の状態定義を描かない | 0.3.0 以降 |
| シーケンス図（SequenceView） | 一部対応 | 分岐や繰り返しの枠（`alt`・`loop`）が無く、図からイベントや順序を足せない | 0.3.0 以降 |
| ジオメトリ・グリッド・ブラウザ（GeometryView・GridView・BrowserView） | 未対応 | 一般の図で代わりに描き、そのことを知らせる | 0.3.0 以降 |

書き方ごとの詳しい状況は [対応表](docs/reference/sysml-conformance.md) にあります。予定は利用者の声に合わせて入れ替えることがあります。必要な書き方があれば、[Issues](https://github.com/modelith/modelith/issues/new/choose) でお知らせください。

## ロードマップ

いまは **0.1.0 に向けた beta 版**です。機能は固定し、0.1.0 までは不具合の修正だけを行います。テストユーザーの声をもとに育てているので、気になる振る舞いがあればお知らせください。

| 版 | 内容 |
| --- | --- |
| 0.1.0 | 正式版 |
| 0.2.0 | 図を作る・画面で編集・線の調整・エクスポートの強化と、要求図・ブロック定義図・内部ブロック図・アクティビティ図の不足を埋める。`import` と複数のファイルにまたがるモデルは進み具合を見て決める |
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
| [SECURITY.md](SECURITY.md) | セキュリティの問題を見つけたときの、非公開の報告の仕方 |

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
