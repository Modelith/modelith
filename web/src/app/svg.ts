// 図の SVG マークアップを作る。画面表示と SVG 書き出しで共用し、色は関数 C で差し替える。

import type { Family } from "../core";
import { flowDetail, flowShape } from "./action-flow";
import { esc } from "./dom";
import {
  boundaryBoxes, BOUNDARY, boxesOf, LANE_HEAD, laneRects, computeRoutes, DOT, endLabelPos, HEAD, keywordOf, LH, linesOf, noteTop, packageRects, pinPoint, pinsOf, regionSeparators, STATE_HEAD, stateSize, stateTitle,
  textWidth, type Box, type NodeBox,
} from "./geometry";
import { isPseudoState } from "./state-machine";
import type { ViewLayout } from "./layout";
import { phaseLabel, type ViewContent } from "./views";

/** 色の名前（CSS 変数名から `--` を除いたもの）を値にする。 */
export type ColorFn = (name: string) => string;
/**
 * 画面表示用の色の関数。色の名前を CSS 変数の参照にする（テーマの切り替えに追従する）。
 *
 * @param v 色の名前（CSS 変数名から `--` を除いたもの）
 * @returns `var(--名前)` の文字列
 * @example
 * CV("k-part") // → "var(--k-part)"
 * CV("")       // → "var(--)"（名前が空でもそのままつなぐ）
 */
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
  /** トレースの抜けのある要素のキー → 印（△）のツールチップ（F-TRACE-2）。 */
  gaps?: Map<string, string>;
}

/**
 * ポートの記号（縁の上の小さな四角と、向きを表す矢印）を SVG の文字列にする。
 * in は内向き、out は外向きの矢印 1 つ、inout は両向きの矢印を描く。
 *
 * @param cx 記号の中心の x（図の座標）
 * @param cy 記号の中心の y（図の座標）
 * @param nx 縁の外向きの単位法線の x 成分（-1・0・1）
 * @param ny 縁の外向きの単位法線の y 成分（-1・0・1）
 * @param dir ポートの向き（`in`・`out`・`inout`）
 * @param col 矢印の色
 * @param panel 四角の塗りの色
 * @param stroke 四角の枠の色（選択中は選択の色）
 * @param sw 四角の枠の太さ
 * @returns `<rect …/>` と矢印の `<path …/>` をつないだ SVG の文字列
 * @example
 * portGlyph(0, 0, 1, 0, "out", "c", "p", "s", 1.3)
 * // → '<rect x="-6.5" y="-6.5" width="13" height="13" fill="p" stroke="s" stroke-width="1.3"/><path …/><path … fill="c"/>'（右向きの矢印 1 つ）
 * portGlyph(0, 0, 1, 0, "inout", "c", "p", "s", 1.3) // → 四角と、線 1 本と、両向きの矢印 2 つ
 */
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

/** 破線で描く線の種類。 */
const DASHED_EDGES = ["satisfy", "verify", "frame", "defined", "derive", "dependency", "allocate", "annotate", "successionFlow"];
/**
 * 矢印を付けない線の種類（結び付けと、n 項の接続の点から端への線は向きの無い実線、8.2.3.13 の binding-connection・n-ary-segment。
 * メモから要素への線は向きの無い破線、8.2.3.4 の annotation-link）。
 */
const UNDIRECTED_EDGES = ["bind", "connect", "annotate"];
/** 終わりの端の矢印（マーカーの ID）。無い種類は開いた矢印（mOpen）。特殊化・部分集合は白抜きの三角、再定義は三角と縦棒、参照は三角と 2 つの点（8.2.3）。 */
const END_MARKER: Record<string, string> = { flow: "mBlock", specialize: "mTri", subset: "mTri", redefine: "mRedef", reference: "mRef" };

/**
 * 線の種類から、線の破線と矢印の属性を決める（8.2.3 の記法）。部品として持つ線は始まりの端にひし形、結び付けは矢印なし、
 * ほかは終わりの端に矢印を付ける。
 *
 * @param kind 線の種類（`comp`・`satisfy`・`specialize` など）
 * @returns path 要素に足す属性の文字列（先頭に空白を含む）
 * @example
 * edgeStroke("specialize") // → ' marker-end="url(#mTri)"'（実線・白抜きの三角）
 * edgeStroke("satisfy")    // → ' stroke-dasharray="6 4" marker-end="url(#mOpen)"'
 * edgeStroke("comp")       // → ' marker-start="url(#mDiamond)"'
 * edgeStroke("bind")       // → ""（実線・矢印なし）
 * edgeStroke("annotate")   // → ' stroke-dasharray="6 4"'（破線・矢印なし）
 * edgeStroke("succession") // → ' marker-end="url(#mOpen)"'（実線・開いた矢印、8.2.3.17）
 */
export function edgeStroke(kind: string): string {
  const dash = DASHED_EDGES.includes(kind) ? ' stroke-dasharray="6 4"' : "";
  if (kind === "comp") return `${dash} marker-start="url(#mDiamond)"`;
  if (UNDIRECTED_EDGES.includes(kind)) return dash;
  return `${dash} marker-end="url(#${END_MARKER[kind] ?? "mOpen"})"`;
}

const EDGE_COLOR: Record<string, string> = {
  satisfy: "k-part", verify: "k-ver", frame: "k-concern", flow: "k-con", derive: "k-req", bind: "k-con", connect: "k-con", successionFlow: "k-con",
};

/**
 * 図に出した package の枠の位置を求める（F-VIEW-9）。外側の枠から順に並べ、内側の枠が上に重なるようにする。
 *
 * @param content 表示するビューの中身（`packages` に枠ごとの中の要素と中の枠を持つ）
 * @param boxOf 要素のキーから矩形を返す関数。図に無ければ undefined
 * @returns 枠ごとの package の名前と矩形（外側から順）。中に描く要素が無い枠は除く。枠が無ければ空の配列
 * @example
 * // A が (0, 0, 100×50)、B が (200, 100, 100×50)
 * packageBoxes({ …, packages: [{ name: "P", keys: ["A", "B"], inner: [] }] }, boxOf) // → [{ name: "P", r: { x: -18, y: -30, w: 336, h: 198 } }]
 * packageBoxes({ …, packages: [{ name: "P", keys: ["Gone"], inner: [] }] }, boxOf)   // → []（中に描く要素が無い）
 */
export function packageBoxes(content: ViewContent, boxOf: (key: string) => Box | undefined): { name: string; r: Box }[] {
  const frames = content.packages ?? [];
  const rects = packageRects(frames, boxOf);
  const depth = (i: number): number => frames.filter((f) => f.inner.includes(i)).length;
  return frames
    .map((f, i) => ({ name: f.name, r: rects[i], d: depth(i) }))
    .filter((x): x is { name: string; r: Box; d: number } => !!x.r)
    .sort((a, b) => a.d - b.d)
    .map(({ name, r }) => ({ name, r }));
}

