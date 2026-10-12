// 図・テキスト・ミニマップの描画。状態（S）を読んで DOM を書き換えるだけで、状態は変えない
// （ビューの対象ブロックの補正と、描画済みの強調の消去を除く）。

import { lineStart, type ModelNode } from "../core";
import { $, esc } from "./dom";
import { nodeH, pinPoint, pinsOf, W, type Box } from "./geometry";
import { relOptions } from "./relations";
import { S, type EndSpec } from "./state";
import { CV, SEQ, seqGeom, seqMarkup, svgMarkup } from "./svg";
import { CC, curLayout, curView, edgeById, nodeByKey, viewContent, visibleNodes } from "./views";

/** 図を描き直す。 */
export function render(): void {
  const content = viewContent(S.M, curView());
  const empty = $("#empty");
  empty.hidden = !content.empty;
  empty.textContent = content.empty ?? "";
  if (content.seq) {
    const sm = seqMarkup(CV, content, { interactive: true, sel: S.sel, selSet: S.selSet, selEdge: S.selEdge });
    $("#gEdges").innerHTML = "";
    $("#gNodes").innerHTML = sm.s;
  } else {
    const from = nodeByKey(S.connectFrom);
    const cands = S.mode === "connect" ? new Set(content.nodes.filter((n) => n.key !== S.connectFrom && relOptions(from, n).length).map((n) => n.key)) : null;
    const { es, ns } = svgMarkup(CV, content, curLayout(), {
      interactive: true, view: S.view, sel: S.sel, selSet: S.selSet, selEdge: S.selEdge, selPin: S.selPin, pulse: S.pulse, cands,
      edgeStyle: S.edgeStyle, dim: content.dim, phases: !!S.M.phases,
    });
    $("#gEdges").innerHTML = es;
    $("#gNodes").innerHTML = ns;
  }
  renderMinimap();
  S.pulse = new Set();
  applyTf();
}

/** 要素の矩形（現在のビューの配置）。 */
export function boxOf(n: ModelNode): Box {
  const p = curLayout().pos[n.key] ?? [0, 0];
  return { x: p[0], y: p[1], w: W, h: nodeH(n) };
}

function handleMarkup(h: EndSpec, R: number): string {
  const n = nodeByKey(h.node);
  if (!n) return "";
  const q = pinPoint(boxOf(n), h.side, h.t);
  return (
    `<g class="handle" data-node="${esc(h.node)}" data-side="${h.side}" data-t="${h.t}" data-pin="${esc(h.pin ?? "")}">` +
    `<circle cx="${q.x}" cy="${q.y}" r="${R * 1.3}" fill="transparent"/>` +
    `<circle cx="${q.x}" cy="${q.y}" r="${R}" fill="var(--panel)" stroke="var(--sel)" stroke-width="1.6" vector-effect="non-scaling-stroke"/>` +
    `<path d="M${q.x - R * 0.5},${q.y} L${q.x + R * 0.5},${q.y} M${q.x},${q.y - R * 0.5} L${q.x},${q.y + R * 0.5}" stroke="var(--sel)" stroke-width="1.8" vector-effect="non-scaling-stroke"/></g>`
  );
}

/** 線を引くための＋ハンドルと、描きかけの線を重ねて描く。 */
export function renderOverlay(): void {
  const g = $("#gOver");
  const R = 8 / S.tf.s;
  let s = "";
  const w = S.wireDrag;
  if (S.view === "seq") {
    if (w && w.seq) {
      const c = CC();
      const i = c.nodes.findIndex((l) => l.key === w.from);
      const X = (k: number): number => k * SEQ.dx + SEQ.w / 2;
      const j = w.target ? c.nodes.findIndex((l) => l.key === w.target) : -1;
      const tx = j >= 0 ? X(j) : w.x;
      s += `<path d="M${X(i)},${w.y} L${tx},${w.y}" stroke="var(--sel)" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>`;
      if (j >= 0)
        s += `<rect x="${j * SEQ.dx - 4}" y="-4" width="${SEQ.w + 8}" height="${SEQ.h + 8}" rx="10" fill="none" stroke="var(--sel)" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`;
    }
    g.innerHTML = s;
    return;
  }
  const vis = new Set(visibleNodes().map((n) => n.key));
  const hs: EndSpec[] = [];
  const seln = S.sel && vis.has(S.sel) ? nodeByKey(S.sel) : null;
  if (seln && S.mode !== "connect" && !w) {
    const pins = pinsOf(seln, curLayout(), S.view);
    for (const side of ["t", "r", "b", "l"] as const) {
      if (!pins.some((p) => p.side === side && Math.abs(p.t - 0.5) < 0.12)) hs.push({ node: seln.key, side, t: 0.5, pin: null });
    }
  }
  if (S.hover && vis.has(S.hover.node) && !w) hs.push(S.hover);
  for (const h of hs) s += handleMarkup(h, R);
  if (w && !w.seq) {
    const a = nodeByKey(w.from.node);
    if (a) {
      const q = pinPoint(boxOf(a), w.from.side, w.from.t);
      let tx = w.x, ty = w.y;
      const tn = w.target ? nodeByKey(w.target.node) : null;
      if (w.target && tn) {
        const tb = boxOf(tn);
        const tq = pinPoint(tb, w.target.side, w.target.t);
        tx = tq.x;
        ty = tq.y;
        s += `<rect x="${tb.x - 5}" y="${tb.y - 5}" width="${tb.w + 10}" height="${tb.h + 10}" fill="none" stroke="var(--sel)" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`;
        s += `<circle cx="${tx}" cy="${ty}" r="${R * 0.7}" fill="var(--sel)"/>`;
      }
      s += `<circle cx="${q.x}" cy="${q.y}" r="${R * 0.7}" fill="var(--sel)"/>`;
      s += `<path d="M${q.x},${q.y} L${tx},${ty}" stroke="var(--sel)" stroke-width="2" stroke-dasharray="6 4" fill="none" vector-effect="non-scaling-stroke"/>`;
    }
  }
  g.innerHTML = s;
}

