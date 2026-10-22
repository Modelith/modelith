// 線の形の調整（F-VIEW-16）：曲がり角を通る経路と、付け替えた端。
import { describe, expect, it } from "vitest";
import { build, parse } from "../core/rust";
import { bendPoints, boxesOf, computeRoutes, longestLabel, segmentMids, type NodeBox } from "./geometry";
import { emptyView, layoutFromJson, layoutToJson } from "./layout";
import { serializeLayout } from "./layout-file";
import { hasShape, insertBend, moveBend, pruneShapes, removeBend, renameEdgeKeys, resetShape, setAnchor } from "./edge-shape";

/** A を (0, 0)、B を (400, 0) に置いた一般の図の箱と線。 */
function twoBoxes() {
  const M = build(parse("package P { part def A { part b : B; } part def B; }"));
  const pos = { A: [0, 0] as [number, number], B: [400, 0] as [number, number] };
  const rects = boxesOf(M.nodes, pos);
  const box = new Map<string, NodeBox>(M.nodes.filter((n) => n.key in pos).map((n) => [n.key, { ...(rects.get(n.key) as NodeBox), n, pins: [] }]));
  const edges = M.edges.filter((e) => box.has(e.from) && box.has(e.to));
  return { box, edges, id: edges[0]?.id ?? "" };
}

describe("bendPoints（F-VIEW-16）", () => {
  it("始点の縁の向きに出て、曲がり角を通り、終点の縁の向きから入る", () => {
    // Act
    const pts = bendPoints({ P: [100, 50], N: [1, 0] }, [[200, 100]], { P: [300, 200], N: [0, -1] });
    // Assert
    expect(pts).toEqual([[100, 50], [200, 50], [200, 100], [300, 100], [300, 200]]);
  });

  it("続けて同じ点は 1 つにし、一直線に並んだ曲がり角は残す（境界値）", () => {
    // Act
    const pts = bendPoints({ P: [0, 0], N: [1, 0] }, [[100, 0], [100, 0]], { P: [200, 0], N: [-1, 0] });
    // Assert
    expect(pts).toEqual([[0, 0], [100, 0], [200, 0]]);
  });

  it("区間の中ほどは、折れ点をたどった道のりの半分の位置", () => {
    expect(segmentMids([[0, 0], [100, 50]], [[0, 0], [100, 0], [100, 50]])).toEqual([[75, 0]]);
    expect(segmentMids([[0, 0], [40, 0], [40, 40]], [[0, 0], [40, 0], [40, 40]])).toEqual([[20, 0], [40, 20]]);
  });

  it("ラベルは最も長い区間に置く", () => {
    expect(longestLabel([[0, 0], [100, 0], [100, 40]])).toEqual({ x: 50, y: 13, a: "middle" });
    expect(longestLabel([[0, 0], [0, 80]])).toEqual({ x: 5, y: 44, a: "start" });
  });
});

describe("computeRoutes の曲がり角と付け替えた端（F-VIEW-16）", () => {
  it("曲がり角があれば、自動の経路の代わりにそこを通り、つまみの位置（via）を返す", () => {
    // Arrange
    const { box, edges, id } = twoBoxes();
    const L = { ...emptyView(), bends: { [id]: [[300, 200]] as [number, number][] } };
    // Act
    const r = computeRoutes(box, edges, L, "ortho").get(id);
    // Assert（両端の下の縁から出入りし、曲がり角 (300, 200) を通る）
    expect(r?.via[1]).toEqual([300, 200]);
    expect([r?.from.side, r?.to.side]).toEqual(["b", "b"]);
    expect(r?.d).toContain("300,200");
    expect(r?.via).toHaveLength(3);
  });

  it("付け替えた端は、指定した縁の位置から出る", () => {
    // Arrange
    const { box, edges, id } = twoBoxes();
    const L = { ...emptyView(), anchors: { [id]: [["b", 0.25], null] as [["b", number], null] } };
    // Act
    const r = computeRoutes(box, edges, L, "ortho").get(id);
    // Assert
    expect([r?.from.side, r?.from.t]).toEqual(["b", 0.25]);
  });

  it("曲がり角も付け替えも無ければ、つまみは両端だけ（境界値）", () => {
    // Arrange
    const { box, edges, id } = twoBoxes();
    // Act
    const r = computeRoutes(box, edges, undefined, "ortho").get(id);
    // Assert
    expect(r?.via).toHaveLength(2);
  });
});

