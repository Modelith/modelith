// Vitest の準備：Rust のコア（wasm）を読み込む（ADR-0015）。アプリは起動時に initCore で読み込む。
// wasm は scripts/build-wasm.sh が web/src/core/wasm/ に書き出す（scripts/check.sh が先に実行する）。
/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { initSync } from "../wasm/modelith_core.js";

const wasm = new URL("../wasm/modelith_core_bg.wasm", import.meta.url);
if (!existsSync(wasm)) throw new Error("Rust のコアの wasm がありません。先に scripts/build-wasm.sh を実行してください");
initSync({ module: readFileSync(wasm) });
