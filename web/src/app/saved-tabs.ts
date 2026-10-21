// 記憶した図のタブ（localStorage の modelith-tabs-v1）の読み込み（F-VIEW-2）。
// 判断だけを置き、読む先（localStorage）と知っているビューは呼ぶ側が渡す。壊れた記憶で起動が止まらないよう、形の合わない項目は捨てる。

import type { Tab } from "./state";

/** 記憶した図のタブと、表示していたタブの id（無ければ null）。 */
export interface SavedTabs {
  tabs: Tab[];
  active: number | null;
}

/**
 * 保存先から読んだ値が、図のタブの形か（id が整数、view が知っているビュー、ctx が無い・null・文字列、phase が無い・文字列）。
 * mv（テキストに書かれた view の名前）は、文字列でなければ無いものとして扱う。
 *
 * @param v JSON から読んだ値
 * @param viewIds 知っているビューの id
 * @returns 図のタブの形なら、整えたタブ（ctx の既定は null、phase の既定は ""）。そうでなければ null
 * @example
 * savedTab({ id: 1, view: "trace", ctx: null, phase: "" }, ["trace"]) // → { id: 1, view: "trace", ctx: null, phase: "" }
 * savedTab({ id: 1, view: "trace", mv: 2 }, ["trace"])                // → { id: 1, view: "trace", ctx: null, phase: "" }（mv は捨てる）
 * savedTab({ id: 1.5, view: "trace" }, ["trace"])                     // → null（id が整数でない）
 * savedTab({ id: 1, view: "gone" }, ["trace"])                        // → null（知らないビュー）
 * savedTab(null, ["trace"])                                           // → null
 */
function savedTab(v: unknown, viewIds: readonly string[]): Tab | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { id?: unknown; view?: unknown; ctx?: unknown; phase?: unknown; mv?: unknown };
  if (!Number.isInteger(o.id) || typeof o.view !== "string" || !viewIds.includes(o.view)) return null;
  if (o.ctx !== undefined && o.ctx !== null && typeof o.ctx !== "string") return null;
  if (o.phase !== undefined && typeof o.phase !== "string") return null;
  return { id: o.id as number, view: o.view, ctx: o.ctx ?? null, phase: o.phase ?? "", ...(typeof o.mv === "string" ? { mv: o.mv } : {}) };
}

/**
 * 記憶した図のタブ（JSON）を読む。形の合わないタブと、id が重なったタブ（2 つ目から）は捨てる。
 * 表示していたタブの id は、残ったタブのどれかを指すときだけ使う。
 *
 * @param json 保存した JSON（無ければ null）
 * @param viewIds 知っているビューの id（これ以外のビューのタブは捨てる）
 * @returns 戻すタブと表示していたタブの id。無い・JSON が壊れている・戻せるタブが 1 つも無いときは null
 * @example
 * parseSavedTabs('{"tabs":[{"id":1,"view":"trace","ctx":null,"phase":""}],"active":1}', ["trace"])
 * // → { tabs: [{ id: 1, view: "trace", ctx: null, phase: "" }], active: 1 }
 * parseSavedTabs('{"tabs":[null,{"id":2,"view":"ibd","ctx":"P","phase":""}],"active":9}', ["ibd"])
 * // → { tabs: [{ id: 2, view: "ibd", ctx: "P", phase: "" }], active: null }（null の項目を捨て、無いタブの id は使わない）
 * parseSavedTabs('{"tabs":"abc"}', ["trace"]) // → null（配列でない）
 * parseSavedTabs("{not json", ["trace"])      // → null
 * parseSavedTabs(null, ["trace"])             // → null（記憶が無い）
 */
export function parseSavedTabs(json: string | null, viewIds: readonly string[]): SavedTabs | null {
  if (json === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as { tabs?: unknown; active?: unknown };
  if (!Array.isArray(o.tabs)) return null;
  const seen = new Set<number>();
  const tabs: Tab[] = [];
  for (const item of o.tabs as unknown[]) {
    const t = savedTab(item, viewIds);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    tabs.push(t);
  }
  if (!tabs.length) return null;
  const active = typeof o.active === "number" && seen.has(o.active) ? o.active : null;
  return { tabs, active };
}
