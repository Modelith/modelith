// テキストを書き換える純粋関数（暫定コア、ADR-0009）。図の操作はすべてここを通してテキストの編集になる（ADR-0001）。

import { LAYOUT_RE } from "./parser";

/** 1 つの編集。`at` から `del` 文字を消して `ins` を入れる。 */
export interface Edit {
  at: number;
  del: number;
  ins: string;
}

/** 子を挿入できる宣言の位置（`close` があればブロック、なければ `;` で終わる宣言）。 */
export interface InsertTarget {
  start: number;
  headEnd: number;
  close?: number;
}

/** pos を含む行の先頭位置。 */
export const lineStart = (t: string, p: number): number => t.lastIndexOf("\n", p - 1) + 1;

/** pos を含む行の字下げ。 */
export const indentAt = (t: string, p: number): string => /^[ \t]*/.exec(t.slice(lineStart(t, p)))?.[0] ?? "";

/** 1 始まりの行番号。 */
export const lineOf = (t: string, p: number): number => t.slice(0, p).split("\n").length;

/** 重ならない編集をまとめて適用する（後ろから順に適用するので位置はずれない）。 */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  let t = text;
  for (const e of [...edits].sort((a, b) => b.at - a.at)) t = t.slice(0, e.at) + e.ins + t.slice(e.at + e.del);
  return t;
}

/**
 * 宣言の中に 1 行を足す編集。ブロックなら閉じ括弧の前に、`;` で終わる宣言ならブロックに書き換えて入れる。
 */
export function insertEdit(text: string, target: InsertTarget, snippet: string): Edit {
  if (target.close != null) {
    const ind = indentAt(text, target.start) + "    ";
    const ls = lineStart(text, target.close);
    if (text.slice(ls, target.close).trim() === "") return { at: ls, del: 0, ins: ind + snippet + "\n" };
    return { at: target.close, del: 0, ins: (/\s/.test(text[target.close - 1] ?? "") ? "" : " ") + snippet + " " };
  }
  const ind = indentAt(text, target.start);
  return { at: target.headEnd, del: 1, ins: ` {\n${ind}    ${snippet}\n${ind}}` };
}

/** {@link insertEdit} を適用した結果と、挿入した位置・長さ。 */
export function insertInto(text: string, target: InsertTarget, snippet: string): { text: string; at: number; len: number } {
  const e = insertEdit(text, target, snippet);
  return { text: applyEdits(text, [e]), at: e.at, len: e.ins.length };
}

/** 範囲を消す。範囲が行全体を占めるなら行ごと消す。 */
export function removeRange(text: string, start: number, end: number): { text: string; at: number } {
  let a = start;
  let b = end;
  const ls = lineStart(text, a);
  let le = text.indexOf("\n", b);
  if (le < 0) le = text.length;
  if (text.slice(ls, a).trim() === "" && text.slice(b, le).trim() === "") {
    a = ls;
    b = Math.min(text.length, le + 1);
  } else {
    while (text[b] === " ") b++;
  }
  return { text: text.slice(0, a) + text.slice(b), at: a };
}

/** 配置情報を `@layout` コメントとして書き込む（無ければ末尾に足す）。空のビューは書かない。 */
export function writeLayout(text: string, layout: Record<string, Record<string, unknown>>): string {
  const json =
    "{\n" +
    Object.entries(layout)
      .filter(([, v]) => Object.keys(v).length)
      .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
      .join(",\n") +
    "\n}";
  const block = `/* @layout ${json} */`;
  const m = LAYOUT_RE.exec(text);
  if (m) return text.slice(0, m.index) + block + text.slice(m.index + m[0].length);
  return text.replace(/\s*$/, "") + "\n\n" + block + "\n";
}

/** 2 つのテキストの差分がある範囲（新しいテキスト上の [開始, 終了)）。 */
export function diffRange(a: string, b: string): [number, number] {
  let p = 0;
  const m = Math.min(a.length, b.length);
  while (p < m && a[p] === b[p]) p++;
  let s = 0;
  while (s < m - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return [p, Math.max(p, b.length - s)];
}
