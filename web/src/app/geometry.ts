// 図の幾何計算（ノードの大きさ・接続点・線の経路・自動配置）。DOM に依存しない純粋関数。

import type { ModelEdge, ModelNode, Port, PortDir } from "../core";
import type { Pos, Side, ViewLayout } from "./layout";
import type { ViewDef } from "./views";

export const W = 224;
export const HEAD = 44;
export const LH = 15;

const cw = (ch: string): number => (/[　-鿿＀-￯]/.test(ch) ? 11 : 6.3);
/** 文字列の幅の目安（11px の文字）。 */
export const textWidth = (s: string): number => [...s].reduce((w, ch) => w + cw(ch), 0);

/** 幅に収まるように折り返す。行数を超えたら最後を「…」で切る。 */
export function wrap(s: string, maxW = W - 18, maxLines = 3): string[] {
  const out: string[] = [];
  let cur = "";
  let w = 0;
  for (const ch of s) {
    const c = cw(ch);
    if (w + c > maxW) {
      out.push(cur);
      cur = "";
      w = 0;
      if (out.length >= maxLines) break;
    }
    cur += ch;
    w += c;
  }
  if (out.length < maxLines && cur) out.push(cur);
  else if (out.length >= maxLines) {
    const last = out[maxLines - 1] ?? "";
    out[maxLines - 1] = last.slice(0, -1) + "…";
  }
  return out.slice(0, maxLines);
}

export interface Line {
  t: string;
  cls: "doc" | "expr" | "attr" | "more";
}

/** ノードの区画（説明・式・属性など）に書く行。 */
export function compartment(n: ModelNode): Line[] {
  const e = n.entry;
  const L: Line[] = [];
  const push = (t: string, cls: Line["cls"], max = 2): void => {
    for (const x of wrap(t, W - 18, max)) L.push({ t: x, cls });
  };
  if (e.doc && ["req", "concern", "ver", "con"].includes(n.fam)) push(e.doc, "doc", 3);
  if (n.fam === "req") for (const x of e.exprs) if (x.via === "require" || !x.via) push(`{ ${x.text} }`, "expr");
  if (n.fam === "con") for (const x of e.exprs) push(x.text, "expr", 3);
  if (["part", "other"].includes(n.fam)) {
    for (const c of e.children) if (c.kind === "attribute" || c.kind === "param") push(c.value ? `${c.name} = ${c.value}` : `${c.name} : ${c.type}`, "attr", 1);
  }
  if (n.kind === "state def") {
    const st = e.children.filter((c) => c.kind === "state").map((c) => c.name);
    if (st.length) push("states: " + st.join(", "), "attr");
    for (const t of n.trans) push(t, "expr", 1);
  }
  if (n.kind === "action def") {
    e.children.filter((c) => c.kind === "action").forEach((c, k) => push(`${k + 1}. ${c.name}`, "attr", 1));
  }
  const MAX = 8;
  if (L.length > MAX) {
    const rest = L.length - (MAX - 1);
    L.length = MAX - 1;
    L.push({ t: `… ほか ${rest} 行`, cls: "more" });
  }
  return L;
}

const linesCache = new WeakMap<ModelNode, Line[]>();
/** 区画の行（ノードごとにキャッシュ）。 */
export function linesOf(n: ModelNode): Line[] {
  let L = linesCache.get(n);
  if (!L) {
    L = compartment(n);
    linesCache.set(n, L);
  }
  return L;
}

