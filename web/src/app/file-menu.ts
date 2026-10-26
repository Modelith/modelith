// ファイルの一覧の右クリックのメニュー（F-FILE-19）。どの項目を並べるかと、削除を確かめる文を決めるだけの純粋関数。
// メニューを開き、項目の操作を行うのは files.ts。

/** メニューの項目の操作。 */
export type FileMenuAction = "open" | "newFile" | "newFolder" | "rename" | "delete" | "copyPath" | "copyRelative";

/** 右クリックしたもの（ファイル・フォルダ・開いたフォルダそのもの）。 */
export type FileMenuTarget = "file" | "dir" | "root";

/** 項目の並び（null は区切り線）。 */
const ITEMS: Record<FileMenuTarget, readonly (FileMenuAction | null)[]> = {
  file: ["open", null, "rename", "delete", null, "copyPath", "copyRelative"],
  dir: ["newFile", "newFolder", null, "rename", "delete", null, "copyPath", "copyRelative"],
  root: ["newFile", "newFolder", null, "copyPath"],
};

/** 項目の名前。 */
export const FILE_MENU_LABEL: Record<FileMenuAction, string> = {
  open: "開く",
  newFile: "新しいファイル…",
  newFolder: "新しいフォルダー…",
  rename: "名前の変更",
  delete: "削除…",
  copyPath: "パスのコピー",
  copyRelative: "相対パスのコピー",
};

/**
 * 右クリックしたものに出すメニューの項目を、並べる順に返す。開いたフォルダそのものは、名前の変更・削除・相対パスのコピーを出さない。
 *
 * @param target 右クリックしたもの
 * @returns 項目の操作（null は区切り線）
 * @example
 * fileMenuItems("file") // → ["open", null, "rename", "delete", null, "copyPath", "copyRelative"]
 * fileMenuItems("root") // → ["newFile", "newFolder", null, "copyPath"]
 */
export function fileMenuItems(target: FileMenuTarget): readonly (FileMenuAction | null)[] {
  return ITEMS[target];
}

/**
 * 削除を確かめる文（F-FILE-19）。消すものの名前と、元に戻せないこと、一緒に消えるもの・失われる未保存の変更を示す。
 *
 * @param name 消すものの名前
 * @param isDir フォルダなら true
 * @param unsaved 未保存の変更のある、開いているファイルの名前（消すものの中にあるもの）
 * @param layoutName 一緒に消す配置ファイルの名前（モデルのファイルで、配置ファイルがあるとき。無ければ null）
 * @returns ダイアログの本文
 * @example
 * deleteText("a.sysml", false, [], "a.layout.json")
 * // → "「a.sysml」を削除しますか？ 図の配置のファイル（a.layout.json）も削除します。削除したものは元に戻せません。"
 * deleteText("models", true, ["b.sysml"], null)
 * // → "フォルダ「models」を中身ごと削除しますか？ 未保存の変更のある「b.sysml」も閉じ、変更は失われます。削除したものは元に戻せません。"
 */
export function deleteText(name: string, isDir: boolean, unsaved: readonly string[], layoutName: string | null): string {
  const ask = isDir ? `フォルダ「${name}」を中身ごと削除しますか？` : `「${name}」を削除しますか？`;
  const notes: string[] = [];
  if (layoutName) notes.push(`図の配置のファイル（${layoutName}）も削除します。`);
  if (unsaved.length) notes.push(`未保存の変更のある${unsaved.map((n) => `「${n}」`).join("")}も閉じ、変更は失われます。`);
  notes.push("削除したものは元に戻せません。");
  return `${ask} ${notes.join("")}`;
}
