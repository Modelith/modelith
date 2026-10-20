// Rust のモデル構築が、暫定コアのモデル構築と同じ結果を返すことを確かめる結合テスト（ADR-0016 の手順 A）。
// 同じ解析結果（Rust のパーサ）を両方に渡すので、パーサの違いに左右されずにモデル構築だけを比べられる。
// 入力は、ケースの途中まで書いたもの（書いている途中の形）と、ケースの行を乱数で組み合わせたもの。
// alpha.7 から、Rust は暫定コアの取り違え（修飾名を最後の名前だけで探す・別名を読まない・図に無い持ち主の verify と frame を
// 「見つからない」とする）を直している（F-EDIT-8、ADR-0015）。暫定コアは alpha.6 の範囲で止めるので、その違いは比べない。
// 標準ライブラリの型の判定も、Rust は名前の一覧と import で決める（`…Value` で終わる名前は、ISQ などを import したときだけ標準）。
// alpha.9 から、Rust は遷移の相手が見つからないこと、特徴の連鎖（a.b.c）の 2 段目から先が見つからないこと、
// シナリオの順序の相手が見つからないことと順序の循環を問題にする（暫定コアはしない）。
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

/**
 * alpha.7 で Rust だけが読み方を直した書き方の行（修飾名の参照・verify・frame・alias）。乱数で組み合わせる行から除く。
 * `import A::*`・`expose Q::*`・`stage = K::x` のように、名前の解決が変わらない `::` は残す。
 */
const FIXED_IN_RUST = /\b(?:verify|frame|alias)\b|[:>~]\s*[\w']+::[\w']|\b(?:expose|satisfy|by|from|to)\s+[\w']+::[\w']/;

/**
 * 「型「Q::A」が見つかりません」の修飾を外す。alpha.7 から、Rust は見つからない型を修飾名のまま知らせる。
 *
 * @param msg 問題の文
 * @returns 型の名前の修飾を外した文。型の問題でなければそのまま
 * @example
 * unqualifiedTypeMessage("型「Behavior::Step」が見つかりません（s）") // → "型「Step」が見つかりません（s）"
 * unqualifiedTypeMessage("型「Step」が見つかりません（s）")           // → そのまま
 */
function unqualifiedTypeMessage(msg: string): string {
  return msg.replace(/^型「(?:[^「」]*::)?([^「」:]*)」/, "型「$1」");
}

/**
 * 「型「…Value」が見つかりません」のような、`…Value`・`…Kind` で終わる型の問題か。alpha.7 から、Rust はこれを
 * import（ISQ・SI など）があるときだけ標準ライブラリの型とみなすので、行を乱数で組み合わせると暫定コアと違ってよい。
 *
 * @param msg 問題の文
 * @returns `…Value`・`…Kind` の型が見つからないという問題なら true
 * @example
 * isValueTypeMessage("型「TimeValue」が見つかりません（t）")  // → true
 * isValueTypeMessage("型「TempSensor」が見つかりません（s）") // → false
 */
function isValueTypeMessage(msg: string): boolean {
  return /^型「[^「」]*(?:Value|Kind)」が見つかりません/.test(msg);
}

/**
 * 「「遷移」の相手「…」が見つかりません」の問題か。alpha.9 から、Rust は状態遷移の図を作るときに遷移の相手を確かめる
 * （暫定コアは確かめない）ので、途中まで書いた形（相手の状態を書く前）や行の組み合わせでは、暫定コアと違ってよい。
 *
 * @param msg 問題の文
 * @returns 遷移の相手が見つからないという問題なら true
 * @example
 * isTransitionMessage("「遷移」の相手「idle」が見つかりません（transition）") // → true
 * isTransitionMessage("型「Step」が見つかりません（s）")                      // → false
 */
function isTransitionMessage(msg: string): boolean {
  return /^「遷移」の相手「[^「」]*」が見つかりません/.test(msg);
}

/**
 * 「線の接続先「a.b.x」の「x」が見つかりません」のような、特徴の連鎖の途中の段が見つからない問題か。alpha.9 から、Rust は
 * 連鎖を型の中までたどって確かめる（暫定コアは最初の段とポートだけ）ので、行の組み合わせでは暫定コアと違ってよい。
 *
 * @param msg 問題の文
 * @returns 連鎖の途中の段が見つからないという問題なら true
 * @example
 * isChainMessage("線の接続先「e.cyl.x」の「x」が見つかりません（connect）") // → true
 * isChainMessage("線の接続先「nope.p」が見つかりません（connect）")         // → false（最初の段）
 */
function isChainMessage(msg: string): boolean {
  return /「[^「」]*\.[^「」]*」の「[^「」]*」が見つかりません/.test(msg);
}

/**
 * シナリオの順序の問題（「「順序」の相手「…」が見つかりません」・「シナリオ「…」の順序が循環しています」）か。alpha.9 から、Rust は
 * シーケンス図を作るときに順序の相手と循環を確かめる（暫定コアは確かめない）ので、行の組み合わせでは暫定コアと違ってよい。
 *
 * @param msg 問題の文
 * @returns シナリオの順序の問題なら true
 * @example
 * isSequenceMessage("「順序」の相手「m9」が見つかりません（succession）") // → true
 * isSequenceMessage("シナリオ「S」の順序が循環しています（succession）")   // → true
 * isSequenceMessage("型「Step」が見つかりません（s）")                      // → false
 */
function isSequenceMessage(msg: string): boolean {
  return /^「順序」の相手「[^「」]*」が見つかりません|^シナリオ「[^「」]*」の順序が循環しています/.test(msg);
}

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
    problems: M.problems
      .filter((p) => !isValueTypeMessage(p.msg) && !isTransitionMessage(p.msg) && !isChainMessage(p.msg) && !isSequenceMessage(p.msg))
      .map((p) => ({ ...p, msg: unqualifiedTypeMessage(p.msg) })),
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
    const lines = [...Object.values(cases).flatMap((t) => t.split("\n")), ...EXTRA_LINES].filter((l) => !FIXED_IN_RUST.test(l));
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
