// 一般の図のメモ（comment、8.2.3.4 の comment と annotation-link）。
import { describe, expect, it } from "vitest";
import { build, parse } from "../core/rust";
import { withNotes } from "./notes";

/** テキストからモデルを作る。 */
const model = (text: string) => build(parse(text));

describe("withNotes（一般の図のメモ）", () => {
  it("図に出した要素を注釈するメモを足し、図にある相手にだけ破線を引く", () => {
    // Arrange（メモ c が A と B を注釈し、図には A だけがある）
    const M = model("package P { part def A; part def B; comment c about A, B /* 安全のため */ }");
    const A = M.nodes.filter((n) => n.key === "A");
    // Act
    const c = withNotes(M.notes, { nodes: A, edges: [] });
    // Assert
    expect(c.nodes.map((n) => [n.key, n.kind, !!n.note, n.entry.body])).toEqual([["A", "part def", false, undefined], ["note:c", "comment", true, "安全のため"]]);
    expect(c.edges.map((e) => [e.id, e.kind, e.from, e.to])).toEqual([["annotate|note:c|A", "annotate", "note:c", "A"]]);
  });

  it("注釈する要素が図に無ければ、内容をそのまま返す（境界）", () => {
    // Arrange
    const M = model("package P { part def A; part def B; comment about B /* x */ }");
    const content = { nodes: M.nodes.filter((n) => n.key === "A"), edges: [] };
    // Act
    const c = withNotes(M.notes, content);
    // Assert
    expect(c).toBe(content);
  });

  it("メモの一覧を持たないモデル（notes が無い）でも、内容をそのまま返す", () => {
    // Arrange
    const content = { nodes: [], edges: [] };
    // Act
    const c = withNotes(undefined, content);
    // Assert
    expect(c).toBe(content);
  });
});

describe("withNotes（別の言語での表し方、8.2.3.4 の textual-representation-node）", () => {
  it("図に出した要素の rep を «rep» のメモとして足し、持ち主へ線を引く（正常系）", () => {
    // Arrange
    const M = build(parse('package P { part def A { rep inOCL language "OCL" /* self.m > 0 */ } part def B; }'));
    const shown = { nodes: M.nodes, edges: [] };
    // Act
    const c = withNotes([], shown);
    // Assert
    const rep = c.nodes.find((n) => n.key === "rep:A#1");
    expect(rep?.kind).toBe("rep");
    expect([rep?.name, rep?.entry.type, rep?.entry.body]).toEqual(["inOCL", "OCL", "self.m > 0"]);
    expect(c.edges.map((e) => e.id)).toEqual(["annotate|rep:A#1|A"]);
  });

  it("rep の無い要素だけなら、内容をそのまま返す（境界値）", () => {
    // Arrange
    const M = build(parse("package P { part def B; }"));
    const shown = { nodes: M.nodes, edges: [] };
    // Act / Assert
    expect(withNotes([], shown)).toBe(shown);
  });
});