/**
 * package の枠を SVG の文字列にする（フォルダの形。名前は左上の札に書く、8.2.3.5）。操作の邪魔をしないよう、ポインタは通す。
 *
 * @param C 色の関数（画面は CV、書き出しは実際の色を返す関数）
 * @param name package の名前（札に書く）
 * @param r 枠の矩形（図の座標。札を含む）
 * @param F 文字のフォント（font-family の値）
 * @returns `<g class="pkg" data-pkg="名前" pointer-events="none">…</g>` の文字列。札の幅は名前の幅 + 20（最小 48）
 * @example
 * packageMarkup(CV, "P", { x: 0, y: 0, w: 300, h: 200 }, "inherit")
 * // → '<g class="pkg" data-pkg="P" pointer-events="none"><rect x="0" y="0" width="48" height="18" …/><rect x="0" y="18" width="300" height="182" …/><text …>P</text></g>'
 */
function packageMarkup(C: ColorFn, name: string, r: Box, F: string): string {
  const tw = Math.max(48, textWidth(name) + 20), th = 18;
  return (
    `<g class="pkg" data-pkg="${esc(name)}" pointer-events="none">` +
    `<rect x="${r.x}" y="${r.y}" width="${tw}" height="${th}" fill="${C("panel")}" stroke="${C("ink2")}" stroke-width="1.2"/>` +
    `<rect x="${r.x}" y="${r.y + th}" width="${r.w}" height="${r.h - th}" fill="${C("panel")}" fill-opacity=".35" stroke="${C("ink2")}" stroke-width="1.2"/>` +
    `<text x="${r.x + 10}" y="${r.y + 13}" font-size="11" font-weight="700" fill="${C("ink")}" font-family="${F}">${esc(name)}</text></g>`
  );
}

/**
 * ブロック図（ノードと線）の SVG マークアップを作る。画面表示と SVG 書き出しで共用する。
 * package の枠・対象の枠（内部ブロック図など）・中に部品を描く部品・線を `es` に、要素と接続点を `ns` に書く。座標の無い要素は (0, 0) に置く。
 *
 * @param C 色の関数（画面は CV）
 * @param content 表示するビューの中身（要素・線・枠）
 * @param L ビューの配置（座標・接続点・線の端）
 * @param opts 描き方（フォント・操作できるか・選択・光らせる要素・接続の候補・線の形・薄くする要素・工程を出すか・接続点を決めるビュー）
 * @returns 線のマークアップ（es）、要素と接続点のマークアップ（ns）、要素のキー → 矩形と接続点（box）
 * @example
 * // 要素 A だけが (0, 0) にあるビュー
 * svgMarkup(CV, content, L, { view: "trace" }) // → { es: "", ns: '<g class="node" data-key="A" transform="translate(0,0)">…</g>', box: Map { "A" → { x: 0, y: 0, w: 224, h: 44, … } } }
 * // 要素の無いビュー
 * svgMarkup(CV, { nodes: [], edges: [] }, L, { view: "trace" }) // → { es: "", ns: "", box: Map {} }
 */
