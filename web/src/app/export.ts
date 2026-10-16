// 書き出し（draw.io の XML・SVG）と、ファイルの読み込み・保存。

import { $, esc } from "./dom";
import { computeRoutes, linesOf, nodeH, pinPoint, pinsOf, W, type NodeBox } from "./geometry";
import { S } from "./state";
import { DEFS, packageBoxes, SEQ, seqGeom, seqMarkup, svgMarkup, type ColorFn } from "./svg";
import { curLayout, curView, viewContent } from "./views";

/** 書き出し用の明るい配色（CSS 変数を使えない環境向け）。 */
const LIGHT: Record<string, string> = {
  panel: "#FFFFFF", paper: "#EDF0EF", ink: "#1D2733", ink2: "#5A6572", sel: "#1F6FEB",
  "k-req": "#95600F", "k-req-bg": "#FBF1DE", "k-part": "#2D5A87", "k-part-bg": "#E6EFF8", "k-con": "#146F66", "k-con-bg": "#DFF1EE",
  "k-ver": "#387428", "k-ver-bg": "#E6F2E0", "k-concern": "#A0385A", "k-concern-bg": "#F9E6ED", "k-beh": "#65479A", "k-beh-bg": "#EEE8F7",
  "k-other": "#5A6572", "k-other-bg": "#F1F3F4",
};
/**
 * 書き出し用の明るい配色から、色の名前に当たる色を引く（F-EXP-1・F-EXP-2）。
 *
 * @param k 色の名前（CSS 変数の名前から -- を除いたもの。"ink"・"k-part-bg" など）
 * @returns 色（#RRGGBB）。知らない名前なら "#000000"
 * @example
 * LC("k-part") // → "#2D5A87"
 * LC("nope")   // → "#000000"（知らない名前）
 */
const LC: ColorFn = (k) => LIGHT[k] ?? "#000000";

