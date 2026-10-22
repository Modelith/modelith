// コアと画面の間の型（解析結果とモデル）。Rust のコアの結果は rust.ts がこの形に戻し、UI はこの型だけに依存する（ADR-0015・ADR-0016）。

/** テキスト上の範囲（UTF-16 オフセット、end は含まない）。 */
export interface Span {
  start: number;
  end: number;
}

/** 要素に書かれた式（制約式・require など）。`via` は囲んでいる無名ブロックのキーワード。 */
export interface Expr {
  text: string;
  via: string;
  /** 否定した制約（`assert not constraint …`、8.2.2.20）。否定していなければ無い。Rust のコアだけが作る。 */
  neg?: boolean;
}

/** 名前を持たないブロック（`objective { … }`、`@Phase { … }` など）。 */
export interface Block {
  anon: true;
  kw: string;
  head: string;
  start: number;
  owner: Scope | null;
  open?: number;
  close?: number;
  end?: number;
}

/** 宣言 1 つ（定義・使用・パラメータ）。 */
export interface Entry {
  anon?: undefined;
  kind: string;
  isDef: boolean;
  short: string;
  name: string;
  /** 共役ポート（`~T`）。パラメータには無い。 */
  conj?: boolean;
  type: string;
  owner: Scope | null;
  /** 名前を持つ最も近い親。 */
  pe: Entry | null;
  start: number;
  headEnd: number;
  end: number;
  head: string;
  /** 修飾子（`in`・`private` など）。パラメータは代わりに `dir` を持つ。 */
  mods?: string;
  dir?: string;
  exprs: Expr[];
  children: Entry[];
  idx: number;
  value?: string;
  /**
   * 値の書き方（FeatureValue、8.2.2.6）。`:=` は初期値、`default`・`default =`・`default :=` は既定値。
   * `=`（束縛）のときは無い。Rust のコアだけが作る。
   */
  valueOp?: string;
  doc?: string;
  /** ケース・解析・検証の目的（`objective { doc /* … *\/ }`、8.2.2.21）の説明。Rust のコアだけが作る。 */
  objective?: string;
  meta?: Record<string, Record<string, string>>;
  phaseVal?: Span;
  phaseBlock?: Scope;
  enumValues?: string[];
  /** view・view def の expose（8.2.2.26.2）。 */
  exposes?: Expose[];
  /** view・view def の filter の式（`filter` の後ろ。8.2.2.5.1 ElementFilterMember）。 */
  filters?: string[];
  /** view・view def の render の参照（`render asTreeDiagram;` の asTreeDiagram）。 */
  render?: string;
  open?: number;
  close?: number;
  /** 特殊化・部分集合・再定義・参照の相手（8.2.2.6）。Rust のコアだけが作る。 */
  specs?: Spec[];
  /** 多重度（MultiplicityPart、8.2.2.6）。Rust のコアだけが作る。 */
  multiplicity?: Multiplicity;
  /** コメント（種類 `comment`、8.2.2.4）の本文。行は改行でつなぐ。Rust のコアだけが作る。 */
  body?: string;
  /** コメントが注釈する宣言（`about` の相手。無ければ持ち主）。Rust のコアだけが作る。 */
  about?: Entry[];
  /** 別の言語での表し方（`rep … language "x" /* … *\/`、TextualRepresentation、8.2.2.4）。Rust のコアだけが作る。 */
  reps?: Rep[];
  /** `if`・`while` のアクションの条件、`for` のアクションの `変数 in 列`（8.2.2.17）。Rust のコアだけが作る。 */
  guard?: string;
  /** 状態の `entry`・`do`・`exit` の振る舞い（書いた順、8.2.2.18）。振る舞いを書かない `entry;` は入らない。Rust のコアだけが作る。 */
  stateActions?: StateAction[];
  /** 並行の状態（`state def S parallel { … }`、8.2.2.18）。Rust のコアだけが作る。 */
  parallel?: boolean;
}

/** 状態の振る舞い 1 つ（`entry a;`・`do action a;`・`exit send S() to b;`、8.2.2.18）。 */
export interface StateAction {
  /** いつ行うか。 */
  kind: "entry" | "do" | "exit";
  /** キーワードの後ろ（`a`・`action a`・`send S() to b` など）。 */
  text: string;
}