export function svgMarkup(C: ColorFn, content: ViewContent, L: ViewLayout, opts: MarkupOpts): { es: string; ns: string; box: Map<string, NodeBox> } {
  const { nodes, edges } = content;
  const F = opts.font || "inherit", MONO = opts.mono || "var(--mono)";
  const view = opts.view;
  const rects = boxesOf(nodes, L.pos);
  const box = new Map<string, NodeBox>(
    nodes.map((n) => {
      const r = rects.get(n.key) ?? { x: 0, y: 0, w: 0, h: 0 };
      const holds = nodes.some((c) => c.container === n.key);
      return [n.key, { ...r, n, pins: n.junction || n.note ? [] : pinsOf(n, L, view), ...(holds ? { holds } : {}) }];
    }),
  );
  let es = "";
  for (const p of packageBoxes(content, (k) => box.get(k))) es += packageMarkup(C, p.name, p.r, F);
  // 区画（8.2.3.17 の swimlane）は、要素の下・枠の上に描き、枠に含める
  const lanes = laneRects(content.lanes ?? [], box);
  let frameRect: Box | null = null;
  if (content.frame && box.size) {
    const bs = [...box.values(), ...lanes.map((l) => l.r)];
    const x0 = Math.min(...bs.map((b) => b.x)) - 60, y0 = Math.min(...bs.map((b) => b.y)) - 80;
    const x1 = Math.max(...bs.map((b) => b.x + b.w)) + 60, y1 = Math.max(...bs.map((b) => b.y + b.h)) + 50;
    frameRect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    es += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="${C("k-part-bg")}" fill-opacity=".35" stroke="${C("k-part")}" stroke-width="1.6"/>`;
    es += `<text x="${x0 + 12}" y="${y0 + 18}" font-size="10" fill="${C("ink2")}" font-family="${F}">«${esc(content.frame.kind)}»</text><text x="${x0 + 12}" y="${y0 + 36}" font-size="14" font-weight="700" fill="${C("ink")}" font-family="${F}">${esc(content.frame.title)}</text>`;
    for (const l of lanes) es += laneMarkup(C, l.lane.name, l.r, F);
    // 対象そのもののポートを枠の上に置く（線の端になるよう、矩形を box に足す）
    for (const [key, r] of boundaryBoxes(frameRect, content.boundary ?? [])) {
      const n = (content.boundary ?? []).find((x) => x.key === key);
      if (n) box.set(key, { ...r, n, pins: [] });
    }
  }
  // 中に部品・状態を描く要素は線の下に描く（中の要素へ入る線が隠れないように）
  for (const [, b] of box) if (b.holds) es += nodeMarkup(C, b, opts, F, MONO);
  // 並行の状態の領域を、破線で区切る（8.2.3.18）
  for (const k of content.regions ?? []) {
    const outer = k ? box.get(k) : frameRect;
    if (!outer) continue;
    const areas = [...box.values()].filter((b) => (b.n.container ?? "") === k);
    for (const sep of regionSeparators(outer, areas))
      es += `<line class="region" x1="${sep.x1}" x2="${sep.x2}" y1="${sep.y}" y2="${sep.y}" stroke="${C("k-beh")}" stroke-width="1.2" stroke-dasharray="6 4"/>`;
  }
  const routes = computeRoutes(box, edges, L, opts.edgeStyle || "ortho");
  for (const e of edges) {
    const rt = routes.get(e.id);
    if (!rt) continue;
    const path = rt.d, lx = rt.lab.x, ly = rt.lab.y, la = rt.lab.a;
    const ck = EDGE_COLOR[e.kind];
    const col = ck ? C(ck) : C("ink2");
    const sel = opts.selEdge === e.id ? " sel" : "";
    es +=
      `<g class="edge${sel}" data-edge="${esc(e.id)}"><path class="line" d="${path}" fill="none" stroke="${col}" stroke-width="${e.kind === "flow" || e.kind === "connect" ? 1.8 : 1.3}"${edgeStroke(e.kind)}/>` +
      (opts.interactive ? `<path class="hit" d="${path}"/>` : "") +
      (e.label ? `<text x="${lx}" y="${ly}" text-anchor="${la}" font-size="10.5" fill="${col}" stroke="${C("paper")}" stroke-width="4" paint-order="stroke" font-family="${F}">${esc(e.label)}</text>` : "") +
      (e.endLabel ? endLabelMarkup(C, endLabelPos(rt.to), e.endLabel, col, F) : "") +
      `</g>`;
  }
  let ns = "", ps = "";
  for (const [, b] of box) if (!b.holds) ns += nodeMarkup(C, b, opts, F, MONO);
  for (const [, b] of box) ps += pinsMarkup(C, b, opts, MONO);
  return { es, ns: ns + ps, box };
}

/**
 * 線の端に書く文字（多重度など、8.2.3 の multiplicity）を SVG の文字列にする。
 *
 * @param C 色の関数
 * @param at 文字の位置と揃え（`endLabelPos` の結果）
 * @param text 書く文字
 * @param col 文字の色（線と同じ色）
 * @param F 文字のフォント
 * @returns `<text class="end" …>文字</text>` の文字列
 * @example
 * endLabelMarkup(CV, { x: 104, y: 44, a: "start" }, "[4]", "var(--ink2)", "inherit")
 * // → '<text class="end" x="104" y="44" text-anchor="start" font-size="10" …>[4]</text>'
 */
function endLabelMarkup(C: ColorFn, at: { x: number; y: number; a: string }, text: string, col: string, F: string): string {
  return `<text class="end" x="${at.x}" y="${at.y}" text-anchor="${at.a}" font-size="10" fill="${col}" stroke="${C("paper")}" stroke-width="4" paint-order="stroke" font-family="${F}">${esc(text)}</text>`;
}

/**
 * 要素 1 つ（ブロック）を SVG の文字列にする。種類の «キーワード»・名前（長ければ縮めて 34 文字で切る）・属性などの行・工程を描き、
 * 選択・光らせる・接続の候補・薄くする、の状態を見た目に反映する。定義は角の四角、使用は角の丸い四角にする。
 * トレースの抜けのある要素には、右上に △ の印（ツールチップに何が足りないか）を付ける。
 *
 * @param C 色の関数
 * @param b 要素の矩形と、その要素
 * @param opts 描き方（選択・光らせる要素・接続の候補・薄くする要素・工程を出すか・トレースの抜けの印）
 * @param F 文字のフォント
 * @param MONO 式・属性の行のフォント
 * @returns `<g class="node" data-key="キー" transform="translate(x,y)">…</g>` の文字列
 * @example
 * // (10, 20) にある part def A（行なし）、選択なし
 * nodeMarkup(CV, b, { view: "trace" }, "inherit", "var(--mono)")
 * // → '<g class="node" data-key="A" transform="translate(10,20)"><rect class="body" width="224" height="44" rx="0" …/>…«part def»…A…</g>'
 */
function nodeMarkup(C: ColorFn, b: NodeBox, opts: MarkupOpts, F: string, MONO: string): string {
  if (b.n.junction) return junctionMarkup(C, b, opts, F);
  if (b.n.boundary) return boundaryMarkup(C, b, opts, F);
  if (b.n.note) return noteMarkup(C, b, opts, F);
  if (b.n.flow) return flowNodeMarkup(C, b, opts, F, MONO);
  if (b.n.state) return stateNodeMarkup(C, b, opts, F, MONO);
  // 中に部品を描く部品は、区画の行を描かない（中の部品を描く場所にする）
  const n = b.n, fam = n.fam, L2 = b.holds ? [] : linesOf(n);
  const isSel = opts.sel === n.key || !!opts.selSet?.has(n.key);
  const stroke = isSel ? C("sel") : C("k-" + fam);
  const sw = isSel ? 2.6 : 1.3;
  const rx = n.isDef ? 0 : 10;
  const dimmed = !!opts.dim?.has(n.key);
  let s = `<g class="node${opts.pulse?.has(n.key) ? " pulse" : ""}" data-key="${esc(n.key)}" transform="translate(${b.x},${b.y})"${dimmed ? ' opacity=".42"' : ""}>`;
  if (opts.cands?.has(n.key)) s += `<rect x="-5" y="-5" width="${b.w + 10}" height="${b.h + 10}" rx="${rx + 4}" fill="none" stroke="${C("sel")}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  s += `<rect class="body" width="${b.w}" height="${b.h}" rx="${rx}" fill="${C("k-" + fam + "-bg")}" stroke="${stroke}" stroke-width="${sw}"/>`;
  s += `<rect width="4" height="${b.h}" fill="${C("k-" + fam)}" rx="${rx ? 2 : 0}"/>`;
  s += `<text x="${b.w / 2}" y="17" text-anchor="middle" font-size="10" fill="${C("ink2")}" font-family="${F}">${esc(`«${keywordOf(n)}»`)}</text>`;
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
  const gap = opts.gaps?.get(n.key);
  if (gap) s += gapBadge(C, b.w, gap);
  return s + "</g>";
}

/**
 * トレースの抜けの印（右上の小さな △）を SVG の文字列にする。要求の色で塗り、縁を図の地の色で囲んで、明るい・暗い配色のどちらでも箱の線と見分けられるようにする。
 *
 * @param C 色の関数
 * @param w 箱の幅（印は右端から 22 の所に置く）
 * @param title ツールチップ（何が足りないか）
 * @returns `<g class="gapbadge">…</g>` の文字列
 * @example
 * gapBadge(CV, 224, "トレースの抜け：\nこの要求を確かめる検証がありません")
 * // → '<g class="gapbadge" transform="translate(202,5)"><title>トレースの抜け：…</title><path d="M8,0 L16,14 L0,14 Z" fill="var(--k-req)" …/>…</g>'
 */
function gapBadge(C: ColorFn, w: number, title: string): string {
  return (
    `<g class="gapbadge" transform="translate(${w - 22},5)"><title>${esc(title)}</title>` +
    `<path d="M8,0 L16,14 L0,14 Z" fill="${C("k-req")}" stroke="${C("panel")}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<text x="8" y="12.5" text-anchor="middle" font-size="10" font-weight="700" fill="${C("panel")}">!</text></g>`
  );
}

/**
 * アクションの流れの図の要素の形（8.2.3.17）を SVG のパスにする。送る（send）は右が尖った五角形、受ける（accept）は左がへこんだ五角形、
 * ひし形（decide・merge）は辺の中央を頂点にした四角。
 *
 * @param shape 形（send・accept・diamond）
 * @param w 幅
 * @param h 高さ
 * @returns パスの d 属性
 * @example
 * flowPath("send", 168, 44)   // → "M0,0 H152 L168,22 L152,44 H0 Z"
 * flowPath("diamond", 34, 34) // → "M17,0 L34,17 L17,34 L0,17 Z"
 */
function flowPath(shape: "send" | "accept" | "diamond", w: number, h: number): string {
  const tip = 16;
  if (shape === "send") return `M0,0 H${w - tip} L${w},${h / 2} L${w - tip},${h} H0 Z`;
  if (shape === "accept") return `M0,0 H${w} V${h} H0 L${tip},${h / 2} Z`;
  return `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z`;
}

/** 中にアクションの流れを描くアクションの、見出しの高さ（その下を中の要素を描く場所として区切る）。 */
const FLOW_HEAD = 40;

/**
 * アクションの流れの図の要素（8.2.3.17）を SVG の文字列にする。開始は塗った丸、終了は丸の中の塗った丸、fork・join は太い棒、
 * decide・merge はひし形（名前は右に書く）、send・accept は五角形、ほかは角の丸い四角に書く。
 * 四角と五角形には、アクション以外は «種類» を書き、名前（無ければ中身）を太字で、名前と中身の両方があれば中身を下に書き、
 * if・while などの本体のアクションを区画に書く。中にアクションの流れ（入れ子の本体）を描くアクションは、名前を上に書き、その下を区切る。
 *
 * @param C 色の関数
 * @param b 要素の矩形と、その要素（`holds` なら中にアクションの流れを描く）
 * @param opts 描き方（選択・光らせる要素・接続の候補）
 * @param F 文字のフォント
 * @param MONO 中身と区画のフォント
 * @returns `<g class="node flow" data-key="キー" transform="translate(x,y)">…</g>` の文字列
 * @example
 * // (0, 0) にある開始
 * flowNodeMarkup(CV, b, { view: "afv" }, "inherit", "var(--mono)") // → '<g class="node flow" data-key="a:start" …><circle class="body" cx="11" cy="11" r="11" …/></g>'
 * // (0, 80) にある send S() to b
 * flowNodeMarkup(CV, b, { view: "afv" }, "inherit", "var(--mono)") // → '…<path class="body" d="M0,0 H152 L168,22 L152,44 H0 Z" …/>…«send»…S() to b…'
 */
function flowNodeMarkup(C: ColorFn, b: NodeBox, opts: MarkupOpts, F: string, MONO: string): string {
  const n = b.n, shape = flowShape(n.kind), w = b.w, h = b.h;
  const isSel = opts.sel === n.key || !!opts.selSet?.has(n.key);
  const stroke = isSel ? C("sel") : C("k-beh"), sw = isSel ? 2.6 : 1.3;
  let s = `<g class="node flow${opts.pulse?.has(n.key) ? " pulse" : ""}" data-key="${esc(n.key)}" transform="translate(${b.x},${b.y})"${opts.dim?.has(n.key) ? ' opacity=".42"' : ""}>`;
  if (opts.cands?.has(n.key)) s += `<rect x="-5" y="-5" width="${w + 10}" height="${h + 10}" rx="6" fill="none" stroke="${C("sel")}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  const side = (text: string, y: number): string =>
    text ? `<text x="${w + 6}" y="${y}" font-size="10.5" fill="${C("ink2")}" font-family="${F}">${esc(text)}</text>` : "";
  if (shape === "start") return s + `<circle class="body" cx="${w / 2}" cy="${h / 2}" r="${w / 2}" fill="${C("ink")}" stroke="${isSel ? C("sel") : C("ink")}" stroke-width="${sw}"/></g>`;
  if (shape === "done")
    return s + `<circle class="body" cx="${w / 2}" cy="${h / 2}" r="${w / 2}" fill="${C("panel")}" stroke="${isSel ? C("sel") : C("ink")}" stroke-width="${isSel ? 2.6 : 1.6}"/><circle cx="${w / 2}" cy="${h / 2}" r="${w / 2 - 5}" fill="${C("ink")}"/></g>`;
  if (shape === "bar") return s + `<rect class="body" width="${w}" height="${h}" rx="2" fill="${C("ink")}" stroke="${isSel ? C("sel") : C("ink")}" stroke-width="${sw}"/>${side(n.name, -4)}</g>`;
  if (shape === "diamond") return s + `<path class="body" d="${flowPath("diamond", w, h)}" fill="${C("k-beh-bg")}" stroke="${stroke}" stroke-width="${sw}"/>${side(n.name, h / 2 + 4)}</g>`;
  const body = shape === "action" ? `<rect class="body" width="${w}" height="${h}" rx="10"` : `<path class="body" d="${flowPath(shape, w, h)}"`;
  s += `${body} fill="${C("k-beh-bg")}"${b.holds ? ' fill-opacity=".55"' : ""} stroke="${stroke}" stroke-width="${sw}"/>`;
  const detail = flowDetail(n);
  const plain = ["action", "perform action", "state"].includes(n.kind);
  const cut = (t: string): string => (t.length > 24 ? t.slice(0, 23) + "…" : t);
  const cx = shape === "accept" ? w / 2 + 6 : shape === "send" ? w / 2 - 6 : w / 2;
  if (plain && n.kind === "action") {
    s += `<text x="${cx}" y="27" text-anchor="middle" font-size="12.5" font-weight="700" fill="${C("ink")}" font-family="${F}">${esc(cut(n.name + (detail ? " " + detail : "")))}</text>`;
  } else {
    s += `<text x="${cx}" y="16" text-anchor="middle" font-size="10" fill="${C("ink2")}" font-family="${F}">${esc(`«${n.kind}»`)}</text>`;
    const main = plain ? n.name + (detail ? " " + detail : "") : n.name || detail;
    s += `<text x="${cx}" y="33" text-anchor="middle" font-size="12" font-weight="700" fill="${C("ink")}" font-family="${n.name || plain ? F : MONO}">${esc(cut(main))}</text>`;
    if (!plain && n.name && detail) s += `<text x="${cx}" y="48" text-anchor="middle" font-size="10.5" fill="${C("ink")}" font-family="${MONO}">${esc(cut(detail))}</text>`;
  }
  // 中にアクションの流れを描くアクションは、見出しの下を、中の要素を描く場所として区切る（区画の行は書かない）
  if (b.holds) return s + `<line x1="0" x2="${w}" y1="${FLOW_HEAD}" y2="${FLOW_HEAD}" stroke="${C("k-beh")}" stroke-opacity=".45"/></g>`;
  const L = linesOf(n);
  if (L.length) {
    const top = h - L.length * LH - 12;
    s += `<line x1="0" x2="${w}" y1="${top}" y2="${top}" stroke="${C("k-beh")}" stroke-opacity=".45"/>`;
    L.forEach((ln, k) => {
      s += `<text x="10" y="${top + 16 + k * LH}" font-size="10.5" fill="${C("ink")}" font-family="${MONO}">${esc(ln.t)}</text>`;
    });
  }
  return s + "</g>";
}

/**
 * 状態遷移の図の要素（8.2.3.18）を SVG の文字列にする。開始は塗った丸、終了は丸の中の塗った丸、状態は角の丸い四角に名前を太字で書き、
 * entry・do・exit の振る舞いを区画に書く。中に状態を描く状態は、名前と区画を上に書き、その下に中の状態を描く場所を区切る。
 *
 * @param C 色の関数
 * @param b 要素の矩形と、その要素（`holds` なら中に状態を描く）
 * @param opts 描き方（選択・光らせる要素・接続の候補・薄くする要素）
 * @param F 文字のフォント
 * @param MONO 区画のフォント
 * @returns `<g class="node state" data-key="キー" transform="translate(x,y)">…</g>` の文字列
 * @example
 * // (0, 0) にある開始
 * stateNodeMarkup(CV, b, { view: "stm" }, "inherit", "var(--mono)") // → '<g class="node state" data-key="s:#start" …><circle class="body" cx="11" cy="11" r="11" …/></g>'
 * // (100, 0) にある state on { entry action init; }
 * stateNodeMarkup(CV, b, { view: "stm" }, "inherit", "var(--mono)") // → '…<rect class="body" width="150" height="61" rx="14" …/>…on…entry / init…'
 */
function stateNodeMarkup(C: ColorFn, b: NodeBox, opts: MarkupOpts, F: string, MONO: string): string {
  const n = b.n, w = b.w, h = b.h;
  const isSel = opts.sel === n.key || !!opts.selSet?.has(n.key);
  const sw = isSel ? 2.6 : 1.3;
  let s = `<g class="node state${opts.pulse?.has(n.key) ? " pulse" : ""}" data-key="${esc(n.key)}" transform="translate(${b.x},${b.y})"${opts.dim?.has(n.key) ? ' opacity=".42"' : ""}>`;
  if (opts.cands?.has(n.key)) s += `<rect x="-5" y="-5" width="${w + 10}" height="${h + 10}" rx="16" fill="none" stroke="${C("sel")}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  if (isPseudoState(n) && n.kind === "start")
    return s + `<circle class="body" cx="${w / 2}" cy="${h / 2}" r="${w / 2}" fill="${C("ink")}" stroke="${isSel ? C("sel") : C("ink")}" stroke-width="${sw}"/></g>`;
  if (isPseudoState(n))
    return s + `<circle class="body" cx="${w / 2}" cy="${h / 2}" r="${w / 2}" fill="${C("panel")}" stroke="${isSel ? C("sel") : C("ink")}" stroke-width="${isSel ? 2.6 : 1.6}"/><circle cx="${w / 2}" cy="${h / 2}" r="${w / 2 - 5}" fill="${C("ink")}"/></g>`;
  s += `<rect class="body" width="${w}" height="${h}" rx="14" fill="${C("k-beh-bg")}"${b.holds ? ' fill-opacity=".55"' : ""} stroke="${isSel ? C("sel") : C("k-beh")}" stroke-width="${sw}"/>`;
  const title = stateTitle(n);
  const room = Math.floor((w - 20) / 7.5);
  s += `<text x="${w / 2}" y="23" text-anchor="middle" font-size="12.5" font-weight="700" fill="${C("ink")}" font-family="${F}">${esc(title.length > room ? title.slice(0, room - 1) + "…" : title)}</text>`;
  const L = linesOf(n);
  if (L.length) {
    s += `<line x1="0" x2="${w}" y1="${STATE_HEAD}" y2="${STATE_HEAD}" stroke="${C("k-beh")}" stroke-opacity=".45"/>`;
    L.forEach((ln, k) => {
      s += `<text x="12" y="${STATE_HEAD + 15 + k * LH}" font-size="10.5" fill="${C("ink")}" font-family="${MONO}">${esc(ln.t)}</text>`;
    });
  }
  // 中に状態を描く状態は、見出しと区画の下を、中の状態を描く場所として区切る
  if (b.holds) s += `<line x1="0" x2="${w}" y1="${stateSize(n).h}" y2="${stateSize(n).h}" stroke="${C("k-beh")}" stroke-opacity=".45"/>`;
  return s + "</g>";
}

/** メモの右上の、折った角の大きさ。 */
const NOTE_FOLD = 12;

/**
 * メモ（8.2.3.4 の comment）を SVG の文字列にする。右上の角を折った四角に本文を書き、名前があれば上に «comment» と名前を書く。
 *
 * @param C 色の関数
 * @param b メモの矩形と、その要素
 * @param opts 描き方（選択・光らせる要素・薄くする要素）
 * @param F 文字のフォント
 * @returns `<g class="node note" data-key="キー" transform="translate(x,y)">…</g>` の文字列
 * @example
 * // (300, 0) にある名前の無いメモ「安全のため」、選択なし
 * noteMarkup(CV, b, { view: "all" }, "inherit")
 * // → '<g class="node note" data-key="note:#1" transform="translate(300,0)"><path class="body" d="M0,0 H212 L224,12 V33 H0 Z" …/>…<text …>安全のため</text></g>'
 */
function noteMarkup(C: ColorFn, b: NodeBox, opts: MarkupOpts, F: string): string {
  const n = b.n, f = NOTE_FOLD, top = noteTop(n);
  const isSel = opts.sel === n.key || !!opts.selSet?.has(n.key);
  const stroke = isSel ? C("sel") : C("k-other");
  let s = `<g class="node note${opts.pulse?.has(n.key) ? " pulse" : ""}" data-key="${esc(n.key)}" transform="translate(${b.x},${b.y})"${opts.dim?.has(n.key) ? ' opacity=".42"' : ""}>`;
  s += `<path class="body" d="M0,0 H${b.w - f} L${b.w},${f} V${b.h} H0 Z" fill="${C("panel")}" stroke="${stroke}" stroke-width="${isSel ? 2.6 : 1.1}"/>`;
  s += `<path d="M${b.w - f},0 V${f} H${b.w}" fill="none" stroke="${stroke}" stroke-width="1.1"/>`;
  // 別の言語での表し方（8.2.3.4 の textual-representation-node）は «rep» と名前・言語を見出しに書く
  if (n.kind === "rep") s += `<text x="12" y="18" font-size="10" fill="${C("ink2")}" font-family="${F}">«rep»${n.name ? ` <tspan font-weight="700" fill="${C("ink")}">${esc(n.name)}</tspan>` : ""} language "${esc(n.entry.type)}"</text>`;
  else if (n.name) s += `<text x="12" y="18" font-size="10" fill="${C("ink2")}" font-family="${F}">«comment» <tspan font-weight="700" fill="${C("ink")}">${esc(n.name)}</tspan></text>`;
  linesOf(n).forEach((ln, k) => {
    s += `<text x="12" y="${top + 11 + k * LH}" font-size="11" fill="${C("ink")}" font-family="${F}">${esc(ln.t)}</text>`;
  });
  return s + "</g>";
}

/**
 * 内部ブロック図の対象そのもののポート（8.2.3.13 の枠の上のポート）を SVG の文字列にする。枠の辺の上の小さな四角と、枠の外側に名前を書く。
 *
 * @param C 色の関数
 * @param b ポートの矩形（BOUNDARY 四方）と、その要素（`boundary` は向き）
 * @param opts 描き方（選択）
 * @param F 文字のフォント
 * @returns `<g class="boundary" data-key="b:名前" transform="translate(x,y)">…</g>` の文字列
 * @example
 * // 左の辺の (−7, 93) にある入力のポート pwr
 * boundaryMarkup(CV, b, { view: "ibd" }, "inherit") // → '<g class="boundary" data-key="b:pwr" …><rect …/><text …>pwr</text></g>'
 */
function boundaryMarkup(C: ColorFn, b: NodeBox, opts: MarkupOpts, F: string): string {
  const n = b.n, s = BOUNDARY;
  const isSel = opts.sel === n.key;
  const left = n.boundary === "in", right = n.boundary === "out";
  const tx = left ? -6 : right ? s + 6 : s / 2, ty = left || right ? s / 2 + 4 : s + 14;
  const anchor = left ? "end" : right ? "start" : "middle";
  return (
    `<g class="boundary" data-key="${esc(n.key)}" transform="translate(${b.x},${b.y})">` +
    `<rect class="body" width="${s}" height="${s}" fill="${C("panel")}" stroke="${isSel ? C("sel") : C("k-part")}" stroke-width="${isSel ? 2.4 : 1.4}"/>` +
    `<text x="${tx}" y="${ty}" text-anchor="${anchor}" font-size="10.5" fill="${C("ink")}" font-family="${F}">${esc(n.name)}</text></g>`
  );
}

/**
 * アクティビティ図の区画（8.2.3.17 の swimlane）を SVG の文字列にする。破線の四角に、見出し «performer» と受け持つ部品の道のりを書き、見出しの下を区切る。
 *
 * @param C 色の関数
 * @param name 受け持つ部品の道のり
 * @param r 区画の矩形
 * @param F 文字のフォント
 * @returns `<g class="lane" data-lane="部品の道のり">…</g>` の文字列
 * @example
 * laneMarkup(CV, "kettle.heater", { x: 84, y: 156, w: 200, h: 204 }, "inherit")
 * // → '<g class="lane" data-lane="kettle.heater"><rect … stroke-dasharray="5 4"/><text …>«performer»</text><text …>kettle.heater</text><line …/></g>'
 */
function laneMarkup(C: ColorFn, name: string, r: Box, F: string): string {
  return (
    `<g class="lane" data-lane="${esc(name)}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="${C("k-beh")}" stroke-width="1.2" stroke-dasharray="5 4"/>` +
    `<text x="${r.x + r.w / 2}" y="${r.y + 16}" text-anchor="middle" font-size="10" fill="${C("ink2")}" font-family="${F}">«performer»</text>` +
    `<text x="${r.x + r.w / 2}" y="${r.y + 32}" text-anchor="middle" font-size="12" font-weight="700" fill="${C("ink")}" font-family="${F}">${esc(name)}</text>` +
    `<line x1="${r.x}" x2="${r.x + r.w}" y1="${r.y + LANE_HEAD - 4}" y2="${r.y + LANE_HEAD - 4}" stroke="${C("k-beh")}" stroke-opacity=".45" stroke-dasharray="5 4"/></g>`
  );
}

/**
 * n 項の接続の点（8.2.3.13 の n-ary-connection-dot）を SVG の文字列にする。塗った丸で描き、名前があれば上に書く（cdot-label）。
 *
 * @param C 色の関数
 * @param b 点の矩形（DOT 四方）と、その要素
 * @param opts 描き方（選択・光らせる要素）
 * @param F 文字のフォント
 * @returns `<g class="node junction" data-key="キー" transform="translate(x,y)">…</g>` の文字列
 * @example
 * // (100, 40) にある名前 k の点、選択なし
 * junctionMarkup(CV, b, { view: "ibd" }, "inherit")
 * // → '<g class="node junction" data-key="j:k" transform="translate(100,40)"><circle class="body" cx="6" cy="6" r="6" …/><text …>k</text></g>'
 */
function junctionMarkup(C: ColorFn, b: NodeBox, opts: MarkupOpts, F: string): string {
  const n = b.n, r = DOT / 2;
  const isSel = opts.sel === n.key || !!opts.selSet?.has(n.key);
  return (
    `<g class="node junction${opts.pulse?.has(n.key) ? " pulse" : ""}" data-key="${esc(n.key)}" transform="translate(${b.x},${b.y})">` +
    `<circle class="body" cx="${r}" cy="${r}" r="${r}" fill="${C("k-con")}" stroke="${isSel ? C("sel") : C("k-con")}" stroke-width="${isSel ? 2.6 : 1}"/>` +
    (n.name ? `<text x="${r}" y="-6" text-anchor="middle" font-size="10.5" fill="${C("ink2")}" font-family="${F}">${esc(n.name)}</text>` : "") +
    `</g>`
  );
}

/**
 * 要素の接続点を SVG の文字列にする。ポート由来の接続点は記号と名前、自由な接続点は小さな丸で描く。
 * 操作できる図では、つかみやすいよう透明な当たり判定を重ねる。
 *
 * @param C 色の関数
 * @param b 要素の矩形と、その接続点
 * @param opts 描き方（選択中の接続点・操作できるか）
 * @param MONO ポートの名前のフォント
 * @returns `<g class="pin" data-node="キー" data-pin="ID">…</g>` を接続点の数だけつないだ文字列。接続点が無ければ空文字列
 * @example
 * // A の上の縁の中央に自由な接続点 a1 があるとき（操作できない図）
 * pinsMarkup(CV, b, { view: "trace" }, "var(--mono)") // → '<g class="pin" data-node="A" data-pin="a1"><circle … r="3.6" …/></g>'
 * // 接続点が無いとき
 * pinsMarkup(CV, b, { view: "trace" }, "var(--mono)") // → ""
 */
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

/**
 * シーケンス図の段の、上下の位置（メッセージの線とイベントの丸の中心）。
 *
 * @param row 段（上から何段目か。0 から）
 * @returns 図の座標の y
 * @example
 * seqRowY(0) // → 86
 * seqRowY(2) // → 194
 */
export const seqRowY = (row: number): number => SEQ.h + SEQ.first + row * SEQ.gap;

/**
 * シーケンス図の外枠の位置と大きさを、ライフラインと段の数から求める（SEQ の寸法を使う）。段の数が無ければ、線の数を段の数にする。
 *
 * @param c シーケンス図の中身（nodes がライフライン、rows が段の数）
 * @returns 外枠の左上（x0, y0）・幅（w）・高さ（h）と、ライフラインの下端（H）。数が 0 でも 1 つ分の大きさにする
 * @example
 * seqGeom({ nodes: [a, b], edges: [m], rows: 1, … }) // → { x0: -24, y0: -60, w: 418, h: 244, H: 160 }
 * seqGeom({ nodes: [a, b], edges: [m], rows: 3, … }) // → { x0: -24, y0: -60, w: 418, h: 352, H: 268 }（メッセージの端でないイベント 2 つ）
 * seqGeom({ nodes: [], edges: [], … })               // → { x0: -24, y0: -60, w: 218, h: 244, H: 160 }（境界値）
 */
export function seqGeom(c: ViewContent): { x0: number; y0: number; w: number; h: number; H: number } {
  const n = c.nodes.length, m = c.rows ?? c.edges.length;
  const H = SEQ.h + SEQ.first + Math.max(1, m) * SEQ.gap + 20;
  return { x0: -24, y0: -60, w: Math.max(1, n) * SEQ.dx - (SEQ.dx - SEQ.w) + 48, h: H + 84, H };
}

/** イベントの丸の半径（8.2.3.9 の sq-proxy）。 */
const EVENT_R = 5;

/**
 * シーケンス図の SVG マークアップを作る。外枠と `sd 名前` の札、ライフライン（頭の箱と点線）、ライフラインの上のイベント
 * （白抜きの丸と `.ev` の札、8.2.3.9 の sq-proxy）、段の位置に番号付きのメッセージ（実線と塗った矢印、端にイベントがあれば丸の縁まで）、
 * 別のライフラインのイベントの間の順序（破線と開いた矢印、8.2.3.9 の sq-succession。ラベルは名前）を描く。
 * 自分自身へのメッセージは折り返しの線にする。両端のライフライン・イベントが見つからない線は描かない。
 *
 * @param C 色の関数（画面は CV）
 * @param c シーケンス図の中身（対象・ライフライン・線・イベント・段の数）
 * @param opts 描き方（フォント・操作できるか・選択）。省くと既定の描き方
 * @returns マークアップ（s）と、外枠の寸法（g。seqGeom の結果）
 * @example
 * // 対象 K に、ライフライン a・b と、a から b へのメッセージ ping（段 0）があるとき
 * seqMarkup(CV, c) // → { s: '<rect …/>…sd K…<g class="lifeline" data-key="a">…</g>…1. ping…', g: { x0: -24, y0: -60, w: 418, h: 244, H: 160 } }
 * // ping の送り手の端がイベント a.e のとき
 * seqMarkup(CV, c).s // → 上に加え、'<g class="event" data-key="e:a.e" …><circle cx="85" cy="86" r="5" …/><text …>.e</text></g>'
 * // ライフラインもメッセージも無いとき
 * seqMarkup(CV, c) // → { s: 外枠と札だけ, g: { x0: -24, y0: -60, w: 218, h: 244, H: 160 } }
 */
export function seqMarkup(C: ColorFn, c: ViewContent, opts: Omit<MarkupOpts, "view"> = {}): { s: string; g: ReturnType<typeof seqGeom> } {
  const F = opts.font || "inherit", MONO = opts.mono || "var(--mono)";
  const g = seqGeom(c);
  const X = (i: number): number => i * SEQ.dx + SEQ.w / 2;
  const idx = new Map(c.nodes.map((l, i) => [l.key, i]));
  const events = c.events ?? [];
  const at = new Map(events.flatMap((e) => (idx.has(e.lifeline) ? [[e.key, { i: idx.get(e.lifeline) ?? 0, row: e.row }] as const] : [])));
  const hasEvent = (lifeline: number, row: number): boolean => [...at.values()].some((p) => p.i === lifeline && p.row === row);
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
    if (e.kind !== "message") return;
    const a = idx.get(e.from), b = idx.get(e.to);
    if (a == null || b == null) return;
    const row = e.row ?? k;
    const y = seqRowY(row);
    const sel = opts.selEdge === e.id;
    const col = sel ? C("sel") : C("ink");
    const lab = `${(e.idx ?? k) + 1}. ${e.label || "（名前なし）"}${e.type ? " : " + e.type : ""}`;
    let d: string, lx: number;
    if (a === b) {
      d = `M${X(a)},${y} h46 v20 h-44`;
      lx = X(a) + 52;
    } else {
      // 端にイベントがあれば、丸の縁から縁まで引く
      const dir = b > a ? 1 : -1;
      const x1 = X(a) + (hasEvent(a, row) ? dir * EVENT_R : 0);
      const x2 = X(b) - dir * (hasEvent(b, row) ? EVENT_R + 1 : 2);
      d = `M${x1},${y} L${x2},${y}`;
      lx = (X(a) + X(b)) / 2;
    }
    s +=
      `<g class="edge${sel ? " sel" : ""}" data-edge="${esc(e.id)}"><path class="line" d="${d}" fill="none" stroke="${col}" stroke-width="${sel ? 2.4 : 1.4}" marker-end="url(#mMsg)"/>` +
      (opts.interactive ? `<path class="hit" d="${d}"/>` : "") +
      `<text x="${lx}" y="${y - 7}" text-anchor="${a === b ? "start" : "middle"}" font-size="11" fill="${col}" stroke="${C("paper")}" stroke-width="4" paint-order="stroke" font-family="${MONO}">${esc(lab)}</text></g>`;
  });
  for (const e of c.edges) {
    if (e.kind !== "succession") continue;
    const p = at.get(e.from), q = at.get(e.to);
    if (!p || !q) continue;
    const sel = opts.selEdge === e.id;
    const col = sel ? C("sel") : C("ink2");
    const [x1, y1, x2, y2] = [X(p.i), seqRowY(p.row), X(q.i), seqRowY(q.row)];
    // 丸の縁から縁まで。同じ段の 2 つのイベントの間は、メッセージと重ならないよう下にふくらませる
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const [sx, sy, ex, ey] = [x1 + ux * EVENT_R, y1 + uy * EVENT_R, x2 - ux * (EVENT_R + 1), y2 - uy * (EVENT_R + 1)];
    const d = p.row === q.row ? `M${sx},${sy + 3} Q${(sx + ex) / 2},${sy + 26} ${ex},${ey + 3}` : `M${sx},${sy} L${ex},${ey}`;
    // 名前は、メッセージの名前（線の中ほど）と重ならないよう、元の端の近く（3 割の位置）に書く
    const [mx, my] = p.row === q.row ? [(sx + ex) / 2, sy + 30] : [sx + (ex - sx) * 0.3, sy + (ey - sy) * 0.3 - 6];
    s +=
      `<g class="edge${sel ? " sel" : ""}" data-edge="${esc(e.id)}"><path class="line" d="${d}" fill="none" stroke="${col}" stroke-width="${sel ? 2.4 : 1.3}" stroke-dasharray="6 4" marker-end="url(#mOpen)"/>` +
      (opts.interactive ? `<path class="hit" d="${d}"/>` : "") +
      (e.label ? `<text x="${mx}" y="${my}" text-anchor="middle" font-size="11" fill="${col}" stroke="${C("paper")}" stroke-width="4" paint-order="stroke" font-family="${MONO}">${esc(e.label)}</text>` : "") +
      `</g>`;
  }
  // イベント（8.2.3.9 の sq-proxy）は線の上に描く。ライフラインからメッセージを引く操作を妨げないよう、ポインタは通す
  for (const ev of events) {
    const p = at.get(ev.key);
    if (!p) continue;
    const [x, y] = [X(p.i), seqRowY(p.row)];
    s +=
      `<g class="event" data-key="${esc(ev.key)}" pointer-events="none"><circle cx="${x}" cy="${y}" r="${EVENT_R}" fill="${C("paper")}" stroke="${C("ink")}" stroke-width="1.3"/>` +
      `<text x="${x + EVENT_R + 4}" y="${y + 15}" font-size="10" fill="${C("ink2")}" stroke="${C("paper")}" stroke-width="3" paint-order="stroke" font-family="${MONO}">${esc(ev.label)}</text></g>`;
  }
  return { s, g };
}

