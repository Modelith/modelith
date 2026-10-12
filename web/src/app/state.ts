// アプリの状態。テキストが唯一の正本で、P（解析結果）・M（モデル）・layout はテキストから作り直す（ADR-0001）。

import type { Model, ParseResult, PortDir } from "../core";
import type { Layout, Side } from "./layout";

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
  view: string;
  ctx: string | null;
  phase: string;
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
  layout: Layout;
  sel: string | null;
  selEdge: string | null;
  selSet: Set<string>;
  selPin: { node: string; pin: string } | null;
  mode: "connect" | null;
  connectFrom: string | null;
  connectTo: string | null;
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
  confirmDel: boolean;
  renaming: boolean;
  msgEdit: boolean;
  phase: string;
  ibdCtx: string | null;
  seqCtx: string | null;
  spaceDown: boolean;
  ui: UiPrefs;
  tabs: Tab[];
  tabId: number | null;
  treeOpen: Map<string, boolean>;
  treeQ: string;
  treeSel: number | null;
  treeScrollForce: boolean;
}

/** 唯一のアプリ状態。起動時に main.ts が P・M を埋める。 */
export const S: AppState = {
  text: "",
  P: { entries: [], rels: [], errors: [], layout: {} },
  M: {
    nodes: [], edges: [], problems: [], nodeOf: new Map(), byName: new Map(), rels: [], phases: null, phaseEnum: null,
    phaseOf: () => null,
  },
  view: "trace",
  layout: {},
  sel: null,
  selEdge: null,
  selSet: new Set(),
  selPin: null,
  mode: null,
  connectFrom: null,
  connectTo: null,
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
  confirmDel: false,
  renaming: false,
  msgEdit: false,
  phase: "",
  ibdCtx: null,
  seqCtx: null,
  spaceDown: false,
  ui: { tree: true, text: true, treeW: 250, textW: 440, mini: true },
  tabs: [],
  tabId: null,
  treeOpen: new Map(),
  treeQ: "",
  treeSel: null,
  treeScrollForce: false,
};

/** 選択と一時的な操作状態をすべて外す。 */
export function clearSel(): void {
  S.selSet = new Set();
  S.band = null;
  S.treeSel = null;
  S.textMark = null;
  S.msgEdit = false;
  S.sel = null;
  S.selEdge = null;
  S.selPin = null;
  S.portForm = false;
  S.renaming = false;
  S.confirmDel = false;
}

/** 接続モードと描きかけの線をやめる。 */
export function cancelConnect(): void {
  S.mode = null;
  S.connectFrom = null;
  S.connectTo = null;
  S.wire = null;
}
