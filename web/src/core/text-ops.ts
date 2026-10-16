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

/**
 * 位置 p を含む行の先頭の位置。
 *
 * @param t テキスト
 * @param p 位置（UTF-16。0 始まり）
 * @returns 行の先頭の位置（UTF-16）。1 行目なら 0
 * @example
 * lineStart("ab\ncd", 4) // → 3
 * lineStart("ab\ncd", 0) // → 0（先頭行）
 */
export const lineStart = (t: string, p: number): number => t.lastIndexOf("\n", p - 1) + 1;

/**
 * 位置 p を含む行の字下げ（行頭の空白とタブ）。
 *
 * @param t テキスト
 * @param p 位置（UTF-16。0 始まり）
 * @returns 字下げの文字列。字下げが無ければ空文字列
 * @example
 * indentAt("x\n \t  y", 5) // → " \t  "
 * indentAt("x", 0)          // → ""
 */
export const indentAt = (t: string, p: number): string => /^[ \t]*/.exec(t.slice(lineStart(t, p)))?.[0] ?? "";

/**
 * 位置 p がある行の番号（1 始まり）。
 *
 * @param t テキスト
 * @param p 位置（UTF-16。0 始まり）
 * @returns 行の番号（1 始まり）
 * @example
 * lineOf("ab\ncd", 4) // → 2
 * lineOf("ab\ncd", 0) // → 1（先頭）
 */
export const lineOf = (t: string, p: number): number => t.slice(0, p).split("\n").length;

/**
 * 重ならない編集をまとめて適用する（後ろから順に適用するので位置はずれない）。
 *
 * @param text 元のテキスト
 * @param edits 編集の列（位置は元のテキストの UTF-16。順は問わない。互いに重ならないこと）
 * @returns 編集を当てた後のテキスト
 * @example
 * applyEdits("abcde", [{ at: 0, del: 1, ins: "A" }, { at: 4, del: 1, ins: "EE" }]) // → "AbcdEE"
 * applyEdits("abc", [])                                                       // → "abc"（0 件）
 */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  let t = text;
  for (const e of [...edits].sort((a, b) => b.at - a.at)) t = t.slice(0, e.at) + e.ins + t.slice(e.at + e.del);
  return t;
}

/**
 * コアが返したテキストの編集（UTF-16 の [start, end) の置き換え）を当てる。
 *
 * @param text 元のテキスト
 * @param edits コアが返した編集の列（位置は元のテキストの UTF-16。互いに重ならないこと）
 * @returns 編集を当てた後のテキスト
 * @example
 * applyTextEdits("package P { part def A; }", [{ start: 21, end: 22, text: "B" }]) // → "package P { part def B; }"
 * applyTextEdits("abc", [])                                                     // → "abc"（0 件）
 */
export function applyTextEdits(text: string, edits: readonly { start: number; end: number; text: string }[]): string {
  return applyEdits(text, edits.map((e) => ({ at: e.start, del: e.end - e.start, ins: e.text })));
}

/**
 * 宣言の中に 1 行を足す編集を作る（テキストはまだ変えない）。
 * ブロックなら閉じ括弧の前に、`;` で終わる宣言ならブロックに書き換えて入れる。
 *
 * @param text 元のテキスト
 * @param target 足す先の宣言（位置は UTF-16。`close` があればブロックの閉じ括弧の位置）
 * @param snippet 足す 1 行（字下げと改行は付けない。`part b : B;` など）
 * @returns 1 つの編集
 * @example
 * insertEdit("part def A {}", { start: 0, headEnd: 11, close: 12 }, "part b : B;")
 * // → { at: 12, del: 0, ins: " part b : B; " }（同じ行の閉じ括弧の前）
 * insertEdit("  part def A;", { start: 2, headEnd: 12 }, "part b : B;")
 * // → { at: 12, del: 1, ins: " {\n      part b : B;\n  }" }（; をブロックに書き換える）
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

/**
 * {@link insertEdit} を適用した結果と、挿入した位置・長さを返す。
 *
 * @param text 元のテキスト
 * @param target 足す先の宣言（位置は UTF-16）
 * @param snippet 足す 1 行（字下げと改行は付けない）
 * @returns 編集後のテキストと、挿入した位置（UTF-16）・長さ
 * @example
 * insertInto("part def A {}", { start: 0, headEnd: 11, close: 12 }, "part b : B;")
 * // → { text: "part def A { part b : B; }", at: 12, len: 13 }
 * insertInto("part def A {\n}\n", { start: 0, headEnd: 11, close: 13 }, "part b : B;").text
 * // → "part def A {\n    part b : B;\n}\n"（閉じ括弧だけの行の前に足す）
 */
export function insertInto(text: string, target: InsertTarget, snippet: string): { text: string; at: number; len: number } {
  const e = insertEdit(text, target, snippet);
  return { text: applyEdits(text, [e]), at: e.at, len: e.ins.length };
}

/**
 * 範囲を消す。範囲が行全体を占めるなら行ごと（改行まで）消し、行の一部なら後ろの空白も詰める。
 *
 * @param text 元のテキスト
 * @param start 消す範囲の始まり（UTF-16 の位置）
 * @param end 消す範囲の終わり（UTF-16 の位置。含まない）
 * @returns 消した後のテキストと、消した位置
 * @example
 * removeRange("a;\n  b;\nc;", 5, 7) // → { text: "a;\nc;", at: 3 }（行ごと）
 * removeRange("a; b; c;", 3, 5)     // → { text: "a; c;", at: 3 }（行の一部）
 * removeRange("a;\nb;", 3, 5)       // → { text: "a;\n", at: 3 }（改行の無い末尾の行）
 */
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

/**
 * 古い形式の配置（`@layout` コメント）をテキストから消す（ADR-0005 の移行）。無ければそのまま返す。
 * コメントだけの行は行ごと消し、末尾にあったときは後ろに残る空行もまとめる。
 *
 * @param text 元のテキスト
 * @returns コメントを消したテキスト。コメントが無ければ text のまま。コメントしか無ければ空文字列
 * @example
 * // text が「x」の行・@layout コメントだけの行・「y」の行のとき
 * removeLayoutComment(text)                   // → "x\ny\n"
 * removeLayoutComment("package P;\n")         // → "package P;\n"（コメントが無い）
 */
export function removeLayoutComment(text: string): string {
  const m = LAYOUT_RE.exec(text);
  if (!m) return text;
  const end = m.index + m[0].length;
  const { text: t } = removeRange(text, m.index, end);
  if (!t.trim()) return "";
  return end >= text.trimEnd().length ? t.replace(/\s*$/, "\n") : t;
}

/**
 * 2 つのテキストの差分がある範囲を、共通の先頭と末尾を除いて求める。
 *
 * @param a 古いテキスト
 * @param b 新しいテキスト
 * @returns 新しいテキスト上の [開始, 終了)（UTF-16 の位置）。差分が無い・削除だけのときは開始と終了が同じ
 * @example
 * diffRange("abcd", "abXYcd") // → [2, 4]（挿入）
 * diffRange("abc", "abc")     // → [3, 3]（差分なし）
 * diffRange("abXcd", "abcd")  // → [2, 2]（削除）
 */
export function diffRange(a: string, b: string): [number, number] {
  let p = 0;
  const m = Math.min(a.length, b.length);
  while (p < m && a[p] === b[p]) p++;
  let s = 0;
  while (s < m - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return [p, Math.max(p, b.length - s)];
}