/** 矢印などのマーカー定義。 */
export const DEFS =
  `<marker id="mDiamond" viewBox="0 0 20 10" refX="1" refY="5" markerWidth="18" markerHeight="9" orient="auto-start-reverse"><path d="M1,5 L10,1 L19,5 L10,9 Z" style="fill:var(--ink2)"/></marker>` +
  `<marker id="mOpen" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto"><path d="M1,1 L11,6 L1,11" fill="none" style="stroke:var(--ink2)" stroke-width="1.4"/></marker>` +
  `<marker id="mMsg" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="10" markerHeight="10" orient="auto"><path d="M1,1 L11,6 L1,11 Z" style="fill:var(--ink)"/></marker>` +
  `<marker id="mBlock" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="10" markerHeight="10" orient="auto"><path d="M1,1 L11,6 L1,11 Z" style="fill:var(--k-con)"/></marker>` +
  `<marker id="mTri" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="13" markerHeight="13" orient="auto"><path d="M1,1 L13,7 L1,13 Z" style="fill:var(--paper);stroke:var(--ink2)" stroke-width="1.2"/></marker>` +
  `<marker id="mRedef" viewBox="0 0 18 14" refX="17" refY="7" markerWidth="17" markerHeight="13" orient="auto"><path d="M1.5,1 L1.5,13" style="stroke:var(--ink2)" stroke-width="1.2"/><path d="M5,1 L17,7 L5,13 Z" style="fill:var(--paper);stroke:var(--ink2)" stroke-width="1.2"/></marker>` +
  `<marker id="mRef" viewBox="0 0 18 14" refX="17" refY="7" markerWidth="17" markerHeight="13" orient="auto"><circle cx="2" cy="4" r="1.4" style="fill:var(--ink2)"/><circle cx="2" cy="10" r="1.4" style="fill:var(--ink2)"/><path d="M5,1 L17,7 L5,13 Z" style="fill:var(--paper);stroke:var(--ink2)" stroke-width="1.2"/></marker>`;

