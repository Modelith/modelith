// 図の幾何計算のうち、package の枠（F-VIEW-9）。
import { describe, expect, it } from "vitest";
import type { Entry, ModelEdge, ModelNode } from "../core";
import { autoPlace, boxesOf, DOT, downward, endLabelPos, featureText, keywordOf, nodeH, noteLines, NEST_PAD, NEST_TOP, packageRects, placeJunctions, placeNested, placeNotes, PKG_PAD, PKG_TAB, stackedHeight, stackedWidth, W, type Box, type RouteEnd } from "./geometry";

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

  it("交差（crosses）は => で書く（8.2.2.6 の Crosses）", () => {
    // Act
    const t = featureText(attr({ name: "w", type: "A", specs: [{ op: "crosses", target: "q.r", start: 0, end: 0 }] }));
    // Assert
    expect(t).toBe("w : A => q.r");
  });

  it("初期値・既定値は、書いた記号（:=・default）のまま書く（8.2.2.6 の FeatureValue）", () => {
    // Act
    const [initial, byDefault, defaultInitial] = [
      featureText(attr({ name: "m", type: "Real", value: "10", valueOp: ":=" })),
      featureText(attr({ name: "m", type: "Real", value: "10", valueOp: "default" })),
      featureText(attr({ name: "m", value: "10", valueOp: "default :=", multiplicity: { range: "1", ordered: false, nonunique: false } })),
    ];
    // Assert
    expect([initial, byDefault, defaultInitial]).toEqual(["m := 10", "m default 10", "m [1] default := 10"]);
  });

  it("型も値も無い参照（ref r）は、名前だけを書く（境界）", () => {
    // Act
    const t = featureText(attr({ name: "r", type: "" }));
    // Assert
    expect(t).toBe("r");
  });

  it("範囲の無い多重度（nonunique だけ）は、括弧を書かない（境界）", () => {
    // Act
    const t = featureText(attr({ name: "n", type: "N", multiplicity: { range: "", ordered: false, nonunique: true } }));
    // Assert
    expect(t).toBe("n : N nonunique");
  });
});

