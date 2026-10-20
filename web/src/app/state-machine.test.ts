// 状態遷移の図（StateTransitionView、8.2.3.18）の中身と、その描き方。要素のキーと線の ID は、Rust のコアが決めたものを使う（ADR-0016）。
import { describe, expect, it } from "vitest";
import { build, parse, type Model, type ModelNode } from "../core";
import { boxesOf, compartment, layoutStates, nodeH, nodeW, regionSeparators, stateColumns, stateSize, type NodeBox } from "./geometry";
import { emptyView } from "./layout";
import { defaultStateContext, isPseudoState, stateActionLines, stateContentOf, stateContexts } from "./state-machine";
import { CV, edgeStroke, svgMarkup } from "./svg";

const TEXT =
  "package P { state def S { entry; then off; state off; accept Go then on; " +
  "state on parallel { state heat { entry; then low; state low; state high; } state fan; } " +
  "transition t first on accept Stop if ready do beep then off; transition first off then done; } state def Lamp; }";

/**
 * テキストからモデルと、状態遷移の図の対象を作る。
 *
 * @param text SysML v2 のテキスト
 * @param ctx 対象の状態定義の名前
 * @returns モデルと対象のノード
 */
function setup(text: string, ctx: string): { M: Model; c: ModelNode } {
  const M = build(parse(text));
  const c = M.nodes.find((n) => n.key === ctx);
  if (!c) throw new Error(`${ctx} がありません`);
  return { M, c };
}

/**
 * 中身の要素をキーで探す。
 *
 * @param nodes 要素
 * @param key 要素のキー
 * @returns 要素
 */
function nodeOf(nodes: ModelNode[], key: string): ModelNode {
  const n = nodes.find((x) => x.key === key);
  if (!n) throw new Error(`${key} がありません`);
  return n;
}

describe("stateContentOf（状態遷移の図の中身）", () => {
  it("状態を種類 state の要素に、入れ子の状態は外の状態を container に持たせ、遷移を線にする", () => {
    // Arrange
    const { M, c } = setup(TEXT, "S");
    // Act
    const { nodes, edges } = stateContentOf(M, c);
    // Assert
    expect(nodes.map((n) => [n.key, n.kind, n.container ?? null])).toEqual([
      ["s:#start", "start", null],
      ["s:off", "state", null],
      ["s:on", "state", null],
      ["s:on.heat", "state", "s:on"],
      ["s:on.heat#start", "start", "s:on.heat"],
      ["s:on.heat.low", "state", "s:on.heat"],
      ["s:on.heat.high", "state", "s:on.heat"],
      ["s:on.fan", "state", "s:on"],
      ["s:#done", "done", null],
    ]);
    expect(nodes.every((n) => n.state)).toBe(true);
    expect(nodeOf(nodes, "s:#start").entry.name).toBe("S");
    expect(edges.map((e) => [e.from, e.to, e.label])).toEqual([
      ["s:#start", "s:off", ""],
      ["s:off", "s:on", "Go"],
      ["s:on.heat#start", "s:on.heat.low", ""],
      ["s:on", "s:off", "Stop [ready] / beep"],
      ["s:off", "s:#done", ""],
    ]);
  });

  it("並行の状態のキーを regions に入れる（中の状態は、破線で区切った領域）", () => {
    // Arrange
    const { M, c } = setup(TEXT, "S");
    // Act
    const { regions } = stateContentOf(M, c);
    // Assert
    expect(regions).toEqual(["s:on"]);
  });

  it("状態定義そのものが並行なら、regions に空のキーを入れる（境界値）", () => {
    // Arrange
    const { M, c } = setup("package P { state def S parallel { state a; state b; } }", "S");
    // Act
    const { regions } = stateContentOf(M, c);
    // Assert
    expect(regions).toEqual([""]);
  });

  it("状態定義でない対象は、空の中身にする（異常系）", () => {
    // Arrange
    const { M } = setup(TEXT, "S");
    const other = { ...nodeOf(M.nodes, "S"), key: "Gone" };
    // Act
    const content = stateContentOf(M, other);
    // Assert
    expect(content).toEqual({ nodes: [], edges: [], regions: [] });
  });
});

