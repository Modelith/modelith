// 図の操作を意図としてコアに渡す（ADR-0016）。コアが返したテキストの編集を当て、画面への反映は呼び出し側が setText で行う。

import { applyTextEdits, STALE_EDIT, type Intent } from "../core";
import { S } from "./state";
import { coreClient, toast } from "./sync";

/** 図の操作の結果（編集を当てたテキストと、変わり始めの位置）。 */
export interface Performed {
  text: string;
  at: number;
  select?: string;
  flash?: [number, number];
}

/** コアの返事を待っている図の操作。 */
const inflight = new Set<Promise<unknown>>();

/**
 * 処理中の図の操作がすべてテキストに反映されるまで待つ（保存の前など）。
 * 返事を受け取った後の反映（setText）は、続きの処理として走るので、次のタスクまで待ってから確かめる。
 */
export async function opsIdle(): Promise<void> {
  do {
    await Promise.allSettled([...inflight]);
    await new Promise((resolve) => setTimeout(resolve, 0));
  } while (inflight.size);
}

/**
 * 意図をコアに渡し、返ってきた編集を今のテキスト（S.text）に当てる。操作できなければ理由をトーストで知らせて null。
 * 返事を待つ間にテキストが変わったら、古い位置を書き換えないよう、その操作はやめる（ADR-0016 §4）。
 * テキストそのもの（S.text）はここでは書き換えない。画面への反映は呼び出し側が setText で行う。
 *
 * @param intent 図の操作の意図（`rename`・`delete`・`connect` など。crates/modelith-core/src/edit が受け取る形）
 * @returns 編集を当てた後のテキスト・変わり始めの位置（UTF-16。編集が無ければ 0）・選ぶ要素の名前・光らせる範囲。
 *   コアが断ったとき、または返事の前にテキストが変わったときは null
 * @example
 * // S.text が "package P { part def A; }" のとき
 * await perform({ op: "rename", key: "A", name: "Motor" })
 * // → { text: "package P { part def Motor; }", at: （変わり始めの位置）, select: "Motor", flash: … }
 * await perform({ op: "rename", key: "Gone", name: "B" }) // → null（理由をトーストで出す）
 */
export async function perform(intent: Intent): Promise<Performed | null> {
  const base = S.text;
  const pending = coreClient().edit(base, intent);
  inflight.add(pending);
  const r = await pending.finally(() => inflight.delete(pending));
  if (!("refused" in r) && S.text !== base) {
    toast(STALE_EDIT);
    return null;
  }
  if ("refused" in r) {
    toast(r.refused);
    return null;
  }
  return { text: applyTextEdits(base, r.edits), at: r.edits[0]?.start ?? 0, select: r.select, flash: r.flash };
}
