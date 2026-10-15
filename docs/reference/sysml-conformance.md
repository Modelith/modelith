# SysML v2 仕様との対応表

Modelith が SysML v2 仕様のどこに対応し、どこが未対応かを示す。
対象は、アプリが使う Rust のパーサ（`crates/modelith-core/src/syntax`・`project`、段階 A。ADR-0015）と、暫定の TypeScript コアのモデル構築（`web/src/core/`）と図（`web/src/app/views.ts`）。暫定の TS パーサは、Rust のパーサと同じテストで比べるために残している。

- 照合日: 2026-10-13（2026-10-14 に、ADR-0013 で直した項目を更新）
- 照合したコミット: `88d7525`（dev）
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

コードを読んだうえで、短い SysML の断片（約 90 件）を `parse()`・`build()` に渡して確かめた。

| 印 | 意味 |
| --- | --- |
| ○ | モデルに入り、ツリーか図に出る |
| △ | 一部だけ取り込む。または構文は通すが中身を捨てる |
| × | 取り込まない（エラーを出さずに捨てる場合を含む） |
| ⚠ | 無視ではなく、別の意味に取り違えて誤った表示を出す |

件数：テキスト記法 102 項目のうち ○ 37・△ 27・× 38（⚠ は 4 件）。2026-10-13 の照合時点では ○ 34・△ 23・× 45（⚠ 9 件）。

## 1. 適合性（言語仕様 2 Conformance）

| 適合の種類 | 仕様の内容 | Modelith |
| --- | --- | --- |
| 1 抽象構文 | メタクラスの作成・読み書き・削除と、メタモデルの制約による検査 | × 独自の簡易な構造で、制約の検査も無い |
| 2a テキスト記法 | 8.2.2 の具象構文を読み書きできる（抽象構文の適合を含む） | △ BNF に沿った Rust のパーサ（段階 A：宣言の頭まで読み、式は括弧で区切るだけ。ADR-0015）。まだ扱えない文は知らせる |
| 2b グラフィカル記法 | 8.2.3 の記法。9.2.20 の標準ビュー定義は必ず扱う | △ `view` を図として描く（4 種類の標準ビュー定義）。記号は 8.2.3 と細部が違う |
| 3 意味 | 8.4・9.2 の意味での解釈（評価・実行） | × 式の評価も名前解決の意味論も無い |
| 4 モデル交換 | `.kpar` の入出力 | × `.sysml`・`.kerml` の単一ファイルだけ |
| 5 ドメインライブラリ | ISQ・SI など（任意） | × 同梱していない |

適合ツールを名乗る最低条件は 1 と 4 である。現状の Modelith は**どの区分も主張できず**、「テキスト記法の主要部分を読み書きし、図にする編集器」という位置づけになる。最初の目標は、BNF に沿った解析器を Rust コアに作り、テキスト記法の適合（2a）に近づけることである（ADR-0002・ADR-0003。作り方と対応の順序は ADR-0015）。

## 2. テキスト記法（言語仕様 8.2.2）

### 2.1 字句・名前（8.2.2.1〜2）

| 要素 | BNF | 対応 | 根拠・備考 |
| --- | --- | --- | --- |
| 基本名 | NAME | ○ | |
| 引用名 `'Fuel Tank'` | NAME | ○ | 宣言の名前と型の参照に使える（ADR-0013） |
| 短い名前 `<'R1'>`・`<R1>` | Identification | ○ | 引用あり・なしの両方（ADR-0013） |
| 修飾名 `A::B` | QualifiedName | △ | 最後の区切りだけを使い、ファイル全体から単純名で探す |
| コメント `/* */`・`//` | 8.2.2.1.2 | ○ | 解析では読み飛ばす |
| 文字列 `"a{b"` | STRING_VALUE | △⚠ | 文字列の中の括弧を数え、「ブロックが閉じていない」と誤って表示する |
| 知らない文 | — | △ | 予約語で始まり、どの読み方にも当たらない文は「まだ扱えない」と問題一覧に示す（エラーとしては数えない。ADR-0013）。予約語以外で始まる文と、読み飛ばしを決めている文（`import` など）は知らせない |

### 2.2 依存・注釈（8.2.2.3〜4）

| 要素 | BNF | 対応 | 根拠・備考 |
| --- | --- | --- | --- |
| `dependency d from A to B;` | Dependency | × | 捨てる |
| `#derivation dependency …` | Dependency + PrefixMetadataAnnotation | ○ | derive の線になり、トレースの抜けの検出にも使う |
| 他の `#X dependency` | 同上 | △ | 関係として読むが、図に出ない |
| `doc` | Documentation | ○ | locale は無視 |
| `comment … about` | Comment | × | 本文を捨てる |
| `rep … language` | TextualRepresentation | × | |

