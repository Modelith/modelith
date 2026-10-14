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

const same = (a: Snapshot | undefined, b: Snapshot): boolean => !!a && a.text === b.text && a.layout === b.layout;
// 自動で置いただけの座標は版に含めない（文書を開き直しても版が増えないように）。
const current = (): Snapshot => ({ text: S.text, layout: committedLayout() });

interface History {
  list: Snapshot[];
  i: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const histories = new Map<string, History>();
let H: History = { list: [], i: -1, timer: undefined };

/** 文書 key の履歴に切り替える（無ければ作る）。 */
export function useHistory(key: string): void {
  clearTimeout(H.timer);
  H.timer = undefined;
  let h = histories.get(key);
  if (!h) {
    h = { list: [], i: -1, timer: undefined };
    histories.set(key, h);
  }
  H = h;
  updateUndoUI();
}

/** 閉じた文書の履歴を捨てる。 */
export function dropHistory(key: string): void {
  histories.delete(key);
}

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

/** 同じ操作の中の複数の更新を 1 つの版にまとめる。 */
export function scheduleRecord(): void {
  clearTimeout(H.timer);
  H.timer = setTimeout(recordHistory, 0);
}

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

function updateUndoUI(): void {
  $<HTMLButtonElement>("#btnUndo").disabled = H.i <= 0;
  $<HTMLButtonElement>("#btnRedo").disabled = H.i >= H.list.length - 1;
}

export const undo = (): void => goHistory(-1);
export const redo = (): void => goHistory(1);

export function initHistory(): void {
  $("#btnUndo").onclick = undo;
  $("#btnRedo").onclick = redo;
}
