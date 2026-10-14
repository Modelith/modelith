// テキストに書かれた view を、描く要素と描き方に解決する（暫定コア、ADR-0005・ADR-0013、F-VIEW-7）。
// 仕様：8.2.2.26 Views and Viewpoints（view・expose・filter・render）、9.2.20 標準ビュー定義（StandardViewDefinitions）。

import type { Entry, Expose, ModelNode, ModelView, Problem, ViewKind } from "./types";

/** 標準ビュー定義（名前と短い名前）と、Modelith の描き方。null は専用の描き方が無い（ノードと線の図で代わりに描く）。 */
const STANDARD_VIEWS: Record<string, { std: string; kind: ViewKind | null }> = {};
for (const [name, short, kind] of [
  ["GeneralView", "gv", "general"],
  ["InterconnectionView", "iv", "interconnection"],
  ["ActionFlowView", "afv", null],
  ["StateTransitionView", "stv", "stateTransition"],
  ["SequenceView", "sv", "sequence"],
  ["GeometryView", "gev", null],
  ["GridView", "grv", null],
  ["BrowserView", "bv", null],
] as const) {
  STANDARD_VIEWS[name] = STANDARD_VIEWS[short] = { std: name, kind };
}

/** 標準ビュー定義の、画面での名前（ADR-0014）。 */
const STD_LABEL: Record<string, string> = {
  GeneralView: "一般の図", InterconnectionView: "内部ブロック図", ActionFlowView: "アクションの流れ図", StateTransitionView: "状態遷移の図",
  SequenceView: "シーケンス図", GeometryView: "形状の図", GridView: "表の図", BrowserView: "一覧の図",
};
/** 図の種類の、画面での名前（型の無い図は一般の図）。 */
export const stdViewLabel = (std: string | null): string => (std ? (STD_LABEL[std] ?? std) : "一般の図");

/** 標準ビュー定義の名前か（型が見つからないことを問題にしない）。 */
export const isStandardView = (t: string): boolean => t in STANDARD_VIEWS;

/** 標準のレンダリング（Views）と描き方。null は図にできない。 */
const RENDERINGS: Record<string, ViewKind | null> = {
  asTreeDiagram: "general",
  asInterconnectionDiagram: "interconnection",
  asTextualNotation: null,
  asElementTable: null,
};

/** メタクラス名の頭（PartDefinition の Part）と、Modelith の要素の種類。 */
const METACLASS_KIND: Record<string, string> = {
  Part: "part", Requirement: "requirement", Constraint: "constraint", Port: "port", Item: "item", Attribute: "attribute",
  Concern: "concern", VerificationCase: "verification", AnalysisCase: "analysis", State: "state", Action: "action",
  Interface: "interface", Calculation: "calc", Connection: "connection", UseCase: "use case", Enumeration: "enum",
  Occurrence: "occurrence", Metadata: "metadata", View: "view",
};

/** `@X`（X はメタクラスかメタデータ）の絞り込みを、要素の判定にする。扱えない式なら null。 */
function filterTest(expr: string, isMetadata: (name: string) => boolean): ((e: Entry) => boolean) | null {
  const m = expr.match(/^@\s*([A-Za-z_][\w:]*)$/);
  if (!m) return null;
  const name = m[1]!.split("::").pop() ?? "";
  if (name === "Definition") return (e) => e.isDef;
  if (name === "Usage") return (e) => !e.isDef;
  const d = name.match(/^(\w+?)(Definition|Usage)$/);
  const kind = d ? METACLASS_KIND[d[1]!] : undefined;
  if (d && kind) return d[2] === "Definition" ? (e) => e.kind === `${kind} def` : (e) => e.kind === kind;
  if (isMetadata(name)) return (e) => !!e.meta?.[name];
  return null;
}

/** 修飾名（A::B::C）の要素。後ろから順に、親の名前が合うものを探す。 */
function resolveQualified(qn: string, byName: Map<string, Entry[]>): Entry | null {
  const segs = qn.split("::");
  const last = segs.pop() ?? "";
  return (
    byName.get(last)?.find((e) => {
      let a = e.pe;
      for (let i = segs.length - 1; i >= 0; i--, a = a?.pe ?? null) if (!a || a.name !== segs[i]) return false;
      return true;
    }) ?? null
  );
}

