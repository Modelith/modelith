// Rust のコア（wasm）が返す解析結果を、暫定コアと同じオブジェクトの形に戻す（ADR-0015）。
// Rust は要素どうしの参照を番号で返すので、ここで親・子・持ち主のオブジェクトの参照につなぎ直す。
// モデル（ADR-0016 の手順 A）も同じく番号で返るので、`build` でオブジェクトの参照に戻す。
// `@layout` コメント（移行期の形式）の中身は、ここで読む（読み取れないことは Rust が構文エラーとして返す）。

import { readLayout } from "./parser";
import type {
  Block, Entry, Model, ModelEdge, ModelNode, ModelView, ParseResult, PhaseInfo, Port, Problem, Rel, Scope, Unsupported,
} from "./types";
import type { Command, Exporter, Importer, ModelSnapshot, Permission, PluginMessage } from "../plugins/generated/protocol";
import initWasm, { analyze as analyzeJson, edit as editJson } from "./wasm/modelith_core.js";

/**
 * Rust のコア（wasm）を読み込む。アプリは起動時に一度だけ待つ（ADR-0015：alpha.3 では画面と同じスレッドで同期で呼ぶ）。
 * テストは testing/setup.ts が先に読み込んでおく。読み込めなければ例外で拒否する。
 *
 * @param wasmUrl コアの wasm（modelith_core_bg.wasm）の URL
 */
export async function initCore(wasmUrl: string): Promise<void> {
  await initWasm({ module_or_path: wasmUrl });
}

/**
 * テキストを解析して宣言・関係・構文エラー・配置情報を返す（Rust のパーサ）。例外は投げない（Q-5）。
 * コアの中で予期しない失敗が起きたときは、要素の無い結果と、そのことを伝える構文エラーを返す（テキストには触れない）。
 * Rust が作ったモデルも覚えておき、`build` で取り出せるようにする。
 *
 * @param text SysML v2 のテキスト全文
 * @returns 解析結果（位置は UTF-16）
 * @example
 * parse("package P { part def A; }").entries.map((e) => e.name) // → ["P", "A"]
 * parse("package P {".repeat(20_000)).errors.some((e) => e.msg.startsWith("入れ子が深すぎる")) // → true（例外にしない）
 */
export function parse(text: string): ParseResult {
  return safeParse(text, analyzeJson);
}

/** 解析結果ごとの、Rust が作ったモデル（番号のまま）。`build` で取り出す。 */
const models = new WeakMap<ParseResult, RawModel>();
/** 解析結果ごとの、チェックルールの結果（ADR-0018 §2）。`fromAnalysis` で取り出す。 */
const ruleFindings = new WeakMap<ParseResult, RuleFinding[]>();

/**
 * `analyzeJson` が失敗しても例外を投げずに結果を返す（`analyzeJson` を差し替えてテストできるように分けている）。
 * 結果ごとに Rust のモデルを覚えておく。
 *
 * @param text SysML v2 のテキスト全文
 * @param analyzeJson テキストを解析し、`{ parse, model }` の JSON の文字列を返す関数（wasm の `analyze`）
 * @returns 解析結果。analyzeJson が例外を投げたり壊れた JSON を返したりしたら、要素の無い結果と、
 *   「テキストを解析できませんでした…」の構文エラー 1 件
 * @example
 * safeParse("package P;", () => { throw new Error("unreachable"); }).errors
 * // → [{ pos: 0, msg: "テキストを解析できませんでした。テキストはそのまま残っています（unreachable）" }]
 * safeParse("", () => "{").errors.length // → 1
 */
export function safeParse(text: string, analyzeJson: (text: string) => string): ParseResult {
  try {
    const raw = JSON.parse(analyzeJson(text)) as { parse: RawParseResult; model: RawModel; findings?: RuleFinding[] };
    const P = fromRaw(raw.parse, text);
    models.set(P, raw.model);
    ruleFindings.set(P, Array.isArray(raw.findings) ? raw.findings : []);
    return P;
  } catch (e) {
    const errors = [{ pos: 0, msg: `テキストを解析できませんでした。テキストはそのまま残っています（${e instanceof Error ? e.message : String(e)}）` }];
    const P: ParseResult = { entries: [], rels: [], errors, layout: readLayout(text, errors), unsupported: [] };
    models.set(P, { nodes: [], views: [], edges: [], problems: [...errors], phases: null, phaseEnum: null });
    return P;
  }
}

/** 持ち主の番号（名前のある宣言か、名前の無いブロック）。 */
type RawScope = { e: number } | { b: number };

