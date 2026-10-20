# SysML v2 仕様との対応表

Modelith が SysML v2 仕様のどこに対応し、どこが未対応かを示す。
対象は、アプリが使う Rust のパーサ（`crates/modelith-core/src/syntax`・`project`、段階 A。ADR-0015）とモデル構築（`crates/modelith-core/src/model`。ADR-0016）と図（`web/src/app/`）。暫定の TS コア（`web/src/core/`）は、Rust のコアと同じテストで比べるために残している。

- 照合日: 2026-10-20（アクションの流れの行を更新した。全体は 2026-10-19 に Rust のコアで照合し直した。その前は 2026-10-13、暫定の TS コアで照合）
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
| ○ | モデルに入り、ツリーか図（要素に付ける情報はインスペクタ）に出る |
| △ | 一部だけ取り込む。または構文は通すが中身を捨てる |
| × | 取り込まない（エラーを出さずに捨てる場合を含む） |
| ⚠ | 無視ではなく、別の意味に取り違えて誤った表示（誤ったエラー・警告、誤った要素）を出す |

「予定」の列は、対応するリリース（[リリース計画](../development/release-plan.md) の「SysML v2 の文法への対応」）。— は予定の無いもの。

件数：テキスト記法（2 章）96 項目のうち ○ 79・△ 12・× 5。⚠ は 0 件。

alpha.9 の 2 回目の更新で、遷移の名前・トリガの `via`・ガード・効果、状態の中の省略形の遷移（`accept E then b`・`if g then b`・`then b`）、最初の遷移（`entry; then s;`）、`entry`・`do`・`exit`・`parallel` を読み、状態定義の状態と遷移を状態遷移図（StateTransitionView）に描くようにした（Rust のコアだけ。ADR-0015）。それまでは ○ 75・△ 14・× 7 だった。

alpha.9 の 1 回目の更新で、継起（`first … then`・`then`・ガード付き・`else`）・`succession flow`・制御の節（`fork`・`join`・`merge`・`decide`）・`send`・`accept`・`assign`・`terminate`・`if`・`while`・`for` を読み、アクション定義の流れをアクションの流れ図（ActionFlowView）に描くようにした（Rust のコアだけ。ADR-0015）。それまでは ○ 69・△ 15・× 12 だった。

alpha.8 の 3 回目の更新で、`:=`・`default` の値の種類・`individual`・`comment … about`・`rep … language` の本文を記録し、メモを一般の図に描くようにした（Rust のコアだけ。ADR-0015）。それまでは ○ 65・△ 17・× 14 だった。

alpha.8 の 2 回目の更新で、単独の `connect`・n 項の `connect`・`bind`・`binding`・`allocation def`・`allocation`・`allocate`・`flow def`・名前付きのフローを読み、内部ブロック図（入れ子は 2 段まで）と一般の図に描くようにした（Rust のコアだけ。ADR-0015）。それまでは ○ 60・△ 18・× 18 だった。

alpha.8 の 1 回目の更新で、定義の特殊化（`:>`・`specializes`）・部分集合・再定義・参照・多重度・`dependency` を記録して図に描くようにした（Rust のコアだけ。ADR-0015）。それまでは ○ 52・△ 25・× 19 だった。

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
| コメント `/* */`・`//` | 8.2.2.1.2 | ○ | | 解析では読み飛ばす。中の括弧も数えない。`comment` を書いたコメントは要素にする（2.2 の `comment … about`） |
| 文字列 `"a{b"` | STRING_VALUE | ○ | | 字句解析で 1 つの語にする。中の括弧で誤ったエラーを出さない（以前は ⚠） |
| 知らない文 | — | △ | — | 予約語で始まり、どの読み方にも当たらない文は「まだ扱えない」と問題一覧に示す（エラーとしては数えない。ADR-0013）。予約語以外で始まる文と、読み飛ばしを決めている文（`import` など）は知らせない |

### 2.2 依存・注釈（8.2.2.3〜4）

