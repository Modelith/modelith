// 図の操作を意図としてコアに渡す（ADR-0016）。コアが返したテキストの編集を当て、画面への反映は呼び出し側が setText で行う。

import { applyTextEdits, edit, type Intent } from "../core";
import { S } from "./state";
import { toast } from "./sync";

/** 図の操作の結果（編集を当てたテキストと、変わり始めの位置）。 */
export interface Performed {
  text: string;
  at: number;
  select?: string;
  flash?: [number, number];
}

/** 意図をコアに渡し、返ってきた編集を今のテキストに当てる。操作できなければ理由を知らせて null。 */
export function perform(intent: Intent): Performed | null {
  const r = edit(S.text, intent);
  if ("refused" in r) {
    toast(r.refused);
    return null;
  }
  return { text: applyTextEdits(S.text, r.edits), at: r.edits[0]?.start ?? 0, select: r.select, flash: r.flash };
}