### 2.3 パッケージ（8.2.2.5）

| 要素 | BNF | 対応 | 根拠・備考 |
| --- | --- | --- | --- |
| `package`（入れ子を含む） | Package | ○ | ツリーに出る。図のノードにはならない |
| `standard library package` | LibraryPackage | × | パッケージごと消える |
| `import Q::A` / `::*` / `::**` / `all` | Import 系 | × | 捨てる。他のファイルは読まない |
| `import Q::*[@F]` | FilterPackage | × | |
| `alias B for A` | AliasMember | ×⚠ | 別名で型付けすると「型が見つかりません」と誤表示する |
| `filter @X;` | ElementFilterMember | × | |
| `private` / `public` / `protected` | VisibilityIndicator | △ | 記録するだけ |

### 2.4 定義と使用の共通部分（8.2.2.6）

| 要素 | BNF | 対応 | 根拠・備考 |
| --- | --- | --- | --- |
| 型付け `: A` | FeatureTyping | ○ | 型は 1 つだけ |
| `typed by` / `defined by` | TypedBy | × | 型が空になる |
| 定義の特殊化 `:> A` | SubclassificationPart | △ | 先頭の 1 つを記録するが、線は描かない |
| `specializes` | 同上 | △ | `:>` と同じく先頭の 1 つを記録する |
| 使用の部分集合 `:>` / `subsets` | Subsets | △ | 型と取り違えない。部分集合の関係そのものは記録しない（ADR-0013） |
| 再定義 `:>>` / `redefines` | Redefines | △ | 型と取り違えない。名前が無ければ、再定義する特徴の名前を名前にする。再定義の関係そのものは記録しない（ADR-0013） |
| 参照 `::>` / `references` | References | △ | 型と取り違えない。参照の関係は記録しない |
| 多重度 `[0..4]`、`ordered`、`nonunique` | MultiplicityPart | △ | 値を捨てる |
| 値 `= 式` | FeatureValue | ○ | 文字列として保持し、図に出す |
| `:=` / `default` | FeatureValue | △ | `:=` は `=` と区別しない。`default` は捨てる |
| `abstract`・`ref`・`derived`・`readonly`・`end`・`in`・`out`・`inout` など | Prefix 系 | ○ | 記録する |
| `constant`・`variant`・`timeslice`・`snapshot` | UsagePrefix 等 | × | 宣言ごと捨てる |

### 2.5 属性・列挙・出来事・項目・部品・ポート（8.2.2.7〜12）

| 要素 | 対応 | 根拠・備考 |
| --- | --- | --- |
| `attribute def` / `attribute` | ○ | |
| `enum def` / `enum` | ○ | 列挙値はフェーズにも使う |
| `occurrence def` / `occurrence` | ○ | シーケンス図の文脈 |
| `individual` | △ | 修飾子として記録のみ |
| `timeslice` / `snapshot` / `event occurrence` | × | |
| `item def` / `item` | ○ | |
| `part def` / `part` | ○ | |
| `port def` / `port`、共役 `~` | ○ | 向きを推定する |

### 2.6 接続・割り当て・フロー（8.2.2.13〜16）

| 要素 | 対応 | 根拠・備考 |
| --- | --- | --- |
| `connection def`、`connection c : C connect a.p to b.p` | ○ | 内部ブロック図の線 |
| 単独の `connect a to b;` | × | |
| n 項の `connect (a, b, c)` | △ | 接続先を捨てる |
| `bind` / `binding` | × | |
| `succession` / `first … then` | × | |
| `interface def` / `interface … connect` | ○ | |
| `allocation def` / `allocation` / `allocate` | × | |
| `flow of F from a.p to b.p` | ○ | |
| `flow def`、名前付きのフロー、`succession flow` | × | |
| `message` | ○ | シーケンス図 |

### 2.7 アクション・状態（8.2.2.17〜18）

| 要素 | 対応 | 根拠・備考 |
| --- | --- | --- |
| `action def` / `action` / `then action` | ○ | |
| `perform action` | ○ | |
| アクションの継起 | × | 流れの線を描かない |
| `fork` / `join` / `merge` / `decide` | × | |
| `if` / `while` / `for` | △ | 中のアクションだけ取り出す |
| `send` / `accept` / `assign` / `terminate` | × | |
| `state def` / `state` / `exhibit state` | ○ | |
| `parallel` | △ | 記録しない |
| `entry` / `do` / `exit` | × | |
| `transition … first a accept E then b` | △ | ノード内の文字列になる。線は描かず、ガードと効果は捨てる |
| 省略形 `accept E then b` | × | |

