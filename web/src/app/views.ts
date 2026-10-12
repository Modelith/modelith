// ビュー（図の種類）ごとに、モデルのどの要素・関係を表示するかを決める。

import type { EdgeKind, MessageRel, Model, ModelEdge, ModelNode } from "../core";
import { emptyView, type ViewLayout } from "./layout";
import { S } from "./state";

export interface ViewDef {
  id: string;
  label: string;
  /** 表示する要素の種類（null はすべて）。 */
  kinds?: string[] | null;
  /** この関係でつながる要素も表示する。 */
  pull?: EdgeKind[];
  /** 表示中の要素を部品に持つ要素も表示する。 */
  pullComp?: boolean;
  edges?: EdgeKind[] | null;
  /** 所有関係の深さで段を分ける。 */
  depth?: boolean;
}

export interface ViewContent {
  nodes: ModelNode[];
  edges: ModelEdge[];
  dim?: Set<string>;
  empty?: string;
  frame?: { kind: string; title: string };
  ctx?: ModelNode;
  seq?: boolean;
}

export const VIEWS: ViewDef[] = [
  { id: "trace", label: "トレーサビリティ", kinds: ["concern def", "requirement def", "requirement", "verification def", "analysis def"], pull: ["satisfy"], edges: ["satisfy", "verify", "frame", "comp", "defined", "derive"] },
  { id: "structure", label: "構造", kinds: ["part def", "part", "attribute def"], edges: ["comp", "defined"], depth: true },
  { id: "control", label: "制御ループ", kinds: ["constraint def", "calc def"], pull: ["flow"], edges: ["flow", "comp"] },
  { id: "ibd", label: "内部ブロック図" },
  { id: "behavior", label: "振る舞い", kinds: ["state def", "action def", "occurrence def"], pullComp: true, edges: ["comp"] },
  { id: "seq", label: "シーケンス" },
  { id: "all", label: "すべて", kinds: null, edges: null },
];

const PHASE_LABEL: Record<string, string> = {
  StakeholderNeeds: "利用者要求", SystemRequirements: "システム要求", Architecture: "方式設計", Verification: "検証",
};
export const phaseLabel = (p: string): string => PHASE_LABEL[p] ?? p;

export const viewDef = (id: string): ViewDef => VIEWS.find((x) => x.id === id) ?? (VIEWS[0] as ViewDef);
export const curView = (): ViewDef => viewDef(S.view);
/** 配置情報のキー。内部ブロック図は対象ブロックごとに分ける。 */
export const VK = (): string => (S.view === "ibd" ? "ibd:" + S.ibdCtx : S.view);
/** 現在のビューの配置（無ければ作る）。 */
export function curLayout(): ViewLayout {
  const k = VK();
  return (S.layout[k] ||= emptyView());
}

function baseContent(M: Model, v: ViewDef): ViewContent {
  if (!v.kinds) return { nodes: M.nodes, edges: M.edges };
  const kinds = v.kinds;
  const keys = new Set(M.nodes.filter((n) => kinds.includes(n.kind)).map((n) => n.key));
  const pull = v.pull;
  if (pull) for (const e of M.edges) if (pull.includes(e.kind)) { keys.add(e.from); keys.add(e.to); }
  if (v.pullComp) for (const e of M.edges) if (e.kind === "comp" && keys.has(e.to)) keys.add(e.from);
  const placed = curLayout().pos;
  for (const n of M.nodes) if (placed[n.key]) keys.add(n.key);
  const ek = v.edges ?? [];
  return { nodes: M.nodes.filter((n) => keys.has(n.key)), edges: M.edges.filter((e) => ek.includes(e.kind) && keys.has(e.from) && keys.has(e.to)) };
}

function phaseFilter(M: Model, c: ViewContent): ViewContent {
  if (!S.phase || !M.phases) return c;
  const keep = new Set(c.nodes.filter((n) => n.phase === S.phase).map((n) => n.key));
  const dim = new Set<string>();
  for (const e of c.edges) {
    if (keep.has(e.from) && !keep.has(e.to)) dim.add(e.to);
    if (keep.has(e.to) && !keep.has(e.from)) dim.add(e.from);
  }
  const vis = new Set([...keep, ...dim]);
  return { nodes: c.nodes.filter((n) => vis.has(n.key)), edges: c.edges.filter((e) => keep.has(e.from) || keep.has(e.to)), dim };
}

/** 内部ブロック図の対象にできるブロック（部品を持つ part def）。 */
export const ibdContexts = (M: Model): ModelNode[] =>
  M.nodes.filter((n) => n.kind === "part def" && n.entry.children.some((c) => c.kind === "part" && c.name));
/** シーケンス図の対象にできるシナリオ。 */
export const seqContexts = (M: Model): ModelNode[] => M.nodes.filter((n) => n.kind === "occurrence def");
/** 内部ブロック図の既定の対象（部品が最も多いブロック）。 */
export function defaultIbdContext(M: Model): ModelNode | null {
  const count = (n: ModelNode): number => n.entry.children.filter((c) => c.kind === "part").length;
  return ibdContexts(M).reduce<ModelNode | null>((best, n) => (!best || count(n) > count(best) ? n : best), null);
}

