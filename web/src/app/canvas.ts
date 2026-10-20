// 図の上のポインタ操作（選択・移動・線を引く・範囲選択・パン・ピンチ）と表示範囲の調整。

import { $, closest } from "./dom";
import { boxesOf, nearestBorder, pinPoint, W } from "./geometry";
import { renderInspector } from "./inspector";
import { MSGOPS, OPS, selNodes, setSelection, toggleSel } from "./ops";
import { openCtx, ctxItemsAt } from "./ctxmenu";
import { placeTool } from "./panels";
import { pinsFor } from "./pins";
import { applyTf, boxOf, highlight, render, renderOverlay, scrollEditorTo } from "./render";
import { cancelConnect, clearSel, S, type EndSpec } from "./state";
import { packageBoxes, SEQ, seqGeom } from "./svg";
import { commitLayout, toast } from "./sync";
import { CC, curLayout, curView, edgeById, nodeByKey, viewContent, visibleNodes } from "./views";
import type { Pos, Side } from "./layout";

/**
 * 図の枠の要素（#wrap）を返す。
 *
 * @returns 図の枠の要素。無ければ $ が例外を投げる
 * @example
 * wrapEl().id // → "wrap"
 */
const wrapEl = (): HTMLElement => $("#wrap");

/**
 * 画面座標を図の枠内の座標（枠の左上からの px）にする。
 *
 * @param cx 画面の x（clientX、px）
 * @param cy 画面の y（clientY、px）
 * @returns 図の枠の左上からの [x, y]（px）
 * @example
 * // 図の枠の左上が画面の (300, 50)
 * local(350, 70) // → [50, 20]
 * local(300, 50) // → [0, 0]（枠の左上）
 */
export function local(cx: number, cy: number): [number, number] {
  const r = wrapEl().getBoundingClientRect();
  return [cx - r.left, cy - r.top];
}
/**
 * 図の枠内の座標を図の座標にする（表示の移動 S.tf.x・S.tf.y と拡大率 S.tf.s を戻す）。
 *
 * @param lx 図の枠の左上からの x（px）
 * @param ly 図の枠の左上からの y（px）
 * @returns 図の座標 [x, y]
 * @example
 * // S.tf が { x: 40, y: 40, s: 1 }
 * toCanvas(140, 90)  // → [100, 50]
 * // S.tf が { x: 0, y: 0, s: 2 }（2 倍に拡大）
 * toCanvas(100, 100) // → [50, 50]
 */
export const toCanvas = (lx: number, ly: number): [number, number] => [(lx - S.tf.x) / S.tf.s, (ly - S.tf.y) / S.tf.s];

/**
 * 図の座標に最も近い、表示中の要素の縁を探す（近くに接続点があればそれ）。線を引くときの端を決めるのに使う。
 *
 * @param cx 図の座標の x
 * @param cy 図の座標の y
 * @param tolPx 縁からの許容の距離（画面の px。拡大率で図の座標に直す。既定 10）
 * @param allowInside 要素の内側も当たりにするなら true（既定 false）
 * @param exclude 除く要素のキー（線の始まりの要素など）。除かなければ null
 * @returns 要素のキー・辺・辺に沿った割合・接続点の ID（無ければ null）・距離 d。近くに縁が無ければ null
 * @example
 * // 拡大率 1。要素 A の箱が (0, 0, 224×44) で、接続点は無い
 * borderHit(100, -3) // → { node: "A", side: "t", t: 0.446, pin: null, d: 3 }
 * borderHit(100, -30) // → null（許容の距離より遠い）
 */
