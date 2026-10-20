// 暫定コアの出力がゴールデン（モックの出力）と一致することを確かめる結合テスト（ADR-0002・ADR-0009）。
// 投影の方法は reference/tools/gen-golden.mjs と同じにする。
import { describe, expect, it } from "vitest";
import { PARSERS } from "./testing/parsers";
import type { Entry, Model, ParseResult } from "./types";

const goldens = import.meta.glob<Record<string, unknown>>("../../../reference/golden/*.json", { eager: true, import: "default" });
const cases = {
  ...import.meta.glob<string>("../../../reference/golden/cases/*.sysml", { eager: true, query: "?raw", import: "default" }),
  ...import.meta.glob<string>("../samples/*.sysml", { eager: true, query: "?raw", import: "default" }),
};

const baseName = (path: string): string => path.replace(/^.*\//, "").replace(/\.\w+$/, "");

function simplify(v: unknown, seen = new Set<unknown>()): unknown {
  if (v == null || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  if (typeof o["idx"] === "number" && "kind" in o) return { $entry: o["idx"] };
  if (o["anon"]) return { $block: o["head"] };
  if (seen.has(v)) return { $cycle: true };
  seen = new Set(seen).add(v);
  if (v instanceof Map || v instanceof Set) return simplify([...v], seen);
  if (Array.isArray(v)) return v.map((x) => simplify(x, seen));
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, simplify(x, seen)]));
}

/**
 * 構文エラーと問題一覧の文言は比べない。文言は画面の言葉の決まり（ADR-0014）で Modelith が決めるもので、モックに合わせない。
 * どこに・どの種類の問題を出すかは、モックと一致させる（ADR-0015）。
 */
function withoutWording(v: unknown): unknown {
  type Located = { pos: number; kind?: string };
  const o = v as { errors?: Located[]; model?: { problems?: Located[] } };
  const strip = (xs: Located[] | undefined) => xs?.map(({ pos, kind }) => ({ pos, ...(kind ? { kind } : {}) }));
  return { ...o, errors: strip(o.errors), model: o.model && { ...o.model, problems: strip(o.model.problems) } };
}

/**
 * Rust のパーサが、SysML v2 仕様に合わせて意図してモックと違う結果を出すケース（ADR-0002 の許容リスト、ADR-0013・ADR-0015）。
 * 足した構文エラーの位置を返す。比べる前に、構文エラーと、それを写した問題一覧から取り除く。
 */
const RUST_EXTRA_ERRORS: Record<string, { reason: string; pos: (text: string) => number[] }> = {
  "syntax-errors": {
    reason: "「}」の前で「;」を書き忘れた宣言も構文エラーにする（BNF では、宣言は「;」か本体で終わる）",
    pos: (text) => [text.indexOf("part b : B") + "part b : B".length],
  },
};

/**
 * Rust のコアが、SysML v2 仕様に合わせて記録を増やした関係の種類（モックは記録しない。ADR-0002 の許容リスト、ADR-0015）。
 * 比べる前に、Rust の結果の関係から取り除く。
 */
const RUST_EXTRA_RELS: Record<string, string> = {
  succession: "継起（first … then・then b;・then action b;、8.2.2.14・8.2.2.17）を関係として記録する（モックは読み飛ばす）",
  successionFlow: "順序付きの流れ（succession flow、8.2.2.16）を関係として記録する（モックは読み飛ばす）",
  entryTransition: "状態の本体の最初の遷移（entry; then s;、8.2.2.18）を関係として記録する（モックは読み飛ばす）",
};

/**
 * Rust のコアが、SysML v2 仕様に合わせて関係に足した項目（モックは記録しない。ADR-0002 の許容リスト、ADR-0015）。
 * 比べる前に、Rust の結果のその種類の関係から取り除く。
 */
const RUST_EXTRA_REL_FIELDS: Record<string, { fields: string[]; reason: string }> = {
  transition: { fields: ["name", "via", "guard", "effect"], reason: "遷移の名前・via・ガード・効果（8.2.2.18）を記録する（モックは捨てる）" },
};

