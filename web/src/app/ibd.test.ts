// 内部ブロック図の中身（InterconnectionView）。要素のキーと線の ID が、Rust のコアの図の操作と同じであることも確かめる（ADR-0016）。
import { describe, expect, it } from "vitest";
import { applyTextEdits, build, edit, parse, type Model, type ModelNode } from "../core";
import { ibdContentOf, ownPorts } from "./ibd";

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

  it("名前付きのフローは、名前と型をラベルにし、本体を含む使用を指す（8.2.3.16 の flow-label）", () => {
    // Arrange
    const text = "package P { part def E { port o; port i; } item def Water; flow def FD; part def C { part a : E; part b : E; flow f : FD from a.o to b.i { } flow g of Water from a.o to b.i; } }";
    const { M, c } = setup(text, "C");
    // Act
    const { edges } = ibdContentOf(M, c);
    // Assert
    expect(edges.map((e) => e.label)).toEqual(["f : FD", "g of Water"]);
    expect(text.slice(edges[0]?.src.start, edges[0]?.src.end)).toBe("flow f : FD from a.o to b.i { }");
  });

  it("結び付けは、ラベル = の bind の線にする（8.2.3.13 の binding-connection）", () => {
    // Arrange
    const { M, c } = setup("package P { part def E { port o; } part def C { part a : E; part b : E; bind a.o = b.o; binding bb bind a = b; } }", "C");
    // Act
    const { edges } = ibdContentOf(M, c);
    // Assert
    expect(edges.map((e) => [e.id, e.kind, e.label, e.fromPort])).toEqual([
      ["bind|u:a|u:b|=#1", "bind", "=", "port:o"],
      ["bind|u:a|u:b|=#2", "bind", "=", undefined],
    ]);
  });

  it("端が 3 つ以上の接続は、点から端ごとに線を引く（8.2.3.13 の n-ary-connection）", () => {
    // Arrange
    const { M, c } = setup("package P { part def E { port o; } part def C { part a : E; part b : E; part e : E; connect (a.o, b, e); connection k connect (a, b, e); } }", "C");
    // Act
    const { nodes, edges } = ibdContentOf(M, c);
    // Assert
    expect(nodes.filter((n) => n.junction).map((n) => [n.key, n.kind])).toEqual([["j:#1", "connection"], ["j:k", "connection"]]);
    expect(edges.map((e) => [e.id, e.kind, e.toPort])).toEqual([
      ["connect|j:#1|u:a|#1", "connect", "port:o"],
      ["connect|j:#1|u:b|#1", "connect", undefined],
      ["connect|j:#1|u:e|#1", "connect", undefined],
      ["connect|j:k|u:a|#1", "connect", undefined],
      ["connect|j:k|u:b|#1", "connect", undefined],
      ["connect|j:k|u:e|#1", "connect", undefined],
    ]);
  });

  it("n 項の接続で、図の部品に当たる端が 2 つ未満なら点も線も描かない（境界値）", () => {
    // Arrange
    const { M, c } = setup("package P { part def E; part def C { part a : E; connect (a, x, y); } }", "C");
    // Act
    const { nodes, edges } = ibdContentOf(M, c);
    // Assert
    expect(nodes.map((n) => n.key)).toEqual(["u:a"]);
    expect(edges).toEqual([]);
  });

  it("部品の本体の部品と、線の端（a.x.p）が指す型の中の部品を、中の部品として描く（入れ子の 2 段目）", () => {
    // Arrange
    const text = "package P { part def X { port p; } part def A { part x : X; part unused : X; } part def C { part a : A { part y : X; } part b : X; connect a.x.p to b.p; } }";
    const { M, c } = setup(text, "C");
    // Act
    const { nodes, edges } = ibdContentOf(M, c);
    // Assert（型の中の部品のうち、線の端が指さない unused は描かない）
    expect(nodes.map((n) => [n.key, n.container])).toEqual([["u:a", undefined], ["u:a.y", "u:a"], ["u:a.x", "u:a"], ["u:b", undefined]]);
    expect(edges.map((e) => [e.id, e.fromPort, e.toPort])).toEqual([["flow|u:a.x|u:b|#1", "port:p", "port:p"]]);
  });

  it("3 段・4 段の連鎖の端（a.x.v.p）は、型の中をたどった部品を、中の部品のさらに中に描く（8.2.2.6 の特徴の連鎖）", () => {
    // Arrange（以前は 3 段目から先を捨て、a.x の枠につないでいた）
    const text = "package P { part def V { port p; } part def X { part v : V; } part def A { part x : X { part w { part deep; } } } part def C { part a : A; part b : V; connect a.x.v.p to b.p; } }";
    const { M, c } = setup(text, "C");
    // Act
    const { nodes, edges } = ibdContentOf(M, c);
    // Assert（本体に書いた部品は、どの深さでも描く）
    expect(nodes.map((n) => [n.key, n.container])).toEqual([
      ["u:a", undefined], ["u:a.x", "u:a"], ["u:a.x.w", "u:a.x"], ["u:a.x.w.deep", "u:a.x.w"], ["u:a.x.v", "u:a.x"], ["u:b", undefined],
    ]);
    expect(edges.map((e) => [e.id, e.fromPort, e.toPort])).toEqual([["flow|u:a.x.v|u:b|#1", "port:p", "port:p"]]);
    // 同じ ID で、Rust のコアが同じ線を消せる
    expect(edit(text, { op: "deleteEdge", id: "flow|u:a.x.v|u:b|#1", ctx: "C" })).not.toHaveProperty("refused");
  });

  it("部品の型の中の線は、同じ型の部品ごとに、部品の中に描く", () => {
    // Arrange
    const text = "package P { part def X { port p; } part def A { port q; part x : X; connect q to x.p; } part def C { part a : A; part d : A; } }";
    const { M, c } = setup(text, "C");
    // Act
    const { nodes, edges } = ibdContentOf(M, c);
    // Assert
    expect(nodes.map((n) => n.key)).toEqual(["u:a", "u:a.x", "u:d", "u:d.x"]);
    expect(edges.map((e) => [e.id, e.fromPort, e.toPort])).toEqual([
      ["flow|u:a|u:a.x|#1", "port:q", "port:p"],
      ["flow|u:d|u:d.x|#1", "port:q", "port:p"],
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

  it("対象そのもののポートへの線は、枠の上のポート b:名前 に引き、向きを持たせる（8.2.3.13）", () => {
    // Arrange（継いだポート q と、どの線の端でもないポート idle は描かない）
    const text = "package P { part def E { port p; } part def B { port q; } part def C :> B { in port pwr; out port res; port idle; part a : E; connect pwr to a.p; flow from a.p to res; connect q to a.p; } }";
    const { M, c } = setup(text, "C");
    // Act
    const { boundary, edges, nodes } = ibdContentOf(M, c);
    // Assert
    expect(boundary.map((b) => [b.key, b.boundary])).toEqual([["b:pwr", "in"], ["b:res", "out"]]);
    expect(edges.map((e) => e.id)).toEqual(["flow|b:pwr|u:a|#1", "flow|u:a|b:res|#1"]);
    expect(nodes.some((n) => n.key.startsWith("b:"))).toBe(false);
  });

  it("枠の上のポートの線の ID で、Rust のコアが同じ線を消せる（結合）", () => {
    // Arrange
    const text = "package P { part def E { port p; } part def C { in port pwr; part a : E; connect pwr to a.p; } }";
    const { M, c } = setup(text, "C");
    const [edge] = ibdContentOf(M, c).edges;
    // Act
    const r = edit(text, { op: "deleteEdge", id: edge?.id ?? "", ctx: "C" });
    // Assert
    if ("refused" in r) throw new Error(r.refused);
    expect(applyTextEdits(text, r.edits)).not.toContain("connect pwr");
  });

  it("型の無い部品は、本体に書いたポートを描く（向きは修飾から、無ければ双方向）", () => {
    // Arrange
    const text = "package P { part def C { part engine { out port o; in port i; port x; } part b { in port i; } flow from engine.o to b.i; } }";
    const { M, c } = setup(text, "C");
    // Act
    const { nodes, edges } = ibdContentOf(M, c);
    const engine = nodes.find((n) => n.key === "u:engine");
    // Assert
    expect(engine?.ports.map((p) => [p.name, p.dir])).toEqual([["o", "out"], ["i", "in"], ["x", "inout"]]);
    expect(edges.map((e) => [e.id, e.fromPort, e.toPort])).toEqual([["flow|u:engine|u:b|#1", "port:o", "port:i"]]);
  });

  it("線の ID で、Rust のコアが同じ線を消せる（結合）", () => {
    // Arrange（2 項・名前付きのフロー・結び付け・n 項、入れ子の部品と型の中の線）
    const text = "package P { part def E { port o; port i; part n : E2; connect o to n.p; } part def E2 { port p; } flow def FD; part def C { part a : E; part b : E; flow from a.o to b.i; connect a.o to b.i; flow f : FD from a.o to b.i; bind a.o = b.i; connect (a, b, a.o); connect a.n.p to b.i; } }";
    const { M, c } = setup(text, "C");
    // Act
    const results = ibdContentOf(M, c).edges.map((e) => edit(text, { op: "deleteEdge", id: e.id, ctx: "C" }));
    // Assert
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => !("refused" in r))).toBe(true);
  });
});

describe("ownPorts（型の無い部品の本体のポート）", () => {
  it("本体にポートが無ければ空（境界値）", () => {
    // Arrange
    const M = build(parse("package P { part engine; }"));
    const u = M.nodes.find((n) => n.name === "engine")?.entry;
    if (!u) throw new Error("engine がありません");
    // Act
    const ports = ownPorts(u);
    // Assert
    expect(ports).toEqual([]);
  });
});
