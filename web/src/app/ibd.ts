// 内部ブロック図（InterconnectionView）の中身を、モデルから作る。
// 要素のキーと線の ID は、Rust のコアの図の操作（crates/modelith-core/src/edit/ibd.rs）と同じ決め方にする（ADR-0016）。

import type { Entry, Model, ModelEdge, ModelNode } from "../core";

/** 内部ブロック図に描く要素と線。 */
export interface IbdContent {
  nodes: ModelNode[];
  edges: ModelEdge[];
}

/**
 * 内部ブロック図の内容を作る。対象の部品を `u:部品名` のノードにし、対象の中の flow・connect を、
 * 部品の間の線（ポートが分かれば接続点つき）にする。
 *
 * @param M モデル
 * @param ctx 図の対象（部品を持つ part def のノード）
 * @returns 部品と線。部品が無ければ空
 * @example
 * // Vehicle が部品 engine・wheel を持ち、engine.out から wheel.in へ flow がある
 * ibdContentOf(M, Vehicle) // → { nodes: [u:engine, u:wheel], edges: [{ id: "flow|u:engine|u:wheel|#1", kind: "flow", … }] }
 * // 部品を持たない part def
 * ibdContentOf(M, Engine)  // → { nodes: [], edges: [] }
 */
export function ibdContentOf(M: Model, ctx: ModelNode): IbdContent {
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
  return { nodes, edges };
}