| 要素 | BNF | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- | --- |
| `dependency d from A to B;` | Dependency | ○ | | 依存の線（破線と開いた矢印、8.2.3.3）。名前はラベルに書く。`dependency A, B to C;` は依存する側とされる側の組ごとに線にする。相手が見つからなければ「見つかりません」と示す。相手が図の要素でない（package など）ときは線にしない |
| `#derivation dependency …` | Dependency + PrefixMetadataAnnotation | ○ | | derive の線になり、トレースの抜けの検出にも使う |
| 他の `#X dependency` | 同上 | ○ | | 依存の線になり、ラベルに «X» を書く |
| `doc` | Documentation | ○ | | locale は無視 |
| `comment … about` | Comment | ○ | | `comment c about A, B /* … */`・`comment /* … */`・`comment c locale "ja" /* … */` を種類 `comment` の要素として読み、本文（各行の頭の `*` を除く）と注釈する相手（`about` が無ければ持ち主）を残す。要素を選ぶとインスペクタに「メモ」として本文を出し、一般ビューでは、相手が図にあれば角を折った四角と矢印の無い破線で描く（8.2.3.4 の comment-node・annotation-link。名前があれば «comment» と名前も書く）。メモを図から削除するとコメントが消える。名前のあるメモはツリーにも出る。見つからない相手は「見つかりません」と示す。キーワードの無い `/* … */` は、BNF では持ち主を注釈する Comment だが、テキストの注記として使われることが多いので、これまでどおり要素にしない |
| `rep … language` | TextualRepresentation | ○ | | 名前・言語の名前・本文（字下げを保つ）を持ち主の要素に残し、要素を選ぶとインスペクタに「別の言語での表し方（言語）」として出す。`rep` の無い `language "x" /* … */` も同じ。図の記号（8.2.3.4 の textual-representation-node）は描かない。ファイルの直下の表し方は持ち主が無いので捨てる |

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
| 定義の特殊化 `:> A` | SubclassificationPart | ○ | | `:> A, B` の相手をすべて記録し、両方が図の要素なら特殊化の線（実線と白抜きの三角、8.2.3 の subclassification）にする。先頭の相手はこれまでどおり型にもなる。見つからない相手（標準ライブラリなど）は知らせない。線を削除すると、その相手だけが消える |
| `specializes` | 同上 | ○ | | `:>` と同じ |
| 使用の部分集合 `:>` / `subsets` | Subsets | ○ | | 型と取り違えずに、相手をすべて記録する。package の直下の部品・要求どうしなら線（実線と白抜きの三角、8.2.3 の subsetting）。定義の中の特性は、区画の行（`b : B :> a`）と、部品として持つ線の端（`subsets a`）に書く。相手が見つからなくても知らせない（継承した特性は探さない） |
| 再定義 `:>>` / `redefines` | Redefines | ○ | | 部分集合と同じ。線は三角の手前に縦棒を付ける（8.2.3 の redefinition）。名前が無ければ、再定義する特徴の名前を名前にし、区画には `:>> mass = 1500` と書く |
| 参照 `::>` / `references` | References | ○ | | 部分集合と同じ。線は三角の手前に 2 つの点を付ける（8.2.3 の reference-subsetting） |
| 多重度 `[0..4]`、`ordered`、`nonunique` | MultiplicityPart | ○ | | 範囲と `ordered`・`nonunique` を記録し、部品として持つ線の部品の側の端（`[4] ordered`、8.2.3 の multiplicity）と、区画の属性の行（`w : Wheel [4]`）に書く |
| 値 `= 式` | FeatureValue | ○ | | 文字列として保持し、図に出す |
| `:=` / `default` | FeatureValue | ○ | | `=`（束縛）・`:=`（初期値、isInitial）・`default`・`default =`・`default :=`（既定値、isDefault）を区別して記録し、区画に書いたとおり（`m := 10`・`m default 10`）書く。図からの名前の変更でも書き方は変わらない（値を書き換える図の操作は無い） |
| `abstract`・`ref`・`derived`・`end`・`in`・`out`・`inout` など | Prefix 系 | ○ | | 記録する |
| `constant`・`variant` | UsagePrefix 等 | ○ | | 後ろの宣言をそのまま読み、`constant`・`variant` を修飾として記録する。`variant a;`（VariantReference）は種類 `variant` の要素になる。`variation part def V { variant part a; }` も読む（バリアントの意味は持たない） |