type RawEntry = Omit<Entry, "owner" | "pe" | "children" | "phaseBlock" | "about"> & {
  owner: RawScope | null;
  pe: number | null;
  children: number[];
  phaseBlock?: RawScope;
  about?: number[];
};
type RawBlock = Omit<Block, "anon" | "owner"> & { owner: RawScope | null };
/** 関係（相手は文字列、文の持ち主と使用（接続・名前付きのフローなど）は番号）。 */
type RawRel = { rel: Rel["rel"]; pe: number | null; usage?: number; start: number; end: number } & Record<string, unknown>;

/** Rust の `ParseResult`（JSON）。 */
export interface RawParseResult {
  entries: RawEntry[];
  blocks: RawBlock[];
  rels: RawRel[];
  errors: { pos: number; msg: string }[];
  unsupported: Unsupported[];
}

/**
 * Worker のコアが返した解析とモデル（`analyze` の JSON）を、解析結果とモデルのオブジェクトに戻す（ADR-0016）。例外は投げない。
 * チェックルールのプラグインを読み込んでいれば、その結果（findings）も取り出す（ADR-0018 §2）。
 *
 * @param json wasm の `analyze`（または `RulePlugins.analyze`）が返した JSON の文字列
 * @param text その JSON を作ったときのテキスト全文（`@layout` コメントを読むのに使う）
 * @returns 解析結果 P・モデル M・チェックルールの結果 findings（無ければ空）。JSON が壊れていれば、要素の無い結果と構文エラー 1 件
 * @example
 * fromAnalysis(analyze("package P { part def A; }"), "package P { part def A; }").M.nodes.map((n) => n.key) // → ["A"]
 * fromAnalysis(plugins.analyze("package P { requirement def R; }"), …).findings // → [{ plugin: "jp.x", rule: "r1", pos: 12, … }]
 * fromAnalysis("{", "package P;").P.errors[0].msg // → "テキストを解析できませんでした。…"
 */
export function fromAnalysis(json: string, text: string): { P: ParseResult; M: Model; findings: RuleFinding[] } {
  const P = safeParse(text, () => json);
  return { P, M: build(P), findings: ruleFindings.get(P) ?? [] };
}

/**
 * Rust の解析結果（JSON の文字列）を、暫定コアと同じ `ParseResult` にする。
 *
 * @param json Rust の `ParseResult` の JSON の文字列
 * @param text その JSON を作ったときのテキスト全文（`@layout` コメントを読むのに使う）
 * @returns 番号をオブジェクトの参照につなぎ直した解析結果。JSON が読めなければ例外（SyntaxError）を投げる
 * @example
 * fromRust('{"entries":[],"blocks":[],"rels":[],"errors":[],"unsupported":[]}', "") // → { entries: [], rels: [], errors: [], layout: {}, unsupported: [] }
 * fromRust("{", "") // → SyntaxError を投げる
 */
export function fromRust(json: string, text: string): ParseResult {
  return fromRaw(JSON.parse(json) as RawParseResult, text);
}

/**
 * Rust の解析結果（番号で参照する形）を、オブジェクトの参照につなぎ直す。
 *
 * @param raw JSON から読んだ Rust の解析結果
 * @param text その解析結果を作ったときのテキスト全文（`@layout` コメントを読むのに使う）
 * @returns 暫定コアと同じ形の解析結果。指す先の無い番号は null（子の一覧からは除く）
 * @example
 * fromRaw({ entries: [], blocks: [], rels: [], errors: [], unsupported: [] }, "") // → { entries: [], rels: [], errors: [], layout: {}, unsupported: [] }
 */
function fromRaw(raw: RawParseResult, text: string): ParseResult {
  const entries: Entry[] = raw.entries.map((e) => ({ ...e, owner: null, pe: null, children: [], phaseBlock: undefined, about: undefined }));
  const blocks: Block[] = raw.blocks.map((b) => ({ ...b, anon: true, owner: null }));
  const scope = (s: RawScope | null | undefined): Scope | null => {
    if (!s) return null;
    return ("e" in s ? entries[s.e] : blocks[s.b]) ?? null;
  };
  const entry = (i: number | null | undefined): Entry | null => (i == null ? null : (entries[i] ?? null));
  raw.entries.forEach((r, i) => {
    const e = entries[i]!;
    e.owner = scope(r.owner);
    e.pe = entry(r.pe);
    e.children = r.children.flatMap((c) => entry(c) ?? []);
    if (r.phaseBlock) e.phaseBlock = scope(r.phaseBlock) ?? undefined;
    else delete e.phaseBlock;
    if (r.about) e.about = r.about.flatMap((a) => entry(a) ?? []);
    else delete e.about;
  });
  raw.blocks.forEach((r, i) => {
    blocks[i]!.owner = scope(r.owner);
  });
  const rels = raw.rels.map((r) => {
    const { usage, ...rest } = r;
    const rel = typeof usage === "number" ? { ...rest, pe: entry(r.pe), usage: entry(usage) } : { ...rest, pe: entry(r.pe) };
    return rel as unknown as Rel;
  });
  // 読み取れない @layout コメントは Rust が構文エラーに入れているので、ここで足したエラーは捨てる
  return { entries, rels, errors: [...raw.errors], layout: readLayout(text, []), unsupported: raw.unsupported };
}