/* ---- アイコン ---- */
const ICON_L: Record<string, string> = {
  requirement: "R", concern: "Cn", verification: "V", analysis: "An", part: "P", attribute: "At", port: "Po", item: "It", constraint: "Cs",
  state: "S", action: "Ac", occurrence: "Oc", interface: "If", enum: "E", calc: "Ca", connection: "Cx", "use case": "U",
  "perform action": "Ac", "exhibit state": "S", param: "·", message: "M", metadata: "Md",
  case: "Ce", actor: "Ar", "include use case": "U", "event occurrence": "Oc", timeslice: "Oc", snapshot: "Oc",
  viewpoint: "Vp", rendering: "Rd", variant: "Va", def: "#", usage: "#",
  fork: "Fk", join: "Jn", decide: "Dc", merge: "Mg", send: "Sd", accept: "Rc", assign: "As", terminate: "Tm",
  if: "If", while: "Wh", loop: "Lp", for: "Fr", "succession flow": "SF",
};
/** アクションの流れの要素の種類（振る舞いの色で描く。8.2.2.17）。 */
const FLOW_KINDS = ["fork", "join", "decide", "merge", "send", "accept", "assign", "terminate", "if", "while", "loop", "for", "succession flow"];

/**
 * 種類から色分けの系統を決める。図の要素の系統（ModelNode の fam）は Rust のコアが同じ規則で決める。
 *
 * @param kind 要素の種類（`part def`・`requirement` など、定義も使用も）
 * @returns 色分けの系統。どれにも当たらなければ "other"
 * @example
 * family("requirement def") // → "req"
 * family("state def")       // → "beh"
 * family("port def")        // → "other"
 */
