// 解析結果から図に投影する要素と関係を組み立てる（暫定コア、ADR-0009）。
// 出力は reference/golden/*.json と一致させる。

import type { Entry, Family, Model, ModelEdge, ModelNode, ParseResult, PhaseInfo, PortDir, Problem, Span } from "./types";
import { buildViews, isStandardView } from "./views";

const COMP_KINDS = new Set([
  "part", "requirement", "constraint", "perform action", "exhibit state", "analysis", "verification", "attribute", "calc",
  "concern", "use case", "item", "port",
]);

/**
 * 標準ライブラリの型か（モデルの中に定義が無くても「見つからない」と言わない）。
 *
 * @param t 型の名前（修飾なし）
 * @returns 名前が `…Value`・`…Kind` で終わるか、Real・Integer・Boolean・String などの基本型なら true
 * @example
 * isLib("MassValue") // → true
 * isLib("Real")      // → true
 * isLib("Engine")    // → false
 */
export const isLib = (t: string): boolean =>
  /(Value|Kind)$/.test(t) || /^(Real|Integer|Boolean|String|Natural|Number|Complex|Anything)$/.test(t);

/**
 * 種類から色分けの系統を決める。
 *
 * @param kind 要素の種類（`part def`・`requirement` など、定義も使用も）
 * @returns 色分けの系統。どれにも当たらなければ "other"
 * @example
 * family("requirement def") // → "req"
 * family("state def")       // → "beh"
 * family("port def")        // → "other"
 */
export function family(kind: string): Family {
  if (/^requirement/.test(kind)) return "req";
  if (/^concern/.test(kind)) return "concern";
  if (/^(verification|analysis)/.test(kind)) return "ver";
  if (/^(constraint|calc)/.test(kind)) return "con";
  if (/^(state|action|use case)/.test(kind)) return "beh";
  if (/^part/.test(kind)) return "part";
  return "other";
}

/**
 * 解析結果からモデル（図の要素・関係・問題・フェーズ・ビュー）を作る。
 * 名前の解決に失敗したものは、例外にせず問題（problems）として加える。
 *
 * @param P パーサの解析結果
 * @returns 図に投影するモデル
 * @example
 * build(parse("package P { part def A; }")).nodes.map((n) => n.key) // → ["A"]
 * build(parse("package P { part def W { part a : X; } }")).problems.map((p) => p.msg)
 * // → ["型「X」が見つかりません（a）"]（見つからない型）
 */
