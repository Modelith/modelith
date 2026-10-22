// エクスポートの中身（draw.io の XML・SVG）と、ファイルのダウンロード。

import { $, esc } from "./dom";
import type { ModelNode, ModelSequenceEvent } from "../core";
import { flowDetail, flowShape } from "./action-flow";
import { boundaryBoxes, boxesOf, computeRoutes, keywordOf, linesOf, pinPoint, pinsOf, regionSeparators, stateTitle, type Box, type NodeBox } from "./geometry";
import { isPseudoState } from "./state-machine";
import { S } from "./state";
import { DEFS, packageBoxes, SEQ, seqGeom, seqMarkup, seqRowY, svgMarkup, type ColorFn } from "./svg";
import { curLayout, curView, viewContent } from "./views";

/** エクスポート用の明るい配色（CSS 変数を使えない環境向け）。 */
const LIGHT: Record<string, string> = {
  panel: "#FFFFFF", paper: "#EDF0EF", ink: "#1D2733", ink2: "#5A6572", sel: "#1F6FEB",
  "k-req": "#95600F", "k-req-bg": "#FBF1DE", "k-part": "#2D5A87", "k-part-bg": "#E6EFF8", "k-con": "#146F66", "k-con-bg": "#DFF1EE",
  "k-ver": "#387428", "k-ver-bg": "#E6F2E0", "k-concern": "#A0385A", "k-concern-bg": "#F9E6ED", "k-beh": "#65479A", "k-beh-bg": "#EEE8F7",
  "k-other": "#5A6572", "k-other-bg": "#F1F3F4",
};
/**
 * エクスポート用の明るい配色から、色の名前に当たる色を引く（F-EXP-1・F-EXP-2）。
 *
 * @param k 色の名前（CSS 変数の名前から -- を除いたもの。"ink"・"k-part-bg" など）
 * @returns 色（#RRGGBB）。知らない名前なら "#000000"
 * @example
 * LC("k-part") // → "#2D5A87"
 * LC("nope")   // → "#000000"（知らない名前）
 */
const LC: ColorFn = (k) => LIGHT[k] ?? "#000000";

/**
 * draw.io の図形と線（mxCell）を、draw.io（app.diagrams.net）がそのまま開ける .drawio のファイルの形（圧縮しない mxfile）で包む。
 * 根の 2 つのセル（id 0 と、図形の親になる id 1）を先に置く。
 *
 * @param name 図（ページ）の名前（XML の属性に書くので、& < > " ' を文字参照にする）
 * @param cells 根の下に置く mxCell の XML（親は "1"）
 * @returns mxfile の XML
 * @example
 * mxfileXml("ブロック定義図", "")
 * // → '<mxfile host="app.diagrams.net"><diagram id="v" name="ブロック定義図"><mxGraphModel grid="1" gridSize="10"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'
 * mxfileXml(`A & 'B'`, "") // → '…<diagram id="v" name="A &amp; &#39;B&#39;">…'（名前の記号は文字参照にする）
 */
