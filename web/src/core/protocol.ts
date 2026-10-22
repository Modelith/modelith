// 画面とコア（Worker）のやり取り（ADR-0016 §4）。LSP と同じく、テキストに版を付けて送り、結果にも版を付けて返す。

import type { Permission } from "../plugins/generated/protocol";
import type { Intent, PluginChange, PluginFiles, ProjectProblem } from "./rust";

/** 画面 → コア。 */
export type CoreRequest =
  | { type: "init"; wasmUrl: string }
  | { type: "didChange"; version: number; text: string; path?: string | null }
  | { type: "projectFiles"; id: number; clear: boolean; set: ProjectFileText[]; remove: string[] }
  | { type: "projectProblems"; version: number; id: number }
  | { type: "edit"; version: number; id: number; intent: Intent }
  | { type: "parseProject"; id: number; text: string }
  | { type: "createProject"; id: number; name: string }
  | { type: "updateProject"; id: number; text: string; plugin: string; change: PluginChange }
  | { type: "updateLevel"; id: number; text: string; kind: string; level: string }
  | { type: "setLevels"; id: number; levels: Record<string, string> }
  | { type: "problemKinds"; id: number }
  | { type: "setPlugins"; id: number; plugins: PluginFiles[] }
  | { type: "describePlugin"; id: number; text: string }
  | { type: "modelSnapshot"; version: number; id: number }
  | { type: "checkPluginMessage"; version: number; id: number; message: string; permissions: Permission[] };

/**
 * コア → 画面。`json` は wasm の `analyze`・`edit`・`parseProjectFile`・`createProjectFile`・`updateProjectPlugin`・
 * `RulePlugins` の `summary`・`describePlugin` が返した JSON の文字列のまま渡す。
 * プロジェクトの設定ファイル（modelith.json、ADR-0019）とプラグイン（ADR-0018）の依頼はモデルのテキストと関係しないので、
 * 版を付けず id だけで返事を結ぶ。
 * v1 のプラグインに渡すモデル（`modelSnapshot`）と、プラグインから届いたメッセージの確認（`checkPluginMessage`）は、
 * コアが最後に受け取ったテキストに対して行うので、依頼と同じ版を付けて返す（ADR-0018 §3・§4）。
 */
export type CoreResponse =
  | { type: "ready" }
  | { type: "failed"; message: string }
  | ({ type: "analyzed"; version: number; json: string } & Failure)
  | ({ type: "edited"; version: number; id: number; json: string } & Failure)
  | ({ type: "projectParsed"; id: number; json: string } & Failure)
  | ({ type: "projectCreated"; id: number; json: string } & Failure)
  | ({ type: "projectUpdated"; id: number; json: string } & Failure)
  | ({ type: "pluginsSet"; id: number; json: string } & Failure)
  | ({ type: "pluginDescribed"; id: number; json: string } & Failure)
  | ({ type: "snapshotMade"; version: number; id: number; json: string } & Failure)
  | ({ type: "pluginMessageChecked"; version: number; id: number; json: string } & Failure)
  | ({ type: "projectFilesSet"; id: number; json: string } & Failure)
  | ({ type: "levelsSet"; id: number; json: string } & Failure)
  | ({ type: "kindsListed"; id: number; json: string } & Failure)
  | ({ type: "problemsCounted"; version: number; id: number; json: string } & Failure);

/** プロジェクトのほかのファイル 1 つ（フォルダからのパスとテキスト。ADR-0021）。 */
export interface ProjectFileText {
  path: string;
  text: string;
}

/** 依頼への返事（起動の `ready`・`failed` を除く）。 */
export type CoreReply = Exclude<CoreResponse, { type: "ready" } | { type: "failed" }>;

/**
 * コアの中で予期しない失敗（wasm の例外）が起きた返事に付く印。画面の側は、この印のある返事を受け取ったら、
 * 壊れたかもしれない wasm を使い続けず、コアを作り直す（Q-7）。
 */
interface Failure {
  /** 失敗の理由（例外のメッセージ）。ふつうの返事には無い。 */
  failure?: string;
}

/** 読み込んだチェックルールのプラグイン（wasm の `RulePlugins`）。Worker が持ち続ける。 */
export interface LoadedRules {
  /** プラグインごとのまとめの JSON。 */
  summary(): string;
  /** テキストを解析し、使うプラグインのルールを当てた `{ parse, model, findings }` の JSON。 */
  analyze(text: string): string;
  /** 覚えたほかのファイルごとの問題に、使うプラグインのルールの結果を添えた JSON（ADR-0021 §6）。 */
  projectProblems(text: string): string;
  /** wasm の中のメモリを返す。 */
  free(): void;
}

