// 線の記法（8.2.3）。図の種類ごとの破線と矢印。
import { describe, expect, it } from "vitest";
import { build, parse } from "../core/rust";
import { emptyView } from "./layout";
import { withNotes } from "./notes";
import { CV, edgeStroke, kindIcon, svgMarkup } from "./svg";

describe("edgeStroke（8.2.3 の線の記法）", () => {
  it.each([
    ["specialize", ' marker-end="url(#mTri)"'],
    ["subset", ' marker-end="url(#mTri)"'],
    ["redefine", ' marker-end="url(#mRedef)"'],
    ["reference", ' marker-end="url(#mRef)"'],
  ])("%s は実線で、白抜きの三角の矢印を付ける", (kind, expected) => {
    // Act
    const attrs = edgeStroke(kind);
    // Assert
    expect(attrs).toBe(expected);
  });

  it("満たす関係は、これまでどおり破線と開いた矢印", () => {
    // Act
    const attrs = edgeStroke("satisfy");
    // Assert
    expect(attrs).toBe(' stroke-dasharray="6 4" marker-end="url(#mOpen)"');
  });

  it("依存は破線で、供給する側に開いた矢印を付ける（8.2.3.3）", () => {
    // Act
    const attrs = edgeStroke("dependency");
    // Assert
    expect(attrs).toBe(' stroke-dasharray="6 4" marker-end="url(#mOpen)"');
  });

  it("割り当ては破線で、割り当て先に開いた矢印を付ける（8.2.3.15 の allocate-relationship）", () => {
    // Act
    const attrs = edgeStroke("allocate");
    // Assert
    expect(attrs).toBe(' stroke-dasharray="6 4" marker-end="url(#mOpen)"');
  });

  it("部品として持つ線は、始まりの端にひし形を付ける", () => {
    // Act
    const attrs = edgeStroke("comp");
    // Assert
    expect(attrs).toBe(' marker-start="url(#mDiamond)"');
  });

  it.each([["bind"], ["connect"]])("結び付けと n 項の接続の線（%s）は、矢印の無い実線にする（8.2.3.13 の binding-connection・n-ary-segment）", (kind) => {
    // Act
    const attrs = edgeStroke(kind);
    // Assert
    expect(attrs).toBe("");
  });

  it("知らない種類は、開いた矢印にする（境界）", () => {
    // Act
    const attrs = edgeStroke("bogus");
    // Assert
    expect(attrs).toBe(' marker-end="url(#mOpen)"');
  });
});

describe("メモ（8.2.3.4 の comment と annotation-link）", () => {
  it("メモから要素への線は、矢印の無い破線にする", () => {
    // Act
    const attrs = edgeStroke("annotate");
    // Assert
    expect(attrs).toBe(' stroke-dasharray="6 4"');
  });

  it("メモは角を折った四角に本文を書き、名前があれば «comment» と名前を書く", () => {
    // Arrange
    const M = build(parse("package P { part def A; comment c about A /* 安全のため */ }"));
    const content = withNotes(M.notes, { nodes: M.nodes, edges: [] });
    const L = emptyView();
    L.pos = { A: [0, 0], "note:c": [300, 0] };
    // Act
    const { ns } = svgMarkup(CV, content, L, { view: "all" });
    // Assert
    const note = ns.slice(ns.indexOf('<g class="node note"'));
    expect(note).toContain('data-key="note:c" transform="translate(300,0)"');
    expect(note).toContain('<path class="body" d="M0,0 H212 L224,12 V51 H0 Z"');
    expect(note).toContain("«comment» <tspan");
    expect(note).toContain(">安全のため</text>");
    expect(note).not.toContain('class="pin"');
  });
});

describe("kindIcon の色（種類の系統）", () => {
  it.each([
    ["requirement def", "req"],
    ["concern", "concern"],
    ["verification def", "ver"],
    ["analysis", "ver"],
    ["constraint def", "con"],
    ["calc", "con"],
    ["state def", "beh"],
    ["use case", "beh"],
    ["part", "part"],
    ["port def", "other"],
  ])("%s は %s の色で描く", (kind, fam) => {
    // Act
    const icon = kindIcon(kind);
    // Assert
    expect(icon).toContain(`fill="var(--k-${fam}-bg)"`);
  });
});
