// 図の SVG マークアップを作る。画面表示と SVG 書き出しで共用し、色は関数 C で差し替える。

import { family } from "../core";
import { esc } from "./dom";
import { computeRoutes, HEAD, LH, linesOf, nodeH, pinPoint, pinsOf, W, type NodeBox } from "./geometry";
import type { ViewLayout } from "./layout";
import { phaseLabel, type ViewContent } from "./views";

/** 色の名前（CSS 変数名から `--` を除いたもの）を値にする。 */
export type ColorFn = (name: string) => string;
export const CV: ColorFn = (v) => `var(--${v})`;

export interface MarkupOpts {
  font?: string;
  mono?: string;
  interactive?: boolean;
  /** 接続点の表示を決めるビュー（トレーサビリティ・振る舞いは未配置のポートを隠す）。 */
  view: string;
  sel?: string | null;
  selSet?: Set<string>;
  selEdge?: string | null;
  selPin?: { node: string; pin: string } | null;
  pulse?: Set<string>;
  cands?: Set<string> | null;
  edgeStyle?: "ortho" | "curve";
  dim?: Set<string> | undefined;
  phases?: boolean;
}

function portGlyph(cx: number, cy: number, nx: number, ny: number, dir: string, col: string, panel: string, stroke: string, sw: number): string {
  const ar = (dx: number, dy: number, hx: number, hy: number): string => {
    const px = -dy, py = dx;
    return `<path d="M${hx},${hy} L${hx - dx * 3.6 + px * 2.7},${hy - dy * 3.6 + py * 2.7} L${hx - dx * 3.6 - px * 2.7},${hy - dy * 3.6 - py * 2.7} Z" fill="${col}"/>`;
  };
  const dx = dir === "in" ? -nx : nx, dy = dir === "in" ? -ny : ny;
  let s = `<rect x="${cx - 6.5}" y="${cy - 6.5}" width="13" height="13" fill="${panel}" stroke="${stroke}" stroke-width="${sw}"/>`;
  if (dir === "inout")
    s += `<path d="M${cx - dx * 2},${cy - dy * 2} L${cx + dx * 2},${cy + dy * 2}" stroke="${col}" stroke-width="1.2"/>` + ar(dx, dy, cx + dx * 4.6, cy + dy * 4.6) + ar(-dx, -dy, cx - dx * 4.6, cy - dy * 4.6);
  else s += `<path d="M${cx - dx * 4.2},${cy - dy * 4.2} L${cx + dx * 1.5},${cy + dy * 1.5}" stroke="${col}" stroke-width="1.3"/>` + ar(dx, dy, cx + dx * 4.6, cy + dy * 4.6);
  return s;
}

const EDGE_COLOR: Record<string, string> = { satisfy: "k-part", verify: "k-ver", frame: "k-concern", flow: "k-con", derive: "k-req" };

