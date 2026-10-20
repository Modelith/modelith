// ビュー（図の種類）ごとに、モデルのどの要素・関係を表示するかを決める。

import type { EdgeKind, Entry, Model, ModelEdge, ModelNode, ModelSequenceEvent, ModelView, ViewKind } from "../core";
import { defaultFlowContext, flowContentOf, flowContexts, flowLayers } from "./action-flow";
import { ibdContentOf } from "./ibd";
import { seqContentOf } from "./sequence";
import { defaultStateContext, stateContentOf, stateContexts } from "./state-machine";
import { emptyView, type ViewLayout } from "./layout";
import { withNotes } from "./notes";
import { S } from "./state";

export interface ViewDef {
  id: string;
  label: string;
  /** この図に当たる SysML v2 の標準ビュー定義（`GeneralView` など）。ツールチップの補足に出す（ADR-0014）。 */
  std: string;
  /** 表示する要素の種類（null はすべて）。 */
  kinds?: string[] | null;
  /** この関係でつながる要素も表示する。 */
  pull?: EdgeKind[];
  /** 表示中の要素を部品に持つ要素も表示する。 */
  pullComp?: boolean;
  edges?: EdgeKind[] | null;
  /** 所有関係の深さで段を分ける。 */
  depth?: boolean;
  /** 自動の配置で段を決める方法（あれば depth・種類の順位より優先する）。アクションの流れの図は継起の向きの最も長い道のりで決める。 */
  layer?: (list: readonly ModelNode[], edges: readonly ModelEdge[]) => Map<string, number>;
  /**
   * 「図を開く」の一覧に出さない（ツリーの「開く」と保存された図からだけ開く）。組み込みのビューの数は要求 F-VIEW-1 で決まるので、
   * それを変えずに足した図に付ける。
   */
  hidden?: boolean;
}

export interface PackageFrame {
  name: string;
  keys: string[];
  inner: number[];
}

export interface ViewContent {
  nodes: ModelNode[];
  edges: ModelEdge[];
  dim?: Set<string>;
  empty?: string;
  frame?: { kind: string; title: string };
  /** 図に出した package の枠（F-VIEW-9）。`inner` は、この枠の中にある枠の番号。 */
  packages?: PackageFrame[];
  ctx?: ModelNode;
  seq?: boolean;
  /** シーケンス図のライフラインの上のイベント（8.2.3.9 の sq-proxy）。 */
  events?: ModelSequenceEvent[];
  /** シーケンス図の段の数（メッセージと、メッセージの端でないイベントが 1 段ずつ使う）。 */
  rows?: number;
  /** 状態遷移の図で、中の要素を破線で区切った領域に描く並行の状態のキー（状態定義そのものが並行なら ""、8.2.3.18）。 */
  regions?: string[];
}

export const VIEWS: ViewDef[] = [
  { id: "trace", label: "トレーサビリティ", std: "GeneralView", kinds: ["concern def", "requirement def", "requirement", "verification def", "analysis def"], pull: ["satisfy"], edges: ["satisfy", "verify", "frame", "comp", "defined", "derive"] },
  { id: "structure", label: "ブロック定義図", std: "GeneralView", kinds: ["part def", "part", "attribute def"], edges: ["comp", "defined", "specialize", "subset", "redefine", "reference"], depth: true },
  { id: "control", label: "制御ループ", std: "GeneralView", kinds: ["constraint def", "calc def"], pull: ["flow"], edges: ["flow", "comp"] },
  { id: "ibd", label: "内部ブロック図", std: "InterconnectionView" },
  { id: "behavior", label: "振る舞い", std: "GeneralView", kinds: ["state def", "action def", "occurrence def"], pullComp: true, edges: ["comp"] },
  { id: "seq", label: "シーケンス図", std: "SequenceView" },
  { id: "afv", label: "アクティビティ図", std: "ActionFlowView", layer: flowLayers },
  // 状態遷移図（StateTransitionView、8.2.3.18）。組み込みのビューの一覧（F-VIEW-1）には出さない
  { id: "stm", label: "状態遷移図", std: "StateTransitionView", hidden: true },
  { id: "all", label: "すべて", std: "GeneralView", kinds: null, edges: null },
];

