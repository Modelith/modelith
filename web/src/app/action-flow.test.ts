// アクションの流れの図（ActionFlowView、8.2.3.17）の中身と、その描き方。要素のキーと線の ID は、Rust のコアが決めたものを使う（ADR-0016）。
import { describe, expect, it } from "vitest";
import { build, parse, type Model, type ModelNode } from "../core";
import { canSucceed, defaultFlowContext, flowBodyLines, flowContentOf, flowContexts, flowDetail, flowLayers, flowName, flowShape } from "./action-flow";
import { autoPlace, boxesOf, computeRoutes, compartment, flowSize, nodeW, W, type NodeBox } from "./geometry";
import { kindLabel } from "./labels";
import { relOptions } from "./relations";
import { emptyView } from "./layout";
import { CV, edgeStroke, kindIcon, svgMarkup } from "./svg";

const TEA =
  "package P { item def Water; action def MakeTea { in item cold : Water; out item tea : Water; " +
  "action boil { in item w : Water; out item hot : Water; } action brew { in water : Water; out t : Water; } " +
  "flow cold to boil.w; flow of Water from boil.hot to brew.water; flow brew.t to tea; } }";

const NESTED =
  "package P { action def A { first start then boil; action boil { first start then heat; action heat; then wait; action wait; } " +
  "first boil then c; action c; } }";

const LANES =
  "package P { action def MakeTea { first start then boil; action boil; then pour; action pour; then done; } " +
  "action makeTea : MakeTea; part kettle { perform makeTea; part heater { perform makeTea.boil; } part ctrl { perform makeTea.pour; } } }";

const TEXT =
  "package P { action def A { first start; then action a : Heat; then decide d; if x > 0 then s; else c; " +
  "action s send S() to b; action c; first s then done; first c then done; } action def Heat; action def Idle; }";

