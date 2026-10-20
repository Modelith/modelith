// テキストに書かれた view を、描く要素と描き方に解決する（暫定コア、ADR-0005・ADR-0013、F-VIEW-7）。
// 仕様：8.2.2.26 Views and Viewpoints（view・expose・filter・render）、9.2.20 標準ビュー定義（StandardViewDefinitions）。

import type { Entry, Expose, ModelFrame, ModelNode, ModelView, Problem, ViewKind } from "./types";

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
  GeneralView: "一般ビュー", InterconnectionView: "内部ブロック図", ActionFlowView: "アクティビティ図", StateTransitionView: "状態遷移図",
  SequenceView: "シーケンス図", GeometryView: "ジオメトリビュー", GridView: "グリッドビュー", BrowserView: "ブラウザビュー",
};
/**
 * 図の種類の、画面での名前（ADR-0014）。
 *
 * @param std 標準ビュー定義の名前（`GeneralView` など）。型の無い図は null
 * @returns 画面での名前。null なら「一般ビュー」、知らない名前ならその名前のまま
 * @example
 * stdViewLabel("SequenceView") // → "シーケンス図"
 * stdViewLabel(null)           // → "一般ビュー"
 * stdViewLabel("MyView")       // → "MyView"（知らない名前）
 */
export const stdViewLabel = (std: string | null): string => (std ? (STD_LABEL[std] ?? std) : "一般ビュー");

/**
 * 標準ビュー定義の名前か（型が見つからないことを問題にしない）。短い名前（`gv` など）も含む。
 *
 * @param t 型の名前（修飾なし）
 * @returns 標準ビュー定義の名前か短い名前なら true
 * @example
 * isStandardView("GeneralView") // → true
 * isStandardView("iv")          // → true（短い名前）
 * isStandardView("MyView")      // → false
 */
export const isStandardView = (t: string): boolean => t in STANDARD_VIEWS;

/**
 * 標準ビュー定義の名前か短い名前を、標準ビュー定義の名前にそろえる（短い名前 `afv` → `ActionFlowView`）。
 *
 * @param t 型の名前（修飾なし）
 * @returns 標準ビュー定義の名前。標準ビュー定義の名前でも短い名前でもなければ null
 * @example
 * standardViewName("afv")         // → "ActionFlowView"（短い名前）
 * standardViewName("GeneralView") // → "GeneralView"
 * standardViewName("MyView")      // → null
 */
export const standardViewName = (t: string): string | null => (Object.hasOwn(STANDARD_VIEWS, t) ? (STANDARD_VIEWS[t]?.std ?? null) : null);

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

/**
 * `@X`（X はメタクラスかメタデータ）の絞り込みを、要素の判定にする（ElementFilterMember、8.2.2.26）。
 *
 * @param expr filter や expose の `[ ]` に書かれた式（`@SysML::PartDefinition`・`@Safety` など）
 * @param isMetadata 名前がメタデータの定義かを答える関数
 * @returns 要素が絞り込みに合うかの判定。扱えない式（`@A and @B` など）や知らない名前なら null
 * @example
 * filterTest("@SysML::PartDefinition", isMetadata) // → (e) => e.kind === "part def"
 * filterTest("@Safety", isMetadata)                // → (e) => !!e.meta?.["Safety"]（Safety がメタデータの定義のとき）
 * filterTest("@A and @B", isMetadata)              // → null（扱えない式）
 */
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

/**
 * 修飾名（A::B::C）の要素を探す。後ろから順に、親の名前が合うものを探す。
 *
 * @param qn 修飾名（引用符は外してあるもの）
 * @param byName 名前から、その名前の宣言の一覧への対応
 * @returns 見つかった宣言。無ければ null
 * @example
 * resolveQualified("P::Q::D", byName) // → package Q の中の part def D
 * resolveQualified("P::Nope", byName) // → null
 */
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

/**
 * 入れ子の中身すべてを、深さ優先（親の次にその子）の順で集める。
 *
 * @param e 宣言
 * @returns 子・孫…の宣言（e 自身は含まない）。子が無ければ空
 * @example
 * descendants(Q) // → [D, Deep, E]（package Q { part def D; package Deep { part def E; } } のとき）
 * descendants(D) // → []
 */
