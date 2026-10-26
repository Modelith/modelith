// フォルダの中のファイルとフォルダの名前とパスの決まり（F-FILE-19）。名前の変更・新しいファイル・新しいフォルダーで使う、判断だけの純粋関数。

import { isModelFile } from "./types";

/** ファイルやフォルダの名前に使えない文字（Windows でも開けるように、Windows で使えない文字も除く）。 */
const BAD_CHARS = /[\\/:*?"<>|]/;

/**
 * ファイルやフォルダの名前として使えるかを確かめる。
 *
 * @param name 付けようとしている名前
 * @param siblings 同じ場所にあるほかのファイルとフォルダの名前（自分の今の名前は除いて渡す）
 * @param opts `model: true` なら、モデルのファイル（.sysml・.kerml）の名前でなければ使えないとする
 * @returns 使えなければ、その理由（画面に出す文）。使えれば null
 * @example
 * nameProblem("b.sysml", ["a.sysml"], { model: true }) // → null
 * nameProblem("", [])                                  // → "名前を入力してください"
 * nameProblem("a/b", [])                               // → "名前に \ / : * ? \" < > | は使えません"
 * nameProblem("A.sysml", ["a.sysml"])                  // → "同じ場所に「a.sysml」があります"（大文字と小文字は区別しない）
 * nameProblem("a.txt", [], { model: true })            // → "モデルのファイルの名前は「.sysml」か「.kerml」で終わるようにしてください"
 */
export function nameProblem(name: string, siblings: readonly string[], opts: { model?: boolean } = {}): string | null {
  const n = name.trim();
  if (!n) return "名前を入力してください";
  if (BAD_CHARS.test(n)) return '名前に \\ / : * ? " < > | は使えません';
  if (n === "." || n === ".." || n.endsWith(".")) return "名前の終わりに「.」は使えません";
  const same = siblings.find((s) => s.toLowerCase() === n.toLowerCase());
  if (same !== undefined) return `同じ場所に「${same}」があります`;
  if (opts.model && !isModelFile(n)) return "モデルのファイルの名前は「.sysml」か「.kerml」で終わるようにしてください";
  return null;
}

/**
 * パスの親のフォルダのパスを返す。
 *
 * @param path フォルダからの相対パス（`/` 区切り）
 * @returns 親のフォルダのパス。一番上なら ""
 * @example
 * parentPath("models/a.sysml") // → "models"
 * parentPath("a.sysml")        // → ""
 */
export function parentPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/**
 * フォルダの中にある名前のパスを作る。
 *
 * @param dir フォルダのパス（一番上なら ""）
 * @param name ファイルかフォルダの名前
 * @returns フォルダからの相対パス
 * @example
 * childPath("models", "a.sysml") // → "models/a.sysml"
 * childPath("", "a.sysml")       // → "a.sysml"
 */
export function childPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/**
 * ファイルかフォルダを動かしたとき（名前の変更）、その中にあったパスの新しいパスを返す。
 *
 * @param path 調べるパス
 * @param from 動かしたもののパス
 * @param to 動かした先のパス
 * @returns 新しいパス。path が from そのものでも、その中でもなければ null
 * @example
 * movedPath("models/a.sysml", "models", "parts") // → "parts/a.sysml"
 * movedPath("a.sysml", "a.sysml", "b.sysml")      // → "b.sysml"
 * movedPath("models2/a.sysml", "models", "parts") // → null（名前が「models」で始まるだけの別のフォルダ）
 */
export function movedPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : null;
}

/**
 * 「パスのコピー」で入れるパス。ブラウザはパソコンの中のフォルダの場所を教えないので、開いたフォルダの名前から始める（F-FILE-19）。
 *
 * @param folderName 開いたフォルダの名前
 * @param path フォルダからの相対パス（フォルダそのものなら ""）
 * @returns 開いたフォルダの名前から始まるパス
 * @example
 * pathFromFolder("project", "models/a.sysml") // → "project/models/a.sysml"
 * pathFromFolder("project", "")               // → "project"
 */
export function pathFromFolder(folderName: string, path: string): string {
  return path ? `${folderName}/${path}` : folderName;
}

/**
 * 名前を書き換え始めるときに選んでおく範囲（拡張子の前まで。フォルダや拡張子の無い名前は全体）。
 *
 * @param name 今の名前
 * @param isFile ファイルなら true
 * @returns 選ぶ範囲の終わりの位置（始まりは 0）
 * @example
 * renameSelectionEnd("app.sysml", true) // → 3
 * renameSelectionEnd("models", false)   // → 6
 * renameSelectionEnd(".hidden", true)   // → 7（先頭の「.」だけなら拡張子とみなさない）
 */
export function renameSelectionEnd(name: string, isFile: boolean): number {
  const dot = name.lastIndexOf(".");
  return isFile && dot > 0 ? dot : name.length;
}
