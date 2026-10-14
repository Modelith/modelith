// 暫定コア（ADR-0009）の型。Rust コアへ差し替えるまで UI はこの型だけに依存する。

/** テキスト上の範囲（UTF-16 オフセット、end は含まない）。 */
export interface Span {
  start: number;
  end: number;
}

/** 要素に書かれた式（制約式・require など）。`via` は囲んでいる無名ブロックのキーワード。 */
export interface Expr {
  text: string;
  via: string;
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
  doc?: string;
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
  | (RelBase & { rel: "flow"; item: string; a: string; b: string })
  | (RelBase & { rel: "connect"; a: string; b: string; item: string; usage: Entry })
  | (RelBase & { rel: "transition"; from: string; ev: string; to: string });

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
  /** ポートを追加する先（使用の場合は型の定義）。 */
  portHost?: Entry;
  typeKey?: string | null;
}

export type EdgeKind = "defined" | "comp" | "satisfy" | "verify" | "frame" | "flow" | "derive" | "message";

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
  /** メッセージのアイテム型。 */
  type?: string;
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
export type ViewKind = "general" | "interconnection" | "stateTransition" | "sequence";

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
}