export function mxfileXml(name: string, cells: string): string {
  const q = esc(name).replace(/'/g, "&#39;");
  return `<mxfile host="app.diagrams.net"><diagram id="v" name="${q}"><mxGraphModel grid="1" gridSize="10"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;
}

/**
 * 線の種類から、draw.io の線の形（矢印・破線）を決める。draw.io に無い再定義・参照の印は、特殊化と同じ白抜きの三角にする。
 *
 * @param kind 線の種類（`comp`・`flow`・`specialize` など）
 * @returns draw.io の style に足す文字列
 * @example
 * drawioEdgeStyle("comp")       // → "startArrow=diamondThin;startFill=1;endArrow=none;"
 * drawioEdgeStyle("specialize") // → "endArrow=block;endFill=0;"
 * drawioEdgeStyle("satisfy")    // → "dashed=1;endArrow=open;"
 * drawioEdgeStyle("bind")       // → "endArrow=none;"（結び付け・n 項の接続の線は矢印の無い実線）
 * drawioEdgeStyle("annotate")   // → "dashed=1;endArrow=none;"（メモから要素への線は矢印の無い破線）
 * drawioEdgeStyle("succession") // → "endArrow=open;"（順序は実線と開いた矢印、8.2.3.17）
 * drawioEdgeStyle("transition") // → "endArrow=open;"（遷移も実線と開いた矢印、8.2.3.18）
 */
export function drawioEdgeStyle(kind: string): string {
  if (kind === "succession" || kind === "transition") return "endArrow=open;";
  if (kind === "comp") return "startArrow=diamondThin;startFill=1;endArrow=none;";
  if (kind === "bind" || kind === "connect") return "endArrow=none;";
  if (kind === "annotate") return "dashed=1;endArrow=none;";
  if (kind === "flow") return "endArrow=block;endFill=1;strokeWidth=2;";
  if (["specialize", "subset", "redefine", "reference"].includes(kind)) return "endArrow=block;endFill=0;";
  return "dashed=1;endArrow=open;";
}

/**
 * シーケンス図のライフラインの上のイベント（8.2.3.9 の sq-proxy）を、draw.io の図形にする。白抜きの小さな丸（10×10）で、札は右下に書く。
 *
 * @param ev イベント
 * @param lane イベントを描くライフラインの位置（左から 0, 1, …）
 * @returns draw.io の style と、丸の左上の座標
 * @example
 * drawioEventCell({ key: "e:a.e", lifeline: "l:a", label: ".e", entry, row: 0 }, 0) // → { style: "ellipse;html=1;fillColor=#FFFFFF;…", x: 80, y: 81 }
 * drawioEventCell({ …, row: 2 }, 1)                                                // → { style: …, x: 280, y: 189 }
 */
export function drawioEventCell(ev: ModelSequenceEvent, lane: number): { style: string; x: number; y: number } {
  return {
    style: `ellipse;html=1;fillColor=${LC("panel")};strokeColor=${LC("ink")};labelPosition=right;verticalLabelPosition=bottom;align=left;verticalAlign=top;fontSize=10;`,
    x: lane * SEQ.dx + SEQ.w / 2 - 5,
    y: seqRowY(ev.row) - 5,
  };
}

/**
 * アクションの流れの図の要素（8.2.3.17）を、draw.io の図形の形と文字にする。開始は塗った丸、終了は draw.io の終了の記号、
 * fork・join は塗った棒、decide・merge はひし形（名前は右）、send・accept は SysML の送信・受信の図形、ほかは角の丸い四角。
 *
 * @param n アクションの流れの図の要素
 * @returns draw.io の style と、図形に書く文字（HTML）
 * @example
 * drawioFlowCell(start)            // → { style: "ellipse;html=1;fillColor=#1D2733;strokeColor=#1D2733;", value: "" }
 * drawioFlowCell(decide d)         // → { style: "rhombus;html=1;…labelPosition=right;align=left;", value: "d" }
 * drawioFlowCell(send S() to b)    // → { style: "shape=mxgraph.sysml.sendSigAct;html=1;whiteSpace=wrap;…", value: "«send»<br>S() to b" }
 */
export function drawioFlowCell(n: ModelNode): { style: string; value: string } {
  const ink = LC("ink"), c = LC("k-beh"), bg = LC("k-beh-bg");
  const shape = flowShape(n.kind);
  if (shape === "start") return { style: `ellipse;html=1;fillColor=${ink};strokeColor=${ink};`, value: "" };
  if (shape === "done") return { style: `ellipse;html=1;shape=endState;fillColor=${ink};strokeColor=${ink};`, value: "" };
  if (shape === "bar") return { style: `html=1;fillColor=${ink};strokeColor=none;labelPosition=right;align=left;verticalLabelPosition=top;verticalAlign=bottom;`, value: esc(n.name) };
  if (shape === "diamond") return { style: `rhombus;html=1;fillColor=${bg};strokeColor=${c};labelPosition=right;align=left;`, value: esc(n.name) };
  const detail = flowDetail(n);
  const plain = ["action", "perform action", "state"].includes(n.kind);
  const lines = [plain ? "" : `«${n.kind}»`, n.name ? `<b>${esc(n.name + (plain && detail ? " " + detail : ""))}</b>` : "", !plain && detail ? esc(detail) : ""];
  const base = shape === "send" ? "shape=mxgraph.sysml.sendSigAct;" : shape === "accept" ? "shape=mxgraph.sysml.accEvent;" : "rounded=1;arcSize=20;";
  return { style: `${base}html=1;whiteSpace=wrap;fillColor=${bg};strokeColor=${c};`, value: lines.filter(Boolean).join("<br>") };
}

/**
 * 状態遷移の図の要素（8.2.3.18）を、draw.io の図形の形と文字にする。開始は塗った丸、終了は draw.io の終了の記号、
 * 状態は角の丸い四角に名前を太字で書き、entry・do・exit の振る舞いを線の下に書く（中に状態を描く状態は、文字を上に寄せる）。
 *
 * @param n 状態遷移の図の要素
 * @returns draw.io の style と、図形に書く文字（HTML）
 * @example
 * drawioStateCell(start)                          // → { style: "ellipse;html=1;fillColor=#1D2733;strokeColor=#1D2733;", value: "" }
 * drawioStateCell(state on { entry action init; }) // → { style: "rounded=1;arcSize=20;html=1;whiteSpace=wrap;verticalAlign=top;…", value: "<b>on</b><hr>…entry / init…" }
 */
export function drawioStateCell(n: ModelNode): { style: string; value: string } {
  const ink = LC("ink"), c = LC("k-beh"), bg = LC("k-beh-bg");
  if (isPseudoState(n) && n.kind === "start") return { style: `ellipse;html=1;fillColor=${ink};strokeColor=${ink};`, value: "" };
  if (isPseudoState(n)) return { style: `ellipse;html=1;shape=endState;fillColor=${ink};strokeColor=${ink};`, value: "" };
  const lines = linesOf(n).map((x) => esc(x.t));
  const value = `<b>${esc(stateTitle(n))}</b>` + (lines.length ? `<hr><div style="text-align:left;font-size:10px">${lines.join("<br>")}</div>` : "");
  return { style: `rounded=1;arcSize=20;html=1;whiteSpace=wrap;verticalAlign=top;fillColor=${bg};strokeColor=${c};`, value };
}

/**
 * 現在のビューを draw.io の XML にする（F-EXP-2）。要素は配置の座標の箱（アクションの流れの図・状態遷移の図の要素は記号の図形）に、
 * ポートは小さな箱に、線は経路の出口・入口を指定した直角の線にする。並行の状態の領域は、破線で区切る。シーケンス図はライフラインとメッセージ、
 * ライフラインの上のイベント（白抜きの丸と札）と、イベントの間の順序（破線と開いた矢印）にする。
 *
 * @returns draw.io（app.diagrams.net）で読み込める mxfile の XML
 * @example
 * // ブロック定義図に要素が 1 つも無い
 * drawioXml()
 * // → '<mxfile host="app.diagrams.net"><diagram id="v" name="ブロック定義図"><mxGraphModel grid="1" gridSize="10"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'
 * // ブロック定義図に part def A がある
 * drawioXml() // → 上の root の中に <mxCell id="n2" value="«part def»&lt;br&gt;&lt;b&gt;A&lt;/b&gt;" … vertex="1" …> が入る
 */
export function drawioXml(): string {
  const v = curView();
  const cc = viewContent(S.M, v);
  const { nodes, edges } = cc;
  const L = curLayout();
  const q = (s: string): string => esc(s).replace(/'/g, "&#39;");
  let id = 2, cells = "";
  const map = new Map<string, string>();
  if (cc.seq) {
    const Hh = seqGeom(cc).H;
    cc.nodes.forEach((l, i) => {
      map.set(l.key, "n" + id);
      cells += `<mxCell id="n${id++}" value="${q(l.name + (l.entry.type ? " : " + l.entry.type : ""))}" style="shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;outlineConnect=0;size=${SEQ.h};fillColor=#E6EFF8;strokeColor=#2D5A87;" vertex="1" parent="1"><mxGeometry x="${i * SEQ.dx}" y="0" width="${SEQ.w}" height="${Hh}" as="geometry"/></mxCell>`;
    });
    cc.edges.forEach((e, k) => {
      if (e.kind !== "message") return;
      const y = seqRowY(e.row ?? k) / Hh;
      const src = map.get(e.from), dst = map.get(e.to);
      if (!src || !dst) return;
      cells += `<mxCell id="e${id++}" value="${q(`${(e.idx ?? k) + 1}. ${e.label}${e.type ? " : " + e.type : ""}`)}" style="html=1;verticalAlign=bottom;endArrow=block;endFill=1;exitX=0.5;exitY=${y.toFixed(4)};entryX=0.5;entryY=${y.toFixed(4)};exitPerimeter=0;entryPerimeter=0;" edge="1" parent="1" source="${src}" target="${dst}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
    });
    // ライフラインの上のイベント（8.2.3.9 の sq-proxy）は白抜きの丸と札、イベントの間の順序（sq-succession）は破線と開いた矢印
    const lane = new Map(cc.nodes.map((l, i) => [l.key, i]));
    for (const ev of cc.events ?? []) {
      const i = lane.get(ev.lifeline);
      if (i == null) continue;
      map.set(ev.key, "n" + id);
      const c = drawioEventCell(ev, i);
      cells += `<mxCell id="n${id++}" value="${q(ev.label)}" style="${c.style}" vertex="1" parent="1"><mxGeometry x="${c.x}" y="${c.y}" width="10" height="10" as="geometry"/></mxCell>`;
    }
    for (const e of cc.edges) {
      const src = map.get(e.from), dst = map.get(e.to);
      if (e.kind !== "succession" || !src || !dst) continue;
      cells += `<mxCell id="e${id++}" value="${q(e.label)}" style="html=1;dashed=1;endArrow=open;endFill=0;" edge="1" parent="1" source="${src}" target="${dst}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
    }
    return mxfileXml("sd " + (cc.ctx ? cc.ctx.name : ""), cells);
  }
  const rects = boxesOf(nodes, L.pos);
  const rect = (n: ModelNode): Box => rects.get(n.key) ?? { x: 0, y: 0, w: 0, h: 0 };
  let frameRect: Box | undefined;
  const boundaryRects = new Map<string, NodeBox>();
  if (cc.frame && nodes.length) {
    const x0 = Math.min(...nodes.map((n) => rect(n).x)) - 60, y0 = Math.min(...nodes.map((n) => rect(n).y)) - 80;
    const x1 = Math.max(...nodes.map((n) => rect(n).x + rect(n).w)) + 60, y1 = Math.max(...nodes.map((n) => rect(n).y + rect(n).h)) + 50;
    frameRect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    cells += `<mxCell id="n${id++}" value="${q(`«${cc.frame.kind}»<br><b>${esc(cc.frame.title)}</b>`)}" style="html=1;whiteSpace=wrap;verticalAlign=top;align=left;spacingLeft=10;rounded=0;fillColor=#F3F7FB;strokeColor=#2D5A87;" vertex="1" parent="1"><mxGeometry x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" as="geometry"/></mxCell>`;
    // 対象そのもののポート（8.2.3.13）は、枠の辺の上の小さな四角
    for (const [key, r] of boundaryBoxes(frameRect, cc.boundary ?? [])) {
      const n = (cc.boundary ?? []).find((x) => x.key === key);
      if (!n) continue;
      boundaryRects.set(key, { ...r, n, pins: [] });
      const lp = n.boundary === "in" ? "labelPosition=left;align=right;" : n.boundary === "out" ? "labelPosition=right;align=left;" : "verticalLabelPosition=bottom;verticalAlign=top;";
      map.set(key, "n" + id);
      cells += `<mxCell id="n${id++}" value="${q(n.name)}" style="rounded=0;html=1;fillColor=#FFFFFF;strokeColor=#2D5A87;fontSize=9;${lp}" vertex="1" parent="1"><mxGeometry x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" as="geometry"/></mxCell>`;
    }
  }
  for (const n of nodes) {
    const c = LC("k-" + n.fam), bg = LC("k-" + n.fam + "-bg");
    const r = rect(n);
    if (n.junction) {
      // n 項の接続の点（8.2.3.13 の n-ary-connection-dot）は、塗った小さな丸
      const nid = "n" + id++;
      map.set(n.key, nid);
      cells += `<mxCell id="${nid}" value="${q(n.name)}" style="ellipse;html=1;fillColor=${LC("k-con")};strokeColor=${LC("k-con")};verticalLabelPosition=top;verticalAlign=bottom;" vertex="1" parent="1"><mxGeometry x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" as="geometry"/></mxCell>`;
      continue;
    }
    if (n.flow) {
      // アクションの流れの図の要素（8.2.3.17）は、記号ごとの図形
      const nid = "n" + id++;
      map.set(n.key, nid);
      const cell = drawioFlowCell(n);
      cells += `<mxCell id="${nid}" value="${q(cell.value)}" style="${cell.style}" vertex="1" parent="1"><mxGeometry x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" as="geometry"/></mxCell>`;
      continue;
    }
    if (n.state) {
      // 状態遷移の図の要素（8.2.3.18）は、記号ごとの図形
      const nid = "n" + id++;
      map.set(n.key, nid);
      const cell = drawioStateCell(n);
      cells += `<mxCell id="${nid}" value="${q(cell.value)}" style="${cell.style}" vertex="1" parent="1"><mxGeometry x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" as="geometry"/></mxCell>`;
      continue;
    }
    if (n.note) {
      // メモ（8.2.3.4 の comment）は、角を折った四角に本文を書く
      const nid = "n" + id++;
      map.set(n.key, nid);
      const text = (n.name ? `«comment» <b>${esc(n.name)}</b><br>` : "") + linesOf(n).map((x) => esc(x.t)).join("<br>");
      cells += `<mxCell id="${nid}" value="${q(text)}" style="shape=note;size=12;html=1;whiteSpace=wrap;align=left;verticalAlign=top;spacingLeft=8;fillColor=#FFFFFF;strokeColor=${c};" vertex="1" parent="1"><mxGeometry x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" as="geometry"/></mxCell>`;
      continue;
    }
    // 中に部品を描く部品（内部ブロック図の入れ子）は、区画の行を書かない
    const lines = nodes.some((c) => c.container === n.key) ? [] : linesOf(n).map((x) => esc(x.t));
    const label =
      `«${keywordOf(n)}»<br><b>${esc((n.short ? `<'${n.short}'> ` : "") + n.name + (!n.isDef && n.entry.type ? " : " + n.entry.type : ""))}</b>` +
      (lines.length ? `<hr><div style="text-align:left;font-size:10px">${lines.join("<br>")}</div>` : "");
    const nid = "n" + id++;
    map.set(n.key, nid);
    cells += `<mxCell id="${nid}" value="${q(label)}" style="html=1;whiteSpace=wrap;verticalAlign=top;rounded=${n.isDef ? 0 : 1};arcSize=8;fillColor=${bg};strokeColor=${c};" vertex="1" parent="1"><mxGeometry x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" as="geometry"/></mxCell>`;
    for (const pp of pinsOf(n, L, S.view)) {
      if (!pp.port) continue;
      const pq = pinPoint({ x: 0, y: 0, w: r.w, h: r.h }, pp.side, pp.t);
      const lp =
        pp.side === "l" ? "labelPosition=left;align=right;" : pp.side === "r" ? "labelPosition=right;align=left;" : pp.side === "t" ? "verticalLabelPosition=top;verticalAlign=bottom;" : "verticalLabelPosition=bottom;verticalAlign=top;";
      const pid = "n" + id++;
      map.set(n.key + "|port:" + pp.port.name, pid);
      cells += `<mxCell id="${pid}" value="${q(pp.port.name)}" style="rounded=0;html=1;fillColor=#FFFFFF;strokeColor=${c};fontSize=9;${lp}" vertex="1" parent="${nid}"><mxGeometry x="${pq.x - 6}" y="${pq.y - 6}" width="12" height="12" as="geometry"/></mxCell>`;
    }
  }
  // 並行の状態の領域（8.2.3.18）を、破線で区切る（状態定義そのものが並行なら、対象の枠の中を区切る）
  for (const k of cc.regions ?? []) {
    const outer = k ? rects.get(k) : frameRect;
    if (!outer) continue;
    for (const sep of regionSeparators(outer, nodes.filter((n) => (n.container ?? "") === k).map(rect)))
      cells += `<mxCell id="e${id++}" value="" style="endArrow=none;dashed=1;html=1;strokeColor=${LC("k-beh")};" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${sep.x1}" y="${sep.y}" as="sourcePoint"/><mxPoint x="${sep.x2}" y="${sep.y}" as="targetPoint"/></mxGeometry></mxCell>`;
  }
  const box = new Map<string, NodeBox>([...nodes.map((n): [string, NodeBox] => [n.key, { ...rect(n), n, pins: n.junction || n.note ? [] : pinsOf(n, L, S.view) }]), ...boundaryRects]);
  const routes = computeRoutes(box, edges, L, "ortho");
  const cp = (side: string, t: string, pre: string): string =>
    side === "l" ? `${pre}X=0;${pre}Y=${t};` : side === "r" ? `${pre}X=1;${pre}Y=${t};` : side === "t" ? `${pre}X=${t};${pre}Y=0;` : `${pre}X=${t};${pre}Y=1;`;
  for (const e of edges) {
    const st = drawioEdgeStyle(e.kind);
    let src = map.get(e.from), dst = map.get(e.to), extra = "";
    const rt = routes.get(e.id);
    if (rt) {
      const f = rt.from, z = rt.to;
      const fpid = f.pin?.port ? map.get(e.from + "|" + f.pin.id) : undefined;
      const tpid = z.pin?.port ? map.get(e.to + "|" + z.pin.id) : undefined;
      if (fpid) src = fpid;
      else extra += cp(f.side, f.t.toFixed(3), "exit") + "exitPerimeter=0;";
      if (tpid) dst = tpid;
      else extra += cp(z.side, z.t.toFixed(3), "entry") + "entryPerimeter=0;";
    }
    cells += `<mxCell id="e${id++}" value="${q(e.label)}" style="html=1;rounded=1;edgeStyle=orthogonalEdgeStyle;${st}${extra}" edge="1" parent="1" source="${src}" target="${dst}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  }
  return mxfileXml(v.label, cells);
}

/**
 * 現在のビューを単独の SVG にする（F-EXP-1）。明るい配色で、CSS 変数を使わない。
 * 表示範囲は、要素と package の枠（F-VIEW-9）がすべて入るように余白 40（枠つきの図はさらに 60）をとる。
 *
 * @returns SVG の文字列（白い背景つき）
 * @example
 * // 図に要素が 1 つも無い
 * svgExport() // → '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><defs>…</defs><rect x="0" y="0" width="100" height="100" fill="#FFFFFF"/></svg>'
 * // 要素が (0, 0) に 1 つ（高さ 44）だけある自動の図
 * svgExport() // → '<svg … viewBox="-40 -40 304 124" width="304" height="124">…</svg>'
 */
export function svgExport(): string {
  const content = viewContent(S.M, curView());
  const L = curLayout();
  const defs = DEFS.replace(/var\(--ink2\)/g, LIGHT["ink2"] ?? "").replace(/var\(--k-con\)/g, LIGHT["k-con"] ?? "").replace(/var\(--ink\)/g, LIGHT["ink"] ?? "").replace(/var\(--paper\)/g, LIGHT["paper"] ?? "");
  const svg = (x0: number, y0: number, w: number, h: number, body: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${w}" height="${h}"><defs>${defs}</defs><rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#FFFFFF"/>${body}</svg>`;
  const fonts = { font: "Noto Sans JP, sans-serif", mono: "monospace" };
  if (content.seq) {
    const { s, g } = seqMarkup(LC, content, fonts);
    return svg(g.x0 - 10, g.y0 - 10, g.w + 20, g.h + 20, s);
  }
  const { es, ns } = svgMarkup(LC, content, L, { ...fonts, view: S.view, edgeStyle: S.edgeStyle, phases: !!S.M.phases });
  const nodes = content.nodes;
  if (!nodes.length) return svg(0, 0, 100, 100, "");
  const byKey = boxesOf(nodes, L.pos);
  const rects = [...byKey.values()];
  const fpad = content.frame ? 60 : 0;
  // package の枠（F-VIEW-9）も切れないように含める
  const pk = packageBoxes(content, (k) => byKey.get(k)).map((p) => p.r);
  const x0 = Math.min(...rects.map((r) => r.x), ...pk.map((r) => r.x)) - 40 - fpad;
  const y0 = Math.min(...rects.map((r) => r.y), ...pk.map((r) => r.y)) - 40 - fpad - (fpad ? 20 : 0);
  const x1 = Math.max(...rects.map((r) => r.x + r.w), ...pk.map((r) => r.x + r.w)) + 40 + fpad;
  const y1 = Math.max(...rects.map((r) => r.y + r.h), ...pk.map((r) => r.y + r.h)) + 40 + fpad;
  return svg(x0, y0, x1 - x0, y1 - y0, es + ns);
}

/**
 * 文字列やバイト列をファイルとしてダウンロードさせる（一時的な URL を作ってリンクを押し、すぐに URL を解放する）。
 *
 * @param filename 保存するファイル名（"model.svg" など）
 * @param data ファイルの中身（文字列は UTF-8 で書く。プラグインのエクスポートはバイト列）
 * @param type MIME タイプ（"image/svg+xml" など）
 */
export function download(filename: string, data: string | Uint8Array<ArrayBuffer>, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