export function nodeH(n: ModelNode): number {
  const L = linesOf(n);
  return HEAD + (L.length ? L.length * LH + 12 : 0);
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pin {
  id: string;
  side: Side;
  t: number;
  port?: Port;
}

export interface NodeBox extends Box {
  n: ModelNode;
  pins: Pin[];
}

const DEF_SIDE: Record<PortDir, Side> = { in: "l", out: "r", inout: "b" };

/** ブロック縁上の接続点。ポート由来（port:名前）と自由な接続点（a1, a2…）がある。 */
export function pinsOf(n: ModelNode, L: ViewLayout | undefined, view: string): Pin[] {
  const stored = L?.pins[n.key] ?? {};
  const res: Pin[] = [];
  const g: Record<PortDir, Port[]> = { in: [], out: [], inout: [] };
  const hideUnplaced = view === "trace" || view === "behavior";
  for (const p of n.ports) if (!hideUnplaced || stored["port:" + p.name]) g[p.dir].push(p);
  for (const d of ["in", "out", "inout"] as const) {
    g[d].forEach((p, i, arr) => {
      const id = "port:" + p.name;
      const s = stored[id];
      res.push({ id, side: s ? s[0] : DEF_SIDE[d], t: s ? s[1] : (i + 1) / (arr.length + 1), port: p });
    });
  }
  for (const [id, v] of Object.entries(stored)) if (!id.startsWith("port:")) res.push({ id, side: v[0], t: v[1] });
  return res;
}

export interface BorderPoint {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** 縁上の位置（辺と 0〜1 の割合）を座標と外向きの法線にする。 */
export function pinPoint(b: Box, side: Side, t: number): BorderPoint {
  if (side === "t") return { x: b.x + t * b.w, y: b.y, nx: 0, ny: -1 };
  if (side === "b") return { x: b.x + t * b.w, y: b.y + b.h, nx: 0, ny: 1 };
  if (side === "l") return { x: b.x, y: b.y + t * b.h, nx: -1, ny: 0 };
  return { x: b.x + b.w, y: b.y + t * b.h, nx: 1, ny: 0 };
}

const clamp = (v: number, a: number, c: number): number => Math.max(a, Math.min(c, v));

/** 点に最も近い縁の位置（10 単位に丸め、角から 8 以上離す）。 */
export function nearestBorder(b: Box, px: number, py: number): { side: Side; t: number; d: number } {
  const sides: { side: Side; along: number; len: number; d: number }[] = [
    { side: "t", along: clamp(px, b.x, b.x + b.w) - b.x, len: b.w, d: Math.hypot(px - clamp(px, b.x, b.x + b.w), py - b.y) },
    { side: "b", along: clamp(px, b.x, b.x + b.w) - b.x, len: b.w, d: Math.hypot(px - clamp(px, b.x, b.x + b.w), py - (b.y + b.h)) },
    { side: "l", along: clamp(py, b.y, b.y + b.h) - b.y, len: b.h, d: Math.hypot(px - b.x, py - clamp(py, b.y, b.y + b.h)) },
    { side: "r", along: clamp(py, b.y, b.y + b.h) - b.y, len: b.h, d: Math.hypot(px - (b.x + b.w), py - clamp(py, b.y, b.y + b.h)) },
  ];
  const s = sides.reduce((a, c) => (c.d < a.d ? c : a));
  const along = clamp(Math.round(s.along / 10) * 10, 8, s.len - 8);
  return { side: s.side, t: +(along / s.len).toFixed(3), d: s.d };
}

/** 線の両端の接続点 ID（配置で指定がなければポート）。 */
export function edgeEnds(e: ModelEdge, L: ViewLayout | undefined): { f: string | null; t: string | null } {
  const o = L?.ends[e.id];
  return o ? { f: o[0], t: o[1] } : { f: e.fromPort ?? null, t: e.toPort ?? null };
}

/* ---- 線のルーティング ---- */
type Pt = [number, number];
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 相手の位置から、線を出す辺を選ぶ。 */
export function chooseSide(b: Box, o: Box): Side {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, ox = o.x + o.w / 2, oy = o.y + o.h / 2;
  const dx = ox - cx, dy = oy - cy;
  const gx = Math.abs(dx) - (b.w + o.w) / 2, gy = Math.abs(dy) - (b.h + o.h) / 2;
  if (gy >= gx) return dy > 0 ? "b" : "t";
  return dx > 0 ? "r" : "l";
}

function segHits(a: Pt, b: Pt, r: Rect): boolean {
  if (a[1] === b[1]) {
    const y = a[1];
    if (y <= r.y0 || y >= r.y1) return false;
    const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
    return hi > r.x0 && lo < r.x1;
  }
  if (a[0] === b[0]) {
    const x = a[0];
    if (x <= r.x0 || x >= r.x1) return false;
    const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
    return hi > r.y0 && lo < r.y1;
  }
  return false;
}

/** 折れ線から重複点と一直線上の中間点を除く。 */
export function simplifyPath(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q: Pt = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    const l = out[out.length - 1];
    if (l && l[0] === q[0] && l[1] === q[1]) continue;
    const a = out[out.length - 2];
    if (l && a && ((a[0] === l[0] && l[0] === q[0]) || (a[1] === l[1] && l[1] === q[1]))) {
      out[out.length - 1] = q;
      continue;
    }
    out.push(q);
  }
  return out;
}

/** 直角の経路の候補から、短く・曲がりが少なく・ブロックを横切らないものを選ぶ。 */
export function orthoRoute(P1: Pt, N1: Pt, P2: Pt, N2: Pt, obs: Rect[]): Pt[] {
  const s = 18;
  const S1: Pt = [P1[0] + N1[0] * s, P1[1] + N1[1] * s], S2: Pt = [P2[0] + N2[0] * s, P2[1] + N2[1] * s];
  const x0 = Math.min(S1[0], S2[0]) - 260, x1 = Math.max(S1[0], S2[0]) + 260, y0 = Math.min(S1[1], S2[1]) - 260, y1 = Math.max(S1[1], S2[1]) + 260;
  const near = obs.filter((r) => r.x1 > x0 && r.x0 < x1 && r.y1 > y0 && r.y0 < y1);
  const ys = new Set([(S1[1] + S2[1]) / 2, S1[1], S2[1]]), xs = new Set([(S1[0] + S2[0]) / 2, S1[0], S2[0]]);
  for (const r of near) {
    ys.add(r.y0 - 12);
    ys.add(r.y1 + 12);
    xs.add(r.x0 - 12);
    xs.add(r.x1 + 12);
  }
  const cands: Pt[][] = [[S1, [S2[0], S1[1]], S2], [S1, [S1[0], S2[1]], S2]];
  for (const m of ys) cands.push([S1, [S1[0], m], [S2[0], m], S2]);
  for (const m of xs) cands.push([S1, [m, S1[1]], [m, S2[1]], S2]);
  let best: Pt[] = [P1, P2];
  let bc = Infinity;
  for (const c of cands) {
    const pts = simplifyPath([P1, ...c, P2]);
    let len = 0, hits = 0;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i] as Pt, q = pts[i - 1] as Pt;
      len += Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
    }
    for (let i = 0; i < c.length - 1; i++) for (const r of near) if (segHits(c[i] as Pt, c[i + 1] as Pt, r)) hits++;
    // 出口・入口で折り返さない
    const c1 = c[1] as Pt, cl = c[c.length - 2] as Pt;
    const d1 = [c1[0] - S1[0], c1[1] - S1[1]] as Pt, dl = [S2[0] - cl[0], S2[1] - cl[1]] as Pt;
    let back = 0;
    if (d1[0] * N1[0] + d1[1] * N1[1] < -0.1) back++;
    if (dl[0] * N2[0] + dl[1] * N2[1] > 0.1) back++;
    const cost = len + (pts.length - 2) * 26 + hits * 4000 + back * 3000;
    if (cost < bc) {
      bc = cost;
      best = pts;
    }
  }
  return best;
}

