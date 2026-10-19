# SysML v2 仕様との対応表

Modelith が SysML v2 仕様のどこに対応し、どこが未対応かを示す。
対象は、アプリが使う Rust のパーサ（`crates/modelith-core/src/syntax`・`project`、段階 A。ADR-0015）とモデル構築（`crates/modelith-core/src/model`。ADR-0016）と図（`web/src/app/`）。暫定の TS コア（`web/src/core/`）は、Rust のコアと同じテストで比べるために残している。

- 照合日: 2026-10-19（Rust のコアで照合し直した。前回は 2026-10-13、暫定の TS コアで照合）
- 照合したコミット: `516deae`（dev）
- 解析器や図を変えたら、この表も更新する。要求は [requirements.sysml](requirements.sysml) にだけ書き（ADR-0011）、この表は「仕様のどこまでに対応しているか」の記録とする。

## 照合した資料

| 項目 | 内容 |
| --- | --- |
| 資料の入手先 | 公式リポジトリ [Systems-Modeling/SysML-v2-Release](https://github.com/Systems-Modeling/SysML-v2-Release)。タグ `2026-08`、コミット `fb97b75`（2026-09-11）。omg.org にはこの作業環境から接続できなかった |
| 言語仕様 | `doc/2a-OMG_Systems_Modeling_Language.pdf`。表紙は **SysML 2.1 Beta 2（Release 2026-07）** |
| 変換仕様 | `doc/2b-SysML_v1_to_v2_Transformation.pdf`（同上） |
| 文法 | `bnf/SysML-textual-bnf.kebnf`、`bnf/SysML-graphical-bnf.kgbnf` |
| 標準ライブラリ | `sysml.library/`（`Views.sysml`、`StandardViewDefinitions.sysml`、`ScalarValues.kerml`、ISQ） |

> **版の注意**：README は「SysML 2.0 が 2025-06-30 に正式採択」としているが、同梱の PDF は 2.1 Beta 2 である。章番号は 2.1 Beta 2 のもの。2.0 正式版（omg.org の PDF）との差は未確認。

読んだ範囲：言語仕様の 2 Conformance・7.26 Views and Viewpoints・8.2.3.1・9.2.20.1（Table 34）、変換仕様の 1 Scope・2 Conformance、テキスト記法の BNF の全規則名と、主な章の本文。KerML の式の文法（8.2.5）は読んでいない。

## 判定の方法

コードを読んだうえで、短い SysML の断片（約 120 件）を Rust のコアの `syntax::parse` → `project::project` → `model::build` に渡し、要素・関係・問題・ビューを見て確かめた。

| 印 | 意味 |
| --- | --- |
| ○ | モデルに入り、ツリーか図に出る |
| △ | 一部だけ取り込む。または構文は通すが中身を捨てる |
| × | 取り込まない（エラーを出さずに捨てる場合を含む） |
| ⚠ | 無視ではなく、別の意味に取り違えて誤った表示（誤ったエラー・警告、誤った要素）を出す |

「予定」の列は、対応するリリース（[リリース計画](../development/release-plan.md) の「SysML v2 の文法への対応」）。— は予定の無いもの。

件数：テキスト記法（2 章）96 項目のうち ○ 52・△ 25・× 19。⚠ は 0 件。

alpha.7 の 2 回目の更新で、`case`・`actor`・`include use case`・`enum` の使用・`event occurrence`・`timeslice`・`snapshot`・`typed by`・`constant`・`variant`・`viewpoint`・`rendering`・`metadata … about`・利用者定義のキーワード・`satisfy` の書き方・名前付きの制約の参照を読むようにした（Rust のコアだけ。ADR-0015）。それまでは ○ 38・△ 28・× 30 だった。

2026-10-19 の照合では ⚠ が 7 件あり、alpha.7 で直した（`rep`・`alias`・`assert not constraint`・`assume constraint`・パッケージ直下の `verify`・`viewpoint` の中の `frame`・修飾名）。
あわせて、まだ扱えない宣言の `{ … }` の中身が外側の要素の子として取り込まれ、図に出る誤りも直した（今は本体を読まない）。

前回（暫定の TS コア。2026-10-14 の更新後、3 章の 8 行を含む 102 項目）は ○ 37・△ 27・× 38（⚠ 4 件）だった。

## 1. 適合性（言語仕様 2 Conformance）

| 適合の種類 | 仕様の内容 | Modelith |
| --- | --- | --- |
| 1 抽象構文 | メタクラスの作成・読み書き・削除と、メタモデルの制約による検査 | × 独自の簡易な構造で、制約の検査も無い |
| 2a テキスト記法 | 8.2.2 の具象構文を読み書きできる（抽象構文の適合を含む） | △ BNF に沿った Rust のパーサ（段階 A：宣言の頭まで読み、式は括弧で区切るだけ。ADR-0015）。まだ扱えない文は知らせる |
| 2b グラフィカル記法 | 8.2.3 の記法。9.2.20 の標準ビュー定義は必ず扱う | △ `view` を図として描く（4 種類の標準ビュー定義）。記号は 8.2.3 と細部が違う |
| 3 意味 | 8.4・9.2 の意味での解釈（評価・実行） | × 式の評価も名前解決の意味論も無い |
| 4 モデル交換 | `.kpar` の入出力 | × `.sysml`・`.kerml` の単一ファイルだけ（0.3.0 以降） |
| 5 ドメインライブラリ | ISQ・SI など（任意） | × 同梱していない（0.3.0 以降） |

適合ツールを名乗る最低条件は 1 と 4 である。現状の Modelith は**どの区分も主張できず**、「テキスト記法の主要部分を読み書きし、図にする編集器」という位置づけになる。最初の目標は、BNF に沿った解析器を Rust コアに作り、テキスト記法の適合（2a）に近づけることである（ADR-0002・ADR-0003。作り方と対応の順序は ADR-0015）。

## 2. テキスト記法（言語仕様 8.2.2）

### 2.1 字句・名前（8.2.2.1〜2）

| 要素 | BNF | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- | --- |
| 基本名 | NAME | ○ | | |
| 引用名 `'Fuel Tank'` | NAME | ○ | | 宣言の名前と型の参照に使える（ADR-0013） |
| 短い名前 `<'R1'>`・`<R1>` | Identification | ○ | | 引用あり・なしの両方（ADR-0013） |
| 修飾名 `A::B` | QualifiedName | △ | 0.2.0 | 参照した場所から外へ最初の段を探し、中へたどる（同じファイルの中）。たどれなければ「見つかりません」と示す。`import` を通した名前と他のファイルは解決しない |
| コメント `/* */`・`//` | 8.2.2.1.2 | ○ | | 解析では読み飛ばす。中の括弧も数えない |
| 文字列 `"a{b"` | STRING_VALUE | ○ | | 字句解析で 1 つの語にする。中の括弧で誤ったエラーを出さない（以前は ⚠） |
| 知らない文 | — | △ | — | 予約語で始まり、どの読み方にも当たらない文は「まだ扱えない」と問題一覧に示す（エラーとしては数えない。ADR-0013）。予約語以外で始まる文と、読み飛ばしを決めている文（`import` など）は知らせない |

### 2.2 依存・注釈（8.2.2.3〜4）

| 要素 | BNF | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- | --- |
| `dependency d from A to B;` | Dependency | × | alpha.8 | 黙って捨てる |
| `#derivation dependency …` | Dependency + PrefixMetadataAnnotation | ○ | | derive の線になり、トレースの抜けの検出にも使う |
| 他の `#X dependency` | 同上 | △ | alpha.8 | 関係として読むが、図に出ない |
| `doc` | Documentation | ○ | | locale は無視 |
| `comment … about` | Comment | × | alpha.8 | 本文を黙って捨てる（後の宣言は残る） |
| `rep … language` | TextualRepresentation | × | alpha.8 | 本文のコメントで文が終わり、続く宣言を正しく読む。表し方そのものはまだ捨てる |

### 2.3 パッケージ（8.2.2.5）

| 要素 | BNF | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- | --- |
| `package`（入れ子を含む） | Package | ○ | | ツリーに出る。図のノードにはならない。保存された図で package そのものを expose すると、名前を書いた枠（フォルダの形、8.2.3.5）として描き、中の要素を枠の中に示す（F-VIEW-9） |
| `standard library package`・`library package` | LibraryPackage | ○ | | package として取り込む（ライブラリの印は記録しない） |
| `import Q::A` / `::*` / `::**` / `all` | Import 系 | × | 0.2.0 | 黙って捨てる。他のファイルは読まない |
| `import Q::*[@F]` | FilterPackage | × | 0.2.0 | |
| `alias B for A` | AliasMember | △ | 0.2.0 | 同じファイルの別名は、指す先として解決する（型付け・関係の相手・expose。別名の別名も）。他のファイルの別名と `import` は解決しない |
| `filter @X;`（package 直下） | ElementFilterMember | × | 0.2.0 | 黙って捨てる |
| `private` / `public` / `protected` | VisibilityIndicator | △ | 0.2.0 | 記録するだけ（import と一緒に意味を持つ） |

### 2.4 定義と使用の共通部分（8.2.2.6）

| 要素 | BNF | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- | --- |
| 型付け `: A` | FeatureTyping | ○ | | `: A, B` は先頭の 1 つだけ |
| `typed by` / `defined by` | TypedBy | ○ | | `defined by A`・`typed by A` は `: A` と同じく型になる（`typed by` は KerML の TYPED_BY。SysML の BNF ではメタデータの使用の宣言にだけ出るが、どこでも同じに読む） |
| 定義の特殊化 `:> A` | SubclassificationPart | △ | alpha.8 | 先頭の 1 つを記録するが、線は描かない |
| `specializes` | 同上 | △ | alpha.8 | `:>` と同じ |
| 使用の部分集合 `:>` / `subsets` | Subsets | △ | alpha.8 | 型と取り違えない。関係そのものは記録しない（ADR-0013） |
| 再定義 `:>>` / `redefines` | Redefines | △ | alpha.8 | 型と取り違えない。名前が無ければ、再定義する特徴の名前を名前にする。関係は記録しない（ADR-0013） |
| 参照 `::>` / `references` | References | △ | alpha.8 | 型と取り違えない。関係は記録しない |
| 多重度 `[0..4]`、`ordered`、`nonunique` | MultiplicityPart | △ | alpha.8 | 名前と型は残り、値は捨てる |
| 値 `= 式` | FeatureValue | ○ | | 文字列として保持し、図に出す |
| `:=` / `default` | FeatureValue | △ | alpha.8 | 値として残るが、`=` と区別しない |
| `abstract`・`ref`・`derived`・`end`・`in`・`out`・`inout` など | Prefix 系 | ○ | | 記録する |
| `constant`・`variant` | UsagePrefix 等 | ○ | | 後ろの宣言をそのまま読み、`constant`・`variant` を修飾として記録する。`variant a;`（VariantReference）は種類 `variant` の要素になる。`variation part def V { variant part a; }` も読む（バリアントの意味は持たない） |

### 2.5 属性・列挙・出来事・項目・部品・ポート（8.2.2.7〜12）

| 要素 | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- |
| `attribute def` / `attribute` | ○ | | |
| `enum def`・列挙値 | ○ | | 列挙値はフェーズにも使う |
| `enum` の使用 `enum e : E;` | ○ | | 種類 `enum` の要素になる。`enum def` の中の `enum a;` はこれまでどおり列挙値 |
| `occurrence def` / `occurrence` | ○ | | シーケンス図の文脈 |
| `individual` | △ | alpha.8 | 修飾子として記録するだけ |
| `timeslice` / `snapshot` / `event occurrence` | ○ | | 書いた語を種類にした使用の要素になる（`event e;` の参照の形も）。`timeslice part p` のように種類のキーワードが続けば、その種類の要素に `timeslice` を修飾として記録する |
| `item def` / `item` | ○ | | |
| `part def` / `part` | ○ | | |
| `port def` / `port`、共役 `~` | ○ | | 向きを推定する |

### 2.6 接続・割り当て・フロー（8.2.2.13〜16）

| 要素 | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- |
| `connection def`、`connection c : C connect a.p to b.p` | ○ | | 内部ブロック図の線 |
| 単独の `connect a to b;` | × | alpha.8 | 「まだ扱えない」と知らせる |
| n 項の `connect (a, b, c)` | △ | alpha.8 | 接続の使用だけ残り、接続先を捨てる |
| `bind` / `binding` | × | alpha.8 | `bind` は黙って捨てる。`binding … bind …` は親の「式」に入る |
| `succession` / `first … then` | × | alpha.9 | 黙って捨てる |
| `interface def` / `interface … connect` | ○ | | |
| `allocation def` / `allocation` / `allocate` | × | alpha.8 | 定義と使用は「まだ扱えない」と知らせ（本体の中は読まない）、`allocate` は黙って捨てる |
| `flow of F from a.p to b.p` | ○ | | |
| `flow def`、名前付きのフロー | × | alpha.8 | 「まだ扱えない」と知らせる（本体の中は読まない） |
| `succession flow` | × | alpha.9 | 黙って捨てる |
| `message` | ○ | | シーケンス図 |

### 2.7 アクション・状態（8.2.2.17〜18）

| 要素 | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- |
| `action def` / `action` / `then action` | ○ | | 区画に手順として番号付きで並ぶ |
| `perform action` | ○ | | |
| アクションの継起 `first a1 then a2;` | × | alpha.9 | 流れの線を描かない |
| `fork` / `join` / `merge` / `decide` | × | alpha.9 | 「まだ扱えない」と知らせる |
| `if` / `while` / `for` | △ | alpha.9 | 中のアクションだけ取り出す。`for` は中身を出しているのに「まだ扱えない」と知らせる |
| `send` / `accept` / `assign` / `terminate` | × | alpha.9 | `send`・`terminate` は知らせ、`accept` は黙って捨て、`assign` は親の「式」に入る |
| `state def` / `state` / `exhibit state` | ○ | | |
| `parallel` | △ | alpha.9 | 中の状態は読むが、並行であることを記録しない |
| `entry` / `do` / `exit` | × | alpha.9 | 黙って捨てる |
| `transition … first a accept E then b` | △ | alpha.9 | 区画の文字列「a → b [E]」になる。線は描かず、ガードと効果は捨てる |
| 省略形 `accept E then b` | × | alpha.9 | 黙って捨てる |

### 2.8 計算・制約・要求・ケース（8.2.2.19〜25）

| 要素 | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- |
| `calc def` / `calc` / `return` | ○ | | 式は文字列 |
| `constraint def` / `constraint` | ○ | | 式は文字列（評価しない） |
| `assert constraint` / `assert not` | △ | 0.3.0 以降 | `assert constraint { … }`・`assert not constraint d { … }` は式として親に入る（`x < 0` のような比べる式も誤ったエラーにしない）。本体の無い `assert constraint c : CD;` も `c : CD` を親の式として残す（`not` は `not c : CD` と残す）。本体のある形では否定（`not`）を記録しない |
| `requirement def` / `requirement` | ○ | | |
| `subject` / `stakeholder` | ○ | | |
| `require` / `assume constraint` | ○ | | `require constraint { … }`・`assume constraint { … }`（名前付きも）は式として入る。本体の無い `require c : CD;`・`require constraint c : CD;` も `c : CD` を式として残す（要求の区画に出る） |
| `actor` | ○ | | 型付きの要素になり、ツリーに出る（`subject`・`stakeholder` と違い、ツリーで隠さない） |
| `satisfy R by X` | ○ | | |
| `by` の無い `satisfy`、`assert satisfy`、`not satisfy` | ○ | | `satisfy R;` は持ち主（使用なら型の定義）から満たす線を引く。`assert satisfy R by X` は `satisfy R by X` と同じ。`not satisfy R by X` は関係として記録するが、線にせず、トレースの抜けの検出でも満たす要素に数えない |
| `concern def`、`frame concern c : C` | ○ | | 型の無い `frame c;` は「まだ扱えない」と知らせる |
| `case def` / `case` | ○ | | ツリーに出る要素になる（図のノードにはしない）。本体（`subject`・`actor`・`objective` など）も読む |
| `objective` | △ | | 中身は親に入る（目的の要求そのものは要素にしない） |
| `analysis def` / `analysis` | ○ | | |
| `verification def` / `verification` | ○ | | |
| `verify` | △ | | 定義の中と、パッケージ直下の型付きの使用の中（型の定義から線を引く）で線になる。型の無い使用の中では線を引かない |
| `use case def` / `use case` | ○ | | 専用のビューは無い |
| `include use case` | ○ | | 種類 `include use case` の要素になる（`include use case u : U;` は U を型にする。`include u;` は u を名前にし、型は付けない）。図の線は引かない |

### 2.9 ビュー（8.2.2.26）— ADR-0005

| 要素 | BNF | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- | --- |
| `view def` | ViewDefinition | ○ | | 標準ビュー定義の特殊化（`:>`・`specializes`）をたどる。中の `filter`・`render` は、その型の `view` に引き継ぐ。図のノードにはしない |
| `view` | ViewUsage | ○ | | 名前のある `view` を、＋メニューから図として開ける（F-VIEW-7）。型の無い `view` は GeneralView として描く |
| `expose`（`A`・`P::*`・`P::**`・`P::*::**`・`[...]` 付き） | Expose | △ | 0.2.0 | 修飾名は view から外へ最初の段を探し、中へたどる。同じファイルの `alias` は解決する。`import` を通した名前は解決しない |
| ビュー内の `filter` | ElementFilterMember | △ | alpha.9 | `@メタクラス`（`@SysML::PartDefinition` など）と `@メタデータ` だけ。`and`・`or` などの式は、知らせたうえで使わない |
| `render`（参照形） | ViewRenderingMember | △ | 0.3.0 以降 | `asTreeDiagram`・`asInterconnectionDiagram` は型より優先する。`asTextualNotation`・`asElementTable` は知らせて図で描く |
| `render`（合成形） | ViewRenderingMember | × | alpha.9 | 「まだ扱えない」と知らせる |
| `viewpoint def` / `viewpoint` | ViewpointDefinition / Usage | ○ | | ツリーに出る要素になる（`view def` と同じく図のノードにはしない。`view` とは取り違えない）。中の `frame concern c : C;` は関係として記録するが、視点を図に描かないので線は引かない |
| `rendering def` / `rendering` | RenderingDefinition / Usage | ○ | | ツリーに出る要素になる（図のノードにはしない） |

### 2.10 メタデータ（8.2.2.27）

| 要素 | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- |
| `metadata def` | ○ | | フェーズに使う。図のノードにはしない |
| `@M { k = E::V; }` | ○ | | 値は式の全体（`k = 1 + 2` は `1 + 2`）。列挙値などの修飾名（`E::V`）だけは最後の名前（フェーズに使う）。本体の無い `@M;` も持ち主に `M` を付ける |
| `metadata M about A { … }` | ○ | | `about` の相手（修飾名・特徴の連鎖も）を書いた場所から探し、それぞれに `M` と本体の値を付ける。見つからない相手は問題一覧に示す。`about` の無い `metadata M;` は持ち主に付ける（`@M;` と同じ） |
| 前置の `#M part def A;` | ○ | | 宣言を読み、`M` をメタデータとして記録する（ADR-0013） |
| 利用者定義のキーワード `#X def`・`#X x;` | ○ | | メタデータの定義 `X` が `:>> baseType = … meta SysML::PartUsage;` で基の型を決めていれば、その種類（`part def`・`part` など）として読む。決まらなければ種類 `def`・`usage` の要素としてツリーにだけ出す。どちらも `X` をメタデータとして記録する |

### 2.11 式・KerML

| 要素 | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- |
| 式・単位 `1500 [kg]` | △ | 0.3.0 以降 | 文字列として保持するだけ |
| 特徴量の連鎖 `a.b.v` | △ | alpha.9 | 先頭の段で要素を決め、2 段目をポートとして探す。3 段目以降は捨てる |
| KerML のキーワード（`classifier`・`class`・`struct`・`feature`・`datatype`・`function` など） | × | 0.3.0 以降 | すべて黙って捨てる。`.kerml` ファイルは開けるが、中身は読めない |

## 3. 図・ビュー（言語仕様 7.26・8.2.3・9.2.20）

仕様では、図は `view` の使用で表し、`expose` → `filter` → `render` の順に組み立てる。
グラフィカル記法に適合するツールは、標準ビュー定義（Table 34）を必ず扱う。

テキストの `view` は、型の標準ビュー定義（と `render`）から描き方を決め、`expose`・`filter` で決まる要素だけを描く（`crates/modelith-core/src/model/views.rs`）。
配置は配置ファイルの `view:<名前>` に、view ごとに保存する（内部ブロック図・シーケンス図は、対象ごとの配置を自動の図と共有する）。

| 標準ビュー定義 | 短い名前 | `view` の描き方 | 対応 | 予定 |
| --- | --- | --- | --- | --- |
| GeneralView | `gv` | ノードと線の図（expose した要素と、その間の関係） | △ 特殊化の線と多重度が無い | alpha.8 |
| InterconnectionView | `iv` | 内部ブロック図（expose した part def、または part の型が対象） | △ 入れ子は 1 段。`bind` と単独の `connect` は不可 | alpha.8 |
| ActionFlowView | `afv` | ノードと線の図で代わりに描き、知らせる | × | alpha.9 |
| StateTransitionView | `stv` | 振る舞いの図（expose した要素） | △ 状態は描くが、遷移を線にしない | alpha.9 |
| SequenceView | `sv` | シーケンス図（expose した occurrence def が対象） | △ メッセージだけ。イベント・継起・入れ子は無い | alpha.9 |
| GeometryView | `gev` | ノードと線の図で代わりに描き、知らせる | × | 0.3.0 以降 |
| GridView | `grv` | ノードと線の図で代わりに描き、知らせる | × | 0.3.0 以降 |
| BrowserView | `bv` | ノードと線の図で代わりに描き、知らせる（ツリーは別にある） | × | 0.3.0 以降 |

標準のレンダリング（`Views`）：`asTreeDiagram` はノードと線の図、`asInterconnectionDiagram` は内部ブロック図で描く（△）。`asTextualNotation`・`asElementTable` に当たる描き方は無い（×、0.3.0 以降）。
「制御ループ」ビューに当たる標準のビューは無い。Modelith 独自の便利機能として扱う。

## 4. 標準ライブラリ

- 同梱も解析もしていない（0.3.0 以降）。`import` は捨てる。
- 「型が見つかりません」の警告を抑える標準ライブラリの型は、名前で判定する（`crates/modelith-core/src/model/mod.rs` の `LIBRARY_TYPES`。`ScalarValues::Real` のような修飾名も、最後の名前で判定する）。
  - 一覧には、照合した `sysml.library` にある名前だけを入れた：Base・ScalarValues・Occurrences（`Anything`・`DataValue`・`ScalarValue`・`Boolean`・`String`・`NumericalValue`・`Number`・`Complex`・`Real`・`Rational`・`Integer`・`Natural`・`Positive`・`Occurrence`）、Systems Library の基の定義（`Part`・`Item`・`Action`・`StateAction`・`Port`・`Connection`・`Interface`・`Allocation`・`Calculation`・`ConstraintCheck`・`RequirementCheck`・`Case`・`AnalysisCase`・`VerificationCase`・`UseCase`・`View`・`Rendering`・`MetadataItem`）、VerificationCases（`VerdictKind`・`VerificationMethodKind`）、Time（`TimeInstantValue`・`DateTime`・`Date`・`TimeOfDay`・`UtcTimeInstantValue`・`Iso8601DateTime`）。
  - `…Value`・`…Kind` で終わる名前（`MassValue` など）は、ファイルが量と単位のライブラリ（`ISQ`・`ISQBase`・`ISQSpaceTime` などの ISQ の各パッケージ、`SI`・`SIPrefixes`・`USCustomaryUnits`・`Quantities`・`QuantityCalculations`・`MeasurementReferences`・`MeasurementRefCalculations`・`Time`・`TensorCalculations`・`VectorCalculations`）のどれかを `import` しているとき、または名前をそのパッケージで修飾しているとき（`ISQ::MassValue`）だけ標準とみなす。それ以外で、ファイルに定義の無い `…Value` の型は「見つかりません」と示す（alpha.6 までは、名前だけで標準とみなし、書き間違いを見逃していた）。
  - ライブラリを読んでいないので、一覧に無い標準の名前（`Flow` など）や、量のパッケージに無い `…Value` の名前は区別できない。
- 単位 `[kg]` は解決しない（0.3.0 以降）。
- 標準ビュー定義（`GeneralView`・`gv` など）と標準のレンダリング（`asTreeDiagram` など）の名前だけを、組み込みで持つ。

## 5. 変換仕様（SysML v1 → v2）

v1（UML4SysML・XMI）の抽象構文を v2 へ写す規則であり、Modelith には v1 を読み込む機能が無いため**範囲外**。
変換仕様自身も、v2 に適合するツールに変換の実装は求めていない。

## 6. 対応の順序

項目ごとの予定は、上の表の「予定」の列に書いた。リリースごとのまとまりは [リリース計画](../development/release-plan.md) の「SysML v2 の文法への対応」にある。
対応したら、この表の「対応」を更新し、「予定」を空にする。

## 7. 未確認の点

- SysML 2.1 Beta 2 と 2.0 正式版の差
- グラフィカル記法の記号と、Modelith の描き方の細かな一致（BNF の図が画像のため）
- 「制御ループ」に相当する v2 の標準の描き方
- ビューの型と `render` が食い違うときの優先順位（Modelith は `render` を優先している）
- 書き出す `view` の参照の書き方（`import` か修飾名か）と、他ツールとの互換性
- `crosses`、定義の外での列挙の使用
- `readonly` が現行の SysML v2 の予約語かどうか（今は `readonly attribute ro : Real;` の名前と型が空になる）
- InterconnectionView の入れ子が 1 段であることは、図の描画のコードでは照合していない
- KerML の式の文法（8.2.5）
