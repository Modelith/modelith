// Rust のコア（wasm）が返す解析結果を、暫定コアと同じオブジェクトの形に戻す（ADR-0015）。
// Rust は要素どうしの参照を番号で返すので、ここで親・子・持ち主のオブジェクトの参照につなぎ直す。
// モデル（ADR-0016 の手順 A）も同じく番号で返るので、`build` でオブジェクトの参照に戻す。
// `@layout` コメント（移行期の形式）の中身は、ここで読む（読み取れないことは Rust が構文エラーとして返す）。

import { readLayout } from "./parser";
import type {
  Block, Entry, Model, ModelEdge, ModelNode, ModelView, ParseResult, PhaseInfo, Port, Problem, Rel, Scope, Unsupported,
} from "./types";
import initWasm, { analyze as analyzeJson, edit as editJson } from "./wasm/modelith_core.js";

/**
 * Rust のコア（wasm）を読み込む。アプリは起動時に一度だけ待つ（ADR-0015：alpha.3 では画面と同じスレッドで同期で呼ぶ）。
 * テストは testing/setup.ts が先に読み込んでおく。
 */
export async function initCore(wasmUrl: string): Promise<void> {
  await initWasm({ module_or_path: wasmUrl });
}

/**
 * テキストを解析して宣言・関係・構文エラー・配置情報を返す（Rust のパーサ）。例外は投げない。
 * コアの中で予期しない失敗が起きたときは、要素の無い結果と、そのことを伝える構文エラーを返す（テキストには触れない）。
 */
export function parse(text: string): ParseResult {
  return safeParse(text, analyzeJson);
}

/** 解析結果ごとの、Rust が作ったモデル（番号のまま）。`build` で取り出す。 */
const models = new WeakMap<ParseResult, RawModel>();

/** `analyzeJson` が失敗しても例外を投げずに結果を返す（`analyzeJson` を差し替えてテストできるように分けている）。 */
export function safeParse(text: string, analyzeJson: (text: string) => string): ParseResult {
  try {
    const raw = JSON.parse(analyzeJson(text)) as { parse: RawParseResult; model: RawModel };
    const P = fromRaw(raw.parse, text);
    models.set(P, raw.model);
    return P;
  } catch (e) {
    const errors = [{ pos: 0, msg: `テキストを読み取れませんでした。テキストはそのまま残っています（${e instanceof Error ? e.message : String(e)}）` }];
    const P: ParseResult = { entries: [], rels: [], errors, layout: readLayout(text, errors), unsupported: [] };
    models.set(P, { nodes: [], views: [], edges: [], problems: [...errors], phases: null, phaseEnum: null });
    return P;
  }
}

/** 持ち主の番号（名前のある宣言か、名前の無いブロック）。 */
type RawScope = { e: number } | { b: number };

type RawEntry = Omit<Entry, "owner" | "pe" | "children" | "phaseBlock"> & {
  owner: RawScope | null;
  pe: number | null;
  children: number[];
  phaseBlock?: RawScope;
};
type RawBlock = Omit<Block, "anon" | "owner"> & { owner: RawScope | null };
/** 関係（相手は文字列、文の持ち主と接続の使用は番号）。 */
type RawRel = { rel: Rel["rel"]; pe: number | null; usage?: number; start: number; end: number } & Record<string, unknown>;

/** Rust の `ParseResult`（JSON）。 */
export interface RawParseResult {
  entries: RawEntry[];
  blocks: RawBlock[];
  rels: RawRel[];
  errors: { pos: number; msg: string }[];
  unsupported: Unsupported[];
}

/** Rust の解析結果（JSON の文字列）を、暫定コアと同じ `ParseResult` にする。 */
export function fromRust(json: string, text: string): ParseResult {
  return fromRaw(JSON.parse(json) as RawParseResult, text);
}

function fromRaw(raw: RawParseResult, text: string): ParseResult {
  const entries: Entry[] = raw.entries.map((e) => ({ ...e, owner: null, pe: null, children: [], phaseBlock: undefined }));
  const blocks: Block[] = raw.blocks.map((b) => ({ ...b, anon: true, owner: null }));
  const scope = (s: RawScope | null | undefined): Scope | null => {
    if (!s) return null;
    return ("e" in s ? entries[s.e] : blocks[s.b]) ?? null;
  };
  const entry = (i: number | null | undefined): Entry | null => (i == null ? null : (entries[i] ?? null));
  raw.entries.forEach((r, i) => {
    const e = entries[i]!;
    e.owner = scope(r.owner);
    e.pe = entry(r.pe);
    e.children = r.children.flatMap((c) => entry(c) ?? []);
    if (r.phaseBlock) e.phaseBlock = scope(r.phaseBlock) ?? undefined;
    else delete e.phaseBlock;
  });
  raw.blocks.forEach((r, i) => {
    blocks[i]!.owner = scope(r.owner);
  });
  const rels = raw.rels.map((r) => {
    const { usage, ...rest } = r;
    const rel = r.rel === "connect" ? { ...rest, pe: entry(r.pe), usage: entry(usage) } : { ...rest, pe: entry(r.pe) };
    return rel as unknown as Rel;
  });
  // 読み取れない @layout コメントは Rust が構文エラーに入れているので、ここで足したエラーは捨てる
  return { entries, rels, errors: [...raw.errors], layout: readLayout(text, []), unsupported: raw.unsupported };
}