/** 入れ子の中身すべて。 */
const descendants = (e: Entry): Entry[] => e.children.flatMap((c) => [c, ...descendants(c)]);

/** expose 1 つで出る要素（8.2.2.26.2。MembershipExpose は対象そのもの、NamespaceExpose は中身）。 */
function exposed(x: Expose, target: Entry): Entry[] {
  if (x.members) return x.recursive ? descendants(target) : target.children;
  return x.recursive ? [target, ...descendants(target)] : [target];
}

/**
 * view の型をたどり、標準ビュー定義と、型の側に書かれた filter・render を集める
 * （利用者の view def は、標準ビュー定義を特殊化して作る）。
 */
function viewType(v: Entry, byName: Map<string, Entry[]>): { std: string | null; kind: ViewKind | null; filters: string[]; render?: string } {
  const filters = [...(v.filters ?? [])];
  let render = v.render;
  const seen = new Set<Entry>();
  for (let t = v.type; t; ) {
    const s = STANDARD_VIEWS[t];
    if (s) return { std: s.std, kind: s.kind, filters, ...(render ? { render } : {}) };
    const def = byName.get(t)?.find((e) => e.kind === "view def");
    if (!def || seen.has(def)) break;
    seen.add(def);
    filters.push(...(def.filters ?? []));
    render ||= def.render;
    t = def.type;
  }
  // 型の無い view は、一般的な図（GeneralView）として描く
  return { std: null, kind: "general", filters, ...(render ? { render } : {}) };
}

/** 解析した view を、描く要素と描き方に解決する。扱えない部分は問題として知らせる（ADR-0013）。 */
export function buildViews(
  entries: Entry[],
  nodeOf: Map<Entry, ModelNode>,
  byName: Map<string, Entry[]>,
  problems: Problem[],
): ModelView[] {
  const isMetadata = (n: string): boolean => !!byName.get(n)?.some((e) => e.kind === "metadata def");
  const unsupported = (pos: number, msg: string): void => {
    problems.push({ pos, kind: "unsupported", msg });
  };
  const views: ModelView[] = [];
  for (const v of entries) {
    if (v.kind !== "view" || !v.name) continue;
    const t = viewType(v, byName);
    let kind = t.kind;
    if (!kind) unsupported(v.start, `図「${v.name}」の種類（${stdViewLabel(t.std)}）の描き方はまだ無いため、一般の図として描きます（${t.std}）`);
    if (t.render !== undefined) {
      const r = RENDERINGS[t.render];
      if (r) kind = r;
      else unsupported(v.start, `図「${v.name}」の表し方（${t.render}）はまだ扱えないため、図として描きます（render）`);
    }
    const tests = t.filters.flatMap((f) => {
      const test = filterTest(f, isMetadata);
      if (!test) unsupported(v.start, `図「${v.name}」の絞り込み「${f}」はまだ扱えないため、絞り込まずに描きます（filter）`);
      return test ? [test] : [];
    });
    const targets: Entry[] = [];
    const shown = new Set<Entry>();
    for (const x of v.exposes ?? []) {
      const target = resolveQualified(x.target, byName);
      if (!target) {
        problems.push({ pos: x.start, msg: `図「${v.name}」に出す要素「${x.target}」が見つかりません（expose）` });
        continue;
      }
      targets.push(target);
      let own: ((e: Entry) => boolean) | null = null;
      if (x.filter) {
        own = filterTest(x.filter, isMetadata);
        if (!own) unsupported(x.start, `図「${v.name}」の絞り込み「${x.filter}」はまだ扱えないため、絞り込まずに描きます（expose の [ ]）`);
      }
      for (const e of exposed(x, target)) if (!own || own(e)) shown.add(e);
    }
    const nodeKeys = [...shown].filter((e) => tests.every((test) => test(e))).flatMap((e) => nodeOf.get(e)?.key ?? []);
    views.push({ name: v.name, entry: v, kind: kind ?? "general", std: t.std, nodeKeys, targets });
  }
  return views;
}