const PHASE_LABEL: Record<string, string> = {
  StakeholderNeeds: "利用者要求", SystemRequirements: "システム要求", Architecture: "方式設計", Verification: "検証",
};
/**
 * 工程（@Phase の値）の画面の名前を返す（F-TRACE-1）。知らない値はそのまま返す。
 *
 * @param p 工程の列挙値の名前
 * @returns 画面に出す名前
 * @example
 * phaseLabel("SystemRequirements") // → "システム要求"
 * phaseLabel("Custom")             // → "Custom"（知らない値）
 */
export const phaseLabel = (p: string): string => PHASE_LABEL[p] ?? p;

/**
 * ID からビューの定義を探す。知らない ID ならトレーサビリティのビューを返す。
 *
 * @param id ビューの ID（"trace"・"structure"・"ibd" など）
 * @returns ビューの定義
 * @example
 * viewDef("ibd").label   // → "内部ブロック図"
 * viewDef("nope").id     // → "trace"（知らない ID）
 */
export const viewDef = (id: string): ViewDef => VIEWS.find((x) => x.id === id) ?? (VIEWS[0] as ViewDef);
/**
 * 表示中のタブのビューの定義を返す（S.view から引く）。
 *
 * @returns ビューの定義
 * @example
 * // S.view が "structure"
 * curView().label // → "ブロック定義図"
 */
export const curView = (): ViewDef => viewDef(S.view);
/** テキストの view の描き方を、それに当たる自動の図で描く（ADR-0005：標準の図の描き方は Modelith の既定で補う）。 */
const BASE_VIEW: Record<ViewKind, string> = { general: "all", interconnection: "ibd", stateTransition: "stm", sequence: "seq", actionFlow: "afv" };
/**
 * テキストの view の描き方（図の種類）を、それに当たる自動の図の ID にする。
 *
 * @param mv テキストに書かれた view
 * @returns 自動の図のビュー ID
 * @example
 * baseViewOf({ kind: "interconnection", … })  // → "ibd"
 * baseViewOf({ kind: "general", … })          // → "all"
 * baseViewOf({ kind: "actionFlow", … })       // → "afv"
 * baseViewOf({ kind: "stateTransition", … })  // → "stm"
 */
export const baseViewOf = (mv: ModelView): string => BASE_VIEW[mv.kind];

/**
 * 表示中のタブの、テキストに書かれた view を返す（F-VIEW-7）。
 *
 * @returns 名前が S.modelView の view。自動の図のタブや、テキストから消えた view なら null
 * @example
 * // S.modelView が "Overview" で、モデルに view Overview がある
 * modelView()?.name // → "Overview"
 * // S.modelView が null（自動の図）
 * modelView()       // → null
 */
export const modelView = (): ModelView | null => (S.modelView ? (S.M.views.find((v) => v.name === S.modelView) ?? null) : null);

/**
 * 配置情報のキー。内部ブロック図・アクションの流れの図・状態遷移の図は対象ごとに分ける。
 * テキストの view は view ごとに分ける（内部ブロック図・シーケンス図・アクションの流れの図・状態遷移の図は、対象ごとの配置を自動の図と共有する）。
 *
 * @returns 表示中のタブの配置のキー
 * @example
 * // S.view が "ibd"、S.ibdCtx が "Vehicle"
 * VK() // → "ibd:Vehicle"
 * // S.view が "all"、S.modelView が "Overview"
 * VK() // → "view:Overview"
 * // S.view が "structure"、S.modelView が null
 * VK() // → "structure"
 * // S.view が "afv"、S.flowCtx が "Control"
 * VK() // → "afv:Control"
 * // S.view が "stm"、S.stateCtx が "KettleStates"
 * VK() // → "stm:KettleStates"
 */
export const VK = (): string =>
  S.view === "ibd"
    ? "ibd:" + S.ibdCtx
    : S.view === "afv"
      ? "afv:" + S.flowCtx
      : S.view === "stm"
        ? "stm:" + S.stateCtx
        : S.modelView && S.view !== "seq"
          ? "view:" + S.modelView
          : S.view;
/**
 * 現在のビューの配置を返す。無ければ空の配置を作って S.layout に加える。
 *
 * @returns S.layout[VK()] の配置（呼び出し側の変更はそのまま S.layout に残る）
 * @example
 * // S.view が "structure" で、まだ配置が無い
 * curLayout() // → emptyView() と同じ中身（S.layout.structure に加わる）
 */