const descendants = (e: Entry): Entry[] => e.children.flatMap((c) => [c, ...descendants(c)]);

/**
 * expose 1 つで出る要素（8.2.2.26.2。MembershipExpose は対象そのもの、NamespaceExpose は中身）。
 *
 * @param x expose の中身（`members` は `::*`、`recursive` は `::**`）
 * @param target expose の対象の宣言
 * @returns 出る宣言の一覧
 * @example
 * exposed({ members: false, recursive: false, … }, Q) // → [Q]（expose P::Q）
 * exposed({ members: true, recursive: false, … }, Q)  // → [D, Deep]（expose P::Q::*）
 * exposed({ members: true, recursive: true, … }, Q)   // → [D, Deep, E]（expose P::Q::**）
 */
function exposed(x: Expose, target: Entry): Entry[] {
  if (x.members) return x.recursive ? descendants(target) : target.children;
  return x.recursive ? [target, ...descendants(target)] : [target];
}

/**
 * view の型をたどり、標準ビュー定義と、型の側に書かれた filter・render を集める
 * （利用者の view def は、標準ビュー定義を特殊化して作る）。
 *
 * @param v view の宣言
 * @param byName 名前から、その名前の宣言の一覧への対応（view def を探す）
 * @returns 標準ビュー定義の名前と描き方、集めた filter、render。標準ビュー定義にたどり着かなければ
 *   `{ std: null, kind: "general" }`（一般ビューとして描く）。専用の描き方が無い標準ビュー定義は kind が null
 * @example
 * // v が「view v : iv;」のとき
 * viewType(v, byName) // → { std: "InterconnectionView", kind: "interconnection", filters: [] }
 * // v が「view v : MyStates;」で、「view def MyStates :> StateTransitionView;」があるとき
 * viewType(v, byName) // → { std: "StateTransitionView", kind: "stateTransition", filters: [] }
 * // v が「view v;」（型なし）のとき
 * viewType(v, byName) // → { std: null, kind: "general", filters: [] }
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

/**
 * 解析した view を、描く要素と描き方に解決する（F-VIEW-7・F-VIEW-9）。
 * 扱えない図の種類・render・filter は problems に kind: "unsupported" で、見つからない expose の対象はエラーで足す（ADR-0013）。
 *
 * @param entries 解析した宣言すべて（名前のある view を探す）
 * @param nodeOf 宣言から図の要素への対応（図に出る要素のキーを引く）
 * @param byName 名前から、その名前の宣言の一覧への対応
 * @param problems 問題を書き足す先（書き換える）
 * @returns view ごとの描く要素のキー・描き方・枠（package）。view が無ければ空
 * @example
 * // package P { part def A; requirement def R; … view v : GeneralView { expose P::A; expose P::R; } } のとき
 * buildViews(entries, nodeOf, byName, problems)[0] // → { name: "v", kind: "general", std: "GeneralView", nodeKeys: ["A", "R"], … }
 * // view v { expose P::Nope; } のとき → nodeKeys は []、problems に「図「v」に出す要素「P::Nope」が見つかりません（expose）」
 */
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
    if (!kind) unsupported(v.start, `図「${v.name}」の種類（${stdViewLabel(t.std)}）の描き方はまだ無いため、一般ビューとして描きます（${t.std}）`);
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
    const passes = (e: Entry): boolean => tests.every((test) => test(e));
    const visible = [...shown].filter(passes);
    const nodeKeys = visible.flatMap((e) => nodeOf.get(e)?.key ?? []);
    // package そのものを出したら、枠として描き、中の要素も図に出す（F-VIEW-9、8.2.3.5）
    const frames: ModelFrame[] = visible
      .filter((e) => e.kind === "package")
      .map((p) => {
        const keys = descendants(p).filter(passes).flatMap((e) => nodeOf.get(e)?.key ?? []);
        for (const k of keys) if (!nodeKeys.includes(k)) nodeKeys.push(k);
        return { name: p.name, entry: p, nodeKeys: keys };
      });
    views.push({ name: v.name, entry: v, kind: kind ?? "general", std: t.std, nodeKeys, targets, frames });
  }
  return views;
}
