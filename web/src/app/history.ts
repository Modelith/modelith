// 元に戻す・やり直す。履歴は「テキストと配置」の版の列として持つ（配置はテキストとは別のファイル、ADR-0005）。
// 履歴は文書（ファイル）ごとに持つ（F-EDIT-4）。

import { diffRange } from "../core";
import { $ } from "./dom";
import { flushEdit } from "./editor";
import { parseLayoutFile } from "./layout-file";
import { scrollEditorTo } from "./render";
import { S } from "./state";
import { committedLayout, loadLayout, notifyLayoutChange, setText, toast } from "./sync";

const MAX = 200;

/** 履歴の 1 版。配置は配置ファイルの文字列で持つ。 */
interface Snapshot {
  text: string;
  layout: string;
}

/**
 * 2 つの版が同じ（テキストも配置も等しい）か。
 *
 * @param a 比べる版（履歴の外を指したときは undefined）
 * @param b 比べる版
 * @returns 同じなら true。a が undefined なら false
 * @example
 * same({ text: "a", layout: "{}" }, { text: "a", layout: "{}" }) // → true
 * same(undefined, { text: "a", layout: "{}" })                   // → false（境界）
 */
const same = (a: Snapshot | undefined, b: Snapshot): boolean => !!a && a.text === b.text && a.layout === b.layout;
/**
 * 今の文書の版（テキストと、確定した配置の文字列）を作る。
 * 自動で置いただけの座標は版に含めない（文書を開き直しても版が増えないように）。
 *
 * @returns 今の版
 * @example
 * // S.text が "package P;" で、手で動かした配置が無い
 * current() // → { text: "package P;", layout: committedLayout() の文字列 }
 */
const current = (): Snapshot => ({ text: S.text, layout: committedLayout() });

interface History {
  list: Snapshot[];
  i: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const histories = new Map<string, History>();
let H: History = { list: [], i: -1, timer: undefined };

/**
 * 文書 key の履歴に切り替える（無ければ作る）。履歴はファイルごとに持つ（F-EDIT-4）。
 * 前の文書のまとめ待ちの記録は取りやめ、元に戻す・やり直すのボタンの状態を描き直す。
 *
 * @param key 文書のキー。null なら、開いている文書が無い（どの文書にも属さない空の履歴にし、戻せない。F-FILE-14）
 */
export function useHistory(key: string | null): void {
  clearTimeout(H.timer);
  H.timer = undefined;
  let h = key === null ? undefined : histories.get(key);
  if (!h) {
    h = { list: [], i: -1, timer: undefined };
    if (key !== null) histories.set(key, h);
  }
  H = h;
  updateUndoUI();
}

/**
 * 閉じた文書の履歴を捨てる。
 *
 * @param key 文書のキー
 */
export function dropHistory(key: string): void {
  histories.delete(key);
}

/**
 * 今の版を履歴に記録する。直前の版と同じなら何もしない。今の位置より後ろの版（やり直せる版）は捨て、
 * 200 版を超えたら古いものから捨てる（F-EDIT-4）。ボタンの状態を描き直す。
 */
export function recordHistory(): void {
  H.timer = undefined;
  const now = current();
  if (same(H.list[H.i], now)) return;
  H.list = H.list.slice(0, H.i + 1);
  H.list.push(now);
  if (H.list.length > MAX) H.list.shift();
  H.i = H.list.length - 1;
  updateUndoUI();
}

/**
 * 同じ操作の中の複数の更新を 1 つの版にまとめる。記録を次のタスクに遅らせ、それまでの呼び出しは 1 回にまとめる。
 */
export function scheduleRecord(): void {
  clearTimeout(H.timer);
  H.timer = setTimeout(recordHistory, 0);
}

/**
 * 履歴を 1 版戻す・進める（F-EDIT-4）。入力の反映待ちや未記録の変更があれば先に記録する。
 * 移った版のテキストと配置を読み込み、図の操作の途中状態（接続・名前の変更など）を取り消し、
 * 変わった箇所にカーソルを置いてスクロールし、トーストで知らせる。移れる版が無ければ何もしない。
 *
 * @param step -1 で元に戻す、1 でやり直す
 */
function goHistory(step: -1 | 1): void {
  flushEdit();
  if (H.timer !== undefined || !same(H.list[H.i], current())) recordHistory();
  const j = H.i + step;
  const after = H.list[j];
  if (after === undefined) return;
  const [a, b] = diffRange(S.text, after.text);
  H.i = j;
  S.mode = null;
  S.wire = null;
  S.renaming = false;
  S.docEdit = false;
  S.attrEdit = null;
  S.portForm = false;
  S.confirmDel = false;
  loadLayout(parseLayoutFile(after.layout).layout);
  notifyLayoutChange();
  setText(after.text, { noHistory: true, fromText: true, changeAt: a, flash: a < b ? [a, b] : null });
  $<HTMLTextAreaElement>("#ed").setSelectionRange(a, a);
  scrollEditorTo(a);
  updateUndoUI();
  toast(step < 0 ? "元に戻しました" : "やり直しました");
}

/**
 * 元に戻す・やり直すのボタンと編集のメニューの項目を、戻れる・進める版があるときだけ押せるようにする。
 */
function updateUndoUI(): void {
  for (const id of ["#btnUndo", "#menuUndo"]) $<HTMLButtonElement>(id).disabled = H.i <= 0;
  for (const id of ["#btnRedo", "#menuRedo"]) $<HTMLButtonElement>(id).disabled = H.i >= H.list.length - 1;
}

/**
 * 元に戻す（1 版戻る。F-EDIT-4）。
 */
export const undo = (): void => goHistory(-1);
/**
 * やり直す（1 版進む。F-EDIT-4）。
 */
export const redo = (): void => goHistory(1);

/**
 * 元に戻す・やり直すのボタンと編集のメニューの項目に操作をつなぐ。起動時に 1 回呼ぶ。
 */
export function initHistory(): void {
  $("#btnUndo").onclick = $("#menuUndo").onclick = undo;
  $("#btnRedo").onclick = $("#menuRedo").onclick = redo;
}