/** コアの中身（wasm の関数）。テストでは差し替える。 */
export interface CoreFns {
  analyze: (text: string) => string;
  edit: (text: string, intent: string) => string;
  parseProjectFile: (text: string) => string;
  createProjectFile: (name: string) => string;
  updateProjectPlugin: (text: string, id: string, change: string) => string;
  /** 設定ファイルの知らせの重さを 1 つ書き換える（wasm の `updateProjectLevel`。F-EDIT-11。重さが空なら既定に戻す）。 */
  updateProjectLevel: (text: string, kind: string, level: string) => string;
  /** 知らせの重さを覚える（wasm の `setProblemLevels`。`modelith.json` の `levels` の JSON）。 */
  setProblemLevels: (json: string) => void;
  /** 重さを選べるモデルの知らせの種類の JSON（wasm の `problemKinds`）。 */
  problemKinds: () => string;
  /** プラグインのファイルの JSON（`PluginFiles` の配列）を読み込む（wasm の `new RulePlugins(json)`）。 */
  loadPlugins: (json: string) => LoadedRules;
  describePlugin: (text: string) => string;
  /** テキストから、v1 のプラグインに渡すモデル（plugin-sdk の ModelSnapshot）の JSON を作る（wasm の `modelSnapshot`）。 */
  modelSnapshot: (text: string) => string;
  /** プラグインから届いたメッセージを確かめる（wasm の `checkPluginMessage`。権限は JSON の並び）。 */
  checkPluginMessage: (text: string, message: string, permissions: string) => string;
  /** プロジェクトのファイルを覚える（wasm の `setProjectFile`。ADR-0021）。 */
  setProjectFile: (path: string, text: string) => void;
  /** プロジェクトのファイルを忘れる（wasm の `removeProjectFile`）。 */
  removeProjectFile: (path: string) => void;
  /** プロジェクトのファイルをすべて忘れる（wasm の `clearProjectFiles`）。 */
  clearProjectFiles: () => void;
  /** 表示中のファイルのパスを決める（wasm の `setFocusFile`。フォルダの外のファイルなら undefined）。 */
  setFocusFile: (path?: string) => void;
  /** 覚えたほかのファイルごとの問題の JSON（wasm の `projectProblems`。ADR-0021 §6）。 */
  projectProblems: (text: string) => string;
}

/** コアの状態（最後に受け取ったテキストと、読み込んだプラグイン）。 */
export interface CoreState {
  text: string;
  /** 読み込んだチェックルールのプラグイン。無ければ null（ルールを当てない）。 */
  plugins: LoadedRules | null;
}

/**
 * 1 つの依頼を処理して返事を作る（`init` 以外。届いた順に処理するので、`edit` は直前に届いたテキストに対して計算する）。
 * Worker の中でも、テストで同じスレッドでも、同じこの関数を使う。`didChange` なら state.text と表示中のファイルのパスを、`setPlugins` なら state.plugins を、
 * `projectFiles` ならコアが覚えるプロジェクトのファイル（ADR-0021）を、`setLevels` ならコアが覚える知らせの重さ（F-EDIT-11）を書き換える。
 *
 * @param state コアの状態（最後に受け取ったテキストと、読み込んだプラグイン）
 * @param req 画面からの依頼（`didChange`・`edit`・`parseProject`・`createProject`・`updateProject`・`updateLevel`・`setLevels`・`problemKinds`・`setPlugins`・`describePlugin`・`modelSnapshot`・`checkPluginMessage`・`projectFiles`・`projectProblems`）
 * @param fns コアの中身（wasm の関数。テストでは差し替える）
 * @returns 依頼への返事（`analyzed`・`edited` は依頼と同じ版、ほかは同じ id）。fns が例外を投げればそのまま投げる
 * @example
 * handle(state, { type: "didChange", version: 1, text: "package P;" }, fns)
 * // → { type: "analyzed", version: 1, json: fns.analyze("package P;") }（プラグインがあれば state.plugins.analyze）
 * handle(state, { type: "edit", version: 1, id: 7, intent }, fns)
 * // → { type: "edited", version: 1, id: 7, json: fns.edit(state.text, JSON.stringify(intent)) }
 * handle(state, { type: "parseProject", id: 8, text: "{}" }, fns)
 * // → { type: "projectParsed", id: 8, json: fns.parseProjectFile("{}") }（state.text は変えない）
 * handle(state, { type: "setPlugins", id: 9, plugins: [] }, fns)
 * // → { type: "pluginsSet", id: 9, json: '{"plugins":[]}' }（state.plugins は null）
 * handle(state, { type: "checkPluginMessage", version: 1, id: 10, message: '{"type":"ready"}', permissions: [] }, fns)
 * // → { type: "pluginMessageChecked", version: 1, id: 10, json: fns.checkPluginMessage(state.text, '{"type":"ready"}', "[]") }
 * handle(state, { type: "projectFiles", id: 11, clear: false, set: [{ path: "b.sysml", text: "package B;" }], remove: [] }, fns)
 * // → { type: "projectFilesSet", id: 11, json: "{}" }（コアが b.sysml を覚える）
 * handle(state, { type: "projectProblems", version: 1, id: 12 }, fns)
 * // → { type: "problemsCounted", version: 1, id: 12, json: fns.projectProblems(state.text) }（プラグインがあれば state.plugins.projectProblems）
 */
