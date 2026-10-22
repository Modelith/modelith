# SysML v2 仕様との対応表

Modelith が SysML v2 仕様のどこに対応し、どこが未対応かを示す。
対象は、アプリが使う Rust のパーサ（`crates/modelith-core/src/syntax`・`project`、段階 A。ADR-0015）とモデル構築（`crates/modelith-core/src/model`。ADR-0016）と図（`web/src/app/`）。暫定の TS コアは beta.1 で削除した。

- 照合日: 2026-10-20（alpha.9 の公開後に、BNF の規則から書いた断片で全体を照合し直した。その前は 2026-10-19 に Rust のコアで、2026-10-13 に暫定の TS コアで照合）
- 照合したコミット: `c07b3c2`（dev。コアは `09ef7ef` から変わっていない）
- 解析器や図を変えたら、この表も更新する。要求は [requirements.sysml](requirements.sysml) にだけ書き（ADR-0011）、この表は「仕様のどこまでに対応しているか」の記録とする。

## 照合した資料

| 項目 | 内容 |
| --- | --- |
| 資料の入手先 | 公式リポジトリ [Systems-Modeling/SysML-v2-Release](https://github.com/Systems-Modeling/SysML-v2-Release)。タグ `2026-08`、コミット `fb97b75`（2026-09-11）。omg.org にはこの作業環境から接続できなかった |
| 言語仕様 | `doc/2a-OMG_Systems_Modeling_Language.pdf`。表紙は **SysML 2.1 Beta 2（Release 2026-07）** |
| 変換仕様 | `doc/2b-SysML_v1_to_v2_Transformation.pdf`（同上） |
| 文法 | `bnf/SysML-textual-bnf.kebnf`、`bnf/SysML-graphical-bnf.kgbnf` |
| 標準ライブラリ | `sysml.library/`（`Views.sysml`、`StandardViewDefinitions.sysml`、`ScalarValues.kerml`、ISQ） |

> **版の注意**：公式リポジトリの README は「SysML 2.0 が 2025-06-30 に正式採択」としているが、同梱の PDF は 2.1 Beta 2 である。章番号は 2.1 Beta 2 のもの。2.0 正式版（omg.org の PDF）との差は未確認。

読んだ範囲：言語仕様の 2 Conformance・7.26 Views and Viewpoints・8.2.3.1・9.2.20.1（Table 34）、変換仕様の 1 Scope・2 Conformance、テキスト記法の BNF の全規則名と、主な章の本文。KerML の式の文法（8.2.5）は読んでいない。

## 判定の方法

コードを読んだうえで、BNF の規則から書いた短い SysML の断片（約 150 件）を Rust のコアの `syntax::parse` → `project::project` → `model::build` に渡し、要素・関係・問題・ビューを見て確かめた。

| 印 | 意味 |
| --- | --- |
| ○ | モデルに入り、ツリーか図（要素に付ける情報はインスペクタ）に出る |
| △ | 一部だけ取り込む。または構文は通すが中身を捨てる |
| × | 取り込まない（エラーを出さずに捨てる場合を含む） |
| ⚠ | 無視ではなく、別の意味に取り違えて誤った表示（誤ったエラー・警告、誤った要素）を出す |

「予定」の列は、対応するリリース（[リリース計画](../development/release-plan.md) の「SysML v2 の文法への対応」）。— は予定の無いもの。

件数：テキスト記法（2 章）119 項目のうち ○ 101・△ 13・× 5・⚠ 0。

0.2.0-alpha.3 で、`assert constraint`・`assert not` の否定を記録して持ち主の区画に書き、`objective` を検証・解析の区画に書き、型の無い検証・解析の使用の中の `verify` も線にした（Rust のコアと一般ビュー。8.2.3.20〜24）。それまでは ○ 98・△ 16・× 5 だった。

alpha.10 で、誤った表示（⚠）の 12 件と、黙って捨てていた短い書き方（`from` の無い `flow`・`succession flow`・`message`、`connect` の無い `interface`）と参照の形（`perform x.y;`・`exhibit s;`・`frame c;`）を直した（Rust のコアだけ。ADR-0015）。⚠ は 9 件が ○、本体付きの式が △、関係の本体の注釈と KerML の宣言が ×（捨てるが、外に漏らさない）になった。それまでは ○ 81・△ 16・× 10・⚠ 12 だった。

2026-10-20 の照合し直しでは、BNF の規則（約 330）から書いた断片（約 150）を Rust のコアに通した。それまでの表は ⚠ を 0 件としていたが、誤った構文エラーや「見つかりません」を出す書き方が残っていた。BNF にあって表に無かった書き方（`from` の無い `flow`・`message`、参照の形の `perform`・`exhibit`・`frame`、キーワードの無い特性、`crosses` など）の 23 行を足し、`library package` を ○ から △ に直した。⚠ と、黙って捨てる短い書き方は alpha.10 で直す。それまでは 96 項目のうち ○ 82・△ 10・× 4 としていた。

alpha.9 の 3 回目の更新で、ビューの `filter` の論理式（`and`・`or`・`xor`・`not`・括弧と `istype`・`hastype`）、`render` の合成形（`render rendering r :> asTreeDiagram { … }`）と標準の表し方を特殊化した `rendering` の参照、3 段以上の特徴量の連鎖（`a.b.c.p`）を読み、シーケンス図（SequenceView）にライフラインの上のイベント（入れ子の部品のイベントを含む）・イベントの間の順序・順序に合わせた段を描くようにした。`then event occurrence e;` も読む（Rust のコアだけ。ADR-0015）。それまでは ○ 79・△ 12・× 5 だった。

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
| 2b グラフィカル記法 | 8.2.3 の記法。9.2.20 の標準ビュー定義は必ず扱う（9.2.20.1） | △ `view` を図として描く（5 種類の標準ビュー定義）。記号は 8.2.3 と細部が違う |
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
| 関係の本体の `doc`（`dependency … { doc /* … */ }`・`alias … { doc … }`） | × | — | 関係の本体を読まず、中の `doc`・`comment`・メタデータを記録しない（外側の package のものにはしない） |

### 2.3 パッケージ（8.2.2.5）

| 要素 | BNF | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- | --- |
| `package`（入れ子を含む） | Package | ○ | | ツリーに出る。図のノードにはならない。作成した図（view）で package そのものを expose すると、名前を書いた枠（フォルダの形、8.2.3.5）として描き、中の要素を枠の中に示す（F-VIEW-9） |
| `standard library package`・`library package` | LibraryPackage | △ | — | package として取り込む。ライブラリ・標準の印は記録しない |
| `import Q::A` / `::*` / `::**` / `all` | Import 系 | × | 0.2.0 | 黙って捨てる。他のファイルは読まない。型の名前はファイル全体から単純名で探すため、`import` の無い別の package の型も見つかる（誤ったエラーは出ないが、見えないはずの名前も通す） |
| `import Q::*[@F]` | FilterPackage | × | 0.2.0 | |
| `alias B for A` | AliasMember | △ | 0.2.0 | 同じファイルの別名は、指す先として解決する（型付け・関係の相手・expose。別名の別名も）。他のファイルの別名と `import` は解決しない |
| `filter @X;`（package 直下） | ElementFilterMember | × | 0.2.0 | 黙って捨てる |
| `private` / `public` / `protected` | VisibilityIndicator | △ | 0.2.0 | 記録するだけ（import と一緒に意味を持つ） |
| package の無いファイルの直下の使用 | RootNamespace | △ | — | ツリーには出るが、図には描かない |

### 2.4 定義と使用の共通部分（8.2.2.6）

| 要素 | BNF | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- | --- |
| 型付け `: A` | FeatureTyping | ○ | | |
| 複数の型 `: A, B` | FeatureTyping | △ | — | 先頭の 1 つだけを型にする |
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
| `ref r : A;`・型の無い `ref r;` | ReferenceUsage | ○ | | 型の無い `ref r;` も参照の使用にする。特殊化の相手・多重度・値も記録し、区画の属性の行に書く（型も値も無ければ名前だけ） |
| キーワードの無い特性 `x : Real;`・`y :> x;`・`z : Real = 3;` | DefaultReferenceUsage | ○ | | `ref s : A;` と同じく参照の使用にする（区画の属性の行）。要求・制約の式にはしない。列挙の定義の本体の `a = 1;` と `return r : R;` はこれまでどおり |
| `crosses`・`=>` | OwnedCrossFeatureMember | ○ | | 値にせず、交差の相手として記録し、部品の線の端（`crosses q.r`）と区画の行（`w : A => q.r`）に書く。インスペクタには出さない。`end` の特性の形は未確認 |
| `constant`・`variant` | UsagePrefix 等 | ○ | | 後ろの宣言をそのまま読み、`constant`・`variant` を修飾として記録する。`variant a;`（VariantReference）は種類 `variant` の要素になる。`variation part def V { variant part a; }` も読む（バリアントの意味は持たない） |

### 2.5 属性・列挙・出来事・項目・部品・ポート（8.2.2.7〜12）

| 要素 | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- |
| `attribute def` / `attribute` | ○ | | |
| `enum def`・列挙値 | ○ | | 列挙値はフェーズにも使う |
| 値付きの列挙値 `enum b = 3;` | △ | — | 列挙値として読むが、値は記録しない |
| `enum` の使用 `enum e : E;` | ○ | | 種類 `enum` の要素になる。`enum def` の中の `enum a;` はこれまでどおり列挙値 |
| `occurrence def` / `occurrence` | ○ | | シーケンス図の文脈 |
| `individual` | ○ | | 修飾として記録し（isIndividual）、図の見出しを «individual part def» のように書く。種類のキーワードの無い `individual def E;`・`individual e : E;`（IndividualDefinition・IndividualUsage）は `occurrence def`・`occurrence` として読む（以前は、定義を「まだ扱えない」と知らせ、使用を型付きのパラメータと取り違えていた） |
| `timeslice` / `snapshot` / `event occurrence` | ○ | | 書いた語を種類にした使用の要素になる（`event e;` の参照の形も）。`then event occurrence e;`・`then event a.e;` は、直前のイベントからの継起の後のイベントとして読む（SourceSuccessionMember、8.2.2.9.3。以前は黙って捨てていた）。シーケンス図では、ライフラインの上の白抜きの丸と `.e` の札で描く（8.2.3.9）。`timeslice part p` のように種類のキーワードが続けば、その種類の要素に `timeslice` を修飾として記録する |
| `item def` / `item` | ○ | | |
| `part def` / `part` | ○ | | |
| `port def` / `port`、共役 `~` | ○ | | 向きを推定する |
| 共役ポートの定義を名前で書く `port y : Pt::'~Pt';` | ○ | | `~Pt` と同じく Pt の共役として読み、ポートの向きを反転する |

### 2.6 接続・割り当て・フロー（8.2.2.13〜16）

| 要素 | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- |
| `connection def`、`connection c : C connect a.p to b.p` | ○ | | 内部ブロック図の線。端の多重度と `e ::> a.p` の名前（ConnectorEnd、8.2.2.13.1）も読む |
| 定義の中の型の無い部品を線の端にする `part t; connect t to u;` | ○ | | 端は名前で探し、見つかれば知らせない（一般ビューの線にはせず、内部ブロック図に描く）。2 段目から先は部品の本体をたどって確かめる |
| 単独の `connect a to b;` | ○ | | 名前の無い接続（ConnectionUsage、8.2.2.13.1）として読み、`connection connect a to b;` と同じく内部ブロック図の線にする |
| n 項の `connect (a, b, c)` | ○ | | 端をすべて残す（NaryConnectorPart、8.2.2.13.1）。内部ブロック図では、塗った点と、点から端ごとの矢印の無い線で描く（8.2.3.13 の n-ary-connection-dot・n-ary-segment）。一般ビューには線にしない。見つからない端は「見つかりません」と示す |
| `bind` / `binding` | ○ | | 名前の無いもの・名前付きのものを結び付けの使用として読み（BindingConnectorAsUsage、8.2.2.13.2）、親の「式」に入れない。内部ブロック図に、矢印の無い実線と「=」で描く（8.2.3.13 の binding-connection）。見つからない相手は「見つかりません」と示す |
| `succession` / `first … then` | ○ | | 継起（SuccessionAsUsage、8.2.2.14）として記録する（名前付きの `succession s first a then b;` の名前も）。アクション定義の中の継起は、アクションの流れ図に実線と開いた矢印で描く（8.2.3.17）。シナリオ（`occurrence def`）の中の継起は、シーケンス図の段の順を決め、別のライフラインのイベントの間なら破線と開いた矢印で描く（8.2.3.9 の sq-succession）。循環する順序は知らせる。見つからない相手は「見つかりません」と示す。状態定義の中の継起は記録するが、まだ線にしない（状態遷移は 2.7 の行） |
| `interface def` / `interface … connect` | ○ | | `interface i : I connect a.p to b.p;` を接続と同じく内部ブロック図の線にする |
| `connect` の無い `interface a.p to b.p;` | ○ | | `interface (a, b, c);` も含め、`interface connect …` と同じ接続にする |
| `allocation def` / `allocation` / `allocate` | ○ | | 定義と使用（`allocation` の無い `allocate x to y;` は名前の無い使用）として本体ごと読み（8.2.2.15）、図に描く要素の間に «allocate» の破線と開いた矢印を描く（8.2.3.15 の allocate-relationship）。見つからない相手は「見つかりません」と示す。n 項の `allocate (a, b, c)` は線にしない |
| `flow of F from a.p to b.p` | ○ | | |
| `from` の無い `flow a.p to b.p;` | ○ | | `flow from … to …` と同じ流れの線にする |
| 運ぶものに名前を付けた `flow of f : Fuel from …` | ○ | | 運ぶものの型 Fuel をラベルとアイテムにする（名前 f を型と取り違えない）。`message … of x : Sig` も同じ |
| `flow def`、名前付きのフロー | ○ | | `flow def` は定義、`flow f : FD from a.p to b.q;`・`flow f of I from … to …;` は使用として本体ごと読む（8.2.2.16）。名前付きのフローは名前の無いフローと同じ線にし、ラベルに `f : FD`・`f of I` を書く（8.2.3.16 の flow-label） |
| `succession flow` | ○ | | 順序付きの流れ（SuccessionFlowUsage、8.2.2.16）として記録し、名前付きのものは使用にする。アクションの流れ図に、破線と開いた矢印、アイテム（名前付きは名前と型）のラベルで描く。一般ビュー・内部ブロック図には描かない |
| `first` の無い `succession flow a.d to b.d;` | ○ | | アクティビティ図の順序付きの流れ（破線）にする |
| `message` | ○ | | シーケンス図。端の `a.ev`・`a.sub.ev` は、ライフラインの上のイベントにつなぐ。見つからない端は「見つかりません」と示す |
| `from` の無い `message a to b;` | ○ | | `message of M a to b;` も含め、シーケンス図のメッセージにする |

### 2.7 アクション・状態（8.2.2.17〜18）

| 要素 | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- |
| `action def` / `action` / `then action` | ○ | | 区画に手順として番号付きで並ぶ。アクションの流れ図には、角の丸い四角と継起の線で描く |
| アクションのパラメータ `in w : W;` | △ | 0.2.0 | 要素として読むが、アクティビティ図にパラメータとその間のフローを描かない |
| `perform action` | ○ | | `perform action a : A;` は種類 `perform action` の使用になる |
| 参照の形 `perform x.y;` | ○ | | 種類 `perform action` の使用（名前は y）にし、x.y を参照の相手として記録する。アクティビティ図の要素になる。`perform use case u : U;` は「まだ扱えない」と知らせる。指す先が無くても知らせない |
| アクションの継起 `first a1 then a2;` | ○ | | `first a then b;`・`then b;`（直前の要素から。続けて書いた `then` はどれも同じ要素から）・`then action b;`（`then` だけが継起）・`first start;`（続く継起の元）を読み、アクションの流れ図に描く。開始・終了（`start`・`done`）は塗った丸と、丸の中の塗った丸（8.2.3.17）。図から 2 つの要素の間に線を引くと `first a then b;` を書き、線を消すとその文（`then action b;` は `then` だけ）を消す |
| `fork` / `join` / `merge` / `decide` | ○ | | 書いた語を種類にした使用（ControlNode、8.2.2.17）。fork・join は太い棒、merge・decide はひし形で描き、名前を横に書く（8.2.3.17）。`if g then b;`・`else b;`・`first d if g then b;`（GuardedSuccession）のガードは、線のラベル `[g]`・`[else]` |
| `if` / `while` / `for` | ○ | | 書いた語（`loop` も）を種類にした使用（IfNode・WhileLoopNode・ForLoopNode、8.2.2.17）。条件（`for` は `x in xs`）と本体を記録し、`else` の本体と `else if` も本体に入れる。アクションの流れ図では «if» などの角の丸い四角に、条件と本体のアクションの名前（then と else を分ける）を書く。本体の中の継起は描かず、`until` の条件は記録しない |
| `send` / `accept` / `assign` / `terminate` | ○ | | 書いた語を種類にした使用（SendNode・AcceptNode・AssignmentNode・TerminateNode、8.2.2.17）。`action s send x;` のように名前も付けられる。`assign` は親の「式」に入れない。アクションの流れ図では、send は右が尖った五角形、accept は左がへこんだ五角形、ほかは «assign»・«terminate» の角の丸い四角に、送るもの・受けるもの・代入を書く（8.2.3.17）。受けるものの型は確かめない |
| `state def` / `state` / `exhibit state` | ○ | | 状態遷移図（StateTransitionView）では、状態を角の丸い四角に描き、入れ子の状態（`state on { state low; }`）は外の状態の中に描く（8.2.3.18）。「振る舞い」の図では、これまでどおり状態定義の区画に状態と遷移を並べる |
| 参照の形 `exhibit s;` | ○ | | 種類 `exhibit state` の使用（名前は s）にし、s を参照の相手として記録する |
| `parallel` | ○ | | 並行であることを記録し（StateDefBody の isParallel、8.2.2.18）、状態遷移図では、中の状態（領域）を上から積み、間を破線で区切る（8.2.3.18） |
| `entry` / `do` / `exit` | ○ | | 状態の振る舞い（StateSubactionMembership）として、書いた順に状態に記録し、状態遷移図の状態の区画に `entry / init` の形で書く（`action a` は `a`）。インスペクタにも出す。振る舞いを書かない `entry;` は記録せず、直後の `then s;`・`if g then s;` を、本体の最初の遷移（開始の記号から s への線）にする（EntryTransitionMember） |
| `transition … first a accept E then b` | ○ | | 名前・元・先・トリガ（受けるものと `via`。`at`・`after`・`when` は式のまま）・ガード・効果（`do` の後の振る舞い。本体も読む）を記録し（TransitionUsage、8.2.2.18）、状態遷移図に、実線と開いた矢印、ラベル `トリガ [ガード] / 効果` で描く（8.2.3.18）。`done` へ向かう遷移は終了の記号（丸の中の塗った丸）へ引く。端は書いた本体から外へ探し、`on.low` のような名前の道のりも読む。見つからない相手は問題として知らせる。図から線を消すとその文が消え、2 つの状態の間に線を引くと `transition first a then b;` を書く。「振る舞い」の図の区画の文字列は、これまでどおり「a → b [E]」（ガードと効果は書かない）。受けるものの型は確かめない |
| 省略形 `accept E then b` | ○ | | 状態の本体の `accept E via p if g do e then b;`・`if g do e then b;`・`then b;`・`first` の無い `transition … then b;` を、直前の状態からの遷移として記録する（TargetTransitionUsage、8.2.2.18）。状態遷移図と「振る舞い」の図の区画に出る |

### 2.8 計算・制約・要求・ケース（8.2.2.19〜25）

| 要素 | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- |
| `calc def` / `calc` / `return` | ○ | | 式は文字列 |
| `constraint def` / `constraint` | ○ | | 式は文字列（評価しない） |
| 本体が `true`・`false`・`not` で始まる制約・計算・`require` | ○ | | `null`・`new` も含め、式として持ち主に入れる（区画に出る）。`not satisfy` はこれまでどおり否定の satisfy |
| `assert constraint` / `assert not` | ○ | | `assert constraint { … }`・`assert not constraint d { … }` の式は持ち主の式として持ち、否定（`not`）を記録する。本体の無い `assert constraint c : CD;`・`assert not constraint c : CD;` も `c : CD` を持ち主の式にして否定を記録する。図では持ち主の区画に `assert { … }`・`assert not { … }` と書く（8.2.3.20 の assert-constraints-compartment）。式は文字列のまま（評価は 0.3.0 以降） |
| `requirement def` / `requirement` | ○ | | |
| `subject` / `stakeholder` | ○ | | |
| `require` / `assume constraint` | ○ | | `require constraint { … }`・`assume constraint { … }`（名前付きも）は式として入る。本体の無い `require c : CD;`・`require constraint c : CD;` も `c : CD` を式として残す（要求の区画に出る） |
| `actor` | ○ | | 型付きの要素になり、ツリーに出る（`subject`・`stakeholder` と違い、ツリーで隠さない） |
| `satisfy R by X` | ○ | | |
| 宣言する形 `satisfy requirement r : R by x;`、`view def` の中の `satisfy vp;` | ○ | | 型 R（無ければ特殊化などの最初の相手）を満たす線にする。`view def` の中の `satisfy vp;` は、視点が見つかれば知らせない（視点は描かないので線にしない） |
| `by` の無い `satisfy`、`assert satisfy`、`not satisfy` | ○ | | `satisfy R;` は持ち主（使用なら型の定義）から満たす線を引く。`assert satisfy R by X` は `satisfy R by X` と同じ。`not satisfy R by X` は関係として記録するが、線にせず、トレースの抜けの検出でも満たす要素に数えない |
| `concern def`、`frame concern c : C` | ○ | | |
| 型の無い `frame c;` | ○ | | 関心事の使用 c の型への «frame» の線にする。見つからなければ「見つかりません」と示す |
| `case def` / `case` | ○ | | ツリーに出る要素になる（図のノードにはしない）。本体（`subject`・`actor`・`objective` など）も読む |
| `objective` | ○ | | 目的の説明（`doc`）と式は、検証・解析の区画に `objective: …`・`objective { … }` と書く（8.2.3.22 の objective-compartment。目的を別の要素や線にする記法は 8.2.3 に無い）。持ち主の説明は上書きしない。中の `verify` は検証の線にする |
| `analysis def` / `analysis` | ○ | | |
| `verification def` / `verification` | ○ | | |
| `verify` | ○ | | 定義の中・package の直下の検証と解析の使用の中（型の有無によらず、使用から線を引く。8.2.3.24）で線になる |
| 宣言する形 `verify requirement r : R;` | ○ | | 型 R を検証する線にする |
| `use case def` / `use case` | ○ | | 専用のビューは無い |
| `include use case` | ○ | | 種類 `include use case` の要素になる（`include use case u : U;` は U を型にする。`include u;` は u を名前にし、型は付けない）。図の線は引かない |

### 2.9 ビュー（8.2.2.26）— ADR-0005

| 要素 | BNF | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- | --- |
| `view def` | ViewDefinition | ○ | | 標準ビュー定義の特殊化（`:>`・`specializes`）をたどる。中の `filter`・`render` は、その型の `view` に引き継ぐ。図のノードにはしない |
| `view` | ViewUsage | ○ | | 名前のある `view` を、＋メニューから図として開ける（F-VIEW-7）。型の無い `view` は GeneralView として描く |
| `expose`（`A`・`P::*`・`P::**`・`P::*::**`・`[...]` 付き） | Expose | △ | 0.2.0 | 修飾名は view から外へ最初の段を探し、中へたどる。同じファイルの `alias` は解決する。`import` を通した名前は解決しない |
| ビュー内の `filter` | ElementFilterMember | ○ | | `@メタクラス`（`@SysML::PartDefinition` など）・`@メタデータ`・`istype X`・`hastype X` を、`and`・`&`・`or`・`|`・`xor`・`not` と括弧で組み合わせた式（KerML 8.2.5.8.1 の優先順位）。expose の `[ ]` も同じ。メタデータの値の比較（`level > 1` など）を含む式は、知らせたうえで使わない（0.3.0 以降、式の評価と一緒に） |
| `render`（参照形） | ViewRenderingMember | △ | 0.3.0 以降 | `asTreeDiagram`・`asInterconnectionDiagram` と、それを特殊化・再定義・参照した `rendering`（`rendering myIbd :> asInterconnectionDiagram;`）は型より優先する。特殊化や本体が続く形（`render asTreeDiagram :> base { … }`）も読む。`asTextualNotation`・`asElementTable` は知らせて図で描く |
| `render`（合成形） | ViewRenderingUsage | ○ | | `render rendering r :> asTreeDiagram { … }`・`render rendering r redefines Views::asInterconnectionDiagram;` を view の中の `rendering` の使用として本体ごと読み、特殊化・再定義・参照の相手をたどって描き方を決める（以前は相手のある形を黙って捨て、ほかは「まだ扱えない」と知らせていた）。標準の表し方に行き着かない形（`render rendering r : R;`）は知らせて図で描く |
| `viewpoint def` / `viewpoint` | ViewpointDefinition / Usage | ○ | | ツリーに出る要素になる（`view def` と同じく図のノードにはしない。`view` とは取り違えない）。中の `frame concern c : C;` は関係として記録するが、視点を図に描かないので線は引かない |
| `rendering def` / `rendering` | RenderingDefinition / Usage | ○ | | ツリーに出る要素になる（図のノードにはしない） |

### 2.10 メタデータ（8.2.2.27）

| 要素 | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- |
| `metadata def` | ○ | | フェーズに使う。図のノードにはしない |
| `@M { k = E::V; }` | ○ | | 値は式の全体（`k = 1 + 2` は `1 + 2`）。列挙値などの修飾名（`E::V`）だけは最後の名前（フェーズに使う）。本体の無い `@M;` も持ち主に `M` を付ける |
| 再定義の形 `@M { :>> x = 1; }`・`redefines x = 1` | ○ | | `@M { k = v; }` と同じく値をメタデータに記録する。持ち主の「式」に入れない |
| `metadata M about A { … }` | ○ | | `about` の相手（修飾名・特徴の連鎖も）を書いた場所から探し、それぞれに `M` と本体の値を付ける。見つからない相手は問題一覧に示す。`about` の無い `metadata M;` は持ち主に付ける（`@M;` と同じ） |
| 前置の `#M part def A;` | ○ | | 宣言を読み、`M` をメタデータとして記録する（ADR-0013） |
| 利用者定義のキーワード `#X def`・`#X x;` | ○ | | メタデータの定義 `X` が `:>> baseType = … meta SysML::PartUsage;` で基の型を決めていれば、その種類（`part def`・`part` など）として読む。決まらなければ種類 `def`・`usage` の要素としてツリーにだけ出す。どちらも `X` をメタデータとして記録する |

### 2.11 式・KerML

| 要素 | 対応 | 予定 | 根拠・備考 |
| --- | --- | --- | --- |
| 式・単位 `1500 [kg]` | △ | 0.3.0 以降 | 文字列として保持するだけ |
| 本体付きの式 `a.b->collect{ in i; i*2 }` | △ | 0.3.0 以降 | `xs.{ … }`・`xs.?{ … }` も含め、対応する `}` までを式の文字列として持つ（評価しない） |
| 特徴量の連鎖 `a.b.v` | ○ | | 各段を、前の段の本体・型の定義（とその一般の定義）・部分集合や再定義の相手の中から探す（FeatureChain、8.2.2.6）。接続・フロー・結び付け・メッセージの端の 3 段目から先（`a.b.c.p`）も確かめ、見つからない段は「「a.b.x」の「x」が見つかりません」と示す。型の無い要素とファイルの外の型の中は確かめない。内部ブロック図では、どの深さの部品の中の部品にもつなぐ |
| KerML のキーワード（`classifier`・`class`・`struct`・`feature`・`datatype`・`function` など） | × | 0.3.0 以降 | KerML の文法は読まない。`classifier`・`function`・`struct`・`feature` などの宣言は、本体ごと「まだ扱えない」と知らせ、中身を外の package の要素にしない。`.kerml` ファイルは開けるが、中身は読めない |

## 3. 図・ビュー（言語仕様 7.26・8.2.3・9.2.20）

仕様では、図は `view` の使用で表し、`expose` → `filter` → `render` の順に組み立てる。
グラフィカル記法に適合するツールは、標準ビュー定義（Table 34）を必ず扱う。

テキストの `view` は、型の標準ビュー定義（と `render`）から描き方を決め、`expose`・`filter` で決まる要素だけを描く（`crates/modelith-core/src/model/views.rs`）。
配置は配置ファイルの `view:<名前>` に、view ごとに保存する（内部ブロック図・シーケンス図は、対象ごとの配置を自動の図と共有する）。
画面では、標準ビュー定義を広く知られた図の名前（下の表の「画面の名前」）で呼び、＋メニュー・タブ・作成した図のサブバーのツールチップに標準ビュー定義の名前を添える（狭い画面では＋メニューの項目の下に小さく書く。ADR-0014）。

| 標準ビュー定義 | 短い名前 | 画面の名前 | `view` の描き方 | 対応 | 予定 |
| --- | --- | --- | --- | --- | --- |
| GeneralView | `gv` | 一般ビュー | ノードと線の図（expose した要素と、その間の関係） | △ 図のノードにするのは、定義と、package の直下の `part`・`requirement`・`verification`・`analysis` の使用だけ（`action`・`item`・`state`・`use case` の使用と `case def` は描かない。ユースケースの楕円・アクターの記号も無い）。特殊化・部分集合・再定義・参照・依存・割り当ての線と多重度、メモ（`comment … about`。角を折った四角と破線、8.2.3.4）は 8.2.3 の記法で描く。定義の中の特性どうしの線と、別の言語での表し方（`rep`）・`doc` の記号は無い | 0.2.0（ユースケースの楕円・アクターの記号は 0.3.0 以降） |
| InterconnectionView | `iv` | 内部ブロック図 | 内部ブロック図（expose した part def、または part の型が対象） | △ 部品の本体に書いた部品（どの深さでも）と、線の端 `a.b.p`・`a.b.c.p` が指す型の中の部品を、外の部品の中に描く。部品の型の中の線も描く。結び付けは「=」の線、n 項の接続は点と端ごとの線で描く。対象そのもののポートへの線、入れ子の部品のポートを作る操作は無い | 0.2.0 |
| ActionFlowView | `afv` | アクティビティ図 | アクティビティ図（expose した action def が対象。自動の図「アクティビティ図」とツリーの「アクティビティ図で開く」でも開ける） | △ アクション・制御の節・送信と受信・開始と終了と、ガード付きの継起・順序付きの流れを 8.2.3.17 の記法で、継起の向きに上から並べて描く。アクションのパラメータとその間のフロー、入れ子の本体の流れ、区画（swim lane）は無い | 0.2.0 |
| StateTransitionView | `stv` | 状態遷移図 | 状態遷移図（expose した state def が対象。ツリーの「状態遷移図で開く」でも開ける。組み込みのビューの一覧には出さない） | △ 状態・入れ子の状態・並行の領域（破線で区切る）・entry／do／exit の区画・開始と終了の記号と、遷移を `トリガ [ガード] / 効果` のラベルの線で、8.2.3.18 の記法で描く。本体ごとに、遷移の向きに左から並べる。図から遷移を消す・引く（`transition first a then b;`）。expose した state def が複数あっても最初の 1 つだけを描き、状態の使用（`exhibit state s { … }`）の中の遷移、効果の本体の中身、線の交差を避ける配置は無い | 0.3.0 以降 |
| SequenceView | `sv` | シーケンス図 | シーケンス図（expose した occurrence def が対象） | △ ライフライン・メッセージ・ライフラインの上のイベント（白抜きの丸と `.ev` の札。入れ子の部品のイベントは `.sub.ev`、ライフラインの型の中のイベントも）・別のライフラインのイベントの間の順序（破線と開いた矢印）を、8.2.3.9 の記法で描く。時間は上から下へ進み、メッセージとメッセージの端でないイベントが 1 段ずつ使い、段は順序（`first … then`・`then event occurrence`）を守り、ほかは書いた順にする。図から順序の線を消す。複合フラグメント（`alt`・`loop` に当たるもの）、入れ子のシーケンス図（view の参照）、ライフラインの頭のポート（sq-port）、入れ子の部品ごとのライフライン、図からイベントや順序を足す操作は無い | 0.3.0 以降 |
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
- `SysML::PartDefinition`・`KerML::Feature` のように `SysML`・`KerML` で修飾したメタクラスの名前は、標準ライブラリの型とみなす（メタデータの定義の `:>> annotatedElement : SysML::PartDefinition;` など）。
- キーワードの無い特性（`x : Real;`）を読むので、別のファイル（標準ライブラリを含む）の型を持つ特性は、ほかの使用と同じく「型が見つかりません」になる（ファイルをまたぐ名前の解決は 0.2.0）。
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
- 定義の外での列挙の使用
- KerML の式の文法（8.2.5）