function borderHit(cx: number, cy: number, tolPx = 10, allowInside = false, exclude: string | null = null): (EndSpec & { d: number }) | null {
  const tol = tolPx / S.tf.s;
  let best: (EndSpec & { d: number }) | null = null;
  for (const n of visibleNodes()) {
    if (n.key === exclude) continue;
    const b = boxOf(n);
    const inside = cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
    if (!inside && (cx < b.x - tol || cx > b.x + b.w + tol || cy < b.y - tol || cy > b.y + b.h + tol)) continue;
    const nb = nearestBorder(b, cx, cy);
    if (nb.d > tol && !(allowInside && inside)) continue;
    let pin = null, pd = tol * 1.4;
    for (const p of pinsFor(n)) {
      const q = pinPoint(b, p.side, p.t);
      const d = Math.hypot(q.x - cx, q.y - cy);
      if (d < pd) {
        pd = d;
        pin = p;
      }
    }
    const c = pin
      ? { node: n.key, side: pin.side, t: pin.t, pin: pin.id, d: 0 }
      : { node: n.key, side: nb.side, t: nb.t, pin: null, d: inside && nb.d > tol ? tol : nb.d };
    if (!best || c.d < best.d) best = c;
  }
  return best;
}

type Drag =
  | { type: "life" | "seqwire"; key: string; lx: number; ly: number; moved: boolean }
  | { type: "handle" | "wire"; from: EndSpec; lx: number; ly: number; moved: boolean }
  | { type: "pin"; node: string; pin: string; from: EndSpec; lx: number; ly: number; moved: boolean }
  | { type: "node"; key: string; lx: number; ly: number; ox: number; oy: number; moved: boolean; group?: { key: string; p: Pos }[] }
  | { type: "edge"; id: string; lx: number; ly: number; moved: boolean }
  | { type: "pan"; lx: number; ly: number; ox: number; oy: number; moved: boolean }
  | { type: "band"; lx: number; ly: number; cx: number; cy: number; moved: boolean; addTo: boolean };

const ptrs = new Map<number, [number, number]>();
let drag: Drag | null = null;
let pinch: { d: number; s: number; cx: number; cy: number; x: number; y: number } | null = null;
let longPress: ReturnType<typeof setTimeout> | undefined;
/**
 * 座標を 10 単位に丸める（要素を動かすときの格子）。
 *
 * @param v 図の座標
 * @returns 10 の倍数に丸めた値
 * @example
 * snap(14) // → 10
 * snap(15) // → 20（ちょうど半分は切り上げ）
 */
const snap = (v: number): number => Math.round(v / 10) * 10;

/**
 * 図の上でポインタを押したとき。押した場所（ライフライン・＋ハンドル・接続点・要素・線・何も無いところ）に応じて
 * ドラッグの種類を決める。2 本指ならピンチを始める。Shift・Ctrl で要素を押すと選択に足し引きする。
 * 何も無いところでは、移動の道具・中ボタン・スペース・Alt・タッチ・シーケンス図ならパン、それ以外は範囲選択にする。
 * タッチの長押しでは右クリックメニューを開く（F-VIEW-4）。右ボタンは無視する。
 *
 * @param ev ポインタのイベント
 */
