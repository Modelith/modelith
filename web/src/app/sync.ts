// テキストを更新し、解析し直して画面全体を同期する。図の操作も最後は setText を通る（ADR-0001）。

import { build, lineOf, parse, type Problem } from "../core";
import { $, esc } from "./dom";
import { autoPlace, nodeH } from "./geometry";
import { scheduleRecord } from "./history";
import { renderInspector } from "./inspector";
import { emptyView, type Layout } from "./layout";
import { serializeLayout } from "./layout-file";
import { renderPalette, renderSub, renderTabs, renderTree } from "./panels";
import { prunePins } from "./pins";
import { highlight, render } from "./render";
import { S } from "./state";
import { curLayout, curView, VK, viewContent } from "./views";

export interface SetTextOpts {
  /** 変更が始まる位置（カーソル位置の補正に使う）。 */
  changeAt?: number;
  /** 一時的に強調する範囲。 */
  flash?: [number, number] | null;
  /** 元に戻す履歴に積まない。 */
  noHistory?: boolean;
  /** テキストの直接編集による変更（変わった要素を図で光らせる）。 */
  fromText?: boolean;
}

/** テキストを置き換えて、解析・描画・自動保存・履歴を更新する。 */
export function setText(t: string, opts: SetTextOpts = {}): void {
  const ed = $<HTMLTextAreaElement>("#ed");
  const { selectionStart: a, selectionEnd: b, scrollTop: st, scrollLeft: sl } = ed;
  const old = S.text;
  S.text = t;
  if (ed.value !== t) {
    ed.value = t;
    const d = t.length - old.length, cs = opts.changeAt ?? 0;
    const na = a >= cs ? a + d : a, nb = b >= cs ? b + d : b;
    ed.setSelectionRange(Math.max(0, na), Math.max(0, nb));
    ed.scrollTop = st;
    ed.scrollLeft = sl;
  }
  S.flash = opts.flash ?? null;
  reparse(!!opts.fromText);
  notifyTextChange();
  if (!opts.noHistory) scheduleRecord();
  if (S.flash) {
    setTimeout(() => {
      S.flash = null;
      highlight();
    }, 1900);
  }
}

/** テキストからモデルと配置を作り直し、画面全体を描き直す。 */
export function reparse(fromText: boolean): void {
  S.P = parse(S.text);
  S.M = build(S.P);
  prunePins();
  const sig = new Map<string, string>();
  for (const n of S.M.nodes) sig.set(n.key, S.text.slice(n.entry.start, n.entry.end));
  S.pulse = new Set();
  if (fromText) for (const [k, v] of sig) if (S.prevSig.get(k) !== v) S.pulse.add(k);
  S.prevSig = sig;
  if (S.sel && !S.M.nodes.some((n) => n.key === S.sel)) S.sel = null;
  if (S.selEdge && !S.M.edges.some((e) => e.id === S.selEdge)) S.selEdge = null;
  ensureLayout();
  highlight();
  render();
  renderProblems();
  renderInspector();
  updateSync();
  renderTabs();
  renderPalette();
  renderTree();
  renderSub();
}

/** 現在のビューで座標のない要素を自動で配置する。 */
export function ensureLayout(): void {
  if (S.view === "seq") return;
  const v = curView();
  const { nodes, edges } = viewContent(S.M, v);
  const L = curLayout().pos;
  const missing = nodes.filter((n) => !L[n.key]);
  if (!missing.length) return;
  const placed = nodes.flatMap((n) => {
    const p = L[n.key];
    return p ? [p[1] + nodeH(n)] : [];
  });
  const oy = placed.length ? Math.max(...placed) + 80 : 0;
  autoPlace(missing, edges, L, v, S.M.phases?.[0] ?? null, oy);
}

// 確定した配置（配置ファイルの文字列）。自動で置いただけの座標は含めない。
let committed = "";

/** 確定した配置を配置ファイルの文字列で返す（元に戻す履歴が比べるのはこれ）。 */
export function committedLayout(): string {
  return committed;
}

/** 表示する文書の配置にする（文書を切り替えたとき・元に戻したとき）。描き直しは呼び出し側の setText に任せる。 */
export function loadLayout(layout: Layout): void {
  S.layout = layout;
  committed = serializeLayout(layout);
}

let layoutListener: (layout: string) => void = () => {};
/** 配置が変わったときの処理（ワークスペースへの反映）を登録する。 */
export function onLayoutChange(fn: (layout: string) => void): void {
  layoutListener = fn;
}

/** 配置が変わったことを知らせる（元に戻したときなど、履歴には積まない）。 */
export function notifyLayoutChange(): void {
  committed = serializeLayout(S.layout);
  layoutListener(committed);
}

/**
 * 現在の配置を確定する。配置はテキストには書かず、文書の配置ファイルとして持つ（ADR-0005・C-6）。
 * 元に戻す履歴にも積み、描き直す。
 */
export function commitLayout(): void {
  notifyLayoutChange();
  scheduleRecord();
  render();
}

/** 現在のビューの配置を消して並べ直す。 */
export function relayout(): void {
  S.layout[VK()] = emptyView();
  ensureLayout();
  commitLayout();
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** 図の上部に短いメッセージを出す。 */
export function toast(msg: string): void {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2400);
}

let textListener: (text: string) => void = () => {};
/** テキストが変わったときの処理（ワークスペースへの反映）を登録する。 */
export function onTextChange(fn: (text: string) => void): void {
  textListener = fn;
}
/** テキストが変わったことを知らせる。 */
export function notifyTextChange(): void {
  textListener(S.text);
}

export function setSync(cls: "" | "busy" | "bad", txt: string): void {
  $("#sync").className = "sync " + cls;
  $("#syncText").textContent = txt;
}

function updateSync(): void {
  const n = S.M.nodes.length, e = S.M.edges.length, p = S.M.problems.filter((x) => !x.kind).length;
  setSync(p ? "bad" : "", p ? `同期済み（問題 ${p} 件）` : "同期済み");
  $("#textInfo").textContent = `SysML v2 テキスト：要素 ${n}、関係 ${e}`;
}

/** 問題（構文エラー・参照切れ・トレースの抜け）の一覧。 */
export function renderProblems(): void {
  // エラー → まだ扱えない構文 → トレースの抜け、の順に並べる
  const order = (k: Problem["kind"]): number => (k === undefined ? 0 : k === "unsupported" ? 1 : 2);
  const pr = [...S.M.problems].sort((a, b) => order(a.kind) - order(b.kind)).slice(0, 40);
  const mark = { gap: "△", unsupported: "ℹ" } as const;
  $("#problems").innerHTML = pr
    .map((p) => `<button data-pos="${p.pos}" class="${p.kind ?? ""}">${p.kind ? mark[p.kind] : "⚠"} ${lineOf(S.text, p.pos)} 行目：${esc(p.msg)}</button>`)
    .join("");
}
