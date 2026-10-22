// プロジェクト（開いているフォルダ）のモデルのファイルを、1 つのモデルとしてコアに渡すための計算（ADR-0021 §1・§3）。
// 読み書きはワークスペースが行い、ここでは何を渡すか・何が変わったかだけを決める。

import type { DirEntry, FileRef } from "../files/types";

/** プロジェクトのほかのファイル 1 つ（フォルダからのパスとテキスト）。 */
export interface FileText {
  path: string;
  text: string;
}

/**
 * フォルダの中のモデルのファイル（`.sysml`・`.kerml`）を、入れ子まで並べる。
 *
 * @param entries フォルダの中身
 * @returns モデルのファイルの参照（フォルダの中身の順）
 * @example
 * modelFiles([{ kind: "file", ref: a }, { kind: "dir", …, children: [{ kind: "file", ref: b }] }, { kind: "file", ref: notes_md }])
 * // → [a, b]（a.sysml・models/b.kerml。notes.md は入れない）
 */
export function modelFiles(entries: readonly DirEntry[]): FileRef[] {
  const out: FileRef[] = [];
  for (const e of entries) {
    if (e.kind === "dir") out.push(...modelFiles(e.children));
    else if (/\.(sysml|kerml)$/i.test(e.ref.name)) out.push(e.ref);
  }
  return out;
}

/**
 * コアに渡すプロジェクトのファイルのテキストを決める。開いている文書は、保存していない変更も含めた今のテキストを使う。
 *
 * @param files フォルダの中のモデルのファイル
 * @param disk ファイルごとの、最後に読んだテキスト（パス → テキスト。読めなかったファイルは無い）
 * @param docs 開いている文書（参照と今のテキスト）
 * @returns パス → テキスト（`files` の順）
 * @example
 * projectTexts([a, b], new Map([["a.sysml", "A0"], ["b.sysml", "B0"]]), [{ ref: a, text: "A1" }])
 * // → Map { "a.sysml" → "A1", "b.sysml" → "B0" }
 */
export function projectTexts(files: readonly FileRef[], disk: ReadonlyMap<string, string>, docs: readonly { ref: FileRef | null; text: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const ref of files) {
    const doc = docs.find((d) => d.ref?.provider === ref.provider && d.ref.id === ref.id);
    const text = doc ? doc.text : disk.get(ref.path);
    if (text !== undefined) out.set(ref.path, text);
  }
  return out;
}

/**
 * 前に渡したファイルと今のファイルを比べ、コアに送る変更を作る。
 *
 * @param prev 前に渡したファイル（パス → テキスト）
 * @param next 今のファイル（パス → テキスト）
 * @returns 覚え直すファイル（新しい・中身が変わった）と、忘れるパス（無くなった）
 * @example
 * filesChange(new Map([["a", "1"], ["b", "2"]]), new Map([["a", "1"], ["b", "3"], ["c", "4"]]))
 * // → { set: [{ path: "b", text: "3" }, { path: "c", text: "4" }], remove: [] }
 * filesChange(new Map([["a", "1"]]), new Map()) // → { set: [], remove: ["a"] }
 */
export function filesChange(prev: ReadonlyMap<string, string>, next: ReadonlyMap<string, string>): { set: FileText[]; remove: string[] } {
  const set = [...next].filter(([path, text]) => prev.get(path) !== text).map(([path, text]) => ({ path, text }));
  const remove = [...prev.keys()].filter((path) => !next.has(path));
  return { set, remove };
}