function onPointerDown(ev: PointerEvent): void {
  if (ev.button === 2) return;
  const svg = $("#canvas");
  svg.setPointerCapture(ev.pointerId);
  ptrs.set(ev.pointerId, local(ev.clientX, ev.clientY));
  if (ptrs.size === 2) {
    const [p1, p2] = [...ptrs.values()] as [[number, number], [number, number]];
    pinch = { d: Math.hypot(p1[0] - p2[0], p1[1] - p2[1]), s: S.tf.s, cx: (p1[0] + p2[0]) / 2, cy: (p1[1] + p2[1]) / 2, x: S.tf.x, y: S.tf.y };
    drag = null;
    S.wireDrag = null;
    return;
  }
  const [lx, ly] = local(ev.clientX, ev.clientY);
  const lEl = closest(ev, ".lifeline");
  if (lEl) {
    drag = { type: "life", key: lEl.dataset["key"] ?? "", lx, ly, moved: false };
    S.hover = null;
    return;
  }
  const hEl = closest(ev, ".handle"), pEl = closest(ev, ".pin"), nEl = closest(ev, ".node"), eEl = closest(ev, ".edge");
  if (hEl) {
    const from: EndSpec = { node: hEl.dataset["node"] ?? "", side: (hEl.dataset["side"] ?? "t") as Side, t: Number(hEl.dataset["t"]), pin: hEl.dataset["pin"] || null };
    drag = from.pin ? { type: "pin", node: from.node, pin: from.pin, from, lx, ly, moved: false } : { type: "handle", from, lx, ly, moved: false };
  } else if (pEl) {
    const n = nodeByKey(pEl.dataset["node"]);
    const pin = n ? pinsFor(n).find((p) => p.id === pEl.dataset["pin"]) : undefined;
    if (n && pin) drag = { type: "pin", node: n.key, pin: pin.id, from: { node: n.key, side: pin.side, t: pin.t, pin: pin.id }, lx, ly, moved: false };
  } else if (nEl) {
    const k = nEl.dataset["key"] ?? "";
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
      toggleSel(k);
      drag = null;
      return;
    }
    const L = curLayout().pos;
    const p = L[k] ?? [0, 0];
    const d: Drag = { type: "node", key: k, lx, ly, ox: p[0], oy: p[1], moved: false };
    if (S.selSet.size > 1 && S.selSet.has(k)) d.group = selNodes().flatMap((n) => {
      const q = L[n.key];
      return q ? [{ key: n.key, p: [q[0], q[1]] as Pos }] : [];
    });
    drag = d;
  } else if (eEl) drag = { type: "edge", id: eEl.dataset["edge"] ?? "", lx, ly, moved: false };
  else {
    const handMode = ev.button === 1 || S.spaceDown || (!!S.tool && "hand" in S.tool) || ev.altKey || ev.pointerType !== "mouse" || S.view === "seq";
    if (handMode) drag = { type: "pan", lx, ly, ox: S.tf.x, oy: S.tf.y, moved: false };
    else {
      const [cx, cy] = toCanvas(lx, ly);
      drag = { type: "band", lx, ly, cx, cy, moved: false, addTo: ev.shiftKey || ev.ctrlKey || ev.metaKey };
    }
  }
  S.hover = null;
  S.hoverKey = "";
  clearTimeout(longPress);
  if (ev.pointerType !== "mouse") {
    // 長押しで右クリックメニュー
    const cx = ev.clientX, cy = ev.clientY, tgt = ev.target;
    longPress = setTimeout(() => {
      if (drag && !drag.moved) {
        drag = null;
        S.wireDrag = null;
        renderOverlay();
        if (tgt instanceof Element) openCtx(cx, cy, ctxItemsAt(tgt, cx, cy));
      }
    }, 520);
  }
}

/**
 * 図の上でポインタを動かしたとき。押していないマウスなら、縁に＋ハンドルを出す。
 * ピンチなら拡大・縮小し、ドラッグ中ならその種類に応じて、メッセージ・線を引く、接続点を縁に沿って動かす、
 * 範囲選択の枠を描く、要素（複数選択ならまとめて）を 10 単位で動かす、表示範囲を動かす。5px 未満の動きは無視する。
 *
 * @param ev ポインタのイベント
 */
