// v1 のプラグインから届いたメッセージ（コアが形・権限・範囲を確かめた後）を、ホストがどう扱うかを決める（ADR-0018 §3・§4）。入出力を持たない。

import type { CheckedPluginMessage, PlacedDiagnostic, Refused, TextEdit } from "../core";
import type { NotifyLevel, PluginMessage } from "./generated/protocol";
import { MAX_DIAGNOSTICS } from "./limits";
import { utf8Bytes } from "./storage";
import { base64Bytes, exportFileName, MAX_TRANSFER_BYTES, mediaTypeOf, sizeText } from "./transfer";

/** プラグインの変更案を、テキストが変わったために適用しなかったときの知らせ（ADR-0016 と同じ考え方）。 */
export const STALE_PLUGIN_EDIT = "テキストが変わったため、プラグインの変更を適用しませんでした";

/** ホストがプラグインに頼んで、まだ答えの無いこと（コマンドの実行・取り込み・書き出し）。 */
export type PendingRequest =
  | { kind: "command"; title: string }
  | { kind: "import"; title: string }
  | { kind: "export"; title: string; extension: string };

/** ホストが行うこと。notice があれば、プラグインの一覧にも出す。ignore は、知らせずに捨てる（古いテキストに対する診断など、ふつうに起きること）。 */
export type HostAction =
  | { kind: "ready" }
  | { kind: "diagnostics"; version: number; items: PlacedDiagnostic[]; dropped: number }
  | { kind: "applyEdits"; version: number; edits: TextEdit[]; label?: string }
  | { kind: "refuseEdits"; notice: string }
  | { kind: "commandDone"; requestId: number }
  | { kind: "imported"; requestId: number; title: string; fileName: string; text: string }
  | { kind: "exported"; requestId: number; title: string; fileName: string; mediaType: string; base64: string }
  | { kind: "requestFailed"; requestId: number; notice: string }
  | { kind: "storageGet"; requestId: number; key: string }
  | { kind: "storageSet"; requestId: number; key: string; value: unknown }
  | { kind: "notify"; level: NotifyLevel; message: string }
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
 * コマンド・取り込み・書き出しの答えは、その種類で頼んで、まだ答えの無い依頼の番号のものだけを使う。
 * 保存場所の依頼（storageGet・storageSet）は、コアが storage の権限を確かめた後なので、そのままホストに任せる。
 * 診断は maxDiagnostics 件までを使い、超えた分は捨てて件数を添える（F-PLUG-7）。
 *
 * @param result コアが確かめた結果
 * @param pending 頼んで、まだ答えの無い依頼（依頼の番号 → 種類と表示名）
 * @param maxDiagnostics 1 回の診断で使う件数の上限
 * @returns ホストが行うこと
 * @example
 * decideMessage({ version: 3, stale: false, checked: { message: { type: "ready" } } }, new Map()) // → { kind: "ready" }
 * decideMessage({ version: 3, stale: false, checked: { message: { type: "diagnostics", version: 3, items }, diagnostics: placed } }, new Map(), 1)
 * // → { kind: "diagnostics", version: 3, items: [placed[0]], dropped: placed.length - 1 }
 * decideMessage({ version: 3, stale: false, checked: { message: { type: "proposeEdits", version: 3, edits }, edits: placed } }, new Map())
 * // → { kind: "applyEdits", version: 3, edits: placed }
 * decideMessage({ version: 4, stale: false, checked: { message: { type: "proposeEdits", version: 3, … }, … } }, new Map())
 * // → { kind: "refuseEdits", notice: "テキストが変わったため、プラグインの変更を適用しませんでした" }
 * decideMessage({ version: 3, stale: false, checked: { refused: "宣言していない権限…" } }, new Map()) // → { kind: "drop", notice: "宣言していない権限…" }
 * decideMessage({ version: 3, stale: false, checked: { message: { type: "commandDone", requestId: 9 } } }, new Map())
 * // → { kind: "drop", notice: "依頼していない結果（commandDone）が届いたため、使いませんでした" }
 * decideMessage({ …, checked: { message: { type: "imported", requestId: 2, fileName: "a.reqif", text: "package A;" } } }, new Map([[2, { kind: "import", title: "ReqIF" }]]))
 * // → { kind: "imported", requestId: 2, title: "ReqIF", fileName: "a.reqif", text: "package A;" }
 * decideMessage({ …, checked: { message: { type: "imported", requestId: 2, … } } }, new Map([[2, { kind: "export", … }]]))
 * // → { kind: "drop", notice: "依頼していない結果（imported）が届いたため、使いませんでした" }（書き出しの依頼に、取り込みの答え）
 */
