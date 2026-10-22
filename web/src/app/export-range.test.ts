// エクスポートの範囲「選んだ要素」（F-EXP-4）の単体テスト。
import { describe, expect, it } from "vitest";
import type { ModelEdge, ModelLane, ModelNode } from "../core";
import { selectionContent, withInnerKeys } from "./export-range";
import type { ViewContent } from "./views";

const node = (key: string, container?: string): ModelNode => ({ key, name: key, kind: "part", isDef: false, ...(container ? { container } : {}) }) as ModelNode;
const edge = (from: string, to: string): ModelEdge => ({ id: `${from}>${to}`, kind: "flow", from, to, label: "" }) as ModelEdge;
const lane = (name: string, nodes: string[]): ModelLane => ({ key: `lane:${name}`, name, nodes }) as ModelLane;

/** A・B・C の 3 つと、A の中の A.x、その中の A.x.y。線は A→B・B→C・A.x→C。 */
const content = (): ViewContent => ({
  nodes: [node("A"), node("B"), node("C"), node("A.x", "A"), node("A.x.y", "A.x")],
  edges: [edge("A", "B"), edge("B", "C"), edge("A.x", "C")],
});

describe("withInnerKeys（選んだ要素と、その中の要素）", () => {
  it("入れ子の要素を深さによらず含める（正常系）", () => {
    // Act
    const keys = withInnerKeys(content(), new Set(["A"]));
    // Assert
    expect([...keys].sort()).toEqual(["A", "A.x", "A.x.y"]);
  });

  it("図に無いキーは含めない（異常系）", () => {
    // Act
    const keys = withInnerKeys(content(), new Set(["Z", "B"]));
    // Assert
    expect([...keys]).toEqual(["B"]);
  });

  it("何も選んでいなければ空（境界値）", () => {
    // Act
    const keys = withInnerKeys(content(), new Set());
    // Assert
    expect(keys.size).toBe(0);
  });
});

describe("selectionContent（選んだ要素の範囲に絞る）", () => {
  it("選んだ要素と、両端がその中にある線だけを残す（正常系）", () => {
    // Act
    const c = selectionContent(content(), new Set(["A", "B"]));
    // Assert
    expect(c.nodes.map((n) => n.key)).toEqual(["A", "B", "A.x", "A.x.y"]);
    expect(c.edges.map((e) => e.id)).toEqual(["A>B"]);
  });

  it("中身を書き換えない", () => {
    // Arrange
    const whole = content();
    // Act
    selectionContent(whole, new Set(["B"]));
    // Assert
    expect(whole.nodes).toHaveLength(5);
    expect(whole.edges).toHaveLength(3);
  });

  it("図の外枠と、その上のポートは描かない", () => {
    // Arrange
    const whole: ViewContent = { ...content(), frame: { kind: "part def", title: "Car" }, boundary: [node("p")] };
    // Act
    const c = selectionContent(whole, new Set(["A"]));
    // Assert
    expect(c.frame).toBeUndefined();
    expect(c.boundary).toBeUndefined();
  });

  it("package の枠は、残す要素を含むものだけにし、入れ子の枠の番号を付け直す", () => {
    // Arrange（P の中に Q、Q の中に A。R には C だけ）
    const whole: ViewContent = {
      ...content(),
      packages: [
        { name: "R", keys: ["C"], inner: [] },
        { name: "P", keys: ["B"], inner: [2] },
        { name: "Q", keys: ["A"], inner: [] },
      ],
    };
    // Act
    const c = selectionContent(whole, new Set(["A"]));
    // Assert（R は消え、P は要素が残らなくても Q を含むので残る）
    expect(c.packages).toEqual([
      { name: "P", keys: [], inner: [1] },
      { name: "Q", keys: ["A"], inner: [] },
    ]);
  });

  it("アクティビティ図の区画は、残す要素を受け持つものだけにする", () => {
    // Arrange
    const whole: ViewContent = { ...content(), lanes: [lane("x", ["A", "B"]), lane("y", ["C"])] };
    // Act
    const c = selectionContent(whole, new Set(["B"]));
    // Assert
    expect(c.lanes?.map((l) => [l.name, l.nodes])).toEqual([["x", ["B"]]]);
  });

  it("何も選んでいなければ、要素も線も残らない（境界値）", () => {
    // Act
    const c = selectionContent(content(), new Set());
    // Assert
    expect(c.nodes).toEqual([]);
    expect(c.edges).toEqual([]);
  });
});
