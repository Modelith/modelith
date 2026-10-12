// 元に戻す・やり直す。テキストが唯一の正本なので、履歴はテキストの版の列として持つ（配置の @layout も含む）。
// 履歴は文書（ファイル）ごとに持つ（F-EDIT-4）。

import { diffRange } from "../core";
import { $ } from "./dom";
import { flushEdit } from "./editor";
import { scrollEditorTo } from "./render";
import { S } from "./state";
import { setText, toast } from "./sync";

const MAX = 200;

interface History {
  list: string[];
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
  if (H.list[H.i] === S.text) return;
  H.list = H.list.slice(0, H.i + 1);
  H.list.push(S.text);
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
  if (H.timer !== undefined || H.list[H.i] !== S.text) recordHistory();
  const j = H.i + step;
  const after = H.list[j];
  if (after === undefined) return;
  const [a, b] = diffRange(S.text, after);
  H.i = j;
  S.mode = null;
  S.wire = null;
  S.renaming = false;
  S.portForm = false;
  S.confirmDel = false;
  setText(after, { noHistory: true, fromText: true, changeAt: a, flash: [a, Math.max(a + 1, b)] });
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
