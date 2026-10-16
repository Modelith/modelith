// Rust のモデル構築が、暫定コアのモデル構築と同じ結果を返すことを確かめる結合テスト（ADR-0016 の手順 A）。
// 同じ解析結果（Rust のパーサ）を両方に渡すので、パーサの違いに左右されずにモデル構築だけを比べられる。
// 入力は、ケースの途中まで書いたもの（書いている途中の形）と、ケースの行を乱数で組み合わせたもの。
import { describe, expect, it } from "vitest";
import { build as tsBuild } from "./model";
import { build as rustBuild, parse } from "./rust";
import type { Entry, Model, ParseResult } from "./types";

const cases = {
  ...import.meta.glob<string>("../../../reference/golden/cases/*.sysml", { eager: true, query: "?raw", import: "default" }),
  ...import.meta.glob<string>("../samples/*.sysml", { eager: true, query: "?raw", import: "default" }),
};

/** view・フェーズ・ポートなど、ケースに少ない書き方（乱数で組み合わせる行に混ぜる）。 */
const EXTRA_LINES = [
  "package Q {",
  "}",
  "enum def Stage { enum concept; enum detail; }",
  "metadata def Phase { attribute stage : Stage; }",
  "#Phase part def P1;",
  "requirement def R1 { @Phase { stage = concept; } }",
  "requirement def R2 { @Phase { stage = detail; } }",
  "#Phase requirement def R3;",
  "#derivation connection { end #original ::> R1; end #derive ::> R2; }",
  "part def P2 { @Phase { stage = concept; } }",
  "part def P3 { @Phase { stage = detail; } part p : P2; }",
  "port def Pt { in item x : Real; out item y : Real; }",
  "part def H { port a : Pt; port b : ~Pt; }",
  "part h : H;",
  "view def V : GeneralView { filter @PartDefinition; render asTreeDiagram; }",
  "view v1 : V { expose Q::*; }",
  "view v2 : InterconnectionView { expose Q::H::**; }",
  "view v3 { expose Q::P3; filter @Phase; }",
  "view v4 : GridView { expose Nope::X; render asElementTable; }",
  "view v5 : SequenceView { expose Q::*[@PartUsage]; filter @Foo; }",
  "view v6 { expose Q; expose Q::H; }",
  "connect h.a to h.b;",
  "flow from h.a.y to h.b.x;",
  "satisfy R by P1;",
  "requirement def R { doc /* r */ }",
  "verification def T { objective { verify R; } }",
];

const PHASE_DEFS = EXTRA_LINES.slice(2, 4);

/** 決まった種から作る乱数（テストを毎回同じにする）。 */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** モデルを、オブジェクトの参照を番号にした JSON で比べられる形にする。 */
function snapshot(P: ParseResult, M: Model): unknown {
  const ref = (e: Entry | null | undefined): number | null => (e ? P.entries.indexOf(e) : null);
  return {
    nodes: M.nodes.map((n) => ({ ...n, entry: ref(n.entry), ports: n.ports.map((p) => ({ ...p, entry: ref(p.entry) })) })),
    edges: M.edges.map((e) => ({ ...e, rel: e.rel ? P.rels.indexOf(e.rel) : null })),
    views: M.views.map((v) => ({ ...v, entry: ref(v.entry), targets: v.targets.map(ref), frames: v.frames.map((f) => ({ ...f, entry: ref(f.entry) })) })),
    problems: M.problems,
    phases: M.phases,
    phaseEnum: M.phaseEnum,
    nodeOf: [...M.nodeOf].map(([e, n]) => [ref(e), n.key]),
    byName: [...M.byName].map(([name, es]) => [name, es.map(ref)]),
    rels: M.rels === P.rels,
    phaseOf: P.entries.map((e) => {
      const p = M.phaseOf(e);
      return p && { ...p, holder: ref(p.holder) };
    }),
  };
}

/** 同じモデルになることを確かめ、比べたモデルを返す。 */
function expectSameModel(text: string): Model {
  // Arrange
  const P = parse(text);
  // Act
  const M = rustBuild(P);
  // Assert
  expect(snapshot(P, M), text).toEqual(snapshot(P, tsBuild(P)));
  return M;
}

describe("Rust のモデル構築と暫定コアの一致", () => {
  for (const [path, text] of Object.entries(cases)) {
    const name = path.replace(/^.*\//, "");
    it(`${name}: 途中まで書いたどの形でも、同じモデルになる`, () => {
      // サンプルは長いので、11 文字おきに切る
      const step = text.length > 1000 ? 11 : 1;
      for (let end = 0; end <= text.length; end += step) expectSameModel(text.slice(0, end));
    });
  }

  it("ケースの行を乱数で組み合わせた入力でも、同じモデルになる", () => {
    const lines = [...Object.values(cases).flatMap((t) => t.split("\n")), ...EXTRA_LINES];
    const next = random(20261016);
    const seen = { edges: 0, views: 0, phases: 0, gaps: 0 };
    for (let i = 0; i < 300; i++) {
      const n = 5 + Math.floor(next() * 40);
      // 半分は、フェーズの定義を頭に置く（フェーズとトレースの抜けを出す）
      const head = i % 2 ? [] : PHASE_DEFS;
      const text = [...head, ...Array.from({ length: n }, () => lines[Math.floor(next() * lines.length)])].join("\n");
      const M = expectSameModel(text);
      seen.edges += M.edges.length;
      seen.views += M.views.length;
      seen.phases += M.phases ? 1 : 0;
      seen.gaps += M.problems.filter((p) => p.kind === "gap").length;
    }
    // 比べた入力が、関係・図・フェーズ・トレースの抜けを含んでいる（空のモデルばかり比べていない）
    expect(Object.values(seen).every((c) => c > 0), JSON.stringify(seen)).toBe(true);
  });

  it("view・フェーズ・ポートの書き方をまとめた入力でも、同じモデルになる", () => {
    expectSameModel(EXTRA_LINES.join("\n"));
  });
});

describe("build（Rust）", () => {
  it("parse（Rust）が返したものでない解析結果は受け付けない（異常系）", () => {
    // Arrange
    const P: ParseResult = { entries: [], rels: [], errors: [], layout: {}, unsupported: [] };
    // Act・Assert
    expect(() => rustBuild(P)).toThrow(/parse（Rust）/);
  });
});
