// 内部ブロック図（InterconnectionView）の中身を、モデルから作る。
// 要素のキーと線の ID は、Rust のコアの図の操作（crates/modelith-core/src/edit/ibd.rs）と同じ決め方にする（ADR-0016）。

import type { Model, ModelEdge, ModelNode } from "../core";

/** 内部ブロック図に描く要素と線。 */
export interface IbdContent {
  nodes: ModelNode[];
  edges: ModelEdge[];
}

/**
 * 流れの線のラベル（8.2.3.16 の flow-label）。Rust のコアの `flow_label` と同じ。名前の無いフローは、アイテムの型だけを書く。
 *
 * @param name フローの名前（名前の無いフローは空）
 * @param type フローの型の名前（無ければ空）
 * @param item 流れるアイテムの型の名前（`of` の後。無ければ空）
 * @returns ラベル。書くことが無ければ空文字列
 * @example
 * flowLabel("f", "FD", "")    // → "f : FD"
 * flowLabel("g", "", "Water") // → "g of Water"
 * flowLabel("", "", "Heat")   // → "Heat"（名前の無いフロー）
 */
export function flowLabel(name: string, type: string, item: string): string {
  if (!name) return item;
  return name + (type ? ` : ${type}` : "") + (item ? ` of ${item}` : "");
}

/** 線の端（図の要素のキーと、つなぐポート）。 */
interface End {
  node: ModelNode;
  port?: string;
}

/**
 * 線の ID に番号を付ける（同じ形の線は、出てきた順に 1, 2, …）。
 *
 * @returns `base` を受け取り `base#番号` を返す関数
 * @example
 * const id = counter();
 * id("flow|u:a|u:b|") // → "flow|u:a|u:b|#1"
 * id("flow|u:a|u:b|") // → "flow|u:a|u:b|#2"
 */
function counter(): (base: string) => string {
  const seen = new Map<string, number>();
  return (base) => {
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return `${base}#${k}`;
  };
}

/**
 * 内部ブロック図の内容を作る。対象の部品を `u:部品名` のノードにし、対象の中の flow・connect・bind を、
 * 部品の間の線（ポートが分かれば接続点つき）にする。名前付きのフローのラベルは名前と型（`flowLabel`）、
 * 結び付けは種類 `bind` でラベル `=`（8.2.3.13 の binding-connection）。
 * 端が 3 つ以上の接続（8.2.3.13 の n-ary-connection）は、点 `j:名前`（名前が無ければ `j:#番号`）を要素にし、
 * 点から端ごとに種類 `connect` の線を引く。
 * 線は、接続・結び付け・名前付きのフローなら使用（本体を含む）、名前の無いフローなら文の範囲を指す。
 * 要素のキーと線の ID は、Rust のコア（`edit/ibd.rs`）と同じ決め方にする。
 *
 * @param M モデル
 * @param ctx 図の対象（部品を持つ part def のノード）
 * @returns 部品・接続の点と線。部品が無ければ空
 * @example
 * // Vehicle が部品 engine・wheel を持ち、engine.out から wheel.in へ flow がある
 * ibdContentOf(M, Vehicle) // → { nodes: [u:engine, u:wheel], edges: [{ id: "flow|u:engine|u:wheel|#1", kind: "flow", … }] }
 * // さらに bind engine.rpm = wheel.rpm; と connect (engine, wheel, body); がある
 * ibdContentOf(M, Vehicle).edges.map((e) => e.id).slice(1)
 * // → ["bind|u:engine|u:wheel|=#1", "connect|j:#1|u:engine|#1", "connect|j:#1|u:wheel|#1", "connect|j:#1|u:body|#1"]
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
  const endOf = (path: string): End | null => {
    const [head, port] = path.split(".");
    const node = byN.get(head ?? "");
    if (!node) return null;
    return port && node.ports.some((p) => p.name === port) ? { node, port: "port:" + port } : { node };
  };
  const edges: ModelEdge[] = [];
  const junctions: ModelNode[] = [];
  const id = counter();
  let anonymous = 0;
  for (const r of M.rels) {
    if ((r.rel !== "flow" && r.rel !== "connect" && r.rel !== "bind") || r.pe !== ctx.entry) continue;
    const src = r.usage ? { start: r.usage.start, end: r.usage.end } : { start: r.start, end: r.end + 1 };
    if (r.rel === "connect" && r.ends && r.ends.length > 2) {
      const key = r.usage.name ? `j:${r.usage.name}` : `j:#${++anonymous}`;
      const found = r.ends.flatMap((x) => endOf(x) ?? []);
      if (found.length < 2) continue;
      junctions.push({
        key, name: r.usage.name, short: "", kind: "connection", isDef: false, fam: "part", entry: r.usage, trans: [], ports: [],
        junction: true, phase: null, phaseOwn: false,
      });
      for (const z of found) {
        const e: ModelEdge = { id: id(`connect|${key}|${z.node.key}|`), kind: "connect", from: key, to: z.node.key, label: "", rel: r, src };
        if (z.port) e.toPort = z.port;
        edges.push(e);
      }
      continue;
    }
    const A = endOf(r.a);
    const B = endOf(r.b);
    if (!A || !B) continue;
    const kind = r.rel === "bind" ? "bind" : "flow";
    const label = r.rel === "flow" ? flowLabel(r.name ?? "", r.type ?? "", r.item) : r.rel === "bind" ? "=" : r.item;
    const e: ModelEdge = { id: id(`${kind}|${A.node.key}|${B.node.key}|${label}`), kind, from: A.node.key, to: B.node.key, label, rel: r, src };
    if (A.port) e.fromPort = A.port;
    if (B.port) e.toPort = B.port;
    edges.push(e);
  }
  return { nodes: [...nodes, ...junctions], edges };
}