export function build(P: ParseResult): Model {
  const nodes: ModelNode[] = [];
  const nodeOf = new Map<Entry, ModelNode>();
  const byName = new Map<string, Entry[]>();
  const edges: ModelEdge[] = [];
  const problems: Problem[] = [];
  for (const e of P.entries) {
    if (!e.name) continue;
    const list = byName.get(e.name);
    if (list) list.push(e);
    else byName.set(e.name, [e]);
  }
  for (const e of P.entries) {
    if (!e.name) continue;
    // メタデータとビューの定義は、図に描く要素ではない
    if ((e.isDef && e.kind !== "metadata def" && e.kind !== "view def") || (["part", "requirement"].includes(e.kind) && e.pe && e.pe.kind === "package")) {
      let key = e.name;
      if (nodes.some((n) => n.key === key)) key = e.name + "@" + (e.pe ? e.pe.name : "");
      const n: ModelNode = {
        key, name: e.name, short: e.short, kind: e.kind, isDef: e.isDef, entry: e, fam: family(e.kind), trans: [], ports: [],
        phase: null, phaseOwn: false,
      };
      nodes.push(n);
      nodeOf.set(e, n);
    }
  }
  const defNamed = (nm: string): Entry | null => byName.get(nm)?.find((x) => x.isDef) ?? null;
  const typeScope = (e: Entry): Entry | null => (e.isDef ? e : e.type ? defNamed(e.type) : null);
  const findFirst = (nm: string, ctx: Entry | null): Entry | null => {
    for (let a = ctx; a; a = a.pe) {
      const c = a.children.find((x) => x.name === nm);
      if (c) return c;
      if (a.name === nm) return a;
    }
    const l = byName.get(nm);
    if (!l) return null;
    return l.find((x) => nodeOf.has(x)) ?? l[0] ?? null;
  };
  const resolve = (chain: string, ctx: Entry | null): Entry | null => {
    const segs = chain.split(".");
    let cur = findFirst(lastSeg(segs[0] ?? ""), ctx);
    for (let k = 1; k < segs.length; k++) {
      if (!cur) return null;
      const sc = typeScope(cur);
      const seg = segs[k];
      cur = cur.children.find((c) => c.name === seg) ?? sc?.children.find((c) => c.name === seg) ?? null;
    }
    return cur;
  };
  const nodeFor = (e: Entry | null): ModelNode | null => {
    if (!e) return null;
    const n = nodeOf.get(e);
    if (n) return n;
    const d = typeScope(e);
    return d ? (nodeOf.get(d) ?? null) : null;
  };
  const nodeAncestor = (e: Entry | null): ModelNode | null => {
    for (let a = e; a; a = a.pe) {
      const n = nodeOf.get(a);
      if (n) return n;
    }
    return null;
  };
  const addEdge = (kind: ModelEdge["kind"], from: ModelNode, to: ModelNode, label: string, src: Span): ModelEdge => {
    const e: ModelEdge = { id: "", kind, from: from.key, to: to.key, label, src };
    edges.push(e);
    return e;
  };
  const portDir = (c: Entry): PortDir => {
    const m = c.mods || "";
    if (/\binout\b/.test(m)) return "inout";
    if (/\bout\b/.test(m)) return "out";
    if (/\bin\b/.test(m)) return "in";
    const pd = defNamed(c.type);
    if (!pd) return "inout";
    const ds = pd.children.map((x) => x.mods || x.dir || "");
    const hasO = ds.some((d) => /\bout\b/.test(d));
    const hasI = ds.some((d) => /\bin\b/.test(d));
    let base: PortDir = hasO && !hasI ? "out" : hasI && !hasO ? "in" : "inout";
    if (c.conj && base !== "inout") base = base === "out" ? "in" : "out";
    return base;
  };
  for (const n of nodes) {
    n.ports = n.entry.children
      .filter((c) => c.kind === "port" && c.name)
      .map((c) => ({ name: c.name, type: c.type, conj: !!c.conj, dir: portDir(c), entry: c }));
  }
  for (const u of P.entries) {
    if (u.isDef || !u.type || u.kind === "package") continue;
    const T = defNamed(u.type);
    if (!T) {
      if (!isLib(u.type) && u.kind !== "subject" && !(u.kind === "view" && isStandardView(u.type))) problems.push({ pos: u.start, msg: `型「${u.type}」が見つかりません（${u.name || u.kind}）` });
      continue;
    }
    const tn = nodeOf.get(T);
    const un = nodeOf.get(u);
    const pn = u.pe ? nodeOf.get(u.pe) : undefined;
    if (un) {
      if (tn) addEdge("defined", un, tn, "", { start: u.start, end: u.end });
    } else if (COMP_KINDS.has(u.kind) && pn && u.pe !== T && tn) addEdge("comp", pn, tn, u.name, { start: u.start, end: u.end });
  }
  for (const r of P.rels) {
    const src = { start: r.start, end: r.end + 1 };
    if (r.rel === "satisfy") {
      const a = nodeFor(resolve(r.by, r.pe));
      const b = nodeFor(resolve(r.req, r.pe));
      if (a && b) addEdge("satisfy", a, b, "«satisfy»", src);
      else problems.push({ pos: r.start, msg: `「満たす」関係の相手「${!b ? r.req : r.by}」が見つかりません（satisfy）` });
    } else if (r.rel === "verify") {
      const a = nodeAncestor(r.pe);
      const b = nodeFor(resolve(r.req, r.pe));
      if (a && b) addEdge("verify", a, b, "«verify»", src);
      else problems.push({ pos: r.start, msg: `「検証する」関係の相手「${r.req}」が見つかりません（verify）` });
    } else if (r.rel === "frame") {
      const a = nodeAncestor(r.pe);
      const T = defNamed(r.type);
      const tn = T ? nodeOf.get(T) : undefined;
      if (a && tn) addEdge("frame", a, tn, "«frame»", src);
      else problems.push({ pos: r.start, msg: `扱う関心事「${r.type}」が見つかりません（frame）` });
    } else if (r.rel === "flow" || r.rel === "connect") {
      const pa = r.a.split(".");
      const pb = r.b.split(".");
      const a = nodeFor(resolve(pa[0] ?? "", r.pe));
      const b = nodeFor(resolve(pb[0] ?? "", r.pe));
      const s = r.rel === "connect" ? { start: r.usage.start, end: r.usage.end } : src;
      if (a && b) {
        const ed = addEdge("flow", a, b, r.item || "", s);
        ed.rel = r;
        const chk = (nd: ModelNode, seg: string | undefined, side: "fromPort" | "toPort"): void => {
          if (!seg) return;
          if (nd.ports.some((p) => p.name === seg)) ed[side] = "port:" + seg;
          else if (!nd.entry.children.some((c) => c.name === seg)) problems.push({ pos: r.start, msg: `ポート「${seg}」が ${nd.name} にありません` });
        };
        chk(a, pa[1], "fromPort");
        chk(b, pb[1], "toPort");
      } else problems.push({ pos: r.start, msg: `線の接続先「${!a ? r.a : r.b}」が見つかりません（${r.rel}）` });
    } else if (r.rel === "derive") {
      const a = nodeFor(resolve(r.a, r.pe));
      const b = nodeFor(resolve(r.b, r.pe));
      if (a && b) addEdge("derive", a, b, "«derive»", src);
      else problems.push({ pos: r.start, msg: `「導出」関係の相手「${!a ? r.a : r.b}」が見つかりません（derivation）` });
    } else if (r.rel === "message") {
      const seg = (x: string): string => x.split(".")[0] ?? "";
      for (const x of [r.a, r.b]) {
        if (!r.pe || !r.pe.children.some((c) => c.name === seg(x)))
          problems.push({ pos: r.start, msg: `メッセージの相手「${seg(x)}」が「${r.pe ? r.pe.name : ""}」の中にありません（message）` });
      }
    } else if (r.rel === "transition") {
      const a = nodeAncestor(r.pe);
      if (a) a.trans.push(`${r.from} → ${r.to}` + (r.ev ? `  [${r.ev}]` : ""));
    }
  }
  const seen = new Map<string, number>();
  for (const e of edges) {
    const b = `${e.kind}|${e.from}|${e.to}|${e.label}`;
    const k = (seen.get(b) ?? 0) + 1;
    seen.set(b, k);
    e.id = b + "#" + k;
  }
  for (const e of P.errors) problems.push(e);
  // 黙って捨てず、まだ扱えない構文があることを知らせる（ADR-0013）
  for (const u of P.unsupported) {
    const head = u.head.length > 40 ? u.head.slice(0, 40) + "…" : u.head;
    problems.push({ pos: u.start, kind: "unsupported", msg: `「${head}」は Modelith ではまだ扱えないため、図とツリーに出ません` });
  }
  // ---- フェーズ ----
  let phases: string[] | null = null;
  let phaseEnum: string | null = null;
  const pmd = (byName.get("Phase") ?? []).find((x) => x.kind === "metadata def");
  if (pmd) {
    const st = pmd.children.find((c) => c.name === "stage");
    const en = st ? defNamed(st.type) : null;
    if (en && en.enumValues && en.enumValues.length) {
      phases = en.enumValues;
      phaseEnum = en.name;
    }
  }
  const phaseOf = (e: Entry): PhaseInfo | null => {
    for (let a: Entry | null = e; a; a = a.pe) {
      const stage = a.meta?.["Phase"]?.["stage"];
      if (stage) return { value: stage, own: a === e, holder: a };
    }
    return null;
  };
  for (const n of nodes) {
    const p = phaseOf(n.entry);
    n.phase = p ? p.value : null;
    n.phaseOwn = !!(p && p.own);
  }
  if (phases) addTraceGaps(nodes, edges, phases, problems);
  const views = buildViews(P.entries, nodeOf, byName, problems);
  return { nodes, views, edges, problems, nodeOf, byName, rels: P.rels, phases, phaseEnum, phaseOf };
}