### 2.8 計算・制約・要求・ケース（8.2.2.19〜25）

| 要素 | 対応 | 根拠・備考 |
| --- | --- | --- |
| `calc def` / `calc` / `return` | ○ | 式は文字列 |
| `constraint def` / `constraint` | ○ | 式は文字列（評価しない） |
| `assert constraint` / `assert not` | △ | 式だけが親に入る |
| `requirement def` / `requirement` | ○ | |
| `subject` / `stakeholder` | ○ | |
| `require` / `assume constraint` | △ | 式の文字列 |
| `actor` | × | |
| `satisfy R by X` | ○ | |
| `by` の無い `satisfy`、`assert satisfy`、`not satisfy` | × | |
| `concern def`、`frame concern c : C` | ○ | 型の無い `frame c;` は読めない |
| `case def` / `case` | × | |
| `objective` | △ | 中身は親に入る |
| `analysis def` / `analysis` | ○ | |
| `verification def` / `verification` | ○ | |
| `verify` | △ | 定義の中なら ○。パッケージ直下の使用の中では誤表示 |
| `use case def` / `use case` | ○ | 専用のビューは無い |
| `include use case` | × | |

### 2.9 ビュー（8.2.2.26）— ADR-0005

| 要素 | BNF | 対応 | 根拠・備考 |
| --- | --- | --- | --- |
| `view def` | ViewDefinition | ○ | 標準ビュー定義の特殊化（`:>`・`specializes`）をたどる。中の `filter`・`render` は、その型の `view` に引き継ぐ。図のノードにはしない |
| `view` | ViewUsage | ○ | 名前のある `view` を、＋メニューから図として開ける（F-VIEW-7）。型の無い `view` は GeneralView として描く |
| `expose`（`A`・`P::*`・`P::**`・`P::*::**`・`[...]` 付き） | Expose | △ | 修飾名は親の名前で照合する（`import`・`alias` を通した名前は解決しない） |
| ビュー内の `filter` | ElementFilterMember | △ | `@メタクラス`（`@SysML::PartDefinition` など）と `@メタデータ` だけ。`and`・`or` などの式は、知らせたうえで使わない |
| `render`（参照形） | ViewRenderingMember | △ | `asTreeDiagram`・`asInterconnectionDiagram` は型より優先する。`asTextualNotation`・`asElementTable` は知らせて図で描く |
| `render`（合成形） | ViewRenderingMember | × | 「まだ扱えない構文」として知らせる |
| `viewpoint def` / `viewpoint` | ViewpointDefinition / Usage | ×⚠ | 中の `frame` が誤表示になる |
| `rendering def` / `rendering` | RenderingDefinition / Usage | ×⚠ | パッケージの「式」として取り込んでしまう |

### 2.10 メタデータ（8.2.2.27）

| 要素 | 対応 | 根拠・備考 |
| --- | --- | --- |
| `metadata def` | ○ | フェーズに使う。図のノードにはしない |
| `@M { k = E::V; }` | △ | 「識別子 = 修飾名」の形だけ |
| `metadata M { … }`、`about` | × | |
| 前置の `#M part def A;` | ○ | 宣言を読み、`M` をメタデータとして記録する（ADR-0013） |
| 利用者定義のキーワード | × | |

### 2.11 式・KerML

| 要素 | 対応 | 根拠・備考 |
| --- | --- | --- |
| 式・単位 `1500 [kg]` | △ | 文字列として保持するだけ |
| 特徴量の連鎖 `a.b.v` | △ | 2 段目まで解決する（3 段以上は未確認） |
| KerML のキーワード（`classifier`・`class`・`struct`・`feature`・`datatype`・`function` など） | × | すべて捨てる。`.kerml` ファイルは開けるが、中身は読めない |

## 3. 図・ビュー（言語仕様 7.26・8.2.3・9.2.20）

仕様では、図は `view` の使用で表し、`expose` → `filter` → `render` の順に組み立てる。
グラフィカル記法に適合するツールは、標準ビュー定義（Table 34）を必ず扱う。

テキストの `view` は、型の標準ビュー定義（と `render`）から描き方を決め、`expose`・`filter` で決まる要素だけを描く（`web/src/core/views.ts`）。
配置は配置ファイルの `view:<名前>` に、view ごとに保存する（内部ブロック図・シーケンス図は、対象ごとの配置を自動の図と共有する）。

