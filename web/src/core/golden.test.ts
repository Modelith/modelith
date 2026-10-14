// 暫定コアの出力がゴールデン（モックの出力）と一致することを確かめる結合テスト（ADR-0002・ADR-0009）。
// 投影の方法は reference/tools/gen-golden.mjs と同じにする。
import { describe, expect, it } from "vitest";
import { build } from "./model";
import { parse } from "./parser";
import type { Entry } from "./types";

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
 * 問題一覧の文言は比べない。文言は画面の言葉の決まり（ADR-0014）で Modelith が決めるもので、モックに合わせない。
 * どこに・どの種類の問題を出すかは、モックと一致させる。
 */
function withoutWording(v: unknown): unknown {
  const o = v as { model?: { problems?: { pos: number; kind?: string }[] } };
  if (!o.model?.problems) return v;
  return { ...o, model: { ...o.model, problems: o.model.problems.map(({ pos, kind }) => ({ pos, ...(kind ? { kind } : {}) })) } };
}

function project(text: string): Record<string, unknown> {
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

  for (const [path, text] of Object.entries(cases)) {
    const name = baseName(path);
    it(`${name}: 解析とモデル構築の結果がモックと一致する`, () => {
      // Arrange
      const golden = Object.entries(goldens).find(([p]) => baseName(p) === name)?.[1];
      // Act
      const actual = JSON.parse(JSON.stringify({ case: name, ...project(text) })) as unknown;
      // Assert
      expect(withoutWording(actual)).toEqual(withoutWording(golden));
    });
  }
});
