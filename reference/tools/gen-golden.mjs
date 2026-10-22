// モック（reference/mock/Modelith.html）のパーサとモデル構築を Node で実行し、
// reference/golden/<case>.json に出力する。Rust コアはこの出力と一致させる（ADR-0002）。
// モックは非公開のためリポジトリに含めない。手元に置いた人だけが生成・検証できる。
// 置き場所は既定で reference/mock/Modelith.html（.gitignore 済み）、環境変数 MODELITH_MOCK で変更可。
//   node reference/tools/gen-golden.mjs           生成
//   node reference/tools/gen-golden.mjs --check   生成結果が最新かを検証（CI 用）
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mockPath = process.env.MODELITH_MOCK ?? join(root, "mock/Modelith.html");
if (!existsSync(mockPath)) {
  console.log(`mock not found (${mockPath}); skipped`);
  process.exit(0);
}
const html = readFileSync(mockPath, "utf8");

// UI に依存しない「1. パーサ」〜「2. モデル」区間だけを取り出す
const script = html.slice(html.indexOf("<script>") + "<script>".length);
const start = script.indexOf("/* ================= 1. パーサ");
const end = script.indexOf("/* ================= 3. ビュー");
if (start < 0 || end < 0) throw new Error("mock の区切りが見つかりません");
const ctx = vm.createContext({});
vm.runInContext(`"use strict";${script.slice(start, end)}\n;this.api = {parse, build};`, ctx);
const { parse, build } = ctx.api;

// 循環参照（owner / pe / entry）をエントリ番号に置き換えて JSON 化できる形にする
const ref = (e) => (e && typeof e.idx === "number" ? e.idx : null);
function project(text) {
  const P = parse(text);
  const M = build(P);
  const entries = P.entries.map((e) => ({
    idx: e.idx, kind: e.kind, isDef: e.isDef, short: e.short, name: e.name, type: e.type,
    conj: e.conj, mods: e.mods, dir: e.dir, value: e.value, doc: e.doc,
    enumValues: e.enumValues, span: [e.start, e.end], close: e.close ?? null,
    parent: ref(e.pe), children: e.children.map(ref), exprs: simplify(e.exprs), meta: simplify(e.meta),
  }));
  const rels = P.rels.map(({ pe, usage, ...r }) => ({ ...simplify(r), parent: ref(pe), usage: ref(usage) }));
  const nodes = M.nodes.map((n) => Object.fromEntries(
    Object.entries(n).map(([k, v]) => [k, k === "entry" ? ref(v) : simplify(v)])));
  const edges = M.edges.map((e) => simplify(e));
  return { entries, rels, errors: P.errors, layout: P.layout, model: { nodes, edges, problems: simplify(M.problems), phases: simplify(M.phases) } };
}
function simplify(v, seen = new Set()) {
  if (v == null || typeof v !== "object") return v;
  if (typeof v.idx === "number" && "kind" in v) return { $entry: v.idx };
  if (v.anon) return { $block: v.head };
  if (seen.has(v)) return { $cycle: true };
  seen = new Set(seen).add(v);
  if (v instanceof Map || v instanceof Set) return simplify([...v], seen);
  if (Array.isArray(v)) return v.map((x) => simplify(x, seen));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, simplify(x, seen)]));
}

// モック内蔵の SAMPLE は非公開のため使わない。公開してよい入力だけを cases/ に置く
// アプリに同梱する公開サンプル（web/src/samples/）もケースとして使う
const cases = [];
for (const dir of [join(root, "golden/cases"), join(root, "../web/src/samples")])
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sysml")).sort())
    cases.push([basename(f, ".sysml"), readFileSync(join(dir, f), "utf8")]);

const check = process.argv.includes("--check");
let stale = 0;
for (const [name, text] of cases) {
  const out = join(root, "golden", `${name}.json`);
  // entries は project() で投影済み。ここで simplify すると {$entry} に潰れるので掛けない
  const json = JSON.stringify({ case: name, ...project(text) }, null, 2) + "\n";
  if (check) {
    if (!existsSync(out) || readFileSync(out, "utf8") !== json) { console.error(`stale: ${out}`); stale++; }
  } else writeFileSync(out, json);
}
if (stale) { console.error("node reference/tools/gen-golden.mjs で再生成してください"); process.exit(1); }
console.log(`${cases.length} golden case(s) ${check ? "up to date" : "written"}`);