export function curLayout(): ViewLayout {
  const k = VK();
  return (S.layout[k] ||= emptyView());
}

/**
 * 自動の図で表示する要素と関係を選ぶ。種類で選んだ要素に、pull の関係でつながる要素・部品の持ち主（pullComp）・
 * 配置済みの要素を加え、その間の、ビューが描く種類の関係を選ぶ。
 *
 * @param M モデル
 * @param v ビューの定義（kinds が null ならモデルのすべて）
 * @returns 表示する要素と関係
 * @example
 * // M に part def A・port def P と、A から P への関係がある。structure のビューで、配置が無い
 * baseContent(M, viewDef("structure")) // → { nodes: [A], edges: [] }
 * baseContent(M, viewDef("all"))       // → { nodes: M.nodes, edges: M.edges }（すべて）
 */
function baseContent(M: Model, v: ViewDef): ViewContent {
  if (!v.kinds) return { nodes: M.nodes, edges: M.edges };
  const kinds = v.kinds;
  const keys = new Set(M.nodes.filter((n) => kinds.includes(n.kind)).map((n) => n.key));
  const pull = v.pull;
  if (pull) for (const e of M.edges) if (pull.includes(e.kind)) { keys.add(e.from); keys.add(e.to); }
  if (v.pullComp) for (const e of M.edges) if (e.kind === "comp" && keys.has(e.to)) keys.add(e.from);
  const placed = curLayout().pos;
  for (const n of M.nodes) if (placed[n.key]) keys.add(n.key);
  const ek = v.edges ?? [];
  return { nodes: M.nodes.filter((n) => keys.has(n.key)), edges: M.edges.filter((e) => ek.includes(e.kind) && keys.has(e.from) && keys.has(e.to)) };
}

/**
 * 選んだ工程（S.phase）の要素だけを残す（F-TRACE-1）。それらと線でつながる他の工程の要素は、薄く（dim）表示するために残す。
 *
 * @param M モデル（工程の列挙が無ければ絞り込まない）
 * @param c 絞り込む前の内容
 * @returns 絞り込んだ内容。S.phase が null か、モデルに工程が無ければ c をそのまま返す
 * @example
 * // S.phase が "SystemRequirements"。R1 がその工程、N1 が利用者要求の工程で、R1 から N1 へ線がある
 * phaseFilter(M, { nodes: [R1, N1, X], edges: [e] }) // → { nodes: [R1, N1], edges: [e], dim: Set{"N1"} }
 * // S.phase が null
 * phaseFilter(M, c) // → c
 */
function phaseFilter(M: Model, c: ViewContent): ViewContent {
  if (!S.phase || !M.phases) return c;
  const keep = new Set(c.nodes.filter((n) => n.phase === S.phase).map((n) => n.key));
  const dim = new Set<string>();
  for (const e of c.edges) {
    if (keep.has(e.from) && !keep.has(e.to)) dim.add(e.to);
    if (keep.has(e.to) && !keep.has(e.from)) dim.add(e.from);
  }
  const vis = new Set([...keep, ...dim]);
  return { nodes: c.nodes.filter((n) => vis.has(n.key)), edges: c.edges.filter((e) => keep.has(e.from) || keep.has(e.to)), dim };
}

/**
 * 内部ブロック図の対象にできるブロック（名前のある部品を持つ part def）を集める。
 *
 * @param M モデル
 * @returns 対象にできる part def のノード（モデルの順）。無ければ空
 * @example
 * // part def Vehicle { part engine : Engine; } と、部品の無い part def Engine がある
 * ibdContexts(M).map((n) => n.key) // → ["Vehicle"]
 */
export const ibdContexts = (M: Model): ModelNode[] =>
  M.nodes.filter((n) => n.kind === "part def" && n.entry.children.some((c) => c.kind === "part" && c.name));
/**
 * シーケンス図の対象にできるシナリオ（occurrence def）を集める。
 *
 * @param M モデル
 * @returns occurrence def のノード（モデルの順）。無ければ空
 * @example
 * // occurrence def Start がある
 * seqContexts(M).map((n) => n.key) // → ["Start"]
 */