/**
 * テキストからモデルと、アクションの流れの図の対象を作る。
 *
 * @param text SysML v2 のテキスト
 * @param ctx 対象のアクション定義の名前
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

describe("flowContentOf（アクションの流れの図の中身）", () => {
  it("アクション定義の要素を種類 flow の要素に、継起を線にする（開始・終了の宣言はアクション定義）", () => {
    // Arrange
    const { M, c } = setup(TEXT, "A");
    // Act
    const { nodes, edges } = flowContentOf(M, c);
    // Assert
    expect(nodes.map((n) => [n.key, n.kind, n.flow])).toEqual([
      ["a:start", "start", true],
      ["a:a", "action", true],
      ["a:d", "decide", true],
      ["a:s", "send", true],
      ["a:c", "action", true],
      ["a:done", "done", true],
    ]);
    expect(nodeOf(nodes, "a:start").entry.name).toBe("A");
    expect(edges.map((e) => [e.kind, e.from, e.to, e.label])).toEqual([
      ["succession", "a:start", "a:a", ""],
      ["succession", "a:a", "a:d", ""],
      ["succession", "a:d", "a:s", "[x > 0]"],
      ["succession", "a:d", "a:c", "[else]"],
      ["succession", "a:s", "a:done", ""],
      ["succession", "a:c", "a:done", ""],
    ]);
  });

  it("流れの無いアクション定義は、要素も線も無い（境界値）", () => {
    // Arrange
    const { M, c } = setup(TEXT, "Idle");
    // Act
    const content = flowContentOf(M, c);
    // Assert
    expect(content).toEqual({ nodes: [], edges: [], boundary: [], lanes: [] });
  });

  it("アクションのパラメータを接続点に、アクション定義そのもののパラメータを枠の上の要素に、パラメータの間の流れを線にする（8.2.3.17）", () => {
    // Arrange
    const { M, c } = setup(TEA, "MakeTea");
    // Act
    const { nodes, edges, boundary } = flowContentOf(M, c);
    // Assert
    expect(nodeOf(nodes, "a:boil").ports.map((p) => [p.name, p.dir])).toEqual([["w", "in"], ["hot", "out"]]);
    expect(boundary.map((b) => [b.key, b.boundary, b.entry.name])).toEqual([["b:cold", "in", "cold"], ["b:tea", "out", "tea"]]);
    expect(edges.map((e) => [e.id, e.fromPort, e.toPort])).toEqual([
      ["flow|b:cold|a:boil|#1", undefined, "port:w"],
      ["flow|a:boil|a:brew|Water#1", "port:hot", "port:water"],
      ["flow|a:brew|b:tea|#1", "port:t", undefined],
    ]);
  });

  it("入れ子の本体の要素は、その本体を持つアクションを container に持ち、中の線もそのまま使う（8.2.3.17 の action-body）", () => {
    // Arrange
    const { M, c } = setup(NESTED, "A");
    // Act
    const { nodes, edges } = flowContentOf(M, c);
    // Assert
    expect(nodes.map((n) => [n.key, n.container ?? null])).toEqual([
      ["a:start", null],
      ["a:boil", null],
      ["a:boil.start", "a:boil"],
      ["a:boil.heat", "a:boil"],
      ["a:boil.wait", "a:boil"],
      ["a:c", null],
    ]);
    expect(edges.map((e) => e.id)).toContain("succession|a:boil.heat|a:boil.wait|#1");
  });

  it("要素を受け持つ部品ごとの区画（swimlane）をそのまま使う（8.2.3.17）", () => {
    // Arrange
    const { M, c } = setup(LANES, "MakeTea");
    // Act
    const { lanes } = flowContentOf(M, c);
    // Assert
    expect(lanes.map((l) => [l.key, l.name, l.entry.name, l.nodes])).toEqual([
      ["lane:kettle.heater", "kettle.heater", "heater", ["a:boil"]],
      ["lane:kettle.ctrl", "kettle.ctrl", "ctrl", ["a:pour"]],
    ]);
  });

  it("対象にできるのはアクション定義で、既定の対象は線の最も多いもの", () => {
    // Arrange
    const { M } = setup(TEXT, "A");
    // Act
    const [all, first] = [flowContexts(M).map((n) => n.key), defaultFlowContext(M)?.key];
    // Assert
    expect(all).toEqual(["A", "Heat", "Idle"]);
    expect(first).toBe("A");
  });
});

describe("flowShape・flowDetail・flowBodyLines（8.2.3.17 の記号と書く中身）", () => {
  it.each([
    ["start", "start"],
    ["done", "done"],
    ["fork", "bar"],
    ["join", "bar"],
    ["decide", "diamond"],
    ["merge", "diamond"],
    ["send", "send"],
    ["accept", "accept"],
    ["assign", "action"],
    ["if", "action"],
  ])("%s の形は %s", (kind, shape) => {
    // Act
    const got = flowShape(kind);
    // Assert
    expect(got).toBe(shape);
  });

  it("送る・受ける・代入・条件は、種類の語の後ろを、アクションは型を書く", () => {
    // Arrange
    const { M, c } = setup(
      "package P { action def A { action s send S() to b; accept e : E via p; assign x := 1; if x > 0 { action t; } action a : Heat; fork f; } action def Heat; part def E; }",
      "A",
    );
    // Act
    const details = flowContentOf(M, c).nodes.map(flowDetail);
    // Assert
    expect(details).toEqual(["S() to b", "e : E via p", "x := 1", "x > 0", ": Heat", ""]);
  });

  it("if は then の本体と else の本体を分けて書く（else if も else の側）", () => {
    // Arrange
    const P = parse("package P { action def A { if x { action a; action b; } else if y { action c; } } }");
    const ifNode = P.entries.find((e) => e.kind === "if" && e.pe?.name === "A");
    if (!ifNode) throw new Error("if がありません");
    // Act
    const lines = flowBodyLines(ifNode);
    // Assert
    expect(lines).toEqual(["then: a, b", "else: if"]);
  });
});

describe("アクションの流れの図の大きさと線（geometry）", () => {
  it("記号だけの要素は決まった大きさ、名前と中身のある送るは 2 行分の高さ", () => {
    // Arrange
    const { M, c } = setup(TEXT, "A");
    const { nodes } = flowContentOf(M, c);
    // Act
    const sizes = ["a:start", "a:d", "a:s", "a:done"].map((k) => flowSize(nodeOf(nodes, k)));
    // Assert
    expect(sizes).toEqual([
      { w: 22, h: 22 },
      { w: 34, h: 34 },
      { w: 168, h: 58 },
      { w: 26, h: 26 },
    ]);
    expect(nodeW(nodeOf(nodes, "a:a"))).toBe(168);
    expect(nodeW(M.nodes[0] as ModelNode)).toBe(W);
  });

  it("if の区画には本体のアクションを書く", () => {
    // Arrange
    const { M, c } = setup("package P { action def A { if x { action a; } else { action b; } } }", "A");
    const [ifNode] = flowContentOf(M, c).nodes;
    if (!ifNode) throw new Error("if がありません");
    // Act
    const lines = compartment(ifNode);
    // Assert
    expect(lines).toEqual([
      { t: "then: a", cls: "attr" },
      { t: "else: b", cls: "attr" },
    ]);
  });

  it("ひし形から出る線は、相手が複数でも辺の中央（頂点）から出す", () => {
    // Arrange
    const { M, c } = setup(TEXT, "A");
    const { nodes, edges } = flowContentOf(M, c);
    const pos = { "a:d": [100, 0] as [number, number], "a:s": [0, 200] as [number, number], "a:c": [300, 200] as [number, number] };
    const rects = boxesOf(nodes, pos);
    const box = new Map<string, NodeBox>(nodes.filter((n) => pos[n.key as keyof typeof pos]).map((n) => [n.key, { ...(rects.get(n.key) as NodeBox), n, pins: [] }]));
    // Act
    const routes = computeRoutes(box, edges, undefined, "ortho");
    // Assert
    const starts = edges.flatMap((e) => (routes.get(e.id) ? [routes.get(e.id)?.from.t] : []));
    expect(starts).toEqual([0.5, 0.5]);
  });
});

describe("flowLayers・autoPlace（アクションの流れの図を上から並べる）", () => {
  const LOOP =
    "package P { action def A { first start; then action a; then fork f; then b; then c; action b; action c; " +
    "first b then j; first c then j; join j; then decide d; if x then a; else done; succession flow from a to c; } }";

  it("継起の最も長い道のりの段にし、同じ分岐から出た要素は同じ段、繰り返しの戻りの線は数えない", () => {
    // Arrange
    const { M, c } = setup(LOOP, "A");
    const { nodes, edges } = flowContentOf(M, c);
    // Act
    const layers = flowLayers(nodes, edges);
    // Assert
    expect(Object.fromEntries(layers)).toEqual({ "a:start": 0, "a:a": 1, "a:f": 2, "a:b": 3, "a:c": 3, "a:j": 4, "a:d": 5, "a:done": 6 });
  });

  it("パラメータの間の流れも段を決め、枠の上のパラメータへの流れは段を決めない", () => {
    // Arrange
    const { M, c } = setup(TEA, "MakeTea");
    const { nodes, edges } = flowContentOf(M, c);
    // Act
    const layers = flowLayers(nodes, edges);
    // Assert
    expect(Object.fromEntries(layers)).toEqual({ "a:boil": 0, "a:brew": 1 });
  });

  it("つながらない要素は最初の段（境界値）", () => {
    // Arrange
    const { M, c } = setup("package P { action def A { action a; action b; } }", "A");
    const { nodes, edges } = flowContentOf(M, c);
    // Act
    const layers = flowLayers(nodes, edges);
    // Assert
    expect([...layers.values()]).toEqual([0, 0]);
  });

  it("autoPlace は段の決め方（layer）で上から並べ、狭い記号を列の中央に置く", () => {
    // Arrange
    const { M, c } = setup(LOOP, "A");
    const { nodes, edges } = flowContentOf(M, c);
    const pos: Record<string, [number, number]> = {};
    // Act
    autoPlace(nodes, edges, pos, { id: "afv", label: "", std: "ActionFlowView", layer: flowLayers }, null, 0, (n) => flowSize(n).h, nodeW);
    // Assert
    const ys = ["a:start", "a:a", "a:f", "a:b", "a:c"].map((k) => pos[k]?.[1]);
    expect(ys[0]).toBeLessThan(ys[1] ?? 0);
    expect(ys[3]).toBe(ys[4]);
    // 開始（幅 22）とアクション（幅 168）の中心は、10 単位に丸めた分を除いてそろう
    const center = (k: string, w: number): number => (pos[k]?.[0] ?? 0) + w / 2;
    expect(Math.abs(center("a:start", 22) - center("a:a", 168))).toBeLessThanOrEqual(10);
  });
});

describe("アクションの流れの図の記法（svg）", () => {
  it("継起は実線と開いた矢印、順序付きの流れは破線と開いた矢印（8.2.3.17）", () => {
    // Act
    const [succession, flow] = [edgeStroke("succession"), edgeStroke("successionFlow")];
    // Assert
    expect(succession).toBe(' marker-end="url(#mOpen)"');
    expect(flow).toBe(' stroke-dasharray="6 4" marker-end="url(#mOpen)"');
  });

  it("開始は塗った丸、終了は丸の中の丸、判断はひし形、送るは五角形、アクションは角の丸い四角に描き、ガードをラベルにする", () => {
    // Arrange
    const { M, c } = setup(TEXT, "A");
    const content = flowContentOf(M, c);
    const L = emptyView();
    content.nodes.forEach((n, i) => (L.pos[n.key] = [0, i * 100]));
    // Act
    const { es, ns } = svgMarkup(CV, content, L, { view: "afv" });
    // Assert
    const node = (k: string): string => ns.slice(ns.indexOf(`data-key="${k}"`), ns.indexOf("</g>", ns.indexOf(`data-key="${k}"`)));
    expect(node("a:start")).toContain('<circle class="body" cx="11" cy="11" r="11" fill="var(--ink)"');
    expect(node("a:done")).toContain('<circle cx="13" cy="13" r="8" fill="var(--ink)"/>');
    expect(node("a:d")).toContain('<path class="body" d="M17,0 L34,17 L17,34 L0,17 Z"');
    expect(node("a:d")).toContain(">d</text>");
    expect(node("a:s")).toContain('<path class="body" d="M0,0 H152 L168,29 L152,58 H0 Z"');
    expect(node("a:s")).toContain("«send»");
    expect(node("a:a")).toContain('<rect class="body" width="168" height="44" rx="10"');
    expect(node("a:a")).toContain(">a : Heat</text>");
    expect(es).toContain(">[x &gt; 0]</text>");
  });

  it("中にアクションの流れを描くアクションは、中の要素を囲む大きさで描き、見出しの下を区切る（区画の行は書かない）", () => {
    // Arrange
    const { M, c } = setup(NESTED, "A");
    const content = flowContentOf(M, c);
    const L = emptyView();
    content.nodes.forEach((n, i) => (L.pos[n.key] = [100, i * 100]));
    // Act
    const { es } = svgMarkup(CV, content, L, { view: "afv" });
    // Assert（中に要素を描く要素は、線より下（es）に描く）
    const boil = es.slice(es.indexOf('data-key="a:boil"'), es.indexOf("</g>", es.indexOf('data-key="a:boil"')));
    expect(boil).toContain('fill-opacity=".55"');
    expect(boil).toContain('y1="40" y2="40"');
    expect(boil).toContain(">boil</text>");
  });

  it("区画は破線の四角に «performer» と部品の道のりを書き、枠の中に描く（8.2.3.17 の swimlane）", () => {
    // Arrange
    const { M, c } = setup(LANES, "MakeTea");
    const content = { ...flowContentOf(M, c), frame: { kind: "action def", title: "MakeTea" } };
    const L = emptyView();
    content.nodes.forEach((n, i) => (L.pos[n.key] = [i * 200, i * 100]));
    // Act
    const { es } = svgMarkup(CV, content, L, { view: "afv" });
    // Assert（区画は枠の後ろ、要素の下に描く）
    const lane = es.slice(es.indexOf('<g class="lane" data-lane="kettle.heater">'));
    expect(lane).toContain('stroke-dasharray="5 4"');
    expect(lane).toContain(">«performer»</text>");
    expect(lane).toContain(">kettle.heater</text>");
    expect(es.indexOf("«action def»")).toBeLessThan(es.indexOf('class="lane"'));
  });

  it("パラメータは要素の縁の接続点に、アクション定義そのもののパラメータは枠の上の四角に描く", () => {
    // Arrange
    const { M, c } = setup(TEA, "MakeTea");
    const content = { ...flowContentOf(M, c), frame: { kind: "action def", title: "MakeTea" } };
    const L = emptyView();
    content.nodes.forEach((n, i) => (L.pos[n.key] = [0, i * 120]));
    // Act
    const { ns } = svgMarkup(CV, content, L, { view: "afv" });
    // Assert
    expect(ns).toContain('<g class="pin" data-node="a:boil" data-pin="port:w">');
    expect(ns).toContain('<g class="boundary" data-key="b:cold"');
    expect(ns).toContain(">tea</text>");
  });
});

describe("アクションの流れの要素の名前とアイコン（ADR-0014）", () => {
  it.each([
    ["fork", "分岐（並行）"],
    ["decide", "分岐（条件）"],
    ["send", "送信"],
    ["accept", "受信"],
    ["for", "要素ごとの繰り返し"],
    ["done", "終了"],
  ])("%s は「%s」と出す", (kind, label) => {
    // Act
    const got = kindLabel(kind);
    // Assert
    expect(got).toBe(label);
  });

  it("ツリーのアイコンは振る舞いの色で、略号を書く", () => {
    // Act
    const icon = kindIcon("fork");
    // Assert
    expect(icon).toContain('fill="var(--k-beh-bg)"');
    expect(icon).toContain(">Fk</text>");
  });
});

describe("canSucceed・relOptions・flowName（図から順序の線を引く）", () => {
  const FLOW = "package P { action def A { first start; then action a; then action b; send S() to b; then done; } }";

  it("名前のある要素どうしは、順序の線だけを引ける", () => {
    // Arrange
    const { M, c } = setup(FLOW, "A");
    const { nodes } = flowContentOf(M, c);
    // Act
    const opts = relOptions(nodeOf(nodes, "a:a"), nodeOf(nodes, "a:b"));
    // Assert
    expect(opts).toEqual([{ rel: "succession", label: "この後に実行する（順序 succession）" }]);
  });

  it("入れ子の本体の中と外の要素の間には引けず、同じ本体の中どうしなら引ける", () => {
    // Arrange
    const { M, c } = setup(NESTED, "A");
    const { nodes } = flowContentOf(M, c);
    // Act / Assert
    expect(canSucceed(nodeOf(nodes, "a:boil.heat"), nodeOf(nodes, "a:c"))).toBe(false);
    expect(canSucceed(nodeOf(nodes, "a:boil.wait"), nodeOf(nodes, "a:boil.heat"))).toBe(true);
  });

  it.each([
    ["a:b", "a:start", "開始へ向かう"],
    ["a:done", "a:a", "終了から始まる"],
    ["a:a", "a:#1", "名前の無い要素へ"],
    ["a:a", "a:a", "同じ要素へ"],
  ])("%s から %s へは引けない（異常系：%s）", (from, to) => {
    // Arrange
    const { M, c } = setup(FLOW, "A");
    const { nodes } = flowContentOf(M, c);
    // Act
    const ok = canSucceed(nodeOf(nodes, from), nodeOf(nodes, to));
    // Assert
    expect(ok).toBe(false);
  });

  it("開始・終了・名前の無い要素は、種類の画面の言葉で出す", () => {
    // Arrange
    const { M, c } = setup(FLOW, "A");
    const { nodes } = flowContentOf(M, c);
    // Act
    const names = nodes.map(flowName);
    // Assert
    expect(names).toEqual(["開始", "a", "b", "送信", "終了"]);
  });
});