/** 別の言語での表し方 1 つ（TextualRepresentation、8.2.2.4）。 */
export interface Rep {
  /** 名前（`rep r` の `r`）。無ければ空文字列。 */
  name: string;
  /** 言語の名前（`language "OCL"` の OCL）。 */
  language: string;
  /** 本文（共通の字下げを除いたもの。行は改行でつなぐ）。 */
  body: string;
}

/** 宣言の特殊化の相手 1 つ（SubclassificationPart・FeatureSpecializationPart、8.2.2.6）。 */
export interface Spec extends Span {
  /** 定義の `:>`・`specializes` は specializes、使用の `:>`・`subsets` は subsets、`:>>` は redefines、`::>` は references、`=>`・`crosses` は crosses。 */
  op: "specializes" | "subsets" | "redefines" | "references" | "crosses";
  /** 相手（書いた修飾名・特徴の連鎖。空白を除き、引用符は残す）。 */
  target: string;
}

/** 多重度と並びの性質（MultiplicityPart、8.2.2.6）。 */
export interface Multiplicity {
  /** `[` と `]` の中（`0..4`・`*`）。範囲を書いていなければ空文字列。 */
  range: string;
  ordered: boolean;
  nonunique: boolean;
}

/** `expose` 1 つ（Expose、8.2.2.26.2）。 */
export interface Expose extends Span {
  /** 対象の修飾名（`A::B`）。 */
  target: string;
  /** `::*`：対象そのものではなく、その中身を出す（NamespaceExpose）。 */
  members: boolean;
  /** `::**`：入れ子の中身もすべて出す。 */
  recursive: boolean;
  /** `[...]` の絞り込みの式（FilterPackageMember）。 */
  filter?: string;
}

export type Scope = Entry | Block;

interface RelBase {
  pe: Entry | null;
  start: number;
  end: number;
}

/** 要素間の関係を表す文。 */
export type Rel =
  | (RelBase & { rel: "derive" | "dependency"; a: string; b: string })
  | (RelBase & { rel: "message"; name: string; item: string; a: string; b: string })
  | (RelBase & { rel: "satisfy"; req: string; by: string })
  | (RelBase & { rel: "verify"; req: string })
  | (RelBase & { rel: "frame"; name: string; type: string })
  /** 名前付きのフロー（`flow f : FD from a to b;`、8.2.2.16）は、名前・型・使用を持つ。Rust のコアだけが作る。 */
  | (RelBase & { rel: "flow"; item: string; a: string; b: string; name?: string; type?: string; usage?: Entry })
  /** `ends` は端が 3 つ以上のときだけある（n 項の `connect (a, b, c)`、8.2.2.13.1）。Rust のコアだけが作る。 */
  | (RelBase & { rel: "connect"; a: string; b: string; item: string; usage: Entry; ends?: string[] })
  /**
   * 遷移（`transition t first a accept E via p if g do e then b;`、状態の中の `accept E then b;`・`if g then b;`・`then b;`、8.2.2.18）。
   * 名前・`via`・ガード・効果は Rust のコアだけが記録する（モックの出力は `from`・`ev`・`to` だけ）。
   */
  | (RelBase & { rel: "transition"; from: string; ev: string; to: string; name?: string; via?: string; guard?: string; effect?: string })
  /** 状態の本体の最初の遷移（`entry; then s;`・`entry; if g then s;`、EntryTransitionMember、8.2.2.18）。Rust のコアだけが作る。 */
  | (RelBase & { rel: "entryTransition"; to: string; guard?: string })
  /** `bind a = b;`（BindingConnectorAsUsage、8.2.2.13.2）。Rust のコアだけが作る。 */
  | (RelBase & { rel: "bind"; a: string; b: string; usage: Entry })
  /** `allocate x to y;`（AllocationUsage、8.2.2.15）。Rust のコアだけが作る。 */
  | (RelBase & { rel: "allocate"; a: string; b: string; usage: Entry })
  /**
   * 継起（`first a then b;`・`then b;`・`if g then b;`・`else b;`、8.2.2.14・8.2.2.17）。`a` が終わってから `b` を始める。
   * 直前の要素から引く継起では、`a` はその要素の名前（名前の無い要素なら空）。`guard` は `if` の条件（`else` は "else"）。Rust のコアだけが作る。
   */
  | (RelBase & { rel: "succession"; a: string; b: string; guard?: string; name?: string })
  /** 順序付きの流れ（`succession flow of I from a.x to b.y;`、8.2.2.16）。Rust のコアだけが作る。 */
  | (RelBase & { rel: "successionFlow"; item: string; a: string; b: string; name?: string; type?: string; usage?: Entry });

