// テキストエディタ（入力の反映・カーソル位置と図の選択の同期・問題一覧と、そのコピー）。

import { $, closest } from "./dom";
import { scheduleRecord } from "./history";
import { renderInspector } from "./inspector";
import { centerOn, highlight, render, scrollEditorTo, syncScroll } from "./render";
import { cancelConnect, S } from "./state";
import { problemCopyRows, reparse, notifyTextChange, setSync, toast } from "./sync";
import { copiedText, problemsText } from "./problem-copy";
import { diagramName } from "./labels";
import { goToGap } from "./gap-guide";
import { isNarrow } from "./panels";
import { gapScreen } from "./trace-gap";
import { CC, curView, viewContent } from "./views";

let timer: ReturnType<typeof setTimeout> | undefined;

/** 入力の反映待ちがあれば、すぐに解析して反映する。 */
export function flushEdit(): void {
  if (timer === undefined) return;
  clearTimeout(timer);
  timer = undefined;
  reparse(true);
  notifyTextChange();
}

/**
 * 問題一覧の行をクリップボードに入れ、件数を知らせる（F-EDIT-13）。ブラウザが許さなければ、そのことを知らせる。
 *
 * @param which コピーする行の番号（無ければすべて）
 */
async function copyProblems(which?: number): Promise<void> {
  const rows = problemCopyRows(which);
  if (!rows.length) return;
  try {
    await navigator.clipboard.writeText(problemsText(rows));
  } catch (e) {
    console.error(e);
    toast("コピーできませんでした。ブラウザがクリップボードへの書き込みを許していません");
    return;
  }
  toast(copiedText(rows.length));
}

/** カーソル位置を含む要素を図で選択する。 */
function caretToNode(): void {
  const p = $<HTMLTextAreaElement>("#ed").selectionStart;
  let best = null;
  for (const n of [...CC().nodes, ...S.M.nodes]) {
    const e = n.entry;
    if (e.start <= p && p <= e.end && (!best || e.start > best.entry.start)) best = n;
  }
  const key = best ? best.key : null;
  if (key === S.sel) return;
  S.sel = key;
  S.selSet = new Set(key ? [key] : []);
  S.selEdge = null;
  S.selPin = null;
  cancelConnect();
  render();
  highlight();
  renderInspector();
  if (!key || !best) return;
  const v = curView();
  if (!viewContent(S.M, v).nodes.some((n) => n.key === key)) toast(`「${best.name}」は「${diagramName(v.label)}」には出ていません`);
  else centerOn(key, true);
}

/**
 * テキストエディタに操作をつなぐ。起動時に 1 回呼ぶ。入力は色付けをすぐ直し、入力が 280 ミリ秒止まったら
 * 解析して図などに反映し（F-EDIT-1）、履歴に記録する。クリックや矢印キーでカーソルを動かしたら、
 * カーソル位置の要素を図で選ぶ。問題一覧の項目を押したら、その位置にカーソルを移す（F-EDIT-5）。
 * ただし、トレースの抜けの行は、図が見えていれば図の要素へ移る（F-TRACE-2）。
 */
export function initEditor(): void {
  const ed = $<HTMLTextAreaElement>("#ed");
  ed.addEventListener("input", () => {
    S.text = ed.value;
    highlight();
    setSync("busy", "編集中…");
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      reparse(true);
      notifyTextChange();
      scheduleRecord();
    }, 280);
  });
  ed.addEventListener("scroll", syncScroll);
  ed.addEventListener("click", caretToNode);
  ed.addEventListener("keyup", (ev) => {
    if (/Arrow|Page|Home|End/.test(ev.key)) caretToNode();
  });
  // 問題のコピー：「すべてコピー」、行の右クリック、行を選んで Ctrl＋C（F-EDIT-13）
  $("#problems").addEventListener("click", (ev) => {
    if (closest(ev, "[data-copy-all]")) void copyProblems();
  });
  $("#problems").addEventListener("contextmenu", (ev) => {
    const b = closest(ev, "[data-copy]");
    if (!b) return;
    ev.preventDefault();
    void copyProblems(Number(b.dataset["copy"]));
  });
  $("#problems").addEventListener("keydown", (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>("[data-copy]");
    if (!b || ev.key.toLowerCase() !== "c" || !(ev.ctrlKey || ev.metaKey)) return;
    ev.preventDefault();
    void copyProblems(Number(b.dataset["copy"]));
  });
  $("#problems").addEventListener("click", (ev) => {
    const b = closest(ev, "button");
    // テキストの中の位置の無い行（プラグインについての行）は、ここでは扱わない
    if (b?.dataset["pos"] === undefined) return;
    // トレースの抜けの行は、図が見えていれば図の要素へ移る（テキストの行の印も付ける。F-TRACE-2）
    const gap = b.dataset["gap"];
    if (gap !== undefined && gapScreen(isNarrow(), $("#main").dataset["tab"]) === "diagram") {
      goToGap(Number(gap));
      return;
    }
    const p = Number(b.dataset["pos"]);
    ed.focus();
    ed.setSelectionRange(p, p);
    scrollEditorTo(p);
  });
}