### 2.5 属性・列挙・出来事・項目・部品・ポート（8.2.2.7〜12）

| 要素 | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- |
| `attribute def` / `attribute` | ○ | | |
| `enum def`・列挙値 | ○ | | 列挙値はフェーズにも使う |
| `enum` の使用 `enum e : E;` | ○ | | 種類 `enum` の要素になる。`enum def` の中の `enum a;` はこれまでどおり列挙値 |
| `occurrence def` / `occurrence` | ○ | | シーケンス図の文脈 |
| `individual` | ○ | | 修飾として記録し（isIndividual）、図の見出しを «individual part def» のように書く。種類のキーワードの無い `individual def E;`・`individual e : E;`（IndividualDefinition・IndividualUsage）は `occurrence def`・`occurrence` として読む（以前は、定義を「まだ扱えない」と知らせ、使用を型付きのパラメータと取り違えていた） |
| `timeslice` / `snapshot` / `event occurrence` | ○ | | 書いた語を種類にした使用の要素になる（`event e;` の参照の形も）。`timeslice part p` のように種類のキーワードが続けば、その種類の要素に `timeslice` を修飾として記録する |
| `item def` / `item` | ○ | | |
| `part def` / `part` | ○ | | |
| `port def` / `port`、共役 `~` | ○ | | 向きを推定する |

### 2.6 接続・割り当て・フロー（8.2.2.13〜16）

| 要素 | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- |
| `connection def`、`connection c : C connect a.p to b.p` | ○ | | 内部ブロック図の線。端の多重度と `e ::> a.p` の名前（ConnectorEnd、8.2.2.13.1）も読む |
| 単独の `connect a to b;` | ○ | | 名前の無い接続（ConnectionUsage、8.2.2.13.1）として読み、`connection connect a to b;` と同じく内部ブロック図の線にする |
| n 項の `connect (a, b, c)` | ○ | | 端をすべて残す（NaryConnectorPart、8.2.2.13.1）。内部ブロック図では、塗った点と、点から端ごとの矢印の無い線で描く（8.2.3.13 の n-ary-connection-dot・n-ary-segment）。一般ビューには線にしない。見つからない端は「見つかりません」と示す |
| `bind` / `binding` | ○ | | 名前の無いもの・名前付きのものを結び付けの使用として読み（BindingConnectorAsUsage、8.2.2.13.2）、親の「式」に入れない。内部ブロック図に、矢印の無い実線と「=」で描く（8.2.3.13 の binding-connection）。見つからない相手は「見つかりません」と示す |
| `succession` / `first … then` | ○ | | 継起（SuccessionAsUsage、8.2.2.14）として記録する（名前付きの `succession s first a then b;` の名前も）。アクション定義の中の継起は、アクションの流れ図に実線と開いた矢印で描く（8.2.3.17）。見つからない相手は「見つかりません」と示す。状態定義の中の継起は記録するが、まだ線にしない（状態遷移は 2.7 の行） |
| `interface def` / `interface … connect` | ○ | | |
| `allocation def` / `allocation` / `allocate` | ○ | | 定義と使用（`allocation` の無い `allocate x to y;` は名前の無い使用）として本体ごと読み（8.2.2.15）、図に描く要素の間に «allocate» の破線と開いた矢印を描く（8.2.3.15 の allocate-relationship）。見つからない相手は「見つかりません」と示す。n 項の `allocate (a, b, c)` は線にしない |
| `flow of F from a.p to b.p` | ○ | | |
| `flow def`、名前付きのフロー | ○ | | `flow def` は定義、`flow f : FD from a.p to b.q;`・`flow f of I from … to …;` は使用として本体ごと読む（8.2.2.16）。名前付きのフローは名前の無いフローと同じ線にし、ラベルに `f : FD`・`f of I` を書く（8.2.3.16 の flow-label） |
| `succession flow` | ○ | | 順序付きの流れ（SuccessionFlowUsage、8.2.2.16）として記録し、名前付きのものは使用にする。アクションの流れ図に、破線と開いた矢印、アイテム（名前付きは名前と型）のラベルで描く。一般ビュー・内部ブロック図には描かない |
| `message` | ○ | | シーケンス図 |