export type FlowRel = Extract<Rel, { rel: "flow" | "connect" }>;
export type MessageRel = Extract<Rel, { rel: "message" }>;

export interface ParseError {
  pos: number;
  msg: string;
}

export interface ParseResult {
  entries: Entry[];
  rels: Rel[];
  errors: ParseError[];
  /** `/* @layout {…} *\/` コメントの中身（未検証の JSON）。 */
  layout: Record<string, unknown>;
  /** 予約語で始まるのに、どの読み方にも当たらなかった文（まだ扱えない構文。ADR-0013）。 */
  unsupported: Unsupported[];
}

/** まだ扱えない文。 */
export interface Unsupported {
  start: number;
  end: number;
  /** 文の頭（空白を詰めたもの）。 */
  head: string;
}

export type Family = "req" | "concern" | "ver" | "con" | "beh" | "part" | "other";
export type PortDir = "in" | "out" | "inout";

export interface Port {
  name: string;
  type: string;
  conj: boolean;
  dir: PortDir;
  entry: Entry;
}

/** 図に投影する要素。 */
export interface ModelNode {
  key: string;
  name: string;
  short: string;
  kind: string;
  isDef: boolean;
  entry: Entry;
  fam: Family;
  trans: string[];
  ports: Port[];
  phase: string | null;
  phaseOwn: boolean;
  /** 内部ブロック図の部品（使用）。 */
  usage?: boolean;
  /** シーケンス図のライフライン。 */
  lifeline?: boolean;
  /** 内部ブロック図の n 項の接続の点（8.2.3.13 の n-ary-connection-dot）。`entry` は接続の使用。 */
  junction?: boolean;
  /** 内部ブロック図の対象そのもののポート（枠の上に描く、8.2.3.13）の向き。`entry` はポートの宣言。 */
  boundary?: PortDir;
  /** 一般の図のメモ（8.2.3.4 の comment）。`entry` はコメントの宣言。 */
  note?: boolean;
  /**
   * アクションの流れの図の要素（8.2.3.17）。形は種類（`start`・`done`・`fork`・`decide`・`send` など）で決まる。
   * 開始・終了の `entry` は、図の対象のアクション定義。
   */
  flow?: boolean;
  /**
   * 状態遷移の図の要素（8.2.3.18）。状態は角の丸い四角、開始は塗った丸、終了は丸の中の塗った丸。
   * 開始・終了の `entry` は、図の対象の状態定義。
   */
  state?: boolean;
  /** 並行の状態（状態遷移の図で、中の状態を破線で区切った領域に描く、8.2.3.18）。 */
  parallel?: boolean;
  /** この要素を中に描く外の要素のキー（内部ブロック図の入れ子の 2 段目の部品、状態遷移の図の入れ子の状態）。 */
  container?: string;
  /** ポートを追加する先（使用の場合は型の定義）。 */
  portHost?: Entry;
  typeKey?: string | null;
}

/**
 * 線の種類。`specialize`・`subset`・`redefine`・`reference`・`dependency`・`allocate` は特殊化・部分集合・再定義・参照・依存・
 * 割り当て（8.2.3）で、Rust のコアだけが作る。`bind` は内部ブロック図の結び付け（8.2.3.13 の binding-connection）、
 * `connect` は n 項の接続の点から端への線（8.2.3.13 の n-ary-segment）。`annotate` はメモから注釈する要素への破線（8.2.3.4 の annotation-link）。
 * `succession`・`successionFlow` はアクションの流れの図の継起と順序付きの流れ（8.2.3.17）。`transition` は状態遷移の図の遷移（8.2.3.18）。
 */