/** 表示の移動・拡大を反映する。 */
export function applyTf(): void {
  updateMiniVp();
  const { x, y, s } = S.tf;
  $("#vp").setAttribute("transform", `translate(${x},${y}) scale(${s})`);
  const w = $("#wrap");
  w.style.backgroundSize = `${20 * s}px ${20 * s}px`;
  w.style.backgroundPosition = `${x}px ${y}px`;
  renderOverlay();
}

/* ---- テキスト（ハイライト・選択の強調） ---- */
const KW_HL =
  /\b(package|part|def|requirement|constraint|port|item|attribute|concern|verification|analysis|state|action|interface|calc|connection|subject|stakeholder|satisfy|verify|frame|flow|of|from|to|by|connect|perform|exhibit|transition|first|accept|then|entry|objective|require|return|in|out|inout|end|private|public|import|doc|and|or|not|use|case)\b/;

/** テキストの一部を構文の色付きの HTML にする。 */
export function hlSeg(s: string): string {
  const re = /(\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*)|('[^'\n]*')|(\b\d+(?:\.\d+)?\b)|\b([A-Za-z_]\w*)\b/g;
  let out = "", last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    out += esc(s.slice(last, m.index));
    if (m[1]) out += `<span class="tk-cm">${esc(m[1])}</span>`;
    else if (m[2]) out += `<span class="tk-str">${esc(m[2])}</span>`;
    else if (m[3]) out += `<span class="tk-num">${m[3]}</span>`;
    else {
      const w = m[4] ?? "";
      out += KW_HL.exec(w)?.[0] === w ? `<span class="tk-kw">${w}</span>` : esc(w);
    }
    last = re.lastIndex;
  }
  return out + esc(s.slice(last));
}

/** テキストの色付けと、選択中の要素・直前の変更の強調を描く。 */
export function highlight(): void {
  const t = S.text;
  const marks: { a: number; b: number; cls: "selr" | "flash" }[] = [];
  const n = nodeByKey(S.sel);
  if (n) marks.push({ a: n.entry.start, b: n.entry.end, cls: "selr" });
  const ed = edgeById(S.selEdge);
  if (ed) marks.push({ a: ed.src.start, b: ed.src.end, cls: "selr" });
  if (S.textMark && !(n && n.entry.start === S.textMark[0])) marks.push({ a: S.textMark[0], b: S.textMark[1], cls: "selr" });
  if (S.flash) {
    const [a, b] = S.flash;
    const le = t.indexOf("\n", b);
    marks.push({ a: lineStart(t, a), b: Math.max(b, le < 0 ? t.length : le), cls: "flash" });
  }
  const pts = new Set([0, t.length]);
  for (const m of marks) {
    pts.add(Math.max(0, Math.min(t.length, m.a)));
    pts.add(Math.max(0, Math.min(t.length, m.b)));
  }
  const sorted = [...pts].sort((a, b) => a - b);
  let html = "";
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i] as number, b = sorted[i + 1] as number;
    const seg = hlSeg(t.slice(a, b));
    const act = marks.filter((m) => m.a <= a && m.b >= b);
    const cls = act.some((m) => m.cls === "flash") ? "flash" : act.length ? "selr" : "";
    html += cls ? `<mark class="${cls}">${seg}</mark>` : seg;
  }
  $("#hl").innerHTML = html + "\n\n";
  syncScroll();
}

export function syncScroll(): void {
  const ed = $<HTMLTextAreaElement>("#ed"), hl = $("#hl");
  hl.scrollTop = ed.scrollTop;
  hl.scrollLeft = ed.scrollLeft;
}

/** テキストの位置が見えるようにスクロールする。 */
export function scrollEditorTo(pos: number): void {
  const ed = $<HTMLTextAreaElement>("#ed");
  const line = S.text.slice(0, pos).split("\n").length - 1;
  ed.scrollTop = Math.max(0, line * 19 - 60);
  syncScroll();
}