/**
 * Rust だけが記録する種類の関係（RUST_EXTRA_RELS）と、関係に足した項目（RUST_EXTRA_REL_FIELDS）を、結果から取り除く。
 *
 * @param v テストの結果（project の結果を JSON にしたもの）
 * @returns rels から許容リストの種類と項目を除いた結果
 * @example
 * withoutExtraRels({ rels: [{ rel: "flow" }, { rel: "succession" }] })          // → { rels: [{ rel: "flow" }] }
 * withoutExtraRels({ rels: [{ rel: "transition", from: "a", name: "t" }] })    // → { rels: [{ rel: "transition", from: "a" }] }
 */
function withoutExtraRels(v: unknown): unknown {
  const o = v as { rels: Record<string, unknown>[] };
  const strip = (r: Record<string, unknown>): Record<string, unknown> => {
    const extra = RUST_EXTRA_REL_FIELDS[String(r.rel)]?.fields ?? [];
    return Object.fromEntries(Object.entries(r).filter(([k]) => !extra.includes(k)));
  };
  return { ...o, rels: o.rels.filter((r) => !(String(r.rel) in RUST_EXTRA_RELS)).map(strip) };
}

function withoutAllowed(v: unknown, positions: number[]): unknown {
  type Located = { pos: number };
  const o = v as { errors: Located[]; model: { problems: Located[] } };
  const keep = (x: Located) => !positions.includes(x.pos);
  return { ...o, errors: o.errors.filter(keep), model: { ...o.model, problems: o.model.problems.filter(keep) } };
}

function project(text: string, parse: (text: string) => ParseResult, build: (P: ParseResult) => Model): Record<string, unknown> {
  const P = parse(text);
  const M = build(P);
  const ref = (e: Entry | null): number | null => (e ? e.idx : null);
  const entries = P.entries.map((e) => ({
    idx: e.idx, kind: e.kind, isDef: e.isDef, short: e.short, name: e.name, type: e.type,
    conj: e.conj, mods: e.mods, dir: e.dir, value: e.value, doc: e.doc,
    enumValues: e.enumValues, span: [e.start, e.end], close: e.close ?? null,
    parent: ref(e.pe), children: e.children.map(ref), exprs: simplify(e.exprs), meta: simplify(e.meta),
  }));
  const rels = P.rels.map((r) => {
    const { pe, ...rest } = r;
    const usage = r.rel === "connect" ? r.usage : null;
    return { ...(simplify({ ...rest, usage: undefined }) as object), parent: ref(pe), usage: ref(usage) };
  });
  const nodes = M.nodes.map((n) => Object.fromEntries(Object.entries(n).map(([k, v]) => [k, k === "entry" ? ref(v as Entry) : simplify(v)])));
  const edges = M.edges.map((e) => simplify(e));
  return { entries, rels, errors: P.errors, layout: P.layout, model: { nodes, edges, problems: simplify(M.problems), phases: simplify(M.phases) } };
}

describe("暫定コアとゴールデンの一致", () => {
  const names = Object.keys(cases).map(baseName);

  it("すべてのケースにゴールデンがある", () => {
    // Arrange
    const goldenNames = new Set(Object.keys(goldens).map(baseName));
    // Act
    const missing = names.filter((n) => !goldenNames.has(n));
    // Assert
    expect(missing).toEqual([]);
  });

  for (const [impl, parse, build] of PARSERS) {
    for (const [path, text] of Object.entries(cases)) {
      const name = baseName(path);
      it(`${impl}: ${name}: 解析とモデル構築の結果がモックと一致する`, () => {
        // Arrange
        const golden = Object.entries(goldens).find(([p]) => baseName(p) === name)?.[1];
        const allowed = impl === "Rust" ? (RUST_EXTRA_ERRORS[name]?.pos(text) ?? []) : [];
        // Act
        const projected = JSON.parse(JSON.stringify({ case: name, ...project(text, parse, build) })) as unknown;
        const actual = impl === "Rust" ? withoutExtraRels(projected) : projected;
        // Assert
        expect(withoutWording(withoutAllowed(actual, allowed))).toEqual(withoutWording(golden));
        // 許容リストが古くなっていない（取り除いた位置に、本当にエラーがある）
        const errors = (actual as { errors: { pos: number }[] }).errors.map((e) => e.pos);
        expect(allowed.filter((p) => !errors.includes(p))).toEqual([]);
      });
    }
  }
});