type RawPort = Omit<Port, "entry"> & { entry: number };
type RawNode = Omit<ModelNode, "entry" | "ports"> & { entry: number; ports: RawPort[] };
type RawEdge = Omit<ModelEdge, "rel"> & { rel?: number };
type RawView = Omit<ModelView, "entry" | "targets" | "frames"> & {
  entry: number;
  targets: number[];
  frames: { name: string; entry: number; nodeKeys: string[] }[];
};

/** Rust の `Model`（JSON）。宣言は `entries`、関係は `rels` の番号で指す。 */
export interface RawModel {
  nodes: RawNode[];
  views: RawView[];
  edges: RawEdge[];
  problems: Problem[];
  phases: string[] | null;
  phaseEnum: string | null;
}

/**
 * 解析結果からモデル（図の要素・関係・問題・フェーズ）を作る（Rust のモデル構築、ADR-0016）。
 * 中身は `parse` のときに Rust が作っている。ここでは番号をオブジェクトの参照に戻すだけ。
 * `parse`（Rust）が返したものでない解析結果は受け付けない。
 *
 * @param P このモジュールの `parse`（または `safeParse`）が返した解析結果
 * @returns モデル。P が `parse` の返したものでなければ例外（Error）を投げる
 * @example
 * build(parse("package P { part def A; }")).nodes.map((n) => n.key) // → ["A"]
 * build({ entries: [], rels: [], errors: [], layout: {}, unsupported: [] }) // → Error を投げる（parse が返したものでない）
 */
export function build(P: ParseResult): Model {
  const raw = models.get(P);
  if (!raw) throw new Error("build には、parse（Rust）が返した解析結果を渡してください");
  return toModel(raw, P);
}

/**
 * Rust のモデル（番号で参照する形）を、解析結果の宣言・関係を指すオブジェクトの参照に戻す。
 *
 * @param raw Rust が作ったモデル
 * @param P そのモデルと一緒に作った解析結果
 * @returns モデル。モデルが指す宣言の番号が P に無ければ例外（Error）を投げる
 * @example
 * toModel({ nodes: [], views: [], edges: [], problems: [], phases: null, phaseEnum: null }, P).nodes // → []
 */
function toModel(raw: RawModel, P: ParseResult): Model {
  const entry = (i: number): Entry => {
    const e = P.entries[i];
    if (!e) throw new Error(`モデルが指す宣言（${i}）がありません`);
    return e;
  };
  const nodes: ModelNode[] = raw.nodes.map((n) => ({ ...n, entry: entry(n.entry), ports: n.ports.map((p) => ({ ...p, entry: entry(p.entry) })) }));
  const nodeOf = new Map<Entry, ModelNode>(nodes.map((n) => [n.entry, n]));
  const byName = new Map<string, Entry[]>();
  for (const e of P.entries) {
    if (!e.name) continue;
    const list = byName.get(e.name);
    if (list) list.push(e);
    else byName.set(e.name, [e]);
  }
  const edges: ModelEdge[] = raw.edges.map(({ rel, ...e }) => {
    const r = rel == null ? undefined : P.rels[rel];
    return r ? { ...e, rel: r } : e;
  });
  const views: ModelView[] = raw.views.map((v) => ({
    ...v,
    entry: entry(v.entry),
    targets: v.targets.map(entry),
    frames: v.frames.map((f) => ({ ...f, entry: entry(f.entry) })),
  }));
  const phaseOf = (e: Entry): PhaseInfo | null => {
    for (let a: Entry | null = e; a; a = a.pe) {
      const stage = a.meta?.["Phase"]?.["stage"];
      if (stage) return { value: stage, own: a === e, holder: a };
    }
    return null;
  };
  return {
    nodes, views, edges, problems: raw.problems, nodeOf, byName, rels: P.rels, phases: raw.phases, phaseEnum: raw.phaseEnum, phaseOf,
  };
}