/** ブロック図（ノードと線）のマークアップ。`es` は線、`ns` はノードと接続点。 */
export function svgMarkup(C: ColorFn, content: ViewContent, L: ViewLayout, opts: MarkupOpts): { es: string; ns: string; box: Map<string, NodeBox> } {
  const { nodes, edges } = content;
  const F = opts.font || "inherit", MONO = opts.mono || "var(--mono)";
  const view = opts.view;
  const box = new Map<string, NodeBox>(
    nodes.map((n) => {
      const p = L.pos[n.key] ?? [0, 0];
      return [n.key, { x: p[0], y: p[1], w: W, h: nodeH(n), n, pins: pinsOf(n, L, view) }];
    }),
  );
  let es = "";
  if (content.frame && box.size) {
    const bs = [...box.values()];
    const x0 = Math.min(...bs.map((b) => b.x)) - 60, y0 = Math.min(...bs.map((b) => b.y)) - 80;
    const x1 = Math.max(...bs.map((b) => b.x + b.w)) + 60, y1 = Math.max(...bs.map((b) => b.y + b.h)) + 50;
    es += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="${C("k-part-bg")}" fill-opacity=".35" stroke="${C("k-part")}" stroke-width="1.6"/>`;
    es += `<text x="${x0 + 12}" y="${y0 + 18}" font-size="10" fill="${C("ink2")}" font-family="${F}">«${esc(content.frame.kind)}»</text><text x="${x0 + 12}" y="${y0 + 36}" font-size="14" font-weight="700" fill="${C("ink")}" font-family="${F}">${esc(content.frame.title)}</text>`;
  }
  const routes = computeRoutes(box, edges, L, opts.edgeStyle || "ortho");
  for (const e of edges) {
    const rt = routes.get(e.id);
    if (!rt) continue;
    const path = rt.d, lx = rt.lab.x, ly = rt.lab.y, la = rt.lab.a;
    const dash = ["satisfy", "verify", "frame", "defined", "derive"].includes(e.kind) ? ' stroke-dasharray="6 4"' : "";
    const mk = e.kind === "comp" ? ' marker-start="url(#mDiamond)"' : e.kind === "flow" ? ' marker-end="url(#mBlock)"' : ' marker-end="url(#mOpen)"';
    const ck = EDGE_COLOR[e.kind];
    const col = ck ? C(ck) : C("ink2");
    const sel = opts.selEdge === e.id ? " sel" : "";
    es +=
      `<g class="edge${sel}" data-edge="${esc(e.id)}"><path class="line" d="${path}" fill="none" stroke="${col}" stroke-width="${e.kind === "flow" ? 1.8 : 1.3}"${dash}${mk}/>` +
      (opts.interactive ? `<path class="hit" d="${path}"/>` : "") +
      (e.label ? `<text x="${lx}" y="${ly}" text-anchor="${la}" font-size="10.5" fill="${col}" stroke="${C("paper")}" stroke-width="4" paint-order="stroke" font-family="${F}">${esc(e.label)}</text>` : "") +
      `</g>`;
  }
  let ns = "", ps = "";
  for (const [, b] of box) ns += nodeMarkup(C, b, opts, F, MONO);
  for (const [, b] of box) ps += pinsMarkup(C, b, opts, MONO);
  return { es, ns: ns + ps, box };
}

function nodeMarkup(C: ColorFn, b: NodeBox, opts: MarkupOpts, F: string, MONO: string): string {
  const n = b.n, fam = n.fam, L2 = linesOf(n);
  const isSel = opts.sel === n.key || !!opts.selSet?.has(n.key);
  const stroke = isSel ? C("sel") : C("k-" + fam);
  const sw = isSel ? 2.6 : 1.3;
  const rx = n.isDef ? 0 : 10;
  const dimmed = !!opts.dim?.has(n.key);
  let s = `<g class="node${opts.pulse?.has(n.key) ? " pulse" : ""}" data-key="${esc(n.key)}" transform="translate(${b.x},${b.y})"${dimmed ? ' opacity=".42"' : ""}>`;
  if (opts.cands?.has(n.key)) s += `<rect x="-5" y="-5" width="${b.w + 10}" height="${b.h + 10}" rx="${rx + 4}" fill="none" stroke="${C("sel")}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  s += `<rect class="body" width="${b.w}" height="${b.h}" rx="${rx}" fill="${C("k-" + fam + "-bg")}" stroke="${stroke}" stroke-width="${sw}"/>`;
  s += `<rect width="4" height="${b.h}" fill="${C("k-" + fam)}" rx="${rx ? 2 : 0}"/>`;
  s += `<text x="${b.w / 2}" y="17" text-anchor="middle" font-size="10" fill="${C("ink2")}" font-family="${F}">${esc(`«${n.kind}»`)}</text>`;
  if (opts.phases && n.phase)
    s += `<text x="${b.w}" y="-5" text-anchor="end" font-size="9" fill="${C("k-" + fam)}" font-family="${F}">${esc(phaseLabel(n.phase))}${n.phaseOwn ? "" : "（継承）"}</text>`;
  const title = (n.short ? `<'${n.short}'> ` : "") + n.name + (!n.isDef && n.entry.type ? ` : ${n.entry.type}` : "");
  const tfs = title.length > 26 ? 11 : title.length > 21 ? 12 : 13;
  s += `<text x="${b.w / 2}" y="34" text-anchor="middle" font-size="${tfs}" font-weight="700" fill="${C("ink")}" font-family="${F}">${esc(title.length > 34 ? title.slice(0, 33) + "…" : title)}</text>`;
  if (L2.length) {
    s += `<line x1="4" x2="${b.w}" y1="${HEAD}" y2="${HEAD}" stroke="${C("k-" + fam)}" stroke-opacity=".45"/>`;
    L2.forEach((ln, k) => {
      const mono = ln.cls === "expr" || ln.cls === "attr";
      s += `<text x="12" y="${HEAD + 17 + k * LH}" font-size="${mono ? 10.5 : 11}" fill="${ln.cls === "more" ? C("ink2") : C("ink")}" font-family="${mono ? MONO : F}">${esc(ln.t)}</text>`;
    });
  }
  return s + "</g>";
}

function pinsMarkup(C: ColorFn, b: NodeBox, opts: MarkupOpts, MONO: string): string {
  const n = b.n;
  let ps = "";
  for (const p of b.pins) {
    const q = pinPoint(b, p.side, p.t);
    const psel = !!opts.selPin && opts.selPin.node === n.key && opts.selPin.pin === p.id;
    const col = C("k-" + n.fam);
    ps += `<g class="pin" data-node="${esc(n.key)}" data-pin="${esc(p.id)}">`;
    if (p.port) {
      ps += portGlyph(q.x, q.y, q.nx, q.ny, p.port.dir, col, C("panel"), psel ? C("sel") : col, psel ? 2.4 : 1.3);
      const lxp = q.nx ? q.x + q.nx * 9 : q.x + 9, lyp = q.nx ? q.y - 9 : q.ny > 0 ? q.y + 17 : q.y - 10;
      const anc = q.nx < 0 ? "end" : "start";
      ps += `<text x="${lxp}" y="${lyp}" text-anchor="${anc}" font-size="9.5" fill="${C("ink2")}" stroke="${C("paper")}" stroke-width="3" paint-order="stroke" font-family="${MONO}">${esc(p.port.name)}</text>`;
      if (opts.interactive) ps += `<rect x="${q.x - 11}" y="${q.y - 11}" width="22" height="22" fill="transparent"/>`;
    } else {
      ps += `<circle cx="${q.x}" cy="${q.y}" r="${psel ? 5 : 3.6}" fill="${psel ? C("sel") : col}" stroke="${C("panel")}" stroke-width="1"/>`;
      if (opts.interactive) ps += `<circle cx="${q.x}" cy="${q.y}" r="10" fill="transparent"/>`;
    }
    ps += `</g>`;
  }
  return ps;
}

/** シーケンス図の寸法。 */
export const SEQ = { dx: 200, w: 170, h: 46, first: 40, gap: 54 };

export function seqGeom(c: ViewContent): { x0: number; y0: number; w: number; h: number; H: number } {
  const n = c.nodes.length, m = c.edges.length;
  const H = SEQ.h + SEQ.first + Math.max(1, m) * SEQ.gap + 20;
  return { x0: -24, y0: -60, w: Math.max(1, n) * SEQ.dx - (SEQ.dx - SEQ.w) + 48, h: H + 84, H };
}

/** シーケンス図のマークアップ。 */
export function seqMarkup(C: ColorFn, c: ViewContent, opts: Omit<MarkupOpts, "view"> = {}): { s: string; g: ReturnType<typeof seqGeom> } {
  const F = opts.font || "inherit", MONO = opts.mono || "var(--mono)";
  const g = seqGeom(c);
  const X = (i: number): number => i * SEQ.dx + SEQ.w / 2;
  const idx = new Map(c.nodes.map((l, i) => [l.key, i]));
  let s = `<rect x="${g.x0}" y="${g.y0}" width="${g.w}" height="${g.h}" fill="none" stroke="${C("k-beh")}" stroke-width="1.3"/>`;
  const title = "sd " + (c.ctx ? c.ctx.name : "");
  s += `<path d="M${g.x0},${g.y0} h${title.length * 7.6 + 24} v14 l-10,10 H${g.x0} Z" fill="${C("k-beh-bg")}" stroke="${C("k-beh")}" stroke-width="1.1"/>`;
  s += `<text x="${g.x0 + 8}" y="${g.y0 + 16}" font-size="12" font-weight="700" fill="${C("ink")}" font-family="${F}">${esc(title)}</text>`;
  c.nodes.forEach((l, i) => {
    const x = i * SEQ.dx, sel = opts.sel === l.key || !!opts.selSet?.has(l.key);
    const label = l.name + (l.entry.type ? " : " + l.entry.type : "");
    s +=
      `<g class="lifeline" data-key="${esc(l.key)}">` +
      `<line x1="${X(i)}" y1="${SEQ.h}" x2="${X(i)}" y2="${g.H}" stroke="${C("ink2")}" stroke-dasharray="5 4"/>` +
      (opts.interactive ? `<rect x="${X(i) - 16}" y="${SEQ.h}" width="32" height="${g.H - SEQ.h}" fill="transparent"/>` : "") +
      `<rect width="${SEQ.w}" height="${SEQ.h}" x="${x}" y="0" rx="8" fill="${C("k-part-bg")}" stroke="${sel ? C("sel") : C("k-part")}" stroke-width="${sel ? 2.6 : 1.3}"/>` +
      `<text x="${X(i)}" y="18" text-anchor="middle" font-size="10" fill="${C("ink2")}" font-family="${F}">«${esc(l.kind)}»</text>` +
      `<text x="${X(i)}" y="36" text-anchor="middle" font-size="${l.name.length + l.entry.type.length > 20 ? 10.5 : 12.5}" font-weight="700" fill="${C("ink")}" font-family="${F}">${esc(label)}</text></g>`;
  });
  c.edges.forEach((e, k) => {
    const a = idx.get(e.from), b = idx.get(e.to);
    if (a == null || b == null) return;
    const y = SEQ.h + SEQ.first + k * SEQ.gap;
    const sel = opts.selEdge === e.id;
    const col = sel ? C("sel") : C("ink");
    const lab = `${k + 1}. ${e.label || "（名前なし）"}${e.type ? " : " + e.type : ""}`;
    let d: string, lx: number;
    if (a === b) {
      d = `M${X(a)},${y} h46 v20 h-44`;
      lx = X(a) + 52;
    } else {
      d = `M${X(a)},${y} L${X(b) + (b > a ? -2 : 2)},${y}`;
      lx = (X(a) + X(b)) / 2;
    }
    s +=
      `<g class="edge${sel ? " sel" : ""}" data-edge="${esc(e.id)}"><path class="line" d="${d}" fill="none" stroke="${col}" stroke-width="${sel ? 2.4 : 1.4}" marker-end="url(#mMsg)"/>` +
      (opts.interactive ? `<path class="hit" d="${d}"/>` : "") +
      `<text x="${lx}" y="${y - 7}" text-anchor="${a === b ? "start" : "middle"}" font-size="11" fill="${col}" stroke="${C("paper")}" stroke-width="4" paint-order="stroke" font-family="${MONO}">${esc(lab)}</text></g>`;
  });
  return { s, g };
}

/** 矢印などのマーカー定義。 */
export const DEFS =
  `<marker id="mDiamond" viewBox="0 0 20 10" refX="1" refY="5" markerWidth="18" markerHeight="9" orient="auto-start-reverse"><path d="M1,5 L10,1 L19,5 L10,9 Z" style="fill:var(--ink2)"/></marker>` +
  `<marker id="mOpen" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto"><path d="M1,1 L11,6 L1,11" fill="none" style="stroke:var(--ink2)" stroke-width="1.4"/></marker>` +
  `<marker id="mMsg" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="10" markerHeight="10" orient="auto"><path d="M1,1 L11,6 L1,11 Z" style="fill:var(--ink)"/></marker>` +
  `<marker id="mBlock" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="10" markerHeight="10" orient="auto"><path d="M1,1 L11,6 L1,11 Z" style="fill:var(--k-con)"/></marker>`;

/* ---- アイコン ---- */
const ICON_L: Record<string, string> = {
  requirement: "R", concern: "Cn", verification: "V", analysis: "An", part: "P", attribute: "At", port: "Po", item: "It", constraint: "Cs",
  state: "S", action: "Ac", occurrence: "Oc", interface: "If", enum: "E", calc: "Ca", connection: "Cx", "use case": "U",
  "perform action": "Ac", "exhibit state": "S", param: "·", message: "M", metadata: "Md",
};

/** 種類を表す小さなアイコン（ツリー・パレット・タブ）。 */
export function kindIcon(kind: string): string {
  if (kind === "package")
    return `<svg class="ki" width="18" height="16" viewBox="0 0 18 16" aria-hidden="true"><path d="M1.5 3.5h5l1.6 1.6h8.4v8.9H1.5Z" fill="var(--k-req-bg)" stroke="var(--k-req)"/></svg>`;
  const fam = kind === "message" ? "beh" : family(kind);
  const isDef = / def$/.test(kind);
  const base = kind.replace(/ def$/, "");
  const L = ICON_L[base] ?? base.charAt(0).toUpperCase();
  return (
    `<svg class="ki" width="18" height="16" viewBox="0 0 18 16" aria-hidden="true"><rect x=".5" y="1.5" width="17" height="13" rx="${isDef ? 0 : 4}" fill="var(--k-${fam}-bg)" stroke="var(--k-${fam})"/>` +
    `<text x="9" y="11.2" text-anchor="middle" font-size="${L.length > 1 ? 7.5 : 9}" font-weight="700" fill="var(--k-${fam})" font-family="var(--sans)">${L}</text></svg>`
  );
}

export const HAND_ICON = `<svg class="ki" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 9V4.2a1 1 0 0 1 2 0V8m0-.6V3.2a1 1 0 0 1 2 0V8m0-1.2V4.2a1 1 0 0 1 2 0V9m0-1.2a1 1 0 0 1 2 0v3.4c0 2-1.6 3.4-3.6 3.4H8.6c-1 0-1.7-.4-2.3-1.1L3.6 11a1 1 0 0 1 1.5-1.3L6.6 11" fill="none" stroke="var(--ink)" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const SELECT_ICON = `<svg class="ki" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2l9 6-4 1 2.5 4.5-1.6.9L6.4 9.8 3 12.5Z" fill="var(--ink)"/></svg>`;

const VIEW_ICON_KIND: Record<string, string> = {
  trace: "requirement def", structure: "part def", control: "constraint def", ibd: "part", behavior: "state def", seq: "occurrence def", all: "package",
};
export const viewIcon = (view: string): string => {
  const k = VIEW_ICON_KIND[view];
  return k ? kindIcon(k) : "";
};

