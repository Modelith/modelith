// 画面とコア（Worker）のやり取り（ADR-0016 §4）。LSP と同じく、テキストに版を付けて送り、結果にも版を付けて返す。

import type { Intent } from "./rust";

/** 画面 → コア。 */
export type CoreRequest =
  | { type: "init"; wasmUrl: string }
  | { type: "didChange"; version: number; text: string }
  | { type: "edit"; version: number; id: number; intent: Intent };

/** コア → 画面。`json` は wasm の `analyze`・`edit` が返した JSON の文字列のまま渡す。 */
export type CoreResponse =
  | { type: "ready" }
  | { type: "failed"; message: string }
  | { type: "analyzed"; version: number; json: string }
  | { type: "edited"; version: number; id: number; json: string };

/** コアの中身（wasm の関数）。テストでは差し替える。 */
export interface CoreFns {
  analyze: (text: string) => string;
  edit: (text: string, intent: string) => string;
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
 * @param req 画面からの依頼（`didChange` か `edit`）
 * @param fns コアの中身（wasm の `analyze`・`edit`。テストでは差し替える）
 * @returns 依頼と同じ版の返事（`analyzed` か `edited`）。fns が例外を投げればそのまま投げる
 * @example
 * handle(state, { type: "didChange", version: 1, text: "package P;" }, fns)
 * // → { type: "analyzed", version: 1, json: fns.analyze("package P;") }
 * handle(state, { type: "edit", version: 1, id: 7, intent }, fns)
 * // → { type: "edited", version: 1, id: 7, json: fns.edit(state.text, JSON.stringify(intent)) }
 */
export function handle(state: CoreState, req: Exclude<CoreRequest, { type: "init" }>, fns: CoreFns): CoreResponse {
  if (req.type === "didChange") {
    state.text = req.text;
    return { type: "analyzed", version: req.version, json: fns.analyze(req.text) };
  }
  return { type: "edited", version: req.version, id: req.id, json: fns.edit(state.text, JSON.stringify(req.intent)) };
}