function family(kind: string): Family {
  if (/^requirement/.test(kind)) return "req";
  if (/^concern/.test(kind)) return "concern";
  if (/^(verification|analysis)/.test(kind)) return "ver";
  if (/^(constraint|calc)/.test(kind)) return "con";
  if (/^(state|action|use case)/.test(kind)) return "beh";
  if (/^part/.test(kind)) return "part";
  return "other";
}

/**
 * 種類を表す小さなアイコン（ツリー・パレット・タブ）を SVG の文字列にする。package はフォルダ、ほかは種類の色の四角に略号（`P`・`R` など）を書く。
 * 定義は角の四角、使用は角の丸い四角にする。
 *
 * @param kind 要素の種類（SysML v2 のキーワード。`part def`・`requirement` など。`message` も受け付ける）
 * @returns `<svg class="ki" …>…</svg>` の文字列。略号の表に無い種類は、頭文字を大文字にして書く
 * @example
 * kindIcon("part def") // → '<svg class="ki" …><rect … rx="0" fill="var(--k-part-bg)" stroke="var(--k-part)"/><text …>P</text></svg>'
 * kindIcon("package")  // → フォルダの形の '<svg class="ki" …><path …/></svg>'
 * kindIcon("flow")     // → '…fill="var(--k-other-bg)"…>F</text></svg>'（表に無い種類は頭文字）
 * kindIcon("fork")     // → '…fill="var(--k-beh-bg)"…>Fk</text></svg>'（アクションの流れの要素は振る舞いの色）
 */