function onPointerMove(ev: PointerEvent): void {
  if (!ptrs.has(ev.pointerId)) {
    // ボタンを押していないマウスの移動：縁に＋ハンドルを出す
    if (ev.pointerType === "mouse" && !ptrs.size && S.view !== "seq") {
      const [cx, cy] = toCanvas(...local(ev.clientX, ev.clientY));
      const h = borderHit(cx, cy, 7, false);
      const key = h ? `${h.node}|${h.side}|${h.t}|${h.pin}` : "";
      if (key !== S.hoverKey) {
        S.hoverKey = key;
        S.hover = h;
        renderOverlay();
      }
    }
    return;
  }
  ptrs.set(ev.pointerId, local(ev.clientX, ev.clientY));
  if (pinch && ptrs.size === 2) {
    const [p1, p2] = [...ptrs.values()] as [[number, number], [number, number]];
    const d = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
    const s = Math.max(0.25, Math.min(2.2, (pinch.s * d) / pinch.d));
    S.tf.s = s;
    S.tf.x = pinch.cx - ((pinch.cx - pinch.x) * s) / pinch.s;
    S.tf.y = pinch.cy - ((pinch.cy - pinch.y) * s) / pinch.s;
    applyTf();
    return;
  }
  if (!drag) return;
  const [lx, ly] = local(ev.clientX, ev.clientY);
  const dx = lx - drag.lx, dy = ly - drag.ly;
  if (!drag.moved && Math.hypot(dx, dy) < 5) return;
  drag.moved = true;
  clearTimeout(longPress);
  const [cx, cy] = toCanvas(lx, ly);
  if (drag.type === "life" || drag.type === "seqwire") {
    // ライフラインから横にドラッグ：メッセージを引く
    drag.type = "seqwire";
    const from = drag.key;
    const y0 = toCanvas(drag.lx, drag.ly)[1];
    let target: string | null = null, bd = 90;
    CC().nodes.forEach((l, i) => {
      const d = Math.abs(i * SEQ.dx + SEQ.w / 2 - cx);
      if (d < bd && (l.key !== from || Math.abs(cy - y0) > 12)) {
        bd = d;
        target = l.key;
      }
    });
    S.wireDrag = { seq: true, from, x: cx, y: Math.max(SEQ.h + 10, y0), target };
    renderOverlay();
    return;
  }
  const pinSelected = drag.type === "pin" && S.selPin?.node === drag.node && S.selPin.pin === drag.pin;
  if (drag.type === "handle" || (drag.type === "pin" && !pinSelected)) drag = { type: "wire", from: drag.from, lx: drag.lx, ly: drag.ly, moved: true };
  if (drag.type === "wire") {
    S.wireDrag = { from: drag.from, x: cx, y: cy, target: borderHit(cx, cy, 16, true, drag.from.node) };
    renderOverlay();
    return;
  }
  if (drag.type === "pin") {
    // 選択中の接続点は縁に沿って動かす
    const n = nodeByKey(drag.node);
    if (!n) return;
    const nb = nearestBorder(boxOf(n), cx, cy);
    (curLayout().pins[drag.node] ||= {})[drag.pin] = [nb.side, nb.t];
    render();
    return;
  }
  if (drag.type === "band") {
    S.band = { x0: Math.min(drag.cx, cx), y0: Math.min(drag.cy, cy), x1: Math.max(drag.cx, cx), y1: Math.max(drag.cy, cy) };
    const b = $("#band");
    b.hidden = false;
    b.style.left = Math.min(drag.lx, lx) + "px";
    b.style.top = Math.min(drag.ly, ly) + "px";
    b.style.width = Math.abs(lx - drag.lx) + "px";
    b.style.height = Math.abs(ly - drag.ly) + "px";
    return;
  }
  if (drag.type === "node") {
    const L = curLayout().pos;
    if (drag.group) for (const g of drag.group) L[g.key] = [snap(g.p[0] + dx / S.tf.s), snap(g.p[1] + dy / S.tf.s)];
    else L[drag.key] = [snap(drag.ox + dx / S.tf.s), snap(drag.oy + dy / S.tf.s)];
    render();
  } else if (drag.type === "pan") {
    S.tf.x = drag.ox + dx;
    S.tf.y = drag.oy + dy;
    applyTf();
  }
}

/**
 * 図の上でポインタを離したとき。範囲選択なら枠に掛かった要素を選び、メッセージ・線を引いていたら
 * 相手の要素へのメッセージを足すか、関係の種類を選ぶ状態にする。要素・接続点を動かしたら配置を確定する。
 * 動かさずに離したらクリック（tap）として扱う。
 *
 * @param ev ポインタのイベント
 */
