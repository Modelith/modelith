// テキストの位置を数え、コアが返した編集を当てる小さな純粋関数（ADR-0001）。
// どう書き換えるかは Rust のコアが決める（ADR-0016）。ここでは、返ってきた編集を当てることと、
// 画面が使う行の位置・差分の範囲・古い形式の配置コメント（ADR-0005）の読み書きだけを扱う。
// 位置はすべて UTF-16。

import type { ParseError } from "./types";

/** 配置情報を埋め込むコメント（ADR-0005 の移行期の形式）。 */
const LAYOUT_RE = /\/\*\s*@layout\s*([\s\S]*?)\*\//;

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
 * コアが返したテキストの編集（UTF-16 の [start, end) の置き換え）を当てる。
 *
 * @param text 元のテキスト
 * @param edits コアが返した編集の列（位置は元のテキストの UTF-16。互いに重ならないこと）
 * @returns 編集を当てた後のテキスト
 * @example
 * applyTextEdits("package P { part def A; }", [{ start: 21, end: 22, text: "B" }]) // → "package P { part def B; }"
 * applyTextEdits("abcde", [{ start: 4, end: 5, text: "EE" }, { start: 0, end: 1, text: "A" }]) // → "AbcdEE"（順は問わない）
 * applyTextEdits("abc", [])                                                     // → "abc"（0 件）
 */
export function applyTextEdits(text: string, edits: readonly { start: number; end: number; text: string }[]): string {
  let t = text;
  // 後ろから当てるので、前の編集の位置はずれない
  for (const e of [...edits].sort((a, b) => b.start - a.start)) t = t.slice(0, e.start) + e.text + t.slice(e.end);
  return t;
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

/**
 * `/* @layout {…} *\/` コメントの中身を読む（ADR-0005 の移行期の形式）。
 *
 * @param text SysML v2 のテキスト全文
 * @param errors 読めなかったときに誤りを書き足す先（書き換える）
 * @returns 配置情報の JSON。コメントが無ければ空のオブジェクト。JSON が読めなければ errors に足して空のオブジェクト
 * @example
 * readLayout('/* @layout {"A":{"x":1}} *\/', errors) // → { A: { x: 1 } }
 * readLayout("/* @layout {x *\/", errors)            // → {}（errors に「@layout コメントを読み込めません」）
 * readLayout("package P;", errors)                  // → {}
 */
export function readLayout(text: string, errors: ParseError[]): Record<string, unknown> {
  const lm = text.match(LAYOUT_RE);
  if (!lm) return {};
  try {
    return JSON.parse(lm[1]!) as Record<string, unknown>;
  } catch {
    errors.push({ pos: lm.index ?? 0, msg: "@layout コメントを読み込めません" });
    return {};
  }
}