export function kindIcon(kind: string): string {
  if (kind === "package")
    return `<svg class="ki" width="18" height="16" viewBox="0 0 18 16" aria-hidden="true"><path d="M1.5 3.5h5l1.6 1.6h8.4v8.9H1.5Z" fill="var(--k-req-bg)" stroke="var(--k-req)"/></svg>`;
  const fam = kind === "message" || FLOW_KINDS.includes(kind) ? "beh" : family(kind);
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
  trace: "requirement def", structure: "part def", control: "constraint def", ibd: "part", behavior: "state def", seq: "occurrence def", afv: "action def", stm: "state def", all: "package",
};
/**
 * 自動の図（ビュー）を表すアイコンを、そのビューの代表の種類のアイコン（kindIcon）で返す。
 *
 * @param view 自動の図の id（`trace`・`structure`・`control`・`ibd`・`behavior`・`seq`・`afv`・`stm`・`all`）
 * @returns `<svg class="ki" …>…</svg>` の文字列。知らない id なら空文字列
 * @example
 * viewIcon("trace")   // → kindIcon("requirement def") と同じ文字列
 * viewIcon("unknown") // → ""
 */
export const viewIcon = (view: string): string => {
  const k = VIEW_ICON_KIND[view];
  return k ? kindIcon(k) : "";
};