export const seqContexts = (M: Model): ModelNode[] => M.nodes.filter((n) => n.kind === "occurrence def");
/**
 * 内部ブロック図の既定の対象（部品が最も多いブロック。同数なら先のもの）を選ぶ。
 *
 * @param M モデル
 * @returns 対象のノード。対象にできるブロックが無ければ null
 * @example
 * // Vehicle が部品を 3 つ、Engine が 1 つ持つ
 * defaultIbdContext(M)?.key // → "Vehicle"
 * // 部品を持つ part def が無い
 * defaultIbdContext(M)      // → null
 */
export function defaultIbdContext(M: Model): ModelNode | null {
  const count = (n: ModelNode): number => n.entry.children.filter((c) => c.kind === "part").length;
  return ibdContexts(M).reduce<ModelNode | null>((best, n) => (!best || count(n) > count(best) ? n : best), null);
}

/**
 * 内部ブロック図の内容を作る。対象（S.ibdCtx）の部品と、その間の線（`ibdContentOf`）に、対象の枠を付ける。
 *
 * @param M モデル
 * @returns 部品・線・対象の枠。対象が無ければ空で、作り方の案内（empty）を付ける
 * @example
 * // S.ibdCtx が "Vehicle"。Vehicle が部品 engine・wheel を持ち、engine.out から wheel.in へ flow がある
 * ibdContent(M) // → { nodes: [u:engine, u:wheel], edges: [{ kind: "flow", from: "u:engine", to: "u:wheel", … }], frame: { kind: "part def", title: "Vehicle" }, ctx }
 * // S.ibdCtx が null
 * ibdContent(M) // → { nodes: [], edges: [], empty: "中に部品を持つ部品定義がまだありません。…" }
 */
function ibdContent(M: Model): ViewContent {
  const ctx = ibdContexts(M).find((n) => n.key === S.ibdCtx);
  if (!ctx) return { nodes: [], edges: [], empty: "中に部品を持つ部品定義がまだありません。「ブロック定義図」で、部品定義から別の部品定義へ線を引き、「部品として持つ」を選ぶと作れます。" };
  return { ...ibdContentOf(M, ctx), frame: { kind: "part def", title: ctx.name }, ctx };
}

/**
 * シーケンス図の内容を作る。対象のシナリオ（S.seqCtx）のシーケンス図（`seqContentOf`）を、ライフライン・メッセージ・
 * イベントの間の順序の線と、ライフラインの上のイベントにする（9.2.20.2.7・8.2.3.9）。
 *
 * @param M モデル
 * @returns ライフライン・線・イベント・段の数（seq: true）。シナリオが無ければ空で、作り方の案内（empty）を付ける
 * @example
 * // S.seqCtx が "Start"。Start が部品 a・b と、a から b への message m を持つ
 * seqContent(M) // → { nodes: [l:a, l:b], edges: [{ id: "msg|0|m", kind: "message", row: 0, from: "l:a", to: "l:b", … }], events: [], rows: 1, seq: true, ctx }
 * // S.seqCtx が null
 * seqContent(M) // → { nodes: [], edges: [], seq: true, empty: "シナリオがまだありません。…" }
 */
function seqContent(M: Model): ViewContent {
  const ctx = seqContexts(M).find((n) => n.key === S.seqCtx);
  if (!ctx) return { nodes: [], edges: [], seq: true, empty: "シナリオがまだありません。上のパレットの「シナリオ」から作れます。" };
  return { ...seqContentOf(M, ctx), seq: true, ctx };
}

/**
 * アクションの流れの図の内容を作る。対象（S.flowCtx）のアクションの流れ（`flowContentOf`）に、対象の枠を付ける（8.2.3.17）。
 *
 * @param M モデル
 * @returns 要素・線・対象の枠。対象が無ければ空で、作り方の案内（empty）を付ける
 * @example
 * // S.flowCtx が "Control"。Control に first start; then action read; がある
 * flowContent(M) // → { nodes: [a:start, a:read], edges: [{ id: "succession|a:start|a:read|#1", … }], frame: { kind: "action def", title: "Control" }, ctx }
 * // S.flowCtx が null
 * flowContent(M) // → { nodes: [], edges: [], empty: "アクション定義がまだありません。…" }
 */