export type EdgeKind =
  | "defined" | "comp" | "satisfy" | "verify" | "frame" | "flow" | "derive" | "message"
  | "specialize" | "subset" | "redefine" | "reference" | "dependency" | "allocate" | "bind" | "connect" | "annotate"
  | "succession" | "successionFlow" | "transition";

/** 図に投影する関係。 */
export interface ModelEdge {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  label: string;
  src: Span;
  rel?: Rel;
  fromPort?: string;
  toPort?: string;
  /** シーケンス図のメッセージの順番。 */
  idx?: number;
  /** シーケンス図のメッセージの段（上から何段目か。0 から）。 */
  row?: number;
  /** メッセージのアイテム型。 */
  type?: string;
  /** 終わりの端に書く文字（部品として持つ線の多重度と飾り。`[4]`・`ordered`・`redefines w` など。8.2.3）。Rust のコアだけが作る。 */
  endLabel?: string;
}

export interface Problem {
  pos: number;
  msg: string;
  /** 無し：エラー。gap：トレースの抜け。unsupported：まだ扱えない構文（エラーではない）。 */
  kind?: "gap" | "unsupported";
}

export interface PhaseInfo {
  value: string;
  own: boolean;
  holder: Entry;
}

/** Modelith の描き方（標準のビュー定義に対応させる、ADR-0005）。 */
export type ViewKind = "general" | "interconnection" | "stateTransition" | "sequence" | "actionFlow";

/** 図に出した package（package そのものを expose したもの）。枠として描き、中の要素を枠の中に示す（F-VIEW-9）。 */
export interface ModelFrame {
  name: string;
  entry: Entry;
  /** 枠の中に示す要素（package の中の、図に描く要素）のキー。 */
  nodeKeys: string[];
}

/** テキストに書かれた view（図として表示する）。 */
export interface ModelView {
  name: string;
  entry: Entry;
  /** 描き方。 */
  kind: ViewKind;
  /** 型をたどって見つけた標準のビュー定義（GeneralView など。無ければ null）。 */
  std: string | null;
  /** 描く要素（expose と filter の結果）のキー。 */
  nodeKeys: string[];
  /** expose の対象そのもの（内部ブロック図・シーケンス図の対象を決めるのに使う）。 */
  targets: Entry[];
  /** 枠として描く package（外側から順）。 */
  frames: ModelFrame[];
}

export interface Model {
  nodes: ModelNode[];
  /** テキストに書かれた view（ADR-0005、F-VIEW-7）。 */
  views: ModelView[];
  edges: ModelEdge[];
  problems: Problem[];
  nodeOf: Map<Entry, ModelNode>;
  byName: Map<string, Entry[]>;
  rels: Rel[];
  phases: string[] | null;
  phaseEnum: string | null;
  phaseOf: (e: Entry) => PhaseInfo | null;
  /** 図に描くメモ（コメント、8.2.3.4）。Rust のコアだけが作る。 */
  notes?: ModelNote[];
  /** アクション定義ごとの、アクションの流れの図（ActionFlowView、8.2.3.17）。Rust のコアだけが作る。 */
  actionFlows?: ModelActionFlow[];
  /** 状態定義ごとの、状態遷移の図（StateTransitionView、8.2.3.18）。Rust のコアだけが作る。 */
  stateMachines?: ModelStateMachine[];
  /** シナリオごとの、シーケンス図（SequenceView、9.2.20.2.7・8.2.3.9）。Rust のコアだけが作る。 */
  sequences?: ModelSequence[];
}

/** シーケンス図のライフライン（シナリオの直下の、名前のある部品と出来事）。 */
export interface ModelLifeline {
  /** 図の要素のキー（`l:名前`）。 */
  key: string;
  name: string;
  /** 部品か出来事の宣言。 */
  entry: Entry;
}

/** シーケンス図の、ライフラインの上のイベント（8.2.3.9 の sq-proxy）。 */
export interface ModelSequenceEvent {
  /** キー（`e:ライフライン.連鎖`）。 */
  key: string;
  /** イベントを描くライフラインのキー。 */
  lifeline: string;
  /** 札（`.ev`・`.sub.ev`）。 */
  label: string;
  /** イベントの宣言。ライフラインの本体に宣言が無いものは null。 */
  entry: Entry | null;
  /** 上から何段目か（0 から）。 */
  row: number;
}