export function decideMessage(result: CheckResult, pending: ReadonlyMap<number, PendingRequest>, maxDiagnostics = MAX_DIAGNOSTICS): HostAction {
  const { version, stale, checked } = result;
  if ("refused" in checked) return { kind: "drop", notice: checked.refused };
  const m = checked.message;
  switch (m.type) {
    case "ready":
      return { kind: "ready" };
    case "diagnostics":
      if (stale || m.version !== version) return { kind: "ignore" };
      return cappedDiagnostics(version, checked.diagnostics ?? [], maxDiagnostics);
    case "proposeEdits":
      if (stale || m.version !== version) return { kind: "refuseEdits", notice: STALE_PLUGIN_EDIT };
      return { kind: "applyEdits", version, edits: checked.edits ?? [], label: m.label };
    case "commandDone":
      return pending.get(m.requestId)?.kind === "command" ? { kind: "commandDone", requestId: m.requestId } : unrequested(m.type);
    case "failed": {
      const request = pending.get(m.requestId);
      return request ? { kind: "requestFailed", requestId: m.requestId, notice: failedNotice(request, m.message) } : unrequested(m.type);
    }
    case "imported": {
      const request = pending.get(m.requestId);
      if (request?.kind !== "import") return unrequested(m.type);
      if (utf8Bytes(m.text) > MAX_TRANSFER_BYTES) return { kind: "requestFailed", requestId: m.requestId, notice: failedNotice(request, `読み込んだテキストが大きすぎます（上限 ${sizeText(MAX_TRANSFER_BYTES)}）`) };
      return { kind: "imported", requestId: m.requestId, title: request.title, fileName: m.fileName, text: m.text };
    }
    case "exported":
      return decideExported(m, pending.get(m.requestId));
    case "notify":
      return { kind: "notify", level: m.level, message: m.message };
    case "storageGet":
      return { kind: "storageGet", requestId: m.requestId, key: m.key };
    case "storageSet":
      return { kind: "storageSet", requestId: m.requestId, key: m.key, value: m.value };
  }
}

/**
 * 診断を上限の件数までにする。
 *
 * @param version 診断の対象のテキストの版
 * @param items コアが位置を確かめた診断（届いた順）
 * @param max 使う件数の上限
 * @returns 先頭 max 件を使い、捨てた件数を添えた扱い
 * @example
 * cappedDiagnostics(3, [a, b, c], 3) // → { kind: "diagnostics", version: 3, items: [a, b, c], dropped: 0 }（境界値: 上限ちょうど）
 * cappedDiagnostics(3, [a, b, c], 2) // → { kind: "diagnostics", version: 3, items: [a, b], dropped: 1 }
 */
function cappedDiagnostics(version: number, items: PlacedDiagnostic[], max: number): HostAction {
  return { kind: "diagnostics", version, items: items.slice(0, max), dropped: Math.max(0, items.length - max) };
}

/**
 * 書き出しの答え（exported）の扱いを決める。中身が base64 でない・上限より大きいときは、書き出しができなかったものとして知らせる。
 *
 * @param m 届いた答え
 * @param request その依頼の番号で頼んだこと（無ければ undefined）
 * @returns ダウンロードさせる（ファイル名と種類を整えたもの）・できなかったと知らせる・頼んでいないので捨てる
 * @example
 * decideExported({ type: "exported", requestId: 1, fileName: "a", mediaType: "text/csv", base64: "YQ==" }, { kind: "export", title: "表", extension: ".csv" })
 * // → { kind: "exported", requestId: 1, title: "表", fileName: "a.csv", mediaType: "text/csv", base64: "YQ==" }
 * decideExported({ …, base64: "!" }, { kind: "export", … }) // → { kind: "requestFailed", notice: "書き出し「表」を実行できませんでした：書き出されたファイルの中身が正しくありません（base64 ではありません）" }
 * decideExported({ … }, undefined)                         // → { kind: "drop", notice: "依頼していない結果（exported）が届いたため、使いませんでした" }
 */
function decideExported(m: Extract<PluginMessage, { type: "exported" }>, request: PendingRequest | undefined): HostAction {
  if (request?.kind !== "export") return unrequested(m.type);
  const bytes = base64Bytes(m.base64);
  if (bytes === null) return { kind: "requestFailed", requestId: m.requestId, notice: failedNotice(request, "書き出されたファイルの中身が正しくありません（base64 ではありません）") };
  if (bytes > MAX_TRANSFER_BYTES) return { kind: "requestFailed", requestId: m.requestId, notice: failedNotice(request, `書き出されたファイルが大きすぎます（${sizeText(bytes)}。上限 ${sizeText(MAX_TRANSFER_BYTES)}）`) };
  return { kind: "exported", requestId: m.requestId, title: request.title, fileName: exportFileName(m.fileName, request.extension), mediaType: mediaTypeOf(m.mediaType), base64: m.base64 };
}

/**
 * 頼んだことができなかったときの知らせの文（プラグインの一覧に出す。トーストでは頭にプラグインの名前を付ける）。
 *
 * @param request 頼んだこと
 * @param message 理由（プラグインが示したもの、またはホストが確かめた結果）
 * @returns 知らせの文
 * @example
 * failedNotice({ kind: "command", title: "ID を付ける" }, "要求がありません") // → "コマンド「ID を付ける」を実行できませんでした：要求がありません"
 * failedNotice({ kind: "import", title: "ReqIF" }, "形式が違います")        // → "読み込み「ReqIF」を実行できませんでした：形式が違います"
 * failedNotice({ kind: "export", title: "表", extension: ".csv" }, "x")     // → "書き出し「表」を実行できませんでした：x"
 */
export function failedNotice(request: PendingRequest, message: string): string {
  const what = { command: "コマンド", import: "読み込み", export: "書き出し" }[request.kind];
  return `${what}「${request.title}」を実行できませんでした：${message}`;
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
