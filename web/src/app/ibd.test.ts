// 内部ブロック図の中身（InterconnectionView）。要素のキーと線の ID が、Rust のコアの図の操作と同じであることも確かめる（ADR-0016）。
import { describe, expect, it } from "vitest";
import { build, edit, parse, type Model, type ModelNode } from "../core";
import { ibdContentOf } from "./ibd";

/**
 * テキストからモデルと、内部ブロック図の対象を作る。
 *
 * @param text SysML v2 のテキスト
 * @param ctx 対象の部品定義の名前
 * @returns モデルと対象のノード
 */
function setup(text: string, ctx: string): { M: Model; c: ModelNode } {
  const M = build(parse(text));
  const c = M.nodes.find((n) => n.key === ctx);
  if (!c) throw new Error(`${ctx} がありません`);
  return { M, c };
}

describe("ibdContentOf（内部ブロック図の中身）", () => {
  it("対象の部品を u:名前 の要素に、部品の間の流れと接続を線にする", () => {
    // Arrange
    const { M, c } = setup("package P { part def E { port o; port i; } part def C { part a : E; part b : E; flow from a.o to b.i; connection k connect a.o to b.i; } }", "C");
    // Act
    const { nodes, edges } = ibdContentOf(M, c);
    // Assert
    expect(nodes.map((n) => n.key)).toEqual(["u:a", "u:b"]);
    expect(edges.map((e) => [e.id, e.fromPort, e.toPort])).toEqual([
      ["flow|u:a|u:b|#1", "port:o", "port:i"],
      ["flow|u:a|u:b|#2", "port:o", "port:i"],
    ]);
  });

  it("端が図の部品に当たらない線は描かない（異常系）", () => {
    // Arrange
    const { M, c } = setup("package P { part def E; part def C { part a : E; flow from a to nope; } }", "C");
    // Act
    const { edges } = ibdContentOf(M, c);
    // Assert
    expect(edges).toEqual([]);
  });

  it("線の ID で、Rust のコアが同じ線を消せる（結合）", () => {
    // Arrange
    const text = "package P { part def E { port o; port i; } part def C { part a : E; part b : E; flow from a.o to b.i; connect a.o to b.i; } }";
    const { M, c } = setup(text, "C");
    // Act
    const results = ibdContentOf(M, c).edges.map((e) => edit(text, { op: "deleteEdge", id: e.id, ctx: "C" }));
    // Assert
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => !("refused" in r))).toBe(true);
  });
});