describe("downward・autoPlace（ブロック定義図で、一般な側を上に置く）", () => {
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
    autoPlace([node("B"), node("A")], [edge("specialize", "B", "A")], pos, { id: "structure", label: "ブロック定義図", std: "GeneralView", depth: true }, null);
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

describe("boxesOf・stackedHeight・stackedWidth・placeNested（内部ブロック図の入れ子）", () => {
  const node = (key: string, container?: string): ModelNode => ({
    key, name: key, short: "", kind: "part", isDef: false, fam: "part", trans: [], ports: [], phase: null, phaseOwn: false,
    ...(container ? { container } : {}),
    entry: { kind: "part", isDef: false, short: "", name: key, type: "", owner: null, pe: null, start: 0, headEnd: 0, end: 0, head: "", exprs: [], children: [], idx: 0 },
  });
  const nodes = [node("u:a"), node("u:a.x", "u:a"), node("u:a.y", "u:a"), node("u:b")];

  it("中に部品を描く部品は、自身の座標によらず中の部品をすべて囲む", () => {
    // Act
    const box = boxesOf(nodes, { "u:a": [999, 999], "u:a.x": [100, 100], "u:a.y": [100, 200] }).get("u:a");
    // Assert
    expect(box).toEqual({ x: 100 - NEST_PAD, y: 100 - NEST_TOP, w: W + 2 * NEST_PAD, h: 144 - 100 + 100 + NEST_TOP + NEST_PAD });
  });

  it("並べるときの高さは、中の部品を縦に積んだ高さ。中に部品が無ければふつうの高さ（境界値）", () => {
    // Act
    const [a, b] = [stackedHeight(nodes[0] as ModelNode, nodes), stackedHeight(nodes[3] as ModelNode, nodes)];
    // Assert
    expect(a).toBe(NEST_TOP + 44 + 30 + 44 + NEST_PAD);
    expect(b).toBe(44);
  });

  it("座標の無い中の部品は、外の部品の中に縦に積む", () => {
    // Arrange
    const pos: Record<string, [number, number]> = { "u:a": [0, 0] };
    // Act
    placeNested(nodes, pos);
    // Assert
    expect([pos["u:a.x"], pos["u:a.y"]]).toEqual([[NEST_PAD, NEST_TOP], [NEST_PAD, NEST_TOP + 44 + 30]]);
    expect(boxesOf(nodes, pos).get("u:a")).toEqual({ x: 0, y: 0, w: W + 2 * NEST_PAD, h: stackedHeight(nodes[0] as ModelNode, nodes) });
  });

  it("3 段目の入れ子：中の中の部品の高さと幅まで数えて積み、外の部品の矩形はすべてを囲む", () => {
    // Arrange（u:a の中に u:a.x（その中に u:a.x.v）と u:a.y）
    const deep = [node("u:a"), node("u:a.x", "u:a"), node("u:a.x.v", "u:a.x"), node("u:a.y", "u:a")];
    const pos: Record<string, [number, number]> = { "u:a": [0, 0] };
    // Act
    placeNested(deep, pos);
    // Assert
    const inner = NEST_TOP + 44 + NEST_PAD;
    expect([pos["u:a.x"], pos["u:a.x.v"], pos["u:a.y"]]).toEqual([[NEST_PAD, NEST_TOP], [2 * NEST_PAD, 2 * NEST_TOP], [NEST_PAD, NEST_TOP + inner + 30]]);
    expect(stackedHeight(deep[0] as ModelNode, deep)).toBe(NEST_TOP + inner + 30 + 44 + NEST_PAD);
    expect(stackedWidth(deep[0] as ModelNode, deep)).toBe(W + 4 * NEST_PAD);
    expect(boxesOf(deep, pos).get("u:a")).toEqual({ x: 0, y: 0, w: W + 4 * NEST_PAD, h: stackedHeight(deep[0] as ModelNode, deep) });
  });

  it("中に部品が無ければ、並べるときの幅はふつうの幅（境界値）", () => {
    // Act
    const w = stackedWidth(nodes[3] as ModelNode, nodes);
    // Assert
    expect(w).toBe(W);
  });

  it("外の部品に座標が無ければ、中の部品を置かない（異常系）", () => {
    // Arrange
    const pos: Record<string, [number, number]> = {};
    // Act
    placeNested(nodes, pos);
    // Assert
    expect(pos).toEqual({});
  });
});

describe("keywordOf（見出しのキーワード、8.2.2.9 の individual）", () => {
  /** 図の要素を、種類と修飾だけ指定して作る。 */
  const node = (kind: string, mods: string): ModelNode => ({
    key: "A", name: "A", short: "", kind, isDef: kind.endsWith(" def"), fam: "part", trans: [], ports: [], phase: null, phaseOwn: false,
    entry: { kind, isDef: kind.endsWith(" def"), short: "", name: "A", type: "", owner: null, pe: null, start: 0, headEnd: 0, end: 0, head: "", exprs: [], children: [], idx: 0, mods },
  });

  it("個体なら、種類の前に individual を付ける", () => {
    // Act
    const k = keywordOf(node("part def", "individual"));
    // Assert
    expect(k).toBe("individual part def");
  });

  it("ほかの修飾だけなら、種類のまま（individual を含む語と取り違えない）", () => {
    // Act
    const [plain, other] = [keywordOf(node("part def", "abstract")), keywordOf(node("part", "individualish"))];
    // Assert
    expect([plain, other]).toEqual(["part def", "part"]);
  });
});

describe("メモ（8.2.3.4 の comment）", () => {
  /** メモの図の要素を、名前と本文だけ指定して作る。 */
  const note = (key: string, name: string, body: string): ModelNode => ({
    key, name, short: "", kind: "comment", isDef: false, fam: "other", trans: [], ports: [], phase: null, phaseOwn: false, note: true,
    entry: { kind: "comment", isDef: false, short: "", name, type: "", owner: null, pe: null, start: 0, headEnd: 0, end: 0, head: "", exprs: [], children: [], idx: 0, body },
  });
  /** 幅 W・高さ 44 の要素。 */
  const block = (key: string): ModelNode => ({
    key, name: key, short: "", kind: "part def", isDef: true, fam: "part", trans: [], ports: [], phase: null, phaseOwn: false,
    entry: { kind: "part def", isDef: true, short: "", name: key, type: "", owner: null, pe: null, start: 0, headEnd: 0, end: 0, head: "", exprs: [], children: [], idx: 0 },
  });
  const annotate = (from: string, to: string): ModelEdge => ({ id: `annotate|${from}|${to}`, kind: "annotate", from, to, label: "", src: { start: 0, end: 0 } });

  it("noteLines は本文の改行を保ち、6 行を超えたら最後の行を「…」で切る", () => {
    // Act
    const [two, many, empty] = [noteLines("1 行目\n2 行目"), noteLines("a\nb\nc\nd\ne\nf\ng"), noteLines("")];
    // Assert
    expect(two.map((l) => l.t)).toEqual(["1 行目", "2 行目"]);
    expect(many.map((l) => l.t)).toEqual(["a", "b", "c", "d", "e", "…"]);
    expect(empty).toEqual([]);
  });

  it("nodeH は、名前の無いメモは本文だけ、名前のあるメモは名前の行の分だけ高い", () => {
    // Act
    const [unnamed, named] = [nodeH(note("note:#1", "", "x")), nodeH(note("note:c", "c", "x"))];
    // Assert
    expect([unnamed, named]).toEqual([33, 51]);
  });

  it("placeNotes は、座標の無いメモを注釈する要素の右に置き、右がふさがっていれば上に置く", () => {
    // Arrange
    const [A, B, N] = [block("A"), block("B"), note("note:#1", "", "x")];
    const free: Record<string, [number, number]> = { A: [0, 0] };
    const blocked: Record<string, [number, number]> = { A: [0, 0], B: [264, 0] };
    // Act
    placeNotes([A, N], [annotate("note:#1", "A")], free);
    placeNotes([A, B, N], [annotate("note:#1", "A")], blocked);
    // Assert
    expect(free["note:#1"]).toEqual([W + 40, 0]);
    expect(blocked["note:#1"]).toEqual([0, -73]);
  });

  it("placeNotes は、相手に座標が無ければ置かず、置いたメモは動かさない（境界）", () => {
    // Arrange
    const [A, N, M] = [block("A"), note("note:#1", "", "x"), note("note:#2", "", "y")];
    const pos: Record<string, [number, number]> = { "note:#2": [5, 5] };
    // Act
    placeNotes([A, N, M], [annotate("note:#1", "A"), annotate("note:#2", "A")], pos);
    // Assert
    expect(pos).toEqual({ "note:#2": [5, 5] });
  });
});