function flowContent(M: Model): ViewContent {
  const ctx = flowContexts(M).find((n) => n.key === S.flowCtx);
  if (!ctx) return { nodes: [], edges: [], empty: "アクション定義がまだありません。「振る舞い」の図のパレットの「アクション定義」から作れます。" };
  const c = flowContentOf(M, ctx);
  if (!c.nodes.length) return { ...c, empty: `「${ctx.name}」には、まだアクションがありません。テキストに action や順序（first … then）を書くと、ここに流れが出ます。`, ctx };
  return { ...c, frame: { kind: "action def", title: ctx.name }, ctx };
}

/**
 * 状態遷移の図の内容を作る。対象（S.stateCtx）の状態遷移の図（`stateContentOf`）に、対象の枠を付ける（8.2.3.18）。
 *
 * @param M モデル
 * @returns 要素・線・並行の領域・対象の枠。対象が無ければ空で、作り方の案内（empty）を付ける
 * @example
 * // S.stateCtx が "KettleStates"。KettleStates に entry; then idle; state idle; がある
 * stateContent(M) // → { nodes: [s:#start, s:idle], edges: [{ id: "transition|s:#start|s:idle|#1", … }], regions: [], frame: { kind: "state def", title: "KettleStates" }, ctx }
 * // S.stateCtx が null
 * stateContent(M) // → { nodes: [], edges: [], empty: "状態定義がまだありません。…" }
 */
function stateContent(M: Model): ViewContent {
  const ctx = stateContexts(M).find((n) => n.key === S.stateCtx);
  if (!ctx) return { nodes: [], edges: [], empty: "状態定義がまだありません。「振る舞い」の図のパレットの「状態定義」から作れます。" };
  const c = stateContentOf(M, ctx);
  if (!c.nodes.length) return { ...c, empty: `「${ctx.name}」には、まだ状態がありません。テキストに state や遷移（transition）を書くと、ここに図が出ます。`, ctx };
  return { ...c, frame: { kind: "state def", title: ctx.name }, ctx };
}

/**
 * view の expose の対象（またはその型）が ctxs のどれかなら、それを返す。
 *
 * @param mv テキストに書かれた view
 * @param ctxs 対象の候補（ibdContexts・seqContexts の結果）
 * @returns 最初に当たった候補。当たらなければ undefined
 * @example
 * // view が Vehicle を expose している
 * exposedContext(mv, [Vehicle, Truck])?.key // → "Vehicle"
 * // view が部品 v : Truck を expose している
 * exposedContext(mv, [Vehicle, Truck])?.key // → "Truck"（型で当たる）
 * exposedContext(mv, [])                    // → undefined
 */
function exposedContext(mv: ModelView, ctxs: ModelNode[]): ModelNode | undefined {
  return ctxs.find((n) => mv.targets.some((t) => t === n.entry || (!t.isDef && t.type === n.name)));
}

/**
 * テキストの view の描き方が変わったら（render や型を書き換えたとき）、表示中のタブの描き方を合わせる。
 * S.view と、表示中のタブの view を書き換える。
 */
export function syncModelViewKind(): void {
  const mv = modelView();
  if (!mv || S.view === baseViewOf(mv)) return;
  S.view = baseViewOf(mv);
  const t = S.tabs.find((x) => x.id === S.tabId);
  if (t) t.view = S.view;
}

/**
 * 保存された図の package の枠を作る（F-VIEW-9）。枠の中の枠は、package の入れ子から決める。
 *
 * @param mv テキストに書かれた view
 * @param shown 図に出す要素のキー（枠の中身はこれに絞る）
 * @returns 枠ごとの名前・中の要素のキー・中の枠の番号（mv.frames の添字）
 * @example
 * // view が package P を expose し、P の中に package Q がある。P に A、Q に B があり、両方を図に出す
 * packageFrames(mv, new Set(["A", "B"])) // → [{ name: "P", keys: ["A"], inner: [1] }, { name: "Q", keys: ["B"], inner: [] }]
 */
function packageFrames(mv: ModelView, shown: Set<string>): PackageFrame[] {
  const within = (e: Entry, outer: Entry): boolean => {
    for (let a = e.pe; a; a = a.pe) if (a === outer) return true;
    return false;
  };
  return mv.frames.map((f) => ({
    name: f.name,
    keys: f.nodeKeys.filter((k) => shown.has(k)),
    inner: mv.frames.flatMap((g, j) => (within(g.entry, f.entry) ? [j] : [])),
  }));
}

