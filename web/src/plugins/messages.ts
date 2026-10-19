// v1 のプラグインから届いたメッセージ（コアが形・権限・範囲を確かめた後）を、ホストがどう扱うかを決める（ADR-0018 §3・§4）。入出力を持たない。

import type { CheckedPluginMessage, PlacedDiagnostic, Refused, TextEdit } from "../core";
import type { HostMessage, NotifyLevel } from "./generated/protocol";

/** プラグインの変更案を、テキストが変わったために適用しなかったときの知らせ（ADR-0016 と同じ考え方）。 */
export const STALE_PLUGIN_EDIT = "テキストが変わったため、プラグインの変更を適用しませんでした";

/** ホストが行うこと。notice があれば、プラグインの一覧にも出す。ignore は、知らせずに捨てる（古いテキストに対する診断など、ふつうに起きること）。 */
export type HostAction =
  | { kind: "ready" }
  | { kind: "diagnostics"; version: number; items: PlacedDiagnostic[] }
  | { kind: "applyEdits"; version: number; edits: TextEdit[]; label?: string }
  | { kind: "refuseEdits"; notice: string }
  | { kind: "commandDone"; requestId: number }
  | { kind: "commandFailed"; requestId: number; title: string; message: string }
  | { kind: "notify"; level: NotifyLevel; message: string }
  | { kind: "reply"; message: HostMessage; notice: string }
  | { kind: "drop"; notice: string }
  | { kind: "ignore" };

/** コアが確かめた結果（`CoreClient.checkPluginMessage` の返り値）。 */
export interface CheckResult {
  /** 確かめたテキストの版。 */
  version: number;
  /** 確かめている間にテキストが変わったか。 */
  stale: boolean;
  checked: CheckedPluginMessage | Refused;
}

/**
 * コアが確かめたメッセージから、ホストが行うことを決める。
 * 変更案と診断は、プラグインが示した版が、確かめたテキストの版と同じで、その後もテキストが変わっていないときだけ使う。
 *
 * @param result コアが確かめた結果
 * @param pending 実行を頼んで、まだ答えの無いコマンド（依頼の番号 → コマンドの表示名）
 * @returns ホストが行うこと
 * @example
 * decideMessage({ version: 3, stale: false, checked: { message: { type: "ready" } } }, new Map()) // → { kind: "ready" }
 * decideMessage({ version: 3, stale: false, checked: { message: { type: "proposeEdits", version: 3, edits }, edits: placed } }, new Map())
 * // → { kind: "applyEdits", version: 3, edits: placed }
 * decideMessage({ version: 4, stale: false, checked: { message: { type: "proposeEdits", version: 3, … }, … } }, new Map())
 * // → { kind: "refuseEdits", notice: "テキストが変わったため、プラグインの変更を適用しませんでした" }
 * decideMessage({ version: 3, stale: false, checked: { refused: "宣言していない権限…" } }, new Map()) // → { kind: "drop", notice: "宣言していない権限…" }
 * decideMessage({ version: 3, stale: false, checked: { message: { type: "commandDone", requestId: 9 } } }, new Map())
 * // → { kind: "drop", notice: "依頼していない結果（commandDone）が届いたため、使いませんでした" }
 */
export function decideMessage(result: CheckResult, pending: ReadonlyMap<number, string>): HostAction {
  const { version, stale, checked } = result;
  if ("refused" in checked) return { kind: "drop", notice: checked.refused };
  const m = checked.message;
  switch (m.type) {
    case "ready":
      return { kind: "ready" };
    case "diagnostics":
      if (stale || m.version !== version) return { kind: "ignore" };
      return { kind: "diagnostics", version, items: checked.diagnostics ?? [] };
    case "proposeEdits":
      if (stale || m.version !== version) return { kind: "refuseEdits", notice: STALE_PLUGIN_EDIT };
      return { kind: "applyEdits", version, edits: checked.edits ?? [], label: m.label };
    case "commandDone":
      return pending.has(m.requestId) ? { kind: "commandDone", requestId: m.requestId } : unrequested(m.type);
    case "failed": {
      const title = pending.get(m.requestId);
      return title === undefined ? unrequested(m.type) : { kind: "commandFailed", requestId: m.requestId, title, message: m.message };
    }
    case "notify":
      return { kind: "notify", level: m.level, message: m.message };
    case "storageGet":
    case "storageSet":
      // プラグイン用の保存場所は、次の段階で入れる。プラグインを待たせないように、値なしで答える
      return { kind: "reply", message: { type: "storageResult", requestId: m.requestId }, notice: "このバージョンでは、プラグイン用の保存場所はまだ使えません（storage）" };
    case "imported":
    case "exported":
      return unrequested(m.type);
  }
}

/**
 * 頼んでいない答えが届いたときの扱い（使わずに、一覧で知らせる）。
 *
 * @param type 届いたメッセージの種類
 * @returns 捨てて知らせる、という扱い
 * @example
 * unrequested("imported") // → { kind: "drop", notice: "依頼していない結果（imported）が届いたため、使いませんでした" }
 */
function unrequested(type: string): HostAction {
  return { kind: "drop", notice: `依頼していない結果（${type}）が届いたため、使いませんでした` };
}

/**
 * プラグインの一覧に出す知らせを足す。同じ知らせが続くときは重ねず、新しいものから 5 件までにする。
 *
 * @param notices 今の知らせ（新しいものが先）
 * @param notice 足す知らせ
 * @returns 足した後の知らせ（新しいものが先）
 * @example
 * addNotice(["a"], "b")                     // → ["b", "a"]
 * addNotice(["a"], "a")                     // → ["a"]（続く同じ知らせは重ねない）
 * addNotice(["5", "4", "3", "2", "1"], "6") // → ["6", "5", "4", "3", "2"]（境界値: 5 件まで）
 */
export function addNotice(notices: readonly string[], notice: string): string[] {
  if (notices[0] === notice) return [...notices];
  return [notice, ...notices].slice(0, 5);
}

/**
 * プラグインから届いたデータを、コアに確かめてもらうための JSON にする。
 *
 * @param data MessagePort で届いたデータ（構造化複製された値）
 * @returns JSON の文字列。JSON にできない値（循環・BigInt・undefined だけなど）は null
 * @example
 * messageJson({ type: "ready" })  // → '{"type":"ready"}'
 * messageJson(undefined)          // → null
 * messageJson({ n: 1n })          // → null（BigInt）
 */
export function messageJson(data: unknown): string | null {
  try {
    return JSON.stringify(data) ?? null;
  } catch {
    return null;
  }
}

/**
 * 変更案を当てた後に光らせる範囲（最初の変更で入れたテキスト）を求める。
 *
 * @param edits 当てる変更（始まりの順。位置は当てる前のテキストの UTF-16）
 * @returns 当てた後のテキストでの範囲。変更が無ければ null
 * @example
 * flashRange([{ start: 4, end: 6, text: "abc" }])                                  // → [4, 7]
 * flashRange([{ start: 0, end: 2, text: "" }, { start: 5, end: 5, text: "x" }])   // → [0, 0]
 * flashRange([])                                                                   // → null
 */
export function flashRange(edits: readonly TextEdit[]): [number, number] | null {
  const first = edits[0];
  return first ? [first.start, first.start + first.text.length] : null;
}
