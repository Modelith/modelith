// 画面とコア（Worker）のやり取り（ADR-0016 §4）。LSP と同じく、テキストに版を付けて送り、結果にも版を付けて返す。

import type { Intent, PluginChange, PluginFiles, ProjectProblem } from "./rust";

/** 画面 → コア。 */
export type CoreRequest =
  | { type: "init"; wasmUrl: string }
  | { type: "didChange"; version: number; text: string }
  | { type: "edit"; version: number; id: number; intent: Intent }
  | { type: "parseProject"; id: number; text: string }
  | { type: "createProject"; id: number; name: string }
  | { type: "updateProject"; id: number; text: string; plugin: string; change: PluginChange }
  | { type: "setPlugins"; id: number; plugins: PluginFiles[] }
  | { type: "describePlugin"; id: number; text: string };

/**
 * コア → 画面。`json` は wasm の `analyze`・`edit`・`parseProjectFile`・`createProjectFile`・`updateProjectPlugin`・
 * `RulePlugins` の `summary`・`describePlugin` が返した JSON の文字列のまま渡す。
 * プロジェクトの設定ファイル（modelith.json、ADR-0019）とプラグイン（ADR-0018）の依頼はモデルのテキストと関係しないので、
 * 版を付けず id だけで返事を結ぶ。
 */
export type CoreResponse =
  | { type: "ready" }
  | { type: "failed"; message: string }
  | { type: "analyzed"; version: number; json: string }
  | { type: "edited"; version: number; id: number; json: string }
  | { type: "projectParsed"; id: number; json: string }
  | { type: "projectCreated"; id: number; json: string }
  | { type: "projectUpdated"; id: number; json: string }
  | { type: "pluginsSet"; id: number; json: string }
  | { type: "pluginDescribed"; id: number; json: string };

/** 読み込んだチェックルールのプラグイン（wasm の `RulePlugins`）。Worker が持ち続ける。 */
export interface LoadedRules {
  /** プラグインごとのまとめの JSON。 */
  summary(): string;
  /** テキストを解析し、使うプラグインのルールを当てた `{ parse, model, findings }` の JSON。 */
  analyze(text: string): string;
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
  /** プラグインのファイルの JSON（`PluginFiles` の配列）を読み込む（wasm の `new RulePlugins(json)`）。 */
  loadPlugins: (json: string) => LoadedRules;
  describePlugin: (text: string) => string;
}

/** コアの状態（最後に受け取ったテキストと、読み込んだプラグイン）。 */
export interface CoreState {
  text: string;
  /** 読み込んだチェックルールのプラグイン。無ければ null（ルールを当てない）。 */
  plugins: LoadedRules | null;
}

/**
 * 1 つの依頼を処理して返事を作る（`init` 以外。届いた順に処理するので、`edit` は直前に届いたテキストに対して計算する）。
 * Worker の中でも、テストで同じスレッドでも、同じこの関数を使う。`didChange` なら state.text を、`setPlugins` なら state.plugins を書き換える。
 *
 * @param state コアの状態（最後に受け取ったテキストと、読み込んだプラグイン）
 * @param req 画面からの依頼（`didChange`・`edit`・`parseProject`・`createProject`・`updateProject`・`setPlugins`・`describePlugin`）
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
 */
export function handle(state: CoreState, req: Exclude<CoreRequest, { type: "init" }>, fns: CoreFns): CoreResponse {
  switch (req.type) {
    case "didChange":
      state.text = req.text;
      return { type: "analyzed", version: req.version, json: state.plugins ? state.plugins.analyze(req.text) : fns.analyze(req.text) };
    case "edit":
      return { type: "edited", version: req.version, id: req.id, json: fns.edit(state.text, JSON.stringify(req.intent)) };
    case "parseProject":
      return { type: "projectParsed", id: req.id, json: fns.parseProjectFile(req.text) };
    case "createProject":
      return { type: "projectCreated", id: req.id, json: fns.createProjectFile(req.name) };
    case "updateProject":
      return { type: "projectUpdated", id: req.id, json: fns.updateProjectPlugin(req.text, req.plugin, JSON.stringify(req.change)) };
    case "setPlugins":
      return { type: "pluginsSet", id: req.id, json: setPlugins(state, req.plugins, fns) };
    case "describePlugin":
      return { type: "pluginDescribed", id: req.id, json: fns.describePlugin(req.text) };
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
 * @returns 依頼に対応する返事。json はコアの返事と同じ形（`error`・`refused`・`problems`）
 * @example
 * failedReply({ type: "didChange", version: 2, text: "" }, "boom")
 * // → { type: "analyzed", version: 2, json: '{"error":"boom"}' }
 * failedReply({ type: "parseProject", id: 3, text: "{}" }, "boom")
 * // → { type: "projectParsed", id: 3, json: '{"project":null,"problems":[{"severity":"error","line":1,"column":1,"message":"設定ファイルを読み込めませんでした（boom）"}]}' }
 * failedReply({ type: "setPlugins", id: 4, plugins: [] }, "boom")
 * // → { type: "pluginsSet", id: 4, json: '{"error":"プラグインを読み込めませんでした（boom）"}' }
 */
export function failedReply(req: Exclude<CoreRequest, { type: "init" }>, message: string): CoreResponse {
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
      return { type: "projectUpdated", id: req.id, json: JSON.stringify({ refused: `プロジェクトの設定を変更できませんでした（${message}）` }) };
    case "setPlugins":
      return { type: "pluginsSet", id: req.id, json: JSON.stringify({ error: `プラグインを読み込めませんでした（${message}）` }) };
    case "describePlugin":
      return { type: "pluginDescribed", id: req.id, json: JSON.stringify({ refused: `プラグインを読み込めませんでした（${message}）` }) };
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
