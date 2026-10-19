// コアを動かす Web Worker（ADR-0003・ADR-0016）。テキストと解析を Worker の中で持ち、画面のスレッドを止めない。

/// <reference lib="webworker" />
import initWasm, { analyze, checkPluginMessage, createProjectFile, describePlugin, edit, modelSnapshot, parseProjectFile, RulePlugins, updateProjectPlugin } from "./wasm/modelith_core.js";
import { failedReply, handle, type CoreFns, type CoreRequest, type CoreResponse, type CoreState } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

const state: CoreState = { text: "", plugins: null };
const fns: CoreFns = {
  analyze,
  edit,
  parseProjectFile,
  createProjectFile,
  updateProjectPlugin,
  describePlugin,
  loadPlugins: (json) => new RulePlugins(json),
  modelSnapshot,
  checkPluginMessage,
};
/**
 * 画面のスレッドに返事を送る（`postMessage`）。
 *
 * @param r コアからの返事
 */
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
    reply(handle(state, req, fns));
  } catch (e) {
    // wasm の中で予期しない失敗が起きても、画面が待ち続けないように返事をする（画面の側で、要素の無い結果や断りにする）
    reply(failedReply(req, e instanceof Error ? e.message : String(e)));
  }
};