function onPointerUp(ev: PointerEvent): void {
  ptrs.delete(ev.pointerId);
  if (pinch) {
    if (ptrs.size < 2) pinch = null;
    drag = null;
    return;
  }
  if (!drag) return;
  const d = drag;
  drag = null;
  clearTimeout(longPress);
  if (d.type === "band") {
    $("#band").hidden = true;
    const b = S.band;
    S.band = null;
    if (!d.moved) {
      tap(d);
      return;
    }
    if (b) {
      const L = curLayout().pos;
      const rects = boxesOf(CC().nodes, L);
      const hit = CC().nodes.filter((n) => {
        const r = rects.get(n.key);
        return !!L[n.key] && !!r && r.x < b.x1 && r.x + r.w > b.x0 && r.y < b.y1 && r.y + r.h > b.y0;
      });
      const keys = d.addTo ? [...new Set([...S.selSet, ...hit.map((n) => n.key)])] : hit.map((n) => n.key);
      setSelection(keys);
      render();
      highlight();
      renderInspector();
      toast(hit.length ? `${hit.length} 個を選択しました` : "選択範囲に要素がありません");
    }
    return;
  }
  if (d.type === "seqwire") {
    const w = S.wireDrag;
    S.wireDrag = null;
    renderOverlay();
    if (w?.seq && w.target) MSGOPS.add(w.from, w.target);
    return;
  }
  if (d.type === "wire") {
    const w = S.wireDrag;
    S.wireDrag = null;
    if (w && !w.seq && w.target) {
      clearSel();
      S.mode = "connect";
      S.connectFrom = w.from.node;
      S.connectTo = w.target.node;
      S.wire = { from: w.from, to: w.target };
      render();
      highlight();
      renderInspector();
    } else renderOverlay();
    return;
  }
  if (d.moved) {
    if (d.type === "node" || d.type === "pin") commitLayout();
    return;
  }
  tap(d);
}

/**
 * 動かさずに離したとき（クリック・タップ）。道具を選んでいれば要素を置き、関係を引く途中なら相手を決め、
 * ＋ハンドルなら関係を引き始め、接続点・要素・線なら選んでテキストの対応箇所へスクロールする。何も無いところなら選択を解く。
 *
 * @param d 押したときのドラッグの情報（種類と押した位置）
 */
function tap(d: Drag): void {
  S.confirmDel = false;
  S.renaming = false;
  if (S.tool && !("hand" in S.tool) && (d.type === "pan" || d.type === "band")) {
    placeTool(d.lx, d.ly);
    return;
  }
  if (S.mode === "connect") {
    const key = d.type === "node" ? d.key : d.type === "pin" ? d.node : d.type === "handle" ? d.from.node : null;
    if (key && key !== S.connectFrom) {
      S.connectTo = key;
      if (S.wire) {
        if (d.type === "pin" || d.type === "handle") S.wire.to = d.from;
        else {
          const n = nodeByKey(key);
          if (n) {
            const [cx, cy] = toCanvas(d.lx, d.ly);
            const nb = nearestBorder(boxOf(n), cx, cy);
            S.wire.to = { node: key, side: nb.side, t: nb.t, pin: null };
          }
        }
      }
      renderInspector();
      return;
    }
    if (d.type === "pan" || d.type === "band") cancelConnect();
    render();
    renderInspector();
    return;
  }
  if (d.type === "handle") {
    clearSel();
    S.mode = "connect";
    S.connectFrom = d.from.node;
    S.connectTo = null;
    S.wire = { from: d.from, to: null };
    render();
    highlight();
    renderInspector();
    return;
  }
  if (d.type === "pin") {
    clearSel();
    S.selPin = { node: d.node, pin: d.pin };
    const n = nodeByKey(d.node);
    const pin = n ? pinsFor(n).find((p) => p.id === d.pin) : undefined;
    if (n) scrollEditorTo(pin?.port ? pin.port.entry.start : n.entry.start);
    render();
    highlight();
    renderInspector();
    return;
  }
  clearSel();
  if (d.type === "life" || d.type === "node") {
    S.sel = d.key;
    S.selSet = new Set([d.key]);
    const n = nodeByKey(d.key);
    if (n) scrollEditorTo(n.entry.start);
  } else if (d.type === "edge") {
    S.selEdge = d.id;
    const e = edgeById(d.id);
    if (e) scrollEditorTo(e.src.start);
  }
  render();
  highlight();
  renderInspector();
}

