// コアを動かす Web Worker（ADR-0003・ADR-0016）。テキストと解析を Worker の中で持ち、画面のスレッドを止めない。

/// <reference lib="webworker" />
import initWasm, { analyze, edit } from "./wasm/modelith_core.js";
import { handle, type CoreRequest, type CoreResponse, type CoreState } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

const state: CoreState = { text: "" };
const reply = (r: CoreResponse): void => self.postMessage(r);

self.onmessage = (ev: MessageEvent<CoreRequest>): void => {
  const req = ev.data;
  if (req.type === "init") {
    initWasm({ module_or_path: req.wasmUrl }).then(
      () => reply({ type: "ready" }),
      (e: unknown) => reply({ type: "failed", message: e instanceof Error ? e.message : String(e) }),
    );
    return;
  }
  try {
    reply(handle(state, req, { analyze, edit }));
  } catch (e) {
    // wasm の中で予期しない失敗が起きても、画面が待ち続けないように返事をする（画面の側で、要素の無い結果や断りにする）
    const message = e instanceof Error ? e.message : String(e);
    reply(req.type === "didChange" ? { type: "analyzed", version: req.version, json: `{"error":${JSON.stringify(message)}}` } : { type: "edited", version: req.version, id: req.id, json: JSON.stringify({ refused: `操作できませんでした（${message}）` }) });
  }
};
