// 他のアプリでのファイルの変更の知らせ（F-FILE-8・F-FILE-18）。知らせる文を決めるだけの純粋関数。
// 変更を確かめるのは Workspace、トーストとダイアログを出すのは files.ts が行う。

/** 知らせに名前を並べるファイルの数の上限（超えた分は「ほか N 件」にまとめる）。 */
export const MAX_NAMES = 3;

/**
 * ファイル名を「」で囲んで並べる。上限を超えた分は「ほか N 件」にまとめる。
 *
 * @param names ファイル名
 * @param max 並べる数の上限
 * @returns 並べた文字列
 * @example
 * nameList(["a.sysml", "b.sysml"])                        // → "「a.sysml」「b.sysml」"
 * nameList(["a.sysml", "b.sysml", "c.sysml", "d.sysml"]) // → "「a.sysml」「b.sysml」「c.sysml」ほか 1 件"
 */
export function nameList(names: readonly string[], max = MAX_NAMES): string {
  const shown = names.slice(0, max).map((n) => `「${n}」`).join("");
  return names.length > max ? `${shown}ほか ${names.length - max} 件` : shown;
}

/**
 * 画面に戻ったときに、他のアプリで変わったファイルをまとめて知らせる文（F-FILE-8）。表示中のファイルに限らず、開いているファイルすべてが対象。
 *
 * @param reloaded 読み直したファイルの名前（未保存の変更が無かったもの）
 * @param stale 今回初めて印を付けたファイルの名前（未保存の変更があり、読み直していないもの）
 * @returns 知らせる文。どちらも無ければ null
 * @example
 * externalNotice(["a.sysml"], [])  // → "他のアプリで変更された「a.sysml」を読み直しました"
 * externalNotice([], ["b.sysml"])  // → "「b.sysml」は他のアプリで変更されています。未保存の変更があるため読み直していません。保存するときに選べます"
 * externalNotice([], [])           // → null
 */
export function externalNotice(reloaded: readonly string[], stale: readonly string[]): string | null {
  const parts: string[] = [];
  if (reloaded.length) parts.push(`他のアプリで変更された${nameList(reloaded)}を読み直しました`);
  if (stale.length) parts.push(`${nameList(stale)}は他のアプリで変更されています。未保存の変更があるため読み直していません。保存するときに選べます`);
  return parts.length ? parts.join("。") : null;
}

/**
 * 編集し始めたファイルが他のアプリで変わっていたときに、どうするかを尋ねる文（F-FILE-18）。
 *
 * @param name ファイル名
 * @returns ダイアログの本文
 * @example
 * editStartText("a.sysml")
 * // → "「a.sysml」は開いた後に他のアプリで変更されています。ファイルの内容を読み込みますか？ 読み込むと、いま入力した変更は消えます。このまま編集すると、保存するときに上書きするかを選べます。"
 */
export function editStartText(name: string): string {
  return `「${name}」は開いた後に他のアプリで変更されています。ファイルの内容を読み込みますか？ 読み込むと、いま入力した変更は消えます。このまま編集すると、保存するときに上書きするかを選べます。`;
}