### 2.7 アクション・状態（8.2.2.17〜18）

| 要素 | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- |
| `action def` / `action` / `then action` | ○ | | 区画に手順として番号付きで並ぶ。アクションの流れ図には、角の丸い四角と継起の線で描く |
| `perform action` | ○ | | |
| アクションの継起 `first a1 then a2;` | ○ | | `first a then b;`・`then b;`（直前の要素から。続けて書いた `then` はどれも同じ要素から）・`then action b;`（`then` だけが継起）・`first start;`（続く継起の元）を読み、アクションの流れ図に描く。開始・終了（`start`・`done`）は塗った丸と、丸の中の塗った丸（8.2.3.17）。図から 2 つの要素の間に線を引くと `first a then b;` を書き、線を消すとその文（`then action b;` は `then` だけ）を消す |
| `fork` / `join` / `merge` / `decide` | ○ | | 書いた語を種類にした使用（ControlNode、8.2.2.17）。fork・join は太い棒、merge・decide はひし形で描き、名前を横に書く（8.2.3.17）。`if g then b;`・`else b;`・`first d if g then b;`（GuardedSuccession）のガードは、線のラベル `[g]`・`[else]` |
| `if` / `while` / `for` | ○ | | 書いた語（`loop` も）を種類にした使用（IfNode・WhileLoopNode・ForLoopNode、8.2.2.17）。条件（`for` は `x in xs`）と本体を記録し、`else` の本体と `else if` も本体に入れる。アクションの流れ図では «if» などの角の丸い四角に、条件と本体のアクションの名前（then と else を分ける）を書く。本体の中の継起は描かず、`until` の条件は記録しない |
| `send` / `accept` / `assign` / `terminate` | ○ | | 書いた語を種類にした使用（SendNode・AcceptNode・AssignmentNode・TerminateNode、8.2.2.17）。`action s send x;` のように名前も付けられる。`assign` は親の「式」に入れない。アクションの流れ図では、send は右が尖った五角形、accept は左がへこんだ五角形、ほかは «assign»・«terminate» の角の丸い四角に、送るもの・受けるもの・代入を書く（8.2.3.17）。受けるものの型は確かめない |
| `state def` / `state` / `exhibit state` | ○ | | 状態遷移図（StateTransitionView）では、状態を角の丸い四角に描き、入れ子の状態（`state on { state low; }`）は外の状態の中に描く（8.2.3.18）。「振る舞い」の図では、これまでどおり状態定義の区画に状態と遷移を並べる |
| `parallel` | ○ | | 並行であることを記録し（StateDefBody の isParallel、8.2.2.18）、状態遷移図では、中の状態（領域）を上から積み、間を破線で区切る（8.2.3.18） |
| `entry` / `do` / `exit` | ○ | | 状態の振る舞い（StateSubactionMembership）として、書いた順に状態に記録し、状態遷移図の状態の区画に `entry / init` の形で書く（`action a` は `a`）。インスペクタにも出す。振る舞いを書かない `entry;` は記録せず、直後の `then s;`・`if g then s;` を、本体の最初の遷移（開始の記号から s への線）にする（EntryTransitionMember） |
| `transition … first a accept E then b` | ○ | | 名前・元・先・トリガ（受けるものと `via`。`at`・`after`・`when` は式のまま）・ガード・効果（`do` の後の振る舞い。本体も読む）を記録し（TransitionUsage、8.2.2.18）、状態遷移図に、実線と開いた矢印、ラベル `トリガ [ガード] / 効果` で描く（8.2.3.18）。`done` へ向かう遷移は終了の記号（丸の中の塗った丸）へ引く。端は書いた本体から外へ探し、`on.low` のような名前の道のりも読む。見つからない相手は問題として知らせる。図から線を消すとその文が消え、2 つの状態の間に線を引くと `transition first a then b;` を書く。「振る舞い」の図の区画の文字列は、これまでどおり「a → b [E]」（ガードと効果は書かない）。受けるものの型は確かめない |
| 省略形 `accept E then b` | ○ | | 状態の本体の `accept E via p if g do e then b;`・`if g do e then b;`・`then b;`・`first` の無い `transition … then b;` を、直前の状態からの遷移として記録する（TargetTransitionUsage、8.2.2.18）。状態遷移図と「振る舞い」の図の区画に出る |

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
画面では、標準ビュー定義を広く知られた図の名前（下の表の「画面の名前」）で呼び、＋メニュー・タブ・保存された図のサブバーのツールチップに標準ビュー定義の名前を添える（狭い画面では＋メニューの項目の下に小さく書く。ADR-0014）。

