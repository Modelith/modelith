// 図の幾何計算のうち、package の枠（F-VIEW-9）。
import { describe, expect, it } from "vitest";
import type { Entry, ModelEdge, ModelNode } from "../core";
import { autoPlace, boxesOf, DOT, downward, endLabelPos, featureText, packageRects, placeJunctions, PKG_PAD, PKG_TAB, W, type Box, type RouteEnd } from "./geometry";

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

describe("downward・autoPlace（構造の図で、一般な側を上に置く）", () => {
  const edge = (kind: ModelEdge["kind"], from: string, to: string): ModelEdge => ({ id: `${kind}|${from}|${to}`, kind, from, to, label: "", src: { start: 0, end: 0 } });

  it("特殊化の線は一般な側（終わり）を上に、部品として持つ線は持ち主（始まり）を上にする", () => {
    // Act
    const [spec, comp] = [downward(edge("specialize", "B", "A")), downward(edge("comp", "V", "W"))];
    // Assert
    expect(spec).toEqual(["A", "B"]);
    expect(comp).toEqual(["V", "W"]);
  });

  it("深さで並べる図では、特殊化した定義を元の定義の下の段に置く", () => {
    // Arrange
    const node = (key: string): ModelNode => ({
      key, name: key, short: "", kind: "part def", isDef: true, fam: "part", trans: [], ports: [], phase: null, phaseOwn: false,
      entry: { kind: "part def", isDef: true, short: "", name: key, type: "", owner: null, pe: null, start: 0, headEnd: 0, end: 0, head: "", exprs: [], children: [], idx: 0 },
    });
    const pos: Record<string, [number, number]> = {};
    // Act
    autoPlace([node("B"), node("A")], [edge("specialize", "B", "A")], pos, { id: "structure", label: "構造", depth: true }, null);
    // Assert
    expect((pos["A"]?.[1] ?? NaN) < (pos["B"]?.[1] ?? NaN)).toBe(true);
  });
});

describe("boxesOf・placeJunctions（内部ブロック図の n 項の接続の点、8.2.3.13 の n-ary-connection-dot）", () => {
  const node = (key: string, junction = false): ModelNode => ({
    key, name: key, short: "", kind: junction ? "connection" : "part", isDef: false, fam: "part", trans: [], ports: [], phase: null, phaseOwn: false,
    ...(junction ? { junction: true } : {}),
    entry: { kind: "part", isDef: false, short: "", name: key, type: "", owner: null, pe: null, start: 0, headEnd: 0, end: 0, head: "", exprs: [], children: [], idx: 0 },
  });
  const seg = (from: string, to: string): ModelEdge => ({ id: `connect|${from}|${to}|#1`, kind: "connect", from, to, label: "", src: { start: 0, end: 0 } });

  it("点は DOT 四方、ほかの要素は幅 W の矩形にする", () => {
    // Act
    const boxes = boxesOf([node("u:a"), node("j:#1", true)], { "u:a": [10, 20], "j:#1": [300, 40] });
    // Assert
    expect(boxes.get("u:a")).toEqual({ x: 10, y: 20, w: W, h: 44 });
    expect(boxes.get("j:#1")).toEqual({ x: 300, y: 40, w: DOT, h: DOT });
  });

  it("座標の無い点は、つながる要素の中心の平均に置く", () => {
    // Arrange
    const nodes = [node("u:a"), node("u:b"), node("j:#1", true)];
    const pos: Record<string, [number, number]> = { "u:a": [0, 0], "u:b": [0, 400] };
    // Act
    placeJunctions(nodes, [seg("j:#1", "u:a"), seg("j:#1", "u:b")], pos);
    // Assert
    expect(pos["j:#1"]).toEqual([W / 2 - DOT / 2, (22 + 422) / 2 - DOT / 2]);
  });

  it("中心の平均が要素に重なるときは、つながる要素の下に置く", () => {
    // Arrange（3 つが横に並び、平均が真ん中の要素の中に入る）
    const nodes = [node("u:a"), node("u:b"), node("u:c"), node("j:#1", true)];
    const pos: Record<string, [number, number]> = { "u:a": [0, 0], "u:b": [300, 0], "u:c": [600, 0] };
    // Act
    placeJunctions(nodes, [seg("j:#1", "u:a"), seg("j:#1", "u:b"), seg("j:#1", "u:c")], pos);
    // Assert
    expect(pos["j:#1"]).toEqual([300 + W / 2 - DOT / 2, 44 + 60 - DOT / 2]);
  });

  it("座標のある点と、つながる要素に座標の無い点は動かさない（境界値）", () => {
    // Arrange
    const nodes = [node("u:a"), node("j:#1", true), node("j:#2", true)];
    const pos: Record<string, [number, number]> = { "j:#1": [5, 5] };
    // Act
    placeJunctions(nodes, [seg("j:#1", "u:a"), seg("j:#2", "u:a")], pos);
    // Assert
    expect(pos).toEqual({ "j:#1": [5, 5] });
  });
});