/**
 * 図の操作の意図（ADR-0016）。要素は図の要素のキー、関係は ID で指す（テキスト上の位置は使わない）。
 * `ctx` は内部ブロック図・シーケンス図の対象（部品定義・シナリオのキー）。`u:名前`・`l:名前` のキーは、その中の部品・ライフライン。
 */
export type Intent =
  | { op: "addNode"; kind: string; phase?: string | null; newPackage?: string }
  | { op: "addUsage"; ctx: string; type: string }
  | { op: "rename"; key: string; name: string; ctx?: string }
  | { op: "delete"; keys: string[]; ctx?: string }
  | { op: "deleteEdge"; id: string; ctx?: string }
  | { op: "connect"; rel: string; from: string; to: string; fromPort?: string | null; toPort?: string | null; ctx?: string }
  | { op: "addMessage"; ctx: string; from: string; to: string }
  | { op: "updateMessage"; ctx: string; id: string; name: string; type: string }
  | { op: "moveMessage"; ctx: string; id: string; dir: -1 | 1 }
  | { op: "setPhase"; keys: string[]; value: string; ctx?: string }
  | { op: "initPhases"; newPackage?: string }
  | { op: "makePort"; key: string; name: string; dir: string; type: string; flows: { id: string; from?: boolean; to?: boolean }[]; ctx?: string }
  | { op: "setPortDir"; key: string; port: string; dir: string; ctx?: string }
  | { op: "deletePort"; key: string; port: string; ctx?: string }
  | { op: "saveView"; name: string; kind: string; targets: string[] }
  | { op: "addToView"; view: string; key: string }
  | { op: "removeFromView"; view: string; key: string };

/** テキストの編集（古いテキストの [start, end) を text に置き換える。位置は UTF-16）。 */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** 操作の結果。`select` は操作の後に選ぶ要素の名前、`flash` は編集後のテキストで光らせる範囲。 */
export interface EditResult {
  edits: TextEdit[];
  select?: string;
  flash?: [number, number];
}

/** 操作できなかったとき、その理由（画面にそのまま出す文）。 */
export interface Refused {
  refused: string;
}

/** プロジェクトが使うプラグイン 1 つの設定（modelith.json の `plugins` の値、ADR-0019）。不明な項目もそのまま持つ。 */
export interface PluginUse {
  version?: string;
  enabled: boolean;
  /** プラグインごとの設定（中身はプラグインが決める）。 */
  settings?: unknown;
  [key: string]: unknown;
}

/** プロジェクトの設定ファイル（modelith.json）の中身（形は crates/modelith-core/src/project_file）。不明な項目もそのまま持つ。 */
export interface ProjectFile {
  /** 画面に出すプロジェクト名。無ければフォルダ名を出す。 */
  name?: string;
  plugins: Record<string, PluginUse>;
  [key: string]: unknown;
}

/** 設定ファイルの問題 1 件。行・列は 1 始まり（列は UTF-16 の単位）、message は画面にそのまま出す文。 */
export interface ProjectProblem {
  severity: "error" | "warning";
  line: number;
  column: number;
  message: string;
}

/** 設定ファイルを読み取った結果。誤り（error）があれば project は null。 */
export interface ProjectFileResult {
  project: ProjectFile | null;
  problems: ProjectProblem[];
}

/** 新しく作った（または書き換えた）設定ファイルのテキスト。 */
export interface CreatedProjectFile {
  text: string;
}

/** チェックルールの結果の重さ（plugin-sdk の DiagnosticSeverity）。 */
export type RuleSeverity = "error" | "warning" | "information" | "hint";

/** チェックルールの結果 1 件（ADR-0018 §2）。pos は要素の宣言の始まり（UTF-16）。 */
export interface RuleFinding {
  /** プラグインの ID。 */
  plugin: string;
  /** ルールの ID。 */
  rule: string;
  severity: RuleSeverity;
  /** 画面にそのまま出す文（名前と種類を差し込み済み）。 */
  message: string;
  /** 要素のキー。 */
  element: string;
  pos: number;
}

/** コアに渡すプラグイン 1 つ（ID・使うか・プラグインのフォルダからの相対パス → テキスト）。 */
export interface PluginFiles {
  id: string;
  enabled: boolean;
  files: Record<string, string>;
}

/** プラグインの種類（マニフェストの runtime）。rules はチェックルール、browser は TypeScript、wasm-component は WebAssembly。 */
export type PluginRuntime = "rules" | "browser" | "wasm-component";