describe("stateContexts・defaultStateContext（対象の選び方）", () => {
  it("状態定義を集め、既定は遷移の最も多い状態定義にする", () => {
    // Arrange
    const { M } = setup(TEXT, "S");
    // Act
    const all = stateContexts(M).map((n) => n.key);
    const def = defaultStateContext(M)?.key;
    // Assert
    expect(all).toEqual(["S", "Lamp"]);
    expect(def).toBe("S");
  });

  it("状態定義が無ければ、既定の対象は無い（境界値）", () => {
    // Arrange
    const M = build(parse("package P { part def A; }"));
    // Act
    const def = defaultStateContext(M);
    // Assert
    expect(def).toBeNull();
  });
});

describe("状態の区画と大きさ（geometry）", () => {
  const { M, c } = setup("package P { state def S { state on { entry action init; do heat; exit send Off() to h; } state off; } }", "S");
  const { nodes } = stateContentOf(M, c);

  it("entry・do・exit の振る舞いを `entry / 振る舞い` の行にする（action a は a）", () => {
    // Arrange
    const on = nodeOf(nodes, "s:on");
    // Act
    const lines = stateActionLines(on.entry);
    // Assert
    expect(lines).toEqual(["entry / init", "do / heat", "exit / send Off() to h"]);
    expect(compartment(on).map((l) => l.t)).toEqual(lines);
  });

  it("状態の高さは、見出しに区画の行を足し、振る舞いの無い状態は見出しだけ（境界値）", () => {
    // Arrange
    const on = nodeOf(nodes, "s:on"), off = nodeOf(nodes, "s:off");
    // Act
    const sizes = [stateSize(on), stateSize(off)];
    // Assert
    // 幅は、いちばん長い行（exit / send Off() to h）が収まるよう 10 単位で広げる
    expect(sizes).toEqual([{ w: 170, h: 36 + 3 * 15 + 10 }, { w: 150, h: 36 }]);
    expect([nodeW(off), nodeH(off)]).toEqual([150, 36]);
  });

  it("開始と終了は、決まった大きさの丸にする", () => {
    // Arrange
    const { M: M2, c: c2 } = setup("package P { state def S { entry; then a; state a; transition first a then done; } }", "S");
    const ns = stateContentOf(M2, c2).nodes;
    // Act
    const sizes = ns.filter(isPseudoState).map((n) => [n.kind, stateSize(n)]);
    // Assert
    expect(sizes).toEqual([
      ["start", { w: 22, h: 22 }],
      ["done", { w: 26, h: 26 }],
    ]);
    expect(compartment(nodeOf(ns, "s:#start"))).toEqual([]);
  });
});