export function handle(state: CoreState, req: Exclude<CoreRequest, { type: "init" }>, fns: CoreFns): CoreResponse {
  switch (req.type) {
    case "didChange":
      state.text = req.text;
      fns.setFocusFile(req.path ?? undefined);
      return { type: "analyzed", version: req.version, json: state.plugins ? state.plugins.analyze(req.text) : fns.analyze(req.text) };
    case "edit":
      return { type: "edited", version: req.version, id: req.id, json: fns.edit(state.text, JSON.stringify(req.intent)) };
    case "parseProject":
      return { type: "projectParsed", id: req.id, json: fns.parseProjectFile(req.text) };
    case "createProject":
      return { type: "projectCreated", id: req.id, json: fns.createProjectFile(req.name) };
    case "updateProject":
      return { type: "projectUpdated", id: req.id, json: fns.updateProjectPlugin(req.text, req.plugin, JSON.stringify(req.change)) };
    case "updateLevel":
      return { type: "projectUpdated", id: req.id, json: fns.updateProjectLevel(req.text, req.kind, req.level) };
    case "setLevels":
      fns.setProblemLevels(JSON.stringify(req.levels));
      return { type: "levelsSet", id: req.id, json: "{}" };
    case "problemKinds":
      return { type: "kindsListed", id: req.id, json: fns.problemKinds() };
    case "setPlugins":
      return { type: "pluginsSet", id: req.id, json: setPlugins(state, req.plugins, fns) };
    case "describePlugin":
      return { type: "pluginDescribed", id: req.id, json: fns.describePlugin(req.text) };
    case "modelSnapshot":
      return { type: "snapshotMade", version: req.version, id: req.id, json: fns.modelSnapshot(state.text) };
    case "checkPluginMessage":
      return { type: "pluginMessageChecked", version: req.version, id: req.id, json: fns.checkPluginMessage(state.text, req.message, JSON.stringify(req.permissions)) };
    case "projectFiles":
      if (req.clear) fns.clearProjectFiles();
      for (const path of req.remove) fns.removeProjectFile(path);
      for (const f of req.set) fns.setProjectFile(f.path, f.text);
      return { type: "projectFilesSet", id: req.id, json: "{}" };
    case "projectProblems":
      return { type: "problemsCounted", version: req.version, id: req.id, json: state.plugins ? state.plugins.projectProblems(state.text) : fns.projectProblems(state.text) };
  }
}

/**
 * 読み込んだプラグインを置き換える。前に読み込んだものは返す（free）。プラグインが無ければ、ルールを当てない状態にする。
 *
 * @param state コアの状態（plugins を書き換える）
 * @param plugins 読み込むプラグイン（空なら読み込まない）
 * @param fns コアの中身（`loadPlugins` を使う）
 * @returns まとめの JSON（`{ "plugins": [...] }`）
 * @example
 * setPlugins(state, [], fns)                                   // → '{"plugins":[]}'（state.plugins は null）
 * setPlugins(state, [{ id: "jp.x", enabled: true, files }], fns) // → fns.loadPlugins(…).summary()
 */
function setPlugins(state: CoreState, plugins: PluginFiles[], fns: CoreFns): string {
  state.plugins?.free();
  state.plugins = null;
  if (!plugins.length) return JSON.stringify({ plugins: [] });
  state.plugins = fns.loadPlugins(JSON.stringify(plugins));
  return state.plugins.summary();
}

