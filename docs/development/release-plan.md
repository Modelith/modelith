# リリース計画（0.1.0）

最初のマイルストーン `0.1.0` までの進め方。バージョンの付け方は [バージョン規則](../reference/versioning.md)、
手順は [リリース手順](releasing.md) を参照。

## 目標

モックの機能（テキストと図の同期編集、7 種類のビュー）を新しい構成で提供し、テストユーザーに使ってもらいながら育てる。

| 項目 | 決定 |
| --- | --- |
| 公開先 | GitHub Pages（`https://modelith.github.io/modelith/`）。サーバを持たず、データは利用者の手元か、利用者自身のクラウドに置く |
| 独自ドメイン | 持たない。モデルは利用者がファイルとして保存するため、将来 URL が変わっても移行できる。org の Pages には第三者が書いた HTML を置かない（保存領域を共有するため） |
| 配布形態 | Web アプリ。デスクトップアプリ（Tauri）は beta 前後に要否を判断する |
| フィードバック | GitHub Issues（不具合・要望のテンプレート） |
| スプリント | 1 週間。各スプリントの終わりに alpha を 1 つ出す |

## 要求との対応

要求の中身は [要求仕様](../reference/requirements.sysml) にだけ書く（ADR-0011）。ここでは、どのリリースでどの要求を満たすかだけを示す。
最初の公開から、C-2（外部に送らない）・C-3（ソースへのリンク）と、alpha であることの表示を必ず入れる。

## スプリント

| スプリント | リリース | 内容 |
| --- | --- | --- |
| 1 | `0.1.0-alpha.1` | モックの UI とコアを TS に移植（ADR-0009）。VS Code のようなファイル操作（F-FILE-1〜11、ADR-0010）。公開サンプル、上記の表示、Pages への自動デプロイ（公開済み） |
| 2 | `0.1.0-alpha.2` | 配置ファイルの分離と、標準の view の表示・作成（ADR-0005、F-VIEW-3・6〜8、C-6）。package の無いファイルでの案内（F-EDIT-7）（公開済み） |
| 3 | `0.1.0-alpha.3` | Rust パーサ（wasm）。ゴールデンと仕様のケースを、TS と同じテストで満たす（[ADR-0015](../adr/0015-rust-parser.md)）（公開済み） |
| 4 | `0.1.0-alpha.4` | Rust のモデル構築とテキスト編集。暫定 TS コアを差し替え、コアを Worker に移す（[ADR-0016](../adr/0016-rust-model-and-worker.md)）。図に出した package を枠として描く（F-VIEW-9。package を図の要素として扱うため、モデル構築を作り直すこのスプリントで入れる）（公開済み） |
| 5 | `0.1.0-alpha.5` | プロジェクト（[ADR-0019](../adr/0019-projects.md)：`modelith.json`、F-PROJ-1・2）と、プラグインの仕組みの v0（[ADR-0018](../adr/0018-plugin-host.md)：YAML の検査ルール、画面での追加・一覧・足りないプラグインの案内、CLI の `check`。F-PLUG-1〜3・8・9）。利用者からの要望より先に入れる（メンテナの判断）（公開済み） |
| 6 | `0.1.0-alpha.6` | プラグインの仕組みの v1（ADR-0018：TypeScript のプラグインを隔離して動かす、許可、コマンド・取り込み・書き出し、「このブラウザ」に入れる。F-PLUG-4〜7）（公開済み） |
| 7 | `0.1.0-alpha.7` | SysML v2 の文法（1）：誤った表示をなくし、読める構文を増やす（下の「SysML v2 の文法への対応」）（公開済み） |
| 8 | `0.1.0-alpha.8` | SysML v2 の文法（2）：構造の関係を図に描く。最後のファイルを閉じても新しいファイルを作らない（F-FILE-14。テストユーザーの報告）（公開済み） |
| 9 | `0.1.0-alpha.9` | SysML v2 の文法（3）：振る舞いの流れを描く。テキストの語の意味を示す（F-EDIT-9）。スマホは見る・確かめる画面とし、テキストを読み取り専用で開いて「編集」で書き換え、ダブルタップで語の意味を示す（F-EDIT-10。メンテナの判断）（公開済み） |
| 10 | `0.1.0-alpha.10` | SysML v2 の文法（4）：誤った表示をなくす（下の「SysML v2 の文法への対応」。2026-10-20 に規格と照合し直して見つけたもの。メンテナの判断） |
| 11 | `0.1.0-beta.1` | 起動時に前回の続きから始める（F-FILE-13。利用者からの要望で、プラグインの仕組みの後に入れる）。暫定コアを削除し機能を固定。以降は不具合の修正のみ |
| — | `0.1.0-rc.1` → `0.1.0` | 1 週間、重大な報告がなければ正式版 |