/**
 * 修飾名の最後の区切り（`::` の後ろ）を取り出す。
 *
 * @param s 修飾名（`P::Q::A` など）
 * @returns 最後の区切り。`::` が無ければ s のまま
 * @example
 * lastSeg("P::Q::A") // → "A"
 * lastSeg("A")       // → "A"
 */
const lastSeg = (s: string): string => s.split("::").pop() ?? "";

/**
 * フェーズに沿った要求のトレースの抜け（導出・充足・検証）を問題（kind: "gap"）として problems に加える。
 * 最初のフェーズの要求は下位への展開が無いとき、それ以降のフェーズの要求は導出元・充足・検証のどれかが無いときに加える。
 *
 * @param nodes 図の要素（フェーズを割り当て済みのもの）
 * @param edges 図の関係（derive・satisfy・verify を探す）
 * @param phases フェーズの列挙値（上位から順に）
 * @param problems 問題を書き足す先（書き換える）
 */
function addTraceGaps(nodes: ModelNode[], edges: ModelEdge[], phases: string[], problems: Problem[]): void {
  const label = (n: ModelNode): string => (n.short ? `<'${n.short}'>` : n.name);
  const has = (kind: ModelEdge["kind"], end: "from" | "to", key: string): boolean => edges.some((e) => e.kind === kind && e[end] === key);
  for (const n of nodes) {
    if (n.kind !== "requirement def" || !n.phase) continue;
    const i = phases.indexOf(n.phase);
    if (i < 0) continue;
    const pos = n.entry.start;
    const gap = (msg: string): void => {
      problems.push({ pos, kind: "gap", msg: `${label(n)} ${n.name}：${msg}` });
    };
    if (i === 0) {
      if (!has("derive", "to", n.key)) gap("どの下位の要求にも展開されていません（derivation）");
    } else {
      if (!has("derive", "from", n.key)) gap("導出元の上位の要求がありません（derivation）");
      if (!has("satisfy", "to", n.key)) gap("この要求を満たす要素がありません（satisfy）");
      if (!has("verify", "to", n.key)) gap("この要求を確かめる検証がありません（verify）");
    }
  }
}