/**
 * 図の枠の中心を基準に拡大・縮小する（F-VIEW-4）。拡大率は 0.25〜2.2 に収める。
 *
 * @param f 倍率（1.2 で拡大、1 / 1.2 で縮小）
 */
export function zoomBy(f: number): void {
  const r = wrapEl().getBoundingClientRect();
  const cx = r.width / 2, cy = r.height / 2;
  const s = Math.max(0.25, Math.min(2.2, S.tf.s * f));
  S.tf.x = cx - ((cx - S.tf.x) * s) / S.tf.s;
  S.tf.y = cy - ((cy - S.tf.y) * s) / S.tf.s;
  S.tf.s = s;
  applyTf();
}

/**
 * ビュー全体（要素と package の枠）が収まるように、表示の移動と拡大率を決める（F-VIEW-4）。拡大率は 1.1 まで。
 * 要素が無いか配置が無ければ、拡大率 1 で左上から少し離して表示する。
 */
export function fit(): void {
  const cc = viewContent(S.M, curView());
  const L = curLayout().pos;
  const placed = cc.nodes.flatMap((n) => {
    const p = L[n.key];
    return p ? [{ n, p }] : [];
  });
  if (!cc.nodes.length || (!cc.seq && !placed.length)) {
    S.tf = { x: 40, y: 40, s: 1 };
    applyTf();
    return;
  }
  let x0: number, y0: number, x1: number, y1: number;
  if (cc.seq) {
    const g = seqGeom(cc);
    x0 = g.x0 - 20;
    y0 = g.y0 - 20;
    x1 = g.x0 + g.w + 20;
    y1 = g.y0 + g.h + 20;
  } else {
    const fr = !!cc.frame;
    const rects = boxesOf(cc.nodes, L);
    const bs = placed.flatMap((q) => rects.get(q.n.key) ?? []);
    // package の枠（F-VIEW-9）も画面に入れる
    const pk = packageBoxes(cc, (k) => (L[k] ? rects.get(k) : undefined)).map((p) => p.r);
    x0 = Math.min(...bs.map((b) => b.x), ...pk.map((b) => b.x)) - (fr ? 80 : 60);
    y0 = Math.min(...bs.map((b) => b.y), ...pk.map((b) => b.y)) - (fr ? 100 : 40);
    x1 = Math.max(...bs.map((b) => b.x + b.w), ...pk.map((b) => b.x + b.w)) + (fr ? 80 : 60);
    y1 = Math.max(...bs.map((b) => b.y + b.h), ...pk.map((b) => b.y + b.h)) + (fr ? 70 : 40);
  }
  const r = wrapEl().getBoundingClientRect();
  const bottomPad = $("#insp").hidden ? 0 : 70;
  const narrow = r.width < 600;
  const s = Math.max(narrow ? 0.45 : 0.25, Math.min(1.1, r.width / (x1 - x0), (r.height - bottomPad) / (y1 - y0)));
  const cx = (x1 - x0) * s <= r.width ? (r.width - (x1 - x0) * s) / 2 : 8;
  const cy = (y1 - y0) * s <= r.height - bottomPad ? (r.height - bottomPad - (y1 - y0) * s) / 2 : 8;
  S.tf = { s, x: cx - x0 * s, y: cy - y0 * s };
  applyTf();
}

