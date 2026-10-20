// 図の幾何計算のうち、package の枠（F-VIEW-9）。
import { describe, expect, it } from "vitest";
import type { Entry } from "../core";
import { endLabelPos, featureText, packageRects, PKG_PAD, PKG_TAB, type Box, type RouteEnd } from "./geometry";

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

describe("featureText（8.2.3 の usage-cp：区画の属性の行）", () => {
  /** 属性の宣言を、必要な項目だけ指定して作る。 */
  const attr = (x: Partial<Entry>): Entry => ({
    kind: "attribute", isDef: false, short: "", name: "", type: "", owner: null, pe: null, start: 0, headEnd: 0, end: 0, head: "", exprs: [], children: [], idx: 0, ...x,
  });

  it("多重度も特殊化の相手も無ければ、これまでどおり「名前 : 型」か「名前 = 値」", () => {
    // Act
    const [typed, valued] = [featureText(attr({ name: "mass", type: "Real" })), featureText(attr({ name: "mass", type: "Real", value: "1500" }))];
    // Assert
    expect(typed).toBe("mass : Real");
    expect(valued).toBe("mass = 1500");
  });

  it("多重度は型の後ろに、ordered・nonunique を続けて書く", () => {
    // Act
    const t = featureText(attr({ name: "w", type: "Wheel", multiplicity: { range: "4", ordered: true, nonunique: false } }));
    // Assert
    expect(t).toBe("w : Wheel [4] ordered");
  });

  it("名前を書かずに再定義した特性は、名前を省いて「:>> 相手 = 値」にする", () => {
    // Act
    const t = featureText(attr({ name: "mass", value: "1500", specs: [{ op: "redefines", target: "mass", start: 0, end: 0 }] }));
    // Assert
    expect(t).toBe(":>> mass = 1500");
  });

  it("部分集合と参照は、相手ごとに記号を付けて並べる", () => {
    // Act
    const t = featureText(attr({ name: "b", type: "B", specs: [{ op: "subsets", target: "a", start: 0, end: 0 }, { op: "references", target: "x.y", start: 0, end: 0 }] }));
    // Assert
    expect(t).toBe("b : B :> a ::> x.y");
  });

  it("範囲の無い多重度（nonunique だけ）は、括弧を書かない（境界）", () => {
    // Act
    const t = featureText(attr({ name: "n", type: "N", multiplicity: { range: "", ordered: false, nonunique: true } }));
    // Assert
    expect(t).toBe("n : N nonunique");
  });
});
