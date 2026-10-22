// プロジェクトのほかのファイルの要素への案内（ADR-0021 §5）。図から書き換えられるのは表示中のファイルの要素だけなので、
// ほかのファイルの要素を書き換えようとしたら、どのファイルにあるかを知らせ、そのファイルを開けるようにする。

import { ask } from "./dialog";

let opener: (path: string) => void = () => {};

/**
 * プロジェクトのファイルをパスで開く処理を登録する（ファイルの画面が登録する）。前に登録した処理は置き換える。
 *
 * @param fn フォルダからのパスを受け取り、そのファイルを開いて表示する処理
 */
export function onOpenProjectFile(fn: (path: string) => void): void {
  opener = fn;
}

/**
 * プロジェクトのファイルをパスで開く（登録した処理に任せる）。
 *
 * @param path フォルダからのパス
 * @example
 * openProjectFile("parts.sysml") // → parts.sysml を開いて表示する
 */
export function openProjectFile(path: string): void {
  opener(path);
}

/**
 * ほかのファイルの要素は書き換えられないことを知らせ、そのファイルを開くかを尋ねる。開くを選べば開く。
 *
 * @param path 要素のあるファイル（フォルダからのパス）
 * @returns 尋ね終えたら解決する Promise
 * @example
 * await guideToFile("parts.sysml") // → 「この要素は「parts.sysml」にあります。…」を出し、「そのファイルを開く」で開く
 */
export async function guideToFile(path: string): Promise<void> {
  const r = await ask("ほかのファイルの要素です", otherFileText(path), [
    { id: "close", label: "閉じる" },
    { id: "open", label: "そのファイルを開く", kind: "primary" },
  ]);
  if (r?.id === "open") openProjectFile(path);
}

/**
 * ほかのファイルの要素を書き換えられないことの案内の文（ADR-0014 の言葉）。
 *
 * @param path 要素のあるファイル（フォルダからのパス）
 * @returns 案内の文
 * @example
 * otherFileText("parts.sysml")
 * // → "この要素は「parts.sysml」にあります。図から書き換えられるのは、表示中のファイルの要素だけです。そのファイルを開いて編集してください。"
 */
export const otherFileText = (path: string): string =>
  `この要素は「${path}」にあります。図から書き換えられるのは、表示中のファイルの要素だけです。そのファイルを開いて編集してください。`;