type RawPort = Omit<Port, "entry"> & { entry: number };
type RawNode = Omit<ModelNode, "entry" | "ports"> & { entry: number; ports: RawPort[] };
type RawEdge = Omit<ModelEdge, "rel"> & { rel?: number };
type RawView = Omit<ModelView, "entry" | "targets"> & { entry: number; targets: number[] };

/** Rust の `Model`（JSON）。宣言は `entries`、関係は `rels` の番号で指す。 */
export interface RawModel {
  nodes: RawNode[];
  views: RawView[];
  edges: RawEdge[];
  problems: Problem[];
  phases: string[] | null;
  phaseEnum: string | null;
}

/**
 * 解析結果からモデル（図の要素・関係・問題・フェーズ）を作る（Rust のモデル構築、ADR-0016）。
 * 中身は `parse` のときに Rust が作っている。ここでは番号をオブジェクトの参照に戻すだけ。
 * `parse`（Rust）が返したものでない解析結果は受け付けない。
 */
export function build(P: ParseResult): Model {
  const raw = models.get(P);
  if (!raw) throw new Error("build には、parse（Rust）が返した解析結果を渡してください");
  return toModel(raw, P);
}

function toModel(raw: RawModel, P: ParseResult): Model {
  const entry = (i: number): Entry => {
    const e = P.entries[i];
    if (!e) throw new Error(`モデルが指す宣言（${i}）がありません`);
    return e;
  };
  const nodes: ModelNode[] = raw.nodes.map((n) => ({ ...n, entry: entry(n.entry), ports: n.ports.map((p) => ({ ...p, entry: entry(p.entry) })) }));
  const nodeOf = new Map<Entry, ModelNode>(nodes.map((n) => [n.entry, n]));
  const byName = new Map<string, Entry[]>();
  for (const e of P.entries) {
    if (!e.name) continue;
    const list = byName.get(e.name);
    if (list) list.push(e);
    else byName.set(e.name, [e]);
  }
  const edges: ModelEdge[] = raw.edges.map(({ rel, ...e }) => {
    const r = rel == null ? undefined : P.rels[rel];
    return r ? { ...e, rel: r } : e;
  });
  const views: ModelView[] = raw.views.map((v) => ({ ...v, entry: entry(v.entry), targets: v.targets.map(entry) }));
  const phaseOf = (e: Entry): PhaseInfo | null => {
    for (let a: Entry | null = e; a; a = a.pe) {
      const stage = a.meta?.["Phase"]?.["stage"];
      if (stage) return { value: stage, own: a === e, holder: a };
    }
    return null;
  };
  return {
    nodes, views, edges, problems: raw.problems, nodeOf, byName, rels: P.rels, phases: raw.phases, phaseEnum: raw.phaseEnum, phaseOf,
  };
}

/**
 * 図の操作の意図（ADR-0016）。要素は図の要素のキー、関係は ID で指す（テキスト上の位置は使わない）。
 * `ctx` は内部ブロック図・シーケンス図の対象（部品定義・シナリオのキー）。`u:名前`・`l:名前` のキーは、その中の部品・ライフライン。
 */
export type Intent =
  | { op: "addNode"; kind: string; phase?: string | null; newPackage?: string }
  | { op: "addUsage"; ctx: string; type: string }
  | { op: "rename"; key: string; name: string; ctx?: string }
  | { op: "delete"; keys: string[]; ctx?: string }
  | { op: "deleteEdge"; id: string; ctx?: string }
  | { op: "connect"; rel: string; from: string; to: string; fromPort?: string | null; toPort?: string | null; ctx?: string }
  | { op: "addMessage"; ctx: string; from: string; to: string }
  | { op: "updateMessage"; ctx: string; id: string; name: string; type: string }
  | { op: "moveMessage"; ctx: string; id: string; dir: -1 | 1 }
  | { op: "setPhase"; keys: string[]; value: string; ctx?: string }
  | { op: "initPhases"; newPackage?: string }
  | { op: "makePort"; key: string; name: string; dir: string; type: string; flows: { id: string; from?: boolean; to?: boolean }[]; ctx?: string }
  | { op: "setPortDir"; key: string; port: string; dir: string; ctx?: string }
  | { op: "deletePort"; key: string; port: string; ctx?: string }
  | { op: "saveView"; name: string; kind: string; targets: string[] }
  | { op: "addToView"; view: string; key: string }
  | { op: "removeFromView"; view: string; key: string };

/** テキストの編集（古いテキストの [start, end) を text に置き換える。位置は UTF-16）。 */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** 操作の結果。`select` は操作の後に選ぶ要素の名前、`flash` は編集後のテキストで光らせる範囲。 */
export interface EditResult {
  edits: TextEdit[];
  select?: string;
  flash?: [number, number];
}

/** 操作できなかったとき、その理由（画面にそのまま出す文）。 */
export interface Refused {
  refused: string;
}

/** 今のテキストに意図を当てて、テキストの編集を返す（Rust のコア）。例外は投げない。 */
export function edit(text: string, intent: Intent): EditResult | Refused {
  return safeEdit(text, intent, editJson);
}

/** `editJson` が失敗しても例外を投げずに結果を返す（`editJson` を差し替えてテストできるように分けている）。 */
export function safeEdit(text: string, intent: Intent, editJson: (text: string, intent: string) => string): EditResult | Refused {
  try {
    return JSON.parse(editJson(text, JSON.stringify(intent))) as EditResult | Refused;
  } catch (e) {
    return { refused: `操作できませんでした。テキストはそのまま残っています（${e instanceof Error ? e.message : String(e)}）` };
  }
}
