// 画面とコア（Worker）のやり取り（ADR-0016 §4）。LSP と同じく、テキストに版を付けて送り、結果にも版を付けて返す。

import type { Intent, ProjectProblem } from "./rust";

/** 画面 → コア。 */
export type CoreRequest =
  | { type: "init"; wasmUrl: string }
  | { type: "didChange"; version: number; text: string }
  | { type: "edit"; version: number; id: number; intent: Intent }
  | { type: "parseProject"; id: number; text: string }
  | { type: "createProject"; id: number; name: string };

/**
 * コア → 画面。`json` は wasm の `analyze`・`edit`・`parseProjectFile`・`createProjectFile` が返した JSON の文字列のまま渡す。
 * プロジェクトの設定ファイル（modelith.json、ADR-0019）はモデルのテキストと関係しないので、版を付けず id だけで返事を結ぶ。
 */
export type CoreResponse =
  | { type: "ready" }
  | { type: "failed"; message: string }
  | { type: "analyzed"; version: number; json: string }
  | { type: "edited"; version: number; id: number; json: string }
  | { type: "projectParsed"; id: number; json: string }
  | { type: "projectCreated"; id: number; json: string };

/** コアの中身（wasm の関数）。テストでは差し替える。 */
export interface CoreFns {
  analyze: (text: string) => string;
  edit: (text: string, intent: string) => string;
  parseProjectFile: (text: string) => string;
  createProjectFile: (name: string) => string;
}

/** コアの状態（最後に受け取ったテキスト）。 */
export interface CoreState {
  text: string;
}

/**
 * 1 つの依頼を処理して返事を作る（`init` 以外。届いた順に処理するので、`edit` は直前に届いたテキストに対して計算する）。
 * Worker の中でも、テストで同じスレッドでも、同じこの関数を使う。`didChange` なら state.text を書き換える。
 *
 * @param state コアの状態（最後に受け取ったテキスト）
 * @param req 画面からの依頼（`didChange`・`edit`・`parseProject`・`createProject`）
 * @param fns コアの中身（wasm の `analyze`・`edit`・`parseProjectFile`・`createProjectFile`。テストでは差し替える）
 * @returns 依頼への返事（`analyzed`・`edited` は依頼と同じ版、`projectParsed`・`projectCreated` は同じ id）。fns が例外を投げればそのまま投げる
 * @example
 * handle(state, { type: "didChange", version: 1, text: "package P;" }, fns)
 * // → { type: "analyzed", version: 1, json: fns.analyze("package P;") }
 * handle(state, { type: "edit", version: 1, id: 7, intent }, fns)
 * // → { type: "edited", version: 1, id: 7, json: fns.edit(state.text, JSON.stringify(intent)) }
 * handle(state, { type: "parseProject", id: 8, text: "{}" }, fns)
 * // → { type: "projectParsed", id: 8, json: fns.parseProjectFile("{}") }（state.text は変えない）
 * handle(state, { type: "createProject", id: 9, name: "A" }, fns)
 * // → { type: "projectCreated", id: 9, json: fns.createProjectFile("A") }
 */
export function handle(state: CoreState, req: Exclude<CoreRequest, { type: "init" }>, fns: CoreFns): CoreResponse {
  switch (req.type) {
    case "didChange":
      state.text = req.text;
      return { type: "analyzed", version: req.version, json: fns.analyze(req.text) };
    case "edit":
      return { type: "edited", version: req.version, id: req.id, json: fns.edit(state.text, JSON.stringify(req.intent)) };
    case "parseProject":
      return { type: "projectParsed", id: req.id, json: fns.parseProjectFile(req.text) };
    case "createProject":
      return { type: "projectCreated", id: req.id, json: fns.createProjectFile(req.name) };
  }
}

/**
 * コアの中で予期しない失敗が起きたときの返事を作る。画面が返事を待ち続けないように、依頼と同じ版・id で返す
 * （画面の側で、要素の無い結果・断り・読み取れない設定ファイルとして扱う）。
 *
 * @param req 失敗した依頼（`init` 以外）
 * @param message 失敗の理由（例外のメッセージ）
 * @returns 依頼に対応する返事。json はコアの返事と同じ形（`error`・`refused`・`problems`）
 * @example
 * failedReply({ type: "didChange", version: 2, text: "" }, "boom")
 * // → { type: "analyzed", version: 2, json: '{"error":"boom"}' }
 * failedReply({ type: "parseProject", id: 3, text: "{}" }, "boom")
 * // → { type: "projectParsed", id: 3, json: '{"project":null,"problems":[{"severity":"error","line":1,"column":1,"message":"設定ファイルを読み取れませんでした（boom）"}]}' }
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
      return { type: "projectCreated", id: req.id, json: JSON.stringify({ refused: `プロジェクトの設定ファイルを作れませんでした（${message}）` }) };
  }
}

/**
 * 設定ファイル（modelith.json）を読み取れなかったことを、1 行目 1 文字目の誤りにする（コアが失敗したとき）。
 *
 * @param reason 理由（例外のメッセージなど。文の最後の括弧に入れる）
 * @returns 誤り 1 件
 * @example
 * projectReadProblem("boom") // → { severity: "error", line: 1, column: 1, message: "設定ファイルを読み取れませんでした（boom）" }
 */
export const projectReadProblem = (reason: string): ProjectProblem => ({ severity: "error", line: 1, column: 1, message: `設定ファイルを読み取れませんでした（${reason}）` });