/** 折れ線の角を丸めた SVG パス。 */
export function roundedPath(pts: Pt[], r = 9): string {
  const f = (p: Pt): string => `${p[0]},${p[1]}`;
  let d = `M${f(pts[0] as Pt)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1] as Pt, c = pts[i] as Pt, b = pts[i + 1] as Pt;
    const l1 = Math.hypot(c[0] - a[0], c[1] - a[1]), l2 = Math.hypot(b[0] - c[0], b[1] - c[1]);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const p1: Pt = [c[0] - ((c[0] - a[0]) / l1) * rr, c[1] - ((c[1] - a[1]) / l1) * rr];
    const p2: Pt = [c[0] + ((b[0] - c[0]) / l2) * rr, c[1] + ((b[1] - c[1]) / l2) * rr];
    d += ` L${f(p1)} Q${f(c)} ${f(p2)}`;
  }
  return d + ` L${f(pts[pts.length - 1] as Pt)}`;
}

export interface RouteEnd {
  P: Pt;
  N: Pt;
  side: Side;
  t: number;
  pin: Pin | null;
}

export interface Route {
  d: string;
  lab: { x: number; y: number; a: "middle" | "start" };
  from: RouteEnd;
  to: RouteEnd;
}

interface RouteRec {
  e: ModelEdge;
  A: NodeBox;
  B: NodeBox;
  fp: Pin | undefined;
  tp: Pin | undefined;
  fs: Side;
  ts: Side;
  ft: number;
  tt: number;
}

/** すべての線について、出口・入口の位置と経路を決める。 */
export function computeRoutes(box: Map<string, NodeBox>, edges: ModelEdge[], L: ViewLayout | undefined, style: "ortho" | "curve"): Map<string, Route> {
  const recs: RouteRec[] = [];
  const groups = new Map<string, { rec: RouteRec; end: "f" | "t"; o: Pt }[]>();
  const pointBox = (q: BorderPoint): Box => ({ x: q.x, y: q.y, w: 0, h: 0 });
  const addGroup = (k: string, it: { rec: RouteRec; end: "f" | "t"; o: Pt }): void => {
    const g = groups.get(k);
    if (g) g.push(it);
    else groups.set(k, [it]);
  };
  for (const e of edges) {
    const A = box.get(e.from), B = box.get(e.to);
    if (!A || !B) continue;
    const en = edgeEnds(e, L);
    const fp = en.f ? A.pins.find((p) => p.id === en.f) : undefined;
    const tp = en.t ? B.pins.find((p) => p.id === en.t) : undefined;
    const qa = fp ? pinPoint(A, fp.side, fp.t) : null, qb = tp ? pinPoint(B, tp.side, tp.t) : null;
    const rec: RouteRec = {
      e, A, B, fp, tp,
      fs: fp ? fp.side : chooseSide(A, qb ? pointBox(qb) : B),
      ts: tp ? tp.side : chooseSide(B, qa ? pointBox(qa) : A),
      ft: 0.5, tt: 0.5,
    };
    const other = (q: BorderPoint | null, ob: Box): Pt => (q ? [q.x, q.y] : [ob.x + ob.w / 2, ob.y + ob.h / 2]);
    if (!fp) addGroup(A.n.key + "|" + rec.fs, { rec, end: "f", o: other(qb, B) });
    if (!tp) addGroup(B.n.key + "|" + rec.ts, { rec, end: "t", o: other(qa, A) });
    recs.push(rec);
  }
  // 同じ辺から出る線は、相手の位置の順に等間隔に並べ、固定の接続点を避ける
  for (const [k, list] of groups) {
    const nk = k.slice(0, k.lastIndexOf("|"));
    const side = k.slice(k.lastIndexOf("|") + 1) as Side;
    const b = box.get(nk);
    if (!b) continue;
    const horiz = side === "t" || side === "b";
    const len = horiz ? b.w : b.h;
    list.sort((u, v) => (horiz ? u.o[0] - v.o[0] : u.o[1] - v.o[1]));
    const fixed = b.pins.filter((p) => p.side === side).map((p) => p.t * len);
    list.forEach((it, i) => {
      let pos = (len * (i + 1)) / (list.length + 1);
      for (let g = 0; g < 3; g++) {
        const hit = fixed.find((f) => Math.abs(f - pos) < 16);
        if (hit == null) break;
        pos = hit + (pos >= hit ? 16 : -16);
      }
      pos = Math.max(8, Math.min(len - 8, pos));
      if (it.end === "f") it.rec.ft = pos / len;
      else it.rec.tt = pos / len;
    });
  }
  const obs: Rect[] = [...box.values()].map((b) => ({ x0: b.x - 6, y0: b.y - 6, x1: b.x + b.w + 6, y1: b.y + b.h + 6 }));
  const out = new Map<string, Route>();
  const endOf = (b: Box, pin: Pin | undefined, side: Side, t: number): RouteEnd => {
    if (pin) {
      const q = pinPoint(b, pin.side, pin.t);
      const o = pin.port ? 7 : 0;
      return { P: [q.x + q.nx * o, q.y + q.ny * o], N: [q.nx, q.ny], side: pin.side, t: pin.t, pin };
    }
    const q = pinPoint(b, side, t);
    return { P: [q.x, q.y], N: [q.nx, q.ny], side, t, pin: null };
  };
  for (const r of recs) {
    const a = endOf(r.A, r.fp, r.fs, r.ft), z = endOf(r.B, r.tp, r.ts, r.tt);
    let d: string;
    let lab: Route["lab"];
    if (style === "curve") {
      const dd = Math.hypot(z.P[0] - a.P[0], z.P[1] - a.P[1]);
      const kk = Math.max(28, Math.min(150, dd * 0.45));
      const C1: Pt = [a.P[0] + a.N[0] * kk, a.P[1] + a.N[1] * kk], C2: Pt = [z.P[0] + z.N[0] * kk, z.P[1] + z.N[1] * kk];
      d = `M${a.P.join(",")} C${C1.join(",")} ${C2.join(",")} ${z.P.join(",")}`;
      lab = {
        x: 0.125 * a.P[0] + 0.375 * C1[0] + 0.375 * C2[0] + 0.125 * z.P[0],
        y: 0.125 * a.P[1] + 0.375 * C1[1] + 0.375 * C2[1] + 0.125 * z.P[1] - 4,
        a: "middle",
      };
    } else {
      const pts = orthoRoute(a.P, a.N, z.P, z.N, obs);
      d = roundedPath(pts);
      // ラベルは最も長い区間に置く
      let li = 1, ll = -1;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i] as Pt, q = pts[i - 1] as Pt;
        const l = Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
        if (l > ll) {
          ll = l;
          li = i;
        }
      }
      const a0 = pts[li - 1] as Pt, a1 = pts[li] as Pt;
      lab = a0[1] === a1[1] ? { x: (a0[0] + a1[0]) / 2, y: a0[1] + 13, a: "middle" } : { x: a0[0] + 5, y: (a0[1] + a1[1]) / 2 + 4, a: "start" };
    }
    out.set(r.e.id, { d, lab, from: a, to: z });
  }
  return out;
}

/** 自動配置で上から並べる順位。 */
const RANK: Record<string, number> = {
  "concern def": 0, requirement: 1, "requirement def": 2, part: 3, "part def": 3, "verification def": 3, "attribute def": 5,
  "analysis def": 5, "constraint def": 5, "calc def": 5, "state def": 5, "action def": 5, "occurrence def": 5, "port def": 6,
  "interface def": 6, "item def": 7,
};

/** 配置済みの要素の下に、未配置の要素を段ごとに並べる。 */
export function autoPlace(list: ModelNode[], edges: ModelEdge[], pos: Record<string, Pos>, v: ViewDef, firstPhase: string | null, oy = 0): void {
  const keys = new Set(list.map((n) => n.key));
  const layer = new Map<string, number>();
  if (v.depth) {
    const inc = new Map(list.map((n) => [n.key, 0]));
    for (const e of edges) if (keys.has(e.to) && keys.has(e.from)) inc.set(e.to, (inc.get(e.to) ?? 0) + 1);
    const q = list.filter((n) => !inc.get(n.key)).map((n) => n.key);
    for (const k of q) layer.set(k, 0);
    while (q.length) {
      const k = q.shift() as string;
      for (const e of edges) {
        if (e.from === k && keys.has(e.to) && !layer.has(e.to)) {
          layer.set(e.to, (layer.get(k) ?? 0) + 1);
          q.push(e.to);
        }
      }
    }
    for (const n of list) if (!layer.has(n.key)) layer.set(n.key, 0);
  } else {
    for (const n of list) layer.set(n.key, n.kind === "requirement def" && firstPhase && n.phase === firstPhase ? 0.5 : (RANK[n.kind] ?? 8));
  }
  const rows = [...new Set(layer.values())].sort((a, b) => a - b);
  const byRow = rows.map((r) => list.filter((n) => layer.get(n.key) === r));
  if (v.id === "control" || v.id === "ibd") {
    // 信号の流れの上流を左に
    const flows = edges.filter((e) => e.kind === "flow");
    const score = (n: ModelNode): number => {
      let s = 0, k = 0;
      for (const e of flows) {
        if (e.to === n.key) { s += 1; k++; }
        if (e.from === n.key) { s -= 1; k++; }
      }
      return k ? s / k : 0;
    };
    for (const row of byRow) row.sort((a, b) => score(a) - score(b));
  }
  // 前の段とのつながりの重心で並べ替え、線の交差を減らす
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 1; r < byRow.length; r++) {
      const prev = (byRow[r - 1] ?? []).map((n) => n.key);
      const bc = (n: ModelNode): number => {
        const xs: number[] = [];
        for (const e of edges) {
          if (e.from === n.key && prev.includes(e.to)) xs.push(prev.indexOf(e.to));
          if (e.to === n.key && prev.includes(e.from)) xs.push(prev.indexOf(e.from));
        }
        return xs.length ? xs.reduce((a, b) => a + b) / xs.length : 999;
      };
      byRow[r]?.sort((a, b) => bc(a) - bc(b));
    }
  }
  let y = oy;
  const GX = 70, maxPer = 7;
  const widest = Math.min(maxPer, Math.max(...byRow.map((r) => r.length)));
  for (const row of byRow) {
    for (let i = 0; i < row.length; i += maxPer) {
      const chunk = row.slice(i, i + maxPer);
      const off = ((widest - chunk.length) * (W + GX)) / 2;
      chunk.forEach((n, k) => {
        pos[n.key] = [Math.round((off + k * (W + GX)) / 10) * 10, y];
      });
      y += Math.max(...chunk.map(nodeH)) + 110;
    }
  }
}

/** package の枠の余白（左右・下）と、名前の札の分を含む上の余白。 */
export const PKG_PAD = 18;
export const PKG_TAB = 30;

/**
 * package の枠の位置と大きさ（F-VIEW-9）。枠は、中の要素と、中の枠をすべて囲む。
 * 中に描く要素が 1 つも無い枠は null（描かない）。`inner` に輪があっても止まる。
 */
export function packageRects(frames: readonly { keys: readonly string[]; inner: readonly number[] }[], boxOf: (key: string) => Box | undefined): (Box | null)[] {
  const memo = new Map<number, Box | null>();
  const rect = (i: number, seen: Set<number>): Box | null => {
    const hit = memo.get(i);
    if (hit !== undefined) return hit;
    const f = frames[i];
    if (!f || seen.has(i)) return null;
    const next = new Set(seen).add(i);
    const parts = [...f.keys.flatMap((k) => boxOf(k) ?? []), ...f.inner.flatMap((j) => rect(j, next) ?? [])];
    if (!parts.length) {
      memo.set(i, null);
      return null;
    }
    const x0 = Math.min(...parts.map((b) => b.x)) - PKG_PAD;
    const y0 = Math.min(...parts.map((b) => b.y)) - PKG_TAB;
    const x1 = Math.max(...parts.map((b) => b.x + b.w)) + PKG_PAD;
    const y1 = Math.max(...parts.map((b) => b.y + b.h)) + PKG_PAD;
    const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    memo.set(i, r);
    return r;
  };
  return frames.map((_, i) => rect(i, new Set()));
}