| 標準ビュー定義 | 短い名前 | 画面の名前 | `view` の描き方 | 対応 | 予定 |
| --- | --- | --- | --- | --- | --- |
| GeneralView | `gv` | 一般ビュー | ノードと線の図（expose した要素と、その間の関係） | △ 特殊化・部分集合・再定義・参照・依存・割り当ての線と多重度、メモ（`comment … about`。角を折った四角と破線、8.2.3.4）は 8.2.3 の記法で描く。定義の中の特性どうしの線と、別の言語での表し方（`rep`）・`doc` の記号は無い | — |
| InterconnectionView | `iv` | 内部ブロック図 | 内部ブロック図（expose した part def、または part の型が対象） | △ 入れ子は 2 段まで（部品の本体に書いた部品と、線の端 `a.b.p` が指す型の中の部品を、外の部品の中に描く。部品の型の中の線も描く）。結び付けは「=」の線、n 項の接続は点と端ごとの線で描く。3 段目より深い入れ子、対象そのもののポートへの線、入れ子の部品のポートを作る操作は無い | — |
| ActionFlowView | `afv` | アクティビティ図 | アクティビティ図（expose した action def が対象。自動の図「アクティビティ図」とツリーの「アクティビティ図で開く」でも開ける） | △ アクション・制御の節・送信と受信・開始と終了と、ガード付きの継起・順序付きの流れを 8.2.3.17 の記法で、継起の向きに上から並べて描く。アクションのパラメータとその間のフロー、入れ子の本体の流れ、区画（swim lane）は無い | 0.3.0 以降 |
| StateTransitionView | `stv` | 状態遷移図 | 状態遷移図（expose した state def が対象。ツリーの「状態遷移図で開く」でも開ける。組み込みのビューの一覧には出さない） | △ 状態・入れ子の状態・並行の領域（破線で区切る）・entry／do／exit の区画・開始と終了の記号と、遷移を `トリガ [ガード] / 効果` のラベルの線で、8.2.3.18 の記法で描く。本体ごとに、遷移の向きに左から並べる。図から遷移を消す・引く（`transition first a then b;`）。expose した state def が複数あっても最初の 1 つだけを描き、状態の使用（`exhibit state s { … }`）の中の遷移、効果の本体の中身、線の交差を避ける配置は無い | 0.3.0 以降 |
| SequenceView | `sv` | シーケンス図 | シーケンス図（expose した occurrence def が対象） | △ メッセージだけ。イベント・継起・入れ子は無い | alpha.9 |
| GeometryView | `gev` | ジオメトリビュー | ノードと線の図で代わりに描き、知らせる | × | 0.3.0 以降 |
| GridView | `grv` | グリッドビュー | ノードと線の図で代わりに描き、知らせる | × | 0.3.0 以降 |
| BrowserView | `bv` | ブラウザビュー | ノードと線の図で代わりに描き、知らせる（ツリーは別にある） | × | 0.3.0 以降 |

標準のレンダリング（`Views`）：`asTreeDiagram` はノードと線の図、`asInterconnectionDiagram` は内部ブロック図で描く（△）。`asTextualNotation`・`asElementTable` に当たる描き方は無い（×、0.3.0 以降）。
「制御ループ」ビューに当たる標準のビューは無い。Modelith 独自の便利機能として扱う。
自動の図のうち、トレーサビリティ・ブロック定義図・制御ループ・振る舞い・すべては GeneralView で描く図として、ツールチップに「SysML v2 では GeneralView で描く図」と添える。

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
- KerML の式の文法（8.2.5）
