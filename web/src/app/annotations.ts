// 要素に付けたメモ（comment、8.2.2.4）と、別の言語での表し方（rep、TextualRepresentation、8.2.2.4）を、インスペクタに出す形にする。

import type { Entry } from "../core";
import { esc } from "./dom";

/**
 * 要素を注釈するメモ（種類 `comment` の宣言）を、書いた順に集める。
 *
 * @param e 注釈される要素
 * @param entries 解析結果の宣言すべて
 * @returns `about` に e を含むメモ（`about` の無いメモは持ち主）。無ければ空
 * @example
 * // "part def A { comment /* 1 *\/ } comment about A /* 2 *\/" のとき
 * notesOf(A, entries).map((c) => c.body) // → ["1", "2"]
 * notesOf(B, entries)                    // → []（B を注釈するメモが無い）
 */
export function notesOf(e: Entry, entries: readonly Entry[]): Entry[] {
  return entries.filter((c) => c.kind === "comment" && !!c.about?.includes(e));
}

/**
 * インスペクタに出す、要素のメモと別の言語での表し方の HTML を作る。本文の改行はそのまま見せる。
 *
 * @param e 選んだ要素
 * @param entries 解析結果の宣言すべて（メモを探す）
 * @returns `<div class="notes">…</div>`。メモも表し方も無ければ空文字列
 * @example
 * // A に名前の無いメモ「安全のため」と、OCL の表し方 inOCL「self.m > 0」がある
 * annotationsHtml(A, entries)
 * // → '<div class="notes"><div class="note"><small>メモ</small><p>安全のため</p></div>' +
 * //   '<div class="note"><small>別の言語での表し方（OCL）・inOCL</small><pre>self.m &gt; 0</pre></div></div>'
 * annotationsHtml(B, entries) // → ""（どちらも無い）
 */
export function annotationsHtml(e: Entry, entries: readonly Entry[]): string {
  const notes = notesOf(e, entries).map((c) => `<div class="note"><small>メモ${c.name ? " " + esc(c.name) : ""}</small><p>${esc(c.body ?? "")}</p></div>`);
  const reps = (e.reps ?? []).map(
    (r) => `<div class="note"><small>別の言語での表し方（${esc(r.language)}）${r.name ? "・" + esc(r.name) : ""}</small><pre>${esc(r.body)}</pre></div>`,
  );
  const items = [...notes, ...reps];
  return items.length ? `<div class="notes">${items.join("")}</div>` : "";
}