/**
 * 内部ブロック図・シーケンス図に、型 type の部品を図の枠内の位置に置く（テキストの編集になる。F-EDIT-2）。
 * シーケンス図では位置によらずライフラインを足す。
 *
 * @param type 部品の型（部品定義の名前）
 * @param lx 図の枠の左上からの x（px）。置く要素の見出しの中央になる
 * @param ly 図の枠の左上からの y（px）
 */
export function placeUsageAt(type: string, lx: number, ly: number): void {
  if (S.view === "seq") {
    OPS.addUsage(type, [0, 0]);
    return;
  }
  const [cx, cy] = toCanvas(lx, ly);
  OPS.addUsage(type, [snap(cx - W / 2), snap(cy - 22)]);
}

/** 図の上の操作のイベントを登録する。 */
export function initCanvas(): void {
  const svg = $("#canvas");
  const wrap = wrapEl();
  svg.addEventListener("pointerdown", onPointerDown);
  svg.addEventListener("pointermove", onPointerMove);
  svg.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("pointerleave", () => {
    if (!ptrs.size && S.hover) {
      S.hover = null;
      S.hoverKey = "";
      renderOverlay();
    }
  });
  svg.addEventListener("pointercancel", (ev) => {
    ptrs.delete(ev.pointerId);
    drag = null;
    pinch = null;
    S.wireDrag = null;
    renderOverlay();
  });
  wrap.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) {
        const [cx, cy] = local(ev.clientX, ev.clientY);
        const s = Math.max(0.25, Math.min(2.2, S.tf.s * Math.exp(-ev.deltaY * 0.0015)));
        S.tf.x = cx - ((cx - S.tf.x) * s) / S.tf.s;
        S.tf.y = cy - ((cy - S.tf.y) * s) / S.tf.s;
        S.tf.s = s;
        applyTf();
        return;
      }
      S.tf.x -= ev.deltaX;
      S.tf.y -= ev.deltaY;
      applyTf();
    },
    { passive: false },
  );
  wrap.addEventListener("mousedown", (ev) => {
    if (ev.button === 1) ev.preventDefault();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.code !== "Space" || (ev.target instanceof Element && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName))) return;
    ev.preventDefault();
    if (!S.spaceDown) {
      S.spaceDown = true;
      wrap.classList.add("panning");
    }
  });
  document.addEventListener("keyup", (ev) => {
    if (ev.code === "Space") {
      S.spaceDown = false;
      wrap.classList.remove("panning");
    }
  });
  window.addEventListener("blur", () => {
    S.spaceDown = false;
    wrap.classList.remove("panning");
  });
  $("#zIn").onclick = () => zoomBy(1.2);
  $("#zOut").onclick = () => zoomBy(1 / 1.2);
  $("#zFit").onclick = fit;
  // ミニマップ
  const mini = $("#mini");
  let miniDrag = false;
  const miniPan = (ev: PointerEvent): void => {
    const m = S.mini;
    if (!m) return;
    const r = $("#mini .mbody").getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    const cx = m.g.x0 + (ev.clientX - r.left - m.pad) / m.s, cy = m.g.y0 + (ev.clientY - r.top - m.pad) / m.s;
    S.tf.x = wr.width / 2 - cx * S.tf.s;
    S.tf.y = wr.height / 2 - cy * S.tf.s;
    applyTf();
  };
  mini.addEventListener("pointerdown", (ev) => {
    if (closest(ev, "#miniHide")) return;
    miniDrag = true;
    mini.setPointerCapture(ev.pointerId);
    miniPan(ev);
  });
  mini.addEventListener("pointermove", (ev) => {
    if (miniDrag) miniPan(ev);
  });
  mini.addEventListener("pointerup", () => {
    miniDrag = false;
  });
}
