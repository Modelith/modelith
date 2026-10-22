// アプリの状態。テキストが唯一の正本で、P（解析結果）・M（モデル）・layout はテキストから作り直す（ADR-0001）。

import type { Model, ParseResult, PlacedDiagnostic, PortDir, RuleFinding } from "../core";
import type { Layout, Side } from "./layout";
import type { PluginNote } from "./plugins";
import type { GapFocus, GapKind } from "./trace-gap";

/** 図の縁上の位置（接続点があればその ID）。 */
export interface EndSpec {
  node: string;
  side: Side;
  t: number;
  pin: string | null;
}

export interface Transform {
  x: number;
  y: number;
  s: number;
}

export type Tool = { hand: true } | { kind: string } | { usage: string };

export type WireDrag =
  | { seq?: false; from: EndSpec; x: number; y: number; target: (EndSpec & { d: number }) | null }
  | { seq: true; from: string; x: number; y: number; target: string | null };

export interface PortFormState {
  dir: PortDir;
  name?: string;
  type?: string;
}

export interface Tab {
  id: number;
  /** 描き方（自動の図の id）。テキストの view のタブでは、その描き方に当たる自動の図の id。 */
  view: string;
  ctx: string | null;
  phase: string;
  /** テキストに書かれた view の名前（F-VIEW-7）。無ければ自動の図。 */
  mv?: string;
  tf?: Transform;
}

export interface UiPrefs {
  tree: boolean;
  text: boolean;
  treeW: number;
  textW: number;
  mini: boolean;
}

export interface MiniState {
  g: { x0: number; y0: number; x1: number; y1: number };
  s: number;
  pad: number;
}

export interface AppState {
  text: string;
  P: ParseResult;
  M: Model;
  view: string;
  /** 表示中のタブが、テキストに書かれた view ならその名前（F-VIEW-7）。 */
  modelView: string | null;
  layout: Layout;
  sel: string | null;
  selEdge: string | null;
  selSet: Set<string>;
  selPin: { node: string; pin: string } | null;
  mode: "connect" | null;
  connectFrom: string | null;
  connectTo: string | null;
  /** 抜けの案内の「関係を追加」で始めた接続なら、解消する抜けの種類（候補を、抜けを解消できる相手に絞る。F-TRACE-2）。 */
  connectGap: GapKind | null;
  wire: { from: EndSpec; to: EndSpec | null } | null;
  wireDrag: WireDrag | null;
  tf: Transform;
  tool: Tool | null;
  band: { x0: number; y0: number; x1: number; y1: number } | null;
  mini: MiniState | null;
  edgeStyle: "ortho" | "curve";
  hover: EndSpec | null;
  hoverKey: string;
  portForm: false | true | PortFormState;
  prevSig: Map<string, string>;
  pulse: Set<string>;
  flash: [number, number] | null;
  textMark: [number, number] | null;
  /** インスペクタで案内しているトレースの抜け（F-TRACE-2）。選択を外すと消える。 */
  gap: GapFocus | null;
  confirmDel: boolean;
  renaming: boolean;
  /** インスペクタで説明（要求の文章など）を編集しているとき（F-EDIT-12）。 */
  docEdit: boolean;
  /** インスペクタで編集している属性（F-EDIT-12）。null：編集していない・"" ：新しい属性を足す・名前：その属性を書き換える。 */
  attrEdit: string | null;
  msgEdit: boolean;
  phase: string;
  ibdCtx: string | null;
  seqCtx: string | null;
  /** アクションの流れの図の対象（アクション定義のキー）。 */
  flowCtx: string | null;
  /** 状態遷移の図の対象（状態定義のキー）。 */
  stateCtx: string | null;
  spaceDown: boolean;
  ui: UiPrefs;
  tabs: Tab[];
  tabId: number | null;
  treeOpen: Map<string, boolean>;
  treeQ: string;
  treeSel: number | null;
  treeScrollForce: boolean;
  /** 今のテキストへの、チェックルールの結果（ADR-0018 §2。プラグインが無ければ空）。 */
  findings: RuleFinding[];
  /** 問題一覧に出す、プラグインについての行（足りないプラグイン・読み込みの問題）。 */
  pluginNotes: PluginNote[];
  /** プラグインの ID → 画面に出す名前。 */
  pluginNames: Map<string, string>;
  /** v1 のプラグインが出した診断（プラグインごとに最後のもの。version はそれを出したテキストの版。dropped は件数の上限を超えて捨てた数）。 */
  pluginDiagnostics: { plugin: string; version: number; items: PlacedDiagnostic[]; dropped: number }[];
}

/** 唯一のアプリ状態。起動時に main.ts が P・M を埋める。 */
export const S: AppState = {
  text: "",
  P: { entries: [], rels: [], errors: [], layout: {}, unsupported: [] },
  M: {
    nodes: [], views: [], edges: [], problems: [], nodeOf: new Map(), byName: new Map(), rels: [], phases: null, phaseEnum: null,
    phaseOf: () => null,
  },
  view: "trace",
  modelView: null,
  layout: {},
  sel: null,
  selEdge: null,
  selSet: new Set(),
  selPin: null,
  mode: null,
  connectFrom: null,
  connectTo: null,
  connectGap: null,
  wire: null,
  wireDrag: null,
  tf: { x: 40, y: 40, s: 1 },
  tool: null,
  band: null,
  mini: null,
  edgeStyle: "ortho",
  hover: null,
  hoverKey: "",
  portForm: false,
  prevSig: new Map(),
  pulse: new Set(),
  flash: null,
  textMark: null,
  gap: null,
  confirmDel: false,
  renaming: false,
  docEdit: false,
  attrEdit: null,
  msgEdit: false,
  phase: "",
  ibdCtx: null,
  seqCtx: null,
  flowCtx: null,
  stateCtx: null,
  spaceDown: false,
  ui: { tree: true, text: true, treeW: 250, textW: 440, mini: true },
  tabs: [],
  tabId: null,
  treeOpen: new Map(),
  treeQ: "",
  treeSel: null,
  treeScrollForce: false,
  findings: [],
  pluginNotes: [],
  pluginNames: new Map(),
  pluginDiagnostics: [],
};

/** 選択と一時的な操作状態をすべて外す。 */
export function clearSel(): void {
  S.selSet = new Set();
  S.band = null;
  S.treeSel = null;
  S.textMark = null;
  S.gap = null;
  S.msgEdit = false;
  S.sel = null;
  S.selEdge = null;
  S.selPin = null;
  S.portForm = false;
  S.renaming = false;
  S.docEdit = false;
  S.attrEdit = null;
  S.confirmDel = false;
}

/** 接続モードと描きかけの線をやめる。 */
export function cancelConnect(): void {
  S.mode = null;
  S.connectFrom = null;
  S.connectTo = null;
  S.connectGap = null;
  S.wire = null;
}