/**
 * テキストに書かれた view の中身（expose・filter で決まる要素と、その間の関係、F-VIEW-7）を作る。一般の図（general）には、要素を注釈するメモも足す。
 * 内部ブロック図・シーケンス図・アクションの流れの図・状態遷移の図の view では、expose の対象を S.ibdCtx・S.seqCtx・S.flowCtx・S.stateCtx に書き込んでから作る。
 *
 * @param M モデル
 * @param mv 表示する view。テキストから消えていれば null
 * @returns 表示する要素・関係・package の枠。出せる要素が無ければ空で、理由の案内（empty）を付ける
 * @example
 * // general の view Overview が A と B を expose し、A から B へ線 e がある
 * modelViewContent(M, mv) // → { nodes: [A, B], edges: [e], packages: [] }
 * modelViewContent(M, null) // → { nodes: [], edges: [], empty: "保存された図「…」は、モデルから消えています。" }
 */
function modelViewContent(M: Model, mv: ModelView | null): ViewContent {
  if (!mv) return { nodes: [], edges: [], empty: `保存された図「${S.modelView ?? ""}」は、モデルから消えています。` };
  if (mv.kind === "interconnection") {
    S.ibdCtx = exposedContext(mv, ibdContexts(M))?.key ?? null;
    return S.ibdCtx ? ibdContent(M) : { nodes: [], edges: [], empty: `図「${mv.name}」に、中に部品を持つ部品定義が含まれていません。` };
  }
  if (mv.kind === "actionFlow") {
    S.flowCtx = exposedContext(mv, flowContexts(M))?.key ?? null;
    return S.flowCtx ? flowContent(M) : { nodes: [], edges: [], empty: `図「${mv.name}」に、アクション定義が含まれていません。` };
  }
  if (mv.kind === "stateTransition") {
    S.stateCtx = exposedContext(mv, stateContexts(M))?.key ?? null;
    return S.stateCtx ? stateContent(M) : { nodes: [], edges: [], empty: `図「${mv.name}」に、状態定義が含まれていません。` };
  }
  if (mv.kind === "sequence") {
    S.seqCtx = exposedContext(mv, seqContexts(M))?.key ?? null;
    return S.seqCtx ? seqContent(M) : { nodes: [], edges: [], seq: true, empty: `図「${mv.name}」に、シナリオが含まれていません。` };
  }
  const keys = new Set(mv.nodeKeys);
  const nodes = M.nodes.filter((n) => keys.has(n.key));
  if (!nodes.length) {
    const where = mv.frames.length ? `パッケージ（${mv.frames.map((f) => f.name).join("・")}）の中に、` : "";
    return { nodes, edges: [], empty: `図「${mv.name}」に、${where}図に出せる要素がありません。` };
  }
  const content = phaseFilter(M, { nodes, edges: M.edges.filter((e) => keys.has(e.from) && keys.has(e.to)) });
  const framed = { ...content, packages: packageFrames(mv, new Set(content.nodes.map((n) => n.key))) };
  return mv.kind === "general" ? withNotes(M.notes, framed) : framed;
}

/**
 * 一般の図（「すべて」の自動の図）なら、メモと、メモから要素への線を足す（8.2.3.4）。ほかの自動の図はそのまま返す。
 *
 * @param M モデル
 * @param v ビューの定義
 * @param c 図の内容
 * @returns メモを足した内容（一般の図のとき）か、c そのもの
 * @example
 * // A を注釈するメモ note:#1 がある
 * generalNotes(M, viewDef("all"), { nodes: [A], edges: [] }).nodes.map((n) => n.key)       // → ["A", "note:#1"]
 * generalNotes(M, viewDef("structure"), { nodes: [A], edges: [] }).nodes.map((n) => n.key) // → ["A"]
 */
const generalNotes = (M: Model, v: ViewDef, c: ViewContent): ViewContent => (v.id === "all" ? withNotes(M.notes, c) : c);

let cache: { M: Model | null; k: string | null; v: ViewContent | null } = { M: null, k: null, v: null };

