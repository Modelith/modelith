// 内部ブロック図（InterconnectionView）の中身を、モデルから作る。
// 要素のキーと線の ID は、Rust のコアの図の操作（crates/modelith-core/src/edit/ibd.rs）と同じ決め方にする（ADR-0016）。

import type { Entry, Model, ModelEdge, ModelNode, Port, PortDir } from "../core";

/** 内部ブロック図に描く要素と線。 */
export interface IbdContent {
  nodes: ModelNode[];
  edges: ModelEdge[];
  /** 対象そのもののポート（枠の上に描く、8.2.3.13）。キーは `b:名前`。並べる位置は枠で決まるので、nodes には入れない。 */
  boundary: ModelNode[];
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
 * 部品の中の部品（入れ子の次の段）になりうるもの。部品の本体に書いた部品、続けて型の定義の中の部品（同じ名前は本体を優先）。
 * Rust のコアの `inner_parts` と同じ。
 *
 * @param M モデル（型の定義を、図の要素の定義から名前で探す）
 * @param u 対象の直下の部品
 * @returns 名前のある部品（本体の順、続けて型の定義の順）。無ければ空
 * @example
 * // part def A { part x; } と part def C { part a : A { part y; } } のとき
 * innerParts(M, a).map((e) => e.name) // → ["y", "x"]
 * // 型の無い部品 part b; のとき
 * innerParts(M, b)                    // → []
 */
export function innerParts(M: Model, u: Entry): Entry[] {
  const isPart = (e: Entry): boolean => e.kind === "part" && !!e.name;
  const own = u.children.filter(isPart);
  const def = M.nodes.find((n) => n.isDef && n.name === u.type)?.entry;
  const inherited = (def?.children ?? []).filter((c) => isPart(c) && !own.some((o) => o.name === c.name));
  return [...own, ...inherited];
}

/**
 * 型の無い部品の本体に書いたポート。向きは修飾（in・out・inout）から決め、無ければ inout にする（ポートの型からは決めない）。
 *
 * @param u 型の無い部品の宣言
 * @returns 本体の、名前のあるポート
 * @example
 * ownPorts(part engine { out port p; port q; }) // → [{ name: "p", dir: "out", … }, { name: "q", dir: "inout", … }]
 * ownPorts(part engine;)                         // → []
 */
export function ownPorts(u: Entry): Port[] {
  return u.children
    .filter((c) => c.kind === "port" && c.name)
    .map((c) => {
      const m = ` ${c.mods ?? ""} `;
      const dir: PortDir = m.includes(" inout ") ? "inout" : m.includes(" out ") ? "out" : m.includes(" in ") ? "in" : "inout";
      return { name: c.name, type: c.type, conj: !!c.conj, dir, entry: c };
    });
}

/**
 * 内部ブロック図の内容を作る。対象の部品を `u:部品名` のノードにし、対象の中の flow・connect・bind を、
 * 部品の間の線（ポートが分かれば接続点つき）にする。名前付きのフローのラベルは名前と型（`flowLabel`）、
 * 結び付けは種類 `bind` でラベル `=`（8.2.3.13 の binding-connection）。
 * 端が 3 つ以上の接続（8.2.3.13 の n-ary-connection）は、点 `j:名前`（名前が無ければ `j:#番号`）を要素にし、
 * 点から端ごとに種類 `connect` の線を引く。
 * 部品の中の部品は `u:部品.部品`（3 段目からは `u:a.x.y` のように続ける）のノード（`container` は外の部品）にする。描くのは、
 * 部品の本体に書いた部品（どの深さでも）と、線の端（`a.x.p`・`a.x.y.p` の特徴の連鎖、8.2.2.6）が指す型の中の部品。部品の本体と、部品の型の定義の中に書いた線も描く（端は部品の中から `x.p`・部品のポート `p` で指す。
 * 同じ型の部品が 2 つあれば、型の中の線は部品ごとに描く）。
 * 線は、接続・結び付け・名前付きのフローなら使用（本体を含む）、名前の無いフローなら文の範囲を指す。
 * 要素のキーと線の ID は、Rust のコア（`edit/ibd.rs`）と同じ決め方にする。
 *
 * @param M モデル
 * @param ctx 図の対象（部品を持つ part def のノード）
 * @returns 部品（外の部品の直後に中の部品）・接続の点と線。部品が無ければ空
 * @example
 * // Vehicle が部品 engine・wheel を持ち、engine.out から wheel.in へ flow がある
 * ibdContentOf(M, Vehicle) // → { nodes: [u:engine, u:wheel], edges: [{ id: "flow|u:engine|u:wheel|#1", kind: "flow", … }] }
 * // さらに bind engine.rpm = wheel.rpm; と connect (engine, wheel, body); がある
 * ibdContentOf(M, Vehicle).edges.map((e) => e.id).slice(1)
 * // → ["bind|u:engine|u:wheel|=#1", "connect|j:#1|u:engine|#1", "connect|j:#1|u:wheel|#1", "connect|j:#1|u:body|#1"]
 * // engine の型 Engine が part cyl を持ち、connect engine.cyl.p to wheel.in; がある
 * ibdContentOf(M, Vehicle).nodes.map((n) => n.key) // → ["u:engine", "u:engine.cyl", "u:wheel", …]
 * // Cyl が part valve を持ち、connect engine.cyl.valve.p to wheel.in; がある（3 段の連鎖）
 * ibdContentOf(M, Vehicle).nodes.map((n) => n.key) // → ["u:engine", "u:engine.cyl", "u:engine.cyl.valve", "u:wheel", …]
 * // 部品を持たない part def
 * ibdContentOf(M, Engine)  // → { nodes: [], edges: [] }
 */
export function ibdContentOf(M: Model, ctx: ModelNode): IbdContent {
  const typeNode = (tn: string): ModelNode | undefined => M.nodes.find((n) => n.isDef && n.name === tn);
  const usageNode = (u: Entry, key: string, container?: string): ModelNode => {
    const tn = typeNode(u.type);
    return {
      key, name: u.name, short: "", kind: "part", isDef: false, fam: "part", entry: u, trans: [],
      ports: tn ? tn.ports : ownPorts(u), portHost: tn ? tn.entry : u, typeKey: tn ? tn.key : null, usage: true, phase: null, phaseOwn: false,
      ...(container ? { container } : {}),
    };
  };
  const parts = ctx.entry.children.filter((c) => c.kind === "part" && c.name);
  const outer = new Map(parts.map((u) => [u.name, usageNode(u, "u:" + u.name)]));
  const inner = new Map<string, ModelNode>();
  /** 部品の本体に書いた部品を、どの深さでも描く（キーは外の部品のキーに `.名前` を足したもの）。 */
  const addBodyParts = (n: ModelNode): void => {
    for (const c of n.entry.children) {
      if (c.kind !== "part" || !c.name) continue;
      const key = `${n.key}.${c.name}`;
      const node = usageNode(c, key, n.key);
      inner.set(key, node);
      addBodyParts(node);
    }
  };
  for (const n of outer.values()) addBodyParts(n);
  /** 部品の中の部品のノード（無ければ、部品の型の中から探して作り、その本体の部品も描く）。 */
  const nested = (n: ModelNode, name: string): ModelNode | null => {
    const key = `${n.key}.${name}`;
    const hit = inner.get(key);
    if (hit) return hit;
    const c = innerParts(M, n.entry).find((e) => e.name === name);
    if (!c) return null;
    const made = usageNode(c, key, n.key);
    inner.set(key, made);
    addBodyParts(made);
    return made;
  };
  const at = (node: ModelNode, port: string | undefined): End =>
    port && node.ports.some((p) => p.name === port) ? { node, port: "port:" + port } : { node };
  /**
   * 連鎖の段を、部品の中の部品へたどれるだけたどる（3 段目から先も。特徴の連鎖 a.b.c.p、8.2.2.6）。
   * たどった部品と、たどった段の数を返す。
   */
  const walk = (from: ModelNode, segs: readonly string[]): [ModelNode, number] => {
    let node = from, i = 0;
    for (; i < segs.length; i++) {
      const deep = nested(node, segs[i] ?? "");
      if (!deep) break;
      node = deep;
    }
    return [node, i];
  };
  /** 対象そのもののポート（枠の上のポート）。線の端になったものだけを描く。継いだポートは描かない（Rust の boundary_port と同じ、対象の直下の宣言だけ）。 */
  const boundary = new Map<string, ModelNode>();
  const boundaryNode = (name: string): ModelNode | null => {
    const p = ctx.ports.find((x) => x.name === name && ctx.entry.children.includes(x.entry));
    if (!p) return null;
    const key = "b:" + name;
    const hit = boundary.get(key);
    if (hit) return hit;
    const made: ModelNode = { key, name, short: "", kind: "port", isDef: false, fam: "part", entry: p.entry, trans: [], ports: [], boundary: p.dir, phase: null, phaseOwn: false };
    boundary.set(key, made);
    return made;
  };
  /** 線の端の参照を、図の要素とポートにする。part は、関係を書いた部品の本体（対象そのものなら null）。 */
  const endOf = (path: string, part: Entry | null): End | null => {
    const segs = path.split(".");
    if (!part) {
      const top = outer.get(segs[0] ?? "");
      if (!top) {
        const b = segs.length === 1 ? boundaryNode(segs[0] ?? "") : null;
        return b ? { node: b } : null;
      }
      const [node, i] = walk(top, segs.slice(1));
      return at(node, segs[i + 1]);
    }
    const top = outer.get(part.name);
    if (!top) return null;
    const [node, i] = walk(top, segs);
    if (i > 0) return at(node, segs[i]);
    return segs.length === 1 ? at(top, segs[0]) : null;
  };
  // 線を探す範囲（関係を書いた宣言と、端を探す部品）。対象そのもの、続けて部品ごとに本体・型の定義の中
  const scopes: [owner: Entry, part: Entry | null][] = [[ctx.entry, null]];
  for (const u of parts) {
    scopes.push([u, u]);
    const t = typeNode(u.type)?.entry;
    if (t && t !== ctx.entry && t !== u) scopes.push([t, u]);
  }
  const edges: ModelEdge[] = [];
  const junctions: ModelNode[] = [];
  const id = counter();
  let anonymous = 0;
  for (const r of M.rels) {
    if (r.rel !== "flow" && r.rel !== "connect" && r.rel !== "bind") continue;
    // 同じ型の部品が 2 つあれば、型の中の関係は部品ごとに描く
    for (const [owner, part] of scopes) {
      if (r.pe !== owner) continue;
      const src = r.usage ? { start: r.usage.start, end: r.usage.end } : { start: r.start, end: r.end + 1 };
      if (r.rel === "connect" && r.ends && r.ends.length > 2) {
        const key = r.usage.name ? `j:${part ? part.name + "." : ""}${r.usage.name}` : `j:#${++anonymous}`;
        const found = r.ends.flatMap((x) => endOf(x, part) ?? []);
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
      const A = endOf(r.a, part);
      const B = endOf(r.b, part);
      if (!A || !B) continue;
      const kind = r.rel === "bind" ? "bind" : "flow";
      const label = r.rel === "flow" ? flowLabel(r.name ?? "", r.type ?? "", r.item) : r.rel === "bind" ? "=" : r.item;
      const e: ModelEdge = { id: id(`${kind}|${A.node.key}|${B.node.key}|${label}`), kind, from: A.node.key, to: B.node.key, label, rel: r, src };
      if (A.port) e.fromPort = A.port;
      if (B.port) e.toPort = B.port;
      edges.push(e);
    }
  }
  // 外の部品の直後に、その中の部品を（外の部品の枠の上に重ねて描くため。中の中の部品も同じ）
  const withInner = (n: ModelNode): ModelNode[] => [n, ...[...inner.values()].filter((c) => c.container === n.key).flatMap(withInner)];
  const nodes = [...outer.values()].flatMap(withInner);
  return { nodes: [...nodes, ...junctions], edges, boundary: [...boundary.values()] };
}
