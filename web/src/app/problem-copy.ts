// 問題一覧のコピー（F-EDIT-13）。行を「ファイル名:行: メッセージ」の文にする。判断だけの純粋関数。
// 一覧の行を集めるのは sync.ts、クリップボードに書くのは editor.ts。

/** コピーする問題の 1 行。 */
export interface CopyRow {
  /** ファイル名（フォルダからのパス）。ファイルに属さない行（プラグインについての行）は null。 */
  path: string | null;
  /** 1 から数えた行。テキストの中の位置の無い行は null。 */
  line: number | null;
  /** メッセージ。 */
  text: string;
}

/**
 * 問題の 1 行を、ほかのアプリに貼り付ける文にする（コンパイラの出力と同じ「ファイル名:行: メッセージ」の形）。
 *
 * @param r 問題の行
 * @returns 1 行の文
 * @example
 * problemLine({ path: "app.sysml", line: 12, text: "型「Wheel」が見つかりません（w）" }) // → "app.sysml:12: 型「Wheel」が見つかりません（w）"
 * problemLine({ path: "app.sysml", line: null, text: "…" })                                 // → "app.sysml: …"
 * problemLine({ path: null, line: null, text: "プラグイン「x」がありません" })                // → "プラグイン「x」がありません"
 */
export function problemLine(r: CopyRow): string {
  const where = r.path === null ? "" : r.line === null ? `${r.path}: ` : `${r.path}:${r.line}: `;
  return where + r.text.replace(/\s*\n\s*/g, " ");
}

/**
 * 問題の行を、1 行に 1 件の文にまとめる（「すべてコピー」）。
 *
 * @param rows 問題の行（一覧の順）
 * @returns 改行でつないだ文（行が無ければ ""）
 * @example
 * problemsText([{ path: "a.sysml", line: 1, text: "x" }, { path: "b.sysml", line: 3, text: "y" }]) // → "a.sysml:1: x\nb.sysml:3: y"
 * problemsText([]) // → ""
 */
export const problemsText = (rows: readonly CopyRow[]): string => rows.map(problemLine).join("\n");

/**
 * コピーしたことを知らせる文。
 *
 * @param n コピーした件数
 * @returns トーストの文
 * @example
 * copiedText(1)  // → "問題を 1 件コピーしました"
 * copiedText(12) // → "問題を 12 件コピーしました"
 */
export const copiedText = (n: number): string => `問題を ${n} 件コピーしました`;