/** シーケンス図のメッセージ。 */
export interface ModelSequenceMessage {
  /** 線の ID（`msg|書いた順の番号|名前`）。 */
  id: string;
  /** 送り手・受け手のライフラインのキー。 */
  from: string;
  to: string;
  /** 送り手・受け手のイベントのキー（端が `a.ev` のとき）。 */
  fromEvent?: string;
  toEvent?: string;
  /** 上から何段目か（0 から）。 */
  row: number;
  /** メッセージの関係。 */
  rel: Rel;
}

/** シナリオ 1 つの、シーケンス図（SequenceView、9.2.20.2.7）。時間は上から下へ進む。 */
export interface ModelSequence {
  /** シナリオの、図の要素のキー。 */
  key: string;
  /** シナリオの宣言。 */
  entry: Entry;
  /** ライフライン（左から）。 */
  lifelines: ModelLifeline[];
  /** イベント（段の順）。 */
  events: ModelSequenceEvent[];
  /** メッセージ（段の順）。 */
  messages: ModelSequenceMessage[];
  /** 別のライフラインのイベントの間の順序（succession）の線。端はイベントのキー。 */
  successions: ModelEdge[];
  /** 段の数。 */
  rows: number;
}

/** 状態遷移の図の要素 1 つ（状態と、本体ごとの開始・終了の記号）。 */
export interface ModelStateNode {
  /** 図の要素のキー（`s:名前`・入れ子は `s:外.中`・`s:頭#番号`・開始と終了は `s:頭#start`・`s:頭#done`）。 */
  key: string;
  /** 名前（名前の無い状態は空文字列。開始・終了は `start`・`done`）。 */
  name: string;
  /** 種類（`state`・`exhibit state`。開始・終了は `start`・`done`）。 */
  kind: string;
  /** 宣言。開始・終了は宣言を持たないので null。 */
  entry: Entry | null;
  /** この要素を中に描く状態のキー。状態定義の直下なら無い。 */
  container?: string;
  /** 並行の状態か。 */
  parallel?: boolean;
}

/** 状態定義 1 つの、状態遷移の図（8.2.3.18）。 */
export interface ModelStateMachine {
  /** 状態定義の、図の要素のキー。 */
  key: string;
  /** 状態定義の宣言。 */
  entry: Entry;
  /** 並行の状態定義か。 */
  parallel: boolean;
  /** 要素（外の状態の直後に中の状態。本体ごとに、開始・書いた順の状態・終了の順）。 */
  nodes: ModelStateNode[];
  /** 遷移（transition）の線。端は nodes のキー。ラベルは `トリガ [ガード] / 効果`。 */
  edges: ModelEdge[];
}

/** アクションの流れの図の要素 1 つ（アクション・制御の節・送受信などと、暗黙の開始・終了）。 */
export interface ModelFlowNode {
  /** 図の要素のキー（`a:名前`・`a:#番号`・`a:start`・`a:done`）。 */
  key: string;
  /** 名前（名前の無い要素は空文字列）。 */
  name: string;
  /** 種類（`action`・`fork`・`send` など。開始・終了は `start`・`done`）。 */
  kind: string;
  /** 宣言。開始・終了は宣言を持たないので null。 */
  entry: Entry | null;
}

/** アクション定義 1 つの、アクションの流れの図（8.2.3.17）。 */
export interface ModelActionFlow {
  /** アクション定義の、図の要素のキー。 */
  key: string;
  /** アクション定義の宣言。 */
  entry: Entry;
  /** 要素（開始、書いた順の要素、終了の順）。 */
  nodes: ModelFlowNode[];
  /** 継起（succession）と順序付きの流れ（successionFlow）の線。端は nodes のキー。 */
  edges: ModelEdge[];
}

/** 図に描くメモ 1 つ（注釈する要素のうち、図に描く要素があるコメント）。 */
export interface ModelNote {
  /** 図の要素のキー（`note:名前`・`note:#番号`）。 */
  key: string;
  /** コメントの宣言。 */
  entry: Entry;
  /** 注釈する、図に描く要素のキー。 */
  targets: string[];
}
