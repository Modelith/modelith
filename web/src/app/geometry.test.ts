// 図の幾何計算のうち、package の枠（F-VIEW-9）。
import { describe, expect, it } from "vitest";
import { endLabelPos, packageRects, PKG_PAD, PKG_TAB, type Box, type RouteEnd } from "./geometry";

const boxes: Record<string, Box> = {
  A: { x: 0, y: 0, w: 100, h: 50 },
  B: { x: 200, y: 100, w: 100, h: 50 },
};
const boxOf = (k: string): Box | undefined => boxes[k];

describe("packageRects（F-VIEW-9）", () => {
  it("枠は中の要素をすべて囲み、上に名前の札の分をあける", () => {
    // Act
    const [r] = packageRects([{ keys: ["A", "B"], inner: [] }], boxOf);
    // Assert
    expect(r).toEqual({ x: -PKG_PAD, y: -PKG_TAB, w: 300 + 2 * PKG_PAD, h: 150 + PKG_TAB + PKG_PAD });
  });

  it("外の枠は、中の枠も囲む（入れ子）", () => {
    // Act（0 番の中に 1 番がある。0 番に直接の要素は無い）
    const [outer, inner] = packageRects([{ keys: [], inner: [1] }, { keys: ["B"], inner: [] }], boxOf);
    // Assert
    expect(inner).toEqual({ x: 200 - PKG_PAD, y: 100 - PKG_TAB, w: 100 + 2 * PKG_PAD, h: 50 + PKG_TAB + PKG_PAD });
    expect(outer?.x).toBe((inner?.x ?? 0) - PKG_PAD);
    expect(outer?.y).toBe((inner?.y ?? 0) - PKG_TAB);
  });

  it("中に描く要素が無い枠は描かない（境界値）", () => {
    // Act
    const rs = packageRects([{ keys: ["Gone"], inner: [] }], boxOf);
    // Assert
    expect(rs).toEqual([null]);
  });

  it("入れ子の指定に輪があっても止まる（異常系）", () => {
    // Act
    const rs = packageRects([{ keys: ["A"], inner: [1] }, { keys: ["B"], inner: [0] }], boxOf);
    // Assert
    expect(rs.every((r) => r !== null)).toBe(true);
  });
});

describe("endLabelPos（8.2.3 の multiplicity：線の端の文字）", () => {
  const end = (P: [number, number], N: [number, number]): RouteEnd => ({ P, N, side: "t", t: 0.5, pin: null });

  it("上の辺の端では、線の右・辺の上に置く", () => {
    // Act
    const at = endLabelPos(end([100, 50], [0, -1]));
    // Assert
    expect(at).toEqual({ x: 104, y: 44, a: "start" });
  });

  it("下の辺の端では、線の右・辺の下に置く", () => {
    // Act
    const at = endLabelPos(end([100, 50], [0, 1]));
    // Assert
    expect(at).toEqual({ x: 104, y: 64, a: "start" });
  });

  it("左右の辺の端では、辺の外側に向けて揃え、線の上に置く", () => {
    // Act
    const [left, right] = [endLabelPos(end([0, 25], [-1, 0])), endLabelPos(end([224, 25], [1, 0]))];
    // Assert
    expect(left).toEqual({ x: -6, y: 20, a: "end" });
    expect(right).toEqual({ x: 230, y: 20, a: "start" });
  });
});
