// ブラウザが返したエラーを、利用者に見せる日本語の文にする（Q-4・Q-6）。
// ブラウザのエラー（DOMException）の message は英語で、次の操作も分からないので、name ごとに決めた文に置き換える。
// 元の英語の内容は、呼び出す側がブラウザのコンソールに残す。

/** 分からないエラーのときに見せる文。 */
export const UNKNOWN_ERROR_TEXT = "予期しない問題が起きました。もう一度試してください";

/** ファイルを書き換えられないときの文（他のアプリが使っている・書き換えられない状態）。 */
const IN_USE = "ファイルが他のアプリで使われているか、書き換えられない状態です。他のアプリを閉じてから、もう一度試してください";

/** ブラウザのエラーの名前（DOMException の name）ごとの文。何が起きたかと、次の操作を書く。 */
const BROWSER_ERROR_TEXT: ReadonlyMap<string, string> = new Map([
  ["NotAllowedError", "フォルダやファイルを編集する許可がありません。もう一度開いて、ブラウザの確認で許可してください"],
  ["NotFoundError", "ファイルが見つかりません。移動したか、削除された可能性があります"],
  ["QuotaExceededError", "保存する場所の空きが足りません。空きを作ってから、もう一度試してください"],
  ["TypeMismatchError", "ファイルとフォルダの種類が合いません。同じ名前のファイルやフォルダが無いか確かめてください"],
  ["AbortError", "操作が取り消されました"],
  ["NoModificationAllowedError", IN_USE],
  ["InvalidStateError", IN_USE],
  ["NotReadableError", "ファイルを読み込めません。他のアプリで使われていないか確かめて、もう一度試してください"],
]);

/** JavaScript に組み込みの Error の名前。プログラムの誤りやブラウザの API の断りで、message は英語なので見せない。 */
const BUILT_IN_ERROR_NAMES = new Set(["TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError"]);

/**
 * 投げられた値から、利用者に見せる理由の文を作る。ブラウザのエラーは name ごとの日本語の文にし、
 * Modelith が投げた Error（日本語のメッセージ。ConflictError など）はメッセージをそのまま使う。分からないものは一般的な文にする。
 *
 * @param e 投げられた値（DOMException・Error・それ以外の値）
 * @returns 日本語の理由の文（句点なし。トーストの「〜できませんでした：」の後ろに置く）
 * @example
 * errorText(new DOMException("The request is not allowed by the user agent", "NotAllowedError"))
 *   // → "フォルダやファイルを編集する許可がありません。もう一度開いて、ブラウザの確認で許可してください"
 * errorText(new Error("フォルダが開かれていません"))       // → "フォルダが開かれていません"（Modelith のエラー）
 * errorText(new DOMException("x", "DataCloneError"))       // → UNKNOWN_ERROR_TEXT（知らない名前）
 * errorText(new TypeError("x is not a function"))          // → UNKNOWN_ERROR_TEXT
 * errorText("disk full")                                   // → UNKNOWN_ERROR_TEXT（Error でない値）
 */
export function errorText(e: unknown): string {
  if (!(e instanceof Error)) return UNKNOWN_ERROR_TEXT;
  const known = BROWSER_ERROR_TEXT.get(e.name);
  if (known) return known;
  if (e instanceof DOMException || BUILT_IN_ERROR_NAMES.has(e.name) || !e.message) return UNKNOWN_ERROR_TEXT;
  return e.message;
}