/**
 * ビューに表示する要素と関係を返す（モデルと表示条件が同じ間はキャッシュする）。
 * 自動の内部ブロック図・シーケンス図・アクションの流れの図・状態遷移の図で対象が無効なら、既定の対象を S.ibdCtx・S.seqCtx・S.flowCtx・S.stateCtx に選び直す。
 *
 * @param M モデル
 * @param v ビューの定義
 * @returns 表示する内容（同じ条件なら前と同じオブジェクト）
 * @example
 * // S.modelView が null、S.phase が null
 * viewContent(M, viewDef("all"))                                 // → { nodes: M.nodes, edges: M.edges }
 * viewContent(M, viewDef("all")) === viewContent(M, viewDef("all")) // → true（キャッシュ）
 */
export function viewContent(M: Model, v: ViewDef): ViewContent {
  // テキストの view では、内部ブロック図・シーケンス図の対象は expose で決まる（modelViewContent）
  if (v.id === "ibd" && !S.modelView) {
    const cs = ibdContexts(M);
    if (!cs.some((n) => n.key === S.ibdCtx)) S.ibdCtx = defaultIbdContext(M)?.key ?? null;
  }
  if (v.id === "seq" && !S.modelView) {
    const cs = seqContexts(M);
    if (!cs.some((n) => n.key === S.seqCtx)) S.seqCtx = cs[0]?.key ?? null;
  }
  if (v.id === "afv" && !S.modelView) {
    if (!flowContexts(M).some((n) => n.key === S.flowCtx)) S.flowCtx = defaultFlowContext(M)?.key ?? null;
  }
  if (v.id === "stm" && !S.modelView) {
    if (!stateContexts(M).some((n) => n.key === S.stateCtx)) S.stateCtx = defaultStateContext(M)?.key ?? null;
  }
  const k = [v.id, S.ibdCtx, S.seqCtx, S.flowCtx, S.stateCtx, S.phase, S.modelView].join("|");
  if (cache.M === M && cache.k === k && cache.v) return cache.v;
  const r = S.modelView
    ? modelViewContent(M, modelView())
    : v.id === "ibd" ? ibdContent(M) : v.id === "seq" ? seqContent(M) : v.id === "afv" ? flowContent(M) : v.id === "stm" ? stateContent(M) : generalNotes(M, v, phaseFilter(M, baseContent(M, v)));
  cache = { M, k, v: r };
  return r;
}

/**
 * 現在のビューの内容を返す（viewContent(S.M, curView()) の略）。
 *
 * @returns 表示中のタブの内容
 * @example
 * // S.view が "all"、絞り込みなし
 * CC().nodes.length // → S.M.nodes.length
 */
export const CC = (): ViewContent => viewContent(S.M, curView());

/**
 * キーから要素を探す（`u:`・`l:`・`j:`・`a:`・`s:`・`note:` は現在のビューの部品・ライフライン・n 項の接続の点・アクションの流れの要素・状態・メモ）。
 *
 * @param k 要素のキー
 * @returns 見つかった要素。k が空か、見つからなければ null
 * @example
 * // モデルに part def Vehicle がある
 * nodeByKey("Vehicle")    // → Vehicle のノード
 * // 内部ブロック図に部品 engine を表示中
 * nodeByKey("u:engine")   // → 部品 engine のノード
 * nodeByKey(undefined)    // → null
 */
export function nodeByKey(k: string | null | undefined): ModelNode | null {
  if (!k) return null;
  if (/^(?:[uljas]|note):/.test(k)) return CC().nodes.find((n) => n.key === k) ?? null;
  return S.M.nodes.find((n) => n.key === k) ?? null;
}

/**
 * ID から線を探す。現在のビューの線を先に、無ければモデルの線から探す。
 *
 * @param id 線の ID
 * @returns 見つかった線。id が空か、見つからなければ null
 * @example
 * // 内部ブロック図に flow の線 "flow|u:a|u:b|#1" を表示中
 * edgeById("flow|u:a|u:b|#1") // → その線
 * edgeById(null)              // → null
 */
export function edgeById(id: string | null | undefined): ModelEdge | null {
  if (!id) return null;
  return CC().edges.find((e) => e.id === id) ?? S.M.edges.find((e) => e.id === id) ?? null;
}

/**
 * 現在のビューに表示している要素を返す。
 *
 * @returns 表示中の要素（CC().nodes）
 * @example
 * // ブロック定義図に A と B を表示中
 * visibleNodes().map((n) => n.key) // → ["A", "B"]
 */
export const visibleNodes = (): ModelNode[] => CC().nodes;