/** マニフェスト（modelith-plugin.json）から読んだ、プラグインを画面に示すための情報（形は crates/modelith-core/src/rules の ManifestInfo）。 */
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  runtime: PluginRuntime;
  description?: string;
  /** 作者の名前（書いてあれば）。 */
  author?: string;
  /** 宣言した権限（無ければ省く）。 */
  permissions?: Permission[];
  /** v1 のプラグインのプログラムのファイル（プラグインのフォルダからの相対パス）。 */
  main?: string;
  /** メニューに出すコマンド（無ければ省く）。 */
  commands?: Command[];
  /** 取り込み（無ければ省く）。 */
  importers?: Importer[];
  /** 書き出し（無ければ省く）。 */
  exporters?: Exporter[];
}

/** プラグインを読み込むときの問題 1 件。path はプロジェクトのフォルダからの相対パス、place は 1 始まりの行・列（無ければ null）。 */
export interface PluginLoadProblem {
  path: string;
  place: { line: number; column: number } | null;
  message: string;
}

/** 読み込んだプラグイン 1 つのまとめ。installed が false なら、プロジェクトに入っていない（マニフェストが無い）。 */
export interface PluginSummary {
  id: string;
  enabled: boolean;
  installed: boolean;
  /** マニフェストの情報。無い・読めなければ null。 */
  manifest: PluginInfo | null;
  /** 使えるルールの数。 */
  rules: number;
  problems: PluginLoadProblem[];
}

/** プラグインを読み込んだ結果。コアが失敗したときは plugins を空にし、error に理由を入れる。 */
export interface PluginsResult {
  plugins: PluginSummary[];
  error?: string;
}

/** 設定ファイルの使うプラグインの変更（加える・使う／止める・外す。形は crates/modelith-core/src/project_file の PluginChange）。 */
export type PluginChange = { op: "add"; version: string } | { op: "setEnabled"; enabled: boolean } | { op: "remove" };

/** プラグインの診断 1 件を、テキストの位置（UTF-16）に直したもの（形は crates/modelith-core/src/plugin_host の PlacedDiagnostic）。 */
export interface PlacedDiagnostic {
  pos: number;
  end: number;
  severity: RuleSeverity;
  message: string;
  code?: string;
}

/**
 * コアが確かめた、プラグインからのメッセージ（ADR-0018 §3・§4）。変更案と診断は、テキストの位置（UTF-16）に直したものを添える。
 * 形は crates/modelith-core/src/plugin_host の CheckedMessage。メッセージの型は plugin-sdk のもの。
 */
export interface CheckedPluginMessage {
  message: PluginMessage;
  edits?: TextEdit[];
  diagnostics?: PlacedDiagnostic[];
}

/** プラグインに渡すモデル（plugin-sdk の型）と、それを作ったテキストの版。 */
export interface VersionedSnapshot {
  version: number;
  snapshot: ModelSnapshot;
}

/** マニフェストを読んだ結果。 */
export interface DescribedPlugin {
  plugin: PluginInfo;
}

/**
 * 今のテキストに意図を当てて、テキストの編集を返す（Rust のコア、ADR-0016）。例外は投げない（Q-5）。
 *
 * @param text 今のテキスト全文
 * @param intent 図の操作の意図
 * @returns テキストの編集（位置は UTF-16）。操作できなければ理由（`{ refused }`）
 * @example
 * edit("package P { part def A; }", { op: "rename", key: "A", name: "Motor" })
 * // → { edits: [...], select: "Motor" }（当てると "package P { part def Motor; }"）
 * edit("package P { part def A; }", { op: "rename", key: "Gone", name: "B" }) // → { refused: "…Gone…" }
 */
export function edit(text: string, intent: Intent): EditResult | Refused {
  return safeEdit(text, intent, editJson);
}

/**
 * `editJson` が失敗しても例外を投げずに結果を返す（`editJson` を差し替えてテストできるように分けている）。
 *
 * @param text 今のテキスト全文
 * @param intent 図の操作の意図（JSON にして editJson に渡す）
 * @param editJson テキストと意図の JSON を受け取り、結果の JSON の文字列を返す関数（wasm の `edit`）
 * @returns テキストの編集か、操作できない理由。editJson が例外を投げたり壊れた JSON を返したりしたら、
 *   「操作できませんでした…」の理由
 * @example
 * safeEdit("", { op: "delete", keys: [] }, () => { throw new Error("unreachable"); })
 * // → { refused: "操作できませんでした。テキストはそのまま残っています（unreachable）" }
 */
export function safeEdit(text: string, intent: Intent, editJson: (text: string, intent: string) => string): EditResult | Refused {
  try {
    return JSON.parse(editJson(text, JSON.stringify(intent))) as EditResult | Refused;
  } catch (e) {
    return { refused: `操作できませんでした。テキストはそのまま残っています（${e instanceof Error ? e.message : String(e)}）` };
  }
}