/**
 * 現在のビューを draw.io の XML にする（F-EXP-2）。要素は配置の座標の箱に、ポートは小さな箱に、
 * 線は経路の出口・入口を指定した直角の線にする。シーケンス図はライフラインとメッセージにする。
 *
 * @returns draw.io（app.diagrams.net）で読み込める mxfile の XML
 * @example
 * // 「構造」の図に要素が 1 つも無い
 * drawioXml()
 * // → '<mxfile host="app.diagrams.net"><diagram id="v" name="構造"><mxGraphModel grid="1" gridSize="10"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'
 * // 構造の図に part def A がある
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
  const wrapXml = (name: string): string =>
    `<mxfile host="app.diagrams.net"><diagram id="v" name="${q(name)}"><mxGraphModel grid="1" gridSize="10"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;
  if (cc.seq) {
    const Hh = seqGeom(cc).H;
    cc.nodes.forEach((l, i) => {
      map.set(l.key, "n" + id);
      cells += `<mxCell id="n${id++}" value="${q(l.name + (l.entry.type ? " : " + l.entry.type : ""))}" style="shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;outlineConnect=0;size=${SEQ.h};fillColor=#E6EFF8;strokeColor=#2D5A87;" vertex="1" parent="1"><mxGeometry x="${i * SEQ.dx}" y="0" width="${SEQ.w}" height="${Hh}" as="geometry"/></mxCell>`;
    });
    cc.edges.forEach((e, k) => {
      const y = (SEQ.h + SEQ.first + k * SEQ.gap) / Hh;
      const src = map.get(e.from), dst = map.get(e.to);
      if (!src || !dst) return;
      cells += `<mxCell id="e${id++}" value="${q(`${k + 1}. ${e.label}${e.type ? " : " + e.type : ""}`)}" style="html=1;verticalAlign=bottom;endArrow=block;endFill=1;exitX=0.5;exitY=${y.toFixed(4)};entryX=0.5;entryY=${y.toFixed(4)};exitPerimeter=0;entryPerimeter=0;" edge="1" parent="1" source="${src}" target="${dst}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
    });
    return wrapXml("sd " + (cc.ctx ? cc.ctx.name : ""));
  }
  const at = (key: string): [number, number] => L.pos[key] ?? [0, 0];
  if (cc.frame && nodes.length) {
    const x0 = Math.min(...nodes.map((n) => at(n.key)[0])) - 60, y0 = Math.min(...nodes.map((n) => at(n.key)[1])) - 80;
    const x1 = Math.max(...nodes.map((n) => at(n.key)[0])) + W + 60, y1 = Math.max(...nodes.map((n) => at(n.key)[1] + nodeH(n))) + 50;
    cells += `<mxCell id="n${id++}" value="${q(`«${cc.frame.kind}»<br><b>${esc(cc.frame.title)}</b>`)}" style="html=1;whiteSpace=wrap;verticalAlign=top;align=left;spacingLeft=10;rounded=0;fillColor=#F3F7FB;strokeColor=#2D5A87;" vertex="1" parent="1"><mxGeometry x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" as="geometry"/></mxCell>`;
  }
  for (const n of nodes) {
    const c = LC("k-" + n.fam), bg = LC("k-" + n.fam + "-bg");
    const p = at(n.key);
    const lines = linesOf(n).map((x) => esc(x.t));
    const label =
      `«${n.kind}»<br><b>${esc((n.short ? `<'${n.short}'> ` : "") + n.name + (!n.isDef && n.entry.type ? " : " + n.entry.type : ""))}</b>` +
      (lines.length ? `<hr><div style="text-align:left;font-size:10px">${lines.join("<br>")}</div>` : "");
    const nid = "n" + id++;
    map.set(n.key, nid);
    cells += `<mxCell id="${nid}" value="${q(label)}" style="html=1;whiteSpace=wrap;verticalAlign=top;rounded=${n.isDef ? 0 : 1};arcSize=8;fillColor=${bg};strokeColor=${c};" vertex="1" parent="1"><mxGeometry x="${p[0]}" y="${p[1]}" width="${W}" height="${nodeH(n)}" as="geometry"/></mxCell>`;
    for (const pp of pinsOf(n, L, S.view)) {
      if (!pp.port) continue;
      const pq = pinPoint({ x: 0, y: 0, w: W, h: nodeH(n) }, pp.side, pp.t);
      const lp =
        pp.side === "l" ? "labelPosition=left;align=right;" : pp.side === "r" ? "labelPosition=right;align=left;" : pp.side === "t" ? "verticalLabelPosition=top;verticalAlign=bottom;" : "verticalLabelPosition=bottom;verticalAlign=top;";
      const pid = "n" + id++;
      map.set(n.key + "|port:" + pp.port.name, pid);
      cells += `<mxCell id="${pid}" value="${q(pp.port.name)}" style="rounded=0;html=1;fillColor=#FFFFFF;strokeColor=${c};fontSize=9;${lp}" vertex="1" parent="${nid}"><mxGeometry x="${pq.x - 6}" y="${pq.y - 6}" width="12" height="12" as="geometry"/></mxCell>`;
    }
  }
  const box = new Map<string, NodeBox>(nodes.map((n) => {
    const p = at(n.key);
    return [n.key, { x: p[0], y: p[1], w: W, h: nodeH(n), n, pins: pinsOf(n, L, S.view) }];
  }));
  const routes = computeRoutes(box, edges, L, "ortho");
  const cp = (side: string, t: string, pre: string): string =>
    side === "l" ? `${pre}X=0;${pre}Y=${t};` : side === "r" ? `${pre}X=1;${pre}Y=${t};` : side === "t" ? `${pre}X=${t};${pre}Y=0;` : `${pre}X=${t};${pre}Y=1;`;
  for (const e of edges) {
    const st = e.kind === "comp" ? "startArrow=diamondThin;startFill=1;endArrow=none;" : e.kind === "flow" ? "endArrow=block;endFill=1;strokeWidth=2;" : "dashed=1;endArrow=open;";
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
  return wrapXml(v.label);
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
  const defs = DEFS.replace(/var\(--ink2\)/g, LIGHT["ink2"] ?? "").replace(/var\(--k-con\)/g, LIGHT["k-con"] ?? "").replace(/var\(--ink\)/g, LIGHT["ink"] ?? "");
  const svg = (x0: number, y0: number, w: number, h: number, body: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" width="${w}" height="${h}"><defs>${defs}</defs><rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#FFFFFF"/>${body}</svg>`;
  const fonts = { font: "Noto Sans JP, sans-serif", mono: "monospace" };
  if (content.seq) {
    const { s, g } = seqMarkup(LC, content, fonts);
    return svg(g.x0 - 10, g.y0 - 10, g.w + 20, g.h + 20, s);
  }
  const { es, ns } = svgMarkup(LC, content, L, { ...fonts, view: S.view, edgeStyle: S.edgeStyle, phases: !!S.M.phases });
  const at = (key: string): [number, number] => L.pos[key] ?? [0, 0];
  const nodes = content.nodes;
  if (!nodes.length) return svg(0, 0, 100, 100, "");
  const fpad = content.frame ? 60 : 0;
  // package の枠（F-VIEW-9）も切れないように含める
  const pk = packageBoxes(content, (k) => {
    const n = nodes.find((x) => x.key === k);
    return n ? { x: at(k)[0], y: at(k)[1], w: W, h: nodeH(n) } : undefined;
  }).map((p) => p.r);
  const x0 = Math.min(...nodes.map((n) => at(n.key)[0]), ...pk.map((r) => r.x)) - 40 - fpad;
  const y0 = Math.min(...nodes.map((n) => at(n.key)[1]), ...pk.map((r) => r.y)) - 40 - fpad - (fpad ? 20 : 0);
  const x1 = Math.max(...nodes.map((n) => at(n.key)[0] + W), ...pk.map((r) => r.x + r.w)) + 40 + fpad;
  const y1 = Math.max(...nodes.map((n) => at(n.key)[1] + nodeH(n)), ...pk.map((r) => r.y + r.h)) + 40 + fpad;
  return svg(x0, y0, x1 - x0, y1 - y0, es + ns);
}

/**
 * 文字列をファイルとしてダウンロードさせる（一時的な URL を作ってリンクを押し、すぐに URL を解放する）。
 *
 * @param filename 保存するファイル名（"model.svg" など）
 * @param data ファイルの中身
 * @param type MIME タイプ（"image/svg+xml" など）
 */
export function download(filename: string, data: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * draw.io の書き出しダイアログのボタンに操作をつなぐ。起動時に 1 回呼ぶ。
 * 閉じるボタンでダイアログを隠し、コピーのボタンで XML をクリップボードに写して、結果をボタンの文字で 2 秒示す。
 */
export function initExport(): void {
  $("#modalClose").onclick = () => {
    $("#modal").hidden = true;
  };
  $("#modalCopy").onclick = async () => {
    const ta = $<HTMLTextAreaElement>("#modalText");
    const btn = $("#modalCopy");
    ta.focus();
    ta.select();
    let ok = false;
    try {
      await navigator.clipboard.writeText(ta.value);
      ok = true;
    } catch {
      ok = false;
    }
    btn.textContent = ok ? "コピーしました" : "選択済みです。手動でコピーしてください";
    setTimeout(() => {
      btn.textContent = "コピー";
    }, 2000);
  };
}

/**
 * 現在のビューの draw.io の XML を、書き出しダイアログの欄に入れて表示する（F-EXP-2）。
 */
export function showDrawio(): void {
  $<HTMLTextAreaElement>("#modalText").value = drawioXml();
  $("#modal").hidden = false;
}
