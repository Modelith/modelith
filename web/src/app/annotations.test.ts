// インスペクタのメモと別の言語での表し方（comment・rep、8.2.2.4）。
import { describe, expect, it } from "vitest";
import { parse } from "../core/rust";
import { annotationsHtml, notesOf } from "./annotations";

/** 名前で宣言を探す。 */
const named = (text: string, name: string) => {
  const P = parse(text);
  const e = P.entries.find((x) => x.name === name);
  if (!e) throw new Error(`${name} がありません`);
  return { e, entries: P.entries };
};

describe("notesOf（要素を注釈するメモ）", () => {
  it("about の相手と、about の無いメモの持ち主を、書いた順に集める", () => {
    // Arrange
    const { e, entries } = named("package P { part def A { comment /* 1 */ } part def B; comment about A, B /* 2 */ }", "A");
    // Act
    const bodies = notesOf(e, entries).map((c) => c.body);
    // Assert
    expect(bodies).toEqual(["1", "2"]);
  });

  it("メモの無い要素では空（キーワードの無い /* */ はメモにしない）", () => {
    // Arrange
    const { e, entries } = named("package P { part def A { /* 注記 */ } }", "A");
    // Act
    const notes = notesOf(e, entries);
    // Assert
    expect(notes).toEqual([]);
  });
});

describe("annotationsHtml（インスペクタのメモと表し方）", () => {
  it("メモの名前と本文、表し方の言語・名前・本文を出し、文字を逃がす", () => {
    // Arrange
    const { e, entries } = named('package P { part def A { comment c /* 安全 <必須> */ rep inOCL language "OCL" /* self.m > 0 */ } }', "A");
    // Act
    const html = annotationsHtml(e, entries);
    // Assert
    expect(html).toBe(
      '<div class="notes"><div class="note"><small>メモ c</small><p>安全 &lt;必須&gt;</p></div>' +
        '<div class="note"><small>別の言語での表し方（OCL）・inOCL</small><pre>self.m &gt; 0</pre></div></div>',
    );
  });

  it("どちらも無ければ空文字列（境界）", () => {
    // Arrange
    const { e, entries } = named("package P { part def A; }", "A");
    // Act
    const html = annotationsHtml(e, entries);
    // Assert
    expect(html).toBe("");
  });
});