describe("入れ子の状態の配置（layoutStates・boxesOf）", () => {
  it("遷移の向きに左から右へ列にし、戻りの遷移は数えない（stateColumns）", () => {
    // Arrange
    const pairs: [string, string][] = [["start", "off"], ["off", "on"], ["on", "off"]];
    // Act
    const cols = stateColumns(["start", "off", "on"], pairs);
    // Assert
    expect([...cols]).toEqual([["start", 0], ["off", 1], ["on", 2]]);
  });

  it("中の状態は外の状態の中に並び、外の状態の矩形は中の状態をすべて囲む（2 段の入れ子）", () => {
    // Arrange
    const { M, c } = setup(TEXT, "S");
    const { nodes, edges, regions } = stateContentOf(M, c);
    // Act
    const pos = layoutStates(nodes, edges, regions);
    const boxes = boxesOf(nodes, pos);
    // Assert
    const inside = (inner: string, outer: string): boolean => {
      const a = boxes.get(inner), b = boxes.get(outer);
      return !!a && !!b && a.x > b.x && a.y > b.y && a.x + a.w < b.x + b.w && a.y + a.h < b.y + b.h;
    };
    expect(inside("s:on.heat", "s:on")).toBe(true);
    expect(inside("s:on.heat.low", "s:on.heat")).toBe(true);
    expect(inside("s:on.fan", "s:on")).toBe(true);
    expect(boxes.get("s:on")?.x).toBe(pos["s:on"]?.[0]);
    const x = (k: string): number => pos[k]?.[0] ?? -1;
    expect(x("s:#start") < x("s:off") && x("s:off") < x("s:on")).toBe(true);
  });

  it("並行の状態の領域は上から下へ積み、間に破線の位置を求める（regionSeparators）", () => {
    // Arrange
    const { M, c } = setup(TEXT, "S");
    const { nodes, edges, regions } = stateContentOf(M, c);
    const boxes = boxesOf(nodes, layoutStates(nodes, edges, regions));
    const heat = boxes.get("s:on.heat")!, fan = boxes.get("s:on.fan")!, on = boxes.get("s:on")!;
    // Act
    const seps = regionSeparators(on, [fan, heat]);
    // Assert
    expect(fan.y).toBeGreaterThan(heat.y + heat.h);
    expect(seps).toEqual([{ x1: on.x, x2: on.x + on.w, y: Math.round((heat.y + heat.h + fan.y) / 2) }]);
  });

  it("領域が 1 つなら破線は無い（境界値）", () => {
    // Arrange
    const outer = { x: 0, y: 0, w: 100, h: 100 };
    // Act
    const seps = regionSeparators(outer, [{ x: 10, y: 10, w: 20, h: 20 }]);
    // Assert
    expect(seps).toEqual([]);
  });

  it("要素が無ければ、座標も無い（境界値）", () => {
    // Act
    const pos = layoutStates([], [], []);
    // Assert
    expect(pos).toEqual({});
  });
});

describe("状態遷移の図の描き方（svg）", () => {
  /**
   * 状態遷移の図を、自動の配置で SVG にする。
   *
   * @param text SysML v2 のテキスト
   * @returns 線と要素のマークアップと矩形
   */
  function draw(text: string): { es: string; ns: string; box: Map<string, NodeBox> } {
    const { M, c } = setup(text, "S");
    const content = { ...stateContentOf(M, c), frame: { kind: "state def", title: "S" } };
    const L = { ...emptyView(), pos: layoutStates(content.nodes, content.edges, content.regions) };
    return svgMarkup(CV, content, L, { view: "stm" });
  }

  it("状態は角の丸い四角に名前と区画、開始は塗った丸、終了は丸の中の塗った丸で描く（8.2.3.18）", () => {
    // Act
    const { ns } = draw("package P { state def S { entry; then on; state on { entry action init; } transition first on then done; } }");
    // Assert
    expect(ns).toMatch(/data-key="s:#start"[^>]*><circle class="body" cx="11" cy="11" r="11"/);
    expect(ns).toMatch(/data-key="s:#done"[^>]*><circle class="body"[^>]*\/><circle cx="13" cy="13" r="8"/);
    expect(ns).toMatch(/data-key="s:on"[^>]*><rect class="body" width="150" height="61" rx="14"/);
    expect(ns).toContain(">entry / init</text>");
  });

  it("遷移は実線の開いた矢印で、ラベルに トリガ [ガード] / 効果 を書く", () => {
    // Act
    const { es } = draw("package P { state def S { state a; state b; transition first a accept Go if x do beep then b; } }");
    // Assert
    expect(edgeStroke("transition")).toBe(' marker-end="url(#mOpen)"');
    expect(es).toContain('data-edge="transition|s:a|s:b|Go [x] / beep#1"');
    expect(es).toContain(">Go [x] / beep</text>");
  });

  it("中に状態を描く状態は線の下に描き、並行の状態の領域を破線で区切る", () => {
    // Act
    const { es, box } = draw("package P { state def S { state on parallel { state a; state b; } } }");
    // Assert
    expect(box.get("s:on")?.holds).toBe(true);
    expect(es).toMatch(/data-key="s:on"[^>]*><rect class="body"[^>]*fill-opacity="\.55"/);
    expect(es).toMatch(/<line class="region"[^>]*stroke-dasharray="6 4"\/>/);
  });
});