| 標準ビュー定義 | 短い名前 | `view` の描き方 | 対応 |
| --- | --- | --- | --- |
| GeneralView | `gv` | ノードと線の図（expose した要素と、その間の関係） | △ 特殊化の線と多重度が無い |
| InterconnectionView | `iv` | 内部ブロック図（expose した part def、または part の型が対象） | △ 入れ子は 1 段。`bind` と単独の `connect` は不可 |
| ActionFlowView | `afv` | ノードと線の図で代わりに描き、知らせる | × |
| StateTransitionView | `stv` | 振る舞いの図（expose した要素） | △ 状態は描くが、遷移を線にしない |
| SequenceView | `sv` | シーケンス図（expose した occurrence def が対象） | △ イベント・継起・入れ子は無い |
| GeometryView | `gev` | ノードと線の図で代わりに描き、知らせる | × |
| GridView | `grv` | ノードと線の図で代わりに描き、知らせる | × |
| BrowserView | `bv` | ノードと線の図で代わりに描き、知らせる（ツリーは別にある） | × |

標準のレンダリング（`Views`）：`asTreeDiagram` はノードと線の図、`asInterconnectionDiagram` は内部ブロック図で描く（△）。`asTextualNotation`・`asElementTable` に当たる描き方は無い（×）。
「制御ループ」ビューに当たる標準のビューは無い。Modelith 独自の便利機能として扱う。

## 4. 標準ライブラリ

- 同梱も解析もしていない。`import` は捨てる。
- 名前が `Value` か `Kind` で終わる型、`Real`・`Integer`・`Boolean`・`String` などの一部の名前だけ、「型が見つかりません」の警告を抑えている。
  - そのため `Positive`・`Rational`・`Iso8601DateTime` などは、誤って警告になる。
  - 利用者が作った型の書き忘れが、名前が `…Value` で終わるために見逃されることがある。
- 単位 `[kg]` は解決しない。
- 標準ビュー定義（`GeneralView`・`gv` など）と標準のレンダリング（`asTreeDiagram` など）の名前だけを、組み込みで持つ。

## 5. 変換仕様（SysML v1 → v2）

v1（UML4SysML・XMI）の抽象構文を v2 へ写す規則であり、Modelith には v1 を読み込む機能が無いため**範囲外**。
変換仕様自身も、v2 に適合するツールに変換の実装は求めていない。

## 6. 優先して対応すべき項目

| 優先 | 項目 | 理由 |
| --- | --- | --- |
| 済 | 画面から `view` を作る（ADR-0005、F-VIEW-8） | 図を保存すると `view` を書き、図に入れる・外すと `expose` を足す・消す。利用者には view・expose という言葉を見せない |
| 済 | `view`・`expose`・`filter`・`render`・標準ビュー定義の表示（F-VIEW-7） | 2026-10-14 に対応した（`web/src/core/views.ts`、`spec.test.ts`）。`filter` の式と、専用の描き方の無い標準ビュー定義は △・× のまま |
| 済 | 前置メタデータ・`:>`/`:>>`/`redefines` の取り違え・引用名と短い名前・知らない文の通知 | 2026-10-14 に直した（ADR-0013、`web/src/core/spec.test.ts`） |
| 中 | `import`・`alias` と修飾名の解決 | 複数のパッケージをまたぐモデルで誤る |
| 中 | 文字列の中の括弧を数える | 誤ったエラー |
| 中 | 標準ライブラリの型を名前の一覧で判定する | 誤った警告と見逃し |
| 中 | 特殊化の線、遷移とアクションの流れの線 | StateTransitionView・ActionFlowView に必要 |
| 低 | `allocation`・`bind`・`case`・`actor`・`include`・単独の `connect` | |
| 低 | `.kpar` の入出力 | モデル交換の適合に必要 |

## 7. 未確認の点

- SysML 2.1 Beta 2 と 2.0 正式版の差
- グラフィカル記法の記号と、Modelith の描き方の細かな一致（BNF の図が画像のため）
- 「制御ループ」に相当する v2 の標準の描き方
- ビューの型と `render` が食い違うときの優先順位（Modelith は `render` を優先している）
- 書き出す `view` の参照の書き方（`import` か修飾名か）と、他ツールとの互換性
- `crosses`、3 段以上の特徴量の連鎖、定義の外での列挙の使用
- KerML の式の文法（8.2.5）
