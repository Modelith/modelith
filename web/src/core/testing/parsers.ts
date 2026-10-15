// テストで使う 2 つのパーサ（暫定の TS と、Rust の wasm）。同じテストを両方で動かす（ADR-0015）。
// wasm は scripts/build-wasm.sh が web/src/core/wasm/ に書き出す（scripts/check.sh が先に実行する）。

/// <reference types="node" />
import { readFileSync } from "node:fs";
import { initSync, parse as rustParseJson } from "../wasm/modelith_core.js";
import { parse as tsParse } from "../parser";
import { fromRust } from "../rust";
import type { ParseResult } from "../types";

initSync({ module: readFileSync(new URL("../wasm/modelith_core_bg.wasm", import.meta.url)) });

/** Rust のパーサ（wasm）。 */
export const rustParse = (text: string): ParseResult => fromRust(rustParseJson(text), text);

/** テストで比べるパーサ。名前はテスト名に出す。 */
export const PARSERS: [name: string, parse: (text: string) => ParseResult][] = [
  ["TS", tsParse],
  ["Rust", rustParse],
];