/** 要素を図の中央に表示する（onlyIfHidden なら見えているときは動かさない）。 */
export function centerOn(key: string, onlyIfHidden = false): void {
  const p = curLayout().pos[key];
  const n = nodeByKey(key);
  if (!p || !n) return;
  const r = $("#wrap").getBoundingClientRect();
  const cx = p[0] + W / 2, cy = p[1] + nodeH(n) / 2;
  const sx = cx * S.tf.s + S.tf.x, sy = cy * S.tf.s + S.tf.y;
  if (onlyIfHidden && sx > 40 && sx < r.width - 40 && sy > 40 && sy < r.height - 40) return;
  S.tf.x = r.width / 2 - cx * S.tf.s;
  S.tf.y = r.height / 2 - cy * S.tf.s;
  applyTf();
}

/* ---- ミニマップ ---- */
interface MiniGeom {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  boxes: { x: number; y: number; w: number; h: number; fam: string; key: string }[];
  edges: [number, number, number, number][];
}

function miniGeom(): MiniGeom | null {
  const c = CC();
  const L = curLayout().pos;
  if (c.seq) {
    const g = seqGeom(c);
    return { x0: g.x0, y0: g.y0, x1: g.x0 + g.w, y1: g.y0 + g.h, boxes: c.nodes.map((n, i) => ({ x: i * SEQ.dx, y: 0, w: SEQ.w, h: g.h - 20, fam: "part", key: n.key })), edges: [] };
  }
  const bs = c.nodes.flatMap((n) => {
    const p = L[n.key];
    return p ? [{ x: p[0], y: p[1], w: W, h: nodeH(n), fam: n.fam as string, key: n.key }] : [];
  });
  if (!bs.length) return null;
  const at = new Map(bs.map((b) => [b.key, [b.x + b.w / 2, b.y + b.h / 2] as const]));
  const edges = c.edges.flatMap((e): [number, number, number, number][] => {
    const a = at.get(e.from), b = at.get(e.to);
    return a && b ? [[a[0], a[1], b[0], b[1]]] : [];
  });
  return {
    x0: Math.min(...bs.map((b) => b.x)) - 40, y0: Math.min(...bs.map((b) => b.y)) - 40,
    x1: Math.max(...bs.map((b) => b.x + b.w)) + 40, y1: Math.max(...bs.map((b) => b.y + b.h)) + 40, boxes: bs, edges,
  };
}

export function renderMinimap(): void {
  const el = $("#mini");
  el.hidden = !S.ui.mini;
  $("#zMini").setAttribute("aria-pressed", String(S.ui.mini));
  if (el.hidden) {
    S.mini = null;
    return;
  }
  const g = miniGeom();
  if (!g) {
    $("#miniSvg").innerHTML = "";
    S.mini = null;
    $("#miniVp").hidden = true;
    return;
  }
  const r = $("#mini .mbody").getBoundingClientRect();
  const pad = 5;
  const s = Math.min((r.width - pad * 2) / (g.x1 - g.x0), (r.height - pad * 2) / (g.y1 - g.y0));
  S.mini = { g, s, pad };
  const lines = g.edges
    .map((e) => `<line x1="${pad + (e[0] - g.x0) * s}" y1="${pad + (e[1] - g.y0) * s}" x2="${pad + (e[2] - g.x0) * s}" y2="${pad + (e[3] - g.y0) * s}" stroke="var(--ink2)" stroke-opacity=".45" stroke-width=".6"/>`)
    .join("");
  $("#miniSvg").innerHTML =
    lines +
    g.boxes
      .map((b) => {
        const sel = S.selSet.has(b.key);
        return `<rect x="${pad + (b.x - g.x0) * s}" y="${pad + (b.y - g.y0) * s}" width="${Math.max(2, b.w * s)}" height="${Math.max(2, b.h * s)}" rx="1" fill="var(--k-${b.fam}-bg)" stroke="${sel ? "var(--sel)" : `var(--k-${b.fam})`}" stroke-width="${sel ? 1.4 : 0.6}"/>`;
      })
      .join("");
  updateMiniVp();
}

/** ミニマップ上の表示範囲の枠を更新する。 */
export function updateMiniVp(): void {
  const m = S.mini, vp = $("#miniVp");
  if (!m || !S.ui.mini) {
    vp.hidden = true;
    return;
  }
  const r = $("#wrap").getBoundingClientRect();
  const x0 = -S.tf.x / S.tf.s, y0 = -S.tf.y / S.tf.s, x1 = (r.width - S.tf.x) / S.tf.s, y1 = (r.height - S.tf.y) / S.tf.s;
  vp.hidden = false;
  vp.style.left = m.pad + (x0 - m.g.x0) * m.s + "px";
  vp.style.top = m.pad + (y0 - m.g.y0) * m.s + "px";
  vp.style.width = Math.max(8, (x1 - x0) * m.s) + "px";
  vp.style.height = Math.max(8, (y1 - y0) * m.s) + "px";
}