テストユーザーの報告次第で、スプリントの内容は入れ替える。
alpha.7〜alpha.9 は、beta で機能を固定する前に、alpha で直せる文法の不足を埋めるために入れた（メンテナの判断、2026-10-19）。
alpha.10 は、alpha.9 の公開後に規格と照合し直して見つかった誤った表示（⚠）を、beta で機能を固定する前に直すために入れた（メンテナの判断、2026-10-20）。

## SysML v2 の文法への対応

[対応表](../reference/sysml-conformance.md)（2026-10-20 に Rust のコアで照合し直した）の ×・△・⚠ を、次の順に埋める。項目ごとの予定は対応表の「予定」の列に書く。

| リリース | 内容 |
| --- | --- |
| `0.1.0-alpha.7` | 誤った表示（⚠）をなくす：`rep`、`assert not constraint`・`assume constraint`、パッケージ直下の `verify`、`viewpoint` の中の `frame`、同じファイルの中の `alias` と修飾名（パッケージの階層をたどる）。まだ扱えない構文の `{ }` の中身が外に漏れないようにする。読める構文を増やす：`case`・`objective`・`actor`・`include use case`・`enum` の使用・`event occurrence`・`timeslice`・`snapshot`・`typed by`・`constant`・`variant`・`rendering`・`metadata … about`・利用者定義のキーワード（`#X def`）・`by` の無い `satisfy`・`not satisfy`・`assert satisfy`・`@M` の値の式。標準ライブラリの型名の判定を直す |
| `0.1.0-alpha.8` | 構造の関係を図に描く：特殊化・部分集合・再定義・参照の線、多重度、`:=` と `default` の区別、`dependency` の線、`comment … about`・`rep` の本文、単独の `connect`・n 項の `connect`・`bind`・`binding`、`allocation`・`allocate`、`flow def`・名前付きのフロー。GeneralView・InterconnectionView の不足を埋める |
| `0.1.0-alpha.9` | 振る舞いの流れを描く：継起（`first … then`・`succession`・`succession flow`）、`fork`・`join`・`merge`・`decide`、`send`・`accept`・`assign`・`terminate`、`if`・`while`・`for`、ActionFlowView。状態の `entry`・`do`・`exit`・`parallel`、遷移の線と省略形、StateTransitionView・SequenceView の不足。`render` の合成形、`filter` の論理式、3 段以上の特徴量の連鎖 |
| `0.1.0-alpha.10` | 誤った表示（⚠）をなくす：本体が `true`・`false`・`not` で始まる制約と計算、定義の中の型の無い部品を端にする線、`satisfy requirement r : R by x`・`verify requirement r : R` と `view def` の中の `satisfy`、`@M { :>> x = 1; }`、KerML の宣言の本体の漏れ、`crosses`（`=>`）、キーワードの無い特性（`x : Real;`）と型の無い `ref`、`flow of p : T` の運ぶもの、本体付きの式（`->collect{ … }`）、関係の本体の `doc`、`'~Pt'` の共役ポート。黙って捨てる短い書き方を読む：`from` の無い `flow`・`succession flow`、`message a to b`、`connect` の無い `interface`、参照の形の `perform x.y;`・`exhibit s;`・`frame c;` |
| `0.2.0` | パッケージやファイルをまたぐ名前の解決：`import`（フィルタ付きを含む）・別のファイルの `alias`・修飾名・可視性、`expose` で import を通した名前。「複数のファイルにまたがるモデル」（ADR-0019）とあわせて行う |
| `0.3.0` 以降 | 新しい仕組みが要るもの：式の文法と評価・単位（`filter` のメタデータの値の比較を含む）、KerML の文法、標準ライブラリの同梱、GeometryView・GridView・BrowserView、`asTextualNotation`・`asElementTable`、SequenceView の複合フラグメントと入れ子のシーケンス図、ActionFlowView のパラメータとその間のフロー・区画（swim lane）、StateTransitionView の状態の使用の中の遷移と複数の状態定義、`assert constraint`・`assert not`、モデル交換（`.kpar`） |
必要になってから作る（YAGNI）。利用者の声（Issues）が無い機能は、ここに先回りして入れない。オフライン利用（PWA）も、声が出てから判断する。

## 0.1.0 より先の方向

保存と共有は、必要になったら次の順に広げる。前の段階の仕組みを、次の段階でそのまま使う。どの段階も、今は着手しない。

| 段階 | 内容 | サーバ | 判断 |
| --- | --- | --- | --- |
| 1. クラウド保存 | Google ドライブのファイルを、ローカルと同じ操作で開いて保存する | 不要 | 方式は ADR-0012（保留）。利用者の声が出てから着手する |
| 2. チームで共有 | ドライブの共有フォルダで、チームが同じモデルを開く。同時に編集したときの競合を扱う。Git・GitHub での共有も検討する | 不要 | 要求と ADR を、段階 1 の利用状況を見てから書く |
| 3. Web サービス | アカウント、チームの管理、必要なら有料プラン | 必要 | C-2・C-4・ADR-0003 の見直しを伴う。利用者の反応を見て ADR で判断する |
