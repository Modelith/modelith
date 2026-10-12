// 元に戻す・やり直す。テキストが唯一の正本なので、履歴はテキストの版の列として持つ（配置の @layout も含む）。

import { diffRange } from "../core";
import { $ } from "./dom";
import { flushEdit } from "./editor";
import { S } from "./state";
import { setText, toast } from "./sync";
import { scrollEditorTo } from "./render";

const MAX = 200;
const H: { list: string[]; i: number; timer: ReturnType<typeof setTimeout> | undefined } = { list: [], i: -1, timer: undefined };

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