function ibdContent(M: Model): ViewContent {
  const ctx = ibdContexts(M).find((n) => n.key === S.ibdCtx);
  if (!ctx) return { nodes: [], edges: [], empty: "部品（part）を持つ part def がまだありません。構造ビューで part def に部品を追加してください。" };
  const typeNode = (tn: string): ModelNode | undefined => M.nodes.find((n) => n.isDef && n.name === tn);
  const nodes: ModelNode[] = ctx.entry.children
    .filter((c) => c.kind === "part" && c.name)
    .map((u) => {
      const tn = typeNode(u.type);
      return {
        key: "u:" + u.name, name: u.name, short: "", kind: "part", isDef: false, fam: "part", entry: u, trans: [],
        ports: tn ? tn.ports : [], portHost: tn ? tn.entry : u, typeKey: tn ? tn.key : null, usage: true, phase: null, phaseOwn: false,
      };
    });
  const byN = new Map(nodes.map((n) => [n.name, n]));
  const edges: ModelEdge[] = [];
  const seen = new Map<string, number>();
  for (const r of M.rels) {
    if ((r.rel !== "flow" && r.rel !== "connect") || r.pe !== ctx.entry) continue;
    const pa = r.a.split(".");
    const pb = r.b.split(".");
    const A = byN.get(pa[0] ?? "");
    const B = byN.get(pb[0] ?? "");
    if (!A || !B) continue;
    const label = r.item || "";
    const base = `flow|${A.key}|${B.key}|${label}`;
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    const e: ModelEdge = {
      id: base + "#" + k, kind: "flow", from: A.key, to: B.key, label, rel: r,
      src: r.rel === "connect" ? { start: r.usage.start, end: r.usage.end } : { start: r.start, end: r.end + 1 },
    };
    if (pa[1] && A.ports.some((p) => p.name === pa[1])) e.fromPort = "port:" + pa[1];
    if (pb[1] && B.ports.some((p) => p.name === pb[1])) e.toPort = "port:" + pb[1];
    edges.push(e);
  }
  return { nodes, edges, frame: { kind: "part def", title: ctx.name }, ctx };
}

function seqContent(M: Model): ViewContent {
  const ctx = seqContexts(M).find((n) => n.key === S.seqCtx);
  if (!ctx) return { nodes: [], edges: [], seq: true, empty: "occurrence def がまだありません。「シナリオ」から作成できます。" };
  const nodes: ModelNode[] = ctx.entry.children
    .filter((c) => (c.kind === "part" || c.kind === "occurrence") && c.name)
    .map((u) => ({
      key: "l:" + u.name, name: u.name, short: "", kind: u.kind, isDef: false, fam: "part", entry: u, trans: [], ports: [],
      lifeline: true, phase: null, phaseOwn: false,
    }));
  const msgs = M.rels.filter((r): r is MessageRel => r.rel === "message" && r.pe === ctx.entry).sort((a, b) => a.start - b.start);
  const edges: ModelEdge[] = msgs.map((r, i) => ({
    id: `msg|${i}|${r.name}`, kind: "message", idx: i, from: "l:" + (r.a.split(".")[0] ?? ""), to: "l:" + (r.b.split(".")[0] ?? ""),
    label: r.name, type: r.item, rel: r, src: { start: r.start, end: r.end + 1 },
  }));
  return { nodes, edges, seq: true, ctx };
}

let cache: { M: Model | null; k: string | null; v: ViewContent | null } = { M: null, k: null, v: null };

/** ビューに表示する要素と関係（モデルと表示条件が同じ間はキャッシュする）。 */
export function viewContent(M: Model, v: ViewDef): ViewContent {
  if (v.id === "ibd") {
    const cs = ibdContexts(M);
    if (!cs.some((n) => n.key === S.ibdCtx)) S.ibdCtx = defaultIbdContext(M)?.key ?? null;
  }
  if (v.id === "seq") {
    const cs = seqContexts(M);
    if (!cs.some((n) => n.key === S.seqCtx)) S.seqCtx = cs[0]?.key ?? null;
  }
  const k = [v.id, S.ibdCtx, S.seqCtx, S.phase].join("|");
  if (cache.M === M && cache.k === k && cache.v) return cache.v;
  const r = v.id === "ibd" ? ibdContent(M) : v.id === "seq" ? seqContent(M) : phaseFilter(M, baseContent(M, v));
  cache = { M, k, v: r };
  return r;
}

/** 現在のビューの内容。 */
export const CC = (): ViewContent => viewContent(S.M, curView());

/** キーから要素を探す（`u:`・`l:` は現在のビューの部品・ライフライン）。 */
export function nodeByKey(k: string | null | undefined): ModelNode | null {
  if (!k) return null;
  if (/^[ul]:/.test(k)) return CC().nodes.find((n) => n.key === k) ?? null;
  return S.M.nodes.find((n) => n.key === k) ?? null;
}

export function edgeById(id: string | null | undefined): ModelEdge | null {
  if (!id) return null;
  return CC().edges.find((e) => e.id === id) ?? S.M.edges.find((e) => e.id === id) ?? null;
}

export const visibleNodes = (): ModelNode[] => CC().nodes;