/**
 * コアの中で予期しない失敗が起きたときの返事を作る。画面が返事を待ち続けないように、依頼と同じ版・id で返す
 * （画面の側で、要素の無い結果・断り・読み取れない設定ファイル・読み込めないプラグインとして扱う）。
 *
 * @param req 失敗した依頼（`init` 以外）
 * @param message 失敗の理由（例外のメッセージ）
 * @returns 依頼に対応する返事。json はコアの返事と同じ形（`error`・`refused`・`problems`）で、`failure` に理由を付ける
 * @example
 * failedReply({ type: "didChange", version: 2, text: "" }, "boom")
 * // → { type: "analyzed", version: 2, json: '{"error":"boom"}', failure: "boom" }
 * failedReply({ type: "parseProject", id: 3, text: "{}" }, "boom")
 * // → { type: "projectParsed", id: 3, json: '{"project":null,"problems":[{"severity":"error","line":1,"column":1,"message":"設定ファイルを読み込めませんでした（boom）"}]}', failure: "boom" }
 * failedReply({ type: "setPlugins", id: 4, plugins: [] }, "boom")
 * // → { type: "pluginsSet", id: 4, json: '{"error":"プラグインを読み込めませんでした（boom）"}', failure: "boom" }
 * failedReply({ type: "checkPluginMessage", version: 5, id: 6, message: "{}", permissions: [] }, "boom")
 * // → { type: "pluginMessageChecked", version: 5, id: 6, json: '{"refused":"メッセージを確かめられませんでした（boom）"}', failure: "boom" }
 */
export function failedReply(req: Exclude<CoreRequest, { type: "init" }>, message: string): CoreReply {
  return { ...failedReplyBody(req, message), failure: message };
}

/**
 * 失敗の返事の中身（印を除く）を作る。
 *
 * @param req 失敗した依頼（`init` 以外）
 * @param message 失敗の理由（例外のメッセージ）
 * @returns 依頼に対応する返事（`failure` は付けない）
 * @example
 * failedReplyBody({ type: "edit", version: 1, id: 2, intent }, "boom")
 * // → { type: "edited", version: 1, id: 2, json: '{"refused":"操作できませんでした（boom）"}' }
 */
function failedReplyBody(req: Exclude<CoreRequest, { type: "init" }>, message: string): CoreReply {
  switch (req.type) {
    case "didChange":
      return { type: "analyzed", version: req.version, json: JSON.stringify({ error: message }) };
    case "edit":
      return { type: "edited", version: req.version, id: req.id, json: JSON.stringify({ refused: `操作できませんでした（${message}）` }) };
    case "parseProject":
      return { type: "projectParsed", id: req.id, json: JSON.stringify({ project: null, problems: [projectReadProblem(message)] }) };
    case "createProject":
      return { type: "projectCreated", id: req.id, json: JSON.stringify({ refused: `プロジェクトの設定ファイルを作成できませんでした（${message}）` }) };
    case "updateProject":
    case "updateLevel":
      return { type: "projectUpdated", id: req.id, json: JSON.stringify({ refused: `プロジェクトの設定を変更できませんでした（${message}）` }) };
    case "setLevels":
      return { type: "levelsSet", id: req.id, json: JSON.stringify({ error: message }) };
    case "problemKinds":
      return { type: "kindsListed", id: req.id, json: "[]" };
    case "setPlugins":
      return { type: "pluginsSet", id: req.id, json: JSON.stringify({ error: `プラグインを読み込めませんでした（${message}）` }) };
    case "describePlugin":
      return { type: "pluginDescribed", id: req.id, json: JSON.stringify({ refused: `プラグインを読み込めませんでした（${message}）` }) };
    case "modelSnapshot":
      return { type: "snapshotMade", version: req.version, id: req.id, json: JSON.stringify({ error: message }) };
    case "checkPluginMessage":
      return { type: "pluginMessageChecked", version: req.version, id: req.id, json: JSON.stringify({ refused: `メッセージを確かめられませんでした（${message}）` }) };
    case "projectFiles":
      return { type: "projectFilesSet", id: req.id, json: JSON.stringify({ error: message }) };
    case "projectProblems":
      return { type: "problemsCounted", version: req.version, id: req.id, json: "[]" };
  }
}

/**
 * 設定ファイル（modelith.json）を読み込めなかったことを、1 行目 1 文字目のエラーにする（コアが失敗したとき）。
 *
 * @param reason 理由（例外のメッセージなど。文の最後の括弧に入れる）
 * @returns エラー 1 件
 * @example
 * projectReadProblem("boom") // → { severity: "error", line: 1, column: 1, message: "設定ファイルを読み込めませんでした（boom）" }
 */
export const projectReadProblem = (reason: string): ProjectProblem => ({ severity: "error", line: 1, column: 1, message: `設定ファイルを読み込めませんでした（${reason}）` });