describe("曲がり角と端の位置の配置ファイル（F-VIEW-16、ADR-0005）", () => {
  it("@bends と @anchors を書いて読み戻し、線ごとに 1 行にする", () => {
    // Arrange
    const L = { v: { ...emptyView(), pos: { A: [0, 0] as [number, number] }, bends: { e1: [[10, 20], [30, 20]] as [number, number][] }, anchors: { e1: [null, ["l", 0.5]] as [null, ["l", number]] } } };
    // Act
    const json = layoutToJson(L);
    const text = serializeLayout(L);
    // Assert
    expect(layoutFromJson(json)).toEqual(L);
    expect(text).toContain('      "@bends": {\n        "e1": [[10,20],[30,20]]\n      }');
    expect(text).toContain('      "@anchors": {\n        "e1": [null,["l",0.5]]\n      }');
  });

  it("形の合わない曲がり角と端の位置は捨てる（異常系）", () => {
    // Act
    const L = layoutFromJson({ v: { "@bends": { e1: [[1]], e2: [] }, "@anchors": { e1: [["z", 0.5], null], e2: [null] } } });
    // Assert
    expect(L["v"]?.bends).toBeUndefined();
    expect(L["v"]?.anchors).toBeUndefined();
  });
});

describe("線の形の書き換え（F-VIEW-16）", () => {
  it("区間に曲がり角を足し、動かし、消すと、最後の 1 つで項目ごと消える", () => {
    // Arrange
    const L = emptyView();
    // Act・Assert
    expect(insertBend(L, "e1", 0, [50, 50])).toBe(0);
    expect(insertBend(L, "e1", 5, [90, 50])).toBe(1); // 範囲外の区間は末尾に足す（境界値）
    moveBend(L, "e1", 1, [90, 60]);
    expect(L.bends?.["e1"]).toEqual([[50, 50], [90, 60]]);
    removeBend(L, "e1", 0);
    removeBend(L, "e1", 0);
    expect(L.bends?.["e1"]).toBeUndefined();
    expect(hasShape(L, "e1")).toBe(false);
  });

  it("無い番号の曲がり角は動かさず消さない（異常系）", () => {
    // Arrange
    const L = { ...emptyView(), bends: { e1: [[1, 1]] as [number, number][] } };
    // Act
    moveBend(L, "e1", 3, [9, 9]);
    removeBend(L, "e1", -1);
    removeBend(L, "nope", 0);
    // Assert
    expect(L.bends.e1).toEqual([[1, 1]]);
  });

  it("端を付け替えると、その端の接続点の指定を外し、両端とも無くなれば線の端の項目を消す", () => {
    // Arrange
    const L = { ...emptyView(), ends: { e1: ["a1", null] as [string, null] } };
    // Act
    setAnchor(L, "e1", "f", ["b", 0.3]);
    // Assert
    expect(L.anchors?.["e1"]).toEqual([["b", 0.3], null]);
    expect(L.ends["e1"]).toBeUndefined();
    expect(hasShape(L, "e1")).toBe(true);
  });

  it("元に戻すと、曲がり角と付け替えた端を消す", () => {
    // Arrange
    const L = { ...emptyView(), bends: { e1: [[1, 1]] as [number, number][] }, anchors: { e1: [null, ["l", 0.5]] as [null, ["l", number]] } };
    // Act
    resetShape(L, "e1");
    // Assert
    expect(hasShape(L, "e1")).toBe(false);
  });

  it("要素の名前を変えたら線の ID の鍵を付け替え、無くなった線の形は消す", () => {
    // Arrange
    const L = { ...emptyView(), bends: { "comp|A|B|#1": [[1, 1]] as [number, number][], "comp|C|D|#1": [[2, 2]] as [number, number][] } };
    // Act
    renameEdgeKeys(L.bends, "A", "X");
    pruneShapes(L, new Set(["comp|X|B|#1"]));
    // Assert
    expect(Object.keys(L.bends)).toEqual(["comp|X|B|#1"]);
  });
});
